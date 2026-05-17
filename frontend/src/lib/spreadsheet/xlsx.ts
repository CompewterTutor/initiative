/**
 * XLSX import/export for spreadsheet documents.
 *
 * Client-side, mirroring the existing client-side CSV path (no backend
 * file endpoint, RLS untouched). Uses ``exceljs`` (MIT, full style /
 * width / freeze fidelity), **lazy-imported** inside each function so it
 * never inflates the initial bundle — the editor is already a code-split
 * chunk and this is behind an explicit user action.
 *
 * Invariant: imported cell values land in the exact scalar space the
 * inline editor / CSV path produces (numbers stay numbers, booleans stay
 * booleans, dates become ISO ``YYYY-MM-DD`` strings) so the strict
 * scalar ``cells`` map — and the backend normalizer — never reject an
 * imported sheet. Unrecognized number formats degrade to ``plain``
 * (we never store raw Excel format strings in our model).
 */

import type { Workbook, Worksheet } from "exceljs";

import { boundingBox, type CellValue, keyOf } from "./coords";
import {
  type BorderLineStyle,
  type CellBorder,
  type CellStyle,
  type NegativeStyle,
  type NumberFormat,
  MAX_COL_WIDTH,
  MAX_FONT_SIZE,
  MAX_ROW_HEIGHT,
  MIN_COL_WIDTH,
  MIN_FONT_SIZE,
  MIN_ROW_HEIGHT,
  resolveCellFormat,
  resolveCellStyle,
  sanitizeFormatting,
  type SpreadsheetFormatting,
} from "./styles";

export interface XlsxImportResult {
  cells: Record<string, CellValue>;
  formatting: SpreadsheetFormatting;
  dimensions: { rows: number; cols: number };
  /** Number of worksheets in the workbook — the caller warns when >1
   *  (we only import the first sheet). */
  sheetCount: number;
}

// --- unit conversions (Excel ⇄ pixels) -----------------------------------
// Excel column width is "number of default-font characters"; row height
// is points. These are the conventional approximations.
const pxToChars = (px: number): number => Math.max(1, Math.round((px - 5) / 7));
const charsToPx = (chars: number): number => Math.round(chars * 7 + 5);
const pxToPoints = (px: number): number => px * 0.75;
const pointsToPx = (pt: number): number => Math.round(pt / 0.75);

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(Math.round(n), hi));

// --- color (#rrggbb ⇄ exceljs ARGB) --------------------------------------
const hexToArgb = (hex: string): string => `FF${hex.replace("#", "").toUpperCase()}`;

const argbToHex = (argb: unknown): string | undefined => {
  if (typeof argb !== "string") return undefined;
  // exceljs uses 8-char AARRGGBB; tolerate a 6-char RRGGBB too.
  const rgb = argb.length === 8 ? argb.slice(2) : argb;
  if (!/^[0-9a-fA-F]{6}$/.test(rgb)) return undefined;
  return `#${rgb.toLowerCase()}`;
};

// Our border line styles are all valid exceljs ``BorderStyle`` names, so
// export passes them through; import keeps a recognized style and maps
// anything else (double, hair, mediumDashed, …) to the nearest of ours.
const OUR_BORDER_STYLES: ReadonlySet<string> = new Set([
  "thin",
  "medium",
  "thick",
  "dashed",
  "dotted",
  "double",
]);
const toBorderStyle = (s: unknown): BorderLineStyle =>
  typeof s === "string" && OUR_BORDER_STYLES.has(s) ? (s as BorderLineStyle) : "thin";

const borderToExcel = (border: CellBorder) => {
  const out: Record<string, { style: string; color: { argb: string } }> = {};
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const e = border[edge];
    if (e) out[edge] = { style: e.style, color: { argb: hexToArgb(e.color) } };
  }
  return out;
};

