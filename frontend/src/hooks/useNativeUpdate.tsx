import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { type BundleInfo, CapacitorUpdater } from "@capgo/capacitor-updater";
import { useCallback, useEffect, useRef, useState } from "react";

import { compareVersions } from "@/hooks/useDockerHubVersion";
import { useServer } from "@/hooks/useServer";

const CURRENT_VERSION = __APP_VERSION__;

interface NativeBundleManifest {
  version: string;
  /** Absolute path (e.g. "/api/v1/native/bundle/download") joined to the server origin. */
  url: string;
  /** sha256 hex of the bundle zip; the updater verifies it after download. */
  checksum: string;
  /** Minimum native app (APK/IPA) version the bundle requires. */
  minNativeVersion: string;
}

interface PromptState {
  show: boolean;
  version: string;
}

const HIDDEN: PromptState = { show: false, version: "" };

/**
 * Build the absolute bundle download URL. The manifest's `url` is an absolute path rooted at
 * `/api/v1/...`, so it must be joined to the server *origin* — not to `serverUrl`, which
 * carries the `/api/v1` suffix and would yield `/api/v1/api/v1/...`.
 */
export const buildBundleDownloadUrl = (serverUrl: string, manifestUrl: string): string =>
  new URL(manifestUrl, new URL(serverUrl).origin).toString();

/**
 * Decide what to do with a served bundle, given the running web bundle version, the installed
 * native shell version, and the bundle's requirements. Pure so it can be unit-tested.
 *
 * - `up-to-date`: the running bundle already matches the server (any version difference,
 *   including a downgrade, is "not up to date" and triggers a download).
 * - `native-required`: the bundle needs a newer native app than the one installed → the user
 *   must update from the store; an OTA can't add native code.
 * - `download`: fetch and offer the new bundle.
 */
export const decideNativeUpdate = (args: {
  manifestVersion: string;
  currentVersion: string;
  nativeVersion: string;
  minNativeVersion: string;
}): "up-to-date" | "native-required" | "download" => {
  if (compareVersions(args.manifestVersion, args.currentVersion) === 0) {
    return "up-to-date";
  }
  if (compareVersions(args.nativeVersion, args.minNativeVersion) < 0) {
    return "native-required";
  }
  return "download";
};

/**
 * Pick the bundle that is safe to swap to for `version`: a fully-downloaded one with status
 * `"success"`. `download()` can resolve before the bundle reaches `"success"` (still verifying),
 * and a retained `error`/`downloading` entry must never be handed to `set()` — that throws or
 * boots a broken bundle that rolls back, which re-shows the reload prompt. Pure so it can be
 * unit-tested against a `list()` snapshot.
 */
export const findReadyBundle = (bundles: BundleInfo[], version: string): BundleInfo | null =>
  bundles.find((b) => b.version === version && b.status === "success") ?? null;

/**
 * Resolve once a `"success"` bundle for `version` exists, polling `list()` until then or until
 * `timeoutMs` elapses (then `null`). The eager download already `await`ed `download()`, so this
 * normally returns on the first check; it only spins if the bundle is still verifying or, in the
 * "tapped reload before the download finished" case, still downloading.
 */
