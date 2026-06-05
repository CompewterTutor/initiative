import { describe, expect, it } from "vitest";

import {
  extractReferences,
  isFormula,
  referenceInsertTarget,
  shiftFormulaReferences,
  translateFormula,
} from "./formula-refs";

// The same old-index -> new-index mappers transformSheet builds.
const insertMap =
  (at: number, count: number) =>
  (i: number): number | null =>
    i < at ? i : i + count;
const deleteMap = (at: number, count: number) => {
  const end = at + count;
  return (i: number): number | null => (i < at ? i : i >= end ? i - count : null);
};

describe("isFormula", () => {
  it("is true only for strings beginning with =", () => {
    expect(isFormula("=A1+1")).toBe(true);
    expect(isFormula("=")).toBe(true);
    expect(isFormula("A1+1")).toBe(false);
    expect(isFormula("123")).toBe(false);
    expect(isFormula(42)).toBe(false);
    expect(isFormula(true)).toBe(false);
    expect(isFormula(null)).toBe(false);
    expect(isFormula(undefined)).toBe(false);
  });
});

describe("shiftFormulaReferences — insert", () => {
  it("shifts a row reference at/below the insert point", () => {
    // Insert 1 row at row 0 (A1-row index 4 -> 5 -> shows as A6).
    expect(shiftFormulaReferences("=A5+1", "row", insertMap(0, 1))).toBe("=A6+1");
  });

  it("leaves references above the insert point unchanged", () => {
    // Insert 1 row at row 5: A5 (index 4) is above -> unchanged.
    expect(shiftFormulaReferences("=A5+1", "row", insertMap(5, 1))).toBe("=A5+1");
  });

  it("preserves $ absolute markers", () => {
    expect(shiftFormulaReferences("=$A$5", "row", insertMap(0, 1))).toBe("=$A$6");
    expect(shiftFormulaReferences("=A$5", "row", insertMap(0, 1))).toBe("=A$6");
  });

  it("shifts column letters on the col axis and leaves rows alone", () => {
    // Insert 1 column at col 0: B (index 1) -> C; row digits untouched.
    expect(shiftFormulaReferences("=B5", "col", insertMap(0, 1))).toBe("=C5");
    // A column insert never touches the row component.
    expect(shiftFormulaReferences("=B5", "row", insertMap(0, 1))).toBe("=B6");
  });

  it("shifts both endpoints of a range", () => {
    expect(shiftFormulaReferences("=SUM(A1:A10)", "row", insertMap(0, 2))).toBe("=SUM(A3:A12)");
  });
});

describe("shiftFormulaReferences — delete", () => {
  it("shrinks a range when an interior line is deleted", () => {
    // Delete 1 row at row 4 (5th row): A1 (idx 0) stays, A10 (idx 9) -> A9.
    expect(shiftFormulaReferences("=SUM(A1:A10)", "row", deleteMap(4, 1))).toBe("=SUM(A1:A9)");
  });

  it("turns a reference to a deleted line into #REF!", () => {
    // Delete the row A5 points at (index 4).
    expect(shiftFormulaReferences("=A5", "row", deleteMap(4, 1))).toBe("=#REF!");
  });

  it("collapses a whole range to #REF! when its start endpoint is deleted", () => {
    // Delete the row A2 (index 1) sits on — never =SUM(#REF!:A10).
    expect(shiftFormulaReferences("=SUM(A2:A11)", "row", deleteMap(1, 1))).toBe("=SUM(#REF!)");
  });

  it("collapses a whole range to #REF! when its end endpoint is deleted", () => {
    // Delete the row A11 (index 10) sits on.
    expect(shiftFormulaReferences("=SUM(A2:A11)", "row", deleteMap(10, 1))).toBe("=SUM(#REF!)");
  });

  it("shifts references below the deleted band up", () => {
    expect(shiftFormulaReferences("=A10", "row", deleteMap(4, 2))).toBe("=A8");
  });
});

describe("shiftFormulaReferences — boundaries", () => {
  it("does not rewrite text inside string literals", () => {
    expect(shiftFormulaReferences('="A5 total"&A5', "row", insertMap(0, 1))).toBe('="A5 total"&A6');
  });

  it("does not mistake a function name for a reference", () => {
    // LOG10(...) must survive a row insert untouched.
    expect(shiftFormulaReferences("=LOG10(A5)", "row", insertMap(0, 1))).toBe("=LOG10(A6)");
  });

  it("leaves a non-formula string untouched", () => {
    expect(shiftFormulaReferences("A5 plain text", "row", insertMap(0, 1))).toBe("A5 plain text");
  });

  it("handles multiple references in one formula", () => {
    expect(shiftFormulaReferences("=A5+B5*C1", "row", insertMap(0, 1))).toBe("=A6+B6*C2");
  });
});

