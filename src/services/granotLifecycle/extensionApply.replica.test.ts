import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { captureChannelOperationReceipt } from "./capture";
import { OperationIdempotencyConflictError } from "./errors";
import type { DurableActor } from "../durableWork/types";

const capturedAt = new Date("2026-08-18T16:00:00.000Z");
const initiator: DurableActor = {
  actor_type: "owner",
  actor_id: "owner-replica",
  actor_label: "owner@example.invalid",
  actor_role: "owner",
  request_id: "req-replica",
  origin: "browser_extension",
};

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(mongoose.connection.db?.databaseName ?? "")) {
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

test("[AC-02] concurrent same operation ID + same hash yields one receipt", async (t) => {
  if (!(await replicaReady(t))) return;
  const Model = getGranotObservationReceiptModel();
  await Model.syncIndexes();
  const operationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  await Model.collection.deleteMany({
    observation_channel: "browser_extension",
    channel_operation_id: operationId,
  });
  const item = {
    operation_id: operationId,
    operation_kind: "lead_snapshot_apply" as const,
    granot_statement: { source: "Synthetic Forms", priority: "1" },
  };
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      captureChannelOperationReceipt({
        observation_channel: "browser_extension",
        authentication_method: "extension_session",
        channel_operation_kind: "lead_snapshot_apply",
        channel_operation_id: operationId,
        captured_at: capturedAt,
        headers: { "content-type": "application/json" },
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
    observation_channel: "browser_extension",
    channel_operation_id: operationId,
  });
  assert.equal(count, 1);
});

test("[AC-02] concurrent same operation ID + different hash has one winner and 409", async (t) => {
  if (!(await replicaReady(t))) return;
  const Model = getGranotObservationReceiptModel();
  await Model.syncIndexes();
  const operationId = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  await Model.collection.deleteMany({
    observation_channel: "browser_extension",
    channel_operation_id: operationId,
  });
  const settled = await Promise.allSettled([
    captureChannelOperationReceipt({
      observation_channel: "browser_extension",
      authentication_method: "extension_session",
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
      observation_channel: "browser_extension",
      authentication_method: "extension_session",
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
    observation_channel: "browser_extension",
    channel_operation_id: operationId,
  });
  assert.equal(count, 1);
});
