/// <reference types="@capacitor-community/safe-area" />
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.morelitea.initiative",
  appName: "Initiative",
  webDir: "dist",
  server: {
    // Use HTTP scheme to avoid mixed content issues with self-hosted HTTP servers (LOCAL development and LAN testing)
    // androidScheme: "http",
    hostname: "com.morelitea.initiative",
    iosScheme: "https",
  },
  android: {
    // Allow HTTP requests (for self-hosted servers without HTTPS) (LOCAL development and LAN testing)
    // allowMixedContent: true,
  },
  plugins: {
    // Self-hosted OTA live updates. We drive download/set entirely from JS (manual mode):
    // the backend serves the web bundle matching its version, and useNativeUpdate downloads
    // it then prompts the user to reload. autoUpdate/directUpdate stay off so the plugin
    // never swaps the bundle on its own; appReadyTimeout arms the auto-rollback safety net
    // if a swapped-in bundle fails to call notifyAppReady().
    CapacitorUpdater: {
      autoUpdate: false,
      directUpdate: false,
      resetWhenUpdate: true,
      appReadyTimeout: 10000,
      responseTimeout: 20,
    },
    // Disable built-in SystemBars insets handling - safe-area plugin handles it
    SystemBars: {
      insetsHandling: "disable",
    },
    // SafeArea plugin config for edge-to-edge mode
    SafeArea: {
      // Disable viewport-fit detection to force native padding mode
      // This ensures safe area insets work on Samsung and other devices where
      // the WebView may not properly set CSS env(safe-area-inset-*) values
      detectViewportFitCoverChanges: false,
      initialViewportFitCover: false,
    },
  },
};

export default config;
