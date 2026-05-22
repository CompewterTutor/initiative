import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_serverRequired/_authenticated/g/$guildId/counter-groups_/$groupId_/settings"
)({
  component: lazyRouteComponent(() =>
    import("@/pages/initiativeTools/counters/CounterGroupSettingsPage").then((m) => ({
      default: m.CounterGroupSettingsPage,
    }))
  ),
});
