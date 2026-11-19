import assert from "node:assert/strict";
import { test } from "node:test";
import type { DurableActor } from "../durableWork/types";
import {
  applyAutomationPlanAction,
} from "./automationApply";
import type { ProcessorResult } from "./drainer";

const initiator: DurableActor = {
  actor_type: "owner",
  actor_id: "owner-1",
  actor_label: "owner@example.invalid",
  actor_role: "owner",
  request_id: "req-auto-1",
  origin: "vantage_admin",
};

const lifecycle_apply = {
  operation_id: "507f1f77bcf86cd799439011:Synthetic Forms:row-1",
  operation_kind: "lead_snapshot_apply" as const,
  granot_statement: {
    source: "Synthetic Forms",
    priority: "1",
    user: "MIKE",
    rep: "SALES",
    ref_no: "synthetic-ref",
  },
  expected_target: { model: "FormLead" as const, id: "507f1f77bcf86cd799439099" },
};

function processed(
  outcome: ProcessorResult["outcome"],
): ProcessorResult {
  return {
    observation_id: "obs-1",
    decision_id: "dec-1",
    outcome,
    effects: [],
    target: { model: "FormLead", id: lifecycle_apply.expected_target.id },
  };
}

test("pending_match stays accepted_for_processing until a terminal Decision exists", async () => {
  const result = await applyAutomationPlanAction(
    {
      action_id: "Synthetic Forms:row-1",
      lifecycle_apply,
      initiator,
    },
    {
      capture: async () => ({
        status: "inserted",
        receipt_id: "lifecycle-receipt-1",
        payload_sha256: "a".repeat(64),
      }),
      claimAndProcess: async () => ({
        status: "processed",
        result: processed("pending_match"),
      }),
    },
  );
  assert.equal(result.outcome, "accepted_for_processing");
  assert.equal(result.observation_id, "obs-1");
});

test("processing disabled leaves the durable receipt recoverable", async () => {
  const result = await applyAutomationPlanAction(
    {
      action_id: "Synthetic Forms:row-1",
      lifecycle_apply,
      initiator,
    },
    {
      capture: async () => ({
        status: "inserted",
        receipt_id: "lifecycle-receipt-1",
        payload_sha256: "a".repeat(64),
      }),
      claimAndProcess: async () => ({
        status: "skipped",
        reason: "processing_disabled",
      }),
    },
  );
  assert.equal(result.outcome, "accepted_for_processing");
  assert.equal(result.error_code, "GRANOT_PROCESSING_DISABLED");
});
