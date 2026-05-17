import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import {
  type CellFmt,
  type CellStyle,
  type ColumnFmt,
  type NumberFormat,
  type RowFmt,
  type SpreadsheetFormatting,
  MAX_FROZEN,
  sanitizeCellFmt,
  sanitizeColumnFmt,
  sanitizeRowFmt,
} from "@/lib/spreadsheet/styles";

/**
 * Collaborative store for the spreadsheet's formatting structures
 * (schema v2): per-column, per-row, and per-cell style/format plus the
 * frozen-pane hint.
 *
 * Parallel to — deliberately not merged into —
 * ``useSpreadsheetCells.ts``. Cells are a hot path of scalar writes;
 * formatting is bursty struct writes. The two share the same ``yDoc``,
 * the same bootstrap/observer/transaction discipline, and (when collab
 * is off) the same plain-React-state fallback.
 *
 * When ``yDoc`` is non-null:
 *   - ``columns`` / ``rows`` / ``cellStyles`` live in same-named
 *     ``Y.Map``s; each value is a small plain JSON object replaced
 *     wholesale (no nested Y types — formatting entries are tiny and
 *     never deep-mutated, mirroring how ``cells`` stores scalars).
 *   - ``frozen`` lives in the existing ``"meta"`` map under
 *     ``"frozenRows"`` / ``"frozenCols"`` (sibling to the dimension
 *     keys ``useSpreadsheetCells`` owns).
 *
 * Mutators do a **read-merge-write** inside one ``yDoc.transact`` so a
 * concurrent edit to a *different* field of the same column/row isn't
 * clobbered (narrows the last-write-wins window to truly-concurrent
 * same-field edits).
 */
export interface SpreadsheetFormattingStore extends SpreadsheetFormatting {
  /** Merge a patch into a column entry. ``null`` deletes the entry.
   *  ``patch.style`` shallow-merges into the existing style; a style
   *  property set to ``undefined`` removes just that property. */
  updateColumn: (col: number, patch: ColumnPatch | null) => void;
  updateRow: (row: number, patch: RowPatch | null) => void;
  updateCell: (row: number, col: number, patch: CellPatch | null) => void;
  setFrozen: (next: { rows: number; cols: number }) => void;
  /** Run several mutators as one collaborative transaction / undo step.
   *  The per-mutator ``transact`` calls flatten into this outer one, so
   *  applying a style to a whole selection is a single broadcast. */
  batch: (fn: () => void) => void;
  /** Replace every formatting structure atomically (xlsx import). When
   *  collaborating this writes inside whatever transaction is already
   *  open, so the caller can wrap it together with the cell replace in
   *  a single ``yDoc.transact`` and peers never see a torn state. */
  replaceAll: (next: SpreadsheetFormatting) => void;
}

export interface ColumnPatch {
  width?: number;
  format?: NumberFormat | null;
  style?: Partial<CellStyle>;
}
export interface RowPatch {
  height?: number;
  style?: Partial<CellStyle>;
}
export interface CellPatch {
  format?: NumberFormat | null;
  style?: Partial<CellStyle>;
}

const Y_COLUMNS_KEY = "columns";
const Y_ROWS_KEY = "rows";
const Y_CELLSTYLES_KEY = "cellStyles";
const Y_META_KEY = "meta";
const META_FROZEN_ROWS = "frozenRows";
const META_FROZEN_COLS = "frozenCols";

type FmtRecord<T> = Record<string, T>;

const yMapToRecord = <T>(yMap: Y.Map<unknown>): FmtRecord<T> => {
  const out: FmtRecord<T> = {};
  yMap.forEach((value, key) => {
    if (value && typeof value === "object") out[key] = value as T;
  });
  return out;
};

const readFrozen = (
  yMeta: Y.Map<unknown>,
  fallback: { rows: number; cols: number }
): { rows: number; cols: number } => {
  const r = yMeta.get(META_FROZEN_ROWS);
  const c = yMeta.get(META_FROZEN_COLS);
  return {
    rows: typeof r === "number" && Number.isInteger(r) && r >= 0 ? r : fallback.rows,
    cols: typeof c === "number" && Number.isInteger(c) && c >= 0 ? c : fallback.cols,
  };
};

