import {
  keepPreviousData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type {
  ListQueuesApiV1QueuesGetParams,
  QueueCreate,
  QueueItemCreate,
  QueueItemRead,
  QueueItemReorderRequest,
  QueueItemUpdate,
  QueueListResponse,
  QueuePermissionCreate,
  QueuePermissionRead,
  QueueRead,
  QueueRolePermissionCreate,
  QueueRolePermissionRead,
  QueueUpdate,
} from "@/api/generated/initiativeAPI.schemas";
import {
  addQueueItemApiV1QueuesQueueIdItemsPost,
  advanceTurnApiV1QueuesQueueIdNextPost,
  createQueueApiV1QueuesPost,
  deleteQueueApiV1QueuesQueueIdDelete,
  deleteQueueItemApiV1QueuesQueueIdItemsItemIdDelete,
  getListQueuesApiV1QueuesGetQueryKey,
  getReadQueueApiV1QueuesQueueIdGetQueryKey,
  listQueuesApiV1QueuesGet,
  previousTurnApiV1QueuesQueueIdPreviousPost,
  readQueueApiV1QueuesQueueIdGet,
  reorderQueueItemsApiV1QueuesQueueIdItemsReorderPut,
  resetQueueApiV1QueuesQueueIdResetPost,
  setActiveItemApiV1QueuesQueueIdSetActiveItemIdPost,
  setQueueItemDocumentsApiV1QueuesQueueIdItemsItemIdDocumentsPut,
  setQueueItemTagsApiV1QueuesQueueIdItemsItemIdTagsPut,
  setQueueItemTasksApiV1QueuesQueueIdItemsItemIdTasksPut,
  setQueuePermissionsApiV1QueuesQueueIdPermissionsPut,
  setQueueRolePermissionsApiV1QueuesQueueIdRolePermissionsPut,
  startQueueApiV1QueuesQueueIdStartPost,
  stopQueueApiV1QueuesQueueIdStopPost,
  updateQueueApiV1QueuesQueueIdPatch,
  updateQueueItemApiV1QueuesQueueIdItemsItemIdPatch,
} from "@/api/generated/queues/queues";
import { invalidateAllQueues, invalidateQueue } from "@/api/query-keys";
import { toast } from "@/lib/chesterToast";
import type { MutationOpts } from "@/types/mutation";
import type { QueryOpts } from "@/types/query";

// ── Queries ─────────────────────────────────────────────────────────────────

export const useQueuesList = (
  params: ListQueuesApiV1QueuesGetParams,
  options?: QueryOpts<QueueListResponse>
) => {
  return useQuery<QueueListResponse>({
    queryKey: getListQueuesApiV1QueuesGetQueryKey(params),
    queryFn: () => listQueuesApiV1QueuesGet(params) as unknown as Promise<QueueListResponse>,
    placeholderData: keepPreviousData,
    ...options,
  });
};

export const useQueue = (queueId: number | null, options?: QueryOpts<QueueRead>) => {
  const { enabled: userEnabled = true, ...rest } = options ?? {};
  return useQuery<QueueRead>({
    queryKey: getReadQueueApiV1QueuesQueueIdGetQueryKey(queueId!),
    queryFn: () => readQueueApiV1QueuesQueueIdGet(queueId!) as unknown as Promise<QueueRead>,
    enabled: queueId !== null && Number.isFinite(queueId) && userEnabled,
    ...rest,
  });
};

// ── Mutations ───────────────────────────────────────────────────────────────

export const useCreateQueue = (options?: MutationOpts<QueueRead, QueueCreate>) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async (data: QueueCreate) => {
      return createQueueApiV1QueuesPost(data) as unknown as Promise<QueueRead>;
    },
    onSuccess: (...args) => {
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

export const useUpdateQueue = (queueId: number, options?: MutationOpts<QueueRead, QueueUpdate>) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async (data: QueueUpdate) => {
      return updateQueueApiV1QueuesQueueIdPatch(queueId, data) as unknown as Promise<QueueRead>;
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

export const useDeleteQueue = (options?: MutationOpts<void, number>) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async (queueId: number) => {
      await deleteQueueApiV1QueuesQueueIdDelete(queueId);
    },
    onSuccess: (...args) => {
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

// ── Item Mutations ──────────────────────────────────────────────────────────

export const useCreateQueueItem = (
  queueId: number,
  options?: MutationOpts<QueueItemRead, QueueItemCreate>
) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async (data: QueueItemCreate) => {
      return addQueueItemApiV1QueuesQueueIdItemsPost(
        queueId,
        data
      ) as unknown as Promise<QueueItemRead>;
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

export const useUpdateQueueItem = (
  queueId: number,
  options?: MutationOpts<QueueItemRead, { itemId: number; data: QueueItemUpdate }>
) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async ({ itemId, data }: { itemId: number; data: QueueItemUpdate }) => {
      return updateQueueItemApiV1QueuesQueueIdItemsItemIdPatch(
        queueId,
        itemId,
        data
      ) as unknown as Promise<QueueItemRead>;
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

export const useDeleteQueueItem = (queueId: number, options?: MutationOpts<void, number>) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async (itemId: number) => {
      await deleteQueueItemApiV1QueuesQueueIdItemsItemIdDelete(queueId, itemId);
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

export const useReorderQueueItems = (
  queueId: number,
  options?: MutationOpts<QueueRead, QueueItemReorderRequest>
) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async (data: QueueItemReorderRequest) => {
      return reorderQueueItemsApiV1QueuesQueueIdItemsReorderPut(
        queueId,
        data
      ) as unknown as Promise<QueueRead>;
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

// ── Turn Control Mutations ──────────────────────────────────────────────────
//
// Turn changes are applied optimistically: the displayed current item and round
// update instantly in the cache, then reconcile with the server on settle (and
// via the queue WebSocket). The transition logic below mirrors
// `_visible_items_desc` + advance/previous in `backend/app/services/queues.py`;
// keep the two in sync.

type QueueTurnContext = { previous?: QueueRead };

/** Visible items sorted by position descending (highest first), like the backend. */
const visibleItemsDesc = (queue: QueueRead): QueueItemRead[] =>
  queue.items.filter((item) => item.is_visible).sort((a, b) => b.position - a.position);

/** Index of the current item within the visible list, or null if absent. */
const currentVisibleIndex = (queue: QueueRead, visible: QueueItemRead[]): number | null => {
  const id = queue.current_item?.id;
  if (id == null) return null;
  const idx = visible.findIndex((item) => item.id === id);
  return idx === -1 ? null : idx;
};

export const advanceQueueState = (queue: QueueRead): QueueRead => {
  const visible = visibleItemsDesc(queue);
  if (visible.length === 0) return queue;
  const idx = currentVisibleIndex(queue, visible);
  if (idx === null || idx >= visible.length - 1) {
    // Not found or at end — wrap to first item and bump the round.
    return { ...queue, current_item: visible[0], current_round: queue.current_round + 1 };
  }
  return { ...queue, current_item: visible[idx + 1] };
};

export const previousQueueState = (queue: QueueRead): QueueRead => {
  const visible = visibleItemsDesc(queue);
  if (visible.length === 0) return queue;
  const idx = currentVisibleIndex(queue, visible);
  if (idx === null || idx <= 0) {
    // Not found or at start — wrap to last item and drop the round (min 1).
    return {
      ...queue,
      current_item: visible[visible.length - 1],
      current_round: Math.max(1, queue.current_round - 1),
    };
  }
  return { ...queue, current_item: visible[idx - 1] };
};

export const startQueueState = (queue: QueueRead): QueueRead => {
  const visible = visibleItemsDesc(queue);
  if (visible.length === 0) return queue;
  return { ...queue, is_active: true, current_item: visible[0], current_round: 1 };
};

export const stopQueueState = (queue: QueueRead): QueueRead => ({ ...queue, is_active: false });

export const resetQueueState = (queue: QueueRead): QueueRead => {
  const visible = visibleItemsDesc(queue);
  if (visible.length === 0) return queue;
  return { ...queue, current_round: 1, current_item: visible[0] };
};

export const setActiveItemState = (queue: QueueRead, itemId: number): QueueRead => {
  const item = queue.items.find((i) => i.id === itemId);
  return item ? { ...queue, current_item: item } : queue;
};

/** Snapshot + optimistically apply a turn transition to the cached queue. */
const applyOptimisticTurn = async (
  queryClient: QueryClient,
  queueId: number,
  apply: (queue: QueueRead) => QueueRead
): Promise<QueueTurnContext> => {
  const key = getReadQueueApiV1QueuesQueueIdGetQueryKey(queueId);
  // Cancel in-flight refetches so they don't clobber the optimistic value.
  await queryClient.cancelQueries({ queryKey: key });
  const previous = queryClient.getQueryData<QueueRead>(key);
  if (previous) {
    queryClient.setQueryData<QueueRead>(key, apply(previous));
  }
  return { previous };
};

/** Restore the pre-mutation queue snapshot after a failed turn change. */
const rollbackOptimisticTurn = (
  queryClient: QueryClient,
  queueId: number,
  context: QueueTurnContext | undefined
) => {
  if (context?.previous) {
    queryClient.setQueryData(getReadQueueApiV1QueuesQueueIdGetQueryKey(queueId), context.previous);
  }
};

export const useAdvanceTurn = (queueId: number, options?: MutationOpts<QueueRead, void>) => {
  const { t } = useTranslation("queues");
  const queryClient = useQueryClient();
  const { onSuccess, onError, onSettled, onMutate: _ignored, ...rest } = options ?? {};

  return useMutation<QueueRead, Error, void, QueueTurnContext>({
    ...rest,
    mutationFn: async () => {
      return advanceTurnApiV1QueuesQueueIdNextPost(queueId) as unknown as Promise<QueueRead>;
    },
    onMutate: () => applyOptimisticTurn(queryClient, queueId, advanceQueueState),
    onSuccess,
    onError: (err, vars, onMutateResult, context) => {
      rollbackOptimisticTurn(queryClient, queueId, onMutateResult);
      toast.error(t("error"));
      onError?.(err, vars, onMutateResult, context);
    },
    onSettled: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSettled?.(...args);
    },
  });
};

export const usePreviousTurn = (queueId: number, options?: MutationOpts<QueueRead, void>) => {
  const { t } = useTranslation("queues");
  const queryClient = useQueryClient();
  const { onSuccess, onError, onSettled, onMutate: _ignored, ...rest } = options ?? {};

  return useMutation<QueueRead, Error, void, QueueTurnContext>({
    ...rest,
    mutationFn: async () => {
      return previousTurnApiV1QueuesQueueIdPreviousPost(queueId) as unknown as Promise<QueueRead>;
    },
    onMutate: () => applyOptimisticTurn(queryClient, queueId, previousQueueState),
    onSuccess,
    onError: (err, vars, onMutateResult, context) => {
      rollbackOptimisticTurn(queryClient, queueId, onMutateResult);
      toast.error(t("error"));
      onError?.(err, vars, onMutateResult, context);
    },
    onSettled: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSettled?.(...args);
    },
  });
};

export const useStartQueue = (queueId: number, options?: MutationOpts<QueueRead, void>) => {
  const { t } = useTranslation("queues");
  const queryClient = useQueryClient();
  const { onSuccess, onError, onSettled, onMutate: _ignored, ...rest } = options ?? {};

  return useMutation<QueueRead, Error, void, QueueTurnContext>({
    ...rest,
    mutationFn: async () => {
      return startQueueApiV1QueuesQueueIdStartPost(queueId) as unknown as Promise<QueueRead>;
    },
    onMutate: () => applyOptimisticTurn(queryClient, queueId, startQueueState),
    onSuccess,
    onError: (err, vars, onMutateResult, context) => {
      rollbackOptimisticTurn(queryClient, queueId, onMutateResult);
      toast.error(t("error"));
      onError?.(err, vars, onMutateResult, context);
    },
    onSettled: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSettled?.(...args);
    },
  });
};

export const useStopQueue = (queueId: number, options?: MutationOpts<QueueRead, void>) => {
  const { t } = useTranslation("queues");
  const queryClient = useQueryClient();
  const { onSuccess, onError, onSettled, onMutate: _ignored, ...rest } = options ?? {};

  return useMutation<QueueRead, Error, void, QueueTurnContext>({
    ...rest,
    mutationFn: async () => {
      return stopQueueApiV1QueuesQueueIdStopPost(queueId) as unknown as Promise<QueueRead>;
    },
    onMutate: () => applyOptimisticTurn(queryClient, queueId, stopQueueState),
    onSuccess,
    onError: (err, vars, onMutateResult, context) => {
      rollbackOptimisticTurn(queryClient, queueId, onMutateResult);
      toast.error(t("error"));
      onError?.(err, vars, onMutateResult, context);
    },
    onSettled: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSettled?.(...args);
    },
  });
};

export const useResetQueue = (queueId: number, options?: MutationOpts<QueueRead, void>) => {
  const { t } = useTranslation("queues");
  const queryClient = useQueryClient();
  const { onSuccess, onError, onSettled, onMutate: _ignored, ...rest } = options ?? {};

  return useMutation<QueueRead, Error, void, QueueTurnContext>({
    ...rest,
    mutationFn: async () => {
      return resetQueueApiV1QueuesQueueIdResetPost(queueId) as unknown as Promise<QueueRead>;
    },
    onMutate: () => applyOptimisticTurn(queryClient, queueId, resetQueueState),
    onSuccess,
    onError: (err, vars, onMutateResult, context) => {
      rollbackOptimisticTurn(queryClient, queueId, onMutateResult);
      toast.error(t("error"));
      onError?.(err, vars, onMutateResult, context);
    },
    onSettled: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSettled?.(...args);
    },
  });
};

export const useSetActiveItem = (queueId: number, options?: MutationOpts<QueueRead, number>) => {
  const { t } = useTranslation("queues");
  const queryClient = useQueryClient();
  const { onSuccess, onError, onSettled, onMutate: _ignored, ...rest } = options ?? {};

  return useMutation<QueueRead, Error, number, QueueTurnContext>({
    ...rest,
    mutationFn: async (itemId: number) => {
      return setActiveItemApiV1QueuesQueueIdSetActiveItemIdPost(
        queueId,
        itemId
      ) as unknown as Promise<QueueRead>;
    },
    onMutate: (itemId) =>
      applyOptimisticTurn(queryClient, queueId, (queue) => setActiveItemState(queue, itemId)),
    onSuccess,
    onError: (err, vars, onMutateResult, context) => {
      rollbackOptimisticTurn(queryClient, queueId, onMutateResult);
      toast.error(t("error"));
      onError?.(err, vars, onMutateResult, context);
    },
    onSettled: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSettled?.(...args);
    },
  });
};

// ── Item Association Mutations ──────────────────────────────────────────────

export const useSetQueueItemTags = (
  queueId: number,
  options?: MutationOpts<QueueItemRead, { itemId: number; tagIds: number[] }>
) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async ({ itemId, tagIds }: { itemId: number; tagIds: number[] }) => {
      return setQueueItemTagsApiV1QueuesQueueIdItemsItemIdTagsPut(
        queueId,
        itemId,
        tagIds
      ) as unknown as Promise<QueueItemRead>;
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

export const useSetQueueItemDocuments = (
  queueId: number,
  options?: MutationOpts<QueueItemRead, { itemId: number; documentIds: number[] }>
) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async ({ itemId, documentIds }: { itemId: number; documentIds: number[] }) => {
      return setQueueItemDocumentsApiV1QueuesQueueIdItemsItemIdDocumentsPut(
        queueId,
        itemId,
        documentIds
      ) as unknown as Promise<QueueItemRead>;
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

export const useSetQueueItemTasks = (
  queueId: number,
  options?: MutationOpts<QueueItemRead, { itemId: number; taskIds: number[] }>
) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async ({ itemId, taskIds }: { itemId: number; taskIds: number[] }) => {
      return setQueueItemTasksApiV1QueuesQueueIdItemsItemIdTasksPut(
        queueId,
        itemId,
        taskIds
      ) as unknown as Promise<QueueItemRead>;
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

// ── Permission Mutations ────────────────────────────────────────────────────

export const useSetQueuePermissions = (
  queueId: number,
  options?: MutationOpts<QueuePermissionRead[], QueuePermissionCreate[]>
) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async (data: QueuePermissionCreate[]) => {
      return setQueuePermissionsApiV1QueuesQueueIdPermissionsPut(
        queueId,
        data
      ) as unknown as Promise<QueuePermissionRead[]>;
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};

export const useSetQueueRolePermissions = (
  queueId: number,
  options?: MutationOpts<QueueRolePermissionRead[], QueueRolePermissionCreate[]>
) => {
  const { t } = useTranslation("queues");
  const { onSuccess, onError, onSettled, ...rest } = options ?? {};

  return useMutation({
    ...rest,
    mutationFn: async (data: QueueRolePermissionCreate[]) => {
      return setQueueRolePermissionsApiV1QueuesQueueIdRolePermissionsPut(
        queueId,
        data
      ) as unknown as Promise<QueueRolePermissionRead[]>;
    },
    onSuccess: (...args) => {
      void invalidateQueue(queueId);
      void invalidateAllQueues();
      onSuccess?.(...args);
    },
    onError: (...args) => {
      toast.error(t("error"));
      onError?.(...args);
    },
    onSettled,
  });
};