const borderFromExcel = (border: unknown): CellBorder | undefined => {
  if (!border || typeof border !== "object") return undefined;
  const src = border as Record<string, unknown>;
  const out: CellBorder = {};
  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const e = src[edge];
    if (!e || typeof e !== "object") continue;
    const spec = e as { style?: unknown; color?: { argb?: string } };
    if (spec.style == null) continue;
    out[edge] = {
      style: toBorderStyle(spec.style),
      color: argbToHex(spec.color?.argb) ?? "#475569",
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

// --- number format (preset ⇄ Excel numFmt string) ------------------------
// Excel numFmt sections are ``positive;negative;…``; we encode the
// negative style in the second section ([Red] and/or parentheses).
const negSection = (base: string, neg: NegativeStyle | undefined): string => {
  if (neg === "red") return `${base};[Red]${base}`;
  if (neg === "parens") return `${base};(${base})`;
  if (neg === "redParens") return `${base};[Red](${base})`;
  return base; // minus (Excel default) — single section
};

const presetToNumFmt = (fmt: NumberFormat): string | undefined => {
  if (fmt.type === "plain") return undefined;
  const dp = (d: number) => (d > 0 ? `.${"0".repeat(d)}` : "");
  if (fmt.type === "percent") return `0${dp(fmt.decimals)}%`;
  if (fmt.type === "date") {
    if (fmt.pattern === "us") return "mm/dd/yyyy";
    if (fmt.pattern === "eu") return "dd/mm/yyyy";
    return "yyyy-mm-dd";
  }
  if (fmt.type === "fixed") {
    const grouped = fmt.grouping ?? false;
    return negSection(`${grouped ? "#,##0" : "0"}${dp(fmt.decimals)}`, fmt.negatives);
  }
  // currency
  const grouped = fmt.grouping ?? true;
  const mag = `${grouped ? "#,##0" : "0"}${dp(fmt.decimals)}`;
  return negSection(`"${fmt.currency}" ${mag}`, fmt.negatives);
};

const decimalsOf = (numFmt: string): number => {
  const m = /\.(0+)/.exec(numFmt);
  return m ? Math.min(m[1].length, 10) : 0;
};

const negFromSections = (f: string): NegativeStyle | undefined => {
  const neg = f.split(";")[1];
  if (!neg) return undefined;
  const red = /\[red\]/i.test(neg);
  const paren = neg.includes("(");
  if (red && paren) return "redParens";
  if (red) return "red";
  if (paren) return "parens";
  return undefined;
};

/** Reverse-map an Excel numFmt to a preset. Recognizes what we emit
 *  plus a few common built-ins; anything else → ``plain`` (lossy but
 *  safe — never store an arbitrary format string). */
const numFmtToPreset = (numFmt: unknown): NumberFormat | undefined => {
  if (typeof numFmt !== "string" || numFmt.trim() === "" || numFmt === "General") return undefined;
  const f = numFmt.trim();
  if (/%/.test(f)) return { type: "percent", decimals: decimalsOf(f) };
  if (/yy/i.test(f) || /\bd{1,2}\b/.test(f)) {
    if (/^m+\/d+\/y+$/i.test(f)) return { type: "date", pattern: "us" };
    if (/^d+\/m+\/y+$/i.test(f)) return { type: "date", pattern: "eu" };
    return { type: "date", pattern: "iso" };
  }
  const first = f.split(";")[0];
  const dec = decimalsOf(first);
  const negatives = negFromSections(f);
  const grouping = /#,##/.test(first);
  if (/[$£€¥]|\b[A-Z]{3}\b/.test(first)) {
    const code = /\b([A-Z]{3})\b/.exec(first.toUpperCase());
    return {
      type: "currency",
      currency: code ? code[1] : "USD",
      decimals: dec,
      ...(grouping ? {} : { grouping: false }),
      ...(negatives ? { negatives } : {}),
    };
  }
  if (/^[#,0]+(\.0+)?$/.test(first)) {
    return {
      type: "fixed",
      decimals: dec,
      ...(grouping ? { grouping: true } : {}),
      ...(negatives ? { negatives } : {}),
    };
  }
  return { type: "plain" };
};

/**
 * Serialize the cell map + formatting into an ``.xlsx`` buffer.
 * Styles/formats are written per-cell within the data bounding box
 * (same cost envelope as CSV export); widths/heights/freeze are written
 * at the sheet level so they apply even to empty columns/rows.
 */
export const cellsToXlsx = async (
  cells: ReadonlyMap<string, CellValue> | Record<string, CellValue>,
  formatting: SpreadsheetFormatting,
  documentTitle: string
): Promise<Blob> => {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  const ws = wb.addWorksheet("Sheet1");

  const lookup =
    cells instanceof Map
      ? (k: string) => cells.get(k)
      : (k: string) => (cells as Record<string, CellValue>)[k];
  const { rows, cols } = boundingBox(cells);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const raw = lookup(keyOf(r, c));
      const style = resolveCellStyle(r, c, formatting);
      const fmt = resolveCellFormat(r, c, formatting);
      const hasStyle = Object.keys(style).length > 0;
      if (raw == null && !hasStyle && !fmt) continue;
      const cell = ws.getCell(r + 1, c + 1);
      if (raw != null) cell.value = raw as string | number | boolean;
      if (
        style.bold ||
        style.italic ||
        style.underline ||
        style.strike ||
        style.color ||
        style.fontSize
      ) {
        cell.font = {
          bold: style.bold || undefined,
          italic: style.italic || undefined,
          underline: style.underline || undefined,
          strike: style.strike || undefined,
          // Model stores px; Excel font size is points.
          size: style.fontSize ? Math.round(style.fontSize * 0.75) : undefined,
          color: style.color ? { argb: hexToArgb(style.color) } : undefined,
        };
      }
      if (style.fill) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: hexToArgb(style.fill) },
        };
      }
      if (style.align || style.valign) {
        cell.alignment = {
          horizontal: style.align,
          vertical: style.valign,
        };
      }
      if (style.border) {
        cell.border = borderToExcel(style.border) as typeof cell.border;
      }
      if (fmt) {
        const nf = presetToNumFmt(fmt);
        if (nf) cell.numFmt = nf;
      }
    }
  }

  for (const [key, col] of Object.entries(formatting.columns)) {
    if (col.width !== undefined) {
      ws.getColumn(Number(key) + 1).width = pxToChars(col.width);
    }
  }
  for (const [key, row] of Object.entries(formatting.rows)) {
    if (row.height !== undefined) {
      ws.getRow(Number(key) + 1).height = pxToPoints(row.height);
    }
  }
  if (formatting.frozen.rows > 0 || formatting.frozen.cols > 0) {
    ws.views = [
      {
        state: "frozen",
        xSplit: formatting.frozen.cols,
        ySplit: formatting.frozen.rows,
      },
    ];
  }

  void documentTitle; // filename is chosen by the caller via downloadBlob
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
};

