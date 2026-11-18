import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";
import { webhookIncrements } from "./webhookDay";
import { recordFormLeadDailyOperationsFact } from "./recordDomainFacts";
import {
  granotProcessorOutcomeKind,
  granotReceiptKind,
  granotReceiptMetricTouches,
  processTimeBookingMetricTouches,
  recordGranotDeadLetterDailyOperationsFact,
  recordGranotIntakeDailyOperationsFact,
  recordGranotLinkedDailyOperationsFact,
  recordGranotMintedDailyOperationsFact,
  recordGranotProcessorOutcomeDailyOperationsFact,
} from "./recordGranotFacts";
import {
  clearCapturedDailyOperationsFacts,
  getCapturedDailyOperationsFacts,
} from "./testDailyOperationsSink";

afterEach(() => {
  clearCapturedDailyOperationsFacts();
});

function capturedOf(kind: string) {
  return getCapturedDailyOperationsFacts().filter(
    (fact) => fact.input.kind === kind,
  );
}

test("true webhooks increment one Eastern-hour and class, plus one recognized booking action", () => {
  const captured_at = new Date("2026-09-06T16:00:00Z");
  for (const route_event_class of ["lead_created", "priority_updated", "booking_status_changed"] as const) {
    assert.deepEqual(webhookIncrements({ captured_at, route_event_class, payload: {} }),
      { revision: 1, [`webhooks.${route_event_class}`]: 1, "hourly.12.webhooks": 1 });
  }
  for (const [token, expected] of [["Booked", "booked"], ["Release", "release"], ["Releas", "release"]]) {
    assert.deepEqual(webhookIncrements({ captured_at, route_event_class: "booking_status_changed", payload: { event_type: token } }),
      { revision: 1, "webhooks.booking_status_changed": 1, [`webhooks.${expected}`]: 1, "hourly.12.webhooks": 1 });
  }
});

test("granot.minted retains a display card without retired decision counters", async () => {
  await recordGranotMintedDailyOperationsFact({
    source_receipt_id: "receipt-mint-1",
    decision_id: "decision-mint-1",
    job_no: "567632",
    source_company: "tbm_leads",
    lead_id: "507f1f77bcf86cd799439011",
    lead_model: "FormLead",
  });
  await recordFormLeadDailyOperationsFact({
    source_company: "tbm_leads",
    lead: {
      _id: { toString: () => "507f1f77bcf86cd799439011" },
      name: "Ada",
      ingestion_origin: "granot_lead_created",
      source_company: "tbm_leads",
      job_no: "567632",
    },
  });
  const minted = capturedOf("granot.minted");
  assert.equal(minted.length, 1);
  assert.deepEqual(minted[0]?.input.metric_touches, []);

  assert.equal(minted[0]?.input.parent_receipt_id, undefined);
  assert.equal(
    minted[0]?.input.dedupe_key,
    "decision:decision-mint-1:granot.minted",
  );
  assert.equal(minted[0]?.input.job_no, "567632");
  assert.equal(minted[0]?.input.source_company, "tbm_leads");
  assert.equal(minted[0]?.input.links?.lead_id, "507f1f77bcf86cd799439011");
  const form = capturedOf("form_lead.created");
  assert.equal(form.length, 1);
  assert.ok(form[0]?.input.metric_touches.includes("leads.form"));
  assert.ok(form[0]?.input.metric_touches.includes("leads.total"));
});

test("linked outcome retains its business link without a receipt card", async () => {
  await recordGranotLinkedDailyOperationsFact({
    outcome: "linked",
    source_receipt_id: "link-receipt",
    decision_id: "link-decision",
    job_no: "JOB-9",
    source_company: "main_site",
    lead_id: "lead-9",
    lead_model: "CallLead",
  });
  const facts = capturedOf("granot.linked");
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0]?.input.metric_touches, []);
  assert.equal(facts[0]?.input.parent_receipt_id, undefined);
  assert.equal(facts[0]?.input.dedupe_key, "decision:link-decision:granot.linked");
});

test("synchronize conflict pending does not record granot.linked", async () => {
  await recordGranotLinkedDailyOperationsFact({
    outcome: "conflict",
    source_receipt_id: "conflict-receipt",
    decision_id: "conflict-decision",
    lead_id: "lead-9",
    lead_model: "FormLead",
  });
  assert.equal(capturedOf("granot.linked").length, 0);
});

