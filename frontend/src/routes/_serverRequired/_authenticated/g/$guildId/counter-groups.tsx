import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

type CounterGroupsSearchParams = {
  create?: string;
  initiativeId?: string;
};

export const Route = createFileRoute("/_serverRequired/_authenticated/g/$guildId/counter-groups")({
  validateSearch: (search: Record<string, unknown>): CounterGroupsSearchParams => ({
    create: typeof search.create === "string" ? search.create : undefined,
    initiativeId: typeof search.initiativeId === "string" ? search.initiativeId : undefined,
  }),
  component: lazyRouteComponent(() =>
    import("@/pages/initiativeTools/counters/CounterGroupsPage").then((m) => ({
      default: m.CounterGroupsPage,
    }))
  ),
});
