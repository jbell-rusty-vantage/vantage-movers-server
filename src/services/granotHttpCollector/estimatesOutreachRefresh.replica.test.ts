import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../db";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { getSalesOutreachSubjectModel } from "../../models/salesOutreach";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { refreshExistingEstimatesOutreach } from "./estimatesOutreachRefresh";
import type { GranotAutomationActionReceipt } from "../granotLifecycle/automationApply";

after(async () => { await mongoose.disconnect(); });

test("replica: actual canonical decision target and existing open subject enqueue exactly one durable refresh", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") { t.skip("Local replica proof is opt-in."); return; }
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(process.env.MONGO_URI ?? "", /^mongodb:\/\/127\.0\.0\.1:/);
  await connectMongo();
  assert.match(mongoose.connection.db!.databaseName, /^testvantagemovers(?:_[a-z0-9_]+)?$/);
  const Decision = getSynchronizationDecisionModel(), Subject = getSalesOutreachSubjectModel(), Jobs = getSalesIntelligenceJobModel();
  await Jobs.createIndexes();
  const leadId = new mongoose.Types.ObjectId(), subjectId = new mongoose.Types.ObjectId(), decisionId = new mongoose.Types.ObjectId(), receiptId = new mongoose.Types.ObjectId();
  const receipt: GranotAutomationActionReceipt = { action_id: "synthetic-refresh", lifecycle_receipt_id: String(receiptId), decision_id: String(decisionId), outcome: "already_current", applied_at: new Date() };
  const key = `sod:lead-change:CallLead:${leadId}:estimates-refresh:${receiptId}`;
  try {
    await Decision.create({ _id: decisionId, observation_id: new mongoose.Types.ObjectId(), attempt: 1, execution_mode: "live", outcome: "already_current", reason_code: "desired_state_already_current", target: { model: "CallLead", id: String(leadId) }, candidates: [], evaluated_gates: [], effects: [], decided_at: new Date() });
    assert.equal(await refreshExistingEstimatesOutreach(receipt), "skipped", "an unknown Lead cannot enroll");
    await Subject.collection.insertOne({ _id: subjectId, lead_model: "CallLead", lead_id: leadId, status: "active" } as never);
    assert.equal(await refreshExistingEstimatesOutreach(receipt), "enqueued");
    assert.equal(await refreshExistingEstimatesOutreach(receipt), "enqueued");
    assert.equal(await Jobs.countDocuments({ dedupe_key: key }), 1, "receipt replay uses insert-only job dedupe");
    const job = await Jobs.findOne({ dedupe_key: key }).lean();
    assert.equal(job?.stage, "outreach_lead_change");
    assert.deepEqual(job?.input_refs.map(String), [String(leadId)]);
    await Subject.collection.updateOne({ _id: subjectId }, { $set: { status: "closed" } });
    assert.equal(await refreshExistingEstimatesOutreach(receipt), "skipped", "a closed subject cannot be nominated");
    assert.equal(await Jobs.countDocuments({ dedupe_key: key }), 1);
  } finally {
    await Jobs.deleteMany({ dedupe_key: key });
    await Subject.deleteOne({ _id: subjectId });
    await Decision.collection.deleteOne({ _id: decisionId });
  }
});
