import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { CSI_MODEL_REGISTRY } from "../src/models/salesIntelligence/registry";
import { LEAD_CONVERSATION_INDEXES } from "../src/models/LeadConversation";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../src/models/IntelligenceSubmission";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAiReservationModel } from "../src/models/SalesIntelligenceAiReservation";
import { getSalesIntelligenceAiBudgetModel } from "../src/models/SalesIntelligenceAiBudget";
import { currentLedger, initializeCsiBudgetPeriod, reconcileCsiBudget, reserveCsiBudget } from "../src/services/salesIntelligence/aiBudget";
import { claimCsiJob, completeCsiJob, enqueueCsiJob } from "../src/services/salesIntelligence/jobs";
import { intelligenceSources } from "../src/services/salesIntelligence/analysis/sources";
import { scheduleNumberIntelligence } from "../src/services/salesIntelligence/analysis/scheduling";
import { CASE_FILE_FINDINGS_PROMPT_VERSION, FINDINGS_PROMPT_VERSION, STRUCTURED_PIPELINE, structuredStepContracts } from "../src/services/salesIntelligence/analysis/structuredPrompt";
import {
  loadManifest, manifestSaver, newManifest, OPERATOR_HOLD_REASON, runFullBackfill, SUPERSEDED_REASON,
  type BackfillOptions, type BackfillRunners, type FullBackfillManifest,
} from "./lib/full-backfill";

/**
 * Full-backfill replica proof on the csi01 loopback replica. The model step is faked (claimed by id exactly
 * like the historical claim, booked on the process ledger, completed with a run and a receipt); application
 * is faked but schedules the Number synthesis through the real `scheduleNumberIntelligence`.
 */
const MODEL = "openai/gpt-5.6-luna";
const oid = () => new mongoose.Types.ObjectId();

