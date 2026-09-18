import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../src/db";
import { getMongoDatabaseName } from "../src/config/domain/runtime";
import { applyCsiMigration } from "./migrations/sales-intelligence.lib";
import { getCallInteractionModel } from "../src/models/CallInteraction";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getSalesIntelligenceJobModel } from "../src/models/SalesIntelligenceJob";
import { getContactNumberModel } from "../src/models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getRepIdentityLinkModel } from "../src/models/RepIdentityLink";
import { getOutreachRecordModel } from "../src/models/OutreachRecord";
import { getFormLeadModel } from "../src/models/FormLead";
import { getCallLeadModel } from "../src/models/CallLead";
import { applyInteractionObservation } from "../src/services/numberActivity/persistInteraction";
import { inboundConnectedCallLog, syntheticDirectory, syntheticRecordingWav, SYNTHETIC_ACCOUNT_ID } from "../src/services/numberActivity/fixtures";
import { runRecordingDiscoveryJob } from "../src/services/salesIntelligence/conversations/discover";
import { runMediaFetchJob } from "../src/services/salesIntelligence/conversations/media";
import { RECORDING_AVAILABILITY_WINDOW_MS } from "../src/services/salesIntelligence/conversations/mediaPolicy";
import { loadEligibilityInputs, decideAnalysisEligibility } from "../src/services/salesIntelligence/conversations/eligibility";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob } from "../src/services/salesIntelligence/jobs";
import { dispatchCsiWakeup } from "../src/services/numberActivity/jobDispatch";
import { readCaptureCoverage } from "../src/services/numberActivity/coverage";
import { RecordingReadError, type RecordingProvider } from "../src/services/ringcentral/recordings";
import type { ImmutableUpload } from "../src/services/conversations/streamingMedia";

