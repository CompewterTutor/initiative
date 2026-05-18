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
  },
  android: {
    // Allow HTTP requests (for self-hosted servers without HTTPS) (LOCAL development and LAN testing)
    // allowMixedContent: true,
  },
  plugins: {
    // Disable built-in SystemBars insets handling - safe-area plugin handles it
    SystemBars: {
      insetsHandling: "disable",
    },
    // SafeArea plugin config for edge-to-edge mode
    SafeArea: {
      // Enable edge-to-edge mode so the plugin reads actual native inset values
      // (e.g. ~44px for iPhone notch) and injects them as CSS custom properties.
      // Without this, the plugin reports 0 because the OS thinks it handled insets,
      // which overrides our CSS env() values and causes content to overlap the status bar.
      initialViewportFitCover: true,
      detectViewportFitCoverChanges: false,
    },
  },
};

export default config;
