import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Collection } from "mongodb";
import mongoose from "mongoose";
import { connectMongo } from "../../db";
import {
  acquireCallLogSyncLease,
  assertCallLogSyncStateSingletonIndex,
  createCallLogSyncLeaseOwner,
  getCallLogSyncState,
  maskLeaseOwner,
  recordCallLogSyncError,
  recordCallLogSyncSuccess,
  releaseCallLogSyncLease,
  renewCallLogSyncLease,
  RINGCENTRAL_CALL_LOG_LEASE_DURATION_MS,
  RINGCENTRAL_CALL_LOG_SYNC_ERROR_CODES,
  RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY,
  RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX,
  type RingCentralCallLogSyncStateDocument,
} from "./call-log-sync-state.store";
import { getRingCentralCollectionName } from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";

/**
 * Unit 21 / AC-17 — Mongo is the sole coordination authority for the Call Log
 * sync state lease.
 *
 * The contract assertions below are pure. The lease semantics require real
 * Mongo behavior (atomic conditional update, unique-key contention), so they
 * are opt-in through the same replica-proof posture Unit 20 used and are
 * registered with `pnpm test:granot-lifecycle:replica -- --unit=21`. Every
 * clock value is supplied explicitly, so expiry, renewal, and takeover are
 * deterministic without any waiting.
 */

const T0 = new Date("2026-08-18T12:00:00.000Z");
const LEASE_MS = RINGCENTRAL_CALL_LOG_LEASE_DURATION_MS;

const emptyTelemetry = {
  runtimeMs: 1200,
  adoptedCount: 0,
  adoptionConflictCount: 0,
  throttledCount: 0,
};

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

function replicaProofEnabled(): boolean {
  return (
    process.env.GRANOT_LIFECYCLE_REPLICA_TESTS === "true" &&
    process.env.TEST_MODE === "true" &&
    /^testvantagemovers/i.test(process.env.MONGO_DB_NAME ?? "") &&
    process.env.RINGCENTRAL_COLLECTION_MODE === "test" &&
    process.env.SHEET_SYNC_MODE === "disabled"
  );
}

let collection: Collection<RingCentralCallLogSyncStateDocument>;

before(async () => {
  if (!replicaProofEnabled()) return;
  await connectMongo();
  assert.match(mongoose.connection.name, /^testvantagemovers/i);
  assert.equal(process.env.RINGCENTRAL_COLLECTION_MODE, "test");
  const db = await getRingCentralDb();
  collection = db.collection<RingCentralCallLogSyncStateDocument>(
    getRingCentralCollectionName("callLogSyncState"),
  );
  // Disposable test database only. Production index deployment is owned by
  // `pnpm migration:granot-lifecycle:indexes`.
  await collection.createIndex(RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX.key, {
    name: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX.name,
    unique: true,
  });
});

after(async () => {
  if (!replicaProofEnabled()) return;
  await collection.deleteMany({ key: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY });
  await mongoose.disconnect().catch(() => undefined);
});

async function resetState(): Promise<void> {
  await collection.deleteMany({ key: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY });
}

test("[AC-17] lease owner identity is bounded, opaque, and per invocation", () => {
  const first = createCallLogSyncLeaseOwner();
  const second = createCallLogSyncLeaseOwner();
  assert.match(first, /^rcls_[0-9a-f]{32}$/);
  assert.notEqual(first, second);
  assert.ok(first.length <= 64);
});

test("[AC-17] masked owner is a short stable digest and never leaks the owner", () => {
  const owner = createCallLogSyncLeaseOwner();
  const masked = maskLeaseOwner(owner);
  assert.match(masked ?? "", /^[0-9a-f]{12}$/);
  assert.equal(maskLeaseOwner(owner), masked);
  assert.equal(owner.includes(masked ?? "zzz"), false);
  assert.equal(maskLeaseOwner(null), null);
});

test("[AC-17] singleton key index contract is the exact unique key index", () => {
  assert.deepEqual(RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX, {
    name: "ringcentral_call_log_sync_state_key_unique",
    key: { key: 1 },
    unique: true,
  });
  assert.equal(RINGCENTRAL_CALL_LOG_LEASE_DURATION_MS, 5 * 60 * 1000);
});