const extractScalar = (value: unknown): CellValue | undefined => {
  if (value == null) return undefined;
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) {
    // Normalize to the same ISO date string the CSV path / coerceScalar
    // would carry, so xlsx and CSV imports converge.
    const iso = value.toISOString();
    return iso.slice(0, 10);
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("text" in v && typeof v.text === "string") return v.text || undefined;
    if ("result" in v) return extractScalar(v.result);
    if ("richText" in v && Array.isArray(v.richText)) {
      const text = v.richText
        .map((seg) =>
          seg && typeof seg === "object" ? String((seg as { text?: unknown }).text ?? "") : ""
        )
        .join("");
      return text || undefined;
    }
    if ("error" in v) return undefined;
  }
  return undefined;
};

const styleFromCell = (cell: {
  font?: unknown;
  fill?: unknown;
  alignment?: unknown;
  border?: unknown;
}): CellStyle | undefined => {
  const out: CellStyle = {};
  const font = cell.font as
    | {
        bold?: boolean;
        italic?: boolean;
        underline?: unknown;
        strike?: boolean;
        size?: number;
        color?: { argb?: string };
      }
    | undefined;
  if (font?.bold) out.bold = true;
  if (font?.italic) out.italic = true;
  // exceljs underline may be boolean or a style string ("single", …).
  if (font?.underline) out.underline = true;
  if (font?.strike) out.strike = true;
  if (typeof font?.size === "number" && font.size > 0) {
    // Excel points → model px, clamped to the model's bounds.
    out.fontSize = Math.max(MIN_FONT_SIZE, Math.min(Math.round(font.size / 0.75), MAX_FONT_SIZE));
  }
  const color = argbToHex(font?.color?.argb);
  if (color) out.color = color;
  const fill = cell.fill as
    | { type?: string; pattern?: string; fgColor?: { argb?: string } }
    | undefined;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const bg = argbToHex(fill.fgColor?.argb);
    if (bg) out.fill = bg;
  }
  const alignment = cell.alignment as { horizontal?: string; vertical?: string } | undefined;
  const align = alignment?.horizontal;
  if (align === "left" || align === "center" || align === "right") out.align = align;
  const valign = alignment?.vertical;
  if (valign === "top" || valign === "middle" || valign === "bottom") out.valign = valign;
  const border = borderFromExcel(cell.border);
  if (border) out.border = border;
  return Object.keys(out).length > 0 ? out : undefined;
};

