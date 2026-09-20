import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import express, { type Request } from "express";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { enqueueCsiJob, claimCsiJob } from "../src/services/salesIntelligence/jobs";
import { prepareIntelligenceRun } from "../src/services/salesIntelligence/analysis/run";
import { captureIntelligenceRead } from "../src/services/salesIntelligence/analysis/capture";
import { requireCsiRun } from "../src/services/salesIntelligence/auth";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { csiDataset } from "../src/config/domain/salesIntelligence";
import { LEAD_CONVERSATION_COLLECTION } from "../src/config/domain/conversations";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { applyInteractionObservation } from "../src/services/numberActivity/persistInteraction";
import { inboundConnectedCallLog, syntheticDirectory, syntheticRecordingWav, SYNTHETIC_ACCOUNT_ID } from "../src/services/numberActivity/fixtures";
import { runRecordingDiscoveryJob } from "../src/services/salesIntelligence/conversations/discover";
import { runMediaFetchJob } from "../src/services/salesIntelligence/conversations/media";
import { runRetentionOnce } from "../src/services/salesIntelligence/retention";
import { retainedOriginal, scheduleOwnerReanalysis } from "../src/services/salesIntelligence/analysis/ownerReanalysis";
import { readOwnerEvidence } from "../src/services/salesIntelligence/analysis/ownerReads";
import type { CsiTransactionContext } from "../src/services/salesIntelligence/transactions";