test("full backfill: one analysis per conversation, one synthesis per Number, holds, failures re-driven, resume, personal ledger", {
  skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000,
}, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.equal(getMongoDatabaseName(), "testvantagemovers_fullbackfill");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.equal(process.env.SALES_INTELLIGENCE_PERSONAL_LEDGER, "true");
  assert.equal(process.env.SALES_INTELLIGENCE_CASE_FILE, "true");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  await db.dropDatabase();
  const out = resolve("ops/output/full-backfill-proof");
  const manifestPath = `${out}/manifest.json`, repairPath = `${out}/repair.json`;
  t.after(async () => { await rm(out, { recursive: true, force: true }); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  for (const item of [...CSI_MODEL_REGISTRY.map(v => ({ collection: v.model().collection.collectionName, indexes: v.indexes })),
    { collection: "lead_conversations", indexes: LEAD_CONVERSATION_INDEXES }])
    for (const { key, ...options } of item.indexes as ReadonlyArray<{ key: Record<string, 1 | -1>; name: string; unique?: boolean }>)
      await db.collection(item.collection).createIndex(key, { ...options, unique: Boolean(options.unique) });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the full-backfill replica proof"); });
  const now = new Date(), month = now.toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });

  const Numbers = getContactNumberModel(), Conversations = getLeadConversationModel(), Runs = getIntelligenceRunModel(), Jobs = getSalesIntelligenceJobModel();
  const Snapshots = getIntelligenceEvidenceSnapshotModel(), Submissions = getIntelligenceSubmissionModel();
  const dataset = csiDataset();
  const enqueue = (input: Parameters<typeof enqueueCsiJob>[0], at = new Date()) => withTransaction(session => enqueueCsiJob(input, session, at));
  const setJob = (id: unknown, fields: Record<string, unknown>) => Jobs.collection.updateOne({ _id: id as mongoose.Types.ObjectId }, { $set: fields });

  // ── Seed ──────────────────────────────────────────────────────────────
  let clock = Date.parse("2026-09-01T12:00:00Z");
  const addNumber = async (extra: Record<string, unknown> = {}) => {
    const _id = oid();
    await Numbers.collection.insertOne({ _id, e164: `+1555010${String(Math.floor(Math.random() * 9000) + 1000)}`, digits_reversed: "x", country: "US", kind: "external",
      classification: "customer", contact_eligibility: { state: "allowed" }, first_observed_at: new Date(clock), last_activity_at: new Date(clock), revision: 1,
      rollups: {}, running_summary: null, intelligence_schedule: null, purged_at: null, content_purge_pending: false, ...extra });
    return String(_id);
  };
  const addConversation = async (numberId: string, extra: Record<string, unknown> = {}) => {
    const _id = oid(), snapshot = oid();
    clock += 3_600_000;
    await Conversations.collection.insertOne({ _id, provider: "ringcentral", provider_account_id: "acct", contact_number_id: new mongoose.Types.ObjectId(numberId),
      provider_recording_id: `rec-${_id}`, match_method: "phone", match_confidence: "high", direction: "Inbound", started_at: new Date(clock),
      latest_transcript_version: "v1", media_digest_sha256: "m", content_purged_at: null, analysis_eligibility: { status: "eligible", eligible: true },
      latest_completed_run_id: null, summary: null, state: "transcribed", ...extra });
    await Snapshots.collection.insertOne({ _id: snapshot, ...dataset, conversation_id: _id, transcript_version: "v1", source_type: "transcript",
      purged_at: null, completeness: { complete: true, missing_ranges: [] } });
    return { id: String(_id), snapshot: String(snapshot), key: `csi:analysis:conversation:${_id}:v1` };
  };
  const addRun = async (fields: Record<string, unknown>) => {
    const _id = oid();
    await Runs.collection.insertOne({ _id, ...dataset, model_version: MODEL, analysis_pipeline: STRUCTURED_PIPELINE, createdAt: new Date(), finalized_at: null, ...fields });
    return _id;
  };

  // N1: A (set a; its standard job in retry backoff), B (set b: analysed on v4, standard job completed).
  const n1 = await addNumber();
  const a = await addConversation(n1), b = await addConversation(n1);
  const jobA = await enqueue({ stage: "analysis", subject_key: `conversation:${a.id}`, dedupe_key: a.key, input_revision: 1, input_refs: [a.id, a.snapshot], priority: 0 });
  await setJob(jobA._id, { status: "retry", reason: "transient", next_attempt_at: new Date(Date.now() + 3_600_000) });
  const jobB = await enqueue({ stage: "analysis", subject_key: `conversation:${b.id}`, dedupe_key: b.key, input_revision: 1, input_refs: [b.id, b.snapshot], priority: 0 });
  await setJob(jobB._id, { status: "completed", completed_at: new Date("2026-09-10T00:00:00Z") });
  const oldRunB = await addRun({ job_id: jobB._id, subject_key: `conversation:${b.id}`, conversation_id: new mongoose.Types.ObjectId(b.id),
    contact_number_id: new mongoose.Types.ObjectId(n1), status: "completed", prompt_version: FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("legacy") });
  await Conversations.collection.updateOne({ _id: new mongoose.Types.ObjectId(b.id) }, { $set: { latest_completed_run_id: oldRunB,
    summary: { text: "old", model: MODEL, prompt_version: FINDINGS_PROMPT_VERSION, created_at: new Date("2026-09-10T00:00:00Z") } } });

  // N2: C (set a; paused schema_exhausted with a legacy-layout run → superseded), D (set a; the repair's operator_hold).
  const n2 = await addNumber();
  const c = await addConversation(n2), d = await addConversation(n2);
  const jobC = await enqueue({ stage: "analysis", subject_key: `conversation:${c.id}`, dedupe_key: c.key, input_revision: 1, input_refs: [c.id, c.snapshot], priority: 0 });
  await setJob(jobC._id, { status: "paused", reason: "permission_denied", result: { reason: "schema_exhausted" } });
  const runC = await addRun({ job_id: jobC._id, subject_key: `conversation:${c.id}`, conversation_id: new mongoose.Types.ObjectId(c.id),
    contact_number_id: new mongoose.Types.ObjectId(n2), status: "paused", prompt_version: FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("legacy") });
  const jobD = await enqueue({ stage: "analysis", subject_key: `conversation:${d.id}`, dedupe_key: d.key, input_revision: 1, input_refs: [d.id, d.snapshot], priority: 0 });
  await setJob(jobD._id, { status: "paused", reason: OPERATOR_HOLD_REASON });

  // N3: E (set a; dead-lettered with no run → re-armed); its scheduled synthesis is an S10 (foreign) hold.
  const n3 = await addNumber();
  const e = await addConversation(n3);
  const jobE = await enqueue({ stage: "analysis", subject_key: `conversation:${e.id}`, dedupe_key: e.key, input_revision: 1, input_refs: [e.id, e.snapshot], priority: 0 });
  await setJob(jobE._id, { status: "dead_letter", reason: "attempts_exhausted", attempts: 8 });
  const s10 = await enqueue({ stage: "number_refresh", subject_key: `number:${n3}`, dedupe_key: `csi:number-analysis:${n3}:1`, input_revision: 1, input_refs: [n3], priority: 0 });
  await setJob(s10._id, { status: "paused", reason: OPERATOR_HOLD_REASON });
  await Numbers.collection.updateOne({ _id: new mongoose.Types.ObjectId(n3) }, { $set: { intelligence_schedule: { fingerprint: "s10", generation: 1, job_id: s10._id } } });

  // N4: F already current on v5 (set c only: no running summary); its scheduled synthesis is paused step_timeout on a legacy run.
  const n4 = await addNumber();
  const f = await addConversation(n4);
  const jobF = await enqueue({ stage: "analysis", subject_key: `conversation:${f.id}`, dedupe_key: f.key, input_revision: 1, input_refs: [f.id, f.snapshot], priority: 0 });
  await setJob(jobF._id, { status: "completed", completed_at: new Date("2026-09-20T00:00:00Z") });
  const runF = await addRun({ job_id: jobF._id, subject_key: `conversation:${f.id}`, conversation_id: new mongoose.Types.ObjectId(f.id),
    contact_number_id: new mongoose.Types.ObjectId(n4), status: "completed", prompt_version: CASE_FILE_FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("case_file") });
  await Conversations.collection.updateOne({ _id: new mongoose.Types.ObjectId(f.id) }, { $set: { latest_completed_run_id: runF,
    summary: { text: "v5", model: MODEL, prompt_version: CASE_FILE_FINDINGS_PROMPT_VERSION, created_at: new Date("2026-09-20T00:00:00Z") } } });
  const n4Paused = await enqueue({ stage: "number_refresh", subject_key: `number:${n4}`, dedupe_key: `csi:number-analysis:${n4}:1`, input_revision: 1, input_refs: [n4], priority: 0 });
  await setJob(n4Paused._id, { status: "paused", reason: "permission_denied", result: { reason: "step_timeout", step_timeouts: 2 } });
  const n4OldRun = await addRun({ job_id: n4Paused._id, subject_key: `number:${n4}`, conversation_id: null, contact_number_id: new mongoose.Types.ObjectId(n4),
    status: "paused", prompt_version: FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("legacy") });
  await Numbers.collection.updateOne({ _id: new mongoose.Types.ObjectId(n4) }, { $set: { intelligence_schedule: { fingerprint: "old", generation: 1, job_id: n4Paused._id } } });

  // N5: suppressed (excluded). A shadow application job that must stay untouched.
  const n5 = await addNumber({ contact_eligibility: { state: "suppressed" } });
  await addConversation(n5);
  const shadow = await enqueue({ stage: "application", subject_key: `conversation:${c.id}`, dedupe_key: "csi:application:run:shadow", input_revision: 1, input_refs: [String(oid()), String(oid())] });
  await setJob(shadow._id, { status: "paused", reason: "permission_denied", result: { reason: "shadow_analysis" } });

  await mkdir(out, { recursive: true });
  await writeFile(repairPath, JSON.stringify({ version: "call-log-repair-v1", mode: "apply", holds: [{ job_id: String(jobD._id), stage: "analysis" }] }));

  // ── Faked model step and application ─────────────────────────────────────
  const calls: Array<{ stage: string; subject: string; job: string }> = [];
  let killOn: string | null = b.id;
  const cronCannotClaim = async () => {
    for (const stage of ["analysis", "number_refresh"] as const)
      assert.equal(await claimCsiJob("csi-analysis:cron", undefined, 60_000, stage), null, `an undirected cron claim takes no ${stage} job while the backfill runs`);
  };
  const runners: BackfillRunners = {
    analysis: async (jobId, stage) => {
      const job = await claimCsiJob("csi-full-backfill:proof", jobId, 60_000, stage, undefined, { historical: true });
      if (!job) return { status: "not_claimable" };
      await cronCannotClaim();
      const lease = { job_id: jobId, owner: job.lease_owner!, epoch: job.lease_epoch };
      const subject = job.subject_key.split(":")[1]!;
      calls.push({ stage, subject, job: jobId });
      const conversation = stage === "analysis" ? await Conversations.findById(subject).select("contact_number_id").lean() : null;
      const numberId = conversation ? String(conversation.contact_number_id) : subject;
      const runId = oid(), submissionId = oid();
      const reservation = `proof:${jobId}:${job.lease_epoch}`;
      await reserveCsiBudget({ reservation_id: reservation, month, job_id: jobId, run_id: String(runId), step: `findings:${jobId}:invocation:${job.lease_epoch}`,
        stage: "analysis", estimated_cents: 5, soft_stop: true, ledger: currentLedger() });
      await reconcileCsiBudget(reservation, 4);
      const fingerprint = (await withTransaction(session => intelligenceSources(numberId, session))).fingerprint;
      await addRun({ _id: runId, job_id: new mongoose.Types.ObjectId(jobId), subject_key: job.subject_key, contact_number_id: new mongoose.Types.ObjectId(numberId),
        conversation_id: conversation ? new mongoose.Types.ObjectId(subject) : null, status: "submitted", prompt_version: CASE_FILE_FINDINGS_PROMPT_VERSION,
        step_contracts: structuredStepContracts("case_file"), input_fingerprint: fingerprint, finalized_at: new Date() });
      const application = await enqueue({ stage: "application", subject_key: job.subject_key, dedupe_key: `csi:application:run:${runId}`, input_revision: 1,
        input_refs: [String(runId), String(submissionId)] });
      await Submissions.collection.insertOne({ _id: submissionId, run_id: runId, application_job_id: application._id });
      await completeCsiJob(lease, async session => {
        // What the worker's finish does: a Number run updates the fingerprint only when it is the scheduled job.
        if (stage === "number_refresh") await Numbers.updateOne({ _id: numberId, "intelligence_schedule.job_id": jobId },
          { $set: { "intelligence_schedule.fingerprint": fingerprint } }, { session });
      }, { result: { run_id: String(runId) } });
      if (killOn && killOn === subject) { killOn = null; throw new Error("simulated kill"); }
      return { status: "submitted" };
    },
    application: async jobId => {
      const job = await claimCsiJob("csi-apply:proof", jobId, 60_000, "application");
      if (!job) return { status: "not_claimable" };
      const run = await Runs.findById(String(job.input_refs[0])).lean();
      await completeCsiJob({ job_id: jobId, owner: job.lease_owner!, epoch: job.lease_epoch }, async session => {
        if (run!.conversation_id) await Conversations.collection.updateOne({ _id: run!.conversation_id as mongoose.Types.ObjectId }, { $set: { latest_completed_run_id: run!._id,
          summary: { text: "s", model: MODEL, prompt_version: run!.prompt_version, created_at: new Date() } } }, { session });
        else await Numbers.collection.updateOne({ _id: run!.contact_number_id as mongoose.Types.ObjectId }, { $set: { running_summary: { text: "s", run_id: run!._id,
          evidence_digest: "d", computed_at: new Date() } }, $inc: { revision: 1 } }, { session });
        await Runs.collection.updateOne({ _id: run!._id }, { $set: { status: "completed", completed_at: new Date() } }, { session });
        await scheduleNumberIntelligence(String(run!.contact_number_id), session);
      });
      return { status: "completed" };
    },
  };
  let repairRuns = 0;
  const log: Array<{ event: string } & Record<string, unknown>> = [];
  const seams = { runners, save: manifestSaver(manifestPath), log: async (event: string, fields: Record<string, unknown> = {}) => { log.push({ event, ...fields }); },
    sleep: async () => undefined, runRepair: async () => { repairRuns++; return 0; } };
  const options: BackfillOptions = { concurrency: 1, s10Holds: "leave", repairManifest: repairPath, skipRepair: false, numbers: null, since: null, maxNumbers: null, model: MODEL };

  // ── Run 1: killed after B's analysis committed, before its application ────
  const manifest = newManifest({ now: new Date(Date.now() - 1_000), layout: "case_file", models: { extraction: MODEL }, deployed_commit: null, local_head: null,
    options: { concurrency: 1, numbers: null, max_numbers: null, since: null, s10_holds: "leave", repair_manifest: repairPath } });
  await assert.rejects(() => runFullBackfill(manifest, seams, options), /simulated kill/);
  assert.equal(repairRuns, 1, "phase 1 re-ran the repair on its manifest");
  let saved = (await loadManifest(manifestPath))!;
  assert.deepEqual(saved.phases.select.counts, { eligible_conversations: 7, a: 4, b: 1, numbers_with_conversations: 3, numbers_synthesis_only: 1, numbers: 4, truncated: 0 });
  assert.deepEqual(saved.phases.select.excluded, { suppressed: 1 });
  assert.equal(saved.numbers[0]!.number_id, n1);
  assert.equal(saved.numbers[0]!.conversations[0]!.state, "done");
  assert.equal(saved.numbers[0]!.conversations[1]!.state, "pending");
  const heldSchedule = saved.holds.find(h => h.stage === "number_refresh" && h.number_id === n1);
  assert.ok(heldSchedule, "the synthesis A's application scheduled is on operator_hold while B waits");
  assert.deepEqual([(await Jobs.findById(heldSchedule!.job_id).lean())?.status, (await Jobs.findById(heldSchedule!.job_id).lean())?.reason], ["paused", OPERATOR_HOLD_REASON]);
  await cronCannotClaim();

  // ── Run 2: resume (S10 holds left) ───────────────────────────────────────
  const summary = await runFullBackfill(saved, seams, options);
  assert.equal(repairRuns, 1, "the repair phase is not repeated on resume");
  saved = (await loadManifest(manifestPath))!;
  const count = (stage: string, subject: string) => calls.filter(x => x.stage === stage && x.subject === subject).length;
  for (const conv of [a, b, c, e]) assert.equal(count("analysis", conv.id), 1, `conversation analysed exactly once`);
  assert.equal(count("analysis", d.id), 0);
  assert.equal(count("analysis", f.id), 0, "a current conversation is not re-analysed");
  for (const number of [n1, n2, n4]) assert.equal(count("number_refresh", number), 1, "exactly one Number synthesis");
  assert.equal(count("number_refresh", n3), 0);
  for (const number of [n1, n2, n4]) {
    const sources = await withTransaction(session => intelligenceSources(number, session));
    const row = await Numbers.findById(number).lean();
    assert.equal(row?.intelligence_schedule?.fingerprint, sources.fingerprint, "the synthesis updated intelligence_schedule.fingerprint");
    const synthesis = await Runs.findById(row?.running_summary?.run_id).lean();
    assert.equal(synthesis?.status, "completed");
    assert.equal(String(synthesis?.job_id), String(row?.intelligence_schedule?.job_id), "the running summary came from the scheduled job");
  }
  const byNumber = new Map(saved.numbers.map(n => [n.number_id, n]));
  assert.equal(byNumber.get(n1)!.state, "done");
  assert.deepEqual(byNumber.get(n1)!.conversations.map(x => x.units.find(u => u.stage === "analysis")?.by), ["backfill", "backfill"]);

  // C: the legacy-layout paused run could not resume → superseded; fresh work ran; the prior state is recorded.
  const cUnit = byNumber.get(n2)!.conversations.find(x => x.conversation_id === c.id)!.units.find(u => u.stage === "analysis")!;
  assert.equal(cUnit.prior?.action, "superseded");
  assert.deepEqual([cUnit.prior?.status, cUnit.prior?.reason, cUnit.prior?.result_reason], ["paused", "permission_denied", "schema_exhausted"]);
  const supersededC = await Jobs.findById(jobC._id).lean();
  assert.deepEqual([supersededC?.status, (supersededC?.result as { reason?: string })?.reason], ["completed", SUPERSEDED_REASON]);
  assert.equal((await Runs.findById(runC).lean())?.status, "stale");
  // D: the repair owns it; never released, never listed as this run's hold.
  const dEntry = byNumber.get(n2)!.conversations.find(x => x.conversation_id === d.id)!;
  assert.deepEqual([dEntry.state, dEntry.reason, dEntry.units[0]?.by], ["blocked", "repair_hold", "repair"]);
  assert.deepEqual([(await Jobs.findById(jobD._id).lean())?.status, (await Jobs.findById(jobD._id).lean())?.reason], ["paused", OPERATOR_HOLD_REASON]);
  // E: dead letter with no run → re-armed by id (same dedupe), `by: "prior"`.
  const eUnit = byNumber.get(n3)!.conversations[0]!.units.find(u => u.stage === "analysis")!;
  assert.deepEqual([eUnit.by, eUnit.job_id, eUnit.prior?.action, eUnit.prior?.status], ["prior", String(jobE._id), "rearmed", "dead_letter"]);
  // N3: the S10 hold is its scheduled synthesis: left held and listed.
  assert.deepEqual([byNumber.get(n3)!.state, byNumber.get(n3)!.reason], ["blocked", "s10_hold_left"]);
  assert.deepEqual([(await Jobs.findById(s10._id).lean())?.status, (await Jobs.findById(s10._id).lean())?.reason], ["paused", OPERATOR_HOLD_REASON]);
  assert.equal(saved.foreign_holds.find(h => h.job_id === String(s10._id))?.action, "left");
  // N4: the paused synthesis on a legacy run was superseded and the next generation ran.
  const n4Unit = byNumber.get(n4)!.synthesis.find(u => u.stage === "number_refresh")!;
  assert.equal(n4Unit.prior?.action, "superseded");
  assert.equal((await Runs.findById(n4OldRun).lean())?.status, "stale");
  assert.equal(byNumber.has(n5), false, "a suppressed Number is excluded");
  assert.deepEqual([(await Jobs.findById(shadow._id).lean())?.status, ((await Jobs.findById(shadow._id).lean())?.result as { reason?: string })?.reason], ["paused", "shadow_analysis"]);

  assert.equal(saved.holds.length, 0, "no operator_hold left that this run owns");
  assert.equal(summary.peer_paid_units, 0);
  assert.equal(saved.phases.verify?.conversations_left.b, 0);
  assert.equal(saved.phases.verify?.conversations_left.a, 1, "only D (the repair's) is left unanalysed");
  assert.deepEqual(saved.phases.verify?.numbers.mismatched, []);
  await cronCannotClaim();

  // Reservations land on the personal ledger; the Owner budget is untouched.
  const reservations = await getSalesIntelligenceAiReservationModel().find({}).lean();
  assert.ok(reservations.length >= 7 && reservations.every(r => r.ledger === "personal"));
  const budget = await getSalesIntelligenceAiBudgetModel().findOne({ month }).lean();
  assert.deepEqual([budget?.reserved_cents, budget?.actual_cents], [0, 0]);
  assert.ok(saved.phases.verify?.spend.every(s => s.ledger === "personal"));
  assert.ok(!JSON.stringify(saved).includes("+1555"), "the manifest carries no phone numbers");

  // ── Run 3: the operator chooses to drive S10 holds ─────────────────────────
  const before = calls.length;
  const drive = await runFullBackfill(saved, seams, { ...options, s10Holds: "drive" });
  saved = (await loadManifest(manifestPath))! as FullBackfillManifest;
  assert.equal(calls.length - before, 1, "only N3's synthesis ran; nothing else repeated");
  assert.equal(count("number_refresh", n3), 1);
  const n3Unit = saved.numbers.find(n => n.number_id === n3)!.synthesis.find(u => u.stage === "number_refresh")!;
  assert.deepEqual([n3Unit.by, n3Unit.job_id], ["s10-hold", String(s10._id)]);
  assert.equal(saved.foreign_holds.find(h => h.job_id === String(s10._id))?.action, "driven");
  assert.equal((await Jobs.findById(s10._id).lean())?.status, "completed");
  assert.deepEqual(saved.phases.verify?.numbers.mismatched, []);
  assert.equal(drive.peer_paid_units, 0);
  assert.equal(saved.holds.length, 0);
});
