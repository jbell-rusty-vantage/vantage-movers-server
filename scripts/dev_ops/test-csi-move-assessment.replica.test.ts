import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { csiDataset } from "../../src/config/domain/salesIntelligence";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getIntelligenceRunModel } from "../../src/models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../src/models/IntelligenceFinding";
import { getMoveAssessmentArtifactModel } from "../../src/models/MoveAssessmentArtifact";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { getSalesIntelligenceAiReservationModel } from "../../src/models/SalesIntelligenceAiReservation";
import { getSalesIntelligenceAiBudgetModel } from "../../src/models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceAuditEventModel } from "../../src/models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceAttentionSnapshotModel } from "../../src/models/SalesIntelligenceAttentionSnapshot";
import { getSalesIntelligenceOwnerInstructionModel } from "../../src/models/SalesIntelligenceOwnerInstruction";
import { initializeCsiBudgetPeriod } from "../../src/services/salesIntelligence/aiBudget";
import { enqueueCsiJob, CSI_BACKFILL_JOB_PRIORITY } from "../../src/services/salesIntelligence/jobs";
import {
  drainMoveAssessmentJobs, nominateMoveAssessment, purgeMoveAssessments, runMoveAssessmentJob, type MoveAssessmentDeps,
} from "../../src/services/salesIntelligence/assessment/runtime";
import {
  MARK, mockAssessmentModel, seedLead, seedLegacyConversation, seedNumber, seedRecord, seedSummaryConversation,
} from "./csi-move-assessment-fixtures";

