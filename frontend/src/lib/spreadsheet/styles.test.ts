import { describe, expect, it } from "vitest";

import {
  formatCellValue,
  negativeRendersRed,
  resolveCellFormat,
  resolveCellStyle,
  sanitizeFormat,
  sanitizeFormatting,
  sanitizeStyle,
  styleToCss,
} from "./styles";

describe("tier-1 style fields (underline/strike/valign/fontSize)", () => {
  it("sanitizes the new fields and clamps font size", () => {
    expect(
      sanitizeStyle({
        underline: true,
        strike: false,
        valign: "top",
        fontSize: 999,
      })
    ).toEqual({ underline: true, strike: false, valign: "top", fontSize: 96 });
    // Bad valign dropped; below-min font size clamps up (like width/height).
    expect(sanitizeStyle({ valign: "sideways", fontSize: 3 })).toEqual({
      fontSize: 6,
    });
  });

  it("renders decoration, vertical alignment and font size", () => {
    expect(styleToCss({ underline: true, strike: true, valign: "bottom", fontSize: 18 })).toEqual({
      textDecorationLine: "underline line-through",
      alignItems: "flex-end",
      fontSize: "18px",
    });
  });
});

describe("number format depth (grouping / negatives)", () => {
  it("keeps grouping + negatives for fixed/currency, ignores for percent", () => {
    expect(
      sanitizeFormat({ type: "fixed", decimals: 2, grouping: true, negatives: "redParens" })
    ).toEqual({ type: "fixed", decimals: 2, grouping: true, negatives: "redParens" });
    expect(sanitizeFormat({ type: "fixed", negatives: "bogus" })).toEqual({
      type: "fixed",
      decimals: 2,
    });
    expect(
      sanitizeFormat({ type: "percent", decimals: 1, grouping: true, negatives: "red" })
    ).toEqual({ type: "percent", decimals: 1 });
  });

  it("groups thousands and renders parentheses for negatives", () => {
    expect(formatCellValue(1234.5, { type: "fixed", decimals: 2, grouping: true })).toBe(
      "1,234.50"
    );
    expect(
      formatCellValue(-1234.5, {
        type: "fixed",
        decimals: 2,
        grouping: true,
        negatives: "parens",
      })
    ).toBe("(1,234.50)");
    expect(formatCellValue(-1234.5, { type: "fixed", decimals: 2, negatives: "red" })).toBe(
      "-1234.50"
    );
  });

  it("flags negative-red only for red/redParens numeric formats", () => {
    expect(negativeRendersRed(-5, { type: "fixed", decimals: 2, negatives: "red" })).toBe(true);
    expect(negativeRendersRed(5, { type: "fixed", decimals: 2, negatives: "red" })).toBe(false);
    expect(negativeRendersRed(-5, { type: "fixed", decimals: 2, negatives: "parens" })).toBe(false);
    expect(negativeRendersRed(-5, { type: "percent", decimals: 1 })).toBe(false);
  });
});

describe("sanitizeStyle", () => {
  it("keeps valid props, lowercases hex, drops the rest", () => {
    expect(
      sanitizeStyle({
        bold: true,
        italic: false,
        color: "#AABBCC",
        fill: "not-a-color",
        align: "diagonal",
        squiggly: true,
      })
    ).toEqual({ bold: true, italic: false, color: "#aabbcc" });
  });

  it("returns undefined when nothing valid remains", () => {
    expect(sanitizeStyle({ align: "weird", color: "red" })).toBeUndefined();
    expect(sanitizeStyle("nope")).toBeUndefined();
  });

  it("preserves an explicit align", () => {
    expect(sanitizeStyle({ align: "center" })).toEqual({ align: "center" });
  });
});

describe("sanitizeFormat", () => {
  it("clamps decimals and defaults currency", () => {
    expect(sanitizeFormat({ type: "currency", decimals: 99 })).toEqual({
      type: "currency",
      currency: "USD",
      decimals: 10,
    });
    expect(sanitizeFormat({ type: "currency", currency: "eur", decimals: 2 })).toEqual({
      type: "currency",
      currency: "EUR",
      decimals: 2,
    });
  });

  it("falls back to a safe pattern / drops unknown types", () => {
    expect(sanitizeFormat({ type: "date", pattern: "klingon" })).toEqual({
      type: "date",
      pattern: "iso",
    });
    expect(sanitizeFormat({ type: "bogus" })).toBeUndefined();
    expect(sanitizeFormat({ type: "plain" })).toEqual({ type: "plain" });
    expect(sanitizeFormat({ type: "percent" })).toEqual({ type: "percent", decimals: 1 });
  });
});