const awaitReadyBundle = async (
  version: string,
  timeoutMs = 60_000
): Promise<BundleInfo | null> => {
  const start = Date.now();
  for (;;) {
    const ready = findReadyBundle((await CapacitorUpdater.list()).bundles, version);
    if (ready) {
      return ready;
    }
    if (Date.now() - start >= timeoutMs) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

/**
 * Self-hosted OTA live updates for the native (Capacitor) app.
 *
 * Each backend serves the web bundle matching its own version (see backend `native.py`).
 * On launch and whenever the app returns to the foreground, this hook asks the configured
 * server for its bundle manifest and, when the served web version differs from the bundle
 * currently running, silently downloads it via `@capgo/capacitor-updater` and prompts the
 * user to reload. Applying the update swaps the WebView to the new bundle and reloads.
 *
 * Two guards keep this safe:
 *  - Native compatibility: if the bundle needs a newer native shell than the installed
 *    APK/IPA (`minNativeVersion` > `current().native`), we skip the OTA and surface a
 *    "update from the store" prompt instead — a web bundle can't add native code.
 *  - Rollback: `notifyAppReady()` (called in `main.tsx`) lets the updater revert a bundle
 *    that fails to boot.
 *
 * No-op on web (`Capacitor.isNativePlatform()` is false) and until a server is configured.
 */
export const useNativeUpdate = () => {
  const { serverUrl, isNativePlatform } = useServer();

  const [updateReady, setUpdateReady] = useState<PromptState>(HIDDEN);
  const [nativeUpdateRequired, setNativeUpdateRequired] = useState<PromptState>(HIDDEN);

  // Prevent overlapping checks and re-download/re-prompt of a version already handled this
  // session. Refs (not state) so they survive re-renders without retriggering effects.
  const checkingRef = useRef(false);
  const handledVersionRef = useRef<string | null>(null);
  const bundleIdRef = useRef<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (!isNativePlatform || !serverUrl || checkingRef.current) {
      return;
    }
    checkingRef.current = true;
    try {
      // serverUrl already ends in "/api/v1"; the manifest lives at "/api/v1/native/bundle/...".
      const manifestRes = await fetch(`${serverUrl}/native/bundle/manifest`, {
        headers: { Accept: "application/json" },
      });
      if (!manifestRes.ok) {
        return; // older server without OTA support, or no bundle in this build
      }
      const manifest = (await manifestRes.json()) as NativeBundleManifest;

      // Already downloaded + prompted this version this session.
      if (handledVersionRef.current === manifest.version) {
        return;
      }

      const { native } = await CapacitorUpdater.current();
      const decision = decideNativeUpdate({
        manifestVersion: manifest.version,
        currentVersion: CURRENT_VERSION,
        nativeVersion: native,
        minNativeVersion: manifest.minNativeVersion,
      });
      if (decision === "up-to-date") {
        return;
      }
      if (decision === "native-required") {
        // Mark handled so we don't re-prompt on every foreground resume this session
        // (re-checked on the next cold start).
        handledVersionRef.current = manifest.version;
        setNativeUpdateRequired({ show: true, version: manifest.version });
        return;
      }

      // Reuse a previously-downloaded bundle for this version if present (avoids a
      // "already exists" error from download() across launches); otherwise download it.
      const downloadUrl = buildBundleDownloadUrl(serverUrl, manifest.url);
      // Only reuse a fully-downloaded bundle; a retained error/partial entry would make
      // set() throw and, since we'd keep "finding" it, never re-download — leaving the user
      // stuck on this version. Filtering to status "success" forces a fresh download instead.
      const existing = findReadyBundle((await CapacitorUpdater.list()).bundles, manifest.version);
      const bundle =
        existing ??
        (await CapacitorUpdater.download({
          url: downloadUrl,
          version: manifest.version,
          checksum: manifest.checksum,
        }));

      handledVersionRef.current = manifest.version;
      bundleIdRef.current = bundle.id;
      setUpdateReady({ show: true, version: manifest.version });
    } catch (error) {
      // Network/plugin failures are non-critical — the app keeps running the current bundle.
      console.debug("Native update check failed:", error);
    } finally {
      checkingRef.current = false;
    }
  }, [isNativePlatform, serverUrl]);

  useEffect(() => {
    if (!isNativePlatform || !serverUrl) {
      return;
    }
    void checkForUpdate();
    const listenerPromise = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        void checkForUpdate();
      }
    });
    return () => {
      void listenerPromise.then((listener) => listener.remove());
    };
  }, [isNativePlatform, serverUrl, checkForUpdate]);

  /** Swap to the downloaded bundle and reload the WebView, under cover of the native splash. */
  const applyUpdate = useCallback(async () => {
    const version = handledVersionRef.current;
    if (!bundleIdRef.current || !version) {
      return;
    }
    // Raise the native splash before anything that reloads or stalls. It survives the WebView
    // reload set() triggers, so the user sees continuous branding from tap → (any remaining
    // download/verification) → new bundle boot — no white flash, no re-shown prompt. The
    // swapped-in bundle hides it in main.tsx after notifyAppReady().
    await SplashScreen.show({ autoHide: false }).catch(() => {});
    try {
      // Never swap into a half-verified bundle: download() can resolve before the bundle reaches
      // "success", and a stale tap can land while it is still downloading. Wait (under the
      // splash) until it is ready, else set() throws or boots a bundle that rolls back and
      // re-prompts — the reported "reload doesn't apply, dialog pops up again".
      const ready = await awaitReadyBundle(version);
      if (!ready) {
        throw new Error(`OTA bundle ${version} never reached "success"`);
      }
      await CapacitorUpdater.set({ id: ready.id });
      // set() reloads the WebView into the new bundle; nothing after this runs. On success the
      // dialog disappears with the old context, so there's no need to hide it first.
    } catch (error) {
      // Swap failed (e.g. the OS evicted the bundle, or it never finished verifying). Drop the
      // splash and leave the prompt open so the user can retry rather than being stuck.
      console.debug("Failed to apply OTA bundle:", error);
      await SplashScreen.hide().catch(() => {});
    }
  }, []);

  /** Dismiss the reload prompt for this session (re-checked on next cold start). */
  const dismissUpdate = useCallback(() => {
    setUpdateReady(HIDDEN);
  }, []);

  const dismissNativeUpdateRequired = useCallback(() => {
    setNativeUpdateRequired(HIDDEN);
  }, []);

  return {
    updateReady,
    applyUpdate,
    dismissUpdate,
    nativeUpdateRequired,
    dismissNativeUpdateRequired,
  };
};
