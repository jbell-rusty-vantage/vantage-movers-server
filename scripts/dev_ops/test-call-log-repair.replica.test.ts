import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../../src/models/CallInteraction";
import { getContactNumberModel } from "../../src/models/ContactNumber";
import { getLeadConversationModel } from "../../src/models/LeadConversation";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAiReservationModel } from "../../src/models/SalesIntelligenceAiReservation";
import { getSalesIntelligenceAiBudgetModel } from "../../src/models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/salesIntelligence/infrastructure";
import { initializeCsiBudgetPeriod } from "../../src/services/salesIntelligence/aiBudget";
import { claimCsiJob, completeCsiJob, enqueueCsiJob } from "../../src/services/salesIntelligence/jobs";
import { withTransaction } from "../../src/db";
import { applyInteractionObservation } from "../../src/services/numberActivity/persistInteraction";
import { RingCentralApiError } from "../../src/services/ringcentral/client";
import { RecordingReadError } from "../../src/services/ringcentral/recordings";
import {
  at, callLogRecord, SYNTHETIC_ACCOUNT_ID, SYNTHETIC_COMPANY_DID, SYNTHETIC_CUSTOMER, SYNTHETIC_CUSTOMER_B, SYNTHETIC_QUEUE_EXTENSION,
  SYNTHETIC_SALES_DID, SYNTHETIC_USER_EXTENSION, syntheticDirectory, syntheticRecordingWav,
} from "../../src/services/numberActivity/fixtures";
import {
  loadManifest, manifestSaver, newManifest, OPERATOR_HOLD_REASON, runCallLogRepair, THROTTLE_WAIT_MS, type RepairManifest, type RepairSeams,
} from "./lib/call-log-repair";
import { createStageRunners } from "./lib/call-log-repair-stages";

/**
 * CC-07 replica proof on the csi01 loopback replica: synthetic Call Log pages with a MISSING call,
 * a STALE Internal mid-call snapshot and an unchanged call; dry run writes nothing; the write run
 * applies with the live source, drives discovery → media → transcription (real workers, faked
 * provider/STT) → analysis (faked model step, claimed by id) in process on the personal ledger,
 * holds a not-yet-due unit away from every production consumer, and a second pass is a no-op.
 */