const enabled = process.env.CSI_REPLICA_TEST === "true";
const id = () => new mongoose.Types.ObjectId();
const at = new Date("2028-09-19T12:00:00Z");
const daysAgo = (n: number) => new Date(+at - n * 86_400_000);
const secret = "SYNTHETIC_TRANSCRIPT_SENTINEL_15";
test("CSI-15 retention: fenced atomic purge, independent clocks, immutable copies and tombstones", { skip: !enabled, timeout: 120_000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi15retention[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const database = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await database.admin().command({ hello: 1 })).setName, "csi01");
  const collection = (name: string) => database.collection(name);
  const conversationId = id(), numberId = id(), sourceId = id(), runId = id(), copyId = id(), findingId = id(), effectId = id(), followupId = id(), outreachId = id(), leadId = id(), nudgeId = id();
  let deletes = 0;
  try {
    await applyCsiMigration();
    await collection("contact_numbers").insertOne({ _id: numberId, e164: "+12025550123", revision: 1, running_summary: { text: secret }, last_activity_at: daysAgo(20) });
    await collection(LEAD_CONVERSATION_COLLECTION).insertOne({ _id: conversationId, contact_number_id: numberId, media: { blob_pathname: "synthetic/audio", blob_url: "private", stored_at: daysAgo(100) }, transcript: { text: secret }, transcript_segments: [{ text: secret }], latest_transcript_version: "v1", summary: { text: secret } });
    await collection("intelligence_evidence_snapshots").insertOne({ _id: sourceId, ...csiDataset(), subject_key: `conversation:${conversationId}`, conversation_id: conversationId, source_type: "transcript", retrieved_at: daysAgo(200), response: { text: secret }, arguments: {}, segments: [{ text: secret }] });
    await t.test("90-day audio purge retains 200-day transcript and summary", async () => {
      const result = await runRetentionOnce({ now: () => at, deleteAudio: async path => { assert.equal(path, "synthetic/audio"); deletes++; } });
      assert.equal(result.audio_purged, 1); assert.equal(result.redacted_purged, 0); assert.equal(deletes, 1);
      const row = await collection(LEAD_CONVERSATION_COLLECTION).findOne({ _id: conversationId });
      assert.equal(row!.transcript.text, secret); assert.equal(row!.summary.text, secret); assert.equal(row!.media.blob_url, null); assert.deepEqual(row!.media.purged_at, at);
    });
    await collection("intelligence_evidence_snapshots").updateOne({ _id: sourceId }, { $set: { retrieved_at: daysAgo(366) } });
    await collection("outreach_records").insertOne({ _id: outreachId, primary_contact_number_id: numberId, subject: { kind: "lead", model: "FormLead", id: leadId } });
    await collection("intelligence_runs").insertOne({ _id: runId, outreach_record_id: outreachId, ...csiDataset(), contact_number_id: numberId, conversation_id: conversationId, subject_key: `conversation:${conversationId}`, status: "completed", revision: 1, finalized_at: daysAgo(1), createdAt: daysAgo(1), rendered_prompt: secret, output: { text: secret }, raw_output: secret, owner_correction_context: [secret], manifest_digest: "digest", manifest_snapshot_ids: [copyId] });
    await collection("intelligence_evidence_snapshots").insertOne({ _id: copyId, ...csiDataset(), run_id: runId, subject_key: `conversation:${conversationId}`, source_type: "tool_response", retrieved_at: daysAgo(1), response: { transcript: { source_snapshot_id: String(sourceId), segments: [{ text: secret }] } }, arguments: { text: secret } });
    await collection("intelligence_findings").insertOne({ _id: findingId, run_id: runId, assertion: { claim: secret }, resolved: { original_wording: secret } });
    await collection("intelligence_effects").insertOne({ _id: effectId, run_id: runId, finding_id: findingId, previous: { description: secret }, current: { description: secret } });
    await collection("intelligence_submissions").insertOne({ run_id: runId, envelope: { text: secret } });
    await collection("outreach_followups").insertOne({ _id: followupId, commitment_key: "first", origin_run_id: runId, description: secret, date_text: secret, source_finding_ids: [findingId] });
    await collection("sales_intelligence_audit_events").insertOne({ subject_key: `conversation:${conversationId}`, prior: { text: secret }, current: { text: secret, interaction_id: "stable-call", projection_revision: 7, rep_identity_fingerprint: "stable-fingerprint" } });
    await collection("sales_intelligence_audit_events").insertOne({ semantic_key: "lead-retention-proof", subject_key: `lead:FormLead:${leadId}`, prior: { description: secret }, current: { description: secret, interaction_id: "stable-lead-call" } });
    await collection("owner_rep_nudges").insertOne({ _id: nudgeId, idempotency_key: "derived-nudge", contact_number_id: numberId, outreach_record_id: outreachId, body_as_sent: secret, authorized_command: { text: secret }, status: "sent", provider_message_id: "synthetic-delivery", sent_at: daysAgo(1) });
    await t.test("crash before commit rolls back root and every dependent copy", async () => {
      await assert.rejects(runRetentionOnce({ now: () => at, beforeCommit: async () => { throw new Error("synthetic_crash"); } }), /synthetic_crash/);
      assert.equal((await collection("intelligence_evidence_snapshots").findOne({ _id: sourceId }))!.purged_at, undefined);
      assert.equal((await collection("intelligence_runs").findOne({ _id: runId }))!.rendered_prompt, secret);
    });
    await t.test("365-day root purges recent copied prompt/envelope/findings/effects and caches atomically", async () => {
      const result = await runRetentionOnce({ now: () => at }); assert.equal(result.redacted_purged, 1);
      for (const name of ["intelligence_runs", "intelligence_evidence_snapshots", "intelligence_findings", "intelligence_effects", "intelligence_submissions", "outreach_followups", "sales_intelligence_audit_events", "owner_rep_nudges", "contact_numbers", LEAD_CONVERSATION_COLLECTION]) {
        assert.ok(!JSON.stringify(await collection(name).find({}).toArray()).includes(secret), `retained secret in ${name}`);
      }
      const audit = await collection("sales_intelligence_audit_events").findOne({ subject_key: `conversation:${conversationId}` });
      assert.deepEqual(audit!.current, { interaction_id: "stable-call", projection_revision: 7, rep_identity_fingerprint: "stable-fingerprint" });
      const nudge = await collection("owner_rep_nudges").findOne({ _id: nudgeId });
      assert.equal(nudge!.body_as_sent, ""); assert.equal(nudge!.authorized_command, null);
      assert.equal(nudge!.status, "sent"); assert.equal(nudge!.provider_message_id, "synthetic-delivery"); assert.deepEqual(nudge!.sent_at, daysAgo(1));
      const leadAudit = await collection("sales_intelligence_audit_events").findOne({ subject_key: `lead:FormLead:${leadId}` });
      assert.deepEqual(leadAudit!.current, { interaction_id: "stable-lead-call" });
      assert.equal((await runRetentionOnce({ now: () => at })).redacted_purged, 0);
      await assert.rejects(retainedOriginal(String(runId)), (error: unknown) => (error as { code: string }).code === "ORIGINAL_EVIDENCE_UNAVAILABLE");
      await assert.rejects(withTransaction(session => scheduleOwnerReanalysis(String(runId), "original_evidence", [], { session } as CsiTransactionContext)), (error: unknown) => (error as { code: string }).code === "ORIGINAL_EVIDENCE_UNAVAILABLE");
      const evidence = await readOwnerEvidence(String(runId), String(copyId));
      assert.ok(evidence && "unavailable" in evidence.data && evidence.data.unavailable);
    });
    await t.test("large subject cleanup resumes in bounded batches before final source tombstone", async () => {
      const number = id(), conversation = id(), source = id();
      await collection("contact_numbers").insertOne({ _id: number, e164: "+12025550125", revision: 1, last_activity_at: daysAgo(1) });
      await collection(LEAD_CONVERSATION_COLLECTION).insertOne({ _id: conversation, contact_number_id: number, provider_recording_id: "batch", transcript: { text: secret } });
      await collection("intelligence_evidence_snapshots").insertOne({ _id: source, conversation_id: conversation, source_type: "transcript", retrieved_at: daysAgo(366), subject_key: `conversation:${conversation}` });
      await collection("intelligence_runs").insertMany(Array.from({ length: 52 }, () => ({ _id: id(), job_id: id(), contact_number_id: number, subject_key: `number:${number}`, rendered_prompt: secret, createdAt: daysAgo(1) })));
      await runRetentionOnce({ now: () => at, limit: 1 });
      assert.equal(await collection("intelligence_runs").countDocuments({ contact_number_id: number, purged_at: null }), 2);
      assert.equal((await collection("contact_numbers").findOne({ _id: number }))!.content_purge_pending, true);
      assert.equal((await collection("intelligence_evidence_snapshots").findOne({ _id: source }))!.purged_at, null);
      assert.deepEqual((await collection("intelligence_evidence_snapshots").findOne({ _id: source }))!.purge_started_at, at);
      await runRetentionOnce({ now: () => at, limit: 1 });
      assert.equal(await collection("intelligence_runs").countDocuments({ contact_number_id: number, purged_at: null }), 0);
      assert.equal((await collection("contact_numbers").findOne({ _id: number }))!.content_purge_pending, false);
      assert.deepEqual((await collection("intelligence_evidence_snapshots").findOne({ _id: source }))!.purged_at, at);
    });
    await t.test("read captured before purge cannot be persisted after purge", async () => {
      const number = await getContactNumberModel().create({ e164: "+12025550126", digits_reversed: "6210555202", first_observed_at: daysAgo(1), last_activity_at: daysAgo(1) });
      const conversation = id();
      await collection(LEAD_CONVERSATION_COLLECTION).insertOne({ _id: conversation, contact_number_id: number._id, provider_recording_id: "race" });
      await collection("intelligence_evidence_snapshots").insertOne({ conversation_id: conversation, source_type: "transcript", retrieved_at: daysAgo(366), subject_key: `conversation:${conversation}`, segments: [{ text: secret }] });
      const job = await withTransaction(session => enqueueCsiJob({ stage: "analysis", subject_key: `number:${number._id}`, dedupe_key: "retention-race", input_revision: 1 }, session));
      const leased = await claimCsiJob("retention-race", String(job._id), 300_000, "analysis"); assert(leased);
      const run = await prepareIntelligenceRun({ job_id: String(job._id), owner: "retention-race", epoch: leased.lease_epoch }, { contact_number_id: String(number._id), input_fingerprint: "synthetic", model_version: "synthetic" });
      const request: Request = Object.assign(Object.create(express.request), { headers: { "x-vantage-intelligence-run-token": run.token }, vantageAuth: { kind: "scoped_key", scopedKeyName: "synthetic-intelligence", scopedKeyFingerprint: "synthetic" } });
      const auth = await requireCsiRun(request, run.run_id, "get_intelligence_context");
      await assert.rejects(captureIntelligenceRead(auth, { tool: "get_intelligence_context", args: {} }, {
        read: async () => ({ page: { records: [{ record_type: "lead", record_id: String(number._id), revision: "1", fields: { name: secret } }], complete: true, next_cursor: null, missing_ranges: [] }, coverage: { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false }, allowed_followup_ids: [], instructions: [], speaker_refs: [] }),
        beforePersist: async () => { await runRetentionOnce({ now: () => at }); },
      }), (error: unknown) => ["RUN_SCOPE_DENIED", "ORIGINAL_EVIDENCE_UNAVAILABLE"].includes((error as { code: string }).code));
      assert.equal(await collection("intelligence_evidence_snapshots").countDocuments({ run_id: new mongoose.Types.ObjectId(run.run_id) }), 0);
    });
    await t.test("preparation retries after a concurrent purge without copying expired Owner context", async () => {
      const number = await getContactNumberModel().create({ e164: "+12025550127", digits_reversed: "7210555202", first_observed_at: daysAgo(1), last_activity_at: daysAgo(1) });
      const conversation = id(), correction = id();
      await collection(LEAD_CONVERSATION_COLLECTION).insertOne({ _id: conversation, contact_number_id: number._id, provider_recording_id: "prepare-race" });
      await collection("intelligence_evidence_snapshots").insertOne({ conversation_id: conversation, source_type: "transcript", retrieved_at: daysAgo(366), subject_key: `conversation:${conversation}`, segments: [{ text: secret }] });
      await collection("sales_intelligence_owner_instructions").insertOne({ _id: correction, instruction_id: id(), revision: 1, subject_key: `number:${number._id}`, field: "description", state: "active", prior: { description: secret }, current: { description: secret }, happened_at: daysAgo(1) });
      const job = await withTransaction(session => enqueueCsiJob({ stage: "analysis", subject_key: `number:${number._id}`, dedupe_key: "prepare-retention-race", input_revision: 1 }, session));
      const leased = await claimCsiJob("prepare-retention-race", String(job._id), 300_000, "analysis"); assert(leased);
      let purged = false;
      const run = await prepareIntelligenceRun({ job_id: String(job._id), owner: "prepare-retention-race", epoch: leased.lease_epoch }, { contact_number_id: String(number._id), owner_correction_ids: [String(correction)], input_fingerprint: "synthetic", model_version: "synthetic" }, {
        beforePersist: async () => { if (!purged) { purged = true; await runRetentionOnce({ now: () => at }); } },
      });
      assert.equal(purged, true);
      assert.ok(!run.prompt_context.rendered_prompt?.includes(secret));
      assert.ok(!JSON.stringify(await collection("intelligence_runs").findOne({ _id: new mongoose.Types.ObjectId(run.run_id) })).includes(secret));
      assert.equal((await collection("sales_intelligence_owner_instructions").findOne({ _id: correction }))!.state, "active");
    });
    await t.test("expired lease cannot checkpoint a Blob deletion; retry safely repeats deletion", async () => {
      const rowId = id(); let clock = at;
      await collection(LEAD_CONVERSATION_COLLECTION).insertOne({ _id: rowId, provider_recording_id: "second", media: { blob_pathname: "synthetic/second", stored_at: daysAgo(91) } });
      await assert.rejects(runRetentionOnce({ now: () => clock, leaseTtlMs: 10, deleteAudio: async () => { clock = new Date(+at + 11); } }), /retention_lease_lost/);
      assert.equal((await collection(LEAD_CONVERSATION_COLLECTION).findOne({ _id: rowId }))!.media.purged_at, undefined);
      const result = await runRetentionOnce({ now: () => clock, deleteAudio: async () => { deletes++; } });
      assert.equal(result.audio_purged, 1);
    });
    await t.test("730-day activity removes contact/search/attachment/outreach/nudge content while retaining call aliases", async () => {
      const number = id(), call = id(), record = id();
      await collection("contact_numbers").insertOne({ _id: number, e164: "+12025550124", last_activity_at: daysAgo(731), provider_names: [secret], search_terms: [secret] });
      await collection("call_interactions").insertOne({ _id: call, started_at: daysAgo(731), contact_number_id: number, parties: [{ name: secret }], external_e164: "+12025550124" });
      await collection("call_interaction_aliases").insertOne({ interaction_id: call, alias: "stable-provider-id" });
      await collection("number_lead_attachments").insertOne({ contact_number_id: number });
      await collection("outreach_records").insertOne({ _id: record, primary_contact_number_id: number, state: "open" });
      await collection("outreach_followups").insertOne({ commitment_key: "second", outreach_record_id: record, source_interaction_id: call, description: secret, status: "open" });
      await collection("owner_rep_nudges").insertOne({ contact_number_id: number, body_as_sent: secret, destination: secret });
      const result = await runRetentionOnce({ now: () => new Date(+at + 20) }); assert.equal(result.activity_purged, 1);
      assert.equal(await collection("number_lead_attachments").countDocuments({ contact_number_id: number }), 0);
      assert.equal(await collection("call_interaction_aliases").countDocuments({ interaction_id: call }), 1);
      for (const name of ["contact_numbers", "call_interactions", "outreach_followups", "owner_rep_nudges"]) assert.ok(!JSON.stringify(await collection(name).find({}).toArray()).includes(secret), name);
    });
    await t.test("purged upload persists cleanup intent and retention retries failed Blob deletion", async () => {
      const observed = await applyInteractionObservation(SYNTHETIC_ACCOUNT_ID, { kind: "call_log", record: inboundConnectedCallLog("retention-upload", { recording: { id: "retention-recording" }, legs: [], duration: 1 }), proof_ref: "synthetic:retention-upload" }, { now: () => new Date(), directory: syntheticDirectory(), resolveRoute: () => "aaaaaaaaaaaaaaaaaaaaaaaa" });
      const discovery = await collection("sales_intelligence_jobs").findOne({ stage: "recording_discovery", input_refs: new mongoose.Types.ObjectId(observed.interaction_id) });
      assert(discovery); assert.equal((await runRecordingDiscoveryJob(String(discovery._id))).status, "completed");
      const conversation = await collection(LEAD_CONVERSATION_COLLECTION).findOne({ call_interaction_id: new mongoose.Types.ObjectId(observed.interaction_id) }); assert(conversation);
      const job = await collection("sales_intelligence_jobs").findOne({ stage: "media_fetch", input_refs: conversation._id }); assert(job);
      let pathname = "", providerReads = 0;
      const result = await runMediaFetchJob(String(job._id), {
        provider: { metadata: async () => { providerReads++; return { contentType: "audio/wav", duration: 1 }; }, content: async () => new Response(Buffer.from(syntheticRecordingWav()), { headers: { "content-type": "audio/wav", "content-length": "48" } }) },
        upload: async input => { pathname = input.pathname; await collection(LEAD_CONVERSATION_COLLECTION).updateOne({ _id: conversation._id }, { $set: { content_purged_at: at } }); return { pathname }; },
        deleteUpload: async () => { throw new Error("synthetic_delete_failed"); },
      });
      assert.equal(result.status, "completed"); assert.ok("reason" in result && result.reason === "purged_cleanup_pending");
      assert.equal((await collection("sales_intelligence_jobs").findOne({ _id: job._id }))!.result.pending_blob_delete, pathname);
      assert.equal((await collection(LEAD_CONVERSATION_COLLECTION).findOne({ _id: conversation._id }))!.media?.blob_pathname ?? null, null);
      assert.equal((await runRetentionOnce({ now: () => new Date(+at + 30), deleteAudio: async () => { throw new Error("synthetic_still_down"); } })).skip_reason, "blob_delete_failed");
      assert.equal((await collection("sales_intelligence_jobs").findOne({ _id: job._id }))!.result.pending_blob_delete, pathname);
      let removed = 0;
      await runRetentionOnce({ now: () => new Date(+at + 30), deleteAudio: async path => { assert.equal(path, pathname); removed++; } });
      assert.equal(removed, 1);
      assert.equal((await collection("sales_intelligence_jobs").findOne({ _id: job._id }))!.result.pending_blob_delete, undefined);
      assert.equal((await runMediaFetchJob(String(job._id))).status, "not_claimable"); assert.equal(providerReads, 1);
    });
  } finally { await database.dropDatabase(); await mongoose.disconnect(); }
});

