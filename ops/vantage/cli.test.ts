import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { Db, Document } from "mongodb";
import {
  AGENT_LOCAL,
  assertLocalHello,
  assertLocalIdentity,
  localChildEnvironment,
  OperatorError,
  publicFailure,
} from "./local-safety";
import { executeCommand } from "./cli";
import { parseCommand } from "./commands";
import { inspectSheetSync, QUERY_TIMEOUT_MS, READ_LIMIT, traceSheetSync } from "./sheet-sync";
import { sheetTestInvocation } from "./test-command";
import { READ_ONLY_SHEETS_SCOPE, readOnlyGoogleAuthOptions, readOnlyMongo, readOnlySheets, readTabIdentities, sheetsTabReader } from "./read-only-sources";
import { defaultReconcileDependencies, runReconcile } from "./sheet-reconcile-command";
import { CATEGORIES, parseTabIdentity, RECONCILE_TABS, reconcilePlacement, type Category, type ReconcileRecord, type TabIdentity } from "./sheet-reconcile";

const repo = resolve(__dirname, "../..");
const validHello = { setName: "rs0", isWritablePrimary: true, me: "127.0.0.1:27017", primary: "127.0.0.1:27017", hosts: ["127.0.0.1:27017"] };
test("strict command scope rejects injection, unknown flags, duplicate flags and unbounded trace inputs", () => {
  for (const args of [
    ["sheet-sync", "inspect"], ["sheet-sync", "inspect", "--target", "local", "--uri", "mongodb://evil"],
    ["doctor", "--profile", "evil"], ["test", "sheet-sync", "--suite", "replica", "--target", "production"],
    ["sheet-sync", "trace", "--target", "local", "--job", '{"$ne":null}'],
    ["sheet-sync", "trace", "--target", "local", "--job", "a".repeat(10000)],
    ["services", "--json", "--json"], ["doctor", "--help", "--target", "production"],
    ["test", "sheet-sync", "--suite", "--eval"], ["sheet-sync", "repair"],
    ["sheet-sync", "reconcile", "--production-read", "--target", "local"],
    ["sheet-sync", "reconcile", "--tab", "Leads"], ["sheet-sync", "reconcile", "--samples", "10001"],
  ]) assert.throws(() => parseCommand(args));
});
test("production selection refuses before connecting, even when inherited credentials exist", async () => {
  await assert.rejects(executeCommand(parseCommand(["sheet-sync", "inspect", "--target", "production"])), /production_diagnostics_unsupported/);
});
test("local boundary requires exact loopback database, primary and every discovered host", () => {
  assert.doesNotThrow(() => assertLocalHello(validHello, AGENT_LOCAL));
  for (const identity of [
    { ...AGENT_LOCAL, database: "vantagemovers" }, { ...AGENT_LOCAL, uri: "mongodb+srv://remote/test" },
    { ...AGENT_LOCAL, uri: `${AGENT_LOCAL.uri}&proxyHost=remote` },
    { ...AGENT_LOCAL, address: "localhost:27017" }, { ...AGENT_LOCAL, uri: "mongodb://127.0.0.1:27017/" },
  ]) assert.throws(() => assertLocalIdentity(identity));
  for (const hello of [
    {}, { ...validHello, isWritablePrimary: false }, { ...validHello, setName: "production" },
    { ...validHello, hosts: ["127.0.0.1:27017", "remote:27017"] },
    { ...validHello, primary: "remote:27017" }, { ...validHello, passives: ["remote:27017"] },
    { ...validHello, passives: "remote:27017" }, { ...validHello, arbiters: {} },
  ]) assert.throws(() => assertLocalHello(hello, AGENT_LOCAL));
});
test("child subprocess cannot inherit provider credentials, Node flags, dotenv paths or production identity", () => {
  const hostile = { ...process.env, MONGO_URI: "mongodb+srv://secret:password@remote", TEST_MODE: "false", NODE_OPTIONS: "--require malicious.cjs",
    GOOGLE_APPLICATION_CREDENTIALS: "secret.json", GOOGLE_SERVICE_ACCOUNT_JSON: "secret", TWILIO_PRIMARY_AUTH_TOKEN: "secret", RC_JWT: "secret",
    VERCEL: "1", VERCEL_REGION: "iad1", DOTENV_CONFIG_PATH: ".env", SHEET_SYNC_MODE: "queued", FUTURE_PROVIDER_SECRET: "secret" };
  const invocation = sheetTestInvocation("replica", hostile);
  const actual = JSON.parse(execFileSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], { env: invocation.env, encoding: "utf8" }));
  assert.equal(actual.TEST_MODE, "true");
  assert.equal(actual.MONGO_URI, "mongodb://127.0.0.1:27129/?directConnection=true");
  assert.equal(actual.SHEET_SYNC_MODE, "disabled");
  for (const key of ["NODE_OPTIONS", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_SERVICE_ACCOUNT_JSON", "TWILIO_PRIMARY_AUTH_TOKEN", "RC_JWT", "VERCEL", "VERCEL_REGION", "FUTURE_PROVIDER_SECRET"]) assert.equal(actual[key], undefined, key);
  assert.equal(actual.HOME, process.platform === "win32" ? "NUL" : "/dev/null");
  assert.equal(actual.USERPROFILE, actual.HOME);
  assert.notEqual(actual.DOTENV_CONFIG_PATH, ".env");
  assert.deepEqual(invocation.args, ["--import", "tsx", "ops/sheet-sync-recovery/replica.ts"]);
});

