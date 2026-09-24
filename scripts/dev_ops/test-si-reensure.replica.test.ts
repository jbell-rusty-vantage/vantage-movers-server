/**
 * S10 step 6 replica proofs (reconciliation addendum §5, C24/C25): `scripts/dev_ops/reensure-outreach.ts`.
 * csi01 replica, disposable `testvantagemovers_t3areensure<hex>`, production flags on (ATTENTION_EVOLUTION,
 * CASE_FILE, PROGRESS_PLAN, LEAD_PROGRESS, OUTREACH_ENSURE, MOVE_ASSESSMENT + ENABLED, PRIORITY5_CLOSURE), so
 * the progress re-plan path is live. Fixed clock (Thu 2026-09-24 16:00 ET). No job consumer runs.
 *
 * Records: S (stale: an unapplied attempt completes a promise and creates its retry), Q (Quoted progress
 * never projected, with a summarized conversation: default + a re-plan the lap must suppress), O (official
 * Booking never mirrored: the closure's `number_refresh` must be held), C (current: unchanged), Y (closed 10
 * days ago: in the lap, unchanged), X (closed 205 days ago and now cancelled: outside the lap, untouched),
 * N (a Number Review with an unapplied missed call).
 *
 * Proves: C25 the dry run is write-free (the server's `top` write counters and dbHash, around the CLI), and
 * why an aborted transaction is not; apply changes exactly what the dry run predicted; a crash mid-lap
 * (`--limit`, then a throw mid-record) resumes with no duplicate; C24 a second apply is a no-op (dbHash,
 * audits, jobs), zero paid jobs unheld, and the `--no-progress-plan` count is reported.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getRepIdentityLinkModel } from "../../src/models/RepIdentityLink";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { persistLeadAttachments } from "../../src/services/salesIntelligence/attachment/store";
import { ensureInteraction, ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { progressPlanSuppressed } from "../../src/services/salesIntelligence/outreach/types";
import { seedSummaryConversation } from "./csi-move-assessment-fixtures";
import { fileSeams, newReensureCheckpoint, reensureReport, reensureSummary, runReensureOutreach, type ReensureCheckpoint } from "./lib/reensure-outreach";

const ET = (local: string) => new Date(`${local}:00${local >= "2026-11-01T02:00" ? "-05:00" : "-04:00"}`);
const NOW = ET("2026-09-24T16:00"), MON_09 = ET("2026-09-21T09:00"), TUE_10 = ET("2026-09-22T10:00"), TUE_15 = ET("2026-09-22T15:00"), WED_11 = ET("2026-09-23T11:00");
const WRITE_METHODS = /^(insert|update|replace|delete|findOneAndUpdate|findOneAndReplace|findOneAndDelete|findAndModify|bulkWrite|createIndex|drop|rename|save|create)/i;
const FLAGS = { OUTREACH_ENSURE: true, LEAD_PROGRESS: true, ATTENTION_EVOLUTION: true, CASE_FILE: true, PROGRESS_PLAN: true, MOVE_ASSESSMENT: true, ENABLED: true, PRIORITY5_CLOSURE: true };

test("S10-6 Outreach re-ensure lap replica", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000 }, async t => {
  const database = getMongoDatabaseName();
  assert.match(database, /^testvantagemovers_t3areensure[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  for (const flag of ["LEAD_PROGRESS", "ATTENTION_EVOLUTION", "CASE_FILE", "PROGRESS_PLAN", "MOVE_ASSESSMENT", "ENABLED", "OUTREACH_ENSURE"]) assert.equal(process.env[`SALES_INTELLIGENCE_${flag}`], "true", flag);
  await connectMongo();
  const db = mongoose.connection.useDb(database, { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  await applyCsiMigration();
  const oid = () => new mongoose.Types.ObjectId();
  const Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel(), Jobs = getSalesIntelligenceJobModel(), Audit = getSalesIntelligenceAuditEventModel();
  const jordan = oid();
  await getRepIdentityLinkModel().create({ agent_id: jordan, agent_name_snapshot: "Jordan", rc_account_id: "synthetic", rc_extension_id: "101", role_kind: "sales_rep", status: "reviewed", effective_from: ET("2026-01-01T09:00") });

  // ── Fixtures (the real projection at a fixed time, then left stale on purpose) ──
  let serial = 0;
  async function fixture(timestamp = MON_09) {
    const n = await getContactNumberModel().create({ e164: `+120255504${String(++serial).padStart(2, "0")}`, national_ten: `20255504${String(serial).padStart(2, "0")}`, digits_reversed: `t3are${serial}`,
      first_observed_at: timestamp, last_activity_at: timestamp, classification: "customer" });
    const lead = { _id: oid(), timestamp, createdAt: timestamp, updatedAt: timestamp, name: `Synthetic T3A reensure ${serial}`, normalized_phone_number: n.e164,
      ingested_contact_snapshot: { normalized_phone_number: n.e164, captured_at: timestamp }, receiver_agent: oid(), quoted: false, domain_revision: 0 };
    await getFormLeadModel().collection.insertOne(lead);
    await withTransaction(async session => {
      await ensureLead({ model: "FormLead", id: String(lead._id) }, workerContext(session, String(oid()), timestamp), String(n._id));
      await persistLeadAttachments(lead, "FormLead", session, String(oid()), timestamp);
    });
    const record = await Records.findOne({ "subject.id": lead._id }).orFail();
    return { n, lead, record, key: `lead:FormLead:${lead._id}` };
  }
  const call = (number: mongoose.Types.ObjectId, started_at: Date, kind: "attempt" | "missed") =>
    getCallInteractionModel().create({ provider_account_id: "synthetic", telephony_session_id: String(oid()), identity_basis: "telephony_session_id", contact_number_id: number,
      direction: kind === "missed" ? "Inbound" : "Outbound", started_at, ended_at: new Date(+started_at + 60_000), first_observed_at: started_at, last_observed_at: started_at, terminal: true,
      provider_connected: false, contact_type: "unknown", parties: kind === "missed" ? [] : [{ role: "user", extension_id: "101", direction: "Outbound", connected: true }],
      ...(kind === "missed" ? { inbound_route_id: oid() } : {}) });
  const applyCall = (c: Awaited<ReturnType<typeof call>>, at: Date) => withTransaction(s => ensureInteraction(c.toObject() as never, workerContext(s, String(oid()), at)));
  const booked = (leadId: mongoose.Types.ObjectId, at: Date) =>
    db.collection("booked_leads").insertOne({ _id: oid(), lead_model: "FormLead", lead_ref: leadId, job_no: `T3A-${++serial}`, book_date: at, createdAt: at });

  // S: stale. A promise due Tue 15:00 and an attempt at 15:05 that was never applied.
  const S = await fixture();
  const promise = await Actions.create({ outreach_record_id: S.record._id, commitment_key: `t3a:${oid()}`, kind: "call", description: "Call back Tuesday 3 PM", origin: "rep_promise",
    requested_by: "rep", due_at: TUE_15, base_attention_due_at: TUE_15, responsible_agent_id: jordan, promised_by_agent_id: jordan,
    date_resolution: { precision: "exact", timezone: "America/New_York", anchor: MON_09, policy_version: "csi-policy-v1" } });
  await call(S.n._id, ET("2026-09-22T15:05"), "attempt");
  // Q: accepted Priority 1 (Quoted) never projected, with a summarized conversation in the last 30 days.
  const Q = await fixture();
  await getFormLeadModel().collection.updateOne({ _id: Q.lead._id }, { $set: { granot_priority: "1", domain_revision: 1 } });
  await getEntityChangeModel().collection.insertOne({ entity: { model: "FormLead", id: String(Q.lead._id) }, command_execution_id: oid(), command_name: "synchronizeLeadFromGranot",
    provenance: { source_system: "granot", actor: { actor_type: "system", actor_id: "test" }, initiator: { actor_type: "system", actor_id: "test" }, request_id: String(oid()), observation_id: oid(), decision_id: oid() },
    changed_paths: ["granot_priority"], fields: [{ path: "granot_priority", value_mode: "stored", before: null, after: "1" }], revision_before: 0, revision_after: 1, applied_at: TUE_10 } as never);
  await seedSummaryConversation(String(Q.n._id), TUE_10, { overview: "Customer wants a quote for a two-bedroom move.", outcome: "Rep sent the estimate." });
  // O: the exact Booking arrived, the Lead mirror and the projection did not.
  const O = await fixture();
  await booked(O.lead._id, TUE_10);
  // C: current (its call applied).
  const C = await fixture();
  await applyCall(await call(C.n._id, TUE_10, "attempt"), TUE_10);
  // Y: closed officially 10 days ago (in the lap, nothing to do).
  const Y = await fixture(ET("2026-09-10T09:00"));
  await booked(Y.lead._id, ET("2026-09-14T10:00"));
  await withTransaction(s => ensureLead({ model: "FormLead", id: String(Y.lead._id) }, workerContext(s, String(oid()), ET("2026-09-14T10:00"))));
  // X: closed 205 days ago, and cancelled since: outside the 90-day window, so the lap must not touch it.
  const X = await fixture(ET("2026-02-20T09:00"));
  const xBooking = oid();
  await db.collection("booked_leads").insertOne({ _id: xBooking, lead_model: "FormLead", lead_ref: X.lead._id, job_no: "T3A-X", book_date: ET("2026-03-01T10:00"), createdAt: ET("2026-03-01T10:00") });
  await withTransaction(s => ensureLead({ model: "FormLead", id: String(X.lead._id) }, workerContext(s, String(oid()), ET("2026-03-01T10:00"))));
  await db.collection("cancelled_leads").insertOne({ _id: oid(), booked_lead: xBooking, cancel_date: ET("2026-09-01T10:00") });
  // N: a Number Review (unlinked missed call) with a second missed call never applied.
  const nNumber = await getContactNumberModel().create({ e164: "+12025550499", national_ten: "2025550499", digits_reversed: "t3areN", first_observed_at: TUE_10, last_activity_at: TUE_10, classification: "customer" });
  await applyCall(await call(nNumber._id, TUE_10, "missed"), TUE_10);
  await call(nNumber._id, WED_11, "missed");
  const N = { record: await Records.findOne({ "subject.kind": "number_review", "subject.contact_number_id": nNumber._id }).orFail(), key: `number:${nNumber._id}` };

  assert.equal((await Records.findById(Y.record._id).lean())?.state, "closed");
  assert.equal((await Records.findById(X.record._id).lean())?.closed_reason, "booked");
  const revisions = async () => Object.fromEntries(await Promise.all(Object.entries({ S, Q, O, C, Y, X, N }).map(async ([k, v]) => [k, (await Records.findById(v.record._id).lean())!.revision] as const)));
  const paidJobs = async () => ({ number_refresh: await Jobs.countDocuments({ stage: "number_refresh", status: { $in: ["pending", "retry", "leased"] } }),
    move_assessment: await Jobs.countDocuments({ stage: "move_assessment" }), analysis: await Jobs.countDocuments({ stage: { $in: ["analysis", "application"] } }),
    transcription: await Jobs.countDocuments({ stage: "transcription" }) });
  const writeCount = async () => {
    const totals = (await db.admin().command({ top: 1 })).totals as Record<string, { insert?: { count: number }; update?: { count: number }; remove?: { count: number } }>;
    return Object.entries(totals).filter(([ns]) => ns.startsWith(`${database}.`)).reduce((sum, [, v]) => sum + (v.insert?.count ?? 0) + (v.update?.count ?? 0) + (v.remove?.count ?? 0), 0);
  };
  const dbHash = async () => (await db.command({ dbHash: 1 })).md5 as string;
  const out = mkdtempSync(join(tmpdir(), "t3a-reensure-"));
  const reportDir = process.env.T3A_REENSURE_REPORT_DIR ?? join(out, "evidence");
  mkdirSync(reportDir, { recursive: true });
  const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "--import", "./scripts/test-setup.ts", "scripts/dev_ops/reensure-outreach.ts",
    `--as-of=${NOW.toISOString()}`, `--out=${out}`, `--report-dir=${out}`, ...args], { env: process.env, encoding: "utf8", timeout: 300_000 });
  const paidBefore = await paidJobs(), revisionsBefore = await revisions();

  let dry: ReensureCheckpoint;
  const proof: Record<string, unknown> = {};
  await t.test("C25: an aborted transaction still sends writes (so the dry run never uses one)", async () => {
    const before = await writeCount(), hash = await dbHash();
    const session = await mongoose.connection.startSession();
    try {
      session.startTransaction();
      await Records.collection.updateOne({ _id: C.record._id }, { $set: { probe: true } }, { session });
      await session.abortTransaction();
    } finally { await session.endSession(); }
    const after = await writeCount();
    assert.ok(after > before, `the server counted the rolled-back update (${before} → ${after})`);
    assert.equal(await dbHash(), hash, "dbHash alone cannot see it");
    proof.aborted_txn = { writes_counted: after - before };
  });

  await t.test("C25: the dry run (the CLI, read only) sends zero write commands and leaves dbHash identical", async () => {
    const before = await writeCount(), hash = await dbHash();
    const run = cli();
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const after = await writeCount(), hashAfter = await dbHash();
    assert.equal(after - before, 0, "zero write commands (top: insert + update + remove, every collection of this database)");
    assert.equal(hashAfter, hash, "dbHash identical");
    dry = JSON.parse(readFileSync(join(out, `reensure-outreach-${database}-dry-run.checkpoint.json`), "utf8")) as ReensureCheckpoint;
    assert.ok(dry.finished_at, "finished");
    assert.equal(dry.processed, 6, "S, Q, O, C, Y, N; X is outside the 90-day window");
    assert.equal(dry.totals.would_change, 4);
    assert.deepEqual([...dry.touched_keys].sort(), [S.key, Q.key, O.key, N.key].sort());
    assert.equal(dry.totals.predicted_holds, 1, "O's official closure");
    assert.equal(dry.totals.predicted_replans, 1, "Q's Quoted progress");
    assert.deepEqual(dry.totals.replans_by_record, { [String(Q.record._id)]: 1 });
    assert.equal(dry.totals.predicted_defaults, 1);
    assert.ok(existsSync(join(out, "S10-6-replica-dry-run.md")) && existsSync(join(out, "S10-6-replica-dry-run.json")));
    // Also in-process with mongoose's op log (every command it sent is a read).
    const ops: string[] = [];
    mongoose.set("debug", (collection: string, method: string) => { ops.push(`${collection}.${method}`); });
    const inProcess = newReensureCheckpoint(database, false, true, NOW);
    const memory = { cp: null as ReensureCheckpoint | null, before: null as Record<string, string> | null };
    await runReensureOutreach({ apply: false, batch: 2 }, inProcess, { now: () => NOW, save: async cp => { memory.cp = cp; }, log: async () => undefined,
      saveBefore: async b => { memory.before = b; }, loadBefore: async () => memory.before });
    mongoose.set("debug", false);
    assert.deepEqual(ops.filter(op => WRITE_METHODS.test(op.split(".").at(-1)!)), [], `only reads (${ops.length} ops)`);
    assert.deepEqual(inProcess.touched_keys.sort(), dry.touched_keys.sort(), "the CLI and the library agree");
    proof.dry_run = { top_writes: after - before, dbhash_before: hash, dbhash_after: hashAfter, mongoose_ops: ops.length, mongoose_writes: 0 };
    assert.deepEqual(await revisions(), revisionsBefore);
  });

  const base = join(out, "lib-apply");
  let applied: ReensureCheckpoint;
  await t.test("apply with a crash mid-lap: --limit=2, then a throw mid-record (after its ensure committed), then resume; no duplicate", async () => {
    const cp = newReensureCheckpoint(database, true, true, NOW);
    const seams = (stage?: (id: string, s: string, n: number) => void) => ({ ...fileSeams(base, cp.run_id), now: () => NOW, stage });
    await runReensureOutreach({ apply: true, limit: 2, batch: 2, noProgressPlan: true }, cp, seams());
    assert.equal(cp.processed, 2); assert.equal(cp.finished_at, null);
    // Crash: the 4th record throws right after its ensure transaction committed.
    await assert.rejects(runReensureOutreach({ apply: true, batch: 2, noProgressPlan: true }, cp, seams((id, stage, processed) => {
      if (processed === 3 && stage === "ensure") throw new Error(`simulated crash in ${id}`);
    })), /simulated crash/);
    const saved = JSON.parse(readFileSync(`${base}.checkpoint.json`, "utf8")) as ReensureCheckpoint;
    assert.equal(saved.processed, 3); assert.ok(saved.current, "the record in flight is recorded");
    // Resume from the file, as the CLI's --resume does.
    applied = saved;
    await runReensureOutreach({ apply: true, batch: 2, noProgressPlan: true }, applied, { ...fileSeams(base, applied.run_id), now: () => NOW });
    assert.ok(applied.finished_at); assert.equal(applied.processed, 6); assert.equal(applied.current, null);
    const lines = readFileSync(`${base}.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line) as { event: string; record_id?: string; resumed?: boolean });
    const recordLines = lines.filter(l => l.event === "record");
    assert.equal(recordLines.length, 6); assert.equal(new Set(recordLines.map(l => l.record_id)).size, 6, "one line per record");
    assert.equal(recordLines.filter(l => l.resumed).length, 1, "the crashed record was redone once");
    // Nothing doubled: one retry, one quote default, one missed episode for Q, one held number_refresh.
    assert.equal(await Actions.countDocuments({ outreach_record_id: S.record._id, "promise_chain.root_id": promise._id }), 1);
    assert.equal(await Actions.countDocuments({ outreach_record_id: Q.record._id, default_kind: "quote_followup" }), 1);
    assert.equal(await Jobs.countDocuments({ stage: "number_refresh", subject_key: O.key }), 1);
  });

  await t.test("apply changed what the dry run said; paid work held or suppressed; bands reported", async () => {
    const t0 = applied.totals;
    assert.deepEqual([...applied.touched_keys].sort(), [...dry.touched_keys].sort(), "same records touched as predicted");
    assert.equal(t0.records_changed, dry.totals.would_change);
    assert.equal(applied.holds.length, dry.totals.predicted_holds);
    assert.equal(t0.replans_suppressed, dry.totals.predicted_replans);
    assert.deepEqual(t0.replans_by_record, dry.totals.replans_by_record);
    assert.equal(t0.actions_created["call/system_default/quote_followup"], dry.totals.predicted_defaults);
    assert.equal(t0.paid_created_unheld, 0);
    // S: the attempt completed the promise and created its retry.
    const s = await Records.findById(S.record._id).lean().orFail();
    assert.equal(s.state, "open"); assert.equal(+s.first_attributable_outbound_at!, +ET("2026-09-22T15:05")); assert.equal(+s.last_activity_at!, +ET("2026-09-22T15:05"));
    const p = await Actions.findById(promise._id).lean().orFail();
    assert.equal(p.status, "completed"); assert.equal(p.disposition, "no_answer");
    assert.equal(t0.actions_created["call/system_default/promise_retry"], 1);
    assert.equal(t0.actions_closed["completed:call/rep_promise"], 1);
    // Q: accepted Quoted progress projected; P4 default; the re-plan counted, never nominated.
    const q = await Records.findById(Q.record._id).lean().orFail();
    assert.equal(q.lead_progress?.disposition, "quoted"); assert.equal(q.lead_progress?.provenance, "accepted"); assert.equal(q.state, "open");
    assert.equal(await Jobs.countDocuments({ stage: "move_assessment" }), 0, "no move_assessment job");
    // O: official closure; its number_refresh on operator_hold.
    const o = await Records.findById(O.record._id).lean().orFail();
    assert.equal(o.state, "closed"); assert.equal(o.closure_origin, "official"); assert.equal(o.closed_reason, "booked");
    const held = await Jobs.findById(applied.holds[0]!.job_id).lean().orFail();
    assert.equal(held.stage, "number_refresh"); assert.equal(held.status, "paused"); assert.equal(held.reason, "operator_hold");
    assert.deepEqual(t0.holds_by_stage, { number_refresh: 1 });
    // C and Y unchanged; X (outside the window) untouched although it now has a cancellation.
    const r = await revisions();
    assert.equal(r.C, revisionsBefore.C); assert.equal(r.Y, revisionsBefore.Y); assert.equal(r.X, revisionsBefore.X);
    assert.equal((await Records.findById(X.record._id).lean())?.closed_reason, "booked");
    assert.ok(r.N! > revisionsBefore.N!, "N applied its second missed call");
    // Zero claimable paid jobs created (the one number_refresh is held).
    assert.deepEqual(await paidJobs(), paidBefore);
    assert.equal(applied.jobs_after!.number_refresh, applied.jobs_before!.number_refresh);
    assert.equal(applied.jobs_after!.operator_hold, applied.jobs_before!.operator_hold + 1);
    // Bands: before (pre-pass) and after (post-pass), the same derive at as_of.
    assert.equal(Object.values(applied.bands_before!).reduce((a, b) => a + b, 0), 6);
    assert.equal(Object.values(applied.bands_after!).reduce((a, b) => a + b, 0), 6);
    assert.ok(applied.band_changes.some(c => c.record_id === String(O.record._id) && c.after === "none"), "O left the desk");
    assert.ok(applied.band_changes.some(c => c.record_id === String(Q.record._id)), "Q moved band");
    const summary = reensureSummary(applied, FLAGS);
    const header = (label: string) => `> Replica proof (\`test-si-reensure.ts\`, ${label}). Aborted-transaction probe: ${JSON.stringify(proof.aborted_txn)}; dry run: ${JSON.stringify(proof.dry_run)}.\n\n`;
    writeFileSync(join(reportDir, "S10-6-replica.md"), header("apply: --limit=2, crash, resume") + reensureReport(applied, "replica", FLAGS, { checkpoint: `${base}.checkpoint.json`, jsonl: `${base}.jsonl`, summary: "S10-6-replica.json" }));
    writeFileSync(join(reportDir, "S10-6-replica.json"), JSON.stringify(summary, null, 1) + "\n");
    writeFileSync(join(reportDir, "S10-6-replica-dry-run.md"), header("dry run through the CLI") + readFileSync(join(out, "S10-6-replica-dry-run.md"), "utf8"));
    writeFileSync(join(reportDir, "S10-6-replica-dry-run.json"), readFileSync(join(out, "S10-6-replica-dry-run.json"), "utf8"));
    console.log(JSON.stringify({ s10_6_apply: { totals: t0, bands_before: applied.bands_before, bands_after: applied.bands_after, band_changes: applied.band_changes, holds: applied.holds } }));
  });

  await t.test("C24: a second apply (the CLI) is a no-op: zero revisions, zero follow-ups created or cancelled, zero jobs, dbHash identical", async () => {
    const hash = await dbHash(), audits = await Audit.countDocuments({}), jobs = await Jobs.countDocuments({}), followups = await Actions.countDocuments({});
    const run = cli("--apply");
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const second = JSON.parse(readFileSync(join(out, `reensure-outreach-${database}-apply.checkpoint.json`), "utf8")) as ReensureCheckpoint;
    assert.ok(second.finished_at); assert.equal(second.processed, 6);
    assert.equal(second.totals.records_changed, 0); assert.equal(second.totals.record_revisions, 0); assert.equal(second.totals.calls_applied, 0);
    assert.deepEqual(second.totals.actions_created, {}); assert.deepEqual(second.totals.actions_closed, {}); assert.deepEqual(second.totals.actions_updated, {});
    assert.equal(second.holds.length, 0); assert.equal(second.totals.replans_suppressed, 0); assert.equal(second.totals.paid_created_unheld, 0);
    assert.deepEqual(second.bands_after, second.bands_before);
    assert.equal(await dbHash(), hash, "dbHash identical");
    assert.equal(await Audit.countDocuments({}), audits); assert.equal(await Jobs.countDocuments({}), jobs); assert.equal(await Actions.countDocuments({}), followups);
    const report = readFileSync(join(out, "S10-6-replica.md"), "utf8");
    assert.match(report, /Re-plans suppressed by `--no-progress-plan` \| \*\*0\*\*/);
    assert.match(readFileSync(join(reportDir, "S10-6-replica.md"), "utf8"), /Re-plans suppressed by `--no-progress-plan` \| \*\*1\*\* \(1 records\)/, "the first apply's count");
    writeFileSync(join(reportDir, "S10-6-replica-second-apply.md"), `> Replica proof (\`test-si-reensure.ts\`): the second apply through the CLI; dbHash ${hash} before = after.\n\n` + report);
  });

  await t.test("the seam is inert without a suppressor; the CLI refuses unsafe runs", async () => {
    assert.equal(progressPlanSuppressed("000000000000000000000000"), false);
    const noResume = cli("--apply", "--limit=1");
    assert.equal(noResume.status, 0, "a finished apply checkpoint is archived and a new run starts");
    const unfinished = cli("--apply");
    assert.notEqual(unfinished.status, 0); assert.match(unfinished.stderr, /unfinished apply/);
    const resumed = cli("--apply", "--resume");
    assert.equal(resumed.status, 0, resumed.stderr);
  });
});
