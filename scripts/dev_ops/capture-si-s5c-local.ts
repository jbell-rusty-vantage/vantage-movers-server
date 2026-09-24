/**
 * CF5c (SEED-T3, 2026-09-24): the two S5c contract fixtures no Owner route serves, written next to the
 * HTTP captures in `contracts/S5c/`. `capture-si-contract.ts --stage S5c` runs this after its HTTP pass;
 * it can also run alone:
 *
 *   node --import tsx scripts/dev_ops/capture-si-s5c-local.ts --out <contracts>/S5c
 *
 * 1. **Case File coverage (script capture).** No route exposes the Case File (spec §4.13: the run
 *    detail doesn't carry `step_artifacts`). For the seeded `T3-live-call` (an in-progress call on its
 *    primary Number) and `T3-capture-states` (a recovered call) it runs the real assembler
 *    (`caseFileInputFor` → `assembleCaseFile` → `caseFileToReadContent`) over the seed and writes
 *    `case-file__<label>__script.json`: `{ok, as_of, capture: "script", data: {outreach_record_id,
 *    contact_number_id, coverage, case_file}}`, `case_file` being the `case_file` run artifact exactly.
 * 2. **`capture_health` ok / broken (synthetic).** The seed's coverage read is one real example
 *    (`coverage__seed.json`, `attention`). The other two come from the pure `composeCaptureHealth` over
 *    fixed inputs built from the seeded rows (the healthy / expired subscription, the reconcile and sweep
 *    rows): `ok` = no quarantine, no pending call, a fresh receipt; `broken` = only the expired
 *    subscription, a quarantine older than 24 h, one pending call. Each replaces `capture_health` in a
 *    copy of the real response, so it validates against the same route schema:
 *    `coverage__capture-health-{ok,broken}__synthetic.json`.
 *
 * Read only: every MongoDB write, index and transaction method is replaced by a function that throws
 * before anything connects (as `inspect-case-file.ts`), and the run prints the write attempts (0).
 * Loopback `testvantagemovers_finalui` only; no provider, no model, no job. Prints one line
 * `S5C_LOCAL_SUMMARY <json>` that the capture merges into `_capture-index.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SI_CONTRACTS_DIR, SI_SEED_DATABASE, SI_SEED_MANIFEST, SI_SEED_REPLICA, assertSeedDatabase, type SiManifestRow } from "./lib/si-contract-common";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = resolve(flag("--out") ?? resolve(SI_CONTRACTS_DIR, "S5c"));
assertSeedDatabase(SI_SEED_DATABASE);
// Empty strings, not `delete`: a transitive dotenv/config import must not refill provider credentials from .env.
Object.assign(process.env, {
  TEST_MODE: "true", CSI_REPLICA_TEST: "true", TEST_MONGO_DATABASE_NAME: SI_SEED_DATABASE, MONGO_URI: SI_SEED_REPLICA, MONGODB_URI: SI_SEED_REPLICA,
  SALES_INTELLIGENCE_DEPLOYMENT_ID: "csi-local-proof", SHEET_SYNC_MODE: "disabled", RINGCENTRAL_COLLECTION_MODE: "production", RINGCENTRAL_ACCOUNT_ID: "",
  SALES_INTELLIGENCE_CAPTURE_WEBHOOK: "true", SALES_INTELLIGENCE_CASE_FILE: "true",
  AI_GATEWAY_API_KEY: "", PERSONAL_AI_GATEWAY_API_KEY: "", VERCEL_OIDC_TOKEN: "", OPENAI_API_KEY: "", SALES_INTELLIGENCE_MCP_ENDPOINT: "",
});

let writeAttempts = 0;
async function installReadOnlyGuard() {
  const driver = await import("mongodb");
  const refuse = (where: string) => function refused() { writeAttempts++; throw new Error(`capture-si-s5c-local is read only: ${where} refused`); };
  for (const name of ["insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndReplace",
    "findOneAndDelete", "bulkWrite", "createIndex", "createIndexes", "dropIndex", "dropIndexes", "drop", "rename"] as const)
    (driver.Collection.prototype as unknown as Record<string, unknown>)[name] = refuse(`Collection.${name}`);
  for (const name of ["createCollection", "dropDatabase", "dropCollection", "renameCollection"] as const) (driver.Db.prototype as unknown as Record<string, unknown>)[name] = refuse(`Db.${name}`);
  (driver.ClientSession.prototype as unknown as Record<string, unknown>).startTransaction = refuse("ClientSession.startTransaction");
  (driver.ClientSession.prototype as unknown as Record<string, unknown>).withTransaction = refuse("ClientSession.withTransaction");
  const mongoose = (await import("mongoose")).default;
  mongoose.set("autoCreate", false);
  mongoose.set("autoIndex", false);
}

type Summary = { route: string; state: string; path: string; status: number; note: string; ok: boolean };
const stateOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  await installReadOnlyGuard();
  globalThis.fetch = (async () => { throw new Error("External traffic forbidden in capture-si-s5c-local"); }) as typeof fetch;
  const mongoose = (await import("mongoose")).default;
  const { connectMongo } = await import("../../src/db");
  const { getMongoDatabaseName } = await import("../../src/config/domain/runtime");
  const { assembleCaseFile, caseFileInputFor } = await import("../../src/services/salesIntelligence/casefile/assemble");
  const { caseFileToReadContent, caseFileFromReadContent } = await import("../../src/services/salesIntelligence/casefile/page");
  const { readCaptureCoverage } = await import("../../src/services/numberActivity/coverage");
  const { composeCaptureHealth } = await import("../../src/services/salesIntelligence/ownerCoverage");
  const { defaultCsiPolicy } = await import("../../src/services/salesIntelligence/policy");
  const { CALL_LOG_ALL_DIRECTIONS_SCOPE } = await import("../../src/services/numberActivity/reconcileCallLog");
  const { CALL_LOG_SWEEP_SCOPE } = await import("../../src/services/numberActivity/callLogSweep");
  await connectMongo();
  if (getMongoDatabaseName() !== SI_SEED_DATABASE) throw new Error("wrong database");
  const db = mongoose.connection.useDb(SI_SEED_DATABASE, { useCache: true }).db!;
  if ((await db.admin().command({ hello: 1 })).setName !== "csi01") throw new Error("not the csi01 replica");
  const rows = (await db.collection(SI_SEED_MANIFEST).find({}, { projection: { _id: 0, seeded_at: 0 } }).toArray()) as unknown as SiManifestRow[];
  const summary: Summary[] = [];

  // ── 1. Case File coverage (script capture) ─────────────────────────────────────────────────
  const coverage = await readCaptureCoverage();
  for (const label of ["T3-live-call", "T3-capture-states"]) {
    const row = rows.find(r => r.label === label);
    const file = `case-file__${stateOf(label)}__script.json`;
    if (!row?.contact_number_id) { summary.push({ route: "script: casefile/assemble.ts assembleCaseFile", state: `${stateOf(label)}__script`, path: "(script)", status: 0, note: `${label} not in the manifest`, ok: false }); continue; }
    const number = await db.collection("contact_numbers").findOne({ _id: new mongoose.Types.ObjectId(row.contact_number_id) }, { projection: { e164: 1 } });
    const lead = row.lead_refs[0] ?? null;
    const asOf = new Date();
    const assembled = await assembleCaseFile(await caseFileInputFor({ contact_number_id: row.contact_number_id, e164: number?.e164 ?? null, lead_ref: lead,
      outreach_record_id: row.outreach_record_id, subject_key: lead ? `lead:${lead.model}:${lead.id}` : `number:${row.contact_number_id}`, as_of: asOf, audience: "findings", coverage }));
    const artifact = caseFileFromReadContent(caseFileToReadContent(assembled.file, assembled.rendered, coverage));
    if (!artifact) throw new Error(`${label}: the Case File page carries no case_file artifact`);
    const body = { ok: true, as_of: asOf.toISOString(), capture: "script", data: { outreach_record_id: row.outreach_record_id, contact_number_id: row.contact_number_id,
      coverage: assembled.file.coverage, case_file: artifact } };
    writeFileSync(resolve(OUT, file), `${JSON.stringify(body, null, 2)}\n`);
    summary.push({ route: "script: casefile/assemble.ts assembleCaseFile (no route exposes the Case File)", state: `${stateOf(label)}__script`, path: "(script)", status: 0,
      note: `${file}: coverage.excluded_in_progress ${assembled.file.coverage.excluded_in_progress ?? "absent"}`, ok: true });
  }

  // ── 2. capture_health ok / broken (synthetic, pure composeCaptureHealth over fixed inputs) ────
  const realFile = resolve(OUT, "coverage__seed.json");
  const real = JSON.parse(readFileSync(realFile, "utf8")) as { ok: true; data: { as_of: string; coverage: Record<string, unknown> } };
  const now = new Date(real.data.as_of);
  const policy = defaultCsiPolicy();
  const staffing = { timezone: policy.timezone, staffed_hours: policy.staffed_hours };
  const subs = await db.collection("ringcentral_webhook_subscriptions").find({ provider: "ringcentral", subscriptionId: { $regex: "^t3seed-" } },
    { projection: { _id: 0, subscriptionId: 1, status: 1, expirationTime: 1, updatedAt: 1, eventFilters: 1 } }).toArray();
  const healthy = subs.find(s => String(s.subscriptionId).startsWith("t3seed-healthy")), expired = subs.find(s => String(s.subscriptionId).startsWith("t3seed-expired"));
  if (!healthy || !expired) throw new Error("the seeded t3seed-* subscription rows are missing");
  const sync = db.collection("sales_intelligence_sync_state");
  const [reconcile, sweep] = await Promise.all([sync.findOne({ scope: CALL_LOG_ALL_DIRECTIONS_SCOPE }), sync.findOne({ scope: CALL_LOG_SWEEP_SCOPE })]);
  if (!reconcile || !sweep) throw new Error("the seeded Call Log sync-state rows are missing");
  const MIN = 60_000;
  // The same sync mode as the real response's `call_log_capture`, so each synthetic copy stays internally consistent.
  const syncMode = ((real.data.coverage.call_log_capture as { sync_mode?: "off" | "shadow" | "on" } | undefined)?.sync_mode) ?? "off";
  const base = { now, webhook_enabled: true, staffing, sync_mode: syncMode, sweep: sweep as never, renewal_event: null };
  const examples = {
    // Everything current: no quarantine, a receipt a minute ago with Call Log calls in the window, one live call under 10 minutes.
    ok: composeCaptureHealth({ ...base, reconcile: { ...reconcile, quarantined_records: [] } as never, subscriptions: [healthy as never],
      latest_receipt_at: new Date(+now - MIN), receipts_1h: 14, call_log_calls_in_window: 3, in_progress_calls: 1, pending_finalization: 0 }),
    // The owned subscription lapsed, a record has sat in quarantine for 25 h, and one call has been open 35 minutes.
    broken: composeCaptureHealth({ ...base,
      reconcile: { ...reconcile, quarantined_records: ((reconcile.quarantined_records ?? []) as Array<Record<string, unknown>>).map(q => ({ ...q, first_failed_at: new Date(+now - 25 * 60 * MIN) })) } as never,
      subscriptions: [expired as never], latest_receipt_at: new Date(+now - 26 * 60 * MIN), receipts_1h: 0, call_log_calls_in_window: 0, in_progress_calls: 1, pending_finalization: 1 }),
  };
  for (const [status, health] of Object.entries(examples)) {
    const file = `coverage__capture-health-${status}__synthetic.json`;
    const body = { ...real, data: { ...real.data, coverage: { ...real.data.coverage, capture_health: health } } };
    writeFileSync(resolve(OUT, file), `${JSON.stringify(body, null, 2)}\n`);
    summary.push({ route: "synthetic: ownerCoverage.ts composeCaptureHealth (pure) in a copy of GET /coverage", state: `capture-health-${status}__synthetic`, path: "(synthetic)",
      status: 0, note: `${file}: status ${health.status}, reasons [${health.reasons.join(", ")}]`, ok: health.status === status });
  }
  await mongoose.disconnect();
  console.log(`# write attempts: ${writeAttempts}`);
  console.log(`S5C_LOCAL_SUMMARY ${JSON.stringify(summary)}`);
  if (writeAttempts || summary.some(s => !s.ok)) process.exitCode = 1;
}
main().then(() => process.exit(process.exitCode ?? 0)).catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
