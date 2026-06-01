import { createFileRoute, Navigate, Outlet, redirect, useSearch } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { NativeUpdateRequiredDialog } from "@/components/NativeUpdateRequiredDialog";
import { VersionDialog } from "@/components/VersionDialog";
import { useNativeUpdate } from "@/hooks/useNativeUpdate";
import { useServer } from "@/hooks/useServer";

/**
 * Layout route that requires a server to be configured on native platforms.
 * On web, this passes through. On mobile without a configured server, redirects to /connect.
 */
export const Route = createFileRoute("/_serverRequired")({
  beforeLoad: ({ context, search }) => {
    const { server } = context;
    const justConnected = (search as { connected?: string })?.connected === "1";

    // If server context is ready and we're on native without a server, redirect
    // Skip if we just connected (search param indicates state is updating)
    if (
      !justConnected &&
      !server?.loading &&
      server?.isNativePlatform &&
      !server.isServerConfigured
    ) {
      throw redirect({ to: "/connect" });
    }
  },
  component: ServerRequiredLayout,
});

function ServerRequiredLayout() {
  const { loading, isNativePlatform, isServerConfigured } = useServer();
  const search = useSearch({ strict: false }) as { connected?: string };
  // OTA live updates (native only). Mounted here — once a server is configured but before
  // auth is required — so a fresh install can update its web bundle even from the login screen.
  const {
    updateReady,
    applyUpdate,
    dismissUpdate,
    nativeUpdateRequired,
    dismissNativeUpdateRequired,
  } = useNativeUpdate();

  // Check if we just connected from the connect page (search param passed via navigation)
  const justConnected = search?.connected === "1";

  // Show loading state while server context initializes
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // On native, if no server is configured (and we didn't just connect), redirect to connect page
  if (isNativePlatform && !isServerConfigured && !justConnected) {
    return <Navigate to="/connect" replace />;
  }

  return (
    <>
      <Outlet />
      <VersionDialog
        mode="update"
        open={updateReady.show}
        currentVersion={updateReady.version}
        newVersion={updateReady.version}
        onClose={dismissUpdate}
        onReload={() => void applyUpdate()}
      />
      <NativeUpdateRequiredDialog
        open={nativeUpdateRequired.show}
        version={nativeUpdateRequired.version}
        onClose={dismissNativeUpdateRequired}
      />
    </>
  );
}
