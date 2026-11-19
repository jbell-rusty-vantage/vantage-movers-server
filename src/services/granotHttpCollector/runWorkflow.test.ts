import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  createGranotRun,
  granotRecoverableFilter,
} from "./runWorkflow";
const actor = {
  actor_type: "owner",
  actor_id: "owner-1",
  actor_label: "Owner",
  actor_role: "owner",
  request_id: "request-1",
  origin: "vantage_admin",
} as const;

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

test("worker eligibility shares one queue for fresh collection, approved actions, and due waiting matches", () => {
  const filter = granotRecoverableFilter(new Date("2026-10-14T12:00:00Z"));
  const alternatives = filter.$or as Array<Record<string, unknown>>;
  assert.deepEqual(alternatives.map((item) => item.status), ["queued", "planning", "applying"]);
  const ready = (alternatives[2]!.$and as Array<Record<string, unknown>>)[1]!;
  assert.deepEqual((ready.$or as Array<Record<string, unknown>>)[1], { last_attempt_at: { $lte: new Date("2026-10-14T11:59:00Z") } });
});
