import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  createGranotRun,
  estimatesActionCaptureTime,
  granotRecoverableFilter,
  scheduledEstimatesRunId,
  validateEstimatesRunSelection,
} from "./runWorkflow";
const actor = {
  actor_type: "owner",
  actor_id: "owner-1",
  actor_label: "Owner",
  actor_role: "owner",
  request_id: "request-1",
  origin: "vantage_admin",
} as const;

test('Pool schedules cannot collide with ALL retry identity or bypass selector/lane validation',()=>{
  const slot='10/14/2026:8:07/17/2026:07/23/2026';
  assert.equal(String(scheduledEstimatesRunId(slot)),String(scheduledEstimatesRunId(slot,'all')));
  assert.notEqual(String(scheduledEstimatesRunId(slot,'all')),String(scheduledEstimatesRunId(slot,'pool')));
  assert.equal(String(scheduledEstimatesRunId(slot,'pool')),String(scheduledEstimatesRunId(slot,'pool')));
  validateEstimatesRunSelection({operation:'estimates_in_process',estimatesSelection:'pool',estimatesLane:'pool_discovery'});
  assert.throws(()=>validateEstimatesRunSelection({operation:'form_leads',estimatesSelection:'pool'}),/must agree/);
  assert.throws(()=>validateEstimatesRunSelection({operation:'estimates_in_process',estimatesSelection:'all',estimatesLane:'pool_refresh'}),/must agree/);
  assert.deepEqual(granotRecoverableFilter(new Date())['request_snapshot.waiting_for_all'],{$ne:true});
});

test("a dashboard request cannot create a scheduled run", async () => {
  await assert.rejects(createGranotRun({ operation: "estimates_in_process", workflow: "apply",
    dateWindow: { from: "01/01/2026", to: "01/01/2026" }, initiator: actor,
    scheduledSlotKey: "spoofed", autoApply: true, sourceLabels: [] }), /requires a system slot/);
});

test("[AC-02] applyRun has no runtime path to legacy Form/Call/Booked mutation services", async () => {
  const source = await readFile(
    path.join(__dirname, "runWorkflow.ts"),
    "utf8",
  );
  assert.equal(source.includes("updateFormLead"), false);
  assert.equal(source.includes("syncCallLeadEnrichment"), false);
  assert.equal(source.includes("syncBookedCallLeadReconciliation"), false);
  assert.match(source, /applyAutomationPlanAction/);
  assert.match(source, /claimAndProcessOrPoll|applyAutomationPlanAction/);
});

test("Estimates observation time is immutable provider capture, never apply time", () => {
  const collection_captured_at = "2026-10-13T12:04:05.000Z";
  assert.equal(estimatesActionCaptureTime({ collection_captured_at }).toISOString(), collection_captured_at);
  assert.throws(() => estimatesActionCaptureTime({}), (error: unknown) => error instanceof Error && /recollect/.test(error.message));
  assert.throws(() => estimatesActionCaptureTime({ collection_captured_at: "not-a-date" }));
});

test("worker eligibility shares one queue for fresh collection, approved actions, and due waiting matches", () => {
  const filter = granotRecoverableFilter(new Date("2026-10-14T12:00:00Z"));
  const alternatives = filter.$or as Array<Record<string, unknown>>;
  assert.deepEqual(alternatives.map((item) => item.status), ["queued", "planning", "applying"]);
  const ready = (alternatives[2]!.$and as Array<Record<string, unknown>>)[1]!;
  assert.deepEqual((ready.$or as Array<Record<string, unknown>>)[1], { last_attempt_at: { $lte: new Date("2026-10-14T11:59:00Z") } });
});
