import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/_serverRequired/_authenticated/settings/platform")({
  component: lazyRouteComponent(() =>
    import("@/pages/PlatformSettingsLayout").then((m) => ({ default: m.PlatformSettingsLayout }))
  ),
});
