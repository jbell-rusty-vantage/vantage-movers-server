import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import mongoose from "mongoose";
import { BSON, ObjectId, type Document } from "mongodb";
import { connectMongo } from "../../src/db";
import { SALES_INTELLIGENCE_JOB_INDEXES } from "../../src/models/SalesIntelligenceJob";
import { getGranotObservationReceiptModel } from "../../src/models/GranotObservationReceipt";
import { getGranotObservationModel, type GranotObservationDocument } from "../../src/models/GranotObservation";
import { getSynchronizationDecisionModel } from "../../src/models/SynchronizationDecision";
import { createGranotRun, planScheduledEstimatesRun, runGranotWorker } from "../../src/services/granotHttpCollector/runWorkflow";
import { refreshExistingEstimatesOutreach } from "../../src/services/granotHttpCollector/estimatesOutreachRefresh";
import { applyOpenAutomationPlanAction, type ApplyAutomationActionInput } from "../../src/services/granotLifecycle/automationApply";
import { claimAndProcessOrPoll } from "../../src/services/granotLifecycle/drainer";
import { captureChannelOperationReceipt } from "../../src/services/granotLifecycle/capture";
import { upsertGranotObservation } from "../../src/services/granotLifecycle/normalization";
import { createGranotObservationProcessor } from "../../src/services/granotLifecycle/processor";
import { computeChecksum } from "../../src/services/durableWork";
import { traceGranotAction } from "../vantage/granot-trace";
import { dateWindow, fakeReport, scheduler, seedGranotMeasurement } from "./granot-measurement-fixture";
import { GranotStageMetrics } from "./granot-stage-metrics";
import { proveCanonicalCrash } from "./granot-canonical-crash";

const collectionNames = ["granot_webhook_receipts", "granot_observations", "synchronization_decisions", "domain_command_executions",
  "entity_changes", "sheet_sync_jobs", "sales_intelligence_jobs", "form_leads", "call_leads", "booked_leads", "cancelled_leads"] as const;
