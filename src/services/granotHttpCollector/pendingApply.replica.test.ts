import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { connectMongo } from "../../db";
import { GranotAutomationRun } from "../../models/GranotAutomationRun";
import { computeChecksum } from "../durableWork";
import { granotApplyReadyFilter, runGranotWorker } from "./runWorkflow";

after(async () => { await mongoose.disconnect(); });

test("replica: pending match does not block later actions or another approved run; terminal actions replay once", async (t) => {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") { t.skip("Local replica proof is opt-in."); return; }
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(process.env.MONGO_URI ?? "", /^mongodb:\/\/127\.0\.0\.1:/);
  await connectMongo();
  assert.equal(mongoose.connection.db?.databaseName, process.env.TEST_MONGO_DATABASE_NAME ?? "testvantagemovers");
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  const requeued = new mongoose.Types.ObjectId();
  const fresh = new mongoose.Types.ObjectId();
  const bounded = new mongoose.Types.ObjectId();
  const legacy = new mongoose.Types.ObjectId();
  const refreshRetry = new mongoose.Types.ObjectId();
  const actor = { actor_type: "owner", actor_id: "pending-apply-test", actor_role: "owner", origin: "vantage_admin" };
  async function seed(id: mongoose.Types.ObjectId, actions: string[], last: Date) {
    const plan = { kind: "estimates_in_process", schema_version: 2, actions: actions.map((action_id) => ({ action_id, classification: "update", collection_captured_at: "2026-10-13T12:00:00.000Z", lifecycle_apply: { operation_id: `${id}:${action_id}`, operation_kind: "lead_snapshot_apply", granot_statement: { priority: "0", job_no: "SYNTHETIC-100" } } })), counters: { update: actions.length } };
    const checksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 1, payload: plan });
    await GranotAutomationRun.create({ _id: id, operation: "estimates_in_process", workflow: "apply", status: "applying", request_snapshot: { auto_apply: true }, initiator: actor, plan_snapshot: plan, plan_checksum: checksum, plan_locked_at: new Date(), approval: { selected_action_ids: actions, plan_checksum: checksum, approved_by: actor }, expires_at: new Date(Date.now() + 3600000), purge_at: new Date(Date.now() + 86400000), last_attempt_at: last });
  }
  const calls: string[] = [];
  let settledSecond = false;
  let deferFirst = false;
  const deps = {
    loadReplayStates: async (ids: string[]) => {
      const row = await GranotAutomationRun.findById(first).lean();
      const race = await GranotAutomationRun.findById(requeued).lean();
      const raceStates = (race?.receipts ?? []).filter((r) => ids.includes(r.lifecycle_receipt_id)).map((r) => [r.lifecycle_receipt_id, { terminal: true, ready: true }] as const);
      return new Map([...raceStates, ...(row?.receipts ?? []).filter((r) => ids.includes(r.lifecycle_receipt_id)).map((r) => [r.lifecycle_receipt_id, {
        terminal: settledSecond && r.action_id === "pending-two",
        ready: !(deferFirst && r.action_id === "pending-one"),
      }] as const)]);
    },
    applyAction: async (input: { action_id: string; captured_at?: Date; existing_receipt?: unknown }) => {
    if (!input.existing_receipt) assert.equal(input.captured_at?.toISOString(), "2026-10-13T12:00:00.000Z");
    calls.push(input.action_id);
    return { action_id: input.action_id, lifecycle_receipt_id: String(new mongoose.Types.ObjectId()), outcome: input.action_id.startsWith("pending") && !(settledSecond && input.action_id === "pending-two") ? "accepted_for_processing" as const : "applied" as const, applied_at: new Date() };
  } };
  try {
    await seed(first, ["pending-one", "pending-two", "later-1", "later-2"], new Date("2000-01-01"));
    await seed(second, ["other-run"], new Date("2000-01-02"));
    assert.equal((await runGranotWorker(deps)).run_id, String(first));
    let row = await GranotAutomationRun.findById(first).lean();
    assert.equal(row?.status, "applying");
    assert.equal(row?.receipts.length, 4, "every independent action gets its canonical attempt");
    assert.equal(row?.checkpoint?.phase, "waiting_match");
    assert.equal(row?.checkpoint?.completed_units, 2);
    assert.equal(await GranotAutomationRun.exists({ _id: first, ...granotApplyReadyFilter(new Date()) }), null, "pending run waits rather than hot-looping");
    assert.equal((await runGranotWorker(deps)).run_id, String(second), "another approved run is not starved");
    assert.equal((await GranotAutomationRun.findById(second))?.status, "completed");
    await GranotAutomationRun.updateOne({ _id: first }, { $set: { last_attempt_at: new Date(Date.now() - 61000) } });
    assert.equal((await runGranotWorker(deps)).run_id, String(first));
    assert.deepEqual(calls, ["pending-one", "pending-two", "later-1", "later-2", "other-run", "pending-one"], "terminal actions are never applied again");
    row = await GranotAutomationRun.findById(first).lean();
    assert.equal(row?.receipts.length, 4);
    settledSecond = true;
    deferFirst = true;
    await GranotAutomationRun.updateOne({ _id: first }, { $set: { last_attempt_at: new Date(Date.now() - 61000) } });
    await runGranotWorker(deps);
    assert.equal(calls.at(-1), "pending-two", "a receipt settled by the lifecycle drainer refreshes without a pending poll");
    assert.equal(calls.filter((id) => id === "pending-one").length, 2, "non-due receipt is skipped");
    assert.equal(calls.filter((id) => id === "pending-two").length, 2, "only one due pending receipt polled on the previous pass");
    assert.equal((await GranotAutomationRun.findById(first))?.checkpoint?.completed_units, 3);
    await seed(requeued, ["dead-race", "dead-race-2", "dead-race-3"], new Date("2000-01-01"));
    await GranotAutomationRun.updateOne({ _id: requeued }, { $set: { receipts: ["dead-race", "dead-race-2", "dead-race-3"].map((action_id) => ({ action_id, lifecycle_receipt_id: String(new mongoose.Types.ObjectId()), outcome: "accepted_for_processing", applied_at: new Date() })) } });
    assert.equal((await runGranotWorker(deps)).run_id, String(requeued));
    assert.equal(calls.filter((id) => id.startsWith("dead-race")).length, 3, "the canonical claim rechecks the live receipt after an Owner requeue");
    assert.equal((await GranotAutomationRun.findById(requeued))?.status, "completed", "no failure fabricated from a dead-letter snapshot");
    await GranotAutomationRun.updateOne({ _id: first }, { $set: { last_attempt_at: new Date(Date.now() - 61000) } });
    await GranotAutomationRun.create({ _id: fresh, operation: "estimates_in_process", workflow: "preview", status: "queued", request_snapshot: {}, initiator: actor, expires_at: new Date(Date.now() + 3600000), purge_at: new Date(Date.now() + 86400000) });
    const freshResult = await runGranotWorker({ ...deps, planRun: async (runId) => {
      assert.equal(runId, String(fresh));
      await GranotAutomationRun.updateOne({ _id: fresh }, { $set: { status: "completed", leased_until: null, lease_owner: null } });
      return "completed";
    } });
    assert.equal(freshResult.run_id, String(fresh), "fresh collection gets a bounded turn before an old eligible waiting-match retry");
    await GranotAutomationRun.updateOne({ _id: first }, { $set: { status: "completed" } });
    await seed(bounded, Array.from({ length: 26 }, (_, i) => `batch-${i}`), new Date("2000-01-01"));
    assert.equal((await runGranotWorker(deps)).run_id, String(bounded));
    const batch = await GranotAutomationRun.findById(bounded).lean();
    assert.equal(batch?.receipts.length, 25);
    assert.equal(batch?.checkpoint?.phase, "apply", "remaining fresh actions resume immediately without the waiting-match cooldown");
    assert.equal((await runGranotWorker(deps)).run_id, String(bounded));
    assert.equal((await GranotAutomationRun.findById(bounded))?.status, "completed");
    await seed(legacy, ["legacy-receipt", "legacy-fresh"], new Date("2000-01-01"));
    const stored = await GranotAutomationRun.findById(legacy).lean();
    const legacyPlan = stored!.plan_snapshot as { actions: Array<{ collection_captured_at?: string }> };
    for (const action of legacyPlan.actions) delete action.collection_captured_at;
    const legacyChecksum = computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 1, payload: legacyPlan });
    await GranotAutomationRun.updateOne({ _id: legacy }, { $set: { plan_snapshot: legacyPlan, plan_checksum: legacyChecksum, "approval.plan_checksum": legacyChecksum, receipts: [{ action_id: "legacy-receipt", lifecycle_receipt_id: String(new mongoose.Types.ObjectId()), outcome: "accepted_for_processing", applied_at: new Date() }] } });
    assert.equal((await runGranotWorker(deps)).run_id, String(legacy));
    const legacyDone = await GranotAutomationRun.findById(legacy).lean();
    assert.equal(legacyDone?.status, "completed_with_errors");
    assert.equal(legacyDone?.receipts.find((receipt) => receipt.action_id === "legacy-receipt")?.outcome, "applied");
    assert.equal(legacyDone?.receipts.find((receipt) => receipt.action_id === "legacy-fresh")?.error_code, "RUN_REPLAN_REQUIRED");
    assert.equal(calls.includes("legacy-fresh"), false, "legacy fresh evidence is never captured at apply time");
    await seed(refreshRetry, ["refresh-retry"], new Date("2000-01-01"));
    let refreshCalls = 0;
    const refreshDeps = { ...deps, refreshOutreach: async () => { refreshCalls += 1; if (refreshCalls === 1) throw new Error("synthetic transient enqueue failure"); return "enqueued" as const; } };
    await assert.rejects(runGranotWorker(refreshDeps), /synthetic transient enqueue failure/);
    const crashed = await GranotAutomationRun.findById(refreshRetry).lean();
    assert.equal(crashed?.status, "applying", "saved terminal receipt retains recoverable apply status until refresh nomination commits");
    assert.equal(crashed?.receipts.length, 1);
    assert.equal(crashed?.receipts[0]?.outreach_refresh_completed, undefined);
    assert.equal((await runGranotWorker(refreshDeps)).run_id, String(refreshRetry));
    assert.equal(calls.filter((id) => id === "refresh-retry").length, 1, "terminal canonical action never reapplies after nomination failure");
    assert.equal(refreshCalls, 2);
    assert.equal((await GranotAutomationRun.findById(refreshRetry))?.status, "completed");
  } finally {
    await GranotAutomationRun.deleteMany({ _id: { $in: [first, second, requeued, fresh, bounded, legacy, refreshRetry] } });
  }
});
