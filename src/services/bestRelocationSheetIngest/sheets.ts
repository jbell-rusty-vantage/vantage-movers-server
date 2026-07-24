import path from "node:path";
import { google } from "googleapis";
import {
  cell,
  parseBookedDealRows,
  parseCallRows,
  parseFormRows,
  parseLidBestRelo,
  parseRefundRows,
} from "./parsing";
import type { ParsedWorkbookData, SourceTab, TabReadResult } from "./types";

//
export const DEFAULT_LEADS_SHEET_ID =
  "13mp2vRyVKerAWBFfRvmEMjftDJE_QIbf14pzdKxsODg";
export const DEFAULT_BOOKED_SHEET_ID =
  "1M5fzPdvtbj9LvcaXxE_qdHBJcOdhmtNfhZlv13hgaXk";

type SheetsClient = ReturnType<typeof google.sheets>;

export async function readBestRelocationWorkbooks(
  input: {
    leadsSheetId?: string;
    bookedSheetId?: string;
    sheetsClient?: SheetsClient;
  } = {},
): Promise<ParsedWorkbookData> {
  const leadsSheetId =
    input.leadsSheetId ??
    (process.env.BEST_RELOCATION_SYNC_SHEET_ID?.trim() || undefined) ??
    (process.env.BACKFILL_BEST_RELOCATION_SHEET_ID?.trim() || undefined) ??
    DEFAULT_LEADS_SHEET_ID;
  const bookedSheetId =
    input.bookedSheetId ??
    (process.env.BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID?.trim() || undefined) ??
    (process.env.BACKFILL_BOOKED_SHEET_ID?.trim() || undefined) ??
    DEFAULT_BOOKED_SHEET_ID;
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
    forms: parseFormRows(forms, "Forms"),
    localForms: parseFormRows(localForms, "Local Forms"),
    calls: parseCallRows(calls),
    booked: parseBookedDealRows(booked),
    refunds: parseRefundRows(refunds),
    lidBestRelo: parseLidBestRelo(lidBestRelo),
  };
}

export function createSheetsClient(): SheetsClient {
  const auth = new google.auth.GoogleAuth({
    ...serviceAccountAuthSource(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function readTab(
  client: SheetsClient,
  spreadsheetId: string,
  tabName: SourceTab,
): Promise<TabReadResult> {
  const { data: metadata } = await client.spreadsheets.get({
    spreadsheetId,
    fields:
      "properties.title,sheets(properties(title,gridProperties(rowCount,columnCount)))",
  });
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
  const { data } = await client.spreadsheets.values.get({
    spreadsheetId,
    range: rangeRead,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
  });
  const matrix = (data.values ?? []).map((row) =>
    Array.isArray(row) ? row.map(cell) : [],
  );
  const headerRow = matrix[0] ?? [];
  const lastHeader = headerRow.reduce(
    (last, header, index) => (header ? index : last),
    -1,
  );
  return {
    spreadsheetId,
    spreadsheetTitle: metadata.properties?.title ?? "(untitled)",
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