function fakeDb(rows: Document[] = []) {
  const calls: { collection: string; pipeline: Document[]; options: Document }[] = [];
  const db = { collection: (collection: string) => ({ aggregate: (pipeline: Document[], options: Document) => {
    calls.push({ collection, pipeline, options }); return { toArray: async () => rows };
  } }) } as unknown as Db;
  return { db, calls };
}
test("empty observations remain partial and every read has row/time bounds and scalar-only projection", async () => {
  const { db, calls } = fakeDb();
  const inspect = await inspectSheetSync(db);
  const trace = await traceSheetSync(db, "000000000000000000000001");
  assert.equal(inspect.status, "partial"); assert.equal(trace.evidence, "job_not_found");
  assert.match(trace.limitations.join(" "), /expire after 90 days/);
  assert.deepEqual(calls.map((call) => call.collection), [
    "sheet_sync_jobs", "sheet_sync_jobs", "sheet_sync_attempts", "sheet_sync_leases", "sheet_sync_quota_buckets",
  ]);
  assert.deepEqual(calls.map((call) => call.options.hint), [
    "_id_", "_id_", { job_id: 1, createdAt: 1 }, { scope: 1 }, { scope: 1, op_class: 1, window_start: 1 },
  ]);
  for (const call of calls) {
    assert.equal(call.options.maxTimeMS, QUERY_TIMEOUT_MS); assert.equal(call.options.allowDiskUse, false);
    const history = ["sheet_sync_jobs", "sheet_sync_attempts"].includes(call.collection);
    assert.equal(call.pipeline.find((stage) => stage.$limit)?.$limit, history ? READ_LIMIT + 1 : 3);
    const project = call.pipeline.at(-1)!.$project;
    const fields = Object.keys(project);
    assert.ok(!fields.some((field) => /error|payload|tombstone|target|sheet|entity|operation/.test(field)));
    assert.ok(Object.entries(project).every(([field, expression]) => (field === "_id" && expression === 0) || typeof expression === "object"));
  }
});
test("sample truncation is explicit and missing permission cannot become an empty healthy result", async () => {
  const { db } = fakeDb(Array.from({ length: 26 }, () => ({ status: "pending" })));
  const result = await inspectSheetSync(db);
  assert.equal(result.more, true); assert.equal(result.jobs.length, 25);
  const denied = { collection: () => ({ aggregate: () => ({ toArray: async () => { throw { code: 13, message: "secret" }; } }) }) } as unknown as Db;
  await assert.rejects(inspectSheetSync(denied), (error) => publicFailure(error).status === "permission_denied");
});
test("trace rejects partial read failures instead of turning unknown attempts into zero", async () => {
  let reads = 0;
  const db = { collection: () => ({ aggregate: () => ({ toArray: async () => {
    reads++;
    if (reads === 2) throw { code: 13, message: "secret" };
    return [];
  } }) }) } as unknown as Db;
  await assert.rejects(traceSheetSync(db, "000000000000000000000001"), (error) => publicFailure(error).status === "permission_denied");
  assert.equal(reads, 2);
});
test("CLI discovery works in a real scrubbed subprocess without Mongo or a .env", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "ops/vantage/cli.ts", "services", "--json"], {
    cwd: repo, env: localChildEnvironment(process.env, AGENT_LOCAL), encoding: "utf8",
  });
  assert.equal(JSON.parse(output).services[0].name, "sheet-sync");
});
test("the fast Sheet Sync proof excludes opt-in replica files, whose skip would fail it", () => {
  const args = sheetTestInvocation("fast", {}).args;
  assert.ok(args.some((arg) => arg.endsWith("jobPlanner.test.ts")));
  assert.ok(!args.some((arg) => arg.endsWith(".replica.test.ts")));
  assert.ok(!args.some((arg) => arg.includes("*")));
});

