import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { Db } from "mongodb";
import { parseCommand } from "./commands";
import { OperatorError } from "./local-safety";
import {
  loadProductionReadConfig, READ_ONLY_SHEETS_SCOPE, readOnlyGoogleAuthOptions, readOnlyMongo, readOnlySheets,
  readTabIdentities, sheetsTabReader, snapshotTabReader, type ReadOnlyMongo,
} from "./read-only-sources";
import { defaultReconcileDependencies, runReconcile, type ReconcileDependencies } from "./sheet-reconcile-command";
import {
  CATEGORIES, formatReconcileSummary, parseTabIdentity, RECONCILE_TABS, reconcilePlacement, type ReconcileRecord, type TabIdentity,
} from "./sheet-reconcile";

const id = (n: number) => `6a0000000000000000${String(n).padStart(6, "0")}`;
const qualified = { ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_elapsed_at_least_120s", duration_seconds: 300, call_log_id: "log-1" };
const SECRET_NOTE = "SECRET-CUSTOMER-NOTE";
const records: ReconcileRecord[] = [
  { id: id(1), model: "FormLead", flags: { source_company: "tbm_leads" }, origin: "wordpress_form" },
  { id: id(2), model: "FormLead", flags: { source_company: "tbm_leads" }, origin: "wordpress_form" },
  { id: id(3), model: "FormLead", flags: { source_company: "tbm_leads", duplicate: true }, origin: "legacy_unknown" },
  { id: id(4), model: "FormLead", flags: { source_company: "tbm_leads", bad_lead: "dc_number", external_sheet_review: { raw_value: SECRET_NOTE } }, origin: "wordpress_form" },
  { id: id(5), model: "FormLead", flags: { source_company: "tbm_leads", no_sync: true }, origin: "vantage_admin" },
  { id: id(11), model: "CallLead", flags: { source_company: "tbm_leads", ringcentral: qualified }, origin: "ringcentral" },
  { id: id(12), model: "CallLead", flags: { source_company: "tbm_leads", ringcentral: qualified }, origin: "ringcentral" },
  { id: id(13), model: "CallLead", flags: { source_company: "top10_leads" }, origin: "legacy_unknown" },
  { id: id(14), model: "CallLead", flags: { source_company: "tbm_leads", ringcentral: qualified, form_fill: true }, origin: "legacy_unknown" },
  { id: id(15), model: "CallLead", flags: { source_company: "tbm_leads", ringcentral: qualified, created_on_unmatched: true }, origin: "granot_lead_created" },
  { id: id(21), model: "BookedLead", flags: {} },
  { id: id(22), model: "BookedLead", flags: {} },
  { id: id(31), model: "CancelledLead", flags: {} },
];
function tab(name: string, ids: (string | null)[], header?: unknown[]): TabIdentity {
  const definition = RECONCILE_TABS.find((entry) => entry.tab === name)!;
  return parseTabIdentity(definition, header ?? [...definition.headers], [["Mongo ID"], ...ids.map((value) => value ? [value] : [])]);
}
const tabs: TabIdentity[] = [
  tab("Forms", [id(1), null, id(3), id(5), "not-an-id", null]),
  tab("Duplicate Forms", []),
  tab("Bad Form Leads", [id(4), id(4)]),
  tab("Calls", [id(11), id(13), id(14)]),
  tab("Duplicate Calls", [id(15)]),
  tab("Bad Call Leads", [], ["Mongo ID", "Mongo ID"]),
  tab("Booked Deals", [id(21)]),
  tab("Cancelled Deals", [id(31), id(99)]),
];
const byTab = (name: string) => reconcilePlacement(records, tabs).find((entry) => entry.tab === name)!;
const ids = (name: string, category: (typeof CATEGORIES)[number]) => byTab(name).categories[category].samples.map((sample) => sample.id);

test("every placement category is found in both directions, per tab", () => {
  assert.deepEqual(ids("Forms", "missing"), [id(2)]);
  assert.deepEqual(ids("Forms", "wrong_tab"), [id(3)]);
  assert.deepEqual(byTab("Forms").categories.wrong_tab.samples[0]!.expected, ["Duplicate Forms"]);
  assert.deepEqual(ids("Forms", "orphan"), ["not-an-id"]);
  assert.deepEqual(byTab("Forms").categories.orphan.breakdown, { invalid_mongo_id: 1 });
  assert.deepEqual(ids("Forms", "excluded"), [id(5)]);
  assert.deepEqual(byTab("Forms").categories.excluded.samples[0]!.reasons, ["no_sync"]);
  assert.equal(byTab("Forms").blank_id_rows, 2);
  assert.equal(byTab("Forms").placed, 1);
  assert.deepEqual(ids("Duplicate Forms", "missing"), [id(3)]);
  assert.deepEqual(ids("Bad Form Leads", "duplicate"), [id(4)]);
  assert.deepEqual(byTab("Bad Form Leads").categories.duplicate.samples[0]!.rows, [2, 3]);
  assert.equal(byTab("Bad Form Leads").categories.missing.count, 0);
  assert.deepEqual(ids("Calls", "missing"), [id(12)]);
  assert.deepEqual(ids("Calls", "excluded"), [id(13)]);
  assert.deepEqual(byTab("Calls").categories.excluded.samples[0]!.reasons, ["missing_call_reporting_admission"]);
  assert.deepEqual(ids("Calls", "wrong_tab"), [id(14)]);
  assert.deepEqual(ids("Duplicate Calls", "missing"), [id(14)]);
  assert.deepEqual(ids("Duplicate Calls", "excluded"), [id(15)]);
  assert.deepEqual(byTab("Duplicate Calls").categories.excluded.samples[0]!.reasons, ["created_on_unmatched"]);
  assert.deepEqual(ids("Booked Deals", "missing"), [id(22)]);
  assert.deepEqual(ids("Cancelled Deals", "orphan"), [id(99)]);
  assert.deepEqual(byTab("Cancelled Deals").categories.orphan.breakdown, { no_record: 1 });
});

test("an unreadable tab never proves absence", () => {
  const bad = byTab("Bad Call Leads");
  assert.equal(bad.status, "identity_unreadable");
  assert.equal(bad.code, "sheet_identity_header_invalid");
  for (const category of CATEGORIES) assert.equal(bad.categories[category].count, null);
  const absent = reconcilePlacement(records, []).find((entry) => entry.tab === "Forms")!;
  assert.equal(absent.status, "absent");
  assert.equal(absent.categories.missing.count, null);
});

test("Calls and Duplicate Calls are Owner-managed and carry no repair suggestion", () => {
  for (const name of ["Calls", "Duplicate Calls"]) {
    const report = byTab(name);
    assert.equal(report.owner_managed, true);
    assert.match(report.label!, /Owner directive, November 20/);
    for (const category of CATEGORIES) assert.equal(report.categories[category].repair, null, `${name} ${category}`);
  }
  assert.equal(byTab("Bad Call Leads").owner_managed, false);
  assert.match(byTab("Bad Call Leads").categories.missing.repair!, /Calls-tab rule/);
  assert.match(byTab("Forms").categories.missing.repair!, /Owner approval only.*createdBy: "script"/);
});

test("--tab narrows the report and sample limits are explicit", () => {
  const only = reconcilePlacement(records, tabs, { tab: "Calls", sampleLimit: 0 });
  assert.deepEqual(only.map((entry) => entry.tab), ["Calls"]);
  assert.equal(only[0]!.categories.missing.count, 1);
  assert.deepEqual(only[0]!.categories.missing.samples, []);
  assert.equal(only[0]!.categories.missing.more, true);
});

test("identity parsing mirrors the drainer's tab row map", () => {
  const forms = RECONCILE_TABS[0];
  assert.equal(parseTabIdentity(forms, ["Timestamp"], [["Mongo ID"]]).status, "identity_unreadable");
  assert.equal(parseTabIdentity(forms, [...forms.headers], [["Not Mongo"]]).status, "identity_unreadable");
  assert.equal(parseTabIdentity(forms, [...forms.headers], [["Mongo ID"], ["a", "b"]]).status, "identity_unreadable");
  const shifted = parseTabIdentity(forms, ["Extra", ...forms.headers], [["Mongo ID"], [id(1)]]);
  assert.equal(shifted.status === "read" && shifted.managedHeadersMatch, false);
});

test("reports and summaries carry IDs, rows and reason codes, never stored customer values", () => {
  const report = reconcilePlacement(records, tabs);
  assert.ok(!JSON.stringify(report).includes(SECRET_NOTE));
  const text = formatReconcileSummary({ target: "local", database: "testvantagemovers_agent", observed_at: "2026-11-21T00:00:00.000Z", tabs: report, limitations: ["x"] });
  assert.match(text, /Calls .*Owner-managed/);
  assert.match(text, /identity_unreadable \(sheet_identity_header_invalid\)/);
  assert.ok(!text.includes(SECRET_NOTE));
});

test("the Mongo wrapper exposes only an allowlisted, projected find", async () => {
  const touched: string[] = [];
  const calls: unknown[][] = [];
  const db = new Proxy({}, { get: (_target, property) => {
    if (property !== "collection") throw new Error(`db.${String(property)} is not allowed`);
    return (name: string) => new Proxy({}, { get: (_c, method) => {
      touched.push(`${name}.${String(method)}`);
      if (method !== "find") throw new Error(`write path ${String(method)} reached`);
      return (...args: unknown[]) => { calls.push(args); return { toArray: async () => [] }; };
    } });
  } }) as unknown as Db;
  const mongo = readOnlyMongo(db);
  assert.ok(Object.isFrozen(mongo));
  assert.deepEqual(Object.keys(mongo), ["findAll"]);
  await mongo.findAll("form_leads", ["duplicate", "ringcentral.call_log_id"]);
  assert.deepEqual(touched, ["form_leads.find"]);
  assert.deepEqual(calls[0]![0], {});
  assert.deepEqual(Object.keys(calls[0]![1] as object).sort(), ["batchSize", "maxTimeMS", "projection"]);
  await assert.rejects(mongo.findAll("sheet_sync_jobs" as never, []), (error) => error instanceof OperatorError);
  await assert.rejects(mongo.findAll("form_leads", ["$where"]), (error) => error instanceof OperatorError);
});

test("the Sheets wrapper reaches only spreadsheets.get and spreadsheets.values.get, with the readonly scope", async () => {
  const touched: string[] = [];
  const params: Record<string, unknown>[] = [];
  const watch = (path: string): unknown => new Proxy(() => undefined, {
    get: (_target, property) => { touched.push(`${path}.${String(property)}`); return watch(`${path}.${String(property)}`); },
    apply: (_target, _this, args) => {
      if (!["root.spreadsheets.get", "root.spreadsheets.values.get"].includes(path)) throw new Error(`write path ${path} reached`);
      params.push(args[0]);
      return Promise.resolve({ data: path.endsWith("values.get") ? { values: [["Mongo ID"]] } : { sheets: [{ properties: { title: "Forms" } }] } });
    },
  });
  const sheets = readOnlySheets(watch("root") as never);
  assert.ok(Object.isFrozen(sheets));
  assert.deepEqual(Object.keys(sheets), ["listTabTitles", "getValues"]);
  const identities = await readTabIdentities(sheetsTabReader(sheets, { master_leads: "leads", master_booked: "booked" }), "Forms");
  // The fake header is a lone Mongo ID cell: readable identity, managed headers differ.
  assert.deepEqual(identities[0], { tab: "Forms", workbook: "master_leads", status: "read", managedHeadersMatch: false, rows: [], blankRows: 0 });
  assert.deepEqual([...new Set(touched)].sort(), ["root.spreadsheets", "root.spreadsheets.get", "root.spreadsheets.values", "root.spreadsheets.values.get"]);
  assert.equal(params[0]!.includeGridData, false);
  assert.equal(params[0]!.fields, "sheets.properties.title");
  assert.deepEqual(readOnlyGoogleAuthOptions({ credentials: {} }).scopes, [READ_ONLY_SHEETS_SCOPE]);
  assert.equal(READ_ONLY_SHEETS_SCOPE, "https://www.googleapis.com/auth/spreadsheets.readonly");
});

test("reconcile sources contain no write call and import no writer", () => {
  const files = ["sheet-reconcile.ts", "read-only-sources.ts", "sheet-reconcile-command.ts"].map((file) => readFileSync(resolve(__dirname, file), "utf8"));
  for (const source of files) {
    assert.doesNotMatch(source, /\.(insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|replaceOne|bulkWrite|findOneAndUpdate|findOneAndDelete|findOneAndReplace|createIndex|dropIndex|drop|batchUpdate|append|clear|batchClear|command)\(/);
    assert.doesNotMatch(source, /\$merge|\$out\b/);
    assert.doesNotMatch(source, /from "[^"]*(sheetSyncOutbox|googleSheets\/auth|src\/db|googleSheets\.service|batchWriter)"/);
  }
});

function dependencies(overrides: Partial<ReconcileDependencies> = {}): ReconcileDependencies & { announced: string[] } {
  const announced: string[] = [];
  const fake: ReadOnlyMongo = Object.freeze({ findAll: async (collection: string) => records
    .filter((record) => ({ form_leads: "FormLead", call_leads: "CallLead", booked_leads: "BookedLead", cancelled_leads: "CancelledLead" } as Record<string, string>)[collection] === record.model)
    .map((record) => ({ _id: record.id, ingestion_origin: record.origin, ...record.flags })) });
  return { ...defaultReconcileDependencies, announced, announce: (text) => { announced.push(text); },
    withLocalMongo: (read) => read(fake), withProductionMongo: (_config, read) => read(fake),
    productionTabReader: () => async (workbook, name) => {
      const found = tabs.find((entry) => entry.tab === name && entry.workbook === workbook);
      if (!found || found.status !== "read") return "absent";
      const header = [...RECONCILE_TABS.find((entry) => entry.tab === name)!.headers];
      const identity: string[][] = [["Mongo ID"]];
      for (const row of found.rows) identity[row.row - 1] = [row.id];
      return { header, identity: Array.from(identity, (cells) => cells ?? []) };
    },
    now: () => new Date("2026-11-21T12:00:00Z"), ...overrides };
}

test("production needs the explicit flag, refuses a test-mode .env, and prints its read plan first", async () => {
  const deps = dependencies();
  await assert.rejects(runReconcile({ target: "production", productionRead: false, samples: 5 }, deps),
    (error) => error instanceof OperatorError && error.exitCode === 4 && error.code === "production_read_flag_required");
  assert.equal(deps.announced.length, 0);
  const root = mkdtempSync(join(tmpdir(), "vantage-reconcile-"));
  writeFileSync(join(root, ".env"), "TEST_MODE=true\nMONGO_URI=mongodb+srv://user:hunter2@cluster.example.net/\n");
  await assert.rejects(runReconcile({ target: "production", productionRead: true, samples: 5 }, { ...deps, repoRoot: root }),
    (error) => error instanceof OperatorError && error.code === "production_read_requires_test_mode_false");
  const sheetId = "1abcdefghijklmnopqrstuvwxyzLEADS";
  writeFileSync(join(root, ".env"), [
    "TEST_MODE=false", "MONGO_URI=mongodb+srv://user:hunter2@cluster.example.net/?retryWrites=true",
    `MASTER_LEADS_SHEET_ID=${sheetId}`, "MASTER_BOOKED_SHEET_ID=1zyxBOOKED", `GOOGLE_SERVICE_ACCOUNT_JSON={"client_email":"svc@example.iam","private_key":"pk-secret"}`,
  ].join("\n"));
  const result = await runReconcile({ target: "production", productionRead: true, samples: 5 }, { ...deps, repoRoot: root });
  assert.match(deps.announced[0]!, /writes: none/);
  assert.match(deps.announced[0]!, /spreadsheets\.readonly/);
  assert.equal(result.database, "vantagemovers");
  const output = JSON.stringify(result) + deps.announced.join("");
  for (const secret of ["hunter2", "pk-secret", sheetId, SECRET_NOTE]) assert.ok(!output.includes(secret), secret);
  assert.equal(result.tabs.find((entry) => entry.tab === "Calls")!.categories.missing.count, 1);
  assert.equal(loadProductionReadConfig(join(root, ".env")).mongoHost, "…example.net");
  assert.ok(!output.includes("cluster.example") && !output.includes(root));
});

test("local target reads a workbook snapshot and the loopback agent replica", async () => {
  const deps = dependencies();
  await assert.rejects(runReconcile({ target: "local", productionRead: false, samples: 5 }, deps),
    (error) => error instanceof OperatorError && error.code === "sheet_snapshot_required_for_local_target");
  const root = mkdtempSync(join(tmpdir(), "vantage-reconcile-"));
  const file = join(root, "snapshot.json");
  const forms = [...RECONCILE_TABS[0].headers];
  const column = forms.indexOf("Mongo ID");
  const row = (value: string) => forms.map((_label, index) => index === column ? value : "x");
  writeFileSync(file, JSON.stringify({ master_leads: { Forms: [forms, row(id(1)), row(""), row(id(3))] } }));
  const identities = await readTabIdentities(snapshotTabReader(file));
  assert.deepEqual(identities[0], { tab: "Forms", workbook: "master_leads", status: "read", managedHeadersMatch: true, rows: [{ row: 2, id: id(1) }, { row: 4, id: id(3) }], blankRows: 1 });
  const result = await runReconcile({ target: "local", productionRead: false, snapshot: file, samples: 5 }, deps);
  assert.equal(result.status, "partial");
  assert.equal(result.database, "testvantagemovers_agent");
  assert.deepEqual(result.tabs.find((entry) => entry.tab === "Forms")!.categories.missing.samples.map((sample) => sample.id), [id(2)]);
});

test("reconcile arguments are strict", () => {
  assert.equal(parseCommand(["sheet-sync", "reconcile", "--sheet-snapshot", "s.json"]).target, "local");
  const production = parseCommand(["sheet-sync", "reconcile", "--production-read", "--tab", "Duplicate Calls", "--json"]);
  assert.deepEqual([production.target, production.productionRead, production.tab, production.samples], ["production", true, "Duplicate Calls", 25]);
  for (const args of [
    ["sheet-sync", "reconcile", "--production-read", "--target", "local"], ["sheet-sync", "reconcile", "--tab", "Leads"],
    ["sheet-sync", "reconcile", "--samples", "10001"], ["sheet-sync", "reconcile", "--samples", "1.5"],
    ["sheet-sync", "reconcile", "--production-read", "--sheet-snapshot", "s.json"], ["sheet-sync", "reconcile", "--apply"],
    ["sheet-sync", "reconcile", "--production-read", "--production-read"], ["sheet-sync", "reconcile", "--profile", "sheet-replica"],
  ]) assert.throws(() => parseCommand(args), OperatorError, args.join(" "));
});
