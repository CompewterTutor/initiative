import { describe, expect, it } from "vitest";

import { sanitizeFormatting } from "./styles";
import { cellsToXlsx, xlsxToContent } from "./xlsx";

describe("xlsx round-trip", () => {
  it("preserves cells, sizes, styles, number formats and frozen panes", async () => {
    const cells = {
      "0:0": "Name",
      "0:1": "2026-05-01",
      "1:1": 1234.5,
      "2:0": true,
    };
    const formatting = sanitizeFormatting({
      columns: { "1": { width: 180 } },
      rows: { "0": { height: 32 } },
      cellStyles: {
        "0:0": { style: { bold: true, fill: "#fff000", align: "center" } },
        "1:1": { format: { type: "currency", currency: "USD", decimals: 2 } },
      },
      frozen: { rows: 1, cols: 1 },
    });

    const blob = await cellsToXlsx(cells, formatting, "report");
    const result = await xlsxToContent(await blob.arrayBuffer());

    expect(result.cells).toEqual({
      "0:0": "Name",
      "0:1": "2026-05-01",
      "1:1": 1234.5,
      "2:0": true,
    });
    expect(result.sheetCount).toBe(1);
    expect(result.formatting.columns["1"].width).toBe(180);
    expect(result.formatting.rows["0"].height).toBe(32);
    expect(result.formatting.cellStyles["0:0"].style).toEqual({
      bold: true,
      fill: "#fff000",
      align: "center",
    });
    expect(result.formatting.cellStyles["1:1"].format).toEqual({
      type: "currency",
      currency: "USD",
      decimals: 2,
    });
    expect(result.formatting.frozen).toEqual({ rows: 1, cols: 1 });
  });

  it("round-trips tier-1 font fields and grouped/negative number formats", async () => {
    const formatting = sanitizeFormatting({
      cellStyles: {
        "0:0": {
          style: { underline: true, strike: true, valign: "middle", fontSize: 24 },
        },
        "1:0": {
          format: {
            type: "fixed",
            decimals: 2,
            grouping: true,
            negatives: "redParens",
          },
        },
      },
    });
    const blob = await cellsToXlsx({ "0:0": "x", "1:0": -1234.5 }, formatting, "t");
    const result = await xlsxToContent(await blob.arrayBuffer());
    expect(result.formatting.cellStyles["0:0"].style).toEqual({
      underline: true,
      strike: true,
      valign: "middle",
      fontSize: 24,
    });
    expect(result.formatting.cellStyles["1:0"].format).toEqual({
      type: "fixed",
      decimals: 2,
      grouping: true,
      negatives: "redParens",
    });
  });

  it("round-trips per-edge cell borders", async () => {
    const formatting = sanitizeFormatting({
      cellStyles: {
        "0:0": {
          style: {
            border: {
              top: { style: "thin", color: "#475569" },
              right: { style: "double", color: "#0000ff" },
              bottom: { style: "thick", color: "#ff0000" },
            },
          },
        },
      },
    });
    const blob = await cellsToXlsx({ "0:0": "x" }, formatting, "b");
    const result = await xlsxToContent(await blob.arrayBuffer());
    expect(result.formatting.cellStyles["0:0"].style?.border).toEqual({
      top: { style: "thin", color: "#475569" },
      right: { style: "double", color: "#0000ff" },
      bottom: { style: "thick", color: "#ff0000" },
    });
  });

  it("normalizes xlsx Date cells to ISO strings (CSV-aligned scalar space)", async () => {
    const { Workbook } = await import("exceljs");
    const wb = new Workbook();
    const ws = wb.addWorksheet("S1");
    ws.getCell(1, 1).value = new Date(Date.UTC(2026, 4, 1));
    const buf = await wb.xlsx.writeBuffer();

    const result = await xlsxToContent(buf as ArrayBuffer);
    expect(result.cells["0:0"]).toBe("2026-05-01");
  });

  it("imports only the first sheet but reports the sheet count", async () => {
    const { Workbook } = await import("exceljs");
    const wb = new Workbook();
    wb.addWorksheet("First").getCell(1, 1).value = "keep";
    wb.addWorksheet("Second").getCell(1, 1).value = "ignore";
    const buf = await wb.xlsx.writeBuffer();

    const result = await xlsxToContent(buf as ArrayBuffer);
    expect(result.sheetCount).toBe(2);
    expect(result.cells).toEqual({ "0:0": "keep" });
  });

  it("degrades an unrecognized number format to plain", async () => {
    const { Workbook } = await import("exceljs");
    const wb = new Workbook();
    const ws = wb.addWorksheet("S1");
    const cell = ws.getCell(1, 1);
    cell.value = 5;
    cell.numFmt = "[Red]\\(General\\)"; // not one of our recognized presets
    const buf = await wb.xlsx.writeBuffer();

    const result = await xlsxToContent(buf as ArrayBuffer);
    expect(result.cells["0:0"]).toBe(5);
    expect(result.formatting.cellStyles["0:0"]?.format).toEqual({ type: "plain" });
  });
});