const id = (n: number) => `6a0000000000000000${String(n).padStart(6, "0")}`;
const qualified = { ingestion_source: "call_log_sync", qualification_reason: "call_log_inbound_target_elapsed_at_least_120s", duration_seconds: 300, call_log_id: "log-1" };
const reconcileRecords: ReconcileRecord[] = [
  { id: id(1), model: "FormLead", flags: { source_company: "tbm_leads" } },
  { id: id(2), model: "FormLead", flags: { source_company: "tbm_leads" } },
  { id: id(3), model: "FormLead", flags: { source_company: "tbm_leads", duplicate: true } },
  { id: id(4), model: "FormLead", flags: { source_company: "tbm_leads", bad_lead: "dc_number" } },
  { id: id(5), model: "FormLead", flags: { source_company: "tbm_leads", no_sync: true } },
  { id: id(11), model: "CallLead", flags: { source_company: "tbm_leads", ringcentral: qualified } },
  { id: id(12), model: "CallLead", flags: { source_company: "tbm_leads", ringcentral: qualified } },
  { id: id(13), model: "CallLead", flags: { source_company: "top10_leads" } },
  { id: id(14), model: "CallLead", flags: { source_company: "tbm_leads", ringcentral: qualified, form_fill: true } },
  { id: id(15), model: "CallLead", flags: { source_company: "tbm_leads", ringcentral: qualified, created_on_unmatched: true } },
  { id: id(16), model: "CallLead", flags: { source_company: "tbm_leads", ringcentral: qualified } },
  { id: id(21), model: "BookedLead", flags: {} }, { id: id(22), model: "BookedLead", flags: {} },
  { id: id(31), model: "CancelledLead", flags: {} },
];
function identity(name: string, ids: (string | null)[], header?: unknown[]): TabIdentity {
  const definition = RECONCILE_TABS.find((entry) => entry.tab === name)!;
  return parseTabIdentity(definition, header ?? [...definition.headers], [["Mongo ID"], ...ids.map((value) => value ? [value] : [])]);
}
const reconcileTabs = [
  identity("Forms", [id(1), null, id(3), id(5), "not-an-id", id(16)]), identity("Duplicate Forms", []), identity("Bad Form Leads", [id(4), id(4)]),
  identity("Calls", [id(11), id(13), id(14)]), identity("Duplicate Calls", [id(15)]), identity("Bad Call Leads", [], ["Mongo ID", "Mongo ID"]),
  identity("Booked Deals", [id(21)]), identity("Cancelled Deals", [id(31), id(99)]),
];

test("reconcile finds every placement category per tab; hints never re-deliver a Call Lead; unreadable tabs prove nothing", () => {
  const report = reconcilePlacement(reconcileRecords, reconcileTabs);
  const expected: [string, Category, string[]][] = [
    ["Forms", "missing", [id(2)]], ["Forms", "wrong_tab", [id(3), id(16)]], ["Forms", "orphan", ["not-an-id"]], ["Forms", "excluded", [id(5)]],
    ["Duplicate Forms", "missing", [id(3)]], ["Bad Form Leads", "duplicate", [id(4)]],
    ["Calls", "missing", [id(12), id(16)]], ["Calls", "wrong_tab", [id(14)]], ["Calls", "excluded", [id(13)]],
    ["Duplicate Calls", "missing", [id(14)]], ["Duplicate Calls", "excluded", [id(15)]],
    ["Booked Deals", "missing", [id(22)]], ["Cancelled Deals", "orphan", [id(99)]],
  ];
  for (const tab of report) {
    for (const category of CATEGORIES) {
      const ids = expected.find(([name, kind]) => name === tab.tab && kind === category)?.[2] ?? [];
      if (tab.tab === "Bad Call Leads") assert.equal(tab.categories[category].count, null, "unreadable identity never proves absence");
      else assert.deepEqual(tab.categories[category].samples.map((sample) => sample.id), ids, `${tab.tab} ${category}`);
      if (tab.owner_managed) assert.equal(tab.categories[category].repair, null, `${tab.tab} is Owner-managed`);
    }
  }
  assert.deepEqual(report.filter((tab) => tab.owner_managed).map((tab) => tab.tab), ["Calls", "Duplicate Calls"]);
  // A Call Lead on Forms is the Owner's decision: its re-delivery touches the Calls tabs and never removes a Form row.
  const forms = report.find((tab) => tab.tab === "Forms")!;
  assert.match(forms.categories.wrong_tab.repair!, /Calls-tab rule/);
  assert.match(forms.categories.missing.repair!, /enqueueSheetSyncJob/);
});