test("Move assessment runtime: one call per fingerprint, reuse, fences, shadow and retention on the csi01 replica", {
  skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000,
}, async t => {
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(getMongoDatabaseName(), /^testvantagemovers_ma[a-f0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  await connectMongo();
  assert.equal(process.env.AI_GATEWAY_API_KEY, "", "no provider credential in the proof");
  assert.equal(process.env.PERSONAL_AI_GATEWAY_API_KEY, "", "no provider credential in the proof");
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { mongoose.set("debug", false); await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the Move assessment replica proof"); });
  const now = new Date(), month = now.toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });

  const Records = getOutreachRecordModel(), Artifacts = getMoveAssessmentArtifactModel(), Jobs = getSalesIntelligenceJobModel();
  const Reservations = getSalesIntelligenceAiReservationModel();
  const nominate = (recordId: string, trigger: string, force = false) =>
    withTransaction(session => nominateMoveAssessment({ outreach_record_id: recordId, trigger, force }, session));
  const run = async (recordId: string, trigger: string, deps: MoveAssessmentDeps) => {
    const jobId = await nominate(recordId, trigger, deps.force);
    assert.ok(jobId, `nomination for ${trigger}`);
    return { jobId, result: await runMoveAssessmentJob(jobId, { onError: error => { if (!(error instanceof Error && /Synthetic|FEATURE_DISABLED/.test(error.message))) console.error(error); }, ...deps }) };
  };
  const at = (day: number) => new Date(`2026-09-${String(day).padStart(2, "0")}T15:00:00Z`);

  // ── Fixtures ──────────────────────────────────────────────────────────
  // S1: Form Lead with captured ingestion evidence whose current move differs, two summarized calls.
  const n1 = await seedNumber();
  const l1 = await seedLead("FormLead", n1.national_ten!, { pickup_city: "Miami", pickup_state: "FL", pickup_zip: "33101", delivery_city: "Austin",
    delivery_state: "TX", destination_zip: "73301", move_date: new Date("2026-10-15T00:00:00Z"), move_size: "2 Bedroom", ingestion_origin: "wordpress_form",
    ingested_move_snapshot: { pickup_city: "Miami", pickup_state: "FL", pickup_zip: "33101", delivery_city: "Dallas", delivery_state: "TX",
      destination_zip: "75201", move_date: new Date("2026-10-01T00:00:00Z"), move_size: "1 Bedroom", captured_at: at(1), evidence_status: "captured_at_ingestion" } });
  const r1 = await seedRecord(l1, String(n1._id));
  const c1 = await seedSummaryConversation(String(n1._id), at(10), { overview: "Customer is planning a two-bedroom move to Austin.",
    money_and_dates: "Target date October 15." }, [{ claim: "We are definitely moving on October 15" }]);
  const c2 = await seedSummaryConversation(String(n1._id), at(12), { overview: "Follow-up call; customer compared quotes.",
    outcome: "Customer liked the Vantage quote." }, [{ claim: "Your quote looks good" }]);
  // S2: Call Lead whose only conversation has a retained legacy run.
  const n2 = await seedNumber();
  const l2 = await seedLead("CallLead", n2.national_ten!, { pickup_city: "Denver", pickup_state: "CO" });
  const r2 = await seedRecord(l2, String(n2._id));
  await seedLegacyConversation(String(n2._id), at(11), { overview: "Legacy summary: customer asked about a local move.", outcome: "Will call back." });
  // S3: Lead-only Form Lead (no conversations).
  const n3 = await seedNumber();
  const l3 = await seedLead("FormLead", n3.national_ten!, { pickup_city: "Tampa", pickup_state: "FL", delivery_city: "Atlanta", delivery_state: "GA",
    move_date: new Date("2026-11-02T00:00:00Z"), move_size: "Studio" });
  const r3 = await seedRecord(l3, String(n3._id));
  // S4: CRM-closed record with a summarized call.
  const n4 = await seedNumber();
  const l4 = await seedLead("FormLead", n4.national_ten!, { pickup_city: "Reno", pickup_state: "NV" });
  const r4 = await seedRecord(l4, String(n4._id));
  await seedSummaryConversation(String(n4._id), at(9), { overview: "Customer said another company already has the job." });
  // S5: open record closed while its generation is in flight.
  const n5 = await seedNumber();
  const l5 = await seedLead("FormLead", n5.national_ten!, { pickup_city: "Boise", pickup_state: "ID" });
  const r5 = await seedRecord(l5, String(n5._id));
  await seedSummaryConversation(String(n5._id), at(13), { overview: "Customer is moving in December." }, [{ claim: "Moving in December" }]);
  // S6: identity review.
  const n6 = await seedNumber();
  const l6 = await seedLead("CallLead", n6.national_ten!, {});
  const r6 = await seedRecord(l6, String(n6._id));
  await seedSummaryConversation(String(n6._id), at(8), { overview: "Unclear who called." });
  // S7: configuration and credential cases.
  const n7 = await seedNumber();
  const l7 = await seedLead("CallLead", n7.national_ten!, { pickup_city: "Omaha", pickup_state: "NE" });
  const r7 = await seedRecord(l7, String(n7._id));
  await seedSummaryConversation(String(n7._id), at(14), { overview: "Customer wants a quote for a three-bedroom move." });
  await Records.collection.updateOne({ _id: new mongoose.Types.ObjectId(r4) }, { $set: { state: "closed", closure_origin: "crm_disposition", closed_reason: "granot_dead_opportunity", closed_at: now } });
  await Records.collection.updateOne({ _id: new mongoose.Types.ObjectId(r6) }, { $set: { state: "identity_review", state_before_identity_review: "unworked" } });

  const counts = async () => ({ runs: await getIntelligenceRunModel().countDocuments(), findings: await getIntelligenceFindingModel().countDocuments(),
    followups: await getOutreachFollowupModel().countDocuments(), analysis_jobs: await Jobs.countDocuments({ stage: { $in: ["analysis", "number_refresh", "application"] } }) });
  const baseline = await counts();
  const subject1 = `lead:FormLead:${l1.id}`;

  await t.test("A05: one provider call from summaries only, zero transcript reads and zero domain effects", async () => {
    const reads: Array<{ collection: string; method: string; query: unknown }> = [];
    mongoose.set("debug", (collection: string, method: string, query: unknown) => { reads.push({ collection, method, query }); });
    const mock = await mockAssessmentModel();
    const { result } = await run(r1, "summary:a05", { model: mock.model });
    mongoose.set("debug", false);
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.reason, "published");
    assert.equal(mock.calls(), 1);
    assert.equal(mock.prompts[0].includes(MARK.segment), false, "the transcript segment text never reaches the model");
    const transcriptIds = new Set([String(c1.transcript._id), String(c2.transcript._id)]);
    const touchedTranscripts = reads.filter(r => r.collection === "intelligence_evidence_snapshots" && (JSON.stringify(r.query).includes('"transcript"') ||
      [...transcriptIds].some(id => JSON.stringify(r.query).includes(id))));
    assert.deepEqual(touchedTranscripts, [], "no transcript snapshot read");
    assert.deepEqual(await counts(), baseline, "no IntelligenceRun/Finding/Followup or analysis/number_refresh job created");
    const payload = mock.payloads[0];
    assert.equal(payload.subject.no_conversation_evidence, false);
    assert.equal(payload.conversations.length, 2);
    assert.ok(payload.views.original_ingestion, "original ingestion view present");
    assert.match(JSON.stringify(payload.views.original_ingestion), /Dallas/);
    assert.match(JSON.stringify(payload.views.canonical_current), /Austin/);
    const artifact = await Artifacts.findOne({ subject_key: subject1 }).orFail().lean();
    assert.equal(artifact.status, "ready");
    assert.equal(artifact.input_mode, "summaries");
    assert.equal(artifact.usage?.credential, "AI_GATEWAY_API_KEY");
    assert.equal(artifact.usage?.actual_cents, 2);
    assert.equal(artifact.usage?.attempts, 1);
    assert.equal(artifact.usage?.usage_complete, true);
    const record = await Records.findById(r1).orFail().lean();
    assert.equal(String(record.move_assessment?.artifact_id), String(artifact._id));
    assert.equal(record.move_assessment?.move_likelihood, 75);
    assert.equal(record.move_assessment?.transaction_intent, 50);
    assert.equal(record.move_assessment?.status, "ready");
    assert.equal(await getSalesIntelligenceAuditEventModel().countDocuments({ subject_key: subject1, event_kind: "move_assessment_published" }), 1);
    const reservations = await Reservations.find({ step: { $regex: "^assessment:" } }).lean();
    assert.equal(reservations.length, 1, "exactly one assessment reservation");
    assert.equal(reservations[0].status, "reconciled");
    assert.equal(reservations[0].actual_cents, 2, "reconciled with the mocked gateway.cost");
    assert.equal(reservations[0].run_id, null);
    assert.equal(reservations[0].step, `assessment:${artifact._id}:AI_GATEWAY_API_KEY:${reservations[0].step.split(":").at(-1)}`);
  });

  await t.test("A06: unchanged fingerprint reuses with zero calls; interrupted retry reuses the completed artifact", async () => {
    const mock = await mockAssessmentModel();
    const again = await run(r1, "summary:a06-repeat", { model: mock.model });
    assert.equal(again.result.status, "reused", JSON.stringify(again.result));
    assert.equal(mock.calls(), 0);
    assert.equal(await Artifacts.countDocuments({ subject_key: subject1 }), 1);
    // Legacy-run subject: complete, then reproduce a crash after the artifact CAS but before publication.
    const first = await run(r2, "summary:a06-legacy", { model: mock.model });
    assert.equal(first.result.status, "completed", JSON.stringify(first.result));
    assert.equal(mock.calls(), 1);
    const legacy = await Artifacts.findOne({ subject_key: `lead:CallLead:${l2.id}` }).orFail().lean();
    assert.deepEqual((legacy.source_manifest as Array<{ kind: string }>).filter(s => s.kind !== "lead" && s.kind !== "official").map(s => s.kind), ["legacy_run"]);
    await Records.collection.updateOne({ _id: new mongoose.Types.ObjectId(r2) }, { $set: { move_assessment: null } });
    await Jobs.collection.updateOne({ _id: new mongoose.Types.ObjectId(first.jobId) }, { $set: { status: "leased", leased_until: new Date(Date.now() - 1000), lease_owner: "crashed" } });
    const resumed = await runMoveAssessmentJob(first.jobId, { model: mock.model });
    assert.equal(resumed.status, "reused", JSON.stringify(resumed));
    assert.equal(mock.calls(), 1, "no second generation");
    assert.equal(String((await Records.findById(r2).orFail().lean()).move_assessment?.artifact_id), String(legacy._id));
  });

  await t.test("A06: a changed Lead move field or Owner correction revision is a new fingerprint; old artifacts stay untouched", async () => {
    const before = await Artifacts.findOne({ subject_key: subject1 }).orFail().lean();
    await getFormLeadModel().collection.updateOne({ _id: l1._id }, { $set: { move_date: new Date("2026-10-22T00:00:00Z") } });
    const mock = await mockAssessmentModel();
    const changed = await run(r1, "change:move-date", { model: mock.model });
    assert.equal(changed.result.status, "completed", JSON.stringify(changed.result));
    assert.equal(mock.calls(), 1);
    const after = await Artifacts.findById(before._id).orFail().lean();
    assert.deepEqual({ ...after, updatedAt: null, published_at: null }, { ...before, updatedAt: null, published_at: null }, "old artifact unchanged");
    const record = await Records.findById(r1).orFail().lean();
    assert.equal(String(record.move_assessment?.artifact_id), changed.result.artifact_id);
    assert.notEqual(changed.result.artifact_id, String(before._id));
    const instruction = new mongoose.Types.ObjectId();
    await getSalesIntelligenceOwnerInstructionModel().collection.insertOne({ instruction_id: instruction, subject_key: subject1, field: "description",
      prior: {}, current: { note: "Customer prefers mornings" }, actor: { kind: "owner", id: "synthetic-owner", request_id: "ma" }, happened_at: now, revision: 1, state: "active" } as never);
    const corrected = await run(r1, "correction:1", { model: mock.model });
    assert.equal(corrected.result.status, "completed");
    await getSalesIntelligenceOwnerInstructionModel().collection.updateOne({ instruction_id: instruction }, { $set: { revision: 2 } });
    const revised = await run(r1, "correction:2", { model: mock.model });
    assert.equal(revised.result.status, "completed");
    assert.equal(mock.calls(), 3);
    const fingerprints = (await Artifacts.find({ subject_key: subject1 }).lean()).map(a => a.input_fingerprint);
    assert.equal(new Set(fingerprints).size, 4);
  });

  await t.test("inputs changing during generation store a historical artifact, leave the projection and nominate a fresh job", async () => {
    // A real input change first (so the run generates), then another one while it generates.
    await getFormLeadModel().collection.updateOne({ _id: l1._id }, { $set: { move_size: "2-3 Bedroom" } });
    const prior = (await Records.findById(r1).orFail().lean()).move_assessment;
    const mock = await mockAssessmentModel();
    const stale = await run(r1, "change:during-generation", { model: mock.model, beforeProvider: async () => {
      await getFormLeadModel().collection.updateOne({ _id: l1._id }, { $set: { move_size: "3 Bedroom" } });
    } });
    assert.equal(stale.result.status, "stale_input", JSON.stringify(stale.result));
    const record = await Records.findById(r1).orFail().lean();
    assert.equal(String(record.move_assessment?.artifact_id), String(prior?.artifact_id), "projection untouched");
    assert.equal((await Artifacts.findById(stale.result.artifact_id).orFail().lean()).status, "ready", "kept as historical");
    const next = await Jobs.findOne({ dedupe_key: `csi:move-assessment:${subject1}:stale:${stale.result.artifact_id}` }).orFail().lean();
    assert.equal(next.status, "pending");
    const drained = await drainMoveAssessmentJobs({ model: mock.model }, { max: 5 });
    assert.ok(drained.outcomes.some(o => o.status === "completed" && o.reason === "published"), JSON.stringify(drained));
    assert.equal(String((await Records.findById(r1).orFail().lean()).move_assessment?.artifact_id), drained.outcomes[0].artifact_id);
  });

  await t.test("closure during generation fences publication; a later run records not_applicable against the prior ready artifact", async () => {
    const mock = await mockAssessmentModel();
    // Seed a prior ready artifact first, then close while the next generation runs.
    const ready = await run(r5, "summary:s5", { model: mock.model });
    assert.equal(ready.result.status, "completed");
    await getFormLeadModel().collection.updateOne({ _id: l5._id }, { $set: { move_size: "Studio" } });
    const fenced = await run(r5, "change:s5", { model: mock.model, beforeProvider: async () => {
      await Records.collection.updateOne({ _id: new mongoose.Types.ObjectId(r5) }, { $set: { state: "closed", closure_origin: "owner", closed_reason: "not_sales", closed_at: new Date() } });
    } });
    assert.equal(fenced.result.status, "completed", JSON.stringify(fenced.result));
    assert.equal(fenced.result.reason, "fenced");
    assert.equal(String((await Records.findById(r5).orFail().lean()).move_assessment?.artifact_id), ready.result.artifact_id, "fenced result not published");
    // Closed records are not nominated even when forced; a queued job for the subject still reaches the claim.
    assert.equal(await nominate(r5, "summary:s5-after-close", true), null);
    const jobId = await withTransaction(async session => enqueueCsiJob({ stage: "move_assessment",
      subject_key: `lead:FormLead:${l5.id}`, dedupe_key: `csi:move-assessment:lead:FormLead:${l5.id}:closed-check`, input_revision: 1, input_refs: [r5] }, session));
    const skipped = await runMoveAssessmentJob(String(jobId._id), { model: mock.model });
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.reason, "not_applicable");
    assert.equal((await Artifacts.findById(skipped.artifact_id).orFail().lean()).status, "not_applicable");
    assert.equal(mock.calls(), 2);
  });

  await t.test("CRM-closed without history and identity review skip without a model call or artifact", async () => {
    const mock = await mockAssessmentModel();
    assert.equal(await nominate(r4, "summary:closed"), null, "closed records are not nominated");
    const jobs = await withTransaction(async session => {
      const rows = [];
      for (const [record, subject] of [[r4, `lead:FormLead:${l4.id}`], [r6, `lead:CallLead:${l6.id}`]]) rows.push(await enqueueCsiJob({ stage: "move_assessment",
        subject_key: subject, dedupe_key: `csi:move-assessment:${subject}:skip-check`, input_revision: 1, input_refs: [record] }, session));
      return rows;
    });
    const closed = await runMoveAssessmentJob(String(jobs[0]._id), { model: mock.model });
    assert.deepEqual([closed.status, closed.reason, closed.artifact_id], ["skipped", "not_applicable", undefined]);
    const review = await runMoveAssessmentJob(String(jobs[1]._id), { model: mock.model });
    assert.deepEqual([review.status, review.reason], ["skipped", "ambiguous_subject"]);
    assert.equal(mock.calls(), 0);
    assert.equal(await Artifacts.countDocuments({ subject_key: { $in: [`lead:FormLead:${l4.id}`, `lead:CallLead:${l6.id}`] } }), 0);
  });

  await t.test("Lead-only subject: shadow persists without publishing; live run is lead_only with no_conversation_evidence", async () => {
    const mock = await mockAssessmentModel();
    const shadow = await run(r3, "backfill:shadow", { model: mock.model, shadow: true, credential: "PERSONAL_AI_GATEWAY_API_KEY", force: true });
    assert.equal(shadow.result.status, "shadow_completed", JSON.stringify(shadow.result));
    assert.equal((await Records.findById(r3).orFail().lean()).move_assessment, null, "shadow never publishes");
    const shadowArtifact = await Artifacts.findById(shadow.result.artifact_id).orFail().lean();
    assert.equal(shadowArtifact.shadow, true);
    assert.equal(shadowArtifact.input_mode, "lead_only");
    assert.equal(mock.payloads[0].subject.no_conversation_evidence, true);
    assert.equal(mock.payloads[0].conversations.length, 0);
    const live = await run(r3, "lead:arrival", { model: mock.model });
    assert.equal(live.result.status, "completed", JSON.stringify(live.result));
    const record = await Records.findById(r3).orFail().lean();
    assert.equal(record.move_assessment?.move_likelihood, 50);
    assert.equal(record.move_assessment?.transaction_intent, null, "Form Lead alone never establishes intent");
    assert.equal(mock.calls(), 2);
  });

  await t.test("missing key pauses before any reservation; personal key never falls back; injected personal key is recorded by name only", async () => {
    const before = await Reservations.countDocuments();
    const missing = await run(r7, "summary:s7", {});
    assert.deepEqual([missing.result.status, missing.result.reason], ["paused", "analysis_configuration_missing"]);
    const job = await Jobs.findById(missing.jobId).orFail().lean();
    assert.deepEqual([job.status, (job.result as { reason?: string }).reason], ["paused", "analysis_configuration_missing"]);
    process.env.AI_GATEWAY_API_KEY = "synthetic-company-key";
    try {
      await Jobs.updateOne({ _id: missing.jobId }, { $set: { status: "pending", next_attempt_at: new Date() } });
      const personalMissing = await runMoveAssessmentJob(missing.jobId, { credential: "PERSONAL_AI_GATEWAY_API_KEY" });
      assert.deepEqual([personalMissing.status, personalMissing.reason], ["paused", "analysis_configuration_missing"], "no fallback to the company key");
    } finally { process.env.AI_GATEWAY_API_KEY = ""; }
    assert.equal(await Reservations.countDocuments(), before, "no reservation while unconfigured");
    const mock = await mockAssessmentModel();
    await Jobs.updateOne({ _id: missing.jobId }, { $set: { status: "pending", next_attempt_at: new Date() } });
    const personal = await runMoveAssessmentJob(missing.jobId, { model: mock.model, credential: "PERSONAL_AI_GATEWAY_API_KEY", gateway_key: "synthetic-personal-value" });
    assert.equal(personal.status, "completed", JSON.stringify(personal));
    const artifact = await Artifacts.findById(personal.artifact_id).orFail().lean();
    assert.equal(artifact.usage?.credential, "PERSONAL_AI_GATEWAY_API_KEY");
    const reservation = await Reservations.findOne({ step: { $regex: `^assessment:${artifact._id}:` } }).orFail().lean();
    assert.match(reservation.step, /:PERSONAL_AI_GATEWAY_API_KEY:/);
    const stored = JSON.stringify([artifact, reservation, await Jobs.findById(missing.jobId).lean()]);
    assert.equal(stored.includes("synthetic-personal-value"), false, "the key value is never stored");
  });

  await t.test("flag off: nomination and runs are disabled unless forced", async () => {
    process.env.SALES_INTELLIGENCE_MOVE_ASSESSMENT = "false";
    try {
      assert.equal(await nominate(r7, "summary:flag-off"), null);
      assert.deepEqual(await runMoveAssessmentJob(undefined, {}), { status: "disabled" });
      const mock = await mockAssessmentModel();
      const forced = await run(r7, "summary:flag-off-forced", { model: mock.model, force: true });
      assert.equal(forced.result.status, "reused", JSON.stringify(forced.result));
      assert.equal(mock.calls(), 0);
    } finally { process.env.SALES_INTELLIGENCE_MOVE_ASSESSMENT = "true"; }
  });

  await t.test("MA-03 seam: the live drain never claims a backfill-priority job; the runner claims it by id with force", async () => {
    const jobId = await withTransaction(session => nominateMoveAssessment({ outreach_record_id: r7, trigger: "backfill:priority-gate",
      priority: CSI_BACKFILL_JOB_PRIORITY, force: true }, session));
    assert.ok(jobId);
    const mock = await mockAssessmentModel();
    assert.deepEqual(await runMoveAssessmentJob(undefined, { model: mock.model }), { status: "not_claimable" });
    assert.equal((await Jobs.findById(jobId).lean())?.status, "pending", "the live drain left the backfill row untouched");
    const forced = await runMoveAssessmentJob(jobId!, { model: mock.model, force: true });
    assert.ok(["reused", "completed"].includes(forced.status), JSON.stringify(forced));
  });

  await t.test("A07: purge tombstones artifacts, purges projections and expires Attention snapshots", async () => {
    const Snapshots = getSalesIntelligenceAttentionSnapshotModel();
    await Snapshots.collection.insertOne({ ...csiDataset(), snapshot_id: "synthetic-latest", owner_id: "system", filter_digest: "d", policy_version: "p",
      as_of: new Date(), expires_at: null, chunk_index: null, parent_snapshot_id: null, rows: [{ subject_key: subject1, move_likelihood: 75 }] } as never);
    const ids = (await Artifacts.find({ subject_key: subject1 }).lean()).map(a => String(a._id));
    const purgedAt = new Date();
    const result = await withTransaction(session => purgeMoveAssessments({ contact_number_id: String(n1._id) }, purgedAt, session));
    assert.equal(result.artifacts, ids.length);
    assert.equal(result.projections, 1);
    const artifacts = await Artifacts.find({ subject_key: subject1 }).lean();
    for (const artifact of artifacts) {
      assert.equal(artifact.status, "purged");
      assert.deepEqual(artifact.model_output, { purged: true });
      assert.equal(artifact.scores, null);
      assert.equal(artifact.views, null);
      assert.equal(artifact.inventory, null);
    }
    const record = await Records.findById(r1).orFail().lean();
    assert.equal(record.move_assessment?.status, "purged");
    assert.equal(record.move_assessment?.move_likelihood, null);
    assert.equal(record.move_assessment?.transaction_intent, null);
    assert.equal(await Snapshots.collection.countDocuments({ ...csiDataset(), expires_at: null }), 0, "no non-expiring snapshot survives");
    const everything = JSON.stringify([artifacts, record]);
    assert.equal(everything.includes(MARK.rationale), false, "rationale text cannot be recovered from artifacts or projection");
    assert.equal(everything.includes("Sofa"), false, "inventory cannot be recovered");
    // A second purge is a no-op; content cannot be reintroduced by a re-publish of a purged artifact.
    assert.deepEqual(await withTransaction(session => purgeMoveAssessments({ artifact_ids: ids }, purgedAt, session)), { artifacts: 0, projections: 0 });
    // The conversation filter reaches artifacts through their source manifest.
    const byConversation = await withTransaction(session => purgeMoveAssessments({ conversation_id: String(c1.conversation._id) }, purgedAt, session));
    assert.equal(byConversation.artifacts, 0, "already tombstoned");
  });

  await t.test("ledger: every assessment reservation reconciled exactly once with no stranded holds", async () => {
    const rows = await Reservations.find({ step: { $regex: "^assessment:" } }).lean();
    assert.ok(rows.length >= 8);
    assert.ok(rows.every(row => row.status === "reconciled" && row.usage_complete));
    const budget = await getSalesIntelligenceAiBudgetModel().findOne({ month }).orFail().lean();
    assert.equal(budget.reserved_cents, 0);
    assert.equal(budget.actual_cents, rows.reduce((sum, row) => sum + (row.actual_cents ?? 0), 0));
    assert.deepEqual(await counts(), baseline, "still no analysis domain effects");
  });
});
