import { describe, expect, it } from "vitest";

import { type CellValue, keyOf } from "./coords";
import type { CellFmt, ColumnFmt, RowFmt } from "./styles";
import {
  type LineOp,
  type SheetStructures,
  type TransformResult,
  transformSheet,
} from "./transform";

const cellMap = (obj: Record<string, CellValue>): Map<string, CellValue> =>
  new Map(Object.entries(obj));

/** Build a structures snapshot with sane defaults for terse fixtures. */
const sheet = (partial: Partial<SheetStructures> = {}): SheetStructures => ({
  cells: partial.cells ?? new Map(),
  cellStyles: partial.cellStyles ?? {},
  columns: partial.columns ?? {},
  rows: partial.rows ?? {},
  frozen: partial.frozen ?? { rows: 0, cols: 0 },
  dimensions: partial.dimensions ?? { rows: 100, cols: 26 },
});

const op = (partial: Partial<LineOp> & Pick<LineOp, "axis" | "mode">): LineOp => ({
  at: 0,
  count: 1,
  maxRows: 100_000,
  maxCols: 1_000,
  ...partial,
});

/** Run a transform expected to change something, narrowing away the
 *  no-op ``null`` return so the assertions can read the result directly. */
const run = (s: SheetStructures, o: LineOp): TransformResult => {
  const result = transformSheet(s, o);
  expect(result).not.toBeNull();
  return result as TransformResult;
};

describe("transformSheet — insert rows", () => {
  it("shifts cells at/below the insert point down and leaves a gap", () => {
    const cells = cellMap({ "0:0": "a", "1:0": "b", "2:0": "c" });
    const result = run(sheet({ cells }), op({ axis: "row", mode: "insert", at: 1 }));
    expect(result.cells[keyOf(0, 0)]).toBe("a");
    expect(result.cells[keyOf(1, 0)]).toBeUndefined(); // new blank row
    expect(result.cells[keyOf(2, 0)]).toBe("b");
    expect(result.cells[keyOf(3, 0)]).toBe("c");
    expect(result.dimensions.rows).toBe(101);
  });

  it("inserts N rows at once", () => {
    const cells = cellMap({ "0:0": "a", "1:0": "b" });
    const result = run(sheet({ cells }), op({ axis: "row", mode: "insert", at: 1, count: 3 }));
    expect(result.cells[keyOf(0, 0)]).toBe("a");
    expect(result.cells[keyOf(4, 0)]).toBe("b");
    expect(result.dimensions.rows).toBe(103);
  });

  it("remaps per-row formatting and per-cell styles", () => {
    const rows: Record<string, RowFmt> = { "2": { height: 40 } };
    const cellStyles: Record<string, CellFmt> = { "2:1": { style: { bold: true } } };
    const result = run(
      sheet({ rows, cellStyles }),
      op({ axis: "row", mode: "insert", at: 1, count: 1 })
    );
    expect(result.rows["3"]).toEqual({ height: 40 });
    expect(result.rows["2"]).toBeUndefined();
    expect(result.cellStyles[keyOf(3, 1)]).toEqual({ style: { bold: true } });
  });

  it("extends the frozen band when inserting inside it", () => {
    const result = run(
      sheet({ frozen: { rows: 2, cols: 0 } }),
      op({ axis: "row", mode: "insert", at: 1, count: 2 })
    );
    expect(result.frozen.rows).toBe(4);
  });

  it("leaves frozen untouched when inserting below the band", () => {
    const result = run(
      sheet({ frozen: { rows: 2, cols: 0 } }),
      op({ axis: "row", mode: "insert", at: 2, count: 1 })
    );
    expect(result.frozen.rows).toBe(2);
  });

  it("returns null (no-op) when the grid is already at capacity", () => {
    const result = transformSheet(
      sheet({ dimensions: { rows: 100_000, cols: 26 } }),
      op({ axis: "row", mode: "insert", at: 0, count: 5 })
    );
    expect(result).toBeNull();
  });
});

describe("transformSheet — delete rows", () => {
  it("drops the deleted row and pulls the rest up", () => {
    const cells = cellMap({ "0:0": "a", "1:0": "b", "2:0": "c" });
    const result = run(sheet({ cells }), op({ axis: "row", mode: "delete", at: 1 }));
    expect(result.cells[keyOf(0, 0)]).toBe("a");
    expect(result.cells[keyOf(1, 0)]).toBe("c");
    expect(result.cells[keyOf(2, 0)]).toBeUndefined();
    expect(result.dimensions.rows).toBe(99);
  });

  it("deletes N rows at once", () => {
    const cells = cellMap({ "0:0": "a", "1:0": "b", "2:0": "c", "3:0": "d" });
    const result = run(sheet({ cells }), op({ axis: "row", mode: "delete", at: 1, count: 2 }));
    expect(result.cells[keyOf(0, 0)]).toBe("a");
    expect(result.cells[keyOf(1, 0)]).toBe("d");
    expect(result.dimensions.rows).toBe(98);
  });

  it("shrinks the frozen band by the deleted overlap only", () => {
    const result = run(
      sheet({ frozen: { rows: 3, cols: 0 } }),
      op({ axis: "row", mode: "delete", at: 1, count: 5 })
    );
    // Deleted [1,6) overlaps frozen [0,3) on rows 1,2 → frozen 3 - 2 = 1.
    expect(result.frozen.rows).toBe(1);
  });

  it("returns null (no-op) rather than deleting the last remaining line", () => {
    const result = transformSheet(
      sheet({ dimensions: { rows: 1, cols: 26 } }),
      op({ axis: "row", mode: "delete", at: 0, count: 1 })
    );
    expect(result).toBeNull();
  });
});

describe("transformSheet — columns", () => {
  it("inserts a column, shifting cells and column formatting right", () => {
    const cells = cellMap({ "0:0": "a", "0:1": "b" });
    const columns: Record<string, ColumnFmt> = { "1": { width: 200 } };
    const result = run(
      sheet({ cells, columns }),
      op({ axis: "col", mode: "insert", at: 1, count: 1 })
    );
    expect(result.cells[keyOf(0, 0)]).toBe("a");
    expect(result.cells[keyOf(0, 1)]).toBeUndefined();
    expect(result.cells[keyOf(0, 2)]).toBe("b");
    expect(result.columns["2"]).toEqual({ width: 200 });
    expect(result.dimensions.cols).toBe(27);
  });

  it("deletes a column, pulling the rest left", () => {
    const cells = cellMap({ "0:0": "a", "0:1": "b", "0:2": "c" });
    const result = run(sheet({ cells }), op({ axis: "col", mode: "delete", at: 1 }));
    expect(result.cells[keyOf(0, 0)]).toBe("a");
    expect(result.cells[keyOf(0, 1)]).toBe("c");
    expect(result.dimensions.cols).toBe(25);
  });

  it("leaves the other axis dimension untouched", () => {
    const result = run(
      sheet({ dimensions: { rows: 50, cols: 10 } }),
      op({ axis: "col", mode: "insert", at: 0, count: 1 })
    );
    expect(result.dimensions.rows).toBe(50);
    expect(result.dimensions.cols).toBe(11);
  });
});
