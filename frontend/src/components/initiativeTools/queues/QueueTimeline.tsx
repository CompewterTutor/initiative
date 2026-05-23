import { useLayoutEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { QueueItemRead, QueueRead } from "@/api/generated/initiativeAPI.schemas";
import { QueueItemRow } from "@/components/initiativeTools/queues/QueueItemRow";
import { cn } from "@/lib/utils";
import { withViewTransition } from "@/lib/viewTransition";

interface QueueTimelineProps {
  queue: QueueRead;
  onEdit: (item: QueueItemRead) => void;
  onSetActive: (itemId: number) => void;
}

export type TimelineRow =
  | { kind: "item"; item: QueueItemRead; round: number }
  | { kind: "round-divider"; round: number }
  | { kind: "hidden-divider" }
  | { kind: "hidden-item"; item: QueueItemRead };

/**
 * Build the timeline display sequence:
 *
 * - **Visible rotation**: the next `N` visible items starting from the current
 *   item, wrapping around.
 * - **Round divider**: always emitted, either at the boundary inside the
 *   rotation (when the rotation wraps into the next round) or pinned to the
 *   end of the rotation as a preview of the next round. Pinning means the row
 *   count stays constant across turns — important for the View Transitions
 *   API, which morphs the divider's position smoothly instead of having it
 *   pop in/out at the round boundary.
 * - **Hidden items**: any items with `is_visible: false` are appended below a
 *   "Hidden" section divider so the user can still click them to edit (e.g.
 *   to toggle visibility back on) without leaving the On Deck view.
 *
 * When the queue isn't running the rotation degenerates to a static list and
 * the round divider is suppressed (the "rounds" concept doesn't apply yet).
 */
export const buildTimeline = (queue: QueueRead): TimelineRow[] => {
  const sortedAll = [...queue.items].sort((a, b) => b.position - a.position);
  const visible = sortedAll.filter((item) => item.is_visible);
  const hidden = sortedAll.filter((item) => !item.is_visible);

  const rows: TimelineRow[] = [];

  if (visible.length > 0) {
    const currentId = queue.current_item?.id ?? null;
    const foundIdx = currentId == null ? -1 : visible.findIndex((i) => i.id === currentId);
    const showWrap = queue.is_active && currentId != null;
    // When the queue isn't running we sort to default (position-desc) order
    // regardless of the saved `current_item_id`. Stopping shouldn't leave the
    // rows mid-rotation from the previous run.
    const startIdx = showWrap ? (foundIdx === -1 ? 0 : foundIdx) : 0;
    const startRound = showWrap ? queue.current_round : 1;

    let prevRound = startRound;
    let emittedDivider = false;
    for (let offset = 0; offset < visible.length; offset++) {
      const idx = (startIdx + offset) % visible.length;
      const wrapped = startIdx + offset >= visible.length;
      const round = wrapped && showWrap ? startRound + 1 : startRound;
      if (round !== prevRound) {
        rows.push({ kind: "round-divider", round });
        emittedDivider = true;
        prevRound = round;
      }
      rows.push({ kind: "item", item: visible[idx], round });
    }

    // Pin a round divider at the end if the rotation didn't already emit one,
    // so the row count is the same on every turn and the divider morphs in
    // place when the round changes instead of popping in and out.
    if (showWrap && !emittedDivider) {
      rows.push({ kind: "round-divider", round: startRound + 1 });
    }
  }

  if (hidden.length > 0) {
    rows.push({ kind: "hidden-divider" });
    for (const item of hidden) {
      rows.push({ kind: "hidden-item", item });
    }
  }

  return rows;
};

/**
 * Signature of the timeline-affecting fields of a queue. When this changes,
 * the rendered rows would move (or appear / disappear), so we want to wrap
 * the next render in a View Transition. When it doesn't (e.g. a label or
 * notes edit), we skip the transition to avoid a ~250 ms stall on every
 * irrelevant cache update.
 */
const timelineSignature = (queue: QueueRead): string => {
  const itemSig = queue.items
    .map((i) => `${i.id}:${i.position}:${i.is_visible ? "v" : "h"}`)
    .sort()
    .join(",");
  // When the queue isn't running the rendered rows don't depend on the saved
  // `current_item_id` or `current_round` (we sort to default order and skip
  // the current-turn highlight), so leaving them out of the signature avoids
  // a no-op transition stall on Reset-while-stopped or on the server-response
  // refetch after Stop reinstates the persisted current item.
  const rotation = queue.is_active
    ? `a|${queue.current_round}|${queue.current_item?.id ?? ""}`
    : "i";
  return `${rotation}|${itemSig}`;
};

export const QueueTimeline = ({ queue, onEdit, onSetActive }: QueueTimelineProps) => {
  const { t } = useTranslation("queues");

  // Mirror the upstream queue into local state so we control *when* the
  // timeline rows re-render. The hook's `onMutate` (local turn click) and
  // `useQueueRealtime`'s WebSocket-driven refetch (remote turn change) both
  // arrive here as a new `queue` prop; below we swap `displayQueue` inside
  // `withViewTransition` so the API morphs the row layout instead of
  // snapping. `useLayoutEffect` runs after commit but before paint, so the
  // API captures the just-committed (still-unpainted) OLD state and the
  // `flushSync` inside `withViewTransition` swaps to NEW before the browser
  // paints — no un-animated flash of either state.
  const [displayQueue, setDisplayQueue] = useState(queue);

  useLayoutEffect(() => {
    if (queue === displayQueue) return;
    if (timelineSignature(queue) === timelineSignature(displayQueue)) {
      // Something changed on the queue, but nothing the timeline shows would
      // move (e.g. an item label or notes edit). Sync without spending a
      // transition on a no-op animation.
      setDisplayQueue(queue);
      return;
    }
    withViewTransition(() => setDisplayQueue(queue));
  }, [queue, displayQueue]);

  const timeline = useMemo(() => buildTimeline(displayQueue), [displayQueue]);
  // Suppress the current-turn highlight while the queue isn't running so the
  // "Current Turn" badge doesn't stick around after Stop. The persisted
  // `current_item_id` is still useful to the backend (and to a future Start
  // that wants to resume), it just isn't a "current turn" while inactive.
  const currentId = displayQueue.is_active ? (displayQueue.current_item?.id ?? null) : null;

  if (timeline.length === 0) return null;

  return (
    <ol className="space-y-2">
      {timeline.map((row) => {
        if (row.kind === "round-divider") {
          return (
            <li
              // Stable key + view-transition-name lets the API morph the
              // divider between turn positions (and crossfade its label when
              // the round number changes) instead of treating each round as a
              // brand-new element that pops in.
              key="round-divider"
              className="flex items-center gap-3 px-2 py-1"
              style={{ viewTransitionName: "queue-round-divider" }}
            >
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {t("roundN", { count: row.round })}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </li>
          );
        }
        if (row.kind === "hidden-divider") {
          return (
            <li
              key="hidden-divider"
              className="flex items-center gap-3 px-2 pt-3 pb-1"
              style={{ viewTransitionName: "queue-hidden-divider" }}
            >
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {t("hidden")}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </li>
          );
        }
        const isVisibleRow = row.kind === "item";
        const item = row.item;
        return (
          <li
            // Item ids are unique across visible/hidden, so the same
            // view-transition-name in either section lets the API morph an
            // item that gets toggled between visible and hidden.
            key={`item-${item.id}`}
            className={cn(!isVisibleRow && "opacity-60")}
            style={{ viewTransitionName: `queue-item-${item.id}` }}
          >
            <QueueItemRow
              item={item}
              isActive={isVisibleRow && item.id === currentId}
              onEdit={onEdit}
              // Hidden items can't take a turn, but they remain editable —
              // double-clicking shouldn't try to set them active.
              onSetActive={isVisibleRow ? onSetActive : () => {}}
            />
          </li>
        );
      })}
    </ol>
  );
};
