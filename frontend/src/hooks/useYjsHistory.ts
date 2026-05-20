import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

/**
 * Generic, editor-agnostic per-session undo/redo for any Yjs-backed
 * editor.
 *
 * Reuse contract: a document editor whose state lives in a `Y.Doc`
 * gets per-session, per-user undo/redo by calling {@link useYjsHistory}
 * with (1) its doc, (2) the shared types to scope, and (3) the
 * transaction origins that represent *user* actions. Omit any
 * bootstrap/seed origins from `trackedOrigins` so initial hydration is
 * never undoable. Remote peers' changes are never in this client's
 * stack — `Y.UndoManager` already scopes undo to locally-tracked
 * transactions, which is exactly "per session" behavior.
 *
 * This wraps `Y.UndoManager` (the same primitive the Lexical Yjs
 * binding uses); it does not reimplement a command stack.
 */

export interface YjsHistoryOptions {
  /** The doc to track. `null` → the hook is a disabled no-op. */
  doc: Y.Doc | null;
  /**
   * Shared types to track, resolved from the *current* doc so a doc
   * swap (e.g. local fallback → collab provider) rebuilds the scope.
   * Return the same shared types the editor mutates, e.g.
   * `(d) => [d.getMap("cells"), d.getMap("meta")]`. The element type
   * mirrors yjs's own `UndoManager` scope signature.
   */
  getScope: (doc: Y.Doc) => Y.AbstractType<any>[];
  /**
   * Transaction origins (as passed to `doc.transact(fn, origin)`) that
   * count as undoable user actions. Forwarded to `Y.UndoManager`'s
   * `trackedOrigins`. Exclude seed/bootstrap origins.
   */
  trackedOrigins: Iterable<unknown>;
  /**
   * Group rapid transactions within this many ms into one undo step.
   * Default `0` → every transaction is its own discrete step
   * (spreadsheet/Excel-like one-action-per-undo).
   */
  captureTimeout?: number;
}

export interface YjsHistory {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Drop both stacks (e.g. on an explicit reset). */
  clear: () => void;
}

/**
 * Build a `Y.UndoManager` for `doc`. Pure (no React) so it can be
 * unit-tested directly. Returns `null` when `doc` is `null` or the
 * scope is empty.
 */
export const createYjsUndoManager = (
  doc: Y.Doc | null,
  opts: Omit<YjsHistoryOptions, "doc">
): Y.UndoManager | null => {
  if (!doc) return null;
  const scope = opts.getScope(doc);
  if (scope.length === 0) return null;
  return new Y.UndoManager(scope, {
    captureTimeout: opts.captureTimeout ?? 0,
    trackedOrigins: new Set(opts.trackedOrigins),
  });
};

/** App-wide undo/redo shortcut convention: `mod+Z` undo,
 *  `mod+Shift+Z` / `mod+Y` redo. Returns the verb or `null` so every
 *  editor wires keys identically without re-deriving the rule. */
export const matchHistoryShortcut = (e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): "undo" | "redo" | null => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
};

// ``navigator.platform`` is deprecated; ``userAgent`` is not and is
// sufficient for a keyboard-hint heuristic (Macintosh / iPhone / iPad /
// iPod all appear there).
const IS_APPLE =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** Human-readable, platform-aware shortcut hints for tooltips — same
 *  convention as the Lexical history toolbar (`⌘Z` on Apple, `Ctrl+Z`
 *  elsewhere). Reusable by any editor's undo/redo affordances. */
export const HISTORY_SHORTCUT = {
  undo: IS_APPLE ? "⌘Z" : "Ctrl+Z",
  redo: IS_APPLE ? "⇧⌘Z" : "Ctrl+Y",
} as const;

export const useYjsHistory = ({
  doc,
  getScope,
  trackedOrigins,
  captureTimeout,
}: YjsHistoryOptions): YjsHistory => {
  // Capture config in refs so callers can pass inline closures / arrays
  // without forcing the manager to be rebuilt — it is rebuilt only when
  // the doc *instance* changes.
  const getScopeRef = useRef(getScope);
  const trackedRef = useRef(trackedOrigins);
  const timeoutRef = useRef(captureTimeout);
  useEffect(() => {
    getScopeRef.current = getScope;
    trackedRef.current = trackedOrigins;
    timeoutRef.current = captureTimeout;
  });

  const manager = useMemo(
    () =>
      createYjsUndoManager(doc, {
        getScope: (d) => getScopeRef.current(d),
        trackedOrigins: trackedRef.current,
        captureTimeout: timeoutRef.current,
      }),
    [doc]
  );

  const [state, setState] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    if (!manager) {
      setState({ canUndo: false, canRedo: false });
      return;
    }
    const sync = () =>
      setState({
        canUndo: manager.undoStack.length > 0,
        canRedo: manager.redoStack.length > 0,
      });
    sync();
    manager.on("stack-item-added", sync);
    manager.on("stack-item-popped", sync);
    manager.on("stack-cleared", sync);
    return () => {
      // destroy() detaches all listeners and stops tracking; safe even
      // if the doc is being torn down.
      manager.destroy();
    };
  }, [manager]);

  const undo = useCallback(() => manager?.undo(), [manager]);
  const redo = useCallback(() => manager?.redo(), [manager]);
  const clear = useCallback(() => manager?.clear(), [manager]);

  return { undo, redo, canUndo: state.canUndo, canRedo: state.canRedo, clear };
};
