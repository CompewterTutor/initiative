/**
 * Formula evaluation for spreadsheet cells.
 *
 * Formulas live in the cell map as ordinary ``"=..."`` strings (see
 * {@link isFormula}); this module turns one into its computed value. We
 * lean on ``fast-formula-parser`` for the parsing + Excel function set
 * (SUM, AVERAGE, IF, …) and supply the surrounding machinery it lacks:
 * resolving A1 references against our sparse ``r:c`` map, recursively
 * evaluating referenced formula cells, memoizing results, and detecting
 * circular references.
 *
 * {@link createEvaluator} is bound to one immutable cell-map snapshot. The
 * editor rebuilds it whenever ``cells`` changes (every local edit, remote
 * peer write, or undo/redo produces a fresh map), so a ``useMemo`` keyed on
 * the map recomputes for free. Each cell is evaluated at most once per
 * snapshot thanks to the result cache.
 */

import FormulaParser, { FormulaError, FormulaHelpers, Types } from "fast-formula-parser";

import { type CellValue, keyOf } from "@/lib/spreadsheet/coords";
import { isFormula } from "@/lib/spreadsheet/formula-refs";

export { isFormula };

// fast-formula-parser ships ~280 of Excel's functions, but a few of the
// most common aggregates (MIN, MAX, COUNTA) are unimplemented stubs. We
// register them via the same FormulaHelpers.flattenParams plumbing the
// built-ins use, so they accept literals, cell refs, and ranges alike.
const CUSTOM_FUNCTIONS = {
  MIN: (...numbers: unknown[]): number => {
    let min: number | null = null;
    FormulaHelpers.flattenParams(numbers, Types.NUMBER, true, (item) => {
      if (typeof item === "number" && (min === null || item < min)) min = item;
    });
    return min ?? 0; // Excel: MIN of no numbers is 0
  },
  MAX: (...numbers: unknown[]): number => {
    let max: number | null = null;
    FormulaHelpers.flattenParams(numbers, Types.NUMBER, true, (item) => {
      if (typeof item === "number" && (max === null || item > max)) max = item;
    });
    return max ?? 0; // Excel: MAX of no numbers is 0
  },
  COUNTA: (...ranges: unknown[]): number => {
    let count = 0;
    FormulaHelpers.flattenParams(ranges, null, true, (item) => {
      if (item !== null && item !== undefined && item !== "") count++;
    });
    return count;
  },
};

/** The result of evaluating a cell: a scalar value, or an Excel-style
 *  error token (``error`` non-null, ``value`` null). */
export interface CellResult {
  value: CellValue;
  error: string | null;
}

export interface Evaluator {
  /** Evaluate the cell at (0-based) ``row`` / ``col``. Non-formula cells
   *  return their stored scalar with no error. */
  evaluate: (row: number, col: number) => CellResult;
}

/** Our own circular-reference token (Excel surfaces this as a warning, not
 *  a cell error, but a token keeps it visible and out of the math). */
const CYCLE_ERROR = "#CYCLE!";
const GENERIC_ERROR = "#ERROR!";
// fast-formula-parser positions are 1-based and want a sheet name.
const SHEET = "Sheet1";

const isScalar = (v: unknown): v is CellValue =>
  v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

export const createEvaluator = (cells: ReadonlyMap<string, CellValue>): Evaluator => {
  const cache = new Map<string, CellResult>();
  const visiting = new Set<string>();

  // Resolve one cell to the value (or FormulaError) the parser expects.
  // Errors are returned as FormulaError instances so the library
  // propagates them through arithmetic, exactly like Excel.
  const resolve = (row: number, col: number): CellValue | FormulaError => {
    const res = evaluate(row, col);
    if (res.error) return new FormulaError(res.error);
    return res.value;
  };

  const parser = new FormulaParser({
    onCell: ({ row, col }) => resolve(row - 1, col - 1),
    onRange: ({ from, to }) => {
      const grid: (CellValue | FormulaError)[][] = [];
      for (let r = from.row; r <= to.row; r++) {
        const line: (CellValue | FormulaError)[] = [];
        for (let c = from.col; c <= to.col; c++) line.push(resolve(r - 1, c - 1));
        grid.push(line);
      }
      return grid;
    },
    functions: CUSTOM_FUNCTIONS,
  });

  function evaluate(row: number, col: number): CellResult {
    const key = keyOf(row, col);
    const cached = cache.get(key);
    if (cached) return cached;

    const raw = cells.get(key) ?? null;
    if (!isFormula(raw)) {
      const result: CellResult = { value: raw, error: null };
      cache.set(key, result);
      return result;
    }

    // Re-entering a cell already on the evaluation stack is a cycle. Don't
    // cache here — the top frame for this key computes the real result.
    if (visiting.has(key)) return { value: null, error: CYCLE_ERROR };

    visiting.add(key);
    let result: CellResult;
    try {
      const parsed = parser.parse(raw.slice(1), { row: row + 1, col: col + 1, sheet: SHEET });
      result = toCellResult(parsed);
    } catch (e) {
      result = { value: null, error: errorToken(e) };
    } finally {
      visiting.delete(key);
    }

    cache.set(key, result);
    return result;
  }

  return { evaluate };
};

/** Map a thrown parse error to an Excel-style token. The library raises a
 *  generic ``#ERROR!`` for an unimplemented/unknown function; surface that
 *  as ``#NAME?`` to match Excel and read better in the grid. */
const errorToken = (e: unknown): string => {
  if (e instanceof FormulaError) {
    if (/is not implemented/i.test(e.message)) return "#NAME?";
    return e.name;
  }
  return GENERIC_ERROR;
};

/** Normalize whatever ``parser.parse`` returns into a {@link CellResult}. */
const toCellResult = (parsed: unknown): CellResult => {
  if (parsed instanceof FormulaError) return { value: null, error: parsed.name };
  // A range/array result used where a scalar is expected: take the
  // top-left, matching Excel's implicit intersection well enough for v1.
  if (Array.isArray(parsed)) return toCellResult(parsed[0]?.[0] ?? null);
  if (isScalar(parsed)) return { value: parsed, error: null };
  return { value: null, error: "#VALUE!" };
};
