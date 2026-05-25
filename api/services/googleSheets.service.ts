import path from "node:path";
import { google, type sheets_v4 } from "googleapis";
import {
  BOOKED_SHEET_HEADERS,
  CALL_SHEET_HEADERS,
  CANCELLED_SHEET_HEADERS,
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
import {
  formatGoogleApiError,
  redactSpreadsheetId,
  resolveAuthConfigSummary,
  type GoogleAuthConfigSummary,
} from "../utils/googleSheetsDiagnostics";
import { logger } from "../logger";
import type { SheetSyncEntry } from "../models/schemaHelpers";

const SERVICE_ACCOUNT_FILE = process.env.SERVICE_ACCOUNT_LOCAL_FILE;
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEET_ROW_LOOKUP_END_COLUMN = "ZZ";
const LEGACY_CALL_SHEET_HEADER_LENGTH = 18;

let cachedSheetsClient: sheets_v4.Sheets | null = null;
let loggedAuthConfig = false;

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
  ensureTabs: SheetTabConfig[];
};

type SheetTabConfig = {
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
  booked?: PopulatedBookedLead | string | null;
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
  job_no?: string | null;
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  pickup_zip?: string | null;
  delivery_zip?: string | null;
  pickup_state?: string | null;
  delivery_state?: string | null;
  duration?: number | null;
  source_company: SourceCompany;
  booked?: PopulatedBookedLead | string | null;
  cancelled?: unknown;
  over_2000?: boolean | null;
  over_4000?: boolean | null;
  local?: string | null;
  cubic_feet?: number | null;
};

type PopulatedBookedLead = {
  _id: { toString(): string };
  timestamp: Date;
  book_date: Date;
  job_no: string;
  customer?: { full_name?: string | null } | null;
  agent_allocations?: AgentAllocationSheetSource[] | null;
  total_binder_amount: number;
  deposit_amount: number;
  merchant: string;
  source: string;
  local?: string | null;
  cancelled?: unknown;
  lead_ref?: { toString(): string } | string;
};

type AgentAllocationSheetSource = {
  agent_name_snapshot: string;
  binder_amount: number;
};

type BookedLeadSheetSource = SyncableDocument & PopulatedBookedLead;

type CancelledLeadSheetSource = SyncableDocument & {
  timestamp: Date;
  agent?: string | null;
  cancel_date?: Date | null;
  job_no?: string | null;
  customer_name?: string | null;
  refund_amount?: number | null;
  source?: string | null;
  lead_ref?: { toString(): string } | string | null;
};

function getSheetsClient(): sheets_v4.Sheets {
  if (cachedSheetsClient) {
    return cachedSheetsClient;
  }

  const authSummary = resolveAuthConfigSummary();
  logAuthConfigOnce(authSummary);

  const credentials = getServiceAccountCredentials();
  if (!credentials && !SERVICE_ACCOUNT_FILE?.trim()) {
    const message =
      "Google Sheets auth is not configured: set GOOGLE_SERVICE_ACCOUNT_JSON or SERVICE_ACCOUNT_LOCAL_FILE";
    logger.error({ msg: "sheets.auth.missing", auth: authSummary }, message);
    throw new Error(message);
  }

  if (!credentials && SERVICE_ACCOUNT_FILE?.startsWith("=")) {
    logger.warn({
      msg: "sheets.auth.key_file_malformed",
      keyFile: SERVICE_ACCOUNT_FILE,
      hint: "SERVICE_ACCOUNT_LOCAL_FILE looks like it has a stray '=' prefix; fix .env or use GOOGLE_SERVICE_ACCOUNT_JSON",
    });
  }

  const auth = new google.auth.GoogleAuth({
    ...(credentials
      ? { credentials }
      : { keyFile: path.join(process.cwd(), SERVICE_ACCOUNT_FILE!.trim()) }),
    scopes: [SHEETS_SCOPE],
  });

  cachedSheetsClient = google.sheets({ version: "v4", auth });
  return cachedSheetsClient;
}

