import assert from "node:assert/strict";
import { test } from "node:test";
import type { DurableActor } from "../durableWork/types";
import { AUTOMATION_APPLY_ITEM_SCHEMA_HINT } from "./applyItem";
import {
  applyAutomationPlanAction,
  type GranotAutomationActionReceipt,
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

test("[AC-02][AC-33] automation apply captures granot_http_automation then claimAndProcessOrPoll", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const claimed: string[] = [];
  const result = await applyAutomationPlanAction(
    {
      action_id: "Synthetic Forms:row-1",
      lifecycle_apply,
      initiator,
    },
    {
      capture: async (input) => {
        captured.push(input as unknown as Record<string, unknown>);
        return {
          status: "inserted",
          receipt_id: "lifecycle-receipt-1",
          payload_sha256: "a".repeat(64),
        };
      },
      claimAndProcess: async (receiptId) => {
        claimed.push(receiptId);
        return { status: "processed", result: processed("already_current") };
      },
    },
  );
  assert.equal(captured[0]?.observation_channel, "granot_http_automation");
  assert.equal(captured[0]?.authentication_method, "automation_owner_approval");
  assert.equal(captured[0]?.channel_operation_id, lifecycle_apply.operation_id);
  assert.equal(captured[0]?.payload_schema_hint, AUTOMATION_APPLY_ITEM_SCHEMA_HINT);
  assert.deepEqual(captured[0]?.headers, {});
  assert.deepEqual(captured[0]?.payload, lifecycle_apply);
  assert.equal((captured[0]?.initiator as DurableActor).origin, "vantage_admin");
  assert.deepEqual(claimed, ["lifecycle-receipt-1"]);
  assert.equal(result.lifecycle_receipt_id, "lifecycle-receipt-1");
  assert.equal(result.observation_id, "obs-1");
  assert.equal(result.decision_id, "dec-1");
  assert.equal(result.outcome, "already_current");
});

test("[AC-02] exact replay returns the stored terminal receipt without another capture", async () => {
  const existing: GranotAutomationActionReceipt = {
    action_id: "Synthetic Forms:row-1",
    lifecycle_receipt_id: "lifecycle-receipt-1",
    observation_id: "obs-1",
    decision_id: "dec-1",
    outcome: "already_current",
    applied_at: new Date("2026-08-18T16:00:00.000Z"),
  };
  let captureCalls = 0;
  const result = await applyAutomationPlanAction(
    {
      action_id: "Synthetic Forms:row-1",
      lifecycle_apply,
      initiator,
      existing_receipt: existing,
    },
    {
      capture: async () => {
        captureCalls += 1;
        throw new Error("exact replay must not recapture");
      },
    },
  );
  assert.equal(captureCalls, 0);
  assert.deepEqual(result, existing);
});

test("[AC-02] accepted_for_processing yields a nonterminal receipt for the same operation ID", async () => {
  const result = await applyAutomationPlanAction(
    {
      action_id: "Synthetic Forms:row-1",
      lifecycle_apply,
      initiator,
      existing_receipt: {
        action_id: "Synthetic Forms:row-1",
        lifecycle_receipt_id: "lifecycle-receipt-1",
        outcome: "accepted_for_processing",
        applied_at: new Date("2026-08-18T16:00:00.000Z"),
      },
    },
    {
      capture: async (input) => {
        assert.equal(input.channel_operation_id, lifecycle_apply.operation_id);
        return {
          status: "replayed",
          receipt_id: "lifecycle-receipt-1",
          payload_sha256: "a".repeat(64),
        };
      },
      claimAndProcess: async () => ({
        status: "accepted_for_processing",
        receipt_id: "lifecycle-receipt-1",
        state: "retry_scheduled",
        next_attempt_at: "2026-08-18T16:05:00.000Z",
      }),
    },
  );
  assert.equal(result.outcome, "accepted_for_processing");
  assert.equal(result.lifecycle_receipt_id, "lifecycle-receipt-1");
});

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

test("dead-lettered receipts become bounded technical_failure", async () => {
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
        status: "accepted_for_processing",
        receipt_id: "lifecycle-receipt-1",
        state: "dead_letter",
        next_attempt_at: "2026-08-18T16:05:00.000Z",
      }),
    },
  );
  assert.equal(result.outcome, "technical_failure");
  assert.equal(result.error_code, "GRANOT_RECEIPT_DEAD_LETTER");
  assert.equal(JSON.stringify(result).includes("MIKE"), false);
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
