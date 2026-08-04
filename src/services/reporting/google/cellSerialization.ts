import type { SelectedColumn } from "../catalog";

export type LiteralCell = string | number | boolean | null;

/**
 * Serialize a reporting row into literal Sheets cells.
 * Never emits formulas; empty/undefined becomes null (blank cell under RAW).
 */
export function serializeReportingRowCells(
  row: Record<string, unknown>,
  columns: ReadonlyArray<SelectedColumn>,
): LiteralCell[] {
  return columns.map((column) => serializeLiteralCell(row[column.id]));
}

export function serializeReportingHeaderCells(
  columns: ReadonlyArray<SelectedColumn>,
): string[] {
  return columns.map((column) => column.label);
}

export function serializeLiteralCell(value: unknown): LiteralCell {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Reporting cell numbers must be finite.");
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new TypeError("Reporting cell dates must be valid.");
    }
    return value.toISOString();
  }
  if (typeof value === "bigint") return value.toString();
  // Objects/arrays are already projected to vetted scalars by Stage 3; refuse
  // unexpected shapes rather than emitting JSON that could look like a formula.
  throw new TypeError("Reporting cell values must be literal scalars.");
}

export function a1Range(
  sheetTitle: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): string {
  if (
    ![startRow, startCol, endRow, endCol].every(
      (value) => Number.isSafeInteger(value) && value >= 1,
    ) ||
    endRow < startRow ||
    endCol < startCol
  ) {
    throw new TypeError("Invalid A1 range bounds.");
  }
  return `${quoteSheetTitle(sheetTitle)}!${columnLetters(startCol)}${startRow}:${columnLetters(endCol)}${endRow}`;
}

export function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function columnLetters(index: number): string {
  if (!Number.isSafeInteger(index) || index < 1) {
    throw new TypeError("Column index must be a positive integer.");
  }
  let n = index;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}