test("processor maps observe / pending_match / unmatched and skips mint/link", async () => {
  assert.equal(granotProcessorOutcomeKind("created"), null);
  assert.equal(granotProcessorOutcomeKind("applied"), null);
  assert.equal(granotProcessorOutcomeKind("linked"), null);
  assert.equal(granotProcessorOutcomeKind("pending_match"), "granot.pending_match");
  assert.equal(granotProcessorOutcomeKind("unmatched"), "granot.unmatched");
  assert.equal(granotProcessorOutcomeKind("already_current"), null);
  assert.equal(granotProcessorOutcomeKind("stale"), null);
  assert.equal(granotProcessorOutcomeKind("policy_blocked"), "granot.observed");

  await recordGranotProcessorOutcomeDailyOperationsFact({
    receipt_id: "obs-receipt",
    decision_id: "obs-decision",
    outcome: "policy_blocked",
    job_no: "JOB-1",
  });
  await recordGranotProcessorOutcomeDailyOperationsFact({
    receipt_id: "obs-receipt",
    decision_id: "created-decision",
    outcome: "created",
  });
  const observed = capturedOf("granot.observed");
  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.input.parent_receipt_id, undefined);
  assert.equal(
    observed[0]?.input.dedupe_key,
    "decision:obs-decision:granot.observed",
  );
  assert.deepEqual(observed[0]?.input.metric_touches, []);
  assert.equal(capturedOf("granot.minted").length, 0);
});

test("intake opened increments intakes.opened; refresh does not", async () => {
  await recordGranotIntakeDailyOperationsFact({
    case_id: "case-1",
    kind: "opened",
    job_no: "JOB-22",
    receipt_id: "intake-receipt",
    decision_id: "intake-decision",
    booking_action: "booked",
    captureAlreadyClassified: true,
  });
  await recordGranotIntakeDailyOperationsFact({
    case_id: "case-1",
    kind: "refreshed",
    revision: 2,
    job_no: "JOB-22",
    receipt_id: "intake-receipt-2",
    booking_action: "booked",
    captureAlreadyClassified: true,
  });
  const opened = capturedOf("intake.opened");
  const refreshed = capturedOf("intake.refreshed");
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0]?.input.metric_touches, ["intakes.opened"]);
  assert.equal(opened[0]?.input.dedupe_key, "intake:case-1:opened");
  assert.equal(opened[0]?.input.links?.intake_case_id, "case-1");
  assert.equal(opened[0]?.input.job_no, "JOB-22");
  assert.equal(opened[0]?.input.parent_receipt_id, undefined);
  assert.equal(refreshed.length, 1);
  assert.deepEqual(refreshed[0]?.input.metric_touches, ["intakes.refreshed"]);
  assert.equal(refreshed[0]?.input.dedupe_key, "intake:case-1:refreshed:2");
  assert.equal(
    refreshed[0]?.input.metric_touches.includes("intakes.opened"),
    false,
  );
});

test("process-time Booked increments booked only when capture did not classify", async () => {
  assert.deepEqual(processTimeBookingMetricTouches("booked", true), []);
  assert.deepEqual(processTimeBookingMetricTouches("release", true), []);
  assert.deepEqual(processTimeBookingMetricTouches("booked", false), [
    "webhooks.booked",
  ]);
  assert.deepEqual(processTimeBookingMetricTouches("release", false), [
    "webhooks.release",
  ]);

  await recordGranotIntakeDailyOperationsFact({
    case_id: "case-once",
    kind: "opened",
    job_no: "JOB-22",
    receipt_id: "once-booked",
    booking_action: "booked",
    captureAlreadyClassified: false,
  });
  const intake = capturedOf("intake.opened")[0];
  assert.deepEqual(intake?.input.metric_touches, [
    "intakes.opened",
    "webhooks.booked",
  ]);
  assert.equal(
    intake?.input.metric_touches.includes("webhooks.booking_status_changed"),
    false,
  );
});

test("Booked increments those buckets once when capture already classified", async () => {
  await recordGranotIntakeDailyOperationsFact({
    case_id: "case-classified",
    kind: "opened",
    receipt_id: "classified-booked",
    booking_action: "booked",
    captureAlreadyClassified: true,
  });
  const intake = capturedOf("intake.opened")[0];
  assert.deepEqual(intake?.input.metric_touches, ["intakes.opened"]);
});

test("dead letter uses exception:dead_letter:<receiptId>", async () => {
  await recordGranotDeadLetterDailyOperationsFact({
    receipt_id: "dead-1",
    detail: "technical_attempts_exhausted",
  });
  const facts = capturedOf("exception.dead_letter");
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.input.dedupe_key, "exception:dead_letter:dead-1");
  assert.deepEqual(facts[0]?.input.metric_touches, ["exceptions.dead_letter"]);
  assert.equal(facts[0]?.input.parent_receipt_id, "dead-1");
});

