import path from "node:path";
import { google, type sheets_v4 } from "googleapis";
import {
  BOOKED_SHEET_HEADERS,
  CALL_SHEET_HEADERS,
  FORM_SHEET_HEADERS,
  getMasterBookedSheetContainerId,
  getMasterLeadsSheetContainerId,
  getRequiredEnv,
  getSourceCompanyLabel,
  getSourceLeadSheetContainerId,
  SHEET_TAB_NAMES,
  SOURCE_COMPANY_CONFIGS,
  type SourceCompany,
} from "../config/domain";
import {
  escapeSheetTitleForRange,
  extractRowNumberFromRange,
} from "../utils/googleSheetsRanges";
import type { SheetSyncEntry } from "../models/schemaHelpers";

const SERVICE_ACCOUNT_FILE = process.env.SERVICE_ACCOUNT_LOCAL_FILE;
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedSheetsClient: sheets_v4.Sheets | null = null;

type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

type SyncTarget = {
  target: string;
  spreadsheetId: string;
  tabName: string;
  headers: readonly string[];
};

type SyncableDocument = {
  _id: { toString(): string };
  sheet_sync?: SheetSyncEntry[];
};

type FormLeadSheetSource = SyncableDocument & {
  timestamp: Date;
  name: string;
  pickup_zip: string;
  destination_zip: string;
  pickup_state: string;
  delivery_state: string;
  move_size: string;
  move_date: Date;
  phone_number: string;
  ref_no?: string | null;
  booked?: unknown;
  over_2000?: boolean | null;
  over_4000?: boolean | null;
  cancelled?: unknown;
  local: string;
  cubic_feet?: number | null;
  lid?: string | null;
  source_company: SourceCompany;
  source_company_site?: string | null;
  quoted?: boolean | null;
  cpl?: number | null;
};

type CallLeadSheetSource = SyncableDocument & {
  timestamp: Date;
  duration?: number | null;
  source_company: SourceCompany;
  booked?: PopulatedBookedLead | string | null;
  cancelled?: unknown;
  local?: string | null;
};

type PopulatedBookedLead = {
  _id: { toString(): string };
  timestamp: Date;
  agent: string;
  book_date: Date;
  job_no: string;
  customer?: { full_name?: string | null } | null;
  binder_amount: number;
  deposit_amount: number;
  merchant: string;
  source: string;
  local: string;
  cancelled?: unknown;
  lead_ref?: { toString(): string } | string;
};

type BookedLeadSheetSource = SyncableDocument & PopulatedBookedLead;

function getSheetsClient(): sheets_v4.Sheets {
  if (cachedSheetsClient) {
    return cachedSheetsClient;
  }

  const credentials = getServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    ...(credentials
      ? { credentials }
      : { keyFile: path.join(process.cwd(), SERVICE_ACCOUNT_FILE!) }),
    scopes: [SHEETS_SCOPE],
  });

  cachedSheetsClient = google.sheets({ version: "v4", auth });
  return cachedSheetsClient;
}

function getServiceAccountCredentials(): ServiceAccountCredentials | undefined {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const value =
    rawJson ??
    (base64Json ? Buffer.from(base64Json, "base64").toString("utf8") : undefined);

  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(value) as ServiceAccountCredentials;
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  return parsed;
}

export async function syncFormLeadToSheets(
  lead: FormLeadSheetSource,
): Promise<SheetSyncEntry[]> {
  const targets = getLeadTargets(
    "master_forms",
    "source_forms",
    lead.source_company,
    SHEET_TAB_NAMES.forms,
    FORM_SHEET_HEADERS,
  );
  return syncRowToTargets(lead, targets, formLeadToRow(lead));
}

export async function syncCallLeadToSheets(
  lead: CallLeadSheetSource,
): Promise<SheetSyncEntry[]> {
  const targets = getLeadTargets(
    "master_calls",
    "source_calls",
    lead.source_company,
    SHEET_TAB_NAMES.calls,
    CALL_SHEET_HEADERS,
  );
  return syncRowToTargets(lead, targets, callLeadToRow(lead));
}

export async function syncBookedLeadToSheets(
  booking: BookedLeadSheetSource,
): Promise<SheetSyncEntry[]> {
  const targets = [
    {
      target: "master_booked",
      spreadsheetId: getMasterBookedSheetContainerId(),
      tabName: SHEET_TAB_NAMES.bookedDeals,
      headers: BOOKED_SHEET_HEADERS,
    },
  ];
  return syncRowToTargets(booking, targets, bookedLeadToRow(booking));
}

