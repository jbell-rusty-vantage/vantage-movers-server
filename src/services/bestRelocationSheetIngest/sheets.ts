import path from "node:path";
import { google, type sheets_v4 } from "googleapis";
import {
  cell,
  parseBookedDealRows,
  parseCallRows,
  parseFormRows,
  parseLidBestRelo,
  parseRefundRows,
} from "./parsing";
import type { ParsedWorkbookData, SourceTab, TabReadResult } from "./types";

export const BEST_RELOCATION_CUTOFF = new Date("2026-04-30T04:00:00.000Z");
export const BEST_RELOCATION_TIMEZONE = "America/New_York";

export type SheetsClient = ReturnType<typeof google.sheets>;

export async function readBestRelocationWorkbooks(
  input: {
    leadsSheetId?: string;
    bookedSheetId?: string;
    sheetsClient?: SheetsClient;
    cutoff?: Date;
    sourceReadThrough?: Date;
    onDeprecationWarning?: (message: string) => void;
  } = {},
): Promise<ParsedWorkbookData> {
  const { leadsSheetId, bookedSheetId } = resolveWorkbookIds(input);
  const cutoff = input.cutoff ?? BEST_RELOCATION_CUTOFF;
  const sourceReadThrough = input.sourceReadThrough ?? new Date();
  if (sourceReadThrough.getTime() <= cutoff.getTime()) {
    throw new Error("sourceReadThrough must be after the Best Relocation cutoff");
  }
  const client = input.sheetsClient ?? createSheetsClient();
  const [forms, localForms, calls, booked, refunds, lidBestRelo] =
    await Promise.all([
      readTab(client, leadsSheetId, "Forms"),
      readTab(client, leadsSheetId, "Local Forms"),
      readTab(client, leadsSheetId, "Calls"),
      readTab(client, bookedSheetId, "Booked Deals"),
      readTab(client, bookedSheetId, "Refunds"),
      readTab(client, bookedSheetId, "LID_BestRelo"),
    ]);
  return {
    leadsWorkbook: { id: leadsSheetId, title: forms.spreadsheetTitle },
    bookedWorkbook: { id: bookedSheetId, title: booked.spreadsheetTitle },
    forms: inWindow(parseFormRows(forms, "Forms"), cutoff, sourceReadThrough),
    localForms: inWindow(
      parseFormRows(localForms, "Local Forms"),
      cutoff,
      sourceReadThrough,
    ),
    calls: inWindow(parseCallRows(calls), cutoff, sourceReadThrough),
    booked: inWindow(parseBookedDealRows(booked), cutoff, sourceReadThrough),
    refunds: inWindow(
      parseRefundRows(refunds),
      cutoff,
      sourceReadThrough,
      (row) => row.timestamp,
    ),
    lidBestRelo: parseLidBestRelo(lidBestRelo),
  };
}

export function createSheetsClient(): SheetsClient {
  return createSheetsClientWithScope(
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  );
}

export function createWritableSheetsClient(): SheetsClient {
  return createSheetsClientWithScope(
    "https://www.googleapis.com/auth/spreadsheets",
  );
}

function createSheetsClientWithScope(scope: string): SheetsClient {
  const auth = new google.auth.GoogleAuth({
    ...serviceAccountAuthSource(),
    // Both clients remain Sheets-only. Write scope is constructed solely for
    // fenced managed-identity repair.
    scopes: [scope],
  });
  // googleapis overload resolution often drops `auth` on Options under TS 6.
  return google.sheets({
    version: "v4",
    auth,
  } as unknown as sheets_v4.Options);
}

export function resolveWorkbookIds(input: {
  leadsSheetId?: string;
  bookedSheetId?: string;
  onDeprecationWarning?: (message: string) => void;
} = {}): { leadsSheetId: string; bookedSheetId: string } {
  const warn = input.onDeprecationWarning ?? ((message: string) => console.warn(message));
  const leadsAlias = process.env.BACKFILL_BEST_RELOCATION_SHEET_ID?.trim();
  const bookedAlias = process.env.BACKFILL_BOOKED_SHEET_ID?.trim();
  const leadsSheetId =
    input.leadsSheetId?.trim() ||
    process.env.BEST_RELOCATION_SYNC_SHEET_ID?.trim() ||
    leadsAlias;
  const bookedSheetId =
    input.bookedSheetId?.trim() ||
    process.env.BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID?.trim() ||
    bookedAlias;
  if (!input.leadsSheetId && !process.env.BEST_RELOCATION_SYNC_SHEET_ID?.trim() && leadsAlias) {
    warn(
      "BACKFILL_BEST_RELOCATION_SHEET_ID is deprecated; use BEST_RELOCATION_SYNC_SHEET_ID.",
    );
  }
  if (
    !input.bookedSheetId &&
    !process.env.BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID?.trim() &&
    bookedAlias
  ) {
    warn(
      "BACKFILL_BOOKED_SHEET_ID is deprecated; use BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID.",
    );
  }
  if (!leadsSheetId || !bookedSheetId) {
    throw new Error(
      "BEST_RELOCATION_SYNC_SHEET_ID and BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID are required.",
    );
  }
  return { leadsSheetId, bookedSheetId };
}

