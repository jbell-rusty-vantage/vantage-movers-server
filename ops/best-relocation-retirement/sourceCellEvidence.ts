import type { sheets_v4 } from "googleapis";
import type { TabReadResult } from "../../src/services/bestRelocationSheetIngest/types";
import { BEST_RELOCATION_TRACKER_ID } from "../../src/services/leads/externalSheetReview";

/** Row and column are one-based physical coordinates in the frozen source. */
export type LiteralCallPhoneEvidence = {
  workbook_id: string;
  sheet_id: number;
  row: number;
  column: number;
  resolved_value: "#ERROR!";
  user_entered_formula: string;
  phone_literal: string;
};

/** Google Sheets treats a leading '+' telephone literal as a formula. This
 * accepts only the original literal in an independently observed parse-error
 * cell. No formula is evaluated and no missing telephone digit is inferred. */
export function literalCallPhoneEvidence(input: {
  workbook_id: string;
  sheet_id: number;
  row: number;
  column: number;
  checker: string;
  captured_resolved_value: string;
  cell: sheets_v4.Schema$CellData;
}): LiteralCallPhoneEvidence | null {
  const formula = input.cell.userEnteredValue?.formulaValue;
  const error = input.cell.effectiveValue?.errorValue;
  if (input.workbook_id !== BEST_RELOCATION_TRACKER_ID || input.sheet_id !== 1191420872 ||
      !Number.isInteger(input.row) || input.row < 2 || !Number.isInteger(input.column) || input.column < 1 ||
      input.captured_resolved_value.trim() !== "#ERROR!" || input.cell.formattedValue !== "#ERROR!" ||
      input.checker.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") !== "international number" ||
      error?.type !== "ERROR" || !/^formula parse error\.?$/i.test(error.message?.trim() ?? "") ||
      typeof formula !== "string" || !/^\+[\d\s().-]+$/.test(formula)) return null;
  const digits = formula.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return { workbook_id: input.workbook_id, sheet_id: input.sheet_id, row: input.row, column: input.column,
    resolved_value: "#ERROR!", user_entered_formula: formula, phone_literal: formula };
}

/** Read only the exact error cells selected from this capture. The source
 * workbook is never edited, and the caller binds returned evidence into its
 * new snapshot/checksum before planning. */
export async function captureLiteralCallPhones(client: sheets_v4.Sheets, tab: TabReadResult): Promise<LiteralCallPhoneEvidence[]> {
  if (tab.spreadsheetId !== BEST_RELOCATION_TRACKER_ID || tab.tabName !== "Calls" || tab.tabId !== 1191420872)
    throw new Error("literal_phone_source_identity_mismatch");
  const phoneColumn = tab.headers.indexOf("PHONE NUMBER"), checkerColumn = tab.headers.indexOf("Form Fill Checker");
  if (phoneColumn < 0 || checkerColumn < 0 || phoneColumn >= 702) throw new Error("literal_phone_source_headers_missing");
  const selected = tab.matrix.slice(1).flatMap((cells, index) => {
    const checker = cells[checkerColumn] ?? "", resolved = cells[phoneColumn] ?? "";
    return resolved.trim() === "#ERROR!" && checker.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") === "international number"
      ? [{ row: index + 2, checker, resolved }] : [];
  });
  if (!selected.length) return [];
  if (selected.length > 100) throw new Error("literal_phone_capture_bound_exceeded");
  const column = phoneColumn + 1;
  const columnName = column <= 26 ? String.fromCharCode(64 + column)
    : `${String.fromCharCode(64 + Math.floor((column - 1) / 26))}${String.fromCharCode(65 + (column - 1) % 26)}`;
  const result = await client.spreadsheets.get({ spreadsheetId: tab.spreadsheetId,
    ranges: selected.map(entry => `'Calls'!${columnName}${entry.row}:${columnName}${entry.row}`), includeGridData: true,
    fields: "spreadsheetId,sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue))))" });
  if (result.data.spreadsheetId !== tab.spreadsheetId) throw new Error("literal_phone_response_workbook_mismatch");
  const found = new Map<number, sheets_v4.Schema$CellData>();
  for (const sheet of result.data.sheets ?? []) {
    if (sheet.properties?.sheetId !== tab.tabId || sheet.properties.title !== "Calls") throw new Error("literal_phone_response_tab_mismatch");
    for (const grid of sheet.data ?? []) {
      const row = (grid.startRow ?? 0) + 1;
      if ((grid.startColumn ?? 0) !== phoneColumn || !selected.some(entry => entry.row === row) ||
          grid.rowData?.length !== 1 || grid.rowData[0]?.values?.length !== 1 || found.has(row))
        throw new Error("literal_phone_response_cell_mismatch");
      found.set(row, grid.rowData[0].values[0]!);
    }
  }
  if (found.size !== selected.length) throw new Error("literal_phone_response_cell_missing");
  return selected.flatMap(entry => {
    const evidence = literalCallPhoneEvidence({ workbook_id: tab.spreadsheetId, sheet_id: tab.tabId!, row: entry.row,
      column, checker: entry.checker, captured_resolved_value: entry.resolved, cell: found.get(entry.row)! });
    return evidence ? [evidence] : [];
  });
}
