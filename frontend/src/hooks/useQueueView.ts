import { useCallback, useEffect, useState } from "react";

import { getItem, setItem } from "@/lib/storage";

export type QueueView = "list" | "on-deck";

const STORAGE_PREFIX = "queues.view";

const storageKey = (queueId: number): string => `${STORAGE_PREFIX}.${queueId}`;

const isQueueView = (value: string | null): value is QueueView =>
  value === "list" || value === "on-deck";

const readStoredView = (queueId: number): QueueView => {
  const stored = getItem(storageKey(queueId));
  return isQueueView(stored) ? stored : "on-deck";
};

/**
 * Per-queue view preference, persisted via the storage abstraction
 * (`@/lib/storage`) so it survives reloads on web and is durable on native.
 *
 * Keyed by queue id so different queues can have different default views.
 */
export function useQueueView(queueId: number): readonly [QueueView, (view: QueueView) => void] {
  const [view, setViewState] = useState<QueueView>(() => readStoredView(queueId));

  // Re-hydrate when navigating between queue detail pages.
  useEffect(() => {
    setViewState(readStoredView(queueId));
  }, [queueId]);

  const setView = useCallback(
    (next: QueueView) => {
      setViewState(next);
      setItem(storageKey(queueId), next);
    },
    [queueId]
  );

  return [view, setView] as const;
}
