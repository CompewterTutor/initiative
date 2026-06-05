import { describe, expect, it } from "vitest";

import { isFormula, shiftFormulaReferences, translateFormula } from "./formula-refs";

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