test("CSI-11 disposable replica proofs (all provider bytes synthetic)", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 180000 }, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_csi11[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  const Jobs = getSalesIntelligenceJobModel(), Conversations = getLeadConversationModel(), Interactions = getCallInteractionModel();
  const blobs = new Map<string, Buffer>(); let uploads = 0; let serial = 0;
  const upload: ImmutableUpload = async input => {
    const bytes = await readFile(input.filePath); const prior = blobs.get(input.pathname);
    if (prior) assert.deepEqual(prior, bytes); else { blobs.set(input.pathname, bytes); uploads++; }
    return { pathname: input.pathname };
  };
  const provider: RecordingProvider = {
    metadata: async () => ({ contentType: "audio/wav", duration: 1 }),
    content: async () => new Response(Buffer.from(syntheticRecordingWav()), { headers: { "content-type": "audio/wav", "content-length": "48" } }),
  };
  const errorProvider = (status: number, retry: string | null = null): RecordingProvider => ({ ...provider, metadata: async () => { throw new RecordingReadError(status, retry); } });
  const due = (id: string) => Jobs.updateOne({ _id: id }, { $set: { next_attempt_at: new Date(0) } });
  async function capture(opts: { account?: string; recording?: string | null; mapped?: boolean; session?: string } = {}) {
    const sid = opts.session ?? `csi11-${++serial}`;
    const rid = opts.recording === undefined ? `recording-${sid}` : opts.recording;
    const record = inboundConnectedCallLog(sid, { recording: rid ? { id: rid } : null, legs: [], accountId: opts.account, duration: 1 });
    const result = await applyInteractionObservation(opts.account ?? SYNTHETIC_ACCOUNT_ID, { kind: "call_log", record, proof_ref: `call_log:${sid}` }, {
      now: () => new Date(), directory: syntheticDirectory(), resolveRoute: () => opts.mapped === false ? null : "aaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const job = await Jobs.findOne({ stage: "recording_discovery", input_refs: result.interaction_id }).orFail();
    return { ...result, jobId: String(job._id), rid, sid };
  }
  async function discovered() {
    const captured = await capture();
    const discovery = await runRecordingDiscoveryJob(captured.jobId);
    assert.equal(discovery.status, "completed", JSON.stringify(discovery));
    const conversation = await Conversations.findOne({ call_interaction_id: captured.interaction_id }).orFail();
    const mediaJob = await Jobs.findOne({ stage: "media_fetch", input_refs: conversation._id }).orFail();
    return { ...captured, conversationId: String(conversation._id), mediaJobId: String(mediaJob._id) };
  }
  try {
    await t.test("seeded private audio is available but does not prove recording_content capability", async () => {
      const seed = await Conversations.create({ provider: "ringcentral", provider_account_id: "seed-account", provider_recording_id: "seed-recording", direction: "Inbound", started_at: new Date(),
        match_method: "number_only", match_confidence: "low", state: "complete", media: { blob_pathname: "conversations/seed.mp3", stored_at: new Date() } });
      const coverage = await readCaptureCoverage();
      assert.equal(coverage.capabilities.recording_content, "unknown"); assert.equal(coverage.recordings?.media_stored, 1);
      await Conversations.deleteOne({ _id: seed._id });
    });
    await t.test("discovery dispatch, completed-job replay, account uniqueness and durable-before-wake", async () => {
      const a = await capture({ recording: "same-recording" });
      const dispatched = await dispatchCsiWakeup({ job_id: a.jobId }); assert.equal(dispatched.status, "dispatched");
      assert.equal((await runRecordingDiscoveryJob(a.jobId)).status, "not_claimable");
      const row = await Conversations.findOne({ provider_recording_id: "same-recording" }).orFail();
      assert.equal(row.duration_seconds, 1); assert.equal(row.direction, "Inbound"); assert.equal(row.analysis_eligibility?.eligible, true);
      assert.equal(String((await Interactions.findById(a.interaction_id))?.recordings[0]?.lead_conversation_id), String(row._id));
      const b = await capture({ account: "another-account", recording: "same-recording" });
      let wakeups = 0;
      assert.equal((await runRecordingDiscoveryJob(b.jobId, { publish: async id => {
        assert.equal((await Jobs.findById(id))?.status, "pending"); wakeups++; throw new Error("fake doorbell failure");
      } })).status, "completed");
      assert.equal(wakeups, 1); assert.equal(await Conversations.countDocuments({ provider_recording_id: "same-recording" }), 2);
      await Jobs.updateOne({ _id: a.jobId }, { $set: { status: "pending", next_attempt_at: new Date(0) } });
      assert.equal((await runRecordingDiscoveryJob(a.jobId)).status, "completed");
      assert.equal(await Conversations.countDocuments({ provider_recording_id: "same-recording" }), 2);
    });
    await t.test("pending job remains pending without a fabricated conversation, then Call Log supplies id", async () => {
      const a = await capture({ recording: null });
      assert.equal((await runRecordingDiscoveryJob(a.jobId)).status, "pending");
      assert.equal((await Jobs.findById(a.jobId))?.attempts, 0);
      assert.equal(await Conversations.countDocuments({ call_interaction_id: a.interaction_id }), 0);
      await capture({ recording: "delayed-recording", session: a.sid }); await due(a.jobId);
      assert.equal((await runRecordingDiscoveryJob(a.jobId)).status, "completed");
      assert.equal(await Conversations.countDocuments({ call_interaction_id: a.interaction_id }), 1);
      const exhausted = await capture({ recording: null });
      assert.equal((await runRecordingDiscoveryJob(exhausted.jobId, { now: () => new Date(Date.now() + RECORDING_AVAILABILITY_WINDOW_MS + 1000) })).status, "completed");
      assert.equal((await Interactions.findById(exhausted.interaction_id))?.recording_discovery?.state, "no_recording");
    });
    await t.test("merge tombstone resolves current canonical interaction", async () => {
      const canonical = await capture(), old = await capture({ recording: null });
      await Interactions.updateOne({ _id: old.interaction_id }, { $set: { merged_into_id: canonical.interaction_id } });
      assert.equal((await runRecordingDiscoveryJob(old.jobId)).status, "completed");
      assert.equal(await Conversations.countDocuments({ call_interaction_id: old.interaction_id }), 0);
      assert.equal(await Conversations.countDocuments({ call_interaction_id: canonical.interaction_id }), 1);
    });
    await t.test("missing CSI-05/10 stays undetermined and never calls a provider", async () => {
      const a = await capture({ mapped: false });
      assert.equal((await runRecordingDiscoveryJob(a.jobId)).status, "completed");
      const conversation = await Conversations.findOne({ call_interaction_id: a.interaction_id }).orFail();
      assert.equal(conversation.analysis_eligibility?.status, "undetermined");
      assert.ok(conversation.analysis_eligibility?.missing_inputs.includes("csi05_attachment_context"));
      const job = await Jobs.findOne({ stage: "media_fetch", input_refs: conversation._id }).orFail();
      assert.equal((await runMediaFetchJob(String(job._id), { provider: { ...provider, metadata: async () => { throw new Error("must not call"); } }, upload })).status, "eligibility_pending");
      assert.equal((await Jobs.findById(job._id))?.attempts, 0);
    });
    await t.test("404 pending then success; media digest retained on replay and no overwrite", async () => {
      const a = await discovered();
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider: errorProvider(404), upload })).status, "retry");
      assert.equal((await Conversations.findById(a.conversationId))?.availability_reason, "recording_pending");
      await due(a.mediaJobId);
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider, upload })).status, "completed");
      const row = await Conversations.findById(a.conversationId).orFail();
      assert.equal(row.state, "media_stored"); assert.equal(row.media?.bytes, 48); assert.match(row.media_digest_sha256!, /^[a-f0-9]{64}$/);
      assert.match(row.media!.blob_pathname!, /\/recording-csi11-\d+\/[a-f0-9]{64}\.wav$/);
      const count = uploads;
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider, upload })).status, "not_claimable");
      await Jobs.updateOne({ _id: a.mediaJobId }, { $set: { status: "pending", next_attempt_at: new Date(0) } });
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider: errorProvider(500), upload })).status, "completed");
      assert.equal(uploads, count);
    });
    await t.test("404 availability window exhaustion is explicit no_recording", async () => {
      const a = await discovered();
      await runMediaFetchJob(a.mediaJobId, { provider: errorProvider(404), upload, now: () => new Date(Date.now() + RECORDING_AVAILABILITY_WINDOW_MS + 1000) });
      const row = await Conversations.findById(a.conversationId).orFail(); assert.equal(row.state, "no_recording"); assert.equal(row.availability_reason, "availability_window_exhausted");
    });
    await t.test("403 denied and 24h retry; Coverage transitions and every read is read-only", async () => {
      const a = await discovered(); const now = new Date();
      await runMediaFetchJob(a.mediaJobId, { provider: errorProvider(403), upload, now: () => now });
      const row = await Conversations.findById(a.conversationId).orFail(); assert.equal(row.unavailable_until?.getTime(), now.getTime() + 86400000);
      assert.equal((await Jobs.findById(a.mediaJobId))?.attempts, 0);
      const snapshot = async () => {
        const collections = await db.listCollections().toArray();
        const entries = [];
        for (const collection of collections.sort((a, b) => a.name.localeCompare(b.name))) entries.push([collection.name, await db.collection(collection.name).find().sort({ _id: 1 }).toArray()]);
        return JSON.stringify(entries);
      };
      const before = await snapshot();
      assert.equal((await readCaptureCoverage()).capabilities.recording_content, "denied");
      assert.equal(await snapshot(), before, "Coverage changed no collection");
      await due(a.mediaJobId); await runMediaFetchJob(a.mediaJobId, { provider, upload });
      assert.equal((await readCaptureCoverage()).capabilities.recording_content, "ok");
    });
    await t.test("429 honors Retry-After or default without burning failure attempts", async () => {
      for (const retry of ["42", null]) {
        const a = await discovered(); const now = new Date();
        await runMediaFetchJob(a.mediaJobId, { provider: errorProvider(429, retry), upload, now: () => now });
        const row = await Conversations.findById(a.conversationId).orFail();
        assert.equal(row.unavailable_until?.getTime(), now.getTime() + (retry ? 42000 : 600000));
        assert.equal((await Jobs.findById(a.mediaJobId))?.attempts, 0);
        assert.equal((await readCaptureCoverage()).capabilities.recording_content, "unavailable");
        await due(a.mediaJobId); await runMediaFetchJob(a.mediaJobId, { provider, upload });
      }
    });
    await t.test("eight transient errors dead-letter and atomically project failure", async () => {
      const a = await discovered();
      for (let attempt = 1; attempt <= 8; attempt++) {
        await due(a.mediaJobId);
        assert.equal((await runMediaFetchJob(a.mediaJobId, { provider: errorProvider(500), upload })).status, attempt === 8 ? "dead_letter" : "retry");
      }
      assert.equal((await Conversations.findById(a.conversationId))?.state, "failed");
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider, upload })).status, "not_claimable");
    });
    await t.test("expired eighth claim recovers failure projection once without a ninth provider call", async () => {
      const a = await discovered();
      await Jobs.updateOne({ _id: a.mediaJobId }, { $set: { status: "leased", attempts: 8, lease_epoch: 8, lease_owner: "crashed", leased_until: new Date(0) } });
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider: errorProvider(500), upload })).status, "dead_letter");
      assert.equal((await Conversations.findById(a.conversationId))?.state, "failed");
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider, upload })).status, "not_claimable");
    });
    await t.test("media completion rechecks concurrent Owner exclusion and suppresses downstream hook", async () => {
      const a = await discovered();
      const concurrent: RecordingProvider = { ...provider, content: async (...args) => {
        await getContactNumberModel().updateOne({ _id: a.contact_number_id }, { $set: { classification: "non_customer" } });
        return provider.content(...args);
      } };
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider: concurrent, upload })).status, "completed");
      const row = await Conversations.findById(a.conversationId).orFail();
      assert.equal(row.analysis_eligibility?.status, "excluded"); assert.equal(row.pending_stage, null); assert.equal(row.state, "media_stored");
      await getContactNumberModel().updateOne({ _id: a.contact_number_id }, { $set: { classification: "unknown" } });
    });
    await t.test("restored eligibility reschedules a skipped media job once across concurrent discovery revisions", async () => {
      const a = await discovered();
      await getContactNumberModel().updateOne({ _id: a.contact_number_id }, { $set: { classification: "non_customer" } });
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider: errorProvider(500), upload })).status, "completed");
      assert.equal((await Jobs.findById(a.mediaJobId))?.result?.reason, "excluded");
      await getContactNumberModel().updateOne({ _id: a.contact_number_id }, { $set: { classification: "unknown" } });
      const refresh = async (revision: number) => withTransaction(session => enqueueCsiJob({ stage: "recording_discovery",
        dedupe_key: `csi:recording_discovery:interaction:${a.interaction_id}:eligibility:${revision}`,
        subject_key: `interaction:${a.interaction_id}`, input_revision: revision, input_refs: [a.interaction_id] }, session));
      const first = await refresh(2), second = await refresh(3);
      const results = await Promise.all([runRecordingDiscoveryJob(String(first._id)), runRecordingDiscoveryJob(String(second._id))]);
      assert.ok(results.every(result => result.status === "completed"), JSON.stringify(results));
      const jobs = await Jobs.find({ stage: "media_fetch", input_refs: a.conversationId }).sort({ input_revision: 1 });
      assert.equal(jobs.length, 2); assert.equal(jobs[1]!.input_revision, 2);
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider, upload })).status, "not_claimable");
      assert.equal((await runMediaFetchJob(String(jobs[1]!._id), { provider, upload })).status, "completed");
      assert.equal((await Conversations.findById(a.conversationId))?.state, "media_stored");
      const third = await refresh(4); await runRecordingDiscoveryJob(String(third._id));
      assert.equal(await Jobs.countDocuments({ stage: "media_fetch", input_refs: a.conversationId }), 2);
    });
    await t.test("concurrent discovery claims preserve one account recording", async () => {
      const a = await capture();
      const outcomes = await Promise.all([runRecordingDiscoveryJob(a.jobId), runRecordingDiscoveryJob(a.jobId)]);
      assert.equal(outcomes.filter(o => o.status === "completed").length, 1);
      assert.equal(outcomes.filter(o => o.status === "not_claimable").length, 1);
      assert.equal(await Conversations.countDocuments({ call_interaction_id: a.interaction_id }), 1);
    });
    await t.test("oversize provider media is terminal unavailable and never uploads", async () => {
      const a = await discovered(); let touched = false;
      await runMediaFetchJob(a.mediaJobId, { provider: { ...provider, content: async () => new Response(Buffer.from(syntheticRecordingWav()), { headers: { "content-type": "audio/wav", "content-length": "26214401" } }) },
        upload: async input => { touched = true; return { pathname: input.pathname }; } });
      assert.equal(touched, false); assert.equal((await Conversations.findById(a.conversationId))?.availability_reason, "media_too_large");
      assert.equal((await Jobs.findById(a.mediaJobId))?.status, "completed");
    });
    await t.test("discovery transaction rolls back conversation refresh and pointer on conflicting media intent", async () => {
      const a = await capture();
      const row = await Conversations.create({ provider: "ringcentral", provider_account_id: SYNTHETIC_ACCOUNT_ID, provider_recording_id: a.rid!,
        started_at: new Date(), direction: "Unknown", match_method: "number_only", match_confidence: "low" });
      const conflict = await withTransaction(session => enqueueCsiJob({ stage: "media_fetch", dedupe_key: `csi:media_fetch:conversation:${row._id}:1`,
        subject_key: `conversation:${row._id}`, input_revision: 2, input_refs: [String(row._id)] }, session));
      assert.equal((await runRecordingDiscoveryJob(a.jobId)).status, "failed");
      assert.equal((await Conversations.findById(row._id))?.direction, "Unknown");
      assert.equal((await Interactions.findById(a.interaction_id))?.recordings[0]?.lead_conversation_id, null);
      await Jobs.deleteOne({ _id: conflict._id }); await due(a.jobId);
      assert.equal((await runRecordingDiscoveryJob(a.jobId)).status, "completed");
    });
    await t.test("concurrent workers elect one; expired epoch cannot commit media", async () => {
      const a = await discovered(); let release!: () => void, started!: () => void;
      const gate = new Promise<void>(r => { release = r; }); const entered = new Promise<void>(r => { started = r; });
      const slow: RecordingProvider = { ...provider, metadata: async (...args) => { started(); await gate; return provider.metadata(...args); } };
      const first = runMediaFetchJob(a.mediaJobId, { owner: "old-worker", provider: slow, upload }); await entered;
      assert.equal((await runMediaFetchJob(a.mediaJobId, { provider, upload })).status, "not_claimable");
      await Jobs.updateOne({ _id: a.mediaJobId }, { $set: { leased_until: new Date(0) } });
      assert.equal((await runMediaFetchJob(a.mediaJobId, { owner: "new-worker", provider, upload })).status, "completed");
      release(); assert.equal((await first).status, "lease_lost");
      assert.equal((await Conversations.findById(a.conversationId))?.state, "media_stored");
    });
    await t.test("fenced failure callback rolls back effects when lease expires", async () => {
      const a = await discovered(); const job = await claimCsiJob("fenced", a.mediaJobId, 100, "media_fetch"); assert.ok(job);
      await assert.rejects(failCsiJob({ job_id: a.mediaJobId, owner: "fenced", epoch: job.lease_epoch }, "transient", 0, { mutation: async session => {
        await Conversations.updateOne({ _id: a.conversationId }, { $set: { state: "failed" } }, { session });
        await new Promise(r => setTimeout(r, 150));
      } }), /LEASE_LOST/);
      assert.equal((await Conversations.findById(a.conversationId))?.state, "discovered");
    });
    await t.test("database eligibility reads validate Lead refs, ambiguity, Owner review and effective reviewed rep", async () => {
      const a = await capture({ mapped: false }); const interaction = await Interactions.findById(a.interaction_id).orFail();
      const number = interaction.contact_number_id!;
      // Minimal official fixtures inserted directly only in this disposable DB. No official write service is invoked.
      const f = new mongoose.Types.ObjectId(), c = new mongoose.Types.ObjectId();
      await getFormLeadModel().collection.insertOne({ _id: f, booked: true, cancelled: true });
      await getCallLeadModel().collection.insertOne({ _id: c, booked: true });
      const Attachment = getNumberLeadAttachmentModel();
      const evidence = [{ source: "lead_phone_live", field_path: "normalized_phone_number", observed_at: new Date(), window_from: new Date(0), window_to: new Date("2030-01-01") }];
      await Attachment.create({ contact_number_id: number, lead_ref: { model: "FormLead", id: f }, state: "attached", certainty: "exact", evidence });
      const decide = () => withTransaction(async session => decideAnalysisEligibility(await loadEligibilityInputs(interaction, session)));
      assert.ok((await decide()).reasons.includes("form_linked"));
      await Attachment.create({ contact_number_id: number, lead_ref: { model: "CallLead", id: c }, state: "candidate", certainty: "likely", evidence });
      assert.equal((await decide()).scope, "lead", "attached edge outranks candidate");
      await Attachment.updateOne({ "lead_ref.id": c }, { $set: { state: "attached" } });
      assert.equal((await decide()).scope, "number"); assert.ok((await decide()).reasons.includes("ambiguous_lead_context"));
      await Attachment.updateOne({ "lead_ref.id": c }, { $set: { "evidence.0.window_to": new Date("2000-01-01") } });
      assert.equal((await decide()).scope, "lead", "non-overlapping historical move is excluded");
      await Attachment.deleteMany({ contact_number_id: number });
      await getCallLeadModel().collection.updateOne({ _id: c }, { $set: { ringcentral: { telephony_session_id: interaction.telephony_session_id } } });
      await Attachment.create({ contact_number_id: number, lead_ref: { model: "CallLead", id: c }, state: "attached", certainty: "exact",
        evidence: [{ source: "call_lead_ringcentral_identity", field_path: "ringcentral.telephony_session_id", observed_at: new Date() }] });
      assert.ok((await decide()).reasons.includes("call_linked"), "exact identity authorizes its own call");
      const originalSession = interaction.telephony_session_id;
      interaction.telephony_session_id = "later-unrelated-call";
      assert.equal((await decide()).eligible, false, "exact identity is not lifetime authorization");
      interaction.telephony_session_id = originalSession;
      await Attachment.deleteMany({ contact_number_id: number });
      await getOutreachRecordModel().create({ subject: { kind: "number_review", contact_number_id: number }, trigger_kind: "owner_open", trigger_at: new Date(), policy_version: "csi-policy-v1" });
      assert.ok((await decide()).reasons.includes("number_review"));
      await getOutreachRecordModel().deleteMany({ "subject.contact_number_id": number });
      interaction.direction = "Outbound"; interaction.set("parties", [{ role: "user", extension_id: "rep-test", direction: "Outbound", connected: false }]);
      const Rep = getRepIdentityLinkModel();
      const link = await Rep.create({ agent_id: new mongoose.Types.ObjectId(), agent_name_snapshot: "Synthetic Rep", rc_account_id: interaction.provider_account_id,
        rc_extension_id: "rep-test", role_kind: "sales_rep", status: "proposed", effective_from: new Date(0) });
      assert.equal((await decide()).status, "undetermined");
      await Rep.updateOne({ _id: link._id }, { $set: { status: "reviewed" } }); assert.ok((await decide()).reasons.includes("reviewed_rep_outbound"));
      await getContactNumberModel().updateOne({ _id: number }, { $set: { classification: "non_customer" } }); assert.equal((await decide()).status, "excluded");
    });
    assert.equal(await db.collection("ringcentral_call_log_sync_state_test").countDocuments(), 0);
    assert.equal(await Jobs.countDocuments({ stage: { $in: ["transcription", "analysis"] } }), 0);
  } finally { await db.dropDatabase(); await mongoose.disconnect(); }
});