test("persisted run failure codes are a bounded, non-sensitive set", () => {
  for (const code of RINGCENTRAL_CALL_LOG_SYNC_ERROR_CODES) {
    assert.match(code, /^[a-z][a-z0-9_]{0,63}$/);
  }
  assert.equal(new Set(RINGCENTRAL_CALL_LOG_SYNC_ERROR_CODES).size, 7);
});

test("[AC-17] Mongo state lease elects exactly one winner", async (t) => {
  if (!replicaProofEnabled()) {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return;
  }

  await t.test("first claim initializes the singleton and wins", async () => {
    await resetState();
    const owner = createCallLogSyncLeaseOwner();
    const claim = await acquireCallLogSyncLease({ owner, now: T0 });
    assert.equal(claim.acquired, true);
    if (!claim.acquired) return;
    assert.equal(claim.recovered, false);
    assert.equal(claim.state, null);
    assert.deepEqual(claim.leasedUntil, at(LEASE_MS));

    const stored = await getCallLogSyncState();
    assert.equal(stored?.lease_owner, owner);
    assert.deepEqual(stored?.leased_until, at(LEASE_MS));
    assert.deepEqual(stored?.lease_acquired_at, T0);
    assert.equal(stored?.lastSyncTo, null);
    assert.equal(await collection.countDocuments({ key: "account" }), 1);
  });

  await t.test("simultaneous first-run claimers yield one winner", async () => {
    await resetState();
    const owners = [
      createCallLogSyncLeaseOwner(),
      createCallLogSyncLeaseOwner(),
      createCallLogSyncLeaseOwner(),
    ];
    const claims = await Promise.all(
      owners.map((owner) => acquireCallLogSyncLease({ owner, now: T0 })),
    );
    const winners = claims.filter((claim) => claim.acquired);
    const losers = claims.filter((claim) => !claim.acquired);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 2);
    for (const loser of losers) {
      assert.equal(loser.acquired, false);
      if (!loser.acquired) assert.equal(loser.reason, "lease_held");
    }
    assert.equal(await collection.countDocuments({ key: "account" }), 1);
  });

  await t.test("simultaneous claims over an existing row yield one winner", async () => {
    await resetState();
    await acquireCallLogSyncLease({
      owner: createCallLogSyncLeaseOwner(),
      now: T0,
    });
    const claims = await Promise.all([
      acquireCallLogSyncLease({
        owner: createCallLogSyncLeaseOwner(),
        now: at(LEASE_MS),
      }),
      acquireCallLogSyncLease({
        owner: createCallLogSyncLeaseOwner(),
        now: at(LEASE_MS),
      }),
    ]);
    assert.equal(claims.filter((claim) => claim.acquired).length, 1);
    assert.equal(await collection.countDocuments({ key: "account" }), 1);
  });

  await t.test("a held lease blocks takeover until exact expiry", async () => {
    await resetState();
    const holder = createCallLogSyncLeaseOwner();
    await acquireCallLogSyncLease({ owner: holder, now: T0 });

    const early = await acquireCallLogSyncLease({
      owner: createCallLogSyncLeaseOwner(),
      now: at(LEASE_MS - 1),
    });
    assert.equal(early.acquired, false);
    if (!early.acquired) assert.equal(early.reason, "lease_held");

    const successor = createCallLogSyncLeaseOwner();
    const takeover = await acquireCallLogSyncLease({
      owner: successor,
      now: at(LEASE_MS),
    });
    assert.equal(takeover.acquired, true);
    if (!takeover.acquired) return;
    assert.equal(takeover.recovered, true);
    assert.equal((await getCallLogSyncState())?.lease_owner, successor);
  });

  await t.test("renewal extends the lease and prevents premature takeover", async () => {
    await resetState();
    const holder = createCallLogSyncLeaseOwner();
    await acquireCallLogSyncLease({ owner: holder, now: T0 });

    const renewal = await renewCallLogSyncLease({
      owner: holder,
      now: at(LEASE_MS - 60_000),
    });
    assert.equal(renewal.renewed, true);
    assert.deepEqual(renewal.leasedUntil, at(LEASE_MS - 60_000 + LEASE_MS));

    const blocked = await acquireCallLogSyncLease({
      owner: createCallLogSyncLeaseOwner(),
      now: at(LEASE_MS),
    });
    assert.equal(blocked.acquired, false);
  });

  await t.test("takeover preserves prior terminal cursor facts", async () => {
    await resetState();
    const first = createCallLogSyncLeaseOwner();
    await acquireCallLogSyncLease({ owner: first, now: T0 });
    await recordCallLogSyncSuccess({
      owner: first,
      syncFrom: at(-3_600_000),
      syncTo: at(1_000),
      processedCount: 4,
      qualifiedCount: 2,
      leadActionCount: 1,
      telemetry: { ...emptyTelemetry, adoptedCount: 2, throttledCount: 1 },
      now: at(1_000),
    });

    const second = createCallLogSyncLeaseOwner();
    const claim = await acquireCallLogSyncLease({
      owner: second,
      now: at(2_000),
    });
    assert.equal(claim.acquired, true);
    if (!claim.acquired) return;
    // A cleanly released lease is not a recovery.
    assert.equal(claim.recovered, false);
    assert.deepEqual(claim.state?.lastSyncTo, at(1_000));
    assert.equal(claim.state?.last_adopted_count, 2);
    assert.equal(claim.state?.last_throttled_count, 1);
  });

  await t.test("a stale owner can neither renew, finalize, clear, nor release", async () => {
    await resetState();
    const stale = createCallLogSyncLeaseOwner();
    await acquireCallLogSyncLease({ owner: stale, now: T0 });
    await recordCallLogSyncSuccess({
      owner: stale,
      syncFrom: at(-3_600_000),
      syncTo: at(1_000),
      processedCount: 1,
      qualifiedCount: 1,
      leadActionCount: 0,
      telemetry: emptyTelemetry,
      now: at(1_000),
    });

    const successor = createCallLogSyncLeaseOwner();
    const claim = await acquireCallLogSyncLease({
      owner: successor,
      now: at(2_000),
    });
    assert.equal(claim.acquired, true);

    const renewed = await renewCallLogSyncLease({
      owner: stale,
      now: at(3_000),
    });
    assert.equal(renewed.renewed, false);

    const finalized = await recordCallLogSyncSuccess({
      owner: stale,
      syncFrom: at(-1_000),
      syncTo: at(9_999_999),
      processedCount: 99,
      qualifiedCount: 99,
      leadActionCount: 99,
      telemetry: { ...emptyTelemetry, adoptedCount: 99 },
      now: at(3_000),
    });
    assert.equal(finalized, false);

    const errored = await recordCallLogSyncError({
      owner: stale,
      errorCode: "ingest_failed",
      telemetry: emptyTelemetry,
      now: at(3_000),
    });
    assert.equal(errored, false);

    const released = await releaseCallLogSyncLease({
      owner: stale,
      now: at(3_000),
    });
    assert.equal(released, false);

    const stored = await getCallLogSyncState();
    // Successor's lease intact; the stale owner moved nothing.
    assert.equal(stored?.lease_owner, successor);
    assert.deepEqual(stored?.lastSyncTo, at(1_000));
    assert.equal(stored?.lastRunStatus, "success");
    assert.equal(stored?.last_adopted_count, 0);
  });

  await t.test("full success advances the cursor, records telemetry, clears the lease", async () => {
    await resetState();
    const owner = createCallLogSyncLeaseOwner();
    await acquireCallLogSyncLease({ owner, now: T0 });
    const ok = await recordCallLogSyncSuccess({
      owner,
      syncFrom: at(-43_200_000),
      syncTo: at(5_000),
      processedCount: 12,
      qualifiedCount: 3,
      leadActionCount: 2,
      telemetry: {
        runtimeMs: 4321.9,
        adoptedCount: 1,
        adoptionConflictCount: 1,
        throttledCount: 0,
      },
      now: at(5_000),
    });
    assert.equal(ok, true);
    const stored = await getCallLogSyncState();
    assert.deepEqual(stored?.lastSyncFrom, at(-43_200_000));
    assert.deepEqual(stored?.lastSyncTo, at(5_000));
    assert.equal(stored?.lastRunStatus, "success");
    assert.equal(stored?.lastError, null);
    assert.equal(stored?.last_runtime_ms, 4321);
    assert.equal(stored?.last_adopted_count, 1);
    assert.equal(stored?.last_adoption_conflict_count, 1);
    assert.equal(stored?.last_throttled_count, 0);
    assert.equal("lease_owner" in (stored ?? {}), false);
    assert.equal("leased_until" in (stored ?? {}), false);
    assert.equal("lease_acquired_at" in (stored ?? {}), false);
  });

  await t.test("terminal error keeps the cursor and stores a bounded code", async () => {
    await resetState();
    const first = createCallLogSyncLeaseOwner();
    await acquireCallLogSyncLease({ owner: first, now: T0 });
    await recordCallLogSyncSuccess({
      owner: first,
      syncFrom: at(-43_200_000),
      syncTo: at(1_000),
      processedCount: 1,
      qualifiedCount: 0,
      leadActionCount: 0,
      telemetry: emptyTelemetry,
      now: at(1_000),
    });

    const second = createCallLogSyncLeaseOwner();
    await acquireCallLogSyncLease({ owner: second, now: at(2_000) });
    const ok = await recordCallLogSyncError({
      owner: second,
      errorCode: "provider_throttled",
      telemetry: { ...emptyTelemetry, runtimeMs: 700, throttledCount: 3 },
      now: at(3_000),
    });
    assert.equal(ok, true);

    const stored = await getCallLogSyncState();
    assert.deepEqual(stored?.lastSyncTo, at(1_000));
    assert.equal(stored?.lastRunStatus, "error");
    assert.equal(stored?.lastError, "provider_throttled");
    assert.equal(stored?.last_throttled_count, 3);
    assert.equal("lease_owner" in (stored ?? {}), false);
  });

  await t.test("safe release clears only the lease fields", async () => {
    await resetState();
    const owner = createCallLogSyncLeaseOwner();
    await acquireCallLogSyncLease({ owner, now: T0 });
    await recordCallLogSyncSuccess({
      owner,
      syncFrom: at(-43_200_000),
      syncTo: at(1_000),
      processedCount: 2,
      qualifiedCount: 1,
      leadActionCount: 0,
      telemetry: emptyTelemetry,
      now: at(1_000),
    });
    const next = createCallLogSyncLeaseOwner();
    await acquireCallLogSyncLease({ owner: next, now: at(2_000) });
    assert.equal(
      await releaseCallLogSyncLease({ owner: next, now: at(2_500) }),
      true,
    );
    const stored = await getCallLogSyncState();
    assert.equal("lease_owner" in (stored ?? {}), false);
    assert.deepEqual(stored?.lastSyncTo, at(1_000));
    assert.equal(stored?.lastRunStatus, "success");
  });

  await t.test("the unique key index rejects a second singleton row", async () => {
    await resetState();
    await acquireCallLogSyncLease({
      owner: createCallLogSyncLeaseOwner(),
      now: T0,
    });
    await assert.rejects(
      () =>
        collection.insertOne({
          key: RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY,
          provider: "ringcentral",
          lastSyncFrom: null,
          lastSyncTo: null,
          lastRunAt: null,
          lastRunStatus: null,
          lastError: null,
          lastProcessedCount: null,
          lastQualifiedCount: null,
          lastLeadActionCount: null,
          updatedAt: T0,
        }),
      (error: unknown) => (error as { code?: number }).code === 11000,
    );
    assert.equal(await collection.countDocuments({ key: "account" }), 1);
  });

  await t.test("the singleton index assertion passes once the index exists", async () => {
    await assert.doesNotReject(() => assertCallLogSyncStateSingletonIndex());
  });
});