function logAuthConfigOnce(authSummary: GoogleAuthConfigSummary): void {
  if (loggedAuthConfig) {
    return;
  }

  loggedAuthConfig = true;
  logger.info({
    msg: "sheets.auth.config",
    authSource: authSummary.authSource,
    clientEmail: authSummary.clientEmail ?? null,
    projectId: authSummary.projectId ?? null,
    privateKeyPresent: authSummary.privateKeyPresent,
    keyFile: authSummary.keyFile ?? null,
    scope: SHEETS_SCOPE,
  });
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

  try {
    const parsed = JSON.parse(value) as ServiceAccountCredentials;
    if (typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }

    if (!parsed.client_email?.trim()) {
      logger.warn({
        msg: "sheets.auth.credentials_incomplete",
        hasPrivateKey: Boolean(parsed.private_key?.trim()),
      });
    }

    return parsed;
  } catch (error) {
    const details = formatGoogleApiError(error);
    logger.error(
      {
        err: error,
        msg: "sheets.auth.json_parse_failed",
        authSource: rawJson ? "env_json" : "env_base64",
        parseError: details.message,
        hint: details.hint,
      },
      "Failed to parse Google service account JSON from environment",
    );
    throw error;
  }
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
      ensureTabs: getMasterBookedTabs(),
    },
  ];
  return syncRowToTargets(booking, targets, bookedLeadToRow(booking));
}

export async function syncCancelledLeadToSheets(
  cancellation: CancelledLeadSheetSource,
): Promise<SheetSyncEntry[]> {
  const targets = [
    {
      target: "master_cancelled",
      spreadsheetId: getMasterBookedSheetContainerId(),
      tabName: SHEET_TAB_NAMES.cancelledDeals,
      headers: CANCELLED_SHEET_HEADERS,
      ensureTabs: getMasterBookedTabs(),
    },
  ];
  return syncRowToTargets(cancellation, targets, cancelledLeadToRow(cancellation));
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
        ensureTabs: getMasterBookedTabs(),
      },
    ],
    ["master_booked"],
  );
}

export async function deleteCancelledLeadFromSheets(cancellation: SyncableDocument): Promise<void> {
  await deleteRowsFromTargets(
    cancellation,
    [
      {
        target: "master_cancelled",
        spreadsheetId: getMasterBookedSheetContainerId(),
        tabName: SHEET_TAB_NAMES.cancelledDeals,
        headers: CANCELLED_SHEET_HEADERS,
        ensureTabs: getMasterBookedTabs(),
      },
    ],
    ["master_cancelled"],
  );
}