const clampFrozen = (value: number): number => Math.max(0, Math.min(Math.trunc(value), MAX_FROZEN));

/** Shallow-merge a style patch; ``undefined`` values remove their key. */
const mergeStyle = (
  base: CellStyle | undefined,
  patch: Partial<CellStyle> | undefined
): Record<string, unknown> | undefined => {
  if (patch === undefined) return base as Record<string, unknown> | undefined;
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  return merged;
};

const applyColumnPatch = (
  prev: ColumnFmt | undefined,
  patch: ColumnPatch
): ColumnFmt | undefined => {
  const draft: Record<string, unknown> = { ...(prev ?? {}) };
  if ("width" in patch) draft.width = patch.width;
  if ("format" in patch) {
    if (patch.format == null) delete draft.format;
    else draft.format = patch.format;
  }
  if ("style" in patch) draft.style = mergeStyle(prev?.style, patch.style);
  return sanitizeColumnFmt(draft);
};

const applyRowPatch = (prev: RowFmt | undefined, patch: RowPatch): RowFmt | undefined => {
  const draft: Record<string, unknown> = { ...(prev ?? {}) };
  if ("height" in patch) draft.height = patch.height;
  if ("style" in patch) draft.style = mergeStyle(prev?.style, patch.style);
  return sanitizeRowFmt(draft);
};

const applyCellPatch = (prev: CellFmt | undefined, patch: CellPatch): CellFmt | undefined => {
  const draft: Record<string, unknown> = { ...(prev ?? {}) };
  if ("format" in patch) {
    if (patch.format == null) delete draft.format;
    else draft.format = patch.format;
  }
  if ("style" in patch) draft.style = mergeStyle(prev?.style, patch.style);
  return sanitizeCellFmt(draft);
};

interface UseSpreadsheetFormattingArgs {
  yDoc: Y.Doc | null;
  initial: SpreadsheetFormatting;
}