const readFrozen = (ws: Worksheet): { rows: number; cols: number } => {
  const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
  if (view?.state !== "frozen") return { rows: 0, cols: 0 };
  return {
    rows: typeof view.ySplit === "number" ? view.ySplit : 0,
    cols: typeof view.xSplit === "number" ? view.xSplit : 0,
  };
};

/** Parse an ``.xlsx`` buffer into our content model (first sheet only). */
export const xlsxToContent = async (data: ArrayBuffer): Promise<XlsxImportResult> => {
  const { Workbook } = await import("exceljs");
  const wb: Workbook = new Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) {
    return {
      cells: {},
      formatting: sanitizeFormatting({}),
      dimensions: { rows: 100, cols: 26 },
      sheetCount: wb.worksheets.length,
    };
  }

  const cells: Record<string, CellValue> = {};
  const cellStyles: Record<string, { style?: CellStyle; format?: NumberFormat }> = {};
  let maxRow = -1;
  let maxCol = -1;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const r = rowNumber - 1;
      const c = colNumber - 1;
      const scalar = extractScalar(cell.value);
      const style = styleFromCell(cell);
      const fmt = numFmtToPreset(cell.numFmt);
      if (scalar === undefined && !style && !fmt) return;
      if (scalar !== undefined) cells[keyOf(r, c)] = scalar;
      if (style || fmt) {
        cellStyles[`${r}:${c}`] = {
          ...(style ? { style } : {}),
          ...(fmt ? { format: fmt } : {}),
        };
      }
      if (r > maxRow) maxRow = r;
      if (c > maxCol) maxCol = c;
    });
  });

  const columns: Record<string, { width?: number }> = {};
  ws.columns?.forEach((col, i) => {
    if (typeof col.width === "number" && col.width > 0) {
      columns[String(i)] = {
        width: clamp(charsToPx(col.width), MIN_COL_WIDTH, MAX_COL_WIDTH),
      };
      if (i > maxCol) maxCol = i;
    }
  });
  const rowsFmt: Record<string, { height?: number }> = {};
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (typeof row.height === "number" && row.height > 0) {
      rowsFmt[String(rowNumber - 1)] = {
        height: clamp(pointsToPx(row.height), MIN_ROW_HEIGHT, MAX_ROW_HEIGHT),
      };
      if (rowNumber - 1 > maxRow) maxRow = rowNumber - 1;
    }
  });

  const formatting = sanitizeFormatting({
    columns,
    rows: rowsFmt,
    cellStyles,
    frozen: readFrozen(ws),
  });

  return {
    cells,
    formatting,
    dimensions: {
      rows: Math.max(maxRow + 1, 100),
      cols: Math.max(maxCol + 1, 26),
    },
    sheetCount: wb.worksheets.length,
  };
};
