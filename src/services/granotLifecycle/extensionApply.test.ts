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