export async function deleteFormLeadFromSheets(
  lead: SyncableDocument & { source_company: SourceCompany },
): Promise<void> {
  await deleteRowsFromTargets(
    lead,
    getLeadTargets(
      "master_forms",
      "source_forms",
      lead.source_company,
      SHEET_TAB_NAMES.forms,
      FORM_SHEET_HEADERS,
    ),
    ["master_forms", "source_forms"],
  );
}

export async function deleteCallLeadFromSheets(
  lead: SyncableDocument & { source_company: SourceCompany },
): Promise<void> {
  await deleteRowsFromTargets(
    lead,
    getLeadTargets(
      "master_calls",
      "source_calls",
      lead.source_company,
      SHEET_TAB_NAMES.calls,
      CALL_SHEET_HEADERS,
    ),
    ["master_calls", "source_calls"],
  );
}

export async function deleteBookedLeadFromSheets(booking: SyncableDocument): Promise<void> {
  await deleteRowsFromTargets(
    booking,
    [
      {
        target: "master_booked",
        spreadsheetId: getMasterBookedSheetContainerId(),
        tabName: SHEET_TAB_NAMES.bookedDeals,
        headers: BOOKED_SHEET_HEADERS,
      },
    ],
    ["master_booked"],
  );
}

export async function ensureAllConfiguredSheetTabs(): Promise<void> {
  const sheets = getSheetsClient();
  await ensureTabsAndHeaders(sheets, getMasterLeadsSheetContainerId(), [
    { tabName: SHEET_TAB_NAMES.forms, headers: FORM_SHEET_HEADERS },
    { tabName: SHEET_TAB_NAMES.calls, headers: CALL_SHEET_HEADERS },
  ]);
  await ensureTabsAndHeaders(sheets, getMasterBookedSheetContainerId(), [
    { tabName: SHEET_TAB_NAMES.bookedDeals, headers: BOOKED_SHEET_HEADERS },
  ]);

  for (const source of Object.values(SOURCE_COMPANY_CONFIGS)) {
    if (!source.leadSheetEnvVar) {
      continue;
    }
    const sourceLeadSheetContainerId = getRequiredEnv(source.leadSheetEnvVar);
    const tabs = [
      { tabName: SHEET_TAB_NAMES.forms, headers: FORM_SHEET_HEADERS },
      { tabName: SHEET_TAB_NAMES.calls, headers: CALL_SHEET_HEADERS },
    ];
    await ensureTabsAndHeaders(sheets, sourceLeadSheetContainerId, tabs);
    if (source.hasBadTabs) {
      await ensureTabsOnly(sheets, sourceLeadSheetContainerId, [
        SHEET_TAB_NAMES.badLeads,
        SHEET_TAB_NAMES.badCalls,
      ]);
    }
  }
}

function getLeadTargets(
  masterTarget: string,
  sourceTarget: string,
  sourceCompany: SourceCompany,
  tabName: string,
  headers: readonly string[],
): SyncTarget[] {
  const targets: SyncTarget[] = [
    {
      target: masterTarget,
      spreadsheetId: getMasterLeadsSheetContainerId(),
      tabName,
      headers,
    },
  ];
  const sourceSpreadsheetId = getSourceLeadSheetContainerId(sourceCompany);
  if (sourceSpreadsheetId) {
    targets.push({
      target: sourceTarget,
      spreadsheetId: sourceSpreadsheetId,
      tabName,
      headers,
    });
  }

  return targets;
}

async function syncRowToTargets(
  document: SyncableDocument,
  targets: SyncTarget[],
  row: string[],
): Promise<SheetSyncEntry[]> {
  const sheets = getSheetsClient();
  const results: SheetSyncEntry[] = [];
  for (const target of targets) {
    try {
      await ensureTabsAndHeaders(sheets, target.spreadsheetId, [
        { tabName: target.tabName, headers: target.headers },
      ]);
      const existingSync = document.sheet_sync?.find((entry) => entry.target === target.target);
      const rowNumber = await upsertRow(
        sheets,
        target.spreadsheetId,
        target.tabName,
        target.headers,
        row,
        document._id.toString(),
        existingSync?.row_number,
      );
      results.push({
        target: target.target,
        spreadsheet_id: target.spreadsheetId,
        tab_name: target.tabName,
        row_number: rowNumber,
        status: "synced",
        last_synced_at: new Date(),
        updated_since_last_sync: false,
      });
    } catch (error) {
      results.push({
        target: target.target,
        spreadsheet_id: target.spreadsheetId,
        tab_name: target.tabName,
        status: "failed",
        last_error: error instanceof Error ? error.message : "Unknown Sheets sync error",
        updated_since_last_sync: true,
      });
    }
  }

  return results;
}

