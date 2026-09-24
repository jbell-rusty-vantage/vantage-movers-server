/**
 * Team 4 AC6-PLAN replica proofs (Attention evolution spec §8.1), run by `pnpm test:csi:move-assessment:replica`
 * after the MA-02 suite, in its own database `testvantagemovers_t4c<hex>`. The model is mocked; every
 * network call is refused.
 *
 * K30 (SALES_INTELLIGENCE_PROGRESS_PLAN on): one nomination per disposition revision; none without a
 * summarized conversation; none while a specific open action exists; the re-plan's engagement
 * supersedes the default (K26 through a real assessment job); a reused artifact still re-applies its
 * engagement (`publicationDecision` → `current_replan`). K31 (flag off): no nomination, no job row.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
process.env.SALES_INTELLIGENCE_PROGRESS_PLAN = "true";
process.env.SALES_INTELLIGENCE_ATTENTION_EVOLUTION = "true";
process.env.SALES_INTELLIGENCE_LEAD_PROGRESS = "true";
import { connectMongo, withTransaction } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { applyCsiMigration } from "../migrations/sales-intelligence.lib";
import { getFormLeadModel } from "../../src/models/FormLead";
import { getEntityChangeModel } from "../../src/models/EntityChange";
import { getOutreachRecordModel } from "../../src/models/OutreachRecord";
import { getOutreachFollowupModel } from "../../src/models/OutreachFollowup";
import { getMoveAssessmentArtifactModel } from "../../src/models/MoveAssessmentArtifact";
import { getSalesIntelligenceJobModel } from "../../src/models/SalesIntelligenceJob";
import { initializeCsiBudgetPeriod } from "../../src/services/salesIntelligence/aiBudget";
import { ensureLead, workerContext } from "../../src/services/salesIntelligence/outreach/ensure";
import { dispositionRevision } from "../../src/services/salesIntelligence/outreach/leadProgress";
import { nominateMoveAssessment, runMoveAssessmentJob } from "../../src/services/salesIntelligence/assessment/runtime";
import type { AssessmentPromptPayload } from "../../src/services/salesIntelligence/assessment/context";
import { defaultAssessment, mockAssessmentModel, seedLead, seedNumber, seedRecord, seedSummaryConversation } from "./csi-move-assessment-fixtures";

test("Team 4 AC6-PLAN progress re-plan replica (mocked model)", { skip: process.env.CSI_REPLICA_TEST !== "true", timeout: 300_000 }, async t => {
  assert.match(getMongoDatabaseName(), /^testvantagemovers_t4c[a-z0-9]+$/);
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27189/?replicaSet=csi01");
  assert.equal(process.env.AI_GATEWAY_API_KEY, "", "no provider credential in the proof");
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db!;
  t.after(async () => { await db.dropDatabase(); await mongoose.disconnect(); });
  assert.equal((await db.admin().command({ hello: 1 })).setName, "csi01");
  assert.equal((await applyCsiMigration()).ready, true);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External traffic forbidden in the progress re-plan replica proof"); });
  const now = new Date(), month = now.toISOString().slice(0, 7);
  await initializeCsiBudgetPeriod({ month, policy_version: "csi-policy-v1", timezone: "UTC", ceiling_cents: 8000,
    period_start: new Date(`${month}-01T00:00:00Z`), period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });
  const Records = getOutreachRecordModel(), Actions = getOutreachFollowupModel(), Jobs = getSalesIntelligenceJobModel(), Artifacts = getMoveAssessmentArtifactModel();
  const oid = () => new mongoose.Types.ObjectId();
  let revision = 0;
  async function subject(options: { conversation?: boolean } = {}) {
    const n = await seedNumber();
    const lead = await seedLead("FormLead", n.national_ten!, { pickup_city: "Miami", pickup_state: "FL", delivery_city: "Austin", delivery_state: "TX", move_size: "2 Bedroom" });
    const recordId = await seedRecord(lead, String(n._id));
    if (options.conversation !== false) await seedSummaryConversation(String(n._id), new Date(Date.now() - 2 * 86_400_000),
      { overview: "Customer wants a two-bedroom move to Austin.", outcome: "Rep will send the estimate." }, [{ claim: "We are moving in October" }]);
    return { n, lead, recordId, key: `lead:FormLead:${lead.id}` };
  }
  async function quote(lead: { id: string; _id: mongoose.Types.ObjectId }) {
    await getFormLeadModel().collection.updateOne({ _id: lead._id }, { $set: { granot_priority: "1", domain_revision: ++revision } });
    const change = await getEntityChangeModel().collection.insertOne({ entity: { model: "FormLead", id: lead.id }, command_execution_id: oid(), command_name: "synchronizeLeadFromGranot",
      provenance: { source_system: "granot", actor: { actor_type: "system", actor_id: "test" }, initiator: { actor_type: "system", actor_id: "test" }, request_id: String(oid()), observation_id: oid(), decision_id: oid() },
      changed_paths: ["granot_priority"], fields: [{ path: "granot_priority", value_mode: "stored", before: null, after: "1" }], revision_before: revision - 1, revision_after: revision, applied_at: new Date() } as never);
    const changeId = String(change.insertedId);
    await withTransaction(s => ensureLead({ model: "FormLead", id: lead.id }, workerContext(s, String(oid())), undefined, { changeId }));
    return changeId;
  }
  const progressKey = (key: string) => `csi:move-assessment:${key}:progress:${dispositionRevision("1")}`;
  const assessmentJobs = (key: string) => Jobs.countDocuments({ stage: "move_assessment", subject_key: key });
  /** The mocked model plans one rep step from the newest conversation (what supersedes the default). */
  const withStep = (payload: AssessmentPromptPayload) => {
    const base = defaultAssessment(payload), last = payload.conversations.at(-1)!.entries.at(-1)!.id;
    return { ...base, engagement: { work_status: "worked_with_next_step", rationale: "Rep agreed to send the estimate.", evidence_ids: [last], promised_callbacks: [],
      next_steps: [{ action: "send_estimate", owner: "rep", description: "Send the written estimate", date: null, date_text: "tomorrow", status: "planned", evidence_ids: [last] }] } };
  };
  const quiet = { onError: (error: unknown) => { if (!(error instanceof Error && /Synthetic|FEATURE_DISABLED/.test(error.message))) console.error(error); } };

  await t.test("K30 one nomination per disposition revision; the re-plan's engagement supersedes the default (K26, real job, mocked model)", async () => {
    const s = await subject();
    const changeId = await quote(s.lead);
    const job = await Jobs.findOne({ dedupe_key: progressKey(s.key) }).lean();
    assert.ok(job, "progress:<disposition_revision> nomination");
    assert.equal(await assessmentJobs(s.key), 1);
    const [initialDefault] = await Actions.find({ outreach_record_id: s.recordId, default_kind: "quote_followup" }).lean();
    assert.equal(initialDefault?.status, "open");
    // Re-delivery of the same change, and the nomination itself again: still one job.
    await withTransaction(x => ensureLead({ model: "FormLead", id: s.lead.id }, workerContext(x, String(oid())), undefined, { changeId }));
    assert.equal(String(await withTransaction(x => nominateMoveAssessment({ outreach_record_id: s.recordId, trigger: `progress:${dispositionRevision("1")}`, force: true }, x))), String(job!._id));
    assert.equal(await assessmentJobs(s.key), 1);
    const mock = await mockAssessmentModel(withStep);
    const result = await runMoveAssessmentJob(String(job!._id), { model: mock.model, ...quiet });
    assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(result.reason, "published"); assert.equal(mock.calls(), 1);
    const actions = await Actions.find({ outreach_record_id: s.recordId }).sort({ _id: 1 }).lean();
    const superseded = actions.find(a => a.default_kind === "quote_followup")!;
    assert.equal(superseded.status, "superseded"); assert.equal(superseded.cancel_reason, "superseded_by_specific_plan");
    const planned = actions.find(a => a.commitment_key.startsWith("assessment:"))!;
    assert.equal(planned.kind, "send_estimate"); assert.equal(planned.status, "open");
  });

  await t.test("K30 no nomination without a summarized conversation, or while a specific open action exists", async () => {
    const bare = await subject({ conversation: false });
    await quote(bare.lead);
    assert.equal(await assessmentJobs(bare.key), 0, "no transcript/summary: no job");
    assert.equal(await Actions.countDocuments({ outreach_record_id: bare.recordId, default_kind: "quote_followup" }), 1, "the default is still created");
    const busy = await subject();
    await Actions.create({ outreach_record_id: busy.recordId, commitment_key: `t4c:${oid()}`, kind: "check_availability", description: "Check the crew for October", origin: "rep_promise",
      date_resolution: { precision: "unresolved", timezone: "America/New_York", anchor: new Date(), policy_version: "csi-policy-v1" } });
    await quote(busy.lead);
    assert.equal(await assessmentJobs(busy.key), 0, "an open specific action: no re-plan");
  });

  await t.test("§8.1 a progress re-plan that reuses the artifact still re-applies engagement (publicationDecision current_replan), with no model call", async () => {
    const s = await subject();
    const first = await mockAssessmentModel();
    const initial = await withTransaction(x => nominateMoveAssessment({ outreach_record_id: s.recordId, trigger: "summary:t4c", force: true }, x));
    const published = await runMoveAssessmentJob(initial!, { model: first.model, ...quiet });
    assert.equal(published.reason, "published", JSON.stringify(published));
    const before = await Artifacts.findById(published.artifact_id).lean().orFail();
    await quote(s.lead);
    const job = await Jobs.findOne({ dedupe_key: progressKey(s.key) }).lean().orFail();
    const second = await mockAssessmentModel();
    const reused = await runMoveAssessmentJob(String(job._id), { model: second.model, ...quiet });
    assert.equal(reused.status, "reused", JSON.stringify(reused)); assert.equal(reused.reason, "current_replan"); assert.equal(second.calls(), 0, "no model call");
    assert.equal(reused.artifact_id, published.artifact_id);
    const after = await Artifacts.findById(published.artifact_id).lean().orFail();
    const appliedAt = (value: unknown) => (value as { applied_at?: string } | null)?.applied_at;
    assert.notEqual(appliedAt(after.engagement_effects), appliedAt(before.engagement_effects), "engagement re-applied against the current record");
    const completed = await Jobs.findById(job._id).lean().orFail();
    assert.equal((completed.result as { reason?: string } | null)?.reason, "reused_current_replan");
  });

  await t.test("K31 SALES_INTELLIGENCE_PROGRESS_PLAN off: no nomination and no job row", async () => {
    process.env.SALES_INTELLIGENCE_PROGRESS_PLAN = "false";
    try {
      const s = await subject();
      const jobsBefore = await Jobs.countDocuments();
      await quote(s.lead);
      assert.equal(await assessmentJobs(s.key), 0);
      assert.equal(await Jobs.countDocuments(), jobsBefore, "no job row at all");
      assert.equal(await Actions.countDocuments({ outreach_record_id: s.recordId, default_kind: "quote_followup" }), 1, "P4 (ATTENTION_EVOLUTION) is independent of the re-plan flag");
    } finally { process.env.SALES_INTELLIGENCE_PROGRESS_PLAN = "true"; }
  });
  void Records;
});
