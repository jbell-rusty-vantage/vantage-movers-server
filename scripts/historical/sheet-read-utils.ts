import {
  createGoogleSheetsClient,
  requiredEnv,
} from "./google-sheets-auth";

export type SheetRow = Record<string, string>;

export type BackfillWorkbookKey =
  | "top10"
  | "tbm"
  | "best_relocation"
  | "booked";

export type BackfillTabConfig = {
  name: string;
  kind: "form" | "call" | "booked" | "refund";
  local?: boolean;
};

export type BackfillWorkbookConfig = {
  key: BackfillWorkbookKey;
  label: string;
  envVar: string;
  sourceCompany?: "top10" | "tbm" | "best_relocation";
  tabs: readonly BackfillTabConfig[];
};

export const BACKFILL_WORKBOOKS: readonly BackfillWorkbookConfig[] = [
  {
    key: "top10",
    label: "Top 10",
    envVar: "BACKFILL_TOP10_SHEET_ID",
    sourceCompany: "top10",
    tabs: [
      { name: "Forms", kind: "form" },
      { name: "Calls", kind: "call" },
    ],
  },
  {
    key: "tbm",
    label: "TBM",
    envVar: "BACKFILL_TBM_SHEET_ID",
    sourceCompany: "tbm",
    tabs: [
      { name: "LeadsNew", kind: "form" },
      { name: "Calls", kind: "call" },
    ],
  },
  {
    key: "best_relocation",
    label: "Best Relocation",
    envVar: "BACKFILL_BEST_RELOCATION_SHEET_ID",
    sourceCompany: "best_relocation",
    tabs: [
      { name: "Forms", kind: "form" },
      { name: "Calls", kind: "call" },
      { name: "Local Forms", kind: "form", local: true },
      { name: "Local Calls", kind: "call", local: true },
    ],
  },
  {
    key: "booked",
    label: "Booked",
    envVar: "BACKFILL_BOOKED_SHEET_ID",
    tabs: [
      { name: "Booked Deals", kind: "booked" },
      { name: "Refunds", kind: "refund" },
    ],
  },
] as const;

export function cell(value: unknown): string {
  return String(value ?? "").trim();
}

export function isBlankRow(row: string[] | undefined): boolean {
  return !row || row.every((value) => cell(value) === "");
}

export function parseDate(value: string): Date | undefined {
  const raw = value.trim();
  if (!raw || raw.toUpperCase() === "FORMULAS") return undefined;
  const withoutWeekday = raw.replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+/i, "");
  const parsed = new Date(withoutWeekday);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseDateTime(
  dateValue: string,
  timeValue: string,
): Date | undefined {
  const date = dateValue.trim();
  const time = timeValue.trim();
  if (!date && !time) return undefined;
  return parseDate(`${date} ${time}`);
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const usMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (usMatch) {
    const month = String(Number(usMatch[1])).padStart(2, "0");
    const day = String(Number(usMatch[2])).padStart(2, "0");
    return `${usMatch[3]}-${month}-${day}`;
  }

  const parsed = parseDate(raw);
  return parsed ? toDateKey(parsed) : undefined;
}

export function isDateKeyInRange(
  dateKey: string,
  startKey: string,
  endKey: string,
): boolean {
  return dateKey >= startKey && dateKey <= endKey;
}

function columnToLetter(n: number): string {
  let col = n;
  let s = "";
  while (col > 0) {
    const rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s || "A";
}

function escapeSheetTitleForRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function getHeaderMap(headers: string[], cells: string[]): SheetRow {
  const raw: SheetRow = {};
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]?.trim() || headers[i] || `__col_${i + 1}`;
    raw[header] = cells[i] ?? "";
  }
  return raw;
}

export type ParsedSheetRow = {
  sheetRow: number;
  raw: SheetRow;
};

export type ReadWorkbookTabOptions = {
  maxScanRows?: number;
};

export type ReadWorkbookTabResult = {
  workbook: BackfillWorkbookConfig;
  tab: BackfillTabConfig;
  spreadsheetId: string;
  spreadsheetTitle: string;
  headers: string[];
  rows: ParsedSheetRow[];
  rangeRead: string;
};