async function upsertRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
  row: string[],
  mongoId: string,
  knownRowNumber?: number,
): Promise<number | undefined> {
  const rowNumber =
    knownRowNumber &&
    (await rowNumberContainsMongoId(sheets, spreadsheetId, tabName, headers, mongoId, knownRowNumber))
      ? knownRowNumber
      : await findRowNumberByMongoId(sheets, spreadsheetId, tabName, headers, mongoId);
  if (rowNumber) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tabName)}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });
    return rowNumber;
  }

  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A:${columnLetter(headers.length)}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return extractRowNumberFromRange(response.data.updates?.updatedRange);
}

async function deleteRowsFromTargets(
  document: SyncableDocument,
  fallbackTargets: SyncTarget[],
  syncedTargets: readonly string[],
): Promise<void> {
  const sheets = getSheetsClient();
  const targets = getDeleteTargets(document, fallbackTargets, syncedTargets);
  for (const target of targets) {
    const rowNumber =
      target.knownRowNumber &&
      (await rowNumberContainsMongoId(
        sheets,
        target.spreadsheetId,
        target.tabName,
        target.headers,
        document._id.toString(),
        target.knownRowNumber,
      ))
        ? target.knownRowNumber
        : await findRowNumberByMongoId(
            sheets,
            target.spreadsheetId,
            target.tabName,
            target.headers,
            document._id.toString(),
          );
    if (!rowNumber) {
      continue;
    }

    await deleteSheetRow(sheets, target.spreadsheetId, target.tabName, rowNumber);
  }
}

function getDeleteTargets(
  document: SyncableDocument,
  fallbackTargets: SyncTarget[],
  syncedTargets: readonly string[],
): (SyncTarget & { knownRowNumber?: number })[] {
  const byKey = new Map<string, SyncTarget & { knownRowNumber?: number }>();
  for (const target of fallbackTargets) {
    const existingSync = document.sheet_sync?.find((entry) => entry.target === target.target);
    byKey.set(deleteTargetKey(target.spreadsheetId, target.tabName), {
      ...target,
      knownRowNumber: existingSync?.row_number,
    });
  }

  for (const entry of document.sheet_sync ?? []) {
    if (!syncedTargets.includes(entry.target)) {
      continue;
    }
    const headers = getHeadersForSyncTarget(entry.target);
    if (!headers) {
      continue;
    }
    byKey.set(deleteTargetKey(entry.spreadsheet_id, entry.tab_name), {
      target: entry.target,
      spreadsheetId: entry.spreadsheet_id,
      tabName: entry.tab_name,
      headers,
      knownRowNumber: entry.row_number,
    });
  }

  return [...byKey.values()];
}

function deleteTargetKey(spreadsheetId: string, tabName: string): string {
  return `${spreadsheetId}:${tabName}`;
}

function getHeadersForSyncTarget(target: string): readonly string[] | undefined {
  switch (target) {
    case "master_forms":
    case "source_forms":
      return FORM_SHEET_HEADERS;
    case "master_calls":
    case "source_calls":
      return CALL_SHEET_HEADERS;
    case "master_booked":
      return BOOKED_SHEET_HEADERS;
    default:
      return undefined;
  }
}

async function deleteSheetRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  rowNumber: number,
): Promise<void> {
  const sheetId = await getExistingSheetId(sheets, spreadsheetId, tabName);
  if (sheetId === undefined) {
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}

async function findRowNumberByMongoId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
  mongoId: string,
): Promise<number | undefined> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A:${columnLetter(headers.length)}`,
  });
  const rows = response.data.values ?? [];
  const mongoIdIndex = headers.indexOf("Mongo ID");
  if (mongoIdIndex < 0) {
    return undefined;
  }

  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index]?.[mongoIdIndex] === mongoId) {
      return index + 1;
    }
  }

  return undefined;
}

async function rowNumberContainsMongoId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
  mongoId: string,
  rowNumber: number,
): Promise<boolean> {
  const mongoIdIndex = headers.indexOf("Mongo ID");
  if (mongoIdIndex < 0) {
    return false;
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`,
  });
  return response.data.values?.[0]?.[mongoIdIndex] === mongoId;
}

