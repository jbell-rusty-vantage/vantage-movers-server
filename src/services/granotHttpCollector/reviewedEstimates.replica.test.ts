import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../db";
import { GranotAutomationRun } from "../../models/GranotAutomationRun";
import { computeChecksum, type DurableActor } from "../durableWork";
import { applyReviewedEstimatesRun, approveGranotRun, createGranotRun, scheduledEstimatesRunId } from "./runWorkflow";

const actor: DurableActor = { actor_type: "owner", actor_id: "reviewed-estimates-test", actor_role: "owner", actor_label: "Synthetic Owner", request_id: "reviewed-test", origin: "vantage_admin" };
after(async () => { await mongoose.disconnect(); });

test("replica: cron concurrency reuses one run; reviewed selection preserves the sealed plan and ordinary gates", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") { t.skip("Local replica proof is opt-in."); return; }
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(process.env.MONGO_URI ?? "", /^mongodb:\/\/127\.0\.0\.1:/);
  await connectMongo();
  assert.equal(mongoose.connection.db?.databaseName, "testvantagemovers");
  const slot = `synthetic:${new mongoose.Types.ObjectId()}`;
  const request = { operation: "estimates_in_process" as const, workflow: "apply" as const, dateWindow: { from: "07/16/2026", to: "10/13/2026" }, sourceLabels: [], initiator: actor, autoApply: true, scheduledSlotKey: slot };
  const id = scheduledEstimatesRunId(slot);
  const results = await Promise.all(Array.from({ length: 4 }, () => createGranotRun(request)));
  assert.ok(results.every((r) => r.run_id === String(id)));
  assert.equal(await GranotAutomationRun.countDocuments({ _id: id }), 1);
  await GranotAutomationRun.updateOne({ _id: id }, { $set: { status: "completed", plan_checksum: "a".repeat(64) } });
  await createGranotRun(request);
  assert.equal((await GranotAutomationRun.findById(id))?.status, "completed");

  const previewId = new mongoose.Types.ObjectId();
  const action = (action_id: string, classification: string) => ({ action_id, classification, lifecycle_apply: { operation_id: `${previewId}:${action_id}`, operation_kind: "lead_snapshot_apply", granot_statement: { job_no: "SYNTHETIC-100", priority: "0" } } });
  const plan = { kind: "estimates_in_process", schema_version: 2, actions: [action("selected", "update"), action("unselected", "update"), action("conflict", "conflict")], counters: { update: 2, conflict: 1 } };
  const checksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 1, payload: plan });
  await GranotAutomationRun.create({ _id: previewId, operation: "estimates_in_process", workflow: "preview", status: "completed", request_snapshot: { dateWindow: request.dateWindow }, initiator: actor, plan_snapshot: plan, plan_checksum: checksum, plan_locked_at: new Date(), expires_at: new Date(Date.now() + 3600000), purge_at: new Date(Date.now() + 86400000) });
  const approval = { run_id: String(previewId), plan_checksum: checksum, selected_action_ids: ["selected"], approved_by: actor };
  await assert.rejects(applyReviewedEstimatesRun({ ...approval, plan_checksum: "b".repeat(64) }), { code: "RUN_NOT_APPROVABLE" });
  await assert.rejects(applyReviewedEstimatesRun({ ...approval, selected_action_ids: ["conflict"] }), { code: "UNKNOWN_ACTION" });
  const oldFlag = process.env.GRANOT_AUTOMATION_APPLY_ENABLED;
  process.env.GRANOT_AUTOMATION_APPLY_ENABLED = "false";
  try {
    await assert.rejects(approveGranotRun(approval), { code: "APPLY_DISABLED" });
    await applyReviewedEstimatesRun(approval);
    const run = await GranotAutomationRun.findById(previewId).lean();
    assert.equal(run?.status, "applying");
    assert.equal(run?.workflow, "apply");
    assert.equal(run?.request_snapshot.auto_apply, true);
    assert.deepEqual(run?.approval.selected_action_ids, ["selected"]);
    assert.deepEqual(run?.plan_snapshot, plan);
    assert.equal(run?.plan_checksum, checksum);
    assert.equal(run?.receipts.length, 0, "approval creates no lifecycle receipt itself");
    await assert.rejects(applyReviewedEstimatesRun(approval), { code: "RUN_NOT_APPROVABLE" });
  } finally {
    if (oldFlag === undefined) delete process.env.GRANOT_AUTOMATION_APPLY_ENABLED; else process.env.GRANOT_AUTOMATION_APPLY_ENABLED = oldFlag;
    await GranotAutomationRun.deleteMany({ _id: { $in: [id, previewId] } });
  }
});