export async function ensureAllConfiguredSheetTabs(): Promise<void> {
  const sheets = getSheetsClient();
  await ensureTabsAndHeaders(sheets, getMasterLeadsSheetContainerId(), getMasterLeadsTabs());
  await ensureTabsAndHeaders(sheets, getMasterBookedSheetContainerId(), getMasterBookedTabs());

  for (const source of Object.values(SOURCE_COMPANY_CONFIGS)) {
    if (!source.leadSheetEnvVar) {
      continue;
    }
    const sourceLeadSheetContainerId = getRequiredEnv(source.leadSheetEnvVar);
    await ensureTabsAndHeaders(sheets, sourceLeadSheetContainerId, getSourceLeadTabs(source.slug));
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
      ensureTabs: getMasterLeadsTabs(),
    },
  ];
  const sourceSpreadsheetId = getSourceLeadSheetContainerId(sourceCompany);
  if (sourceSpreadsheetId) {
    targets.push({
      target: sourceTarget,
      spreadsheetId: sourceSpreadsheetId,
      tabName,
      headers,
      ensureTabs: getSourceLeadTabs(sourceCompany),
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
  const authSummary = resolveAuthConfigSummary();
  const documentId = document._id.toString();
  const results: SheetSyncEntry[] = [];

  logger.info({
    msg: "sheets.sync.started",
    documentId,
    targetCount: targets.length,
    targets: targets.map((target) => ({
      target: target.target,
      spreadsheetId: redactSpreadsheetId(target.spreadsheetId),
      tabName: target.tabName,
    })),
    clientEmail: authSummary.clientEmail ?? null,
  });

  for (const target of targets) {
    try {
      await ensureTabsAndHeaders(sheets, target.spreadsheetId, target.ensureTabs);
      const existingSync = document.sheet_sync?.find((entry) => entry.target === target.target);
      const rowNumber = await upsertRow(
        sheets,
        target.spreadsheetId,
        target.tabName,
        target.headers,
        row,
        documentId,
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
      logger.info({
        msg: "sheets.sync.target.ok",
        documentId,
        target: target.target,
        spreadsheetId: redactSpreadsheetId(target.spreadsheetId),
        tabName: target.tabName,
        rowNumber: rowNumber ?? null,
      });
    } catch (error) {
      const details = formatGoogleApiError(error);
      const lastError = details.hint ? `${details.message} — ${details.hint}` : details.message;

      logger.error(
        {
          err: error,
          msg: "sheets.sync.target.failed",
          documentId,
          target: target.target,
          spreadsheetId: redactSpreadsheetId(target.spreadsheetId),
          tabName: target.tabName,
          clientEmail: authSummary.clientEmail ?? null,
          googleCode: details.code ?? null,
          googleStatus: details.status ?? null,
          googleReasons: details.reasons,
          hint: details.hint ?? null,
          lastError,
        },
        "Google Sheets sync failed for target",
      );

      results.push({
        target: target.target,
        spreadsheet_id: target.spreadsheetId,
        tab_name: target.tabName,
        status: "failed",
        last_error: lastError,
        updated_since_last_sync: true,
      });
    }
  }

  const failed = results.filter((entry) => entry.status === "failed").length;
  logger.info({
    msg: "sheets.sync.finished",
    documentId,
    synced: results.length - failed,
    failed,
  });

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
    await clearLegacyTrailingCells(sheets, spreadsheetId, tabName, headers, rowNumber);
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
      ensureTabs: getEnsureTabsForSyncTarget(entry.target),
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
    case "master_cancelled":
      return CANCELLED_SHEET_HEADERS;
    default:
      return undefined;
  }
}

function getEnsureTabsForSyncTarget(target: string): SheetTabConfig[] {
  switch (target) {
    case "master_forms":
    case "master_calls":
      return getMasterLeadsTabs();
    case "source_forms":
    case "source_calls":
      return [
        { tabName: SHEET_TAB_NAMES.forms, headers: FORM_SHEET_HEADERS },
        { tabName: SHEET_TAB_NAMES.calls, headers: CALL_SHEET_HEADERS },
        { tabName: SHEET_TAB_NAMES.badLeads, headers: FORM_SHEET_HEADERS },
        { tabName: SHEET_TAB_NAMES.badCalls, headers: CALL_SHEET_HEADERS },
      ];
    case "master_booked":
    case "master_cancelled":
      return getMasterBookedTabs();
    default:
      return [];
  }
}

function getMasterLeadsTabs(): SheetTabConfig[] {
  return [
    { tabName: SHEET_TAB_NAMES.forms, headers: FORM_SHEET_HEADERS },
    { tabName: SHEET_TAB_NAMES.calls, headers: CALL_SHEET_HEADERS },
  ];
}

function getMasterBookedTabs(bookedHeaders: readonly string[] = BOOKED_SHEET_HEADERS): SheetTabConfig[] {
  return [
    { tabName: SHEET_TAB_NAMES.bookedDeals, headers: bookedHeaders },
    { tabName: SHEET_TAB_NAMES.cancelledDeals, headers: CANCELLED_SHEET_HEADERS },
  ];
}

function getSourceLeadTabs(sourceCompany: SourceCompany): SheetTabConfig[] {
  const tabs = getMasterLeadsTabs();
  if (SOURCE_COMPANY_CONFIGS[sourceCompany].hasBadTabs) {
    tabs.push(
      { tabName: SHEET_TAB_NAMES.badLeads, headers: FORM_SHEET_HEADERS },
      { tabName: SHEET_TAB_NAMES.badCalls, headers: CALL_SHEET_HEADERS },
    );
  }

  return tabs;
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
    range: `${escapeSheetTitleForRange(tabName)}!A:${SHEET_ROW_LOOKUP_END_COLUMN}`,
  });
  const rows = response.data.values ?? [];
  const mongoIdIndex = headers.indexOf("Mongo ID");
  if (mongoIdIndex < 0) {
    return undefined;
  }

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row[mongoIdIndex] === mongoId || row.includes(mongoId)) {
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
    range: `${escapeSheetTitleForRange(tabName)}!A${rowNumber}:${SHEET_ROW_LOOKUP_END_COLUMN}${rowNumber}`,
  });
  const row = response.data.values?.[0] ?? [];
  return row[mongoIdIndex] === mongoId || row.includes(mongoId);
}

