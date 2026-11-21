/**
 * The only IO the Sheet Sync reconcile uses. Read-only by construction:
 *
 * - MongoDB: the reconcile receives a frozen wrapper whose single method runs
 *   `find` with a fixed empty filter on four allowlisted collections. The client
 *   itself never leaves this module.
 * - Google Sheets: the production client is authorized with the
 *   `spreadsheets.readonly` scope, so Google refuses any write, and the
 *   reconcile receives a frozen wrapper that calls only `spreadsheets.get`
 *   (tab titles) and `spreadsheets.values.get` (header row and Mongo ID column).
 *
 * No customer field is projected from Mongo, and no Sheets column other than
 * the header row and the Mongo ID column is fetched.
 */
import dns from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parse as parseEnv } from "dotenv";
import { google, type sheets_v4 } from "googleapis";
import { MongoClient, type Db, type Document } from "mongodb";
import { escapeSheetTitleForRange } from "../../src/utils/googleSheets/ranges";
import { OperatorError } from "./local-safety";
import { parseTabIdentity, RECONCILE_TABS, type ReconcileRecord, type RecordModel, type TabIdentity, type WorkbookKey } from "./sheet-reconcile";

export const READ_ONLY_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const PRODUCTION_DATABASE = "vantagemovers";
export const PRODUCTION_APP_NAME = "vantage-cli-sheet-reconcile-readonly";
export const QUERY_TIMEOUT_MS = 120_000;

const FLAG_FIELDS = [
  "duplicate", "bad_lead", "no_sync", "form_fill", "created_on_unmatched", "external_sheet_review", "external_call_admission",
  "source_company", "lead_source_company", "source_granularity_id", "timestamp", "ingestion_origin",
  // Only the RingCentral facts that admission and the overnight rule read; never caller numbers.
  ...["ingestion_source", "qualification_reason", "duration_seconds", "telephony_session_id", "call_log_id", "start_time",
    "final_result", "final_result_observed_at", "final_result_call_log_id", "final_result_answered"].map((field) => `ringcentral.${field}`),
];
export const RECORD_SOURCES = [
  { collection: "form_leads", model: "FormLead", fields: FLAG_FIELDS },
  { collection: "call_leads", model: "CallLead", fields: FLAG_FIELDS },
  { collection: "booked_leads", model: "BookedLead", fields: [] as string[] },
  { collection: "cancelled_leads", model: "CancelledLead", fields: [] as string[] },
] as const satisfies readonly { collection: string; model: RecordModel; fields: readonly string[] }[];
export type ReadOnlyCollection = (typeof RECORD_SOURCES)[number]["collection"];
const COLLECTIONS: ReadonlySet<string> = new Set(RECORD_SOURCES.map((source) => source.collection));

export type ReadOnlyMongo = { readonly findAll: (collection: ReadOnlyCollection, fields: readonly string[]) => Promise<Document[]> };

/** Wraps a database handle so that only an allowlisted, projected, time-bounded `find` is reachable. */
export function readOnlyMongo(db: Db): ReadOnlyMongo {
  return Object.freeze({
    findAll: async (collection: ReadOnlyCollection, fields: readonly string[]) => {
      if (!COLLECTIONS.has(collection)) throw new OperatorError("read_only_collection_refused", 2);
      if (fields.some((field) => !/^[a-z_]+(\.[a-z_]+)?$/.test(field))) throw new OperatorError("read_only_projection_refused", 2);
      const projection = Object.fromEntries([["_id", 1], ...fields.map((field) => [field, 1])]);
      return db.collection(collection).find({}, { projection, maxTimeMS: QUERY_TIMEOUT_MS, batchSize: 2_000 }).toArray();
    },
  });
}

