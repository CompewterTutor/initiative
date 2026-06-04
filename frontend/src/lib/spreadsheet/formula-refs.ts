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
 * Rewrite every A1 cell reference in a formula along ``axis`` using
 * ``mapIndex`` — the exact old-index → new-index mapper that
 * ``transformSheet`` builds for an insert/delete. References on the
 * inactive axis are left untouched; a reference whose active-axis line
 * was deleted (``mapIndex`` returns ``null``) becomes ``#REF!``.
 *
 * Ranges (``A1:B10``) are handled as a unit: deleting a row *inside* a
 * range shrinks it (both endpoints shift, neither is dropped), while
 * deleting the line of *either* endpoint collapses the whole range to a
 * single ``#REF!`` (``=SUM(#REF!)``, matching Excel — never the invalid
 * ``=SUM(#REF!:A10)``). ``$`` absolute markers are preserved verbatim.
 *
 * The scan skips double-quoted string literals (with ``""`` escaping) so
 * text like ``="A5 total"`` is never mistaken for a reference. Non-formula
 * input is returned unchanged.
 */
export const shiftFormulaReferences = (
  formula: string,
  axis: "row" | "col",
  mapIndex: (i: number) => number | null
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
        const start = mapRef(match, axis, mapIndex);
        const end = mapRef(match2, axis, mapIndex);
        // A deleted endpoint collapses the whole range (Excel behavior).
        out += start === null || end === null ? "#REF!" : `${start}:${end}`;
        i = afterIdx + 1 + match2[0].length;
        continue;
      }
      const single = mapRef(match, axis, mapIndex);
      out += single ?? "#REF!";
      i += match[0].length;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
};

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
