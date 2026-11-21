import { resolve } from "node:path";
import { withLocalDatabase } from "./local-database";
import { AGENT_LOCAL, OperatorError } from "./local-safety";
import {
  loadProductionReadConfig, PRODUCTION_APP_NAME, PRODUCTION_DATABASE, productionSheetsApi, READ_ONLY_SHEETS_SCOPE, readOnlyMongo,
  readOnlySheets, readRecords, readTabIdentities, RECORD_SOURCES, sheetsTabReader, snapshotTabReader,
  withProductionReadMongo, type ProductionReadConfig, type ReadOnlyMongo, type TabReader,
} from "./read-only-sources";
import { RECONCILE_TABS, reconcilePlacement, totals, WORKBOOK_TITLES, type ReconcileRecord, type TabIdentity } from "./sheet-reconcile";

export type ReconcileRequest = { target: "local" | "production"; productionRead: boolean; tab?: string; samples: number; snapshot?: string };

const LIMITATIONS = [
  "Read-only: MongoDB find and Google Sheets spreadsheets.get / values.get only. Nothing is queued, written or repaired.",
  "Sheets are read first, then MongoDB, so a record created between the reads shows as missing rather than orphan. The reads are not a snapshot: a record saved within one drain cycle (about five minutes) can show as missing, a record deleted between the reads shows its row as an orphan, and secondaryPreferred replication lag widens both windows.",
  "Master Sheets only. Source Company Sheets and the retired titles Duplicates, Bad Leads and Bad Calls are not read.",
  "Expected tabs come from the server's planExpectedSheetTabs over raw stored flags; the drainer reads the same flags through Mongoose.",
  "Rows with a blank Mongo ID cell (managed cells cleared, operator content kept) are counted, not classified.",
  "Calls and Duplicate Calls are Owner-managed (Owner directive, November 20): report only, no repair suggestion.",
];

function selectedTabs(tab?: string) {
  return RECONCILE_TABS.filter((definition) => !tab || definition.tab === tab);
}

export function readPlan(request: ReconcileRequest, production?: ProductionReadConfig) {
  const tabs = selectedTabs(request.tab);
  const workbooks = (["master_leads", "master_booked"] as const).flatMap((workbook) => {
    const names = tabs.filter((definition) => definition.workbook === workbook).map((definition) => definition.tab);
    if (!names.length) return [];
    const id = production?.spreadsheetIds[workbook];
    return [{ workbook: WORKBOOK_TITLES[workbook], spreadsheet: id ? `…${id.slice(-4)}` : "local snapshot file", tabs: names }];
  });
  return {
    writes: "none",
    mongo: {
      target: production ? `production ${production.mongoHost}` : `local ${AGENT_LOCAL.address} replica ${AGENT_LOCAL.replicaSet}`,
      database: production ? PRODUCTION_DATABASE : AGENT_LOCAL.database,
      operation: "find with an empty filter and an inclusion projection (no customer fields)",
      ...(production ? { read_preference: "secondaryPreferred", app_name: PRODUCTION_APP_NAME } : {}),
      collections: Object.fromEntries(RECORD_SOURCES.map((source) => [source.collection, ["_id", ...source.fields]])),
    },
    sheets: production
      ? { scope: READ_ONLY_SHEETS_SCOPE, methods: ["spreadsheets.get (sheets.properties.title)", "spreadsheets.values.get (row 1 and the Mongo ID column)"], workbooks }
      : { source: request.snapshot, workbooks },
    ...(production ? { env_file: ".env (checkout root)", env_names_used: production.namesUsed } : {}),
  };
}

export function formatReadPlan(plan: ReturnType<typeof readPlan>): string {
  const lines = [
    "sheet-sync reconcile will read (writes: none):",
    `  MongoDB ${plan.mongo.target}, database ${plan.mongo.database}: ${plan.mongo.operation}`,
    ...Object.entries(plan.mongo.collections).map(([collection, fields]) => `    ${collection}: ${fields.join(", ")}`),
    ...(plan.sheets.scope ? [`  Google Sheets scope ${plan.sheets.scope}`, ...(plan.sheets.methods ?? []).map((method) => `    ${method}`)] : [`  Sheets snapshot ${plan.sheets.source}`]),
    ...plan.sheets.workbooks.map((workbook) => `    ${workbook.workbook} (${workbook.spreadsheet}): ${workbook.tabs.join(", ")}`),
    ...("env_names_used" in plan && plan.env_names_used ? [`  from ${plan.env_file}: ${plan.env_names_used.join(", ")} (values never printed)`] : []),
  ];
  return `${lines.join("\n")}\n`;
}

/** Seams for offline tests; production wiring is the default. */
export type ReconcileDependencies = {
  repoRoot: string;
  announce: (text: string) => void;
  withLocalMongo: <T>(read: (mongo: ReadOnlyMongo) => Promise<T>) => Promise<T>;
  withProductionMongo: <T>(config: ProductionReadConfig, read: (mongo: ReadOnlyMongo) => Promise<T>) => Promise<T>;
  productionTabReader: (config: ProductionReadConfig) => TabReader;
  now: () => Date;
};
export const defaultReconcileDependencies: ReconcileDependencies = {
  repoRoot: resolve(__dirname, "../.."),
  announce: (text) => { process.stderr.write(text); },
  withLocalMongo: (read) => withLocalDatabase(AGENT_LOCAL, (db) => read(readOnlyMongo(db))),
  withProductionMongo: withProductionReadMongo,
  productionTabReader: (config) => sheetsTabReader(readOnlySheets(productionSheetsApi(config.serviceAccount)), config.spreadsheetIds),
  now: () => new Date(),
};

export async function runReconcile(request: ReconcileRequest, deps: ReconcileDependencies = defaultReconcileDependencies) {
  if (request.target === "production" && !request.productionRead) throw new OperatorError("production_read_flag_required", 4);
  if (request.target === "local" && !request.snapshot) throw new OperatorError("sheet_snapshot_required_for_local_target", 2);
  const production = request.target === "production" ? loadProductionReadConfig(resolve(deps.repoRoot, ".env")) : undefined;
  const plan = readPlan(request, production);
  deps.announce(formatReadPlan(plan));
  const observedAt = deps.now();
  // Sheets first: a record created between the reads shows as missing, not as an orphan. A deletion between the reads
  // (or secondary lag) can still produce an orphan; LIMITATIONS says so.
  const tabs: TabIdentity[] = await readTabIdentities(production ? deps.productionTabReader(production) : snapshotTabReader(request.snapshot!), request.tab);
  const records: ReconcileRecord[] = production
    ? await deps.withProductionMongo(production, readRecords)
    : await deps.withLocalMongo(readRecords);
  const report = reconcilePlacement(records, tabs, { tab: request.tab, sampleLimit: request.samples });
  return {
    status: report.every((tab) => tab.status === "read") ? "completed" : "partial",
    command: "sheet-sync reconcile", target: request.target, database: plan.mongo.database,
    observed_at: observedAt.toISOString(), records_read: records.length,
    totals: totals(report), tabs: report, read_plan: plan, limitations: LIMITATIONS,
  };
}
