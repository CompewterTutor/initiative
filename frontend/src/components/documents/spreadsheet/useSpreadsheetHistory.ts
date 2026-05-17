import type * as Y from "yjs";

import { useYjsHistory, type YjsHistory } from "@/hooks/useYjsHistory";

/**
 * Per-session undo/redo for the spreadsheet — a thin adapter over the
 * generic {@link useYjsHistory} primitive. The data hooks
 * (`useSpreadsheetCells` / `useSpreadsheetFormatting`) already funnel
 * every mutation through `doc.transact(fn, origin)`; this just tells
 * the shared `Y.UndoManager` which shared types and which origins
 * represent undoable user actions.
 */

// Every spreadsheet transaction origin that represents a user action.
// Bootstrap/seed origins ("spreadsheet-bootstrap",
// "spreadsheet-fmt-bootstrap") are intentionally excluded so hydrating
// a fresh doc is never undoable. CSV/XLSX import IS included so a
// fat-fingered import is a single undo step.
const SPREADSHEET_UNDO_ORIGINS = [
  "spreadsheet-edit",
  "spreadsheet-bulk",
  "spreadsheet-replace-all",
  "spreadsheet-fmt-edit",
  "spreadsheet-fmt-batch",
  "spreadsheet-fmt-replace-all",
  "spreadsheet-import",
] as const;

// The shared maps the data hooks mutate. `getMap` is idempotent, so
// these resolve to the very same Y.Maps `useSpreadsheetCells` /
// `useSpreadsheetFormatting` write to.
const spreadsheetScope = (doc: Y.Doc) => [
  doc.getMap("cells"),
  doc.getMap("columns"),
  doc.getMap("rows"),
  doc.getMap("cellStyles"),
  doc.getMap("meta"),
];

export const useSpreadsheetHistory = (doc: Y.Doc | null): YjsHistory =>
  useYjsHistory({
    doc,
    getScope: spreadsheetScope,
    trackedOrigins: SPREADSHEET_UNDO_ORIGINS,
  });
