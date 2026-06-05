/**
 * Parser-free formula helpers.
 *
 * Kept deliberately separate from ``formula.ts`` (the evaluator) so that
 * ``transform.ts`` — a lightweight pure module run on every row/column
 * insert/delete — can rewrite cell references without pulling the
 * ``fast-formula-parser`` / ``chevrotain`` dependency into its import
 * graph. The only thing shared between the two is the trivial
 * {@link isFormula} predicate.
 */

import { type CellValue, colIndexToLetter, letterToColIndex } from "@/lib/spreadsheet/coords";

/** A cell holds a formula when its value is a string beginning with "=". */
export const isFormula = (value: CellValue | undefined): value is string =>
  typeof value === "string" && value.startsWith("=");

// A1-style reference token: optional ``$`` before the column letters and
// before the row digits (``A1``, ``$A1``, ``A$1``, ``$A$1``). Anchored so
// we can probe a single position in the scan below.
const REF_AT_START = /^(\$?)([A-Za-z]+)(\$?)(\d+)/;

// Characters that, when they immediately precede or follow a candidate
// match, mean it's part of a longer identifier (a function name like
// ``LOG10``, a defined name, a decimal literal) rather than a standalone
// cell reference. ``(`` after the match marks a function call.
const IDENT_CHAR = /[A-Za-z0-9_.$]/;

/** A matched ref is bogus if what follows it would extend it into a longer
 *  identifier or a function call. ``undefined`` (end of input) is fine. */
const isIdentTail = (c: string | undefined): boolean => {
  const x = c ?? "";
  return x === "(" || IDENT_CHAR.test(x);
};

/**
 * Scan a formula and rewrite every A1 cell reference through ``mapSingle``,
 * which maps one matched reference to its replacement text (or ``null`` to
 * mark it deleted / off-grid → ``#REF!``).
 *
 * Ranges (``A1:B10``) are handled as a unit: a ``null`` from *either*
 * endpoint collapses the whole range to a single ``#REF!`` (``=SUM(#REF!)``,
 * matching Excel — never the invalid ``=SUM(#REF!:A10)``).
 *
 * The scan skips double-quoted string literals (with ``""`` escaping) so
 * text like ``="A5 total"`` is never mistaken for a reference, and only
 * probes at identifier boundaries so a function name (``LOG10``) or a name
 * like ``FOO_A1`` isn't rewritten. Non-formula input is returned unchanged.
 */
