import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import type { Db, Document } from "mongodb";
import { AGENT_LOCAL, assertLocalHello, assertLocalIdentity, localChildEnvironment, OperatorError, publicFailure } from "./local-safety";
import { executeCommand } from "./cli";
import { HELP, parseCommand, RUNBOOK } from "./commands";
import { inspectSheetSync, QUERY_TIMEOUT_MS, READ_LIMIT, traceSheetSync } from "./sheet-sync";
import { saveTestFailure, sheetTestInvocation } from "./test-command";

const repo = resolve(__dirname, "../..");
const validHello = { setName: "rs0", isWritablePrimary: true, me: "127.0.0.1:27017", primary: "127.0.0.1:27017", hosts: ["127.0.0.1:27017"] };
test("help/discovery/runbook need no credentials, and their references exist", async () => {
  for (const args of [[], ["services"], ["runbook", "sheet-sync", "stalled"]]) {
    const result = await executeCommand(parseCommand(args));
    assert.equal((result as { status: string }).status, "available");
  }
  assert.ok(existsSync(resolve(repo, RUNBOOK)));
  assert.match(HELP, /Production inspection and all repairs are unsupported/);
  const packageJson = JSON.parse(readFileSync(resolve(repo, "package.json"), "utf8"));
  assert.match(packageJson.scripts.test, /ops\/vantage/);
  assert.match(packageJson.scripts.lint, /ops\/vantage/);
  const doc = readFileSync(resolve(repo, RUNBOOK), "utf8");
  for (const line of doc.split(/\r?\n/).filter((line) => line.startsWith("pnpm vantage -- "))) {
    const args = line.slice("pnpm vantage -- ".length).split(" ");
    assert.doesNotThrow(() => parseCommand(args));
  }
  for (const match of doc.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    if (!match[1]!.startsWith("https:")) assert.ok(existsSync(resolve(repo, "docs/operations", match[1]!)), match[1]);
  }
});
test("strict command scope rejects injection, unknown flags, duplicate flags and unbounded trace inputs", () => {
  for (const args of [
    ["sheet-sync", "inspect"], ["sheet-sync", "inspect", "--target", "local", "--uri", "mongodb://evil"],
    ["doctor", "--profile", "evil"], ["test", "sheet-sync", "--suite", "replica", "--target", "production"],
    ["sheet-sync", "trace", "--target", "local", "--job", '{"$ne":null}'],
    ["sheet-sync", "trace", "--target", "local", "--job", "a".repeat(10000)],
    ["services", "--json", "--json"], ["doctor", "--help", "--target", "production"],
    ["test", "sheet-sync", "--suite", "--eval"], ["sheet-sync", "repair"],
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
test("public failure never prints driver messages or payloads and separates privilege failure", () => {
  for (const error of [new Error("secret customer@example.com mongodb://user:password@host"), { code: 13, message: "secret" }, { code: 18, message: "secret" }]) {
    const failure = publicFailure(error);
    assert.doesNotMatch(JSON.stringify(failure), /secret|customer|password/);
  }
  assert.equal(publicFailure({ code: 13 }).status, "permission_denied");
  assert.equal(publicFailure(new OperatorError("unsupported", 4)).status, "unsupported");
  assert.equal(publicFailure(new OperatorError("test_failed", 5)).status, "failed");
  assert.equal(publicFailure(new OperatorError("invalid_arguments", 2)).status, "usage");
});
test("synthetic failure evidence is bounded and stored separately from JSON", () => {
  const path = saveTestFailure("synthetic failure detail", "fixture stderr");
  try { assert.match(readFileSync(path, "utf8"), /synthetic failure detail/); }
  finally { unlinkSync(path); rmdirSync(dirname(path)); }
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
test("trace rejects malformed job IDs before opening a database query", async () => {
  const { db, calls } = fakeDb();
  await assert.rejects(traceSheetSync(db, "not-a-mongo-id"),
    (error) => error instanceof OperatorError && error.code === "invalid_arguments" && error.exitCode === 2);
  assert.equal(calls.length, 0);
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