/** The two Sheets calls the reconcile may make, with fixed field masks. */
export type ReadOnlySheets = {
  readonly listTabTitles: (spreadsheetId: string) => Promise<string[]>;
  readonly getValues: (spreadsheetId: string, range: string) => Promise<unknown[][] | undefined>;
};
type SheetsReadApi = {
  spreadsheets: {
    get: (params: sheets_v4.Params$Resource$Spreadsheets$Get) => Promise<{ data: sheets_v4.Schema$Spreadsheet }>;
    values: { get: (params: sheets_v4.Params$Resource$Spreadsheets$Values$Get) => Promise<{ data: sheets_v4.Schema$ValueRange }> };
  };
};
export function readOnlySheets(api: SheetsReadApi): ReadOnlySheets {
  return Object.freeze({
    listTabTitles: async (spreadsheetId: string) => {
      const { data } = await api.spreadsheets.get({ spreadsheetId, includeGridData: false, fields: "sheets.properties.title" });
      return (data.sheets ?? []).flatMap((sheet) => typeof sheet.properties?.title === "string" ? [sheet.properties.title] : []);
    },
    getValues: async (spreadsheetId: string, range: string) => {
      const { data } = await api.spreadsheets.values.get({ spreadsheetId, range, majorDimension: "ROWS", valueRenderOption: "FORMATTED_VALUE" });
      return data.values ?? undefined;
    },
  });
}

export type ServiceAccountSource = { credentials: Record<string, unknown> } | { keyFile: string };
export function readOnlyGoogleAuthOptions(source: ServiceAccountSource) {
  return { ...source, scopes: [READ_ONLY_SHEETS_SCOPE] };
}
export function productionSheetsApi(source: ServiceAccountSource): SheetsReadApi {
  return google.sheets({ version: "v4", auth: new google.auth.GoogleAuth(readOnlyGoogleAuthOptions(source)) }) as unknown as SheetsReadApi;
}

/** One tab's header row and Mongo ID column, or why it could not be read. */
export type TabReader = (workbook: WorkbookKey, tab: string) => Promise<{ header: unknown; identity: unknown } | "absent">;