const scanReferences = (
  formula: string,
  mapSingle: (m: RegExpExecArray) => string | null
): string => {
  if (!isFormula(formula)) return formula;
  const body = formula.slice(1);
  let out = "=";
  let i = 0;
  let inQuote = false;

  while (i < body.length) {
    const ch = body[i];

    if (inQuote) {
      out += ch;
      if (ch === '"') {
        // Doubled quote inside a string is an escaped quote, not the end.
        if (body[i + 1] === '"') {
          out += '"';
          i += 2;
          continue;
        }
        inQuote = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inQuote = true;
      out += ch;
      i++;
      continue;
    }

    // Only probe for a reference at an identifier boundary so the ``A1``
    // inside ``FOO_A1`` (or a column-letter run that's really a function
    // name) isn't rewritten.
    const prev = i > 0 ? body[i - 1] : "";
    const match = IDENT_CHAR.test(prev) ? null : REF_AT_START.exec(body.slice(i));
    if (match && !isIdentTail(body[i + match[0].length])) {
      const afterIdx = i + match[0].length;
      // Look for a ``ref:ref`` range so it can be rewritten as a unit.
      let match2: RegExpExecArray | null = null;
      if (body[afterIdx] === ":") {
        const m = REF_AT_START.exec(body.slice(afterIdx + 1));
        if (m && !isIdentTail(body[afterIdx + 1 + m[0].length])) match2 = m;
      }
      if (match2) {
        const start = mapSingle(match);
        const end = mapSingle(match2);
        // A deleted/off-grid endpoint collapses the whole range (Excel).
        out += start === null || end === null ? "#REF!" : `${start}:${end}`;
        i = afterIdx + 1 + match2[0].length;
        continue;
      }
      out += mapSingle(match) ?? "#REF!";
      i += match[0].length;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
};

/**
 * Rewrite every A1 cell reference in a formula along ``axis`` using
 * ``mapIndex`` — the exact old-index → new-index mapper that
 * ``transformSheet`` builds for an insert/delete. References on the
 * inactive axis are left untouched; a reference whose active-axis line
 * was deleted (``mapIndex`` returns ``null``) becomes ``#REF!``.
 *
 * Ranges shrink when an interior line is deleted and collapse to ``#REF!``
 * when an endpoint's line is deleted. ``$`` absolute markers are preserved
 * verbatim, but the index *still moves* — an insert above ``$A$5`` pushes
 * it to ``$A$6`` because the content it points at shifted. (Contrast
 * {@link translateFormula}, where ``$`` pins the reference in place.)
 */
export const shiftFormulaReferences = (
  formula: string,
  axis: "row" | "col",
  mapIndex: (i: number) => number | null
): string => scanReferences(formula, (m) => mapRef(m, axis, mapIndex));

/**
 * Translate every *relative* A1 reference in a formula by ``rowDelta`` /
 * ``colDelta`` — the copy/fill semantics of a spreadsheet. A ``$`` marker
 * pins that component in place (``$A$1`` never moves; ``A$1`` moves only by
 * column; ``$A1`` only by row). A reference pushed off the grid (negative
 * row or column) becomes ``#REF!``, and a range collapses to ``#REF!`` if
 * either endpoint does. Non-formula input is returned unchanged.
 */
export const translateFormula = (formula: string, rowDelta: number, colDelta: number): string =>
  scanReferences(formula, (m) => mapRefTranslate(m, rowDelta, colDelta));

/** Rewrite one matched reference along ``axis``; ``null`` if its line was
 *  deleted (the caller turns that into ``#REF!``). */
const mapRef = (
  m: RegExpExecArray,
  axis: "row" | "col",
  mapIndex: (i: number) => number | null
): string | null => {
  const [, colAbs, letters, rowAbs, digits] = m;
  if (axis === "col") {
    const mapped = mapIndex(letterToColIndex(letters));
    return mapped === null ? null : `${colAbs}${colIndexToLetter(mapped)}${rowAbs}${digits}`;
  }
  const mapped = mapIndex(Number(digits) - 1);
  return mapped === null ? null : `${colAbs}${letters}${rowAbs}${mapped + 1}`;
};

/** Translate one matched reference by ``rowDelta`` / ``colDelta``, leaving
 *  ``$``-pinned components untouched; ``null`` if pushed off the grid (the
 *  caller turns that into ``#REF!``). */
const mapRefTranslate = (m: RegExpExecArray, rowDelta: number, colDelta: number): string | null => {
  const [, colAbs, letters, rowAbs, digits] = m;
  const col = letterToColIndex(letters) + (colAbs ? 0 : colDelta);
  const row = Number(digits) - 1 + (rowAbs ? 0 : rowDelta);
  if (row < 0 || col < 0) return null;
  return `${colAbs}${colIndexToLetter(col)}${rowAbs}${row + 1}`;
};

// ---------------------------------------------------------------------------
// Reference extraction (read-only) for the formula editor's live highlights.
// ---------------------------------------------------------------------------

/**
 * Palette for the editor's reference highlights. The same index colors a
 * reference's outline box on the grid and its text in the formula input, and
 * is reused for repeated identical references (Excel behavior). Index with
 * ``colorIndex % FORMULA_REF_COLORS.length``.
 */
export const FORMULA_REF_COLORS = [
  "#1a73e8",
  "#188038",
  "#a142f4",
  "#e8710a",
  "#d93025",
  "#12a4af",
  "#c5221f",
  "#9334e6",
];

/** One A1 reference (or ``A1:B3`` range) located inside a formula string. */
export interface FormulaRefToken {
  /** The matched text, e.g. ``A1`` or ``$A$1:B3``. */
  text: string;
  /** Character offset of the token in the full formula (including the leading "="). */
  start: number;
  /** Exclusive end offset. */
  end: number;
  /** Normalized bounding box (0-based, top-left .. bottom-right). */
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  /** Stable index into {@link FORMULA_REF_COLORS}, shared by identical refs. */
  colorIndex: number;
}

/** Resolve a matched A1 reference to 0-based coords, or ``null`` if off-grid. */
const refCoords = (m: RegExpExecArray): { row: number; col: number } | null => {
  const col = letterToColIndex(m[2]);
  const row = Number(m[4]) - 1;
  if (col < 0 || row < 0) return null;
  return { row, col };
};

/**
 * Locate every A1 reference / range in a formula and return its character
 * span and grid box, for the editor's live highlighting. Mirrors the
 * quote-skipping and identifier-boundary rules of {@link scanReferences} (the
 * two walks must stay in sync); off-grid references are simply omitted rather
 * than collapsed to ``#REF!``. Non-formula input yields an empty array.
 *
 * ``colorIndex`` is assigned per unique reference text in order of first
 * appearance, so ``=A1+A1`` colors both ``A1`` tokens identically.
 */
export const extractReferences = (formula: string): FormulaRefToken[] => {
  if (!isFormula(formula)) return [];
  const body = formula.slice(1);
  const raw: Omit<FormulaRefToken, "colorIndex">[] = [];
  let i = 0;
  let inQuote = false;

  while (i < body.length) {
    const ch = body[i];

    if (inQuote) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          i += 2;
          continue;
        }
        inQuote = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inQuote = true;
      i++;
      continue;
    }

    const prev = i > 0 ? body[i - 1] : "";
    const match = IDENT_CHAR.test(prev) ? null : REF_AT_START.exec(body.slice(i));
    if (match && !isIdentTail(body[i + match[0].length])) {
      const afterIdx = i + match[0].length;
      const first = refCoords(match);
      // Look for a ``ref:ref`` range so it's recorded as one token/box.
      let match2: RegExpExecArray | null = null;
      if (body[afterIdx] === ":") {
        const m = REF_AT_START.exec(body.slice(afterIdx + 1));
        if (m && !isIdentTail(body[afterIdx + 1 + m[0].length])) match2 = m;
      }
      if (match2) {
        const end2 = afterIdx + 1 + match2[0].length;
        const second = refCoords(match2);
        if (first && second) {
          raw.push({
            text: body.slice(i, end2),
            start: i + 1,
            end: end2 + 1,
            r1: Math.min(first.row, second.row),
            c1: Math.min(first.col, second.col),
            r2: Math.max(first.row, second.row),
            c2: Math.max(first.col, second.col),
          });
        }
        i = end2;
        continue;
      }
      if (first) {
        raw.push({
          text: match[0],
          start: i + 1,
          end: afterIdx + 1,
          r1: first.row,
          c1: first.col,
          r2: first.row,
          c2: first.col,
        });
      }
      i = afterIdx;
      continue;
    }

    i++;
  }

  const colorByText = new Map<string, number>();
  return raw.map((t) => {
    let colorIndex = colorByText.get(t.text);
    if (colorIndex === undefined) {
      colorIndex = colorByText.size;
      colorByText.set(t.text, colorIndex);
    }
    return { ...t, colorIndex };
  });
};

/**
 * Where (if anywhere) a clicked cell's reference should land in the formula
 * draft, given the caret position — the editor's "point mode" decision.
 *
 * - ``insert``: the caret follows a token that expects an operand (``=``, an
 *   operator, ``(``, ``,`` or ``:``) — splice a fresh reference there.
 * - ``replace``: the caret sits just after a reference that itself follows an
 *   operand-accepting token — clicking moves that reference (Excel behavior).
 * - ``none``: the caret is mid-literal/value — the click should commit the
 *   edit normally instead.
 */
export type InsertTarget =
  | { kind: "none" }
  | { kind: "insert"; at: number }
  | { kind: "replace"; start: number; end: number };

// Final char of the (whitespace-trimmed) text before the caret that means a
// reference may follow.
const REF_ACCEPTING_END = /[=(,:+\-*/^&<>%]$/;
// A trailing A1 reference (or range) at the end of the pre-caret text.
const TRAILING_REF = /(\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?)$/;

export const referenceInsertTarget = (draft: string, caret: number): InsertTarget => {
  if (!isFormula(draft)) return { kind: "none" };
  const before = draft.slice(0, caret);
  const trimmed = before.replace(/\s+$/, "");
  if (REF_ACCEPTING_END.test(trimmed)) return { kind: "insert", at: caret };
  const refMatch = TRAILING_REF.exec(trimmed);
  if (refMatch) {
    const start = trimmed.length - refMatch[1].length;
    const charBefore = start > 0 ? trimmed[start - 1] : "";
    // The leading "=" (start === 1) or any operand-accepting char before the
    // reference means the user is still pointing — clicking moves the ref.
    if (start === 1 || REF_ACCEPTING_END.test(charBefore)) {
      return { kind: "replace", start, end: trimmed.length };
    }
  }
  return { kind: "none" };
};
