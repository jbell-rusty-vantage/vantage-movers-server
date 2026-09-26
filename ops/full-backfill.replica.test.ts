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
import { currentLedger, initializeCsiBudgetPeriod, reconcileCsiBudget, reserveCsiBudget, resumeBudgetPausedJobs } from "../src/services/salesIntelligence/aiBudget";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob } from "../src/services/salesIntelligence/jobs";
import { intelligenceSources } from "../src/services/salesIntelligence/analysis/sources";
import { scheduleNumberIntelligence } from "../src/services/salesIntelligence/analysis/scheduling";
import { CASE_FILE_FINDINGS_PROMPT_VERSION, FINDINGS_PROMPT_VERSION, STRUCTURED_PIPELINE, structuredStepContracts } from "../src/services/salesIntelligence/analysis/structuredPrompt";
import {
  estimateWorkSet, loadManifest, manifestSaver, newManifest, OPERATOR_HOLD_REASON, readRepairHoldIds, runFullBackfill, selectWorkSet, SUPERSEDED_REASON,
  targetVersions, type BackfillOptions, type BackfillRunners, type FullBackfillManifest,
} from "./lib/full-backfill";

/**
 * Full-backfill replica proof on the csi01 loopback replica. The model step is faked (claimed by id exactly
 * like the historical claim, booked on the process ledger, completed with a run and a receipt); application
 * is faked but schedules the Number synthesis through the real `scheduleNumberIntelligence`.
 */
const MODEL = "openai/gpt-5.6-luna";
const oid = () => new mongoose.Types.ObjectId();
const asId = (id: string) => new mongoose.Types.ObjectId(id);

