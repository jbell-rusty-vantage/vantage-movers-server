import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import express, { type Request } from "express";
import { logger } from "../src/logger";
import { requireCsiOwner } from "../src/services/salesIntelligence/auth";
import { computeAdminActorSignature } from "../src/services/operationsRegistry/trustedActor";
import { initializeCsiPolicy, updateCsiPolicy, defaultCsiPolicy } from "../src/services/salesIntelligence/policy";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getIntelligenceEvidenceSnapshotModel } from "../src/models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceAiBudgetModel } from "../src/models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceAiReservationModel } from "../src/models/SalesIntelligenceAiReservation";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { applyInteractionObservation } from "../src/services/numberActivity/persistInteraction";
import { inboundConnectedCallLog, syntheticDirectory, syntheticRecordingWav, SYNTHETIC_ACCOUNT_ID } from "../src/services/numberActivity/fixtures";
import { runRecordingDiscoveryJob } from "../src/services/salesIntelligence/conversations/discover";
import { runTranscriptionJob, drainTranscriptionJobs, resumeTranscriptAnalysisJobs, type TranscriptionDependencies } from "../src/services/salesIntelligence/conversations/transcribe";
import { scheduleTranscriptionJobs } from "../src/services/salesIntelligence/conversations/transcriptionScheduling";
import { initializeCsiBudgetPeriod } from "../src/services/salesIntelligence/aiBudget";
import { claimCsiJob, enqueueCsiJob, failCsiJob } from "../src/services/salesIntelligence/jobs";
import { dispatchCsiWakeup } from "../src/services/numberActivity/jobDispatch";
import { TranscriptionProviderError } from "../src/services/conversations/transcriptionProvider";