test("CC-07 Call Log repair: classify, apply live, in-process downstream on the personal ledger, holds, resume", {
  skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 600_000,
}, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.equal(getMongoDatabaseName(), "testvantagemovers_ccrepair");
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.equal(process.env.SALES_INTELLIGENCE_PERSONAL_LEDGER, "true");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  await db.dropDatabase();
  const outputs = ["dry", "apply", "second"].map(name => `scripts/dev_ops/output/cc-repair-proof-${name}.json`);
  t.after(async () => { for (const path of outputs) await rm(path, { force: true }); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the CC-07 replica proof"); });
  const now = new Date(), month = now.toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });

  const directory = syntheticDirectory();
  const routeId = new mongoose.Types.ObjectId().toHexString();
  const resolveRoute = () => routeId;
  const Interactions = getCallInteractionModel(), Jobs = getSalesIntelligenceJobModel(), Conversations = getLeadConversationModel();

  // ── Stored state before the repair ────────────────────────────────────
  // (a) A queue call stored from its mid-call snapshot: company ring-out legs only → Internal, no number, no discovery.
  const snapshot = callLogRecord({ id: "cl-stale", telephonySessionId: "s-stale", direction: "Inbound", result: "Stopped",
    startTime: at(0), duration: 0, lastModifiedTime: at(40),
    from: { phoneNumber: SYNTHETIC_COMPANY_DID, name: "Main" }, to: { phoneNumber: SYNTHETIC_SALES_DID, name: "Sales Line" },
    legs: [{ startTime: at(0).toISOString(), duration: 0, direction: "Outbound", action: "Call Queue", result: "Stopped", legType: "PstnToSip",
      from: { phoneNumber: SYNTHETIC_SALES_DID }, to: { extensionId: SYNTHETIC_USER_EXTENSION.id }, extension: { id: SYNTHETIC_QUEUE_EXTENSION.id } }] });
  // (b) A call already stored in its final version.
  const settled = callLogRecord({ id: "cl-ok", telephonySessionId: "s-ok", direction: "Inbound", result: "Missed", startTime: at(3600), duration: 20,
    from: { phoneNumber: SYNTHETIC_CUSTOMER_B }, to: { phoneNumber: SYNTHETIC_SALES_DID } });
  for (const [record, when] of [[snapshot, 60], [settled, 3700]] as const)
    await applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", record, proof_ref: `call_log:${record.id}`, source: "call_log_reconcile" },
      { now: () => at(when), directory, resolveRoute });
  const staleRow = await Interactions.findOne({ telephony_session_id: "s-stale" }).lean();
  assert.equal(staleRow?.direction, "Internal");
  assert.equal(staleRow?.contact_number_id, null);

  // ── What the provider returns now ─────────────────────────────────────
  const connectedLegs = (session: string, customer: string, seconds: number) => [
    { startTime: at(0).toISOString(), duration: 0, direction: "Outbound", action: "Call Queue", result: "Stopped", legType: "PstnToSip",
      from: { phoneNumber: SYNTHETIC_SALES_DID }, to: { extensionId: SYNTHETIC_USER_EXTENSION.id }, extension: { id: SYNTHETIC_QUEUE_EXTENSION.id } },
    { startTime: at(5).toISOString(), duration: seconds, direction: "Inbound", action: "Accept Call", result: "Accepted", legType: "Accept",
      from: { phoneNumber: customer }, to: { phoneNumber: SYNTHETIC_SALES_DID, extensionId: SYNTHETIC_USER_EXTENSION.id },
      extension: { id: SYNTHETIC_USER_EXTENSION.id }, recording: { id: `rec-${session}`, type: "Automatic" } },
  ];
  const staleFinal = callLogRecord({ id: "cl-stale", telephonySessionId: "s-stale", direction: "Inbound", result: "Call connected",
    startTime: at(0), duration: 1500, lastModifiedTime: at(1560), from: { phoneNumber: SYNTHETIC_CUSTOMER, name: "Synthetic Customer" },
    to: { phoneNumber: SYNTHETIC_SALES_DID, name: "Sales Line" }, recording: { id: "rec-s-stale" }, legs: connectedLegs("s-stale", SYNTHETIC_CUSTOMER, 1495) });
  const missing = callLogRecord({ id: "cl-missing", telephonySessionId: "s-missing", direction: "Inbound", result: "Call connected",
    startTime: at(7200), duration: 1200, from: { phoneNumber: "+15550100202" }, to: { phoneNumber: SYNTHETIC_SALES_DID },
    recording: { id: "rec-s-missing" }, legs: connectedLegs("s-missing", "+15550100202", 1195) });
  // A second MISSING call whose recording RingCentral does not serve yet (404): its media unit is not due.
  const pending = callLogRecord({ id: "cl-pending", telephonySessionId: "s-pending", direction: "Inbound", result: "Call connected",
    startTime: at(9000), duration: 900, from: { phoneNumber: "+15550100203" }, to: { phoneNumber: SYNTHETIC_SALES_DID },
    recording: { id: "rec-s-pending" }, legs: connectedLegs("s-pending", "+15550100203", 895) });
  const provider = [settled, missing, staleFinal, pending];

  const requests: Array<{ page: number }> = [], sleeps: number[] = [];
  let throttleOnce = true;
  const fetchPage: RepairSeams["fetchPage"] = async input => {
    requests.push({ page: input.page });
    assert.equal(input.perPage, 250);
    if (throttleOnce) { throttleOnce = false; throw new RingCentralApiError("throttled", 429, "Too Many Requests", "/call-log", "GET", null); }
    return input.from <= at(0) && input.to > at(9000) ? provider.map(r => JSON.parse(JSON.stringify(r))) : [];
  };
  const window = { from: new Date("2026-09-17T00:00:00Z"), to: new Date("2026-09-18T12:00:00Z") };
  const logs: Array<{ event: string } & Record<string, unknown>> = [];
  const base = (path: string): RepairSeams => ({ fetchPage, directory: async () => directory, resolveRoute, configuredAccountId: SYNTHETIC_ACCOUNT_ID,
    sleep: async ms => { sleeps.push(ms); }, save: manifestSaver(path), log: async (event, fields = {}) => { logs.push({ event, ...fields }); if (process.env.CC_DEBUG) console.log(new Date().toISOString(), event, JSON.stringify(fields).slice(0, 160)); } });

  // ── Dry run: classification only, nothing written ─────────────────────
  const jobsBefore = await Jobs.countDocuments({});
  const dry = newManifest({ mode: "dry_run", ...window, now: new Date(), credential: null, models: {} });
  assert.equal(dry.days.length, 2, "24 h windows; the last one ends at --to");
  const drySummary = await runCallLogRepair(dry, base(outputs[0]!));
  assert.deepEqual(drySummary.days[0]!.counts, { MISSING: 2, STALE: 1, unchanged: 1 });
  assert.deepEqual(drySummary.days[1]!.counts, { MISSING: 0, STALE: 0, unchanged: 0 });
  assert.equal(await Interactions.countDocuments({}), 2);
  assert.equal(await Jobs.countDocuments({}), jobsBefore);
  assert.deepEqual(sleeps.slice(0, 1), [THROTTLE_WAIT_MS], "429 waits the documented ten minutes and retries the same page");
  assert.deepEqual(requests.map(r => r.page), [1, 1, 1]);
  assert.ok(sleeps.includes(6_000), "requests are paced about 6 s apart");
  assert.equal((await loadManifest(outputs[0]!))?.days[0]?.state, "classified");
  const staleClass = logs.find(l => l.event === "classified" && l.record_id === "cl-stale");
  assert.deepEqual(staleClass?.reasons, ["provider_newer_than_stored", "result_differs", "duration_differs", "recording_missing_in_store"]);
  assert.ok(!JSON.stringify(logs).includes(SYNTHETIC_CUSTOMER), "the JSONL log carries no phone numbers");

  // ── Write run: live source, in-process downstream ─────────────────────
  const media = {
    provider: {
      metadata: async (_account: string, recordingId: string) => {
        if (recordingId === "rec-s-pending") throw new RecordingReadError(404);
        return { contentType: "audio/wav", duration: 1 };
      },
      content: async () => new Response(Buffer.from(syntheticRecordingWav()), { headers: { "content-type": "audio/wav" } }),
    },
    upload: async (input: { pathname: string }) => ({ pathname: input.pathname }),
  };
  const sttCalls: string[] = [], analysisCalls: string[] = [];
  const stages = createStageRunners({
    runId: "proof", media,
    transcription: { readAudio: async () => syntheticRecordingWav(), centsPerSecond: 0.01,
      transcribe: async input => { sttCalls.push(input.model); return { text: "Synthetic conversation about a move in October.", actualCents: 7 }; } },
    overrides: {
      // The model step is faked: claim the unit by id exactly like the historical analysis claim, and complete it.
      analysis: async (jobId, stage) => {
        analysisCalls.push(`${stage}:${jobId}`);
        const job = await claimCsiJob("csi-repair-analysis:proof", jobId, 60_000, stage, undefined, { historical: true });
        if (!job) return { status: "not_claimable" };
        await completeCsiJob({ job_id: jobId, owner: "csi-repair-analysis:proof", epoch: job.lease_epoch }, async () => undefined, { result: { faked: true } });
        if (stage === "analysis") {
          // What application does after a conversation run: schedule the number synthesis 15 s ahead.
          const conversation = await Conversations.findById(job.input_refs[0]).select("contact_number_id").lean();
          const numberId = String(conversation!.contact_number_id);
          const refresh = await withTransaction(session => enqueueCsiJob({ stage: "number_refresh", subject_key: `number:${numberId}`,
            dedupe_key: `csi:number-analysis:${numberId}:1`, input_revision: 1, input_refs: [numberId], priority: 0 }, session, new Date(Date.now() + 15_000)));
          await getContactNumberModel().collection.updateOne({ _id: new mongoose.Types.ObjectId(numberId) },
            { $set: { intelligence_schedule: { fingerprint: "synthetic", generation: 1, job_id: refresh._id } } });
          assert.equal(await claimCsiJob("csi-analysis:cron", undefined, 60_000, "number_refresh"), null, "not due: no consumer can claim it yet");
        }
        return { status: "submitted" };
      },
    },
  });
  const apply = newManifest({ mode: "apply", ...window, now: new Date(Date.now() - 1000), credential: "PERSONAL_AI_GATEWAY_API_KEY", models: {} });
  const summary = await runCallLogRepair(apply, { ...base(outputs[1]!), stages, maxWaitMs: 0 });
  assert.deepEqual(summary.days[0]!.counts, { MISSING: 2, STALE: 1, unchanged: 1 });
  assert.deepEqual(summary.days[0]!.applied, { created: 2, updated: 1, noop: 1, failed: 0, changed_without_diff: 0 });

  // The STALE Internal snapshot became the external conversation it was.
  const repaired = await Interactions.findOne({ telephony_session_id: "s-stale" }).lean();
  assert.equal(repaired?.direction, "Inbound");
  assert.equal(repaired?.provider_result, "Call connected");
  assert.equal(repaired?.duration_seconds, 1500);
  assert.ok(repaired?.contact_number_id, "a Contact Number now exists");
  assert.equal(String((await getContactNumberModel().findById(repaired!.contact_number_id).lean())?.e164), SYNTHETIC_CUSTOMER);
  const created = await Interactions.findOne({ telephony_session_id: "s-missing" }).lean();
  assert.deepEqual(created?.sources, ["call_log_reconcile"]);
  const audit = await getSalesIntelligenceAuditEventModel().findOne({ subject_key: `interaction:${repaired!._id}`, event_kind: "interaction.updated" }).lean();
  assert.match(JSON.stringify(audit), /call_log_repair:cl-stale/);
  assert.match(JSON.stringify(audit), new RegExp(apply.run_id), "the repair run id is the audit request id");

  // Live downstream scheduling applied (not the backfill source's attachment-only path).
  for (const id of [repaired!._id, created!._id]) {
    assert.ok(await Jobs.exists({ stage: "outreach_ensure", input_refs: String(id) }), "outreach_ensure left to its free cron");
    const discovery = await Jobs.findOne({ stage: "recording_discovery", input_refs: String(id) }).lean();
    assert.equal(discovery?.status, "completed");
    const conversation = await Conversations.findOne({ call_interaction_id: id }).lean();
    assert.equal(conversation?.state, "transcribed");
    const stt = await Jobs.findOne({ stage: "transcription", subject_key: `conversation:${conversation!._id}` }).lean();
    assert.equal(stt?.status, "completed");
    const analysis = await Jobs.findOne({ stage: "analysis", subject_key: `conversation:${conversation!._id}` }).lean();
    assert.equal(analysis?.status, "completed");
    assert.ok(analysisCalls.includes(`analysis:${analysis!._id}`));
  }
  assert.equal(sttCalls.length, 2);

  // Transcription spend is on the personal ledger: recorded, never reserved against or added to the Owner ceiling.
  const reservations = await getSalesIntelligenceAiReservationModel().find({ stage: "transcription" }).lean();
  assert.equal(reservations.length, 2);
  assert.ok(reservations.every(r => r.ledger === "personal" && r.status === "reconciled" && r.actual_cents === 7));
  const budget = await getSalesIntelligenceAiBudgetModel().findOne({ month }).lean();
  assert.equal(budget?.actual_cents, 0);
  assert.equal(budget?.reserved_cents, 0);

  // Every interaction's units ran in this process; none by a production consumer.
  const saved = (await loadManifest(outputs[1]!)) as RepairManifest;
  assert.equal(summary.peer_paid_units, 0);
  const byId = new Map(saved.interactions.map(e => [e.record_id, e]));
  for (const record of ["cl-stale", "cl-missing"]) {
    const entry = byId.get(record)!;
    assert.equal(entry.downstream, "done", record);
    assert.deepEqual(entry.stages.map(s => `${s.stage}:${s.outcome}:${s.by}`),
      ["recording_discovery:done:repair", "media_fetch:done:repair", "transcription:done:repair", "analysis:done:repair", "number_refresh:done:repair"]);
    const refresh = entry.stages.find(s => s.stage === "number_refresh")!;
    assert.ok(analysisCalls.includes(`number_refresh:${refresh.job_id}`), "the number synthesis was made due and claimed by id in this process");
    assert.equal((await Jobs.findById(refresh.job_id).lean())?.status, "completed");
  }
  assert.equal(byId.get("cl-stale")!.classification, "STALE");
  assert.equal(byId.get("cl-missing")!.classification, "MISSING");

  // The not-yet-served recording: its media unit is held away from every production consumer.
  const held = byId.get("cl-pending")!;
  assert.equal(held.downstream, "deferred");
  assert.match(held.reason ?? "", /^media_fetch:/);
  assert.equal(saved.holds.length, 1);
  const heldJob = await Jobs.findById(saved.holds[0]!.job_id).lean();
  assert.deepEqual([heldJob?.status, heldJob?.reason], ["paused", OPERATOR_HOLD_REASON]);
  assert.equal(await claimCsiJob("csi-media:cron", undefined, 60_000, "media_fetch"), null, "an undirected cron claim cannot take a held unit");
  assert.equal(await claimCsiJob("csi-media:queue", saved.holds[0]!.job_id, 60_000, "media_fetch"), null, "nor can a queue claim by id");

  // Resume: projected days are skipped, and nothing is re-applied.
  const resumed = await runCallLogRepair(saved, { ...base(outputs[1]!), stages, maxWaitMs: 0 });
  assert.equal(resumed.holds, 1);
  assert.deepEqual(resumed.days[0]!.applied, summary.days[0]!.applied);

  // The operator may hand held units back to production instead (`--release-holds`).
  const priorStatus = saved.holds[0]!.prior_status;
  const handedBack = await runCallLogRepair(saved, { ...base(outputs[1]!), stages }, { releaseHolds: true });
  assert.equal(handedBack.holds, 0);
  const released = await Jobs.findById(heldJob!._id).lean();
  assert.equal(released?.status, priorStatus);
  assert.notEqual(released?.reason, OPERATOR_HOLD_REASON);

  // A fresh pass over the same provider data is a pure no-op: every record is now stored in its latest version.
  throttleOnce = false;
  const second = newManifest({ mode: "apply", ...window, now: new Date(), credential: "PERSONAL_AI_GATEWAY_API_KEY", models: {} });
  const again = await runCallLogRepair(second, { ...base(outputs[2]!), stages, maxWaitMs: 0 });
  assert.deepEqual(again.days[0]!.counts, { MISSING: 0, STALE: 0, unchanged: 4 });
  assert.deepEqual(again.days[0]!.applied, { created: 0, updated: 0, noop: 4, failed: 0, changed_without_diff: 0 });
  assert.equal(again.interactions, 0);
});
