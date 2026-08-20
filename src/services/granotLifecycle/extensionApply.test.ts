import assert from "node:assert/strict";
import { test } from "node:test";
import type { DurableActor } from "../durableWork/types";
import {
  applyExtensionGranotItem,
  mapSynchronizationOutcomeMessage,
} from "./extensionApply";
import type { ProcessorResult } from "./drainer";

const initiator: DurableActor = {
  actor_type: "owner",
  actor_id: "owner-1",
  actor_label: "owner@example.invalid",
  actor_role: "owner",
  request_id: "req-1",
  origin: "browser_extension",
};

const item = {
  operation_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  operation_kind: "lead_snapshot_apply" as const,
  granot_statement: {
    source: "Synthetic Forms",
    priority: "1",
    user: "MIKE",
    rep: "SALES",
    ref_no: "synthetic-ref",
  },
  expected_target: { model: "FormLead" as const, id: "507f1f77bcf86cd799439011" },
};

function processed(outcome: ProcessorResult["outcome"], targetId = item.expected_target.id): ProcessorResult {
  return {
    observation_id: "obs-1",
    decision_id: "dec-1",
    outcome,
    effects: [],
    target: { model: "FormLead", id: targetId },
  };
}

test("[AC-33][AC-35] apply captures a browser_extension receipt then claim/process-or-poll", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const claimed: string[] = [];
  const result = await applyExtensionGranotItem(
    { item, initiator, headers: { authorization: "Bearer secret" } },
    {
      capture: async (input) => {
        captured.push(input as unknown as Record<string, unknown>);
        return {
          status: "inserted",
          receipt_id: "receipt-1",
          payload_sha256: "b".repeat(64),
        };
      },
      claimAndProcess: async (receiptId, passedInitiator) => {
        claimed.push(receiptId);
        assert.equal(passedInitiator.origin, "browser_extension");
        return { status: "processed", result: processed("already_current") };
      },
    },
  );
  assert.equal(captured[0]?.observation_channel, "browser_extension");
  assert.equal(captured[0]?.authentication_method, "extension_session");
  assert.equal(captured[0]?.channel_operation_id, item.operation_id);
  assert.deepEqual(captured[0]?.payload, item);
  assert.deepEqual(claimed, ["receipt-1"]);
  assert.equal(result.processing_state, "completed");
  assert.equal(result.outcome, "already_current");
  assert.deepEqual(result.changed_paths, []);
  assert.equal(result.message, "Already current");
  assert.equal(JSON.stringify(result).includes("Bearer"), false);
});

test("[AC-02] replayed capture still returns the stored processor result", async () => {
  const result = await applyExtensionGranotItem(
    { item, initiator, headers: {} },
    {
      capture: async () => ({
        status: "replayed",
        receipt_id: "receipt-1",
        payload_sha256: "b".repeat(64),
      }),
      claimAndProcess: async () => ({
        status: "processed",
        result: processed("linked"),
      }),
    },
  );
  assert.equal(result.receipt_id, "receipt-1");
  assert.equal(result.outcome, "linked");
  assert.equal(result.message, "Lead linked from Granot evidence");
});

test("[AC-02] accepted_for_processing keeps the same operation ID for refresh", async () => {
  const result = await applyExtensionGranotItem(
    { item, initiator, headers: {} },
    {
      capture: async () => ({
        status: "inserted",
        receipt_id: "receipt-pending",
        payload_sha256: "b".repeat(64),
      }),
      claimAndProcess: async () => ({
        status: "accepted_for_processing",
        receipt_id: "receipt-pending",
        state: "claimed",
        next_attempt_at: "2026-08-18T18:00:00.000Z",
      }),
    },
  );
  assert.equal(result.operation_id, item.operation_id);
  assert.equal(result.processing_state, "accepted_for_processing");
  assert.deepEqual(result.changed_paths, []);
  assert.equal(result.message, "Accepted for processing");
});

test("[AC-33] expected_target disagreement is a non-syncable conflict and never an override", async () => {
  const result = await applyExtensionGranotItem(
    { item, initiator, headers: {} },
    {
      capture: async () => ({
        status: "inserted",
        receipt_id: "receipt-1",
        payload_sha256: "b".repeat(64),
      }),
      claimAndProcess: async () => ({
        status: "processed",
        result: processed("applied", "507f1f77bcf86cd799439099"),
      }),
    },
  );
  assert.equal(result.outcome, "conflict");
  assert.equal(result.target?.id, "507f1f77bcf86cd799439099");
  assert.deepEqual(result.changed_paths, []);
});

test("[AC-35] compatibility messages are fixed and never echo payload values", () => {
  assert.equal(mapSynchronizationOutcomeMessage("invalid"), "Invalid Granot statement");
  assert.equal(
    mapSynchronizationOutcomeMessage("conflict").includes("synthetic-ref"),
    false,
  );
});