test("full backfill: one analysis per conversation, one synthesis per Number, holds, failures re-driven, budget, kills and resume, personal ledger", {
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
  const manifestPath = `${out}/manifest.json`, drivePath = `${out}/drive.json`, repairPath = `${out}/repair.json`;
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
  const jobState = async (id: unknown) => { const j = await Jobs.findById(String(id)).lean(); return [j?.status, j?.reason]; };
  const fingerprintOf = async (numberId: string) => (await withTransaction(session => intelligenceSources(numberId, session))).fingerprint;

  // ── Seed ──────────────────────────────────────────────────────────────
  let clock = Date.parse("2026-09-01T12:00:00Z"), phone = 1000;
  const addNumber = async (extra: Record<string, unknown> = {}) => {
    const _id = oid();
    await Numbers.collection.insertOne({ _id, e164: `+15550100${phone++}`, digits_reversed: "x", country: "US", kind: "external",
      classification: "customer", contact_eligibility: { state: "allowed" }, first_observed_at: new Date(clock), last_activity_at: new Date(clock), revision: 1,
      rollups: {}, running_summary: null, intelligence_schedule: null, purged_at: null, content_purge_pending: false, ...extra });
    return String(_id);
  };
  const addConversation = async (numberId: string, extra: Record<string, unknown> = {}) => {
    const _id = oid(), snapshot = oid();
    clock += 3_600_000;
    await Conversations.collection.insertOne({ _id, provider: "ringcentral", provider_account_id: "acct", contact_number_id: asId(numberId),
      provider_recording_id: `rec-${_id}`, match_method: "phone", match_confidence: "high", direction: "Inbound", started_at: new Date(clock),
      latest_transcript_version: "v1", media_digest_sha256: "m", content_purged_at: null, analysis_eligibility: { status: "eligible", eligible: true },
      latest_completed_run_id: null, summary: null, state: "transcribed", ...extra });
    await Snapshots.collection.insertOne({ _id: snapshot, ...dataset, conversation_id: _id, transcript_version: "v1", source_type: "transcript",
      purged_at: null, completeness: { complete: true, missing_ranges: [] } });
    return { id: String(_id), snapshot: String(snapshot), key: `csi:analysis:conversation:${_id}:v1` };
  };
  const addRun = async (fields: Record<string, unknown>) => {
    const _id = (fields._id as mongoose.Types.ObjectId | undefined) ?? oid();
    await Runs.collection.insertOne({ ...dataset, model_version: MODEL, analysis_pipeline: STRUCTURED_PIPELINE, createdAt: new Date(), finalized_at: null, ...fields, _id });
    return _id;
  };
  const analysisJob = (conv: { id: string; snapshot: string; key: string }) =>
    enqueue({ stage: "analysis", subject_key: `conversation:${conv.id}`, dedupe_key: conv.key, input_revision: 1, input_refs: [conv.id, conv.snapshot], priority: 0 });
  const numberJob = (numberId: string, generation: number) =>
    enqueue({ stage: "number_refresh", subject_key: `number:${numberId}`, dedupe_key: `csi:number-analysis:${numberId}:${generation}`, input_revision: generation, input_refs: [numberId], priority: 0 });
  /** A conversation already analysed on v5 (current). */
  const currentConversation = async (numberId: string) => {
    const conv = await addConversation(numberId);
    const job = await analysisJob(conv);
    await setJob(job._id, { status: "completed", completed_at: new Date("2026-09-20T00:00:00Z") });
    const run = await addRun({ job_id: job._id, subject_key: `conversation:${conv.id}`, conversation_id: asId(conv.id), contact_number_id: asId(numberId),
      status: "completed", prompt_version: CASE_FILE_FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("case_file") });
    await Conversations.collection.updateOne({ _id: asId(conv.id) }, { $set: { latest_completed_run_id: run,
      summary: { text: "v5", model: MODEL, prompt_version: CASE_FILE_FINDINGS_PROMPT_VERSION, created_at: new Date("2026-09-20T00:00:00Z") } } });
    return conv;
  };

  // N1: A (set a; standard job in retry backoff; its first claim hits budget_exhausted), B (set b: analysed on v4; killed mid-claim).
  const n1 = await addNumber();
  const a = await addConversation(n1), b = await addConversation(n1);
  const jobA = await analysisJob(a);
  await setJob(jobA._id, { status: "retry", reason: "transient", next_attempt_at: new Date(Date.now() + 3_600_000) });
  const jobB = await analysisJob(b);
  await setJob(jobB._id, { status: "completed", completed_at: new Date("2026-09-10T00:00:00Z") });
  const oldRunB = await addRun({ job_id: jobB._id, subject_key: `conversation:${b.id}`, conversation_id: asId(b.id),
    contact_number_id: asId(n1), status: "completed", prompt_version: FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("legacy") });
  await Conversations.collection.updateOne({ _id: asId(b.id) }, { $set: { latest_completed_run_id: oldRunB,
    summary: { text: "old", model: MODEL, prompt_version: FINDINGS_PROMPT_VERSION, created_at: new Date("2026-09-10T00:00:00Z") } } });

  // N2: C (set a; paused schema_exhausted on a legacy-layout run → superseded; killed after commit), D (set a; the repair's operator_hold).
  const n2 = await addNumber();
  const c = await addConversation(n2), d = await addConversation(n2);
  const jobC = await analysisJob(c);
  await setJob(jobC._id, { status: "paused", reason: "permission_denied", result: { reason: "schema_exhausted" } });
  const runC = await addRun({ job_id: jobC._id, subject_key: `conversation:${c.id}`, conversation_id: asId(c.id),
    contact_number_id: asId(n2), status: "paused", prompt_version: FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("legacy") });
  const jobD = await analysisJob(d);
  await setJob(jobD._id, { status: "paused", reason: OPERATOR_HOLD_REASON });

  // N3: E (set a; dead-lettered, no run → re-armed); its scheduled synthesis is an S10 (foreign) hold, left under `leave`.
  const n3 = await addNumber();
  const e = await addConversation(n3);
  const jobE = await analysisJob(e);
  await setJob(jobE._id, { status: "dead_letter", reason: "attempts_exhausted", attempts: 8 });
  const s10n3 = await numberJob(n3, 1);
  await setJob(s10n3._id, { status: "paused", reason: OPERATOR_HOLD_REASON });
  await Numbers.collection.updateOne({ _id: asId(n3) }, { $set: { intelligence_schedule: { fingerprint: "s10", generation: 1, job_id: s10n3._id } } });

  // N4: current (set c); scheduled synthesis paused step_timeout on a legacy run → superseded, next generation runs.
  const n4 = await addNumber();
  await currentConversation(n4);
  const n4Paused = await numberJob(n4, 1);
  await setJob(n4Paused._id, { status: "paused", reason: "permission_denied", result: { reason: "step_timeout", step_timeouts: 2 } });
  const n4OldRun = await addRun({ job_id: n4Paused._id, subject_key: `number:${n4}`, conversation_id: null, contact_number_id: asId(n4),
    status: "paused", prompt_version: FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("legacy") });
  await Numbers.collection.updateOne({ _id: asId(n4) }, { $set: { intelligence_schedule: { fingerprint: "old", generation: 1, job_id: n4Paused._id } } });

  // N5: suppressed (excluded).
  const n5 = await addNumber({ contact_eligibility: { state: "suppressed" } });
  await addConversation(n5);

  // N7: current (set c); its scheduled synthesis is pending (retry) on a legacy run → the layout check supersedes it before any claim.
  const n7 = await addNumber();
  await currentConversation(n7);
  const n7Pending = await numberJob(n7, 1);
  await setJob(n7Pending._id, { status: "retry", reason: "transient", next_attempt_at: new Date(Date.now() + 3_600_000) });
  const n7OldRun = await addRun({ job_id: n7Pending._id, subject_key: `number:${n7}`, conversation_id: null, contact_number_id: asId(n7),
    status: "running", prompt_version: FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("legacy") });
  await Numbers.collection.updateOne({ _id: asId(n7) }, { $set: { intelligence_schedule: { fingerprint: "old7", generation: 1, job_id: n7Pending._id } } });

  // N8: current (set c); its scheduled synthesis completed on v5 with a submitted run whose application is paused (incomplete_coverage).
  const n8 = await addNumber();
  await currentConversation(n8);
  const n8Done = await numberJob(n8, 1);
  await setJob(n8Done._id, { status: "completed", completed_at: new Date() });
  const run8 = await addRun({ job_id: n8Done._id, subject_key: `number:${n8}`, conversation_id: null, contact_number_id: asId(n8),
    status: "submitted", prompt_version: CASE_FILE_FINDINGS_PROMPT_VERSION, step_contracts: structuredStepContracts("case_file"), finalized_at: new Date() });
  const sub8 = oid();
  const app8 = await enqueue({ stage: "application", subject_key: `number:${n8}`, dedupe_key: `csi:application:run:${run8}`, input_revision: 1, input_refs: [String(run8), String(sub8)] });
  await setJob(app8._id, { status: "paused", reason: "permission_denied", result: { reason: "incomplete_coverage" } });
  await Submissions.collection.insertOne({ _id: sub8, run_id: run8, application_job_id: app8._id });
  await Numbers.collection.updateOne({ _id: asId(n8) }, { $set: { intelligence_schedule: { fingerprint: await fingerprintOf(n8), generation: 1, job_id: n8Done._id } } });

  // A shadow application job that must stay untouched.
  const shadow = await enqueue({ stage: "application", subject_key: `conversation:${c.id}`, dedupe_key: "csi:application:run:shadow", input_revision: 1, input_refs: [String(oid()), String(oid())] });
  await setJob(shadow._id, { status: "paused", reason: "permission_denied", result: { reason: "shadow_analysis" } });

  await mkdir(out, { recursive: true });
  await writeFile(repairPath, JSON.stringify({ version: "call-log-repair-v1", mode: "apply", holds: [{ job_id: String(jobD._id), stage: "analysis" }] }));

  // ── Estimate: strictly read-only ─────────────────────────────────────────
  const snapshotDb = async () => {
    const out: Record<string, string> = {};
    for (const { name } of await db.listCollections().toArray()) out[name] = JSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
    return out;
  };
  const beforeEstimate = await snapshotDb();
  const ws = await selectWorkSet(targetVersions("case_file"), { numbers: null, since: null, maxNumbers: null }, new Date());
  const estimate = await estimateWorkSet(ws, targetVersions("case_file"), MODEL, await readRepairHoldIds(repairPath), new Date());
  assert.deepEqual(await snapshotDb(), beforeEstimate, "--estimate writes nothing");
  assert.deepEqual(ws.counts, { eligible_conversations: 9, a: 4, b: 1, numbers_with_conversations: 3, numbers_synthesis_only: 3, numbers: 6, truncated: 0 });
  assert.deepEqual([estimate.calls.conversation_findings, estimate.calls.number_findings, estimate.calls.number_summaries], [5, 6, 8],
    "every Number synthesis summary step is counted");
  assert.equal(estimate.jobs.repair_holds.still_held, 1);
  assert.equal(estimate.jobs.foreign_holds.total, 1);

  // ── Faked model step and application ─────────────────────────────────────
  const calls: Array<{ stage: string; subject: string; job: string }> = [];
  const once = new Map<string, "budget" | "budget_race" | "kill_mid" | "kill_after" | "throw_before_claim">([[a.id, "budget"], [b.id, "kill_mid"],
    [c.id, "kill_after"], [e.id, "throw_before_claim"], [n4, "budget_race"]]);
  const cronCannotClaim = async () => {
    for (const stage of ["analysis", "number_refresh"] as const)
      assert.equal(await claimCsiJob("csi-analysis:cron", undefined, 60_000, stage), null, `an undirected cron claim takes no ${stage} job while the backfill runs`);
  };
  const runners: BackfillRunners = {
    analysis: async (jobId, stage) => {
      const peek = await Jobs.findById(jobId).lean();
      const subject = String(peek?.subject_key).split(":")[1]!;
      const behaviour = once.get(subject);
      if (behaviour) once.delete(subject);
      if (behaviour === "throw_before_claim") {
        assert.deepEqual([peek?.status, (await Jobs.findById(jobId).lean())?.status], ["pending", "pending"], "released, due, not yet claimed");
        throw new Error("simulated throw between release and claim");
      }
      const job = await claimCsiJob("csi-full-backfill:proof", jobId, behaviour === "kill_mid" ? 1_500 : 60_000, stage, undefined, { historical: true });
      if (!job) return { status: "not_claimable" };
      await cronCannotClaim();
      const lease = { job_id: jobId, owner: job.lease_owner!, epoch: job.lease_epoch };
      if (behaviour === "kill_mid") throw new Error("simulated kill mid-claim");
      if (behaviour === "budget") { await failCsiJob(lease, "budget_exhausted", 0, { result: { reason: "budget_exhausted" } }); return { status: "paused", reason: "budget_exhausted" }; }
      if (behaviour === "budget_race") {
        // A month rollover in the same instant: activating the new period resumes every budget pause before the backfill can hold it.
        await failCsiJob(lease, "budget_exhausted", 0, { result: { reason: "budget_exhausted" } });
        assert.equal((await resumeBudgetPausedJobs()).job_ids.includes(jobId), true);
        return { status: "paused", reason: "budget_exhausted" };
      }
      calls.push({ stage, subject, job: jobId });
      const conversation = stage === "analysis" ? await Conversations.findById(subject).select("contact_number_id").lean() : null;
      const numberId = conversation ? String(conversation.contact_number_id) : subject;
      const runId = oid(), submissionId = oid();
      const reservation = `proof:${jobId}:${job.lease_epoch}`;
      await reserveCsiBudget({ reservation_id: reservation, month, job_id: jobId, run_id: String(runId), step: `findings:${jobId}:invocation:${job.lease_epoch}`,
        stage: "analysis", estimated_cents: 5, soft_stop: true, ledger: currentLedger() });
      await reconcileCsiBudget(reservation, 4);
      const fingerprint = await fingerprintOf(numberId);
      await addRun({ _id: runId, job_id: asId(jobId), subject_key: job.subject_key, contact_number_id: asId(numberId),
        conversation_id: conversation ? asId(subject) : null, status: "submitted", prompt_version: CASE_FILE_FINDINGS_PROMPT_VERSION,
        step_contracts: structuredStepContracts("case_file"), input_fingerprint: fingerprint, finalized_at: new Date() });
      const application = await enqueue({ stage: "application", subject_key: job.subject_key, dedupe_key: `csi:application:run:${runId}`, input_revision: 1,
        input_refs: [String(runId), String(submissionId)] });
      await Submissions.collection.insertOne({ _id: submissionId, run_id: runId, application_job_id: application._id });
      await completeCsiJob(lease, async session => {
        // What the worker's finish does: a Number run updates the fingerprint only when it is the scheduled job.
        if (stage === "number_refresh") await Numbers.updateOne({ _id: numberId, "intelligence_schedule.job_id": jobId },
          { $set: { "intelligence_schedule.fingerprint": fingerprint } }, { session });
      }, { result: { run_id: String(runId) } });
      if (behaviour === "kill_after") throw new Error("simulated kill after commit");
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
  let repairRuns = 0, repairCode = 1;
  const seams = (path: string) => ({ runners, save: manifestSaver(path), log: async () => undefined, sleep: async () => undefined,
    runRepair: async () => { repairRuns++; return repairCode; } });
  const options: BackfillOptions = { concurrency: 1, s10Holds: "leave", repairManifest: repairPath, skipRepair: false, numbers: null, since: null, maxNumbers: null, model: MODEL };
  const count = (stage: string, subject: string) => calls.filter(x => x.stage === stage && x.subject === subject).length;

  // ── Run 0: the repair fails; nothing else runs ─────────────────────────────
  const manifest = newManifest({ now: new Date(Date.now() - 1_000), layout: "case_file", models: { extraction: MODEL }, deployed_commit: null, local_head: null,
    options: { concurrency: 1, numbers: null, max_numbers: null, since: null, s10_holds: "leave", repair_manifest: repairPath } });
  await assert.rejects(() => runFullBackfill(manifest, seams(manifestPath), options), /repair exited 1/);
  let saved = (await loadManifest(manifestPath))!;
  assert.deepEqual([saved.phases.repair.state, saved.stopped], ["failed", "repair_exit_1"]);

  // ── Run 1: resume re-runs the failed repair; A's claim hits budget_exhausted → held, run stops ──
  repairCode = 0;
  const stoppedOnBudget = await runFullBackfill(saved, seams(manifestPath), options);
  assert.equal(repairRuns, 2, "a failed repair phase is re-run on resume");
  saved = (await loadManifest(manifestPath))!;
  assert.equal(saved.phases.repair.state, "done");
  assert.equal(stoppedOnBudget.stopped, "budget_exhausted");
  assert.equal(stoppedOnBudget.complete, false);
  assert.deepEqual(await jobState(jobA._id), ["paused", OPERATOR_HOLD_REASON], "a budget pause goes back on operator_hold");
  assert.deepEqual(saved.holds.find(h => h.job_id === String(jobA._id))?.prior_reason, "budget_exhausted");
  await resumeBudgetPausedJobs();
  assert.deepEqual(await jobState(jobA._id), ["paused", OPERATOR_HOLD_REASON], "production's budget resume cannot release it onto the company key");
  await cronCannotClaim();

  // ── Run 2: resume clears `stopped`; A runs; B is killed mid-claim (its lease stays) ──
  await assert.rejects(() => runFullBackfill(saved, seams(manifestPath), options), /simulated kill mid-claim/);
  saved = (await loadManifest(manifestPath))!;
  assert.equal(saved.stopped, undefined);
  assert.equal(count("analysis", a.id), 1);
  assert.equal(saved.numbers[0]!.conversations[0]!.state, "done");
  const ownB = await Jobs.findOne({ dedupe_key: { $regex: `^${b.key}:full-backfill:` } }).lean();
  assert.equal(ownB?.status, "leased");
  assert.ok(saved.inflight?.includes(String(ownB!._id)), "the in-flight claim is recorded before the kill");
  const heldSchedule = saved.holds.find(h => h.stage === "number_refresh" && h.number_id === n1);
  assert.ok(heldSchedule, "the synthesis A's application scheduled is on operator_hold while B waits");
  assert.deepEqual(await jobState(heldSchedule!.job_id), ["paused", OPERATOR_HOLD_REASON]);

  // ── Run 3: B's own lease from before the kill is recognised (not a peer); C is killed after its analysis committed ──
  await assert.rejects(() => runFullBackfill(saved, seams(manifestPath), options), /simulated kill after commit/);
  saved = (await loadManifest(manifestPath))!;
  const bUnit = saved.numbers[0]!.conversations[1]!.units.find(u => u.stage === "analysis")!;
  assert.deepEqual([bUnit.by, bUnit.outcome], ["backfill", "done"], "the backfill's own pre-kill lease is not recorded as a peer");
  assert.equal(count("analysis", b.id), 1);

  // ── Run 4: E (re-armed dead letter) throws between release and claim → back on operator_hold, never left due ──
  await assert.rejects(() => runFullBackfill(saved, seams(manifestPath), options), /between release and claim/);
  saved = (await loadManifest(manifestPath))!;
  assert.deepEqual(await jobState(jobE._id), ["paused", OPERATOR_HOLD_REASON]);
  assert.ok(saved.holds.some(h => h.job_id === String(jobE._id)));
  await cronCannotClaim();

  // ── Run 5: resume to the end (S10 holds left) ─────────────────────────────
  const summary = await runFullBackfill(saved, seams(manifestPath), options);
  saved = (await loadManifest(manifestPath))!;
  for (const conv of [a, b, c, e]) assert.equal(count("analysis", conv.id), 1, "conversation analysed exactly once");
  assert.equal(count("analysis", d.id), 0);
  for (const number of [n1, n2, n3, n4, n7]) assert.equal(count("number_refresh", number), 1, "exactly one Number synthesis");
  assert.equal(count("number_refresh", n8), 0, "a submitted synthesis awaiting application is applied, not paid for again");
  for (const number of [n1, n2, n4, n7, n8]) {
    const row = await Numbers.findById(number).lean();
    assert.equal(row?.intelligence_schedule?.fingerprint, await fingerprintOf(number), "the scheduled synthesis updated intelligence_schedule.fingerprint");
    const synthesis = await Runs.findById(row?.running_summary?.run_id).lean();
    assert.equal(synthesis?.status, "completed");
    assert.equal(String(synthesis?.job_id), String(row?.intelligence_schedule?.job_id), "the running summary came from the scheduled job");
  }
  const byNumber = new Map(saved.numbers.map(n => [n.number_id, n]));
  // C: the legacy-layout paused run could not resume → superseded; fresh work ran; the prior state is recorded.
  const cUnit = byNumber.get(n2)!.conversations.find(x => x.conversation_id === c.id)!.units.find(u => u.stage === "analysis")!;
  assert.deepEqual([cUnit.by, cUnit.prior?.action, cUnit.prior?.status, cUnit.prior?.reason, cUnit.prior?.result_reason],
    ["backfill", "superseded", "paused", "permission_denied", "schema_exhausted"]);
  const supersededC = await Jobs.findById(jobC._id).lean();
  const supersededResult = supersededC?.result as { reason?: string; backfill_run_id?: string };
  assert.deepEqual([supersededC?.status, supersededResult?.reason, supersededResult?.backfill_run_id], ["completed", SUPERSEDED_REASON, saved.run_id]);
  assert.equal((await Runs.findById(runC).lean())?.status, "stale");
  // D: the repair owns it; never released, never listed as this run's hold.
  const dEntry = byNumber.get(n2)!.conversations.find(x => x.conversation_id === d.id)!;
  assert.deepEqual([dEntry.state, dEntry.reason, dEntry.units[0]?.by], ["blocked", "repair_hold", "repair"]);
  assert.deepEqual(await jobState(jobD._id), ["paused", OPERATOR_HOLD_REASON]);
  // E: dead letter with no run → re-armed by id (same dedupe), `by: "prior"`.
  const eUnit = byNumber.get(n3)!.conversations[0]!.units.find(u => u.stage === "analysis")!;
  assert.deepEqual([eUnit.by, eUnit.job_id, eUnit.prior?.action, eUnit.prior?.status], ["prior", String(jobE._id), "rearmed", "dead_letter"]);
  // N3 under `leave`: not blocked; synthesized through the backfill's own job; the S10 hold stays held and is listed as superseded.
  assert.equal(byNumber.get(n3)!.state, "done");
  assert.equal(byNumber.get(n3)!.expected_fingerprint_mismatch, "s10_hold_left");
  assert.deepEqual(await jobState(s10n3._id), ["paused", OPERATOR_HOLD_REASON]);
  const n3Hold = saved.foreign_holds.find(h => h.job_id === String(s10n3._id));
  assert.deepEqual([n3Hold?.action, n3Hold?.note], ["left", "superseded_by_backfill_synthesis"]);
  assert.match(byNumber.get(n3)!.synthesis[0]!.job_id, /^[a-f0-9]{24}$/);
  assert.equal(byNumber.get(n3)!.synthesis[0]!.superseded_job_id, String(s10n3._id));
  // N4 (paused failure) and N7 (pending on a legacy run) were superseded; the next generation ran.
  for (const [number, old, status] of [[n4, n4OldRun, "paused"], [n7, n7OldRun, "retry"]] as const) {
    const unit = byNumber.get(number)!.synthesis.find(u => u.stage === "number_refresh")!;
    assert.deepEqual([unit.prior?.action, unit.prior?.status], ["superseded", status]);
    assert.deepEqual([unit.by, unit.outcome], ["backfill", "done"], "N4's budget pause raced a rollover: claimed again at once, not recorded as held");
    assert.equal((await Runs.findById(old).lean())?.status, "stale");
  }
  // N8: the pending application was re-armed by id (`by: "prior"`), no new synthesis.
  const n8App = byNumber.get(n8)!.synthesis.find(u => u.stage === "application")!;
  assert.deepEqual([n8App.by, n8App.job_id, n8App.prior?.action, n8App.prior?.result_reason], ["prior", String(app8._id), "rearmed", "incomplete_coverage"]);
  assert.equal(byNumber.has(n5), false, "a suppressed Number is excluded");
  assert.deepEqual(await jobState(shadow._id), ["paused", "permission_denied"], "shadow applications are never touched");

  // Verification: every Number checked; not complete while the repair's conversation is left; N3's mismatch is expected.
  const verify = saved.phases.verify!;
  assert.equal(verify.numbers.checked, 6);
  assert.deepEqual(verify.numbers.expected_mismatch, [n3]);
  assert.deepEqual(verify.leftovers.map(l => [l.number_id, l.conversations_left]), [[n2, 1]]);
  assert.deepEqual(verify.conversations_left, { a: 1, b: 0 });
  assert.deepEqual([verify.holds.own_left, verify.holds.repair_still_held], [0, 1]);
  assert.equal(verify.complete, false);
  assert.deepEqual([summary.complete, summary.leftovers], [false, [n2]]);
  assert.equal(summary.peer_paid_units, 0);
  assert.equal(summary.stopped, undefined);
  assert.equal(saved.holds.length, 0, "no operator_hold left that this run owns");
  assert.ok(verify.owner_ledger.window.reservations === 0 && verify.owner_ledger.day_before.reservations === 0);
  await cronCannotClaim();

  // Reservations land on the personal ledger; the Owner budget is untouched.
  const reservations = await getSalesIntelligenceAiReservationModel().find({}).lean();
  assert.ok(reservations.length >= 9 && reservations.every(r => r.ledger === "personal"));
  const budget = await getSalesIntelligenceAiBudgetModel().findOne({ month }).lean();
  assert.deepEqual([budget?.reserved_cents, budget?.actual_cents], [0, 0]);
  assert.ok(verify.spend.every(s => s.ledger === "personal"));
  assert.ok(!JSON.stringify(saved).includes("+1555"), "the manifest carries no phone numbers");

  // ── Run 6: `--s10-holds drive` (the default) on a Number whose analysis and synthesis are both S10-held ──
  const n6 = await addNumber();
  const i = await addConversation(n6);
  const jobI = await analysisJob(i);
  await setJob(jobI._id, { status: "paused", reason: OPERATOR_HOLD_REASON });
  const s10n6 = await numberJob(n6, 1);
  await setJob(s10n6._id, { status: "paused", reason: OPERATOR_HOLD_REASON });
  await Numbers.collection.updateOne({ _id: asId(n6) }, { $set: { intelligence_schedule: { fingerprint: "s10", generation: 1, job_id: s10n6._id } } });
  const before = calls.length;
  const driveManifest = newManifest({ now: new Date(Date.now() - 1_000), layout: "case_file", models: { extraction: MODEL }, deployed_commit: null, local_head: null,
    options: { concurrency: 1, numbers: [n6], max_numbers: null, since: null, s10_holds: "drive", repair_manifest: null } });
  // Scoped to N6 without the repair manifest: the repair's hold on D is outside this run (and never touched: D is not in scope).
  const drive = await runFullBackfill(driveManifest, seams(drivePath), { ...options, s10Holds: "drive", repairManifest: null, numbers: [n6] });
  const driven = (await loadManifest(drivePath)) as FullBackfillManifest;
  assert.equal(calls.length - before, 2, "one analysis and one synthesis; nothing else repeated");
  const iUnit = driven.numbers[0]!.conversations[0]!.units.find(u => u.stage === "analysis")!;
  assert.deepEqual([iUnit.by, iUnit.job_id, iUnit.prior?.action], ["s10-hold", String(jobI._id), "driven"]);
  const n6Unit = driven.numbers[0]!.synthesis.find(u => u.stage === "number_refresh")!;
  assert.deepEqual([n6Unit.by, n6Unit.job_id, n6Unit.prior?.status, n6Unit.prior?.reason], ["s10-hold", String(s10n6._id), "paused", OPERATOR_HOLD_REASON]);
  assert.deepEqual(driven.foreign_holds.filter(h => h.number_id === n6).map(h => h.action), ["driven", "driven"]);
  assert.equal(driven.foreign_holds.find(h => h.job_id === String(s10n3._id))?.action, "left", "other S10 holds are listed, never released");
  assert.equal((await Jobs.findById(s10n6._id).lean())?.status, "completed");
  assert.equal((await Numbers.findById(n6).lean())?.intelligence_schedule?.fingerprint, await fingerprintOf(n6));
  assert.deepEqual([drive.complete, drive.peer_paid_units, driven.holds.length], [true, 0, 0]);
  assert.equal(repairRuns, 2, "no repair manifest: phase 1 is skipped");
  assert.deepEqual(await jobState(jobD._id), ["paused", OPERATOR_HOLD_REASON]);
});
