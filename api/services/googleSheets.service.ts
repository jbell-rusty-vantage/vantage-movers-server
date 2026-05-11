import path from "node:path";
import { google, type sheets_v4 } from "googleapis";
import { SheetTab } from "../models/SheetTab";
import { escapeSheetTitleForRange, extractRowNumberFromRange } from "../utils/googleSheetsRanges";
import { getCompanyLeadSheetName } from "../utils/sheetNames";
import {
  LEAD_SHEET_HEADERS,
  LEAD_SHEET_NAME,
  leadToSheetRow,
  type LeadSheetRowSource,
} from "../utils/sheetRows";

const SERVICE_ACCOUNT_FILE = "just-cosmos-437222-b7-f8ab65674d85.json";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedSheetsClient: sheets_v4.Sheets | null = null;

type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

type SyncLeadResult = {
  mainSheetRowNumber?: number;
  companySheetName: string;
  companySheetRowNumber?: number;
};

type SyncedLeadSheetRowSource = LeadSheetRowSource & {
  mainSheetRowNumber?: number | null;
  companySheetName?: string | null;
  companySheetRowNumber?: number | null;
};

type AppendRowResult = {
  rowNumber?: number;
};

function getSpreadsheetId(): string {
  const spreadsheetId = process.env.MAIN_GOOGLE_SHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error("MAIN_GOOGLE_SHEET_ID is not set");
  }

  return spreadsheetId;
}

function getSheetsClient(): sheets_v4.Sheets {
  if (cachedSheetsClient) {
    return cachedSheetsClient;
  }

  const credentials = getServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    ...(credentials
      ? { credentials }
      : { keyFile: path.join(process.cwd(), SERVICE_ACCOUNT_FILE) }),
    scopes: [SHEETS_SCOPE],
  });

  cachedSheetsClient = google.sheets({ version: "v4", auth });
  return cachedSheetsClient;
}

function getServiceAccountCredentials(): ServiceAccountCredentials | undefined {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const value = rawJson ?? (base64Json ? Buffer.from(base64Json, "base64").toString("utf8") : undefined);

  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(value) as ServiceAccountCredentials;
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  return parsed;
}

export async function syncLeadToSheets(lead: LeadSheetRowSource): Promise<SyncLeadResult> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const row = leadToSheetRow(lead);

  await writeLeadHeaders(sheets, spreadsheetId, LEAD_SHEET_NAME);
  const mainAppend = await appendRow(sheets, spreadsheetId, LEAD_SHEET_NAME, row);
  const companySheetName = await getOrCreateCompanyLeadTab(
    sheets,
    spreadsheetId,
    lead.sourceCompanySite,
  );
  await writeLeadHeaders(sheets, spreadsheetId, companySheetName);
  const companyAppend = await appendRow(sheets, spreadsheetId, companySheetName, row);

  return {
    mainSheetRowNumber: mainAppend.rowNumber,
    companySheetName,
    companySheetRowNumber: companyAppend.rowNumber,
  };
}

export async function updateLeadInSheets(lead: SyncedLeadSheetRowSource): Promise<SyncLeadResult> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const row = leadToSheetRow(lead);
  await writeLeadHeaders(sheets, spreadsheetId, LEAD_SHEET_NAME);
  const mainUpdate = lead.mainSheetRowNumber
    ? await updateRow(sheets, spreadsheetId, LEAD_SHEET_NAME, lead.mainSheetRowNumber, row)
    : await appendRow(sheets, spreadsheetId, LEAD_SHEET_NAME, row);
  const companySheetName = await getOrCreateCompanyLeadTab(
    sheets,
    spreadsheetId,
    lead.sourceCompanySite,
  );
  await writeLeadHeaders(sheets, spreadsheetId, companySheetName);
  if (
    lead.companySheetName &&
    lead.companySheetName !== companySheetName &&
    lead.companySheetRowNumber
  ) {
    await clearRow(sheets, spreadsheetId, lead.companySheetName, lead.companySheetRowNumber);
  }
  const companyUpdate =
    lead.companySheetName === companySheetName && lead.companySheetRowNumber
      ? await updateRow(sheets, spreadsheetId, companySheetName, lead.companySheetRowNumber, row)
      : await appendRow(sheets, spreadsheetId, companySheetName, row);

  return {
    mainSheetRowNumber: mainUpdate.rowNumber,
    companySheetName,
    companySheetRowNumber: companyUpdate.rowNumber,
  };
}

async function appendRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  row: string[],
): Promise<AppendRowResult> {
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A:${getLastLeadColumnLetter()}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row],
    },
  });

  return {
    rowNumber: extractRowNumberFromRange(response.data.updates?.updatedRange),
  };
}

async function updateRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  rowNumber: number,
  row: string[],
): Promise<AppendRowResult> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A${rowNumber}:${getLastLeadColumnLetter()}${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });

  return { rowNumber };
}

async function clearRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  rowNumber: number,
): Promise<void> {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A${rowNumber}:${getLastLeadColumnLetter()}${rowNumber}`,
  });
}

async function getOrCreateCompanyLeadTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sourceCompanySite: string,
): Promise<string> {
  const tabName = getCompanyLeadSheetName(sourceCompanySite);
  const existing = await SheetTab.findOne({
    spreadsheetId,
    companySite: sourceCompanySite,
    tabType: "LEADS",
  });

  if (existing && existing.tabName === tabName) {
    return existing.tabName;
  }

  const existingGoogleSheetId = await getExistingSheetId(sheets, spreadsheetId, tabName);
  const googleSheetId =
    existingGoogleSheetId ?? (await createCompanyLeadTab(sheets, spreadsheetId, tabName));

  await writeLeadHeaders(sheets, spreadsheetId, tabName);

  if (existing) {
    existing.tabName = tabName;
    existing.googleSheetId = googleSheetId;
    await existing.save();
    return tabName;
  }

  try {
    await SheetTab.create({
      spreadsheetId,
      companySite: sourceCompanySite,
      tabName,
      tabType: "LEADS",
      googleSheetId,
    });
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
  }

  return tabName;
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

  const sheet = response.data.sheets?.find((item) => item.properties?.title === tabName);
  return sheet?.properties?.sheetId ?? undefined;
}

async function createCompanyLeadTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<number | undefined> {
  try {
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: tabName,
              },
            },
          },
        ],
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

async function writeLeadHeaders(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escapeSheetTitleForRange(tabName)}!A1:${getLastLeadColumnLetter()}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[...LEAD_SHEET_HEADERS]],
    },
  });
}

function getLastLeadColumnLetter(): string {
  let columnNumber: number = LEAD_SHEET_HEADERS.length;
  let letter = "";

  while (columnNumber > 0) {
    const remainder = (columnNumber - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    columnNumber = Math.floor((columnNumber - 1) / 26);
  }

  return letter;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function isGoogleSheetAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const status = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = "message" in error ? String((error as { message?: unknown }).message) : "";
  return status === 400 && message.toLowerCase().includes("already exists");
}