export function getWorkbookConfig(
  key: BackfillWorkbookKey,
): BackfillWorkbookConfig {
  const workbook = BACKFILL_WORKBOOKS.find((entry) => entry.key === key);
  if (!workbook) {
    throw new Error(`Unknown workbook key: ${key}`);
  }
  return workbook;
}

export type ReadSpreadsheetTabResult = {
  spreadsheetId: string;
  spreadsheetTitle: string;
  tabName: string;
  headers: string[];
  rows: ParsedSheetRow[];
  rangeRead: string;
};

export async function readSpreadsheetTab(
  spreadsheetId: string,
  tabName: string,
  options: ReadWorkbookTabOptions = {},
): Promise<ReadSpreadsheetTabResult> {
  const maxScanRows = options.maxScanRows ?? 10_000;
  const sheetsApi = createGoogleSheetsClient();

  const { data: meta } = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields:
      "properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)))",
  });

  const spreadsheetTitle = meta.properties?.title ?? "(untitled)";
  const sheetMeta = meta.sheets?.find(
    (sheet: { properties?: { title?: string | null } }) =>
      sheet.properties?.title?.trim() === tabName,
  );
  if (!sheetMeta) {
    throw new Error(`Tab ${tabName} not found in spreadsheet ${spreadsheetId}`);
  }

  const rowCount =
    sheetMeta.properties?.gridProperties?.rowCount ?? maxScanRows;
  const columnCount = sheetMeta.properties?.gridProperties?.columnCount ?? 26;
  const endRow = Math.min(rowCount, maxScanRows);
  const endCol = columnCount > 0 ? columnToLetter(columnCount) : "ZZ";
  const rangeRead = `${escapeSheetTitleForRange(tabName)}!A1:${endCol}${endRow}`;

  const { data } = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: rangeRead,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });

  const matrix = (data.values ?? []).map((row: unknown) =>
    Array.isArray(row) ? row.map((value) => cell(value)) : [],
  );
  if (matrix.length === 0) {
    return {
      spreadsheetId,
      spreadsheetTitle,
      tabName,
      headers: [],
      rows: [],
      rangeRead,
    };
  }

  const headerRow = matrix[0];
  const lastHeaderIndex = headerRow.reduce(
    (max: number, header: string, index: number) =>
      header.length > 0 ? index : max,
    -1,
  );
  const headers =
    lastHeaderIndex >= 0 ? headerRow.slice(0, lastHeaderIndex + 1) : headerRow;

  const rows: ParsedSheetRow[] = [];
  for (let index = 1; index < matrix.length; index++) {
    const cells = matrix[index];
    if (isBlankRow(cells)) continue;
    rows.push({
      sheetRow: index + 1,
      raw: getHeaderMap(headers, cells),
    });
  }

  return {
    spreadsheetId,
    spreadsheetTitle,
    tabName,
    headers,
    rows,
    rangeRead,
  };
}

export async function readWorkbookTab(
  workbookKey: BackfillWorkbookKey,
  tabName: string,
  options: ReadWorkbookTabOptions = {},
): Promise<ReadWorkbookTabResult> {
  const workbook = getWorkbookConfig(workbookKey);
  const tab = workbook.tabs.find((entry) => entry.name === tabName);
  if (!tab) {
    throw new Error(
      `Tab ${tabName} is not configured for workbook ${workbookKey}`,
    );
  }

  const spreadsheetId = requiredEnv(workbook.envVar);
  const sheet = await readSpreadsheetTab(spreadsheetId, tabName, options);

  return {
    workbook,
    tab,
    spreadsheetId: sheet.spreadsheetId,
    spreadsheetTitle: sheet.spreadsheetTitle,
    headers: sheet.headers,
    rows: sheet.rows,
    rangeRead: sheet.rangeRead,
  };
}

export function extractCallTabTimestamp(raw: SheetRow): Date | undefined {
  const combined =
    raw["Date and Time"] ?? raw["Date And Time"] ?? raw["DATE AND TIME"] ?? "";
  if (combined) {
    return parseDate(combined);
  }

  return parseDateTime(raw.Date ?? "", raw.Time ?? "");
}

export function extractCallTabPhone(raw: SheetRow): string {
  return cell(
    raw["PHONE NUMBER"] ??
      raw["Phone Number"] ??
      raw.Phone ??
      raw["PHONE"] ??
      "",
  );
}
