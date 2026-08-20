import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo } from "../../db";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getOperationalEventModel } from "../../models/OperationalEvent";
import {
  drainDueReceipts,
  drainRequestedReceipt,
  type ProcessorResult,
} from "./drainer";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "./errors";
import { getGranotLifecycleClaimRecoveriesTotal, resetGranotLifecycleMetrics } from "./metrics";
import { requeueDeadLetterReceipt } from "./operations";
import { maskLifecycleId } from "./observability";
import type { RegistryActorContext } from "../operationsRegistry/types";

const OWNER: RegistryActorContext = {
  actorType: "owner",
  actorId: "owner-1",
  actorLabel: "Owner",
  actorRole: "owner",
  requestId: "req-requeue-replica",
};

after(async () => mongoose.disconnect().catch(() => undefined));

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

async function insertReceipt(overrides: {
  state?: "pending" | "claimed" | "retry_scheduled" | "dead_letter";
  technical_attempts?: number;
  match_attempt?: number;
  leased_until?: Date;
  lease_owner?: string;
  next_attempt_at?: Date;
  captured_at?: Date;
}): Promise<mongoose.Types.ObjectId> {
  const capturedAt = overrides.captured_at ?? new Date("2026-08-17T00:00:00.000Z");
  const created = await getGranotObservationReceiptModel().create({
    source_system: "granot",
    observation_channel: "granot_webhook",
    captured_at: capturedAt,
    route_event_class: "lead_created",
    authentication_method: "header_secret",
    evidence_version: 2,
    payload_kind: "object",
    headers: { "content-type": "application/json" },
    payload: { event_type: "lead_created", priority: "1" },
    payload_sha256: "ab".repeat(32),
    processing: {
      state: overrides.state ?? "pending",
      technical_attempts: overrides.technical_attempts ?? 0,
      match_attempt: overrides.match_attempt ?? 0,
      next_attempt_at: overrides.next_attempt_at ?? capturedAt,
      lease_owner: overrides.lease_owner,
      leased_until: overrides.leased_until,
      manual_requeue_count: 0,
    },
    provider: "granot",
  });
  return created._id;
}

function fakeProcessor(outcome: ProcessorResult["outcome"] = "policy_blocked") {
  return {
    async process() {
      return {
        observation_id: new mongoose.Types.ObjectId().toHexString(),
        decision_id: new mongoose.Types.ObjectId().toHexString(),
        outcome,
        effects: [],
      };
    },
  };
}

test("[AC-30] replica-set two claimants have one winner", async (t) => {
  if (!(await replicaReady(t))) {
    return;
  }
  const id = await insertReceipt({});
  const [first, second] = await Promise.all([
    drainRequestedReceipt(String(id), "queue", { processor: fakeProcessor() }),
    drainRequestedReceipt(String(id), "cron", { processor: fakeProcessor() }),
  ]);
  const claimed = [first, second].filter((summary) => summary.claimed === 1);
  assert.equal(claimed.length, 1);
  const row = await getGranotObservationReceiptModel().findById(id).lean();
  assert.ok(row);
  assert.ok(row.processing.state === "completed" || row.processing.state === "claimed");
  await getGranotObservationReceiptModel().collection.deleteOne({ _id: id });
});

test("[AC-30] replica-set expired lease recovers and stale owner cannot finalize", async (t) => {
  if (!(await replicaReady(t))) {
    return;
  }
  resetGranotLifecycleMetrics();
  const id = await insertReceipt({
    state: "claimed",
    technical_attempts: 1,
    lease_owner: "glc_queue_stale",
    leased_until: new Date("2026-08-16T23:00:00.000Z"),
  });
  const summary = await drainRequestedReceipt(String(id), "cron", {
    processor: fakeProcessor(),
  });
  assert.equal(summary.recovered, 1);
  assert.equal(getGranotLifecycleClaimRecoveriesTotal(), 1);
  const stale = await getGranotObservationReceiptModel().updateOne(
    {
      _id: id,
      "processing.state": "claimed",
      "processing.lease_owner": "glc_queue_stale",
    },
    { $set: { "processing.state": "completed" } },
  );
  assert.equal(stale.matchedCount, 0);
  await getGranotObservationReceiptModel().collection.deleteOne({ _id: id });
});

test("[AC-30] replica-set attempt 10 dead-letters with zero Decision", async (t) => {
  if (!(await replicaReady(t))) {
    return;
  }
  const id = await insertReceipt({
    state: "retry_scheduled",
    technical_attempts: 9,
  });
  const summary = await drainRequestedReceipt(String(id), "queue", {
    processor: {
      async process() {
        throw new Error("synthetic dependency unavailable");
      },
    },
  });
  assert.equal(summary.dead_lettered, 1);
  const row = await getGranotObservationReceiptModel().findById(id).lean();
  assert.equal(row?.processing.state, "dead_letter");
  assert.equal(row?.processing.latest_decision_id, undefined);
  await getGranotObservationReceiptModel().collection.deleteOne({ _id: id });
});

test("[AC-37] replica-set concurrent requeue has one winner and one audit", async (t) => {
  if (!(await replicaReady(t))) {
    return;
  }
  const id = await insertReceipt({ state: "dead_letter", technical_attempts: 10 });
  const first = requeueDeadLetterReceipt(
    { id: String(id), reason: "Owner requeue winner for concurrent proof" },
    { ...OWNER, requestId: `req-requeue-win-${Date.now()}` },
  );
  const second = requeueDeadLetterReceipt(
    { id: String(id), reason: "Owner requeue loser for concurrent proof" },
    { ...OWNER, requestId: `req-requeue-lose-${Date.now()}` },
  );
  const results = await Promise.allSettled([first, second]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  if (rejected[0]?.status === "rejected") {
    assert.equal(
      (rejected[0].reason as { code?: string }).code,
      GRANOT_LIFECYCLE_ERROR_CODES.REQUEUE_STATE_CONFLICT,
    );
  }
  const row = await getGranotObservationReceiptModel().findById(id).lean();
  assert.equal(row?.processing.state, "pending");
  assert.equal(row?.processing.manual_requeue_count, 1);
  assert.equal(row?.payload_sha256, "ab".repeat(32));
  const audits = await getOperationalEventModel().countDocuments({
    event_key: "granot_lifecycle.manual_requeue",
    entity_id: maskLifecycleId(String(id)),
  });
  assert.equal(audits, 1);
  await getGranotObservationReceiptModel().collection.deleteOne({ _id: id });
  await getOperationalEventModel().deleteMany({
    event_key: "granot_lifecycle.manual_requeue",
    entity_id: maskLifecycleId(String(id)),
  });
});

test("[AC-30] replica-set queue and cron due scan share the claim fence", async (t) => {
  if (!(await replicaReady(t))) {
    return;
  }
  const id = await insertReceipt({});
  const [queue, cron] = await Promise.all([
    drainRequestedReceipt(String(id), "queue", { processor: fakeProcessor() }),
    drainDueReceipts("cron", { processor: fakeProcessor() }),
  ]);
  const winners = [queue, cron].filter((summary) => summary.claimed === 1);
  assert.equal(winners.length, 1);
  await getGranotObservationReceiptModel().collection.deleteOne({ _id: id });
});