async function ensureTabsAndHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabs: SheetTabConfig[],
): Promise<void> {
  for (const tab of tabs) {
    await ensureTab(sheets, spreadsheetId, tab.tabName);
    await clearLegacyTrailingCells(sheets, spreadsheetId, tab.tabName, tab.headers, 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${escapeSheetTitleForRange(tab.tabName)}!A1:${columnLetter(tab.headers.length)}1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[...tab.headers]] },
    });
  }
}

async function clearLegacyTrailingCells(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  headers: readonly string[],
  rowNumber: number,
): Promise<void> {
  const legacyHeaderLength = getLegacyHeaderLength(headers);
  if (legacyHeaderLength <= headers.length) {
    return;
  }

  await clearSheetValues(
    sheets,
    spreadsheetId,
    `${escapeSheetTitleForRange(tabName)}!${columnLetter(headers.length + 1)}${rowNumber}:${columnLetter(
      legacyHeaderLength,
    )}${rowNumber}`,
  );
}

function getLegacyHeaderLength(headers: readonly string[]): number {
  return headers === CALL_SHEET_HEADERS ? LEGACY_CALL_SHEET_HEADER_LENGTH : headers.length;
}

async function clearSheetValues(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  range: string,
): Promise<void> {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range,
  });
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
    bookedDateCell(lead.booked),
    overThresholdCell(Boolean(lead.over_2000), ">2k"),
    overThresholdCell(Boolean(lead.over_4000), ">4k"),
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
  return [
    formatTimestamp(lead.timestamp),
    lead.job_no ?? "",
    lead.phone_number ?? "",
    formatNumber(lead.duration),
    bookedCell(Boolean(lead.booked)),
    bookedDateCell(lead.booked),
    overThresholdCell(Boolean(lead.over_2000), ">2k"),
    overThresholdCell(Boolean(lead.over_4000), ">4k"),
    cancelledCell(Boolean(lead.cancelled)),
    optionalLocalCell(lead.local),
    formatNumber(lead.cubic_feet),
    lead._id.toString(),
    getSourceCompanyLabel(lead.source_company),
  ];
}

function bookedLeadToRow(booking: BookedLeadSheetSource): string[] {
  const allocations = booking.agent_allocations ?? [];
  return [
    formatTimestamp(booking.timestamp),
    allocations[0]?.agent_name_snapshot ?? "",
    allocations[1]?.agent_name_snapshot ?? "",
    formatNumber(booking.total_binder_amount),
    splitCell(allocations),
    formatDateOnly(booking.book_date),
    booking.job_no,
    booking.customer?.full_name ?? "",
    formatNumber(booking.deposit_amount),
    booking.merchant,
    booking.source,
    booking._id.toString(),
    typeof booking.lead_ref === "string" ? booking.lead_ref : booking.lead_ref?.toString() ?? "",
    optionalLocalCell(booking.local),
    cancelledCell(Boolean(booking.cancelled)),
  ];
}

function cancelledLeadToRow(cancellation: CancelledLeadSheetSource): string[] {
  return [
    formatTimestamp(cancellation.timestamp),
    cancellation.agent ?? "",
    cancellation.cancel_date ? formatDateOnly(cancellation.cancel_date) : "",
    cancellation.job_no ?? "",
    cancellation.customer_name ?? "",
    formatNumber(cancellation.refund_amount),
    cancellation.source ?? "",
    cancellation._id.toString(),
    typeof cancellation.lead_ref === "string"
      ? cancellation.lead_ref
      : cancellation.lead_ref?.toString() ?? "",
  ];
}

function primaryBookingAgent(booking?: PopulatedBookedLead): string {
  return booking?.agent_allocations?.[0]?.agent_name_snapshot ?? "";
}

function splitCell(allocations: AgentAllocationSheetSource[]): string {
  const namedAllocations = allocations.filter((allocation) => allocation.agent_name_snapshot.trim());
  const nonZeroAmount = allocations.some((allocation) => allocation.binder_amount !== 0);
  return namedAllocations.length >= 2 && allocations.length >= 2 && nonZeroAmount ? "TRUE" : "FALSE";
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

function optionalLocalCell(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return localCell(value);
}

function bookedCell(value: boolean): string {
  return value ? "booked" : "";
}

function bookedDateCell(booking: PopulatedBookedLead | string | null | undefined): string {
  if (!booking || typeof booking === "string") {
    return "";
  }

  return formatDateOnly(booking.book_date);
}

function overThresholdCell(value: boolean, label: ">2k" | ">4k"): string {
  return value ? label : "";
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