export const useSpreadsheetFormatting = ({
  yDoc,
  initial,
}: UseSpreadsheetFormattingArgs): SpreadsheetFormattingStore => {
  const yColumns = useMemo(
    () => (yDoc ? (yDoc.getMap(Y_COLUMNS_KEY) as Y.Map<unknown>) : null),
    [yDoc]
  );
  const yRows = useMemo(() => (yDoc ? (yDoc.getMap(Y_ROWS_KEY) as Y.Map<unknown>) : null), [yDoc]);
  const yCellStyles = useMemo(
    () => (yDoc ? (yDoc.getMap(Y_CELLSTYLES_KEY) as Y.Map<unknown>) : null),
    [yDoc]
  );
  const yMeta = useMemo(() => (yDoc ? (yDoc.getMap(Y_META_KEY) as Y.Map<unknown>) : null), [yDoc]);

  const [columns, setColumns] = useState<FmtRecord<ColumnFmt>>(() =>
    yColumns && yColumns.size > 0 ? yMapToRecord<ColumnFmt>(yColumns) : { ...initial.columns }
  );
  const [rows, setRows] = useState<FmtRecord<RowFmt>>(() =>
    yRows && yRows.size > 0 ? yMapToRecord<RowFmt>(yRows) : { ...initial.rows }
  );
  const [cellStyles, setCellStyles] = useState<FmtRecord<CellFmt>>(() =>
    yCellStyles && yCellStyles.size > 0
      ? yMapToRecord<CellFmt>(yCellStyles)
      : { ...initial.cellStyles }
  );
  const [frozen, setFrozenState] = useState<{ rows: number; cols: number }>(() => {
    if (
      yMeta &&
      (yMeta.get(META_FROZEN_ROWS) !== undefined || yMeta.get(META_FROZEN_COLS) !== undefined)
    ) {
      return readFrozen(yMeta, initial.frozen);
    }
    return initial.frozen;
  });

  // One-shot bootstrap into a fresh Y.Doc. Keyed on the Y.Doc instance
  // (not a boolean) for the same reconnect-swap reason documented in
  // useSpreadsheetCells.ts: a provider reconnect swaps in a new empty
  // Y.Doc that must be re-seeded from ``initial``. If any structure is
  // already populated (yjs_state restore or a peer wrote first), adopt
  // it instead of seeding.
  const bootstrappedDocRef = useRef<Y.Doc | null>(null);
  useEffect(() => {
    if (!yDoc || !yColumns || !yRows || !yCellStyles || !yMeta) return;
    if (bootstrappedDocRef.current === yDoc) return;
    const populated =
      yColumns.size > 0 ||
      yRows.size > 0 ||
      yCellStyles.size > 0 ||
      yMeta.get(META_FROZEN_ROWS) !== undefined ||
      yMeta.get(META_FROZEN_COLS) !== undefined;
    if (populated) {
      setColumns(yMapToRecord<ColumnFmt>(yColumns));
      setRows(yMapToRecord<RowFmt>(yRows));
      setCellStyles(yMapToRecord<CellFmt>(yCellStyles));
      setFrozenState(readFrozen(yMeta, initial.frozen));
      bootstrappedDocRef.current = yDoc;
      return;
    }
    yDoc.transact(() => {
      for (const [k, v] of Object.entries(initial.columns)) yColumns.set(k, v);
      for (const [k, v] of Object.entries(initial.rows)) yRows.set(k, v);
      for (const [k, v] of Object.entries(initial.cellStyles)) yCellStyles.set(k, v);
      yMeta.set(META_FROZEN_ROWS, clampFrozen(initial.frozen.rows));
      yMeta.set(META_FROZEN_COLS, clampFrozen(initial.frozen.cols));
    }, "spreadsheet-fmt-bootstrap");
    bootstrappedDocRef.current = yDoc;
  }, [yDoc, yColumns, yRows, yCellStyles, yMeta, initial]);

  // Observers — rebuild a fresh Record (new identity) on every committed
  // change so the editor's snapshot-emit effect, which depends on these
  // references, fires exactly when something actually changed.
  useEffect(() => {
    if (!yColumns) return;
    const handler = () => setColumns(yMapToRecord<ColumnFmt>(yColumns));
    yColumns.observe(handler);
    return () => yColumns.unobserve(handler);
  }, [yColumns]);
  useEffect(() => {
    if (!yRows) return;
    const handler = () => setRows(yMapToRecord<RowFmt>(yRows));
    yRows.observe(handler);
    return () => yRows.unobserve(handler);
  }, [yRows]);
  useEffect(() => {
    if (!yCellStyles) return;
    const handler = () => setCellStyles(yMapToRecord<CellFmt>(yCellStyles));
    yCellStyles.observe(handler);
    return () => yCellStyles.unobserve(handler);
  }, [yCellStyles]);
  useEffect(() => {
    if (!yMeta) return;
    const handler = () =>
      setFrozenState((prev) => {
        const next = readFrozen(yMeta, prev);
        return next.rows === prev.rows && next.cols === prev.cols ? prev : next;
      });
    yMeta.observe(handler);
    return () => yMeta.unobserve(handler);
  }, [yMeta]);

  const updateColumn = useCallback(
    (col: number, patch: ColumnPatch | null) => {
      const key = String(col);
      if (yDoc && yColumns) {
        yDoc.transact(() => {
          if (patch === null) {
            yColumns.delete(key);
            return;
          }
          const next = applyColumnPatch(yColumns.get(key) as ColumnFmt, patch);
          if (next) yColumns.set(key, next);
          else yColumns.delete(key);
        }, "spreadsheet-fmt-edit");
        return;
      }
      setColumns((prev) => {
        const out = { ...prev };
        if (patch === null) delete out[key];
        else {
          const next = applyColumnPatch(prev[key], patch);
          if (next) out[key] = next;
          else delete out[key];
        }
        return out;
      });
    },
    [yDoc, yColumns]
  );

  const updateRow = useCallback(
    (row: number, patch: RowPatch | null) => {
      const key = String(row);
      if (yDoc && yRows) {
        yDoc.transact(() => {
          if (patch === null) {
            yRows.delete(key);
            return;
          }
          const next = applyRowPatch(yRows.get(key) as RowFmt, patch);
          if (next) yRows.set(key, next);
          else yRows.delete(key);
        }, "spreadsheet-fmt-edit");
        return;
      }
      setRows((prev) => {
        const out = { ...prev };
        if (patch === null) delete out[key];
        else {
          const next = applyRowPatch(prev[key], patch);
          if (next) out[key] = next;
          else delete out[key];
        }
        return out;
      });
    },
    [yDoc, yRows]
  );

  const updateCell = useCallback(
    (row: number, col: number, patch: CellPatch | null) => {
      const key = `${row}:${col}`;
      if (yDoc && yCellStyles) {
        yDoc.transact(() => {
          if (patch === null) {
            yCellStyles.delete(key);
            return;
          }
          const next = applyCellPatch(yCellStyles.get(key) as CellFmt, patch);
          if (next) yCellStyles.set(key, next);
          else yCellStyles.delete(key);
        }, "spreadsheet-fmt-edit");
        return;
      }
      setCellStyles((prev) => {
        const out = { ...prev };
        if (patch === null) delete out[key];
        else {
          const next = applyCellPatch(prev[key], patch);
          if (next) out[key] = next;
          else delete out[key];
        }
        return out;
      });
    },
    [yDoc, yCellStyles]
  );

  const setFrozen = useCallback(
    (next: { rows: number; cols: number }) => {
      const r = clampFrozen(next.rows);
      const c = clampFrozen(next.cols);
      if (yDoc && yMeta) {
        yDoc.transact(() => {
          yMeta.set(META_FROZEN_ROWS, r);
          yMeta.set(META_FROZEN_COLS, c);
        }, "spreadsheet-fmt-edit");
        return;
      }
      setFrozenState((prev) => (prev.rows === r && prev.cols === c ? prev : { rows: r, cols: c }));
    },
    [yDoc, yMeta]
  );

  const batch = useCallback(
    (fn: () => void) => {
      if (yDoc) yDoc.transact(fn, "spreadsheet-fmt-batch");
      else fn();
    },
    [yDoc]
  );

  const replaceAll = useCallback(
    (next: SpreadsheetFormatting) => {
      if (yDoc && yColumns && yRows && yCellStyles && yMeta) {
        // Nested ``transact`` is flattened by Yjs into whatever
        // transaction is already open, so the editor can wrap this and
        // the cell replaceAll in one outer transact for atomicity.
        yDoc.transact(() => {
          for (const k of Array.from(yColumns.keys())) yColumns.delete(k);
          for (const k of Array.from(yRows.keys())) yRows.delete(k);
          for (const k of Array.from(yCellStyles.keys())) yCellStyles.delete(k);
          for (const [k, v] of Object.entries(next.columns)) yColumns.set(k, v);
          for (const [k, v] of Object.entries(next.rows)) yRows.set(k, v);
          for (const [k, v] of Object.entries(next.cellStyles)) yCellStyles.set(k, v);
          yMeta.set(META_FROZEN_ROWS, clampFrozen(next.frozen.rows));
          yMeta.set(META_FROZEN_COLS, clampFrozen(next.frozen.cols));
        }, "spreadsheet-fmt-replace-all");
        return;
      }
      setColumns({ ...next.columns });
      setRows({ ...next.rows });
      setCellStyles({ ...next.cellStyles });
      setFrozenState({
        rows: clampFrozen(next.frozen.rows),
        cols: clampFrozen(next.frozen.cols),
      });
    },
    [yDoc, yColumns, yRows, yCellStyles, yMeta]
  );

  return {
    columns,
    rows,
    cellStyles,
    frozen,
    updateColumn,
    updateRow,
    updateCell,
    setFrozen,
    batch,
    replaceAll,
  };
};