function inWindow<T extends { timestamp_ms?: number; timestamp?: string }>(
  rows: T[],
  cutoff: Date,
  readThrough: Date,
  selectTimestamp?: (row: T) => string | number | undefined,
): T[] {
  return rows.filter((row) => {
    const selected = selectTimestamp?.(row);
    const timestamp =
      typeof selected === "number"
        ? selected
        : selected
          ? Date.parse(selected)
          : row.timestamp_ms ??
            (row.timestamp ? Date.parse(row.timestamp) : Number.NaN);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Authoritative source row has an invalid timestamp");
    }
    return isWithinIngestionWindow(
      new Date(timestamp),
      cutoff,
      readThrough,
    );
  });
}

export function isWithinIngestionWindow(
  timestamp: Date,
  cutoff: Date,
  sourceReadThrough: Date,
): boolean {
  return (
    Number.isFinite(timestamp.getTime()) &&
    timestamp.getTime() >= cutoff.getTime() &&
    timestamp.getTime() < sourceReadThrough.getTime()
  );
}

export async function readTab(
  client: SheetsClient,
  spreadsheetId: string,
  tabName: SourceTab,
): Promise<TabReadResult> {
  const metadataResponse = await client.spreadsheets.get({
    spreadsheetId,
    fields:
      "properties.title,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
  }, {});
  const metadata = metadataResponse.data as sheets_v4.Schema$Spreadsheet;
  const sheet = metadata.sheets?.find(
    (candidate) => candidate.properties?.title?.trim() === tabName,
  );
  if (!sheet) throw new Error(`Tab "${tabName}" not found in ${spreadsheetId}`);
  const rowCount = Math.min(
    sheet.properties?.gridProperties?.rowCount ?? 10_000,
    10_000,
  );
  const columnCount = sheet.properties?.gridProperties?.columnCount ?? 26;
  const rangeRead = `'${tabName.replace(/'/g, "''")}'!A1:${columnLetter(columnCount)}${rowCount}`;
  const valueResponse = await client.spreadsheets.values.get({
    spreadsheetId,
    range: rangeRead,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  }, {});
  const data = valueResponse.data as sheets_v4.Schema$ValueRange;
  const matrix = ((data.values ?? []) as unknown[][]).map((row) =>
    row.map(cell),
  );
  const headerRow = matrix[0] ?? [];
  const lastHeader = headerRow.reduce(
    (last, header, index) => (header ? index : last),
    -1,
  );
  return {
    spreadsheetId,
    spreadsheetTitle: metadata.properties?.title ?? "(untitled)",
    tabId: sheet.properties?.sheetId ?? undefined,
    tabName,
    headers: lastHeader >= 0 ? headerRow.slice(0, lastHeader + 1) : [],
    matrix,
    rangeRead,
  };
}

function serviceAccountAuthSource():
  | { credentials: Record<string, unknown> }
  | { keyFile: string } {
  const inline =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ??
    (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim()
      ? Buffer.from(
          process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64.trim(),
          "base64",
        ).toString("utf8")
      : undefined);
  if (inline) {
    const credentials = JSON.parse(inline) as Record<string, unknown>;
    if (typeof credentials.private_key === "string") {
      credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }
    return { credentials };
  }
  const keyFile =
    process.env.SERVICE_ACCOUNT_LOCAL_FILE?.trim() ??
    process.env.SERVICE_ACCOUNT_LOCAL_FILE_JSON?.trim();
  if (!keyFile) {
    throw new Error(
      "Missing Google service-account credentials (GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, or SERVICE_ACCOUNT_LOCAL_FILE).",
    );
  }
  return { keyFile: path.resolve(process.cwd(), keyFile) };
}

function columnLetter(value: number): string {
  let column = Math.max(1, value);
  let result = "";
  while (column > 0) {
    result = String.fromCharCode(65 + ((column - 1) % 26)) + result;
    column = Math.floor((column - 1) / 26);
  }
  return result;
}
