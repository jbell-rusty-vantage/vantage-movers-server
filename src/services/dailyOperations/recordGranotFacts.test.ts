import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { recordFormLeadDailyOperationsFact } from "./recordDomainFacts";
import {
  recordGranotIntakeDailyOperationsFact,
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
