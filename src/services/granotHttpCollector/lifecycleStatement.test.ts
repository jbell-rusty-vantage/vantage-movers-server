import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSealedAutomationPlan,
  automationRunCompletionStatus,
  buildAutomationOperationId,
  buildLifecycleApply,
  isPendingAutomationActionOutcome,
  isSealedAutomationPlan,
} from "./lifecycleStatement";
import { GranotRunConflict } from "./errors";

const runId = "507f1f77bcf86cd799439011";

function row(values: Record<string, string>, id = "row-1") {
  return { id, rowIndex: 1, values };
}

const collected = {
  prior: "1",
  customer: "Synthetic Customer",
  job_no: "567632",
  ref_no: "synthetic-ref",
  phone: "5550001111",
  email: "lead@example.invalid",
  user: "MIKE",
  rep: "SALES",
  from: "Miami, FL",
  from_zip: "33101",
  to: "Orlando, FL",
  to_zip: "32801",
  est_cf: "1250",
  type: "Local",
};

test("[AC-33] Form Booked statement is booking_action_apply with raw Booked evidence", () => {
  const apply = buildLifecycleApply({
    runId,
    actionId: "Synthetic Forms:row-1",
    row: row(collected),
    sourceLabel: "Synthetic Forms",
    section: "bookedJobs",
    expectedTarget: { model: "FormLead", id: "507f1f77bcf86cd799439099" },
  });
  assert.equal(apply.operation_kind, "booking_action_apply");
  assert.equal(apply.granot_statement.event_type, "Booked");
  assert.equal(apply.granot_statement.user, "MIKE");
  assert.equal(apply.granot_statement.rep, "SALES");
  assert.equal(apply.expected_target?.model, "FormLead");
  assert.equal(
    apply.operation_id,
    buildAutomationOperationId(runId, "Synthetic Forms:row-1"),
  );
});

test("[AC-02] schema-v1 plans fail closed as RUN_REPLAN_REQUIRED", () => {
  const v1 = {
    kind: "form_leads" as const,
    schema_version: 1,
    actions: [
      {
        action_id: "Synthetic Forms:row-1",
        row_id: "row-1",
        source_label: "Synthetic Forms",
        classification: "update",
        lead_id: "507f1f77bcf86cd799439099",
        patch: { quoted: true },
      },
    ],
    counters: { update: 1 },
  };
  assert.equal(isSealedAutomationPlan(v1), false);
  assert.throws(
    () => assertSealedAutomationPlan(v1),
    (error: unknown) => {
      assert.ok(error instanceof GranotRunConflict);
      assert.equal(error.code, "RUN_REPLAN_REQUIRED");
      return true;
    },
  );
});

test("pending lifecycle outcomes keep the run applying", () => {
  assert.equal(isPendingAutomationActionOutcome("accepted_for_processing"), true);
  assert.equal(isPendingAutomationActionOutcome("pending_match"), true);
  assert.equal(
    automationRunCompletionStatus(
      [{ action_id: "a1", outcome: "accepted_for_processing" }],
      ["a1"],
    ),
    "applying",
  );
  assert.equal(
    automationRunCompletionStatus(
      [{ action_id: "a1", outcome: "already_current" }],
      ["a1"],
    ),
    "completed",
  );
  assert.equal(
    automationRunCompletionStatus(
      [{ action_id: "a1", outcome: "technical_failure" }],
      ["a1"],
    ),
    "completed_with_errors",
  );
});
