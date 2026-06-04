/**
 * Structural row / column insert & delete for spreadsheet documents.
 *
 * Like ``sort.ts``, the logic is pure (no Yjs / React) so it can be
 * unit-tested and then applied by the editor inside a single
 * collaborative transaction. Inserting or deleting a line shifts every
 * downstream line by ``count``, remapping all four index-keyed
 * structures — cells, per-cell styles, per-column and per-row
 * formatting — plus the frozen-pane hint and the grid dimensions, so the
 * sheet stays internally consistent.
 *
 * The shift is a bijection on the affected lines (insert pushes one
 * direction; delete drops a band then pulls the rest in), so no two
 * source keys can ever collide on a target key.
 */

import { type CellValue, keyOf, parseKey } from "@/lib/spreadsheet/coords";
import { isFormula, shiftFormulaReferences } from "@/lib/spreadsheet/formula-refs";
import type { CellFmt, ColumnFmt, RowFmt } from "@/lib/spreadsheet/styles";

export type LineAxis = "row" | "col";
export type LineMode = "insert" | "delete";

/** Read-only snapshot of every structure a transform touches. */
export interface SheetStructures {
  cells: ReadonlyMap<string, CellValue> | Record<string, CellValue>;
  cellStyles: Record<string, CellFmt>;
  columns: Record<string, ColumnFmt>;
  rows: Record<string, RowFmt>;
  frozen: { rows: number; cols: number };
  dimensions: { rows: number; cols: number };
}

export interface TransformResult {
  cells: Record<string, CellValue>;
  cellStyles: Record<string, CellFmt>;
  columns: Record<string, ColumnFmt>;
  rows: Record<string, RowFmt>;
  frozen: { rows: number; cols: number };
  dimensions: { rows: number; cols: number };
  /** True when fewer lines than requested were applied — the op partly
   *  succeeded but a guard capped it (delete left the last line standing,
   *  or insert hit the grid cap with room for only some). Lets the caller
   *  surface a hint so the leftover line / missing inserts aren't a silent
   *  mystery. A full no-op returns ``null`` instead. */
  capped: boolean;
}

export interface LineOp {
  axis: LineAxis;
  mode: LineMode;
  /** Insert: new lines occupy ``[at, at + count)``, pushing ``at`` and
   *  everything after it down. Delete: lines ``[at, at + count)`` are
   *  removed and the rest pulled in. */
  at: number;
  count: number;
  /** Hard grid caps — insertion is clamped so dimensions never exceed
   *  these (matching the editor's MAX_ROWS / MAX_COLS). */
  maxRows: number;
  maxCols: number;
}

/** Always keep at least one line on each axis — a 0×n sheet is unusable. */
const MIN_LINES = 1;

/**
 * Apply a single row/column insert or delete, returning fully-remapped
 * copies of every structure. The caller applies the result atomically
 * (one Yjs transaction = one undo step), exactly like the sort path.
 *
 * Returns ``null`` for a no-op (count clamped to zero, grid at capacity,
 * or the last-line guard). The caller discards a no-op anyway, so a null
 * sentinel avoids copying the (potentially thousands of) cells just to
 * throw the copy away.
 */
export const transformSheet = (s: SheetStructures, op: LineOp): TransformResult | null => {
  const axisIsRow = op.axis === "row";
  const currentDim = axisIsRow ? s.dimensions.rows : s.dimensions.cols;
  const maxDim = axisIsRow ? op.maxRows : op.maxCols;
  const frozen = axisIsRow ? s.frozen.rows : s.frozen.cols;
  const at = Math.max(0, Math.trunc(op.at));

  const requested = Math.max(0, Math.trunc(op.count));
  if (requested === 0) return null;
  let count = requested;

  // Build the old-index -> new-index mapper (null = the line is deleted)
  // and the post-op axis dimension + frozen count.
  let mapIndex: (i: number) => number | null;
  let newDim: number;
  let newFrozen = frozen;

  if (op.mode === "insert") {
    // Never grow past the hard cap.
    count = Math.min(count, Math.max(0, maxDim - currentDim));
    if (count === 0) return null;
    mapIndex = (i) => (i < at ? i : i + count);
    newDim = currentDim + count;
    // Lines inserted inside the frozen band extend it (Excel behaviour).
    if (at < frozen) newFrozen = frozen + count;
  } else {
    // Delete: clamp to the lines that actually exist and keep >= 1 line.
    count = Math.min(count, currentDim - at);
    count = Math.min(count, currentDim - MIN_LINES);
    if (count <= 0) return null;
    const end = at + count; // exclusive
    mapIndex = (i) => (i < at ? i : i >= end ? i - count : null);
    newDim = currentDim - count;
    // Shrink frozen by the part of the deleted band that fell inside it.
    newFrozen = frozen - Math.max(0, Math.min(end, frozen) - at);
  }

  // Remap a "r:c"-keyed structure along the active axis only. ``mapValue``
  // (used only for the cell map) rewrites the value itself — formulas need
  // their A1 references shifted by the same mapper that moves the keys, so
  // ``=A5`` keeps pointing at the same data after an insert/delete.
  const remapCellKeys = <T>(
    src: ReadonlyMap<string, T> | Record<string, T>,
    mapValue?: (value: T) => T
  ): Record<string, T> => {
    const out: Record<string, T> = {};
    const entries = src instanceof Map ? src.entries() : Object.entries(src);
    for (const [key, value] of entries) {
      const mapped2 = mapValue ? mapValue(value) : value;
      const p = parseKey(key);
      if (!p) {
        out[key] = mapped2;
        continue;
      }
      const [r, c] = p;
      const mapped = mapIndex(axisIsRow ? r : c);
      if (mapped === null) continue; // line was deleted
      out[keyOf(axisIsRow ? mapped : r, axisIsRow ? c : mapped)] = mapped2;
    }
    return out;
  };

  // Shift the A1 references inside a formula by the active-axis mapper.
  // Non-formula values pass through untouched.
  const remapFormula = (value: CellValue): CellValue =>
    isFormula(value) ? shiftFormulaReferences(value, op.axis, mapIndex) : value;

  // Remap a bare integer-keyed structure (column or row formatting).
  const remapBare = <T>(src: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(src)) {
      const i = Number(key);
      if (!Number.isInteger(i)) {
        out[key] = value;
        continue;
      }
      const mapped = mapIndex(i);
      if (mapped === null) continue;
      out[String(mapped)] = value;
    }
    return out;
  };

  return {
    cells: remapCellKeys(s.cells, remapFormula),
    cellStyles: remapCellKeys(s.cellStyles),
    columns: axisIsRow ? { ...s.columns } : remapBare(s.columns),
    rows: axisIsRow ? remapBare(s.rows) : { ...s.rows },
    frozen: axisIsRow
      ? { rows: newFrozen, cols: s.frozen.cols }
      : { rows: s.frozen.rows, cols: newFrozen },
    dimensions: axisIsRow
      ? { rows: newDim, cols: s.dimensions.cols }
      : { rows: s.dimensions.rows, cols: newDim },
    capped: count < requested,
  };
};