async function ensureTabsAndHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: { tabName: string; headers: readonly string[] }[],
): Promise<void> {
  for (const tab of tabs) {
    await ensureTab(sheets, spreadsheetId, tab.tabName);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tab.tabName)}!A1:${columnLetter(tab.headers.length)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[...tab.headers]] },
    });
  }
}

async function ensureTabsOnly(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabNames: readonly string[],
): Promise<void> {
  for (const tabName of tabNames) {
    await ensureTab(sheets, spreadsheetId, tabName);
  }
}

async function ensureTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<number | undefined> {
  const existing = await getExistingSheetId(sheets, spreadsheetId, tabName);
  if (existing !== undefined) {
    return existing;
  }

  try {
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: tabName } } }],
      },
    });
    return response.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
  } catch (error) {
    if (!isGoogleSheetAlreadyExistsError(error)) {
      throw error;
    }
    return getExistingSheetId(sheets, spreadsheetId, tabName);
  }
}

async function getExistingSheetId(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<number | undefined> {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  return response.data.sheets?.find((sheet) => sheet.properties?.title === tabName)?.properties?.sheetId ?? undefined;
}

function formLeadToRow(lead: FormLeadSheetSource): string[] {
  return [
    formatTimestamp(lead.timestamp),
    lead.name,
    lead.pickup_zip,
    lead.destination_zip,
    lead.pickup_state,
    lead.delivery_state,
    lead.move_size,
    formatDateOnly(lead.move_date),
    lead.phone_number,
    lead._id.toString(),
    lead.ref_no?.trim() || "not provided",
    bookedCell(Boolean(lead.booked)),
    booleanCell(Boolean(lead.over_2000)),
    booleanCell(Boolean(lead.over_4000)),
    cancelledCell(Boolean(lead.cancelled)),
    localCell(lead.local),
    formatNumber(lead.cubic_feet),
    lead.lid ?? "",
    getSourceCompanyLabel(lead.source_company),
    lead.source_company_site ?? "",
    quotedCell(Boolean(lead.quoted)),
  ];
}

function callLeadToRow(lead: CallLeadSheetSource): string[] {
  const booked = typeof lead.booked === "object" && lead.booked !== null ? lead.booked : undefined;
  return [
    formatTimestamp(lead.timestamp),
    formatNumber(lead.duration),
    booked?.agent ?? "",
    booked?.book_date ? formatDateOnly(booked.book_date) : "",
    booked?.job_no ?? "",
    booked?.customer?.full_name ?? "",
    formatNumber(booked?.binder_amount),
    formatNumber(booked?.deposit_amount),
    booked?.merchant ?? "",
    booked?.source ?? "",
    lead._id.toString(),
    localCell(booked?.local ?? lead.local),
    cancelledCell(Boolean(lead.cancelled ?? booked?.cancelled)),
  ];
}

function bookedLeadToRow(booking: BookedLeadSheetSource): string[] {
  return [
    formatTimestamp(booking.timestamp),
    booking.agent,
    formatDateOnly(booking.book_date),
    booking.job_no,
    booking.customer?.full_name ?? "",
    formatNumber(booking.binder_amount),
    formatNumber(booking.deposit_amount),
    booking.merchant,
    booking.source,
    booking._id.toString(),
    typeof booking.lead_ref === "string" ? booking.lead_ref : booking.lead_ref?.toString() ?? "",
    localCell(booking.local),
    cancelledCell(Boolean(booking.cancelled)),
  ];
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function formatTimestamp(value: Date): string {
  const date = `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
  const time = [value.getHours(), value.getMinutes(), value.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return `${date} ${time}`;
}

function booleanCell(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

function localCell(value: string | null | undefined): string {
  return value === "local" ? "local" : "long_distance";
}

function bookedCell(value: boolean): string {
  return value ? "booked" : "";
}

function cancelledCell(value: boolean): string {
  return value ? "cancelled" : "";
}

function quotedCell(value: boolean): string {
  return value ? "quoted" : "";
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? "" : String(value);
}

function columnLetter(columnNumber: number): string {
  let letter = "";
  let n = columnNumber;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }

  return letter;
}

function isGoogleSheetAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const status = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? String((error as { message?: unknown }).message) : "";
  return status === 400 && message.toLowerCase().includes("already exists");
}