describe("sanitizeFormatting", () => {
  it("upcasts a v1 (formatting-less) blob to empty structures", () => {
    expect(sanitizeFormatting({ schema_version: 1, cells: {} })).toEqual({
      columns: {},
      rows: {},
      cellStyles: {},
      frozen: { rows: 0, cols: 0 },
    });
  });

  it("canonicalizes keys, clamps sizes, and drops junk", () => {
    const out = sanitizeFormatting({
      columns: {
        "007": { width: 99999 },
        "not-an-index": { width: 100 },
      },
      rows: { "0": { height: 0 } },
      cellStyles: { "01:02": { style: { bold: true } }, bad: { style: {} } },
      frozen: { rows: 50, cols: -2 },
    });
    expect(out.columns).toEqual({ "7": { width: 2000 } });
    expect(out.rows).toEqual({ "0": { height: 16 } });
    expect(out.cellStyles).toEqual({ "1:2": { style: { bold: true } } });
    expect(out.frozen).toEqual({ rows: 8, cols: 0 });
  });
});

describe("resolveCellStyle / resolveCellFormat", () => {
  const fmt = sanitizeFormatting({
    columns: {
      "1": { style: { bold: true, color: "#111111" }, format: { type: "fixed", decimals: 1 } },
    },
    rows: { "2": { style: { italic: true, color: "#999999" } } },
    cellStyles: {
      "2:1": { style: { color: "#222222", bold: false }, format: { type: "percent", decimals: 0 } },
    },
  });

  it("merges per-property with cell > column > row", () => {
    // row gives italic+color, column overrides color+adds bold, cell
    // overrides color again and switches bold back off.
    expect(resolveCellStyle(2, 1, fmt)).toEqual({
      italic: true,
      bold: false,
      color: "#222222",
    });
  });

  it("prefers the per-cell number format over the column default", () => {
    expect(resolveCellFormat(2, 1, fmt)).toEqual({ type: "percent", decimals: 0 });
    expect(resolveCellFormat(5, 1, fmt)).toEqual({ type: "fixed", decimals: 1 });
    expect(resolveCellFormat(5, 5, fmt)).toBeUndefined();
  });
});

describe("formatCellValue", () => {
  it("renders numbers per preset (percent multiplies by 100)", () => {
    expect(formatCellValue(0.25, { type: "percent", decimals: 1 })).toBe("25.0%");
    expect(formatCellValue(1234.5, { type: "fixed", decimals: 2 })).toBe("1234.50");
    expect(formatCellValue(5, { type: "currency", currency: "USD", decimals: 2 })).toBe("$5.00");
  });

  it("formats date strings without timezone drift", () => {
    expect(formatCellValue("2026-05-01", { type: "date", pattern: "iso" })).toBe("2026-05-01");
    expect(formatCellValue("2026-05-01", { type: "date", pattern: "us" })).toBe("05/01/2026");
    expect(formatCellValue("2026-05-01", { type: "date", pattern: "eu" })).toBe("01/05/2026");
  });

  it("passes non-numeric / empty values through untouched", () => {
    expect(formatCellValue("hello", { type: "currency", currency: "USD", decimals: 2 })).toBe(
      "hello"
    );
    expect(formatCellValue(null, { type: "fixed", decimals: 2 })).toBe("");
    expect(formatCellValue(42, undefined)).toBe("42");
    expect(formatCellValue(42, { type: "plain" })).toBe("42");
  });
});

describe("styleToCss", () => {
  it("maps only the set properties", () => {
    expect(styleToCss({ bold: true, align: "right", fill: "#fff000" })).toEqual({
      fontWeight: 600,
      textAlign: "right",
      backgroundColor: "#fff000",
    });
    expect(styleToCss({})).toEqual({});
  });

  it("renders per-edge borders, widths by line style", () => {
    expect(
      styleToCss({
        border: {
          top: { style: "thin", color: "#475569" },
          right: { style: "double", color: "#0000ff" },
          bottom: { style: "thick", color: "#ff0000" },
          left: { style: "dashed", color: "#00ff00" },
        },
      })
    ).toEqual({
      borderTop: "1px solid #475569",
      borderRight: "3px double #0000ff",
      borderBottom: "3px solid #ff0000",
      borderLeft: "1px dashed #00ff00",
    });
  });
});

describe("border sanitize / resolve", () => {
  it("keeps valid edges, drops bad ones, lowercases color", () => {
    const style = sanitizeStyle({
      border: {
        top: { style: "MEDIUM", color: "#ABCDEF" }, // bad style enum
        right: { style: "medium", color: "#ABCDEF" },
        bottom: { style: "thin", color: "red" }, // bad color
        left: { style: "dotted", color: "#123456" },
        diagonal: { style: "thin", color: "#000000" }, // unknown edge
      },
    });
    expect(style?.border).toEqual({
      right: { style: "medium", color: "#abcdef" },
      left: { style: "dotted", color: "#123456" },
    });
  });

  it("drops the border entirely when no edge is valid", () => {
    expect(sanitizeStyle({ border: { top: { style: "nope", color: "x" } } })).toBeUndefined();
  });

  it("per-cell border replaces a column-level border wholesale", () => {
    const fmt = sanitizeFormatting({
      columns: {
        "0": { style: { border: { top: { style: "thin", color: "#111111" } } } },
      },
      cellStyles: {
        "0:0": { style: { border: { bottom: { style: "thick", color: "#222222" } } } },
      },
    });
    expect(resolveCellStyle(0, 0, fmt).border).toEqual({
      bottom: { style: "thick", color: "#222222" },
    });
  });
});
