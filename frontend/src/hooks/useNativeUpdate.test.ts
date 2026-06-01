import { describe, expect, it } from "vitest";

import { buildBundleDownloadUrl, decideNativeUpdate } from "./useNativeUpdate";

/**
 * These pure helpers back the OTA flow in {@link useNativeUpdate}. The load-bearing details:
 * the download URL must join to the server *origin* (not `serverUrl`, which already carries
 * `/api/v1`), and the decision must treat any version difference — including a downgrade — as
 * "not up to date", while refusing bundles that need a newer native shell.
 */
describe("buildBundleDownloadUrl", () => {
  it("joins the manifest path to the origin, ignoring the /api/v1 suffix on serverUrl", () => {
    expect(
      buildBundleDownloadUrl("https://app.example.com/api/v1", "/api/v1/native/bundle/download")
    ).toBe("https://app.example.com/api/v1/native/bundle/download");
  });

  it("preserves a non-standard port and http scheme (LAN self-hosting)", () => {
    expect(
      buildBundleDownloadUrl("http://192.168.1.10:8173/api/v1", "/api/v1/native/bundle/download")
    ).toBe("http://192.168.1.10:8173/api/v1/native/bundle/download");
  });

  it("does not double up the /api/v1 segment", () => {
    const url = buildBundleDownloadUrl("https://host/api/v1", "/api/v1/native/bundle/download");
    expect(url.match(/\/api\/v1/g)).toHaveLength(1);
  });
});

describe("decideNativeUpdate", () => {
  const base = { currentVersion: "0.48.0", nativeVersion: "0.48.0", minNativeVersion: "0.48.0" };

  it("is up-to-date when the server matches the running bundle", () => {
    expect(decideNativeUpdate({ ...base, manifestVersion: "0.48.0" })).toBe("up-to-date");
  });

  it("downloads when the server is newer", () => {
    expect(decideNativeUpdate({ ...base, manifestVersion: "0.49.0" })).toBe("download");
  });

  it("downloads when the server is older (downgrade to match is desired)", () => {
    expect(decideNativeUpdate({ ...base, manifestVersion: "0.47.0" })).toBe("download");
  });

  it("requires a native update when the bundle needs a newer shell than installed", () => {
    expect(
      decideNativeUpdate({
        manifestVersion: "0.50.0",
        currentVersion: "0.48.0",
        nativeVersion: "0.48.0", // installed APK predates the native change
        minNativeVersion: "0.50.0",
      })
    ).toBe("native-required");
  });

  it("downloads when the installed shell is new enough for the bundle", () => {
    expect(
      decideNativeUpdate({
        manifestVersion: "0.50.0",
        currentVersion: "0.48.0",
        nativeVersion: "0.50.0",
        minNativeVersion: "0.49.0",
      })
    ).toBe("download");
  });

  it("prefers up-to-date over native-required when already running the served version", () => {
    expect(
      decideNativeUpdate({
        manifestVersion: "0.48.0",
        currentVersion: "0.48.0",
        nativeVersion: "0.48.0",
        minNativeVersion: "0.99.0",
      })
    ).toBe("up-to-date");
  });
});
