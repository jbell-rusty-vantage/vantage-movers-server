import assert from "node:assert/strict";
import { test } from "node:test";
import type { GranotSourceCollection } from "./index";
import {
  assertSafeAutomationOperationId,
  assertSealedAutomationPlan,
  automationRunCompletionStatus,
  buildAutomationOperationId,
  buildGranotStatementFromCollectedRow,
  buildLifecycleApply,
  isPendingAutomationActionOutcome,
  isSealedAutomationPlan,
  resolveAutomationOperationKind,
  sealAutomationPlan,
  type SealableAutomationPlan,
} from "./lifecycleStatement";
import { GranotRunConflict } from "./errors";

const runId = "507f1f77bcf86cd799439011";

function row(values: Record<string, string>, id = "row-1") {
  return { id, rowIndex: 1, values };
}

function source(
  values: Record<string, string>,
  section: "bookedJobs" | "followUpEstimates" = "followUpEstimates",
): GranotSourceCollection {
  return {
    sourceLabel: "Synthetic Forms",
    contentHash: "hash",
    sectionSchemas: {
      bookedJobs: section === "bookedJobs" ? "table" : "empty",
      followUpEstimates: section === "followUpEstimates" ? "table" : "empty",
    },
    sections: {
      bookedJobs: section === "bookedJobs" ? [row(values)] : [],
      followUpEstimates: section === "followUpEstimates" ? [row(values)] : [],
    },
  };
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

test("[AC-33] Form Follow Up statement keeps raw Priority, separate user/rep, and location aliases", () => {
  const statement = buildGranotStatementFromCollectedRow({
    row: row(collected),
    sourceLabel: "Synthetic Forms",
    section: "followUpEstimates",
  });
  assert.equal(statement.source, "Synthetic Forms");
  assert.equal(statement.priority, "1");
  assert.equal(statement.prior, "1");
  assert.equal(statement.customer_name, "Synthetic Customer");
  assert.equal(statement.user, "MIKE");
  assert.equal(statement.rep, "SALES");
  assert.equal(statement.job_no, "567632");
  assert.equal(statement.ref_no, "synthetic-ref");
  assert.equal(statement.from_city, "Miami");
  assert.equal(statement.from_state, "FL");
  assert.equal(statement.from_zip, "33101");
  assert.equal(statement.to_city, "Orlando");
  assert.equal(statement.to_state, "FL");
  assert.equal(statement.to_zip, "32801");
  assert.equal(statement.est_cf, "1250");
  assert.equal(statement.type, "Local");
  assert.equal(statement.event_type, undefined);
  assert.equal(statement.granot_crm_username, undefined);
  assert.notEqual(statement.priority, true);
});

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

test("[AC-33] Call enrichment statement does not collapse user/rep", () => {
  const statement = buildGranotStatementFromCollectedRow({
    row: row({ ...collected, prior: "5" }),
    sourceLabel: "Synthetic Calls",
    section: "followUpEstimates",
  });
  assert.equal(resolveAutomationOperationKind("followUpEstimates"), "lead_snapshot_apply");
  assert.equal(statement.user, "MIKE");
  assert.equal(statement.rep, "SALES");
  assert.equal(statement.priority, "5");
  assert.equal(statement.event_type, undefined);
});

test("[AC-33] Call Booked statement keeps raw Booked and does not infer Release", () => {
  const apply = buildLifecycleApply({
    runId,
    actionId: "booked_reconciliation:Synthetic Calls:row-1",
    row: row({ ...collected, book_date: "08/01/2026" }),
    sourceLabel: "Synthetic Calls",
    section: "bookedJobs",
  });
  assert.equal(apply.operation_kind, "booking_action_apply");
  assert.equal(apply.granot_statement.event_type, "Booked");
  assert.equal(apply.granot_statement.book_date, "08/01/2026");
  assert.equal(apply.granot_statement.user, "MIKE");
  assert.equal(apply.granot_statement.rep, "SALES");
});

test("[AC-02] oversized ${run_id}:${action_id} is rejected before plan lock", () => {
  const actionId = "x".repeat(280);
  assert.throws(
    () => assertSafeAutomationOperationId(buildAutomationOperationId(runId, actionId)),
    (error: unknown) => {
      assert.ok(error instanceof GranotRunConflict);
      assert.equal(error.code, "UNSAFE_OPERATION_ID");
      return true;
    },
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

test("[AC-02] sealing a collected plan stores schema v2 lifecycle_apply before checksum", () => {
  const planned: SealableAutomationPlan = {
    kind: "form_leads",
    schema_version: 1,
    actions: [
      {
        action_id: "Synthetic Forms:row-1",
        row_id: "row-1",
        source_label: "Synthetic Forms",
        table_section: "followUpEstimates",
        classification: "update",
        lead_id: "507f1f77bcf86cd799439099",
      },
    ],
    counters: { update: 1 },
  };
  const sealed = sealAutomationPlan(planned, runId, [
    source(collected, "followUpEstimates"),
  ]);
  assert.equal(sealed.schema_version, 2);
  assert.equal(isSealedAutomationPlan(sealed), true);
  assert.equal(
    sealed.actions[0]?.lifecycle_apply?.operation_kind,
    "lead_snapshot_apply",
  );
  assert.equal(sealed.actions[0]?.lifecycle_apply?.granot_statement.user, "MIKE");
  assert.equal(sealed.actions[0]?.lifecycle_apply?.expected_target?.id, "507f1f77bcf86cd799439099");
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