function columnLetter(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

export function sheetsTabReader(sheets: ReadOnlySheets, spreadsheetIds: Record<WorkbookKey, string>): TabReader {
  const titles = new Map<WorkbookKey, Promise<string[]>>();
  return async (workbook, tab) => {
    const id = spreadsheetIds[workbook];
    if (!titles.has(workbook)) titles.set(workbook, sheets.listTabTitles(id));
    if (!(await titles.get(workbook)!).includes(tab)) return "absent";
    const title = escapeSheetTitleForRange(tab);
    const header = (await sheets.getValues(id, `${title}!1:1`))?.[0];
    const column = Array.isArray(header) ? header.indexOf("Mongo ID") : -1;
    if (column < 0 || header!.lastIndexOf("Mongo ID") !== column) return { header, identity: undefined };
    const letter = columnLetter(column);
    return { header, identity: await sheets.getValues(id, `${title}!${letter}:${letter}`) };
  };
}

/** Local target: a JSON workbook snapshot `{ "master_leads": { "Forms": [[header...], [row...]] }, "master_booked": {...} }`. */
export function snapshotTabReader(path: string): TabReader {
  let snapshot: unknown;
  try { snapshot = JSON.parse(readFileSync(path, "utf8")); } catch { throw new OperatorError("sheet_snapshot_unreadable", 2); }
  if (!snapshot || typeof snapshot !== "object") throw new OperatorError("sheet_snapshot_unreadable", 2);
  return async (workbook, tab) => {
    const grid = (snapshot as Record<string, Record<string, unknown> | undefined>)[workbook]?.[tab];
    if (!Array.isArray(grid)) return "absent";
    const header = grid[0];
    const column = Array.isArray(header) ? header.indexOf("Mongo ID") : -1;
    if (column < 0) return { header, identity: undefined };
    // Same shape values.get returns for one column: trailing blanks dropped, blank cells as [].
    const identity = grid.map((row) => Array.isArray(row) && row[column] !== undefined && row[column] !== "" ? [row[column]] : []);
    while (identity.length > 1 && identity.at(-1)!.length === 0) identity.pop();
    return { header, identity };
  };
}

export async function readTabIdentities(reader: TabReader, tab?: string): Promise<TabIdentity[]> {
  const identities: TabIdentity[] = [];
  for (const definition of RECONCILE_TABS.filter((entry) => !tab || entry.tab === tab)) {
    const read = await reader(definition.workbook, definition.tab);
    identities.push(read === "absent"
      ? { tab: definition.tab, workbook: definition.workbook, status: "absent", code: "tab_absent" }
      : parseTabIdentity(definition, read.header, read.identity));
  }
  return identities;
}

export async function readRecords(mongo: ReadOnlyMongo): Promise<ReconcileRecord[]> {
  const records: ReconcileRecord[] = [];
  for (const source of RECORD_SOURCES) {
    for (const document of await mongo.findAll(source.collection, source.fields)) {
      const id = typeof document._id?.toHexString === "function" ? document._id.toHexString() : String(document._id);
      records.push({ id, model: source.model, flags: document, origin: typeof document.ingestion_origin === "string" ? document.ingestion_origin : null });
    }
  }
  return records;
}

export type ProductionReadConfig = {
  envFile: string; mongoUri: string; mongoHost: string; dnsServers: string[];
  spreadsheetIds: Record<WorkbookKey, string>; serviceAccount: ServiceAccountSource; namesUsed: string[];
};

/** Reads only named keys from the checkout's `.env`; never copies them into process.env. */
export function loadProductionReadConfig(envFile: string): ProductionReadConfig {
  if (!existsSync(envFile)) throw new OperatorError("production_read_env_missing", 3);
  const env = parseEnv(readFileSync(envFile));
  const value = (name: string) => env[name]?.trim() || undefined;
  if (value("TEST_MODE") !== "false") throw new OperatorError("production_read_requires_test_mode_false", 3);
  const mongoUri = value("MONGO_URI");
  const leads = value("MASTER_LEADS_SHEET_ID"), booked = value("MASTER_BOOKED_SHEET_ID");
  if (!mongoUri || !/^mongodb(\+srv)?:\/\//.test(mongoUri) || !leads || !booked) throw new OperatorError("production_read_env_incomplete", 3);
  const namesUsed = ["TEST_MODE", "MONGO_URI", "MASTER_LEADS_SHEET_ID", "MASTER_BOOKED_SHEET_ID"];
  let serviceAccount: ServiceAccountSource;
  const json = value("GOOGLE_SERVICE_ACCOUNT_JSON");
  const base64 = value("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  const keyFile = value("SERVICE_ACCOUNT_LOCAL_FILE");
  try {
    if (json || base64) {
      const credentials = JSON.parse(json ?? Buffer.from(base64!, "base64").toString("utf8")) as Record<string, unknown>;
      if (typeof credentials.private_key === "string") credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
      serviceAccount = { credentials };
      namesUsed.push(json ? "GOOGLE_SERVICE_ACCOUNT_JSON" : "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
    } else if (keyFile) {
      serviceAccount = { keyFile: isAbsolute(keyFile) ? keyFile : resolve(envFile, "..", keyFile) };
      namesUsed.push("SERVICE_ACCOUNT_LOCAL_FILE");
    } else throw new OperatorError("production_read_env_incomplete", 3);
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError("production_read_service_account_unparseable", 3);
  }
  const dnsServers = value("MONGO_DNS_SERVERS")?.split(",").map((server) => server.trim()).filter(Boolean) ?? [];
  if (dnsServers.length) namesUsed.push("MONGO_DNS_SERVERS");
  // Only the provider domain is printed; the cluster name stays out of logs and evidence.
  const host = mongoUri.replace(/^mongodb(\+srv)?:\/\/([^@/]*@)?/, "").split(/[/?,:]/)[0] ?? "";
  const mongoHost = host.split(".").length > 2 ? `…${host.split(".").slice(-2).join(".")}` : "redacted";
  return { envFile, mongoUri, mongoHost, dnsServers, spreadsheetIds: { master_leads: leads, master_booked: booked }, serviceAccount, namesUsed };
}

/** Opens production Mongo for reading. The client is closed here; callers only see the read-only wrapper. */
export async function withProductionReadMongo<T>(config: ProductionReadConfig, read: (mongo: ReadOnlyMongo) => Promise<T>): Promise<T> {
  if (config.dnsServers.length) dns.setServers(config.dnsServers);
  const client = new MongoClient(config.mongoUri, {
    appName: PRODUCTION_APP_NAME, readPreference: "secondaryPreferred", retryWrites: false,
    maxPoolSize: 2, serverSelectionTimeoutMS: 20_000, connectTimeoutMS: 20_000,
  });
  try {
    await client.connect();
    return await read(readOnlyMongo(client.db(PRODUCTION_DATABASE)));
  } finally { await client.close(); }
}
