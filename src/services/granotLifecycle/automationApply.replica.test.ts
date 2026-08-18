import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import type { DurableActor } from "../durableWork/types";
import { applyAutomationPlanAction } from "./automationApply";
import { captureChannelOperationReceipt } from "./capture";
import { OperationIdempotencyConflictError } from "./errors";

const capturedAt = new Date("2026-08-18T16:00:00.000Z");
const initiator: DurableActor = {
  actor_type: "owner",
  actor_id: "owner-auto-replica",
  actor_label: "owner@example.invalid",
  actor_role: "owner",
  request_id: "req-auto-replica",
  origin: "vantage_admin",
};

const ZERO_WRITE_COLLECTIONS = [
  "entity_changes",
  "sheet_sync_jobs",
  "domain_command_executions",
  "booked_leads",
  "cancelled_leads",
] as const;

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
    t.skip("Refusing replica-set proof against a non-test database.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  await mongoose.disconnect().catch(() => undefined);
});

async function countForbidden(): Promise<Record<string, number>> {
  const db = mongoose.connection.db;
  const counts: Record<string, number> = {};
  for (const name of ZERO_WRITE_COLLECTIONS) {
    counts[name] = db ? await db.collection(name).countDocuments() : 0;
  }
  return counts;
}

test("[AC-02] concurrent automation operation ID + same hash yields one receipt", async (t) => {
  if (!(await replicaReady(t))) return;
  const Model = getGranotObservationReceiptModel();
  await Model.syncIndexes();
  const operationId = `${new mongoose.Types.ObjectId().toHexString()}:Synthetic Forms:row-1`;
  await Model.collection.deleteMany({
    observation_channel: "granot_http_automation",
    channel_operation_id: operationId,
  });
  const item = {
    operation_id: operationId,
    operation_kind: "lead_snapshot_apply" as const,
    granot_statement: { source: "Synthetic Forms", priority: "1", user: "MIKE", rep: "SALES" },
  };
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      captureChannelOperationReceipt({
        observation_channel: "granot_http_automation",
        authentication_method: "automation_owner_approval",
        channel_operation_kind: "lead_snapshot_apply",
        channel_operation_id: operationId,
        captured_at: capturedAt,
        headers: {},
        payload: item,
        initiator,
      }),
    ),
  );
  const ids = new Set(results.map((result) => result.receipt_id));
  assert.equal(ids.size, 1);
  assert.equal(results.filter((result) => result.status === "inserted").length, 1);
  assert.equal(results.filter((result) => result.status === "replayed").length, 2);
  const count = await Model.countDocuments({
    observation_channel: "granot_http_automation",
    channel_operation_id: operationId,
  });
  assert.equal(count, 1);
});

test("[AC-02] concurrent automation operation ID + different hash has one winner and 409", async (t) => {
  if (!(await replicaReady(t))) return;
  const Model = getGranotObservationReceiptModel();
  await Model.syncIndexes();
  const operationId = `${new mongoose.Types.ObjectId().toHexString()}:Synthetic Forms:row-2`;
  await Model.collection.deleteMany({
    observation_channel: "granot_http_automation",
    channel_operation_id: operationId,
  });
  const settled = await Promise.allSettled([
    captureChannelOperationReceipt({
      observation_channel: "granot_http_automation",
      authentication_method: "automation_owner_approval",
      channel_operation_kind: "lead_snapshot_apply",
      channel_operation_id: operationId,
      captured_at: capturedAt,
      headers: {},
      payload: {
        operation_id: operationId,
        operation_kind: "lead_snapshot_apply",
        granot_statement: { source: "Synthetic Forms", priority: "1" },
      },
      initiator,
    }),
    captureChannelOperationReceipt({
      observation_channel: "granot_http_automation",
      authentication_method: "automation_owner_approval",
      channel_operation_kind: "lead_snapshot_apply",
      channel_operation_id: operationId,
      captured_at: capturedAt,
      headers: {},
      payload: {
        operation_id: operationId,
        operation_kind: "lead_snapshot_apply",
        granot_statement: { source: "Synthetic Forms", priority: "5" },
      },
      initiator,
    }),
  ]);
  const fulfilled = settled.filter((row) => row.status === "fulfilled");
  const rejected = settled.filter((row) => row.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(
    rejected[0]?.status === "rejected" &&
      rejected[0].reason instanceof OperationIdempotencyConflictError,
  );
  const count = await Model.countDocuments({
    observation_channel: "granot_http_automation",
    channel_operation_id: operationId,
  });
  assert.equal(count, 1);
});

test("[AC-02][AC-33] automation apply captures one receipt, replays it, and writes zero forbidden collections", async (t) => {
  if (!(await replicaReady(t))) return;
  await getGranotObservationReceiptModel().syncIndexes();
  const before = await countForbidden();
  const runId = new mongoose.Types.ObjectId().toHexString();
  const actionId = "Synthetic Forms:row-shadow";
  const operationId = `${runId}:${actionId}`;
  const lifecycle_apply = {
    operation_id: operationId,
    operation_kind: "lead_snapshot_apply" as const,
    granot_statement: {
      source: "Synthetic Forms",
      priority: "1",
      user: "MIKE",
      rep: "SALES",
      ref_no: "synthetic-ref",
    },
  };
  const first = await applyAutomationPlanAction(
    {
      action_id: actionId,
      lifecycle_apply,
      initiator,
      captured_at: capturedAt,
      request_id: runId,
    },
    {
      claimAndProcess: async (receiptId) => ({
        status: "processed",
        result: {
          observation_id: "obs-shadow",
          decision_id: "dec-shadow",
          outcome: "already_current",
          effects: [],
        },
      }),
    },
  );
  const replayedCapture = await captureChannelOperationReceipt({
    observation_channel: "granot_http_automation",
    authentication_method: "automation_owner_approval",
    channel_operation_kind: "lead_snapshot_apply",
    channel_operation_id: operationId,
    captured_at: capturedAt,
    headers: {},
    payload: lifecycle_apply,
    initiator,
  });
  const replay = await applyAutomationPlanAction({
    action_id: actionId,
    lifecycle_apply,
    initiator,
    existing_receipt: first,
    captured_at: capturedAt,
    request_id: runId,
  });
  assert.equal(replayedCapture.status, "replayed");
  assert.equal(replayedCapture.receipt_id, first.lifecycle_receipt_id);
  assert.equal(replay.lifecycle_receipt_id, first.lifecycle_receipt_id);
  assert.equal(replay.outcome, "already_current");
  const receipts = await getGranotObservationReceiptModel().countDocuments({
    observation_channel: "granot_http_automation",
    channel_operation_id: operationId,
  });
  assert.equal(receipts, 1);
  const after = await countForbidden();
  assert.deepEqual(after, before);
});
