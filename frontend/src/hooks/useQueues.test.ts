import { describe, expect, it } from "vitest";

import { buildQueue, buildQueueItem } from "@/__tests__/factories";

import {
  advanceQueueState,
  previousQueueState,
  resetQueueState,
  setActiveItemState,
  startQueueState,
  stopQueueState,
} from "./useQueues";

/**
 * These pure transitions back the optimistic turn-control cache updates and
 * must stay in lockstep with `_visible_items_desc` + advance/previous in
 * `backend/app/services/queues.py`. The cases below pin the ordering (descending
 * by position, including fractional positions), hidden-item skipping, and the
 * wrap-around round increment/decrement.
 */
describe("queue turn transitions", () => {
  // Positions are intentionally out of insertion order; turn order is by
  // position DESC, so the sequence should be c (30) → a (20) → b (10).
  const a = buildQueueItem({ id: 1, label: "a", position: 20 });
  const b = buildQueueItem({ id: 2, label: "b", position: 10 });
  const c = buildQueueItem({ id: 3, label: "c", position: 30 });

  const activeQueue = buildQueue({
    is_active: true,
    current_round: 1,
    items: [a, b, c],
    current_item: c,
  });

  describe("advanceQueueState", () => {
    it("moves to the next-lower position", () => {
      const next = advanceQueueState(activeQueue);
      expect(next.current_item?.id).toBe(a.id);
      expect(next.current_round).toBe(1);
    });

    it("wraps from the last item to the first and bumps the round", () => {
      const atLast = { ...activeQueue, current_item: b };
      const next = advanceQueueState(atLast);
      expect(next.current_item?.id).toBe(c.id);
      expect(next.current_round).toBe(2);
    });

    it("orders fractional positions between equal integers", () => {
      const lo = buildQueueItem({ id: 10, label: "lo", position: 10 });
      const mid = buildQueueItem({ id: 11, label: "mid", position: 10.5 });
      const hi = buildQueueItem({ id: 12, label: "hi", position: 11 });
      const queue = buildQueue({
        is_active: true,
        items: [lo, hi, mid],
        current_item: hi,
      });
      // hi (11) → mid (10.5) → lo (10)
      const second = advanceQueueState(queue);
      expect(second.current_item?.id).toBe(mid.id);
      const third = advanceQueueState(second);
      expect(third.current_item?.id).toBe(lo.id);
    });

    it("skips hidden items", () => {
      const hidden = { ...a, is_visible: false };
      const queue = buildQueue({
        is_active: true,
        items: [hidden, b, c],
        current_item: c,
      });
      // c (30) → b (10), skipping hidden a (20)
      const next = advanceQueueState(queue);
      expect(next.current_item?.id).toBe(b.id);
    });
  });

  describe("previousQueueState", () => {
    it("moves to the next-higher position", () => {
      const atA = { ...activeQueue, current_item: a };
      const prev = previousQueueState(atA);
      expect(prev.current_item?.id).toBe(c.id);
    });

    it("wraps from the first item to the last and decrements the round (min 1)", () => {
      const atFirstRound2 = { ...activeQueue, current_item: c, current_round: 2 };
      const prev = previousQueueState(atFirstRound2);
      expect(prev.current_item?.id).toBe(b.id);
      expect(prev.current_round).toBe(1);
    });

    it("never drops the round below 1", () => {
      const prev = previousQueueState({ ...activeQueue, current_item: c, current_round: 1 });
      expect(prev.current_round).toBe(1);
    });
  });

  describe("start / stop / reset", () => {
    it("start activates, selects the highest position, and resets the round", () => {
      const idle = buildQueue({ is_active: false, current_round: 5, items: [a, b, c] });
      const started = startQueueState(idle);
      expect(started.is_active).toBe(true);
      expect(started.current_item?.id).toBe(c.id);
      expect(started.current_round).toBe(1);
    });

    it("stop deactivates but keeps the current item", () => {
      const stopped = stopQueueState(activeQueue);
      expect(stopped.is_active).toBe(false);
      expect(stopped.current_item?.id).toBe(c.id);
    });

    it("reset returns to the highest position and round 1", () => {
      const mid = { ...activeQueue, current_item: b, current_round: 4 };
      const reset = resetQueueState(mid);
      expect(reset.current_item?.id).toBe(c.id);
      expect(reset.current_round).toBe(1);
    });
  });

  describe("setActiveItemState", () => {
    it("selects the requested item", () => {
      const result = setActiveItemState(activeQueue, a.id);
      expect(result.current_item?.id).toBe(a.id);
    });

    it("leaves the queue unchanged for an unknown item", () => {
      const result = setActiveItemState(activeQueue, 9999);
      expect(result).toBe(activeQueue);
    });
  });

  it("leaves an empty queue untouched", () => {
    const empty = buildQueue({ is_active: true, items: [], current_item: null });
    expect(advanceQueueState(empty)).toBe(empty);
    expect(previousQueueState(empty)).toBe(empty);
    expect(startQueueState(empty)).toBe(empty);
    expect(resetQueueState(empty)).toBe(empty);
  });
});
