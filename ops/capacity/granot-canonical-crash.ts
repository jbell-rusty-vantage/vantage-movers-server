import assert from "node:assert/strict";
import { ObjectId, type Db, type Document } from "mongodb";
import { runGranotWorker } from "../../src/services/granotHttpCollector/runWorkflow";
import { applyOpenAutomationPlanAction, type GranotAutomationActionReceipt } from "../../src/services/granotLifecycle/automationApply";
import { traceGranotAction } from "../vantage/granot-trace";

/** Fault injection is limited to the generated local run's lease. The first and second workers use real lifecycle effects. */
export async function proveCanonicalCrash(db: Db, sealed: Document, leadId: ObjectId) {
  const runId = String(sealed._id);
  const action = sealed.plan_snapshot.actions[0];
  const runs = db.collection("granot_automation_runs");
  const leadFilter = { _id: leadId };
  const loadLead = () => db.collection("form_leads").findOne(leadFilter);
  await runs.updateOne({ _id: sealed._id }, { $set: { leased_until: new Date(0) } });
  const approved = await runs.findOne({ _id: sealed._id });
  const originalLead = await loadLead();
  assert.ok(approved && originalLead);
  let firstEffect: GranotAutomationActionReceipt | undefined;
  await assert.rejects(runGranotWorker({ applyAction: async input => {
    assert.equal(input.lifecycle_apply.operation_id, action.lifecycle_apply.operation_id);
    firstEffect = await applyOpenAutomationPlanAction(input);
    assert.equal(firstEffect.outcome, "applied");
    const lost = await runs.updateOne({ _id: sealed._id, status: "applying", lease_owner: { $type: "string" } },
      { $inc: { lease_epoch: 1 }, $set: { leased_until: new Date(0) } });
    assert.equal(lost.modifiedCount, 1);
    return firstEffect;
  } }), /fenced lease/);
  assert.ok(firstEffect);
  const interrupted = await runs.findOne({ _id: sealed._id });
  assert.equal(interrupted?.status, "applying");
  assert.equal(interrupted?.receipts.length, 0);
  const changed = await loadLead();
  assert.ok(changed);
  assert.equal(changed.domain_revision, originalLead.domain_revision + 1);
  assert.equal(changed.granot_priority, "1");
  assert.equal(String(changed.last_accepted_granot_observation.observation_id), firstEffect.observation_id);
  const receipts = db.collection("granot_webhook_receipts");
  const receiptFilter = { observation_channel: "granot_http_automation", channel_operation_id: action.lifecycle_apply.operation_id };
  const receipt = await receipts.findOne(receiptFilter);
  assert.ok(receipt);
  assert.equal(String(receipt._id), firstEffect.lifecycle_receipt_id);
  assert.equal(receipt.processing.state, "completed");
  assert.equal(String(receipt.processing.latest_decision_id), firstEffect.decision_id);
  const decisionId = new ObjectId(firstEffect.decision_id!);
  const changes = db.collection("entity_changes");
  const provenance = { "provenance.decision_id": decisionId };
  const change = await changes.findOne(provenance);
  assert.ok(change);
  const commands = db.collection("domain_command_executions");
  const before = { commands: await commands.countDocuments(), changes: await changes.countDocuments(), sheet: await db.collection("sheet_sync_jobs").countDocuments() };
  const result = await runGranotWorker();
  assert.equal(result.status, "completed");
  assert.equal(result.run_id, runId);
  const final = await runs.findOne({ _id: sealed._id });
  assert.ok(final);
  assert.equal(final.receipts.length, 1);
  const recorded = final.receipts[0];
  assert.deepEqual([recorded.action_id, recorded.lifecycle_receipt_id, recorded.observation_id, recorded.decision_id, recorded.outcome],
    [firstEffect.action_id, firstEffect.lifecycle_receipt_id, firstEffect.observation_id, firstEffect.decision_id, firstEffect.outcome]);
  assert.equal(recorded.outreach_refresh_completed, true);
  assert.deepEqual([final.plan_snapshot, final.approval, final.plan_checksum, final.expires_at, final.purge_at],
    [sealed.plan_snapshot, approved.approval, sealed.plan_checksum, sealed.expires_at, sealed.purge_at]);
  assert.equal(await receipts.countDocuments(receiptFilter), 1);
  assert.equal(await db.collection("granot_observations").countDocuments({ receipt_id: receipt._id }), 1);
  assert.equal(await db.collection("synchronization_decisions").countDocuments({ observation_id: new ObjectId(firstEffect.observation_id!) }), 1);
  assert.equal(await changes.countDocuments(provenance), 1);
  assert.ok(await commands.findOne({ _id: change.command_execution_id, command_name: "synchronizeLeadFromGranot" }));
  assert.deepEqual({ commands: await commands.countDocuments(), changes: await changes.countDocuments(),
    sheet: await db.collection("sheet_sync_jobs").countDocuments() }, before);
  assert.deepEqual(await loadLead(), changed);
  const trace = await traceGranotAction(db, runId, action.action_id);
  assert.equal(trace.status, "traced", trace.stop);
  assert.equal(trace.lead?.observation_vs_current_winner, "same");
  return { runId, checksum: final.plan_checksum, operationId: action.lifecycle_apply.operation_id,
    receiptId: firstEffect.lifecycle_receipt_id, observationId: firstEffect.observation_id, decisionId: firstEffect.decision_id,
    commandId: String(change.command_execution_id), changeId: String(change._id), revisionBefore: originalLead.domain_revision, revisionAfter: changed.domain_revision,
    embeddedReceiptsAtFault: interrupted.receipts.length, embeddedReceiptsAfter: final.receipts.length,
    trace: trace.stop, unchangedApprovalAndDates: true, repeatedCanonicalEffects: 0 };
}