test("receipt kind and dedupe follow spec §14", () => {
  assert.equal(granotReceiptKind("lead_created", null), "granot.lead_created");
  assert.equal(granotReceiptKind("priority_updated", null), "granot.priority_updated");
  assert.equal(granotReceiptKind("booking_status_changed", "booked"), "granot.booked");
  assert.equal(granotReceiptKind("booking_status_changed", "release"), "granot.release");
  assert.equal(granotReceiptKind("booking_status_changed", null), null);
  assert.deepEqual(
    granotReceiptMetricTouches(null, "booking_status_changed"),
    ["webhooks.booking_status_changed", "hourly.webhooks"],
  );
});

test("captureChannelOperationReceipt is not a Daily Operations hook site", async () => {
  const source = await readFile(
    path.join(__dirname, "../granotLifecycle/capture.ts"),
    "utf8",
  );
  const start = source.indexOf("export async function captureChannelOperationReceipt");
  assert.ok(start >= 0);
  const next = source.indexOf("\nexport async function ", start + 1);
  const body = source.slice(start, next === -1 ? undefined : next);
  assert.doesNotMatch(
    body,
    /recordGranot|recordDailyOperationsFact|recordGranotReceiptDailyOperationsFact/,
  );
});

test("createLeadFromGranot finalize records granot.minted after existing after-commit work", async () => {
  const source = await readFile(
    path.join(__dirname, "../granotLifecycle/createLeadFromGranot.ts"),
    "utf8",
  );
  const start = source.indexOf("finalize: async (pending)");
  const body = source.slice(start, start + 800);
  assert.ok(body.indexOf("finalizeSheetSync") < body.indexOf("recordGranotMintedDailyOperationsFact"));
  assert.match(source, /source_receipt_id: pending.source_receipt_id/);
  assert.match(source, /decision_id: pending.decision_id/);
});

test("synchronizeLeadFromGranot pending carries outcome and provenance", async () => {
  const source = await readFile(
    path.join(__dirname, "../granotLifecycle/synchronizeLeadFromGranot.ts"),
    "utf8",
  );
  assert.match(source, /source_receipt_id: input.context.provenance.source_receipt_id/);
  assert.match(source, /decision_id: input.context.provenance.decision_id/);
  assert.match(source, /recordGranotLinkedDailyOperationsFact\(pending\)/);
  assert.match(source, /source_company: lead.source_company/);
});

test("logProcessingCompletion records observe/pending/unmatched when no lead finalize ran", async () => {
  const source = await readFile(
    path.join(__dirname, "../granotLifecycle/processor.ts"),
    "utf8",
  );
  const start = source.indexOf("function logProcessingCompletion");
  const body = source.slice(start, start + 1800);
  assert.match(body, /recordGranotProcessorOutcomeDailyOperationsFact/);
});

test("dead letter hook is the drainer entered seam, not the 202 path", async () => {
  const drainer = await readFile(
    path.join(__dirname, "../granotLifecycle/drainer.ts"),
    "utf8",
  );
  const capture = await readFile(
    path.join(__dirname, "../granotLifecycle/capture.ts"),
    "utf8",
  );
  assert.match(drainer, /granot_lifecycle.dead_letter.entered/);
  const entered = drainer.indexOf('eventKey: "granot_lifecycle.dead_letter.entered"');
  const hook = drainer.indexOf("recordGranotDeadLetterDailyOperationsFact", entered);
  assert.ok(entered >= 0 && hook > entered);
  assert.doesNotMatch(capture, /recordGranotDeadLetterDailyOperationsFact/);
});

test("already-current/stale hooks suppress only redundant display facts", async () => {
  for (const outcome of ["already_current", "stale"] as const) {
    await recordGranotProcessorOutcomeDailyOperationsFact({ receipt_id: "synthetic-receipt", decision_id: `synthetic-${outcome}`, outcome });
  }
  assert.equal(getCapturedDailyOperationsFacts().length, 0);
  for (const outcome of ["policy_blocked", "conflict", "unsupported", "insufficient_creation_data"] as const) {
    await recordGranotProcessorOutcomeDailyOperationsFact({ receipt_id: "synthetic-receipt", decision_id: `synthetic-${outcome}`, outcome });
  }
  assert.deepEqual(capturedOf("granot.observed").map((row) => row.input.card?.granot?.decision), ["policy_blocked", "conflict", "unsupported", "insufficient_creation_data"]);
});
