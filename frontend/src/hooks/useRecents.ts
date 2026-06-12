import { type UseQueryOptions, useMutation, useQuery } from "@tanstack/react-query";

import { recordCounterGroupViewApiV1CounterGroupsGroupIdViewPost } from "@/api/generated/counters/counters";
import { recordDocumentViewApiV1DocumentsDocumentIdViewPost } from "@/api/generated/documents/documents";
import type { RecentItemRead } from "@/api/generated/initiativeAPI.schemas";
import { recordProjectViewApiV1ProjectsProjectIdViewPost } from "@/api/generated/projects/projects";
import { recordQueueViewApiV1QueuesQueueIdViewPost } from "@/api/generated/queues/queues";
import {
  clearRecentApiV1RecentsEntityTypeEntityIdDelete,
  getListRecentsApiV1RecentsGetQueryKey,
  listRecentsApiV1RecentsGet,
} from "@/api/generated/recents/recents";
import { invalidateRecents } from "@/api/query-keys";

export type RecentEntityType = RecentItemRead["entity_type"];

type QueryOpts<TData> = Omit<UseQueryOptions<TData>, "queryKey" | "queryFn">;

/**
 * Fetches the up-to-20 mixed-type recent items for the header tabs bar.
 *
 * Replaces the previous projects-only ``useRecentProjects`` hook. Items come
 * back ordered by ``last_viewed_at`` desc with entity-specific metadata for
 * rendering icons (emoji for projects, document-type icons for documents).
 */
export const useRecents = (options?: QueryOpts<RecentItemRead[]>) => {
  return useQuery<RecentItemRead[]>({
    queryKey: getListRecentsApiV1RecentsGetQueryKey(),
    queryFn: () => listRecentsApiV1RecentsGet(),
    staleTime: 30 * 1000,
    ...options,
  });
};

const recorders: Record<RecentEntityType, (id: number) => Promise<unknown>> = {
  project: recordProjectViewApiV1ProjectsProjectIdViewPost,
  document: recordDocumentViewApiV1DocumentsDocumentIdViewPost,
  queue: recordQueueViewApiV1QueuesQueueIdViewPost,
  counter_group: recordCounterGroupViewApiV1CounterGroupsGroupIdViewPost,
};

/**
 * Mutation that POSTs ``/<entity>/{id}/view`` to record a recent open. Pages
 * call this in a ``useEffect`` once the entity has loaded and access checks
 * have passed.
 */
export const useRecordRecentView = (entityType: RecentEntityType) => {
  return useMutation({
    mutationFn: async (entityId: number) => {
      await recorders[entityType](entityId);
    },
    onSuccess: () => {
      void invalidateRecents();
    },
  });
};

/**
 * Mutation that DELETEs ``/recents/{type}/{id}?guild_id=`` (the X on a tab).
 *
 * Guild-ADDRESSED: a tab can belong to any of the user's guilds regardless of
 * the current context, and per-guild entity ids are only unique within their
 * guild, so the tab's ``guild_id`` travels with the call.
 */
export const useClearRecentView = () => {
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      guildId,
    }: {
      entityType: RecentEntityType;
      entityId: number;
      guildId: number;
    }) => {
      await clearRecentApiV1RecentsEntityTypeEntityIdDelete(entityType, entityId, {
        guild_id: guildId,
      });
    },
    onSuccess: () => {
      void invalidateRecents();
    },
  });
};