async function main() {
  assert.equal(process.env.MONGO_URI, "mongodb://127.0.0.1:27216/?replicaSet=capacityp1&directConnection=true&monitorCommands=true");
  assert.equal(process.env.TEST_MODE, "true");
  assert.match(process.env.TEST_MONGO_DATABASE_NAME ?? "", /^testvantagemovers_granotphase2[a-f0-9]{32}$/);
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectMongo();
  const db = mongoose.connection.db!;
  assert.equal(db.databaseName, process.env.TEST_MONGO_DATABASE_NAME);
  const hello = await db.admin().command({ hello: 1 });
  assert.equal(hello.setName, "capacityp1");
  assert.deepEqual(hello.hosts, ["127.0.0.1:27216"]);
  assert.deepEqual(await db.listCollections().toArray(), []);
  for (const model of [getGranotObservationReceiptModel(), getGranotObservationModel(), getSynchronizationDecisionModel()]) await model.createIndexes();
  const dedupe = SALES_INTELLIGENCE_JOB_INDEXES.find(index => index.name === "csi_job_dedupe_unique");
  assert.ok(dedupe && "unique" in dedupe && dedupe.unique);
  assert.deepEqual(dedupe.key, { dedupe_key: 1 });
  await db.collection("sales_intelligence_jobs").createIndex({ dedupe_key: 1 }, { name: dedupe.name, unique: true });
  const leadId = await seedGranotMeasurement(db);
  const runs = db.collection("granot_automation_runs");
  const metrics = new GranotStageMetrics();
  const client = mongoose.connection.getClient();
  assert.equal(client.options.monitorCommands, true);
  metrics.attach(client);
  const processor = createGranotObservationProcessor({
    upsertObservation: id => metrics.stage("normalize", async () =>
      (await upsertGranotObservation({ receipt_id: id })).observation as GranotObservationDocument),
  });
  const actionInputs = new Map<string, ApplyAutomationActionInput>();
  const applyAction = (input: ApplyAutomationActionInput) => {
    actionInputs.set(input.lifecycle_apply.operation_id, input);
    return applyOpenAutomationPlanAction(input, {
      capture: capture => metrics.stage("capture", () => captureChannelOperationReceipt(capture)),
      claimAndProcess: id => metrics.stage("receipt claim and finalize", () => claimAndProcessOrPoll(id, {
        syncPollDeadlineMs: input.existing_receipt ? 0 : undefined,
        processor: { process: request => metrics.stage("process", () => processor.process(request)) },
      })),
    });
  };
  const worker = () => runGranotWorker({ applyAction,
    refreshOutreach: receipt => metrics.stage("Outreach refresh", () => refreshExistingEstimatesOutreach(receipt)) });
  async function collect(workload: string, priority: string) {
    const collected = fakeReport(priority);
    const result = await metrics.workload(workload, "create", () => createGranotRun({
      operation: "estimates_in_process", workflow: "apply", dateWindow, sourceLabels: [], initiator: scheduler, autoApply: true, scheduledSlotKey: workload,
    }));
    assert.equal(result.queue_published, false);
    const runId = new ObjectId(result.run_id);
    const created = await runs.findOne({ _id: runId });
    assert.ok(created);
    const planned = await metrics.workload(workload, "collect and seal", () => runGranotWorker({
      planRun: async (id, lease) => {
        assert.equal(await planScheduledEstimatesRun(id, lease), "applying");
        // Keep this fixture's sealed plan held while the other capture times are staged.
        return "sealed";
      },
    }));
    collected();
    assert.equal(planned.run_id, result.run_id);
    const sealed = await runs.findOne({ _id: runId });
    assert.ok(sealed);
    assert.equal(sealed.status, "applying", JSON.stringify(sealed.plan_snapshot?.counters));
    assert.equal(sealed.expires_at.getTime(), created.expires_at.getTime());
    assert.equal(sealed.purge_at, null);
    assert.equal(sealed.archive_review_at.getTime(), created.expires_at.getTime());
    assert.equal(sealed.plan_snapshot.actions.length, 1);
    const action = sealed.plan_snapshot.actions[0];
    assert.equal(action.lifecycle_apply.expected_target.id, String(leadId));
    assert.equal(action.lifecycle_apply.operation_id, String(runId) + ":" + action.action_id);
    assert.equal(sealed.plan_checksum, computeChecksum({ checksum_version: 1, artifact_kind: "ingestion_plan", schema_version: 1, payload: sealed.plan_snapshot }));
    return { workload, sealed, action };
  }
  async function inventory() {
    const result: Record<string, { count: number; bson: number }> = {};
    for (const name of collectionNames) {
      const rows = await db.collection(name).find({}).toArray();
      result[name] = { count: rows.length, bson: rows.reduce((n, row) => n + BSON.calculateObjectSize(row), 0) };
    }
    return result;
  }
  const evidence: Record<string, Document> = {};
  async function apply(input: Awaited<ReturnType<typeof collect>>, outcome: string) {
    const { workload, sealed, action } = input;
    const id = String(sealed._id);
    const before = await inventory();
    const oldLead = await db.collection("form_leads").findOne({ _id: leadId });
    assert.ok(oldLead);
    assert.deepEqual(sealed.approval.selected_action_ids, [action.action_id]);
    assert.equal(sealed.approval.approved_by.actor_type, "system");
    await runs.updateOne({ _id: sealed._id }, { $set: { leased_until: new Date(0) } });
    const approved = await runs.findOne({ _id: sealed._id });
    assert.ok(approved);
    assert.equal(approved.receipts.length, 0);
    assert.equal(await db.collection("granot_webhook_receipts").countDocuments({ channel_operation_id: action.lifecycle_apply.operation_id }), 0);
    const finished = await metrics.workload(workload, "apply worker", worker);
    const run = await runs.findOne({ _id: sealed._id });
    assert.ok(run);
    const receipt = await db.collection("granot_webhook_receipts").findOne({ channel_operation_id: action.lifecycle_apply.operation_id });
    assert.ok(receipt);
    assert.equal(finished.status, "completed", JSON.stringify({ run: run.receipts, processing: receipt.processing }));
    assert.equal(run.receipts.length, 1);
    const entry = run.receipts[0];
    const observation = await db.collection("granot_observations").findOne({ receipt_id: receipt._id });
    const decision = await db.collection("synchronization_decisions").findOne({ _id: receipt.processing.latest_decision_id });
    const lead = await db.collection("form_leads").findOne({ _id: leadId });
    assert.ok(observation && decision && lead);
    assert.equal(run.plan_checksum, sealed.plan_checksum);
    assert.deepEqual(run.approval, approved.approval);
    assert.deepEqual(run.plan_snapshot, sealed.plan_snapshot);
    assert.deepEqual([run.expires_at, run.purge_at], [sealed.expires_at, sealed.purge_at]);
    assert.deepEqual([entry.lifecycle_receipt_id, entry.observation_id, entry.decision_id], [receipt._id, observation._id, decision._id].map(String));
    assert.equal(String(decision.observation_id), String(observation._id));
    assert.equal(receipt.captured_at.toISOString(), action.collection_captured_at);
    assert.deepEqual(observation.captured_at, receipt.captured_at);
    assert.equal(decision.execution_mode, "live");
    assert.equal(decision.outcome, outcome, decision.reason_code);
    assert.equal(entry.outcome, outcome);
    assert.equal(entry.outreach_refresh_completed, true);
    assert.equal(lead.granot_priority, "5");
    assert.equal(lead.quoted, true);
    assert.equal(lead.domain_revision - oldLead.domain_revision, outcome === "applied" ? 1 : 0);
    const winner = String(lead.last_accepted_granot_observation.observation_id);
    assert.equal(winner, outcome === "stale" ? String(oldLead.last_accepted_granot_observation.observation_id) : String(observation._id));
    const after = await inventory();
    const delta = (name: string) => after[name]!.count - before[name]!.count;
    for (const collection of ["granot_webhook_receipts", "granot_observations", "synchronization_decisions"]) assert.equal(delta(collection), 1);
    for (const collection of ["form_leads", "call_leads", "booked_leads", "cancelled_leads"]) assert.equal(delta(collection), 0);
    for (const collection of ["entity_changes", "domain_command_executions", "sheet_sync_jobs"]) assert.equal(delta(collection), outcome === "applied" ? 1 : 0, collection);
    const refreshKey = "sod:lead-change:FormLead:" + leadId + ":estimates-refresh:" + receipt._id;
    assert.equal(await db.collection("sales_intelligence_jobs").countDocuments({ dedupe_key: refreshKey }), outcome === "stale" ? 0 : 1);
    if (outcome === "applied") {
      assert.ok(decision.effects.some((effect: Document) => effect.kind === "sheet_sync_requested"));
      const change = await db.collection("entity_changes").findOne({ "entity.id": String(leadId), "provenance.decision_id": decision._id });
      assert.ok(change);
      assert.equal(String(change._id), String(lead.last_change_id));
      assert.ok(await db.collection("domain_command_executions").findOne({ _id: change.command_execution_id, command_name: "synchronizeLeadFromGranot" }));
    } else assert.deepEqual(decision.effects, []);
    const trace = await traceGranotAction(db, id, action.action_id);
    assert.equal(trace.status, "traced", trace.stop);
    assert.equal(trace.decision?.outcome, outcome);
    assert.equal(String(trace.lead?.winner_id), winner);
    assert.equal(trace.lead?.observation_vs_current_winner, outcome === "stale" ? "older" : "same");
    evidence[workload] = { runId: id, actionId: action.action_id, operationId: action.lifecycle_apply.operation_id, checksum: run.plan_checksum,
      expiresAt: run.expires_at, purgeAt: run.purge_at, receiptId: String(receipt._id), observationId: String(observation._id),
      decisionId: String(decision._id), targetId: String(leadId), winner, outcome, reason: decision.reason_code, revision: lead.domain_revision,
      effects: decision.effects.map((effect: Document) => effect.kind), retainedBefore: before, retainedAfter: after,
      trace: { status: trace.status, stop: trace.stop, outcome: trace.decision?.outcome, temporalOrder: trace.lead?.observation_vs_current_winner } };
    return entry;
  }
  // Seal the older assertion first. Release its fixture lease after a later snapshot has won.
  const stale = await collect("stale", "8");
  const genuine = await collect("genuine", "5");
  const first = await apply(genuine, "applied");
  const unchanged = await collect("unchanged", "5");
  await apply(unchanged, "already_current");
  assert.ok(Date.parse(stale.action.collection_captured_at) < Date.parse(genuine.action.collection_captured_at));
  assert.ok(Date.parse(genuine.action.collection_captured_at) < Date.parse(unchanged.action.collection_captured_at));
  await apply(stale, "stale");
  // Missing run checkpoint: the same open-run operation reaches duplicate capture and reads its original terminal result.
  const replayInput = actionInputs.get(genuine.action.lifecycle_apply.operation_id)!;
  const before = await inventory();
  const replay = await metrics.workload("replay", "action re-entry", () => applyAction(replayInput));
  assert.deepEqual([replay.outcome, replay.lifecycle_receipt_id, replay.observation_id, replay.decision_id],
    [first.outcome, first.lifecycle_receipt_id, first.observation_id, first.decision_id]);
  assert.deepEqual(await inventory(), before);
  const finalLead = await db.collection("form_leads").findOne({ _id: leadId });
  assert.equal(String(finalLead?.last_accepted_granot_observation.observation_id), evidence.unchanged!.winner);
  evidence.replay = { operationId: replayInput.lifecycle_apply.operation_id, receiptId: replay.lifecycle_receipt_id,
    observationId: replay.observation_id, decisionId: replay.decision_id, winner: evidence.unchanged!.winner, outcome: replay.outcome,
    revision: finalLead?.domain_revision, retainedBefore: before, retainedAfter: before };
  for (const workload of ["genuine", "unchanged", "stale"]) {
    for (const stage of ["create", "collect and seal", "run claim (collect and seal)", "run claim (apply worker)",
      "apply worker", "capture", "receipt claim and finalize", "normalize", "process", "decision and Lead transaction"]) {
      assert.ok(metrics.rows[workload]?.[stage]?.commands, "Unmeasured Mongo stage: " + workload + " / " + stage);
    }
  }
  assert.ok(metrics.rows.replay?.capture?.commands && metrics.rows.replay?.["receipt claim and finalize"]?.commands);
  const workflowHash = createHash("sha256").update(readFileSync("src/services/granotHttpCollector/runWorkflow.ts")).digest("hex");
  const result = { baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workflowSha256: workflowHash, recordedAt: new Date().toISOString(), fixture: "Single-row Estimates report, active Form and Record Link, open Outreach subject, queued Sheet intent, local synthetic HTTP.",
    bytes: "BSON document sizes from command events. Returned firstBatch/nextBatch/value, submitted update expressions (including no-match), submitted inserted documents (including attempted duplicate). Excludes ACK envelopes, wire/physical storage, replication and indexes. Inventory is materialized application BSON.",
    measurements: metrics.rows, evidence };
  const crash = await collect("crash proof", "1");
  const crashProof = await proveCanonicalCrash(db, crash.sealed, leadId);
  delete metrics.rows["crash proof"]; // Separate fault scenario, outside the four measured workloads.
  writeFileSync(process.argv[2]!, JSON.stringify({ ...result, crashProof }, null, 2) + "\n", { flag: "wx" });
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