test("the reconcile's Mongo and Sheets clients reach only find, spreadsheets.get and values.get, under the readonly scope", async () => {
  const touched: string[] = [];
  const db = new Proxy({}, { get: (_db, property) => {
    if (property !== "collection") throw new Error(`db.${String(property)} reached`);
    return (name: string) => new Proxy({}, { get: (_c, method) => {
      touched.push(`${name}.${String(method)}`);
      if (method !== "find") throw new Error(`${String(method)} reached`);
      return () => ({ toArray: async () => [] });
    } });
  } }) as unknown as Db;
  const mongo = readOnlyMongo(db);
  assert.deepEqual(Object.keys(mongo), ["findAll"]);
  await mongo.findAll("form_leads", ["duplicate"]);
  await assert.rejects(mongo.findAll("sheet_sync_jobs" as never, []), OperatorError);
  const watch = (path: string): unknown => new Proxy(() => undefined, {
    get: (_target, property) => { touched.push(`${path}.${String(property)}`); return watch(`${path}.${String(property)}`); },
    apply: (_target, _this) => {
      if (!["sheets.spreadsheets.get", "sheets.spreadsheets.values.get"].includes(path)) throw new Error(`${path} reached`);
      return Promise.resolve({ data: path.endsWith("values.get") ? { values: [["Mongo ID"]] } : { sheets: [{ properties: { title: "Forms" } }] } });
    },
  });
  const sheets = readOnlySheets(watch("sheets") as never);
  assert.deepEqual(Object.keys(sheets), ["listTabTitles", "getValues"]);
  await readTabIdentities(sheetsTabReader(sheets, { master_leads: "a", master_booked: "b" }), "Forms");
  assert.deepEqual([...new Set(touched)].sort(), ["form_leads.find", "sheets.spreadsheets", "sheets.spreadsheets.get", "sheets.spreadsheets.values", "sheets.spreadsheets.values.get"]);
  assert.deepEqual(readOnlyGoogleAuthOptions({ credentials: {} }).scopes, [READ_ONLY_SHEETS_SCOPE]);
});

test("production reconcile needs --production-read and a TEST_MODE=false .env, announces its plan, and leaks no secret", async () => {
  const announced: string[] = [];
  const fake = Object.freeze({ findAll: async () => [] });
  const deps = { ...defaultReconcileDependencies, announce: (text: string) => { announced.push(text); },
    withProductionMongo: <T>(_config: unknown, read: (mongo: typeof fake) => Promise<T>) => read(fake),
    productionTabReader: () => async () => "absent" as const };
  await assert.rejects(runReconcile({ target: "production", productionRead: false, samples: 5 }, deps),
    (error) => error instanceof OperatorError && error.exitCode === 4);
  assert.equal(announced.length, 0);
  const root = mkdtempSync(join(tmpdir(), "vantage-reconcile-"));
  writeFileSync(join(root, ".env"), "TEST_MODE=true\nMONGO_URI=mongodb+srv://u:hunter2@cluster.example.net/\n");
  await assert.rejects(runReconcile({ target: "production", productionRead: true, samples: 5 }, { ...deps, repoRoot: root }),
    (error) => error instanceof OperatorError && error.code === "production_read_requires_test_mode_false");
  const sheetId = "1abcdefghijklmnopqrstuvwxyzLEADS";
  writeFileSync(join(root, ".env"), ["TEST_MODE=false", "MONGO_URI=mongodb+srv://u:hunter2@cluster.example.net/", `MASTER_LEADS_SHEET_ID=${sheetId}`,
    "MASTER_BOOKED_SHEET_ID=1zyxBOOKED", 'GOOGLE_SERVICE_ACCOUNT_JSON={"client_email":"svc@example.iam","private_key":"pk-secret"}'].join("\n"));
  const result = await runReconcile({ target: "production", productionRead: true, samples: 5 }, { ...deps, repoRoot: root });
  assert.equal(result.database, "vantagemovers");
  assert.match(announced[0]!, /writes: none[\s\S]*spreadsheets\.readonly/);
  const output = JSON.stringify(result) + announced.join("");
  for (const secret of ["hunter2", "pk-secret", sheetId, "cluster.example", root]) assert.ok(!output.includes(secret), secret);
});

test("the Sheet Sync agent profile is identical for Claude Code and Codex and names every identity failure code", () => {
  const text = (file: string) => readFileSync(resolve(repo, file), "utf8").replace(/\r\n/g, "\n");
  const claude = /^---\nname: sheet-sync\ndescription: (.+)\ntools: .*Bash.*\n---\n\n([\s\S]*)$/.exec(text(".claude/agents/sheet-sync.md"));
  const codex = /^name = "sheet-sync"\ndescription = "(.+)"\ndeveloper_instructions = '''\n([\s\S]*?)'''\n$/.exec(text(".codex/agents/sheet-sync.toml"));
  assert.ok(claude && codex);
  assert.equal(codex[1], claude[1]);
  assert.equal(codex[2], claude[2]);
  const sources = ["batchWriter.ts", "tabRowMap.ts"].map((file) => text(`src/services/sheetSync/drainer/${file}`)).join("\n");
  for (const code of new Set(sources.match(/sheet_(?:identity|update_identity|delete)_[a-z_]+/g))) assert.ok(claude[2]!.includes(code), code);
});