describe("translateFormula", () => {
  it("shifts relative references by the row/col delta", () => {
    expect(translateFormula("=A1+B1", 2, 0)).toBe("=A3+B3");
    expect(translateFormula("=A1+B1", 0, 2)).toBe("=C1+D1");
    expect(translateFormula("=A1", 2, 3)).toBe("=D3");
  });

  it("pins $-absolute components in place", () => {
    expect(translateFormula("=$A$1+B1", 2, 0)).toBe("=$A$1+B3");
    expect(translateFormula("=A$1", 2, 3)).toBe("=D$1");
    expect(translateFormula("=$A1", 2, 3)).toBe("=$A3");
  });

  it("turns an off-grid reference into #REF!", () => {
    // =A1 pulled up one row → row index -1.
    expect(translateFormula("=A1", -1, 0)).toBe("=#REF!");
    // =A1 pulled left one col → col index -1.
    expect(translateFormula("=A1", 0, -1)).toBe("=#REF!");
  });

  it("translates both endpoints of a range as a unit", () => {
    expect(translateFormula("=SUM(A1:A3)", 5, 0)).toBe("=SUM(A6:A8)");
  });

  it("collapses a range to #REF! when an endpoint goes off-grid", () => {
    expect(translateFormula("=SUM(A1:A3)", -1, 0)).toBe("=SUM(#REF!)");
  });

  it("leaves string literals and function names alone", () => {
    expect(translateFormula('="A1 total"&A1', 1, 0)).toBe('="A1 total"&A2');
    expect(translateFormula("=LOG10(A1)", 1, 0)).toBe("=LOG10(A2)");
  });

  it("returns non-formula input unchanged", () => {
    expect(translateFormula("plain A1", 1, 0)).toBe("plain A1");
  });
});

describe("extractReferences", () => {
  it("returns an empty array for non-formula input", () => {
    expect(extractReferences("hello")).toEqual([]);
    expect(extractReferences("123")).toEqual([]);
  });

  it("locates a single cell reference with its box and span", () => {
    // "=A1" — A1 is row 0, col 0; the token spans offsets 1..3 in "=A1".
    expect(extractReferences("=A1")).toEqual([
      { text: "A1", start: 1, end: 3, r1: 0, c1: 0, r2: 0, c2: 0, colorIndex: 0 },
    ]);
  });

  it("normalizes a range to a single token / box", () => {
    const [ref] = extractReferences("=SUM(B2:C4)");
    expect(ref).toMatchObject({ text: "B2:C4", r1: 1, c1: 1, r2: 3, c2: 2 });
    expect(ref.start).toBe(5);
    expect(ref.end).toBe(10);
  });

  it("gives distinct references distinct color indices in appearance order", () => {
    expect(extractReferences("=A1+B2").map((r) => r.colorIndex)).toEqual([0, 1]);
  });

  it("shares a color index across repeated identical references", () => {
    expect(extractReferences("=A1+A1").map((r) => r.colorIndex)).toEqual([0, 0]);
  });

  it("ignores references inside quoted string literals", () => {
    expect(extractReferences('="A5 total"')).toEqual([]);
  });

  it("does not treat function names or longer identifiers as references", () => {
    expect(extractReferences("=LOG10(2)")).toEqual([]);
    expect(extractReferences("=SUM(1,2)")).toEqual([]);
  });

  it("captures absolute ($) references with the $ markers in the text", () => {
    const [ref] = extractReferences("=$A$1");
    expect(ref).toMatchObject({ text: "$A$1", r1: 0, c1: 0, r2: 0, c2: 0 });
  });

  it("computes correct offsets for multiple references", () => {
    const refs = extractReferences("=A1+B2");
    expect(refs.map((r) => [r.start, r.end])).toEqual([
      [1, 3],
      [4, 6],
    ]);
  });
});

describe("referenceInsertTarget", () => {
  it("inserts after the leading = ", () => {
    expect(referenceInsertTarget("=", 1)).toEqual({ kind: "insert", at: 1 });
  });

  it("inserts after an operator, ( or ,", () => {
    expect(referenceInsertTarget("=A1+", 4)).toEqual({ kind: "insert", at: 4 });
    expect(referenceInsertTarget("=SUM(", 5)).toEqual({ kind: "insert", at: 5 });
    expect(referenceInsertTarget("=SUM(A1,", 8)).toEqual({ kind: "insert", at: 8 });
  });

  it("inserts after trailing whitespace following an operator", () => {
    expect(referenceInsertTarget("=A1+ ", 5)).toEqual({ kind: "insert", at: 5 });
  });

  it("replaces a reference that follows the = or an operator", () => {
    expect(referenceInsertTarget("=A1", 3)).toEqual({ kind: "replace", start: 1, end: 3 });
    expect(referenceInsertTarget("=SUM(A1", 7)).toEqual({ kind: "replace", start: 5, end: 7 });
    expect(referenceInsertTarget("=B2+C3", 6)).toEqual({ kind: "replace", start: 4, end: 6 });
  });

  it("returns none mid-literal or for a non-formula", () => {
    expect(referenceInsertTarget("=hello", 6)).toEqual({ kind: "none" });
    expect(referenceInsertTarget("plain", 5)).toEqual({ kind: "none" });
  });
});