test("CSI-12 disposable replica with synthetic Blob/STT only", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 180000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi12[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  const actorRequest: Request = Object.assign(Object.create(express.request), { method: "POST", originalUrl: "/api/v1/admin/sales-intelligence/settings", headers: {},
    vantageAuth: { kind: "user", userId: "synthetic-owner", email: "owner@example.test", roles: ["owner"] } });
  const fields = { adminId: "synthetic-owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "csi12-policy", method: actorRequest.method, path: actorRequest.originalUrl };
  actorRequest.headers = { "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role,
    "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
    "x-vantage-admin-signature": computeAdminActorSignature(fields, "synthetic-owner-signature") };
  const actor = requireCsiOwner(actorRequest);
  await initializeCsiPolicy({ actor, idempotency_key: "csi12-init-policy" });
  const logs: string[] = [];
  for (const method of ["info", "warn", "error", "debug"] as const) t.mock.method(logger, method, (...args: unknown[]) => { logs.push(JSON.stringify(args)); });
  for (const method of ["log", "warn", "error"] as const) t.mock.method(console, method, (...args: unknown[]) => { logs.push(JSON.stringify(args)); });
  const Conversations = getLeadConversationModel(), Jobs = getSalesIntelligenceJobModel(), Snapshots = getIntelligenceEvidenceSnapshotModel();
  const Budget = getSalesIntelligenceAiBudgetModel(), Reservations = getSalesIntelligenceAiReservationModel();
  const audio = Buffer.from(syntheticRecordingWav()), digest = createHash("sha256").update(audio).digest("hex");
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });
  const publish = async () => ({ published: false, error_code: null });
  let serial = 0, sttCalls = 0, blobReads = 0;
  const rawText = "Card 4111-1111-1111-1111. one two three four five six seven. CVV 123. expiry 07/2029. We can move Tuesday.";
  const deps: TranscriptionDependencies = { centsPerSecond: .005, publish,
    readAudio: async () => { blobReads++; return audio; },
    transcribe: async () => { sttCalls++; return { text: rawText, actualCents: 2 }; },
  };
  const due = (id: string) => Jobs.updateOne({ _id: id }, { $set: { next_attempt_at: new Date(0) } });
  async function stored(schedule = true) {
    const sid = `csi12-${++serial}`;
    const result = await applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log",
      record: inboundConnectedCallLog(sid, { recording: { id: `recording-${sid}` }, from: { phoneNumber: `+1202555${String(1000 + serial)}` }, legs: [], duration: 90 }), proof_ref: `call_log:${sid}` },
      { now: () => new Date(), directory: syntheticDirectory(), resolveRoute: () => "aaaaaaaaaaaaaaaaaaaaaaaa" });
    const discovery = await Jobs.findOne({ stage: "recording_discovery", input_refs: result.interaction_id }).orFail();
    assert.equal((await runRecordingDiscoveryJob(String(discovery._id), { publish })).status, "completed");
    const conversation = await Conversations.findOne({ call_interaction_id: result.interaction_id }).orFail();
    await Conversations.updateOne({ _id: conversation._id }, { $set: { state: "media_stored", pending_stage: "transcription", media_digest_sha256: digest,
      media: { blob_pathname: `conversations/${SYNTHETIC_ACCOUNT_ID}/recording-${sid}/${digest}.wav`, bytes: audio.length, stored_at: new Date(), content_type: "audio/wav" } } });
    if (schedule) await scheduleTranscriptionJobs(5, publish);
    const job = await Jobs.findOne({ stage: "transcription", input_refs: String(conversation._id) });
    return { conversationId: String(conversation._id), interactionId: result.interaction_id, numberId: String(conversation.contact_number_id), jobId: job ? String(job._id) : "" };
  }
  try {
    await t.test("flag off skips hook scheduling, cron unit and queue worker before I/O", async () => {
      process.env.SALES_INTELLIGENCE_STT_ENABLED = "false";
      assert.deepEqual(await scheduleTranscriptionJobs(), []);
      assert.equal((await runTranscriptionJob(undefined, deps)).status, "disabled");
      assert.equal((await drainTranscriptionJobs(deps)).status, "disabled");
      assert.equal(sttCalls, 0); process.env.SALES_INTELLIGENCE_STT_ENABLED = "true";
    });
    await t.test("budget exhaustion keeps pending stage and zero attempts; cap resume completes redacted immutable evidence", async () => {
      const a = await stored();
      await updateCsiPolicy({ actor, idempotency_key: "zero-cap", expected_revision: 1, policy: { ...defaultCsiPolicy(), version: "csi12-zero-cap", monthly_ceiling_cents: 0 } });
      assert.equal((await runTranscriptionJob(a.jobId, deps)).status, "budget_exhausted");
      const paused = await Jobs.findById(a.jobId).orFail();
      assert.equal(paused.status, "paused"); assert.equal(paused.attempts, 0); assert.equal(sttCalls, 0); assert.equal(blobReads, 0);
      assert.equal((await Conversations.findById(a.conversationId))?.pending_stage, "transcription");
      await updateCsiPolicy({ actor, idempotency_key: "restore-cap", expected_revision: 2, policy: { ...defaultCsiPolicy(), version: "csi12-restored-cap" } });
      assert.equal((await Jobs.findById(a.jobId))?.status, "pending");
      assert.equal((await runTranscriptionJob(a.jobId, deps)).status, "completed");
      const current = await Conversations.findById(a.conversationId).orFail();
      assert.equal(current.state, "transcribed"); assert.equal(current.cost_cents?.stt, 2); assert.equal(current.transcript?.redactions, 4);
      assert.ok(current.transcript_segments.every(s => s.speaker === "unknown" && s.timing_source === "unavailable" && s.start_ms === null && s.end_ms === null));
      const snapshot = await Snapshots.findOne({ conversation_id: current._id }).orFail();
      assert.equal(snapshot.transcript_version, current.latest_transcript_version);
      assert.equal(await Jobs.countDocuments({ stage: "analysis", input_refs: String(snapshot._id) }), 1);
      const reservation = await Reservations.findOne({ job_id: a.jobId }).orFail();
      assert.equal(reservation.status, "reconciled"); assert.equal(reservation.actual_cents, 2);
      assert.equal((await Budget.findOne({ month }))?.reserved_cents, 0);
      const before = JSON.stringify(snapshot.toObject());
      assert.equal((await runTranscriptionJob(a.jobId, deps)).status, "not_claimable");
      assert.equal(sttCalls, 1);
      await assert.rejects(Snapshots.updateOne({ _id: snapshot._id }, { $set: { response: {} } }));
      assert.equal(JSON.stringify((await Snapshots.findById(snapshot._id))?.toObject()), before);
      // Even a distinct accidentally duplicated intent sees the immutable version before provider work.
      const duplicate = await withTransaction(session => enqueueCsiJob({ stage: "transcription", subject_key: `conversation:${a.conversationId}`, dedupe_key: `synthetic-duplicate:${digest}`, input_revision: 1, input_refs: [a.conversationId] }, session));
      await runTranscriptionJob(String(duplicate._id), deps); assert.equal(sttCalls, 1);
      const analysis = await Jobs.findOne({ stage: "analysis", input_refs: a.conversationId }).orFail();
      const claimed = await claimCsiJob("analysis-test", String(analysis._id), 300000, "analysis");
      await failCsiJob({ job_id: String(analysis._id), owner: "analysis-test", epoch: claimed!.lease_epoch }, "transient");
      const dispatched = await dispatchCsiWakeup({ job_id: String(analysis._id) });
      assert.equal(dispatched.status, "dispatched"); // CSI-13 is registered; disabled analysis still never repeats STT.
      assert.equal(dispatched.status === "dispatched" && (dispatched.outcome as { status: string }).status, "disabled");
      assert.equal(sttCalls, 1);
    });
    await t.test("eligibility flip during STT preserves media/transcript and suppresses analysis", async () => {
      const a = await stored();
      const result = await runTranscriptionJob(a.jobId, { ...deps, transcribe: async () => {
        await getContactNumberModel().updateOne({ _id: a.numberId }, { $set: { classification: "non_customer" } });
        return { text: "A synthetic conversation.", actualCents: 1 };
      } });
      assert.equal(result.status, "completed");
      assert.equal(await Jobs.countDocuments({ stage: "analysis", input_refs: a.conversationId }), 0);
      const conversation = await Conversations.findById(a.conversationId).orFail();
      assert.equal(conversation.analysis_eligibility?.status, "excluded"); assert.equal(conversation.media_digest_sha256, digest);
      assert.ok(conversation.latest_transcript_version);
      await getContactNumberModel().updateOne({ _id: a.numberId }, { $set: { classification: "unknown" } });
    });
    await t.test("undetermined eligibility waits without attempts then resumes with current inputs", async () => {
      const a = await stored();
      await getCallInteractionModel().updateOne({ _id: a.interactionId }, { $set: { inbound_route_id: null } });
      assert.equal((await runTranscriptionJob(a.jobId, deps)).status, "eligibility_pending");
      assert.equal((await Jobs.findById(a.jobId))?.attempts, 0);
      await getCallInteractionModel().updateOne({ _id: a.interactionId }, { $set: { inbound_route_id: "aaaaaaaaaaaaaaaaaaaaaaaa" } });
      await due(a.jobId); assert.equal((await runTranscriptionJob(a.jobId, deps)).status, "completed");
    });
    await t.test("permission pause releases unused reservation and does not consume attempts", async () => {
      const a = await stored();
      await runTranscriptionJob(a.jobId, { ...deps, transcribe: async () => { throw new TranscriptionProviderError("permission_denied"); } });
      assert.equal((await Jobs.findById(a.jobId))?.attempts, 0);
      assert.equal((await Reservations.findOne({ job_id: a.jobId }))?.status, "released");
    });
    await t.test("stored-media eligibility recheck recovers missing inputs and never starves later eligible rows", async () => {
      const waiting: Awaited<ReturnType<typeof stored>>[] = [];
      for (let index = 0; index < 6; index++) {
        const a = await stored(false); waiting.push(a);
        await getCallInteractionModel().updateOne({ _id: a.interactionId }, { $set: { inbound_route_id: null } });
        await Conversations.updateOne({ _id: a.conversationId }, { $set: { "analysis_eligibility.eligible": null, "analysis_eligibility.status": "undetermined", next_attempt_at: new Date(0) } });
      }
      const eligible = await stored(false);
      assert.deepEqual(await scheduleTranscriptionJobs(5, publish), []);
      assert.equal((await scheduleTranscriptionJobs(5, publish)).length, 1);
      assert.ok(await Jobs.exists({ stage: "transcription", input_refs: eligible.conversationId }));
      const a = waiting[0]!;
      await getCallInteractionModel().updateOne({ _id: a.interactionId }, { $set: { inbound_route_id: "aaaaaaaaaaaaaaaaaaaaaaaa" } });
      await Conversations.updateOne({ _id: a.conversationId }, { $set: { next_attempt_at: new Date(0) } });
      assert.equal((await scheduleTranscriptionJobs(5, publish)).length, 1);
      assert.equal((await Conversations.findById(a.conversationId))?.analysis_eligibility?.status, "eligible");
    });
    await t.test("pre-STT exclusion completes without spend; only that skip reopens preserving prior attempts", async () => {
      for (const attempts of [0, 7]) {
        const a = await stored(); const before = { stt: sttCalls, blob: blobReads };
        await Jobs.updateOne({ _id: a.jobId }, { $set: { attempts } });
        await getContactNumberModel().updateOne({ _id: a.numberId }, { $set: { classification: "non_customer" } });
        assert.equal((await runTranscriptionJob(a.jobId, deps)).status, "excluded");
        const skipped = await Jobs.findById(a.jobId).orFail();
        assert.equal(skipped.status, "completed"); assert.equal(skipped.result?.reason, "excluded"); assert.equal(skipped.attempts, attempts);
        assert.deepEqual({ stt: sttCalls, blob: blobReads }, before);
        assert.equal(await Reservations.countDocuments({ job_id: a.jobId }), 0);
        assert.equal((await Conversations.findById(a.conversationId))?.media_digest_sha256, digest);
        await getContactNumberModel().updateOne({ _id: a.numberId }, { $set: { classification: "unknown" } });
        await Conversations.updateOne({ _id: a.conversationId }, { $set: { next_attempt_at: new Date(0) } });
        assert.deepEqual(await scheduleTranscriptionJobs(5, publish), [a.jobId]);
        assert.equal((await Jobs.findById(a.jobId))?.attempts, attempts);
        assert.equal((await runTranscriptionJob(a.jobId, deps)).status, "completed");
        assert.equal(await Snapshots.countDocuments({ conversation_id: a.conversationId }), 1);
      }
      const failed = await stored();
      await Jobs.updateOne({ _id: failed.jobId }, { $set: { status: "dead_letter", attempts: 8 } });
      await Conversations.updateOne({ _id: failed.conversationId }, { $set: { transcription_job_digest: null, next_attempt_at: new Date(0) } });
      assert.deepEqual(await scheduleTranscriptionJobs(5, publish), []);
      assert.equal((await Jobs.findById(failed.jobId))?.status, "dead_letter");
    });
    await t.test("undetermined at completion durably waits for analysis without repeating STT", async () => {
      const a = await stored(); let calls = 0;
      await runTranscriptionJob(a.jobId, { ...deps, transcribe: async () => {
        calls++;
        await getCallInteractionModel().updateOne({ _id: a.interactionId }, { $set: { inbound_route_id: null } });
        return { text: "Synthetic uncertain context.", actualCents: 1 };
      } });
      const analysis = await Jobs.findOne({ stage: "analysis", input_refs: a.conversationId }).orFail();
      assert.equal(analysis.status, "paused"); assert.equal(analysis.reason, "eligibility_pending");
      assert.equal((await Conversations.findById(a.conversationId))?.pending_stage, "analysis");
      assert.equal(await resumeTranscriptAnalysisJobs(), 0);
      await getCallInteractionModel().updateOne({ _id: a.interactionId }, { $set: { inbound_route_id: "aaaaaaaaaaaaaaaaaaaaaaaa" } });
      assert.equal(await resumeTranscriptAnalysisJobs(), 1);
      assert.equal((await Jobs.findById(analysis._id))?.status, "pending");
      await runTranscriptionJob(a.jobId, deps); assert.equal(calls, 1);
    });
    await t.test("empty STT is terminal after one paid call and reconciles actual cost", async () => {
      const a = await stored(); let calls = 0;
      const empty = { ...deps, transcribe: async () => { calls++; return { text: "  ", segments: [], actualCents: 2 }; } };
      assert.equal((await runTranscriptionJob(a.jobId, empty)).status, "empty_transcription");
      await due(a.jobId); await runTranscriptionJob(a.jobId, empty); await scheduleTranscriptionJobs(5, publish);
      assert.equal(calls, 1); assert.equal((await Jobs.findById(a.jobId))?.status, "completed");
      const current = await Conversations.findById(a.conversationId).orFail();
      assert.equal(current.pending_stage, null); assert.equal(current.availability_reason, "empty_transcription"); assert.equal(current.cost_cents?.stt, 2);
      assert.equal((await Reservations.findOne({ job_id: a.jobId }))?.status, "reconciled");
      assert.equal(await Snapshots.countDocuments({ conversation_id: a.conversationId }), 0);
      assert.equal(await Jobs.countDocuments({ stage: "analysis", input_refs: a.conversationId }), 0);
    });
    await t.test("duplicate empty completion cannot overwrite a concurrent successful transcript", async () => {
      const a = await stored();
      const duplicate = await withTransaction(session => enqueueCsiJob({ stage: "transcription", subject_key: `conversation:${a.conversationId}`,
        dedupe_key: `synthetic-empty-race:${digest}`, input_revision: 1, input_refs: [a.conversationId] }, session));
      let before = "";
      await runTranscriptionJob(a.jobId, { ...deps, transcribe: async () => {
        assert.equal((await runTranscriptionJob(String(duplicate._id), deps)).status, "completed");
        before = JSON.stringify((await Conversations.findById(a.conversationId))?.toObject());
        return { text: "", actualCents: 1 };
      } });
      assert.equal(JSON.stringify((await Conversations.findById(a.conversationId))?.toObject()), before);
      assert.equal(await Snapshots.countDocuments({ conversation_id: a.conversationId }), 1);
      assert.equal((await Reservations.findOne({ job_id: a.jobId }))?.status, "reconciled");
    });
    await t.test("analysis eligibility exclusion closes and restores only its current immutable version", async () => {
      const a = await stored(); let calls = 0;
      await runTranscriptionJob(a.jobId, { ...deps, transcribe: async () => {
        calls++; await getCallInteractionModel().updateOne({ _id: a.interactionId }, { $set: { inbound_route_id: null } });
        return { text: "Synthetic waiting transcript.", actualCents: 1 };
      } });
      const analysis = await Jobs.findOne({ stage: "analysis", input_refs: a.conversationId }).orFail();
      await getContactNumberModel().updateOne({ _id: a.numberId }, { $set: { classification: "non_customer" } });
      await resumeTranscriptAnalysisJobs();
      assert.equal((await Jobs.findById(analysis._id))?.result?.reason, "eligibility_excluded");
      assert.equal((await Conversations.findById(a.conversationId))?.pending_stage, null);
      await getContactNumberModel().updateOne({ _id: a.numberId }, { $set: { classification: "unknown" } });
      await getCallInteractionModel().updateOne({ _id: a.interactionId }, { $set: { inbound_route_id: "aaaaaaaaaaaaaaaaaaaaaaaa" } });
      await resumeTranscriptAnalysisJobs();
      assert.equal((await Jobs.findById(analysis._id))?.status, "pending");
      assert.equal((await Conversations.findById(a.conversationId))?.pending_stage, "analysis"); assert.equal(calls, 1);
      // Simulate a newer current version while the old version still has an eligibility wait.
      await Jobs.updateOne({ _id: analysis._id }, { $set: { status: "paused", reason: "eligibility_pending" } });
      await Conversations.updateOne({ _id: a.conversationId }, { $set: { latest_transcript_version: "synthetic-newer-version", pending_stage: "transcription" } });
      const before = JSON.stringify((await Conversations.findById(a.conversationId))?.toObject());
      await resumeTranscriptAnalysisJobs();
      assert.equal((await Jobs.findById(analysis._id))?.result?.reason, "stale_transcript");
      assert.equal(JSON.stringify((await Conversations.findById(a.conversationId))?.toObject()), before); assert.equal(calls, 1);
    });
    await t.test("eight transient failures dead-letter with safe errors and retain ambiguous spend", async () => {
      const a = await stored(); let calls = 0;
      for (let index = 0; index < 8; index++) {
        await due(a.jobId);
        const outcome = await runTranscriptionJob(a.jobId, { ...deps, transcribe: async () => { calls++; throw new Error(rawText); } });
        assert.equal(outcome.status, index === 7 ? "dead_letter" : "retry");
      }
      assert.equal(calls, 8); assert.equal((await Jobs.findById(a.jobId))?.attempts, 8);
      assert.equal((await Conversations.findById(a.conversationId))?.state, "failed");
      assert.equal(await Snapshots.countDocuments({ conversation_id: a.conversationId }), 0);
      assert.equal(await Reservations.countDocuments({ job_id: a.jobId, status: "reserved" }), 8);
      assert.equal((await runTranscriptionJob(a.jobId, deps)).status, "not_claimable");
    });
    await t.test("killed eighth claim is projected without a ninth STT call", async () => {
      const a = await stored();
      await Jobs.updateOne({ _id: a.jobId }, { $set: { attempts: 8, status: "leased", leased_until: new Date(0), lease_epoch: 8, lease_owner: "killed" } });
      assert.equal((await runTranscriptionJob(a.jobId, deps)).status, "dead_letter");
      assert.equal((await Conversations.findById(a.conversationId))?.state, "failed");
    });
    await t.test("missing actual cost preserves success and reservation without repeat STT", async () => {
      const a = await stored(); let calls = 0;
      await runTranscriptionJob(a.jobId, { ...deps, transcribe: async () => { calls++; return { text: "Synthetic result.", actualCents: null }; } });
      const current = await Conversations.findById(a.conversationId).orFail();
      assert.equal(current.cost_cents?.stt, null); assert.equal(current.availability_reason, "stt_cost_unreported");
      assert.equal((await Reservations.findOne({ job_id: a.jobId }))?.status, "reserved");
      await runTranscriptionJob(a.jobId, deps); assert.equal(calls, 1);
    });
    await t.test("concurrent claims make one bounded STT call; expired worker cannot publish", async () => {
      const a = await stored(); let calls = 0;
      await Promise.all([1, 2].map(() => runTranscriptionJob(a.jobId, { ...deps, transcribe: async () => { calls++; return { text: "Concurrent fixture.", actualCents: 1 }; } })));
      assert.equal(calls, 1); assert.equal(await Snapshots.countDocuments({ conversation_id: a.conversationId }), 1);
      const b = await stored();
      const outcome = await runTranscriptionJob(b.jobId, { ...deps, transcribe: async () => {
        await Jobs.updateOne({ _id: b.jobId }, { $set: { leased_until: new Date(0) }, $inc: { lease_epoch: 1 } });
        return { text: "Lease lost.", actualCents: 1 };
      } });
      assert.equal(outcome.status, "lease_lost"); assert.equal(await Snapshots.countDocuments({ conversation_id: b.conversationId }), 0);
      assert.equal((await Reservations.findOne({ job_id: b.jobId }))?.status, "reconciled");
      await Jobs.updateOne({ _id: b.jobId }, { $set: { status: "dead_letter" } });
    });
    await t.test("scheduler is bounded, closes hook gap, no starvation, atomic under concurrent scans", async () => {
      for (let i = 0; i < 7; i++) await stored(false);
      const first = await scheduleTranscriptionJobs(100, publish); assert.equal(first.length, 5);
      const second = await scheduleTranscriptionJobs(100, publish); assert.equal(second.length, 2);
      assert.deepEqual(await scheduleTranscriptionJobs(100, publish), []);
      await stored(false);
      const concurrent = await Promise.all([scheduleTranscriptionJobs(5, publish), scheduleTranscriptionJobs(5, publish)]);
      assert.equal(concurrent.flat().length, 1);
      const before = sttCalls; await drainTranscriptionJobs(deps); assert.equal(sttCalls - before, 1);
    });
    await t.test("changed media creates a new immutable version while model changes and seed media do not", async () => {
      const a = await stored();
      await runTranscriptionJob(a.jobId, deps);
      const original = await Snapshots.findOne({ conversation_id: a.conversationId }).orFail();
      const originalJson = JSON.stringify(original.toObject());
      process.env.SALES_INTELLIGENCE_STT_MODEL = "synthetic-new-model";
      assert.deepEqual(await scheduleTranscriptionJobs(5, publish), []);
      const changedAudio = Buffer.concat([audio, Buffer.from([0])]);
      const changedDigest = createHash("sha256").update(changedAudio).digest("hex");
      await Conversations.updateOne({ _id: a.conversationId }, { $set: { state: "media_stored", pending_stage: "transcription", media_digest_sha256: changedDigest,
        "media.blob_pathname": `conversations/account/recording/${changedDigest}.wav`, "media.bytes": changedAudio.length } });
      const scheduled = await scheduleTranscriptionJobs(5, publish); assert.equal(scheduled.length, 1);
      assert.equal((await runTranscriptionJob(scheduled[0], { ...deps, readAudio: async () => changedAudio })).status, "completed");
      assert.equal(await Snapshots.countDocuments({ conversation_id: a.conversationId }), 2);
      assert.equal(JSON.stringify((await Snapshots.findById(original._id))?.toObject()), originalJson);
      delete process.env.SALES_INTELLIGENCE_STT_MODEL;
      const seed = await Conversations.create({ provider: "ringcentral", provider_account_id: "seed-account", provider_recording_id: "seed-recording",
        direction: "Inbound", started_at: new Date(), match_method: "number_only", match_confidence: "low", state: "complete",
        media: { blob_pathname: "conversations/seed.mp3", stored_at: new Date() }, transcript: { text: "Existing redacted seed.", model: "seed", chars: 23, redactions: 0, created_at: new Date() } });
      await scheduleTranscriptionJobs(5, publish);
      assert.equal(await Jobs.countDocuments({ stage: "transcription", input_refs: String(seed._id) }), 0);
      assert.equal((await Conversations.findById(seed._id))?.media?.blob_pathname, "conversations/seed.mp3");
    });
    await t.test("raw synthetic secrets absent from every Mongo document and qualification cursor untouched", async () => {
      for (const collection of await db.listCollections().toArray()) {
        const serialized = JSON.stringify(await db.collection(collection.name).find().toArray());
        assert.ok(!serialized.includes("4111-1111") && !serialized.includes("one two three four five six seven") && !serialized.includes("CVV 123"), `raw content leaked into ${collection.name}`);
      }
      assert.equal(await db.collection("ringcentral_call_log_sync_state_test").countDocuments(), 0);
      assert.ok(!logs.join("\n").includes("4111-1111") && !logs.join("\n").includes("one two three four five six seven"));
    });
  } finally { t.mock.restoreAll(); }
});
