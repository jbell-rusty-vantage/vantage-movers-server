import { createHash, randomUUID } from "node:crypto";
import { getRingCentralCollectionName } from "./ringcentral-config";
import { getRingCentralDb } from "./ringcentral-mongo";

/**
 * High-water-mark cursor **and** one-winner run lease for the Call Log cron
 * sync. A single document (`key: "account"`) tracks the end of the last
 * successfully processed window so each run only fetches new records (with a
 * configurable overlap to catch late-arriving call-log rows), plus the
 * five-minute renewable lease that elects the single owner of a run.
 *
 * Mongo — not a Vercel invocation, a process-local flag, or a provider
 * response — is the coordination authority (final-spec Sections 4 and 17).
 * Every renewal and terminal write is fenced by
 * `{ key, lease_owner, leased_until: { $gt: now } }`, so a stale owner can
 * never renew, finalize, or clear a successor's lease. Lease expiry is the
 * only recovery mechanism; a terminated process needs no cleanup.
 *
 * Cursor fields (`lastSyncFrom` / `lastSyncTo`) advance only inside the fenced
 * full-success update. Any partial, failed, throttled-incomplete, or
 * lease-lost run leaves them exactly as the previous successful run left them.
 */
const SYNC_STATE_KEY = "account";

export const RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY = SYNC_STATE_KEY;

/**
 * Narrow fail-closed mechanism that makes the specification's singleton claim
 * safe: without it two first-run racers could both insert a `key: "account"`
 * row and both believe they hold the lease.
 */
export const RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX = {
  name: "ringcentral_call_log_sync_state_key_unique",
  key: { key: 1 },
  unique: true,
} as const;

export const RINGCENTRAL_CALL_LOG_LEASE_DURATION_MS = 5 * 60 * 1000;

/** Closed, bounded set of persisted/emitted Call Log run failure codes. */
export const RINGCENTRAL_CALL_LOG_SYNC_ERROR_CODES = [
  "route_snapshot_failed",
  "provider_request_failed",
  "provider_throttled",
  "ingest_failed",
  "state_write_failed",
  "lease_lost",
  "unknown_error",
] as const;

export type RingCentralCallLogSyncErrorCode =
  (typeof RINGCENTRAL_CALL_LOG_SYNC_ERROR_CODES)[number];

export type RingCentralCallLogSyncStateDocument = {
  key: string;
  provider: "ringcentral";
  lastSyncFrom: Date | null;
  lastSyncTo: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: "success" | "error" | null;
  lastError: RingCentralCallLogSyncErrorCode | null;
  lastProcessedCount: number | null;
  lastQualifiedCount: number | null;
  lastLeadActionCount: number | null;
  // Section 17 lease and run telemetry. Absent lease fields mean claimable;
  // absent telemetry means not yet observed.
  lease_owner?: string;
  leased_until?: Date;
  lease_acquired_at?: Date;
  last_runtime_ms?: number;
  last_adopted_count?: number;
  last_adoption_conflict_count?: number;
  last_throttled_count?: number;
  updatedAt: Date;
};

export type RingCentralCallLogLeaseClaim =
  | {
      acquired: true;
      owner: string;
      leaseAcquiredAt: Date;
      leasedUntil: Date;
      /** True when this claim took over an expired predecessor lease. */
      recovered: boolean;
      /** State as observed by the winner at claim time (null on first run). */
      state: RingCentralCallLogSyncStateDocument | null;
    }
  | { acquired: false; reason: "lease_held" };

export type RingCentralCallLogLeaseRenewal = {
  renewed: boolean;
  leasedUntil: Date | null;
};

export type RingCentralCallLogRunTelemetry = {
  runtimeMs: number;
  adoptedCount: number;
  adoptionConflictCount: number;
  throttledCount: number;
};

async function getCollection() {
  const db = await getRingCentralDb();
  return db.collection<RingCentralCallLogSyncStateDocument>(
    getRingCentralCollectionName("callLogSyncState"),
  );
}

/**
 * Bounded opaque per-invocation owner identity. It carries no host name,
 * credential, provider value, or customer value.
 */
export function createCallLogSyncLeaseOwner(): string {
  return `rcls_${randomUUID().replace(/-/g, "")}`;
}

/** PII-safe short digest used in logs, events, and reports. */
export function maskLeaseOwner(owner: string | null | undefined): string | null {
  if (!owner) {
    return null;
  }
  return createHash("sha256").update(owner).digest("hex").slice(0, 12);
}

export async function getCallLogSyncState(): Promise<RingCentralCallLogSyncStateDocument | null> {
  const collection = await getCollection();
  return collection.findOne({ key: SYNC_STATE_KEY });
}

/**
 * Fails closed when the singleton key index is missing. Runtime never creates
 * indexes; `pnpm migration:granot-lifecycle:indexes` owns that deployment.
 */
export async function assertCallLogSyncStateSingletonIndex(): Promise<void> {
  const collection = await getCollection();
  const indexes = await collection.indexes();
  const present = indexes.some(
    (index) =>
      index.unique === true &&
      (index.key as Record<string, unknown>).key === 1 &&
      Object.keys(index.key as Record<string, unknown>).length === 1,
  );
  if (!present) {
    throw new Error(
      "RingCentral Call Log sync requires the unique call-log sync state key index.",
    );
  }
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Atomically claims the singleton lease using
 * `key = "account" AND (leased_until missing OR <= now)`.
 *
 * Never waits or spins. A held lease returns `lease_held` so the caller can
 * record contention and perform no provider, ingest, or state work.
 */
export async function acquireCallLogSyncLease(params: {
  owner: string;
  now: Date;
  leaseDurationMs?: number;
}): Promise<RingCentralCallLogLeaseClaim> {
  const collection = await getCollection();
  const now = params.now;
  const leasedUntil = new Date(
    now.getTime() + (params.leaseDurationMs ?? RINGCENTRAL_CALL_LOG_LEASE_DURATION_MS),
  );
  const leaseSet = {
    lease_owner: params.owner,
    leased_until: leasedUntil,
    lease_acquired_at: now,
    updatedAt: now,
  };

  const previous = await collection.findOneAndUpdate(
    // `$not: { $gt: now }` is exactly "leased_until missing OR <= now", and it
    // also tolerates an explicitly null field (which `$exists: false` would
    // leave permanently unclaimable).
    { key: SYNC_STATE_KEY, leased_until: { $not: { $gt: now } } },
    { $set: leaseSet },
    { returnDocument: "before" },
  );

  if (previous) {
    return {
      acquired: true,
      owner: params.owner,
      leaseAcquiredAt: now,
      leasedUntil,
      recovered: Boolean(
        previous.lease_owner &&
          previous.leased_until &&
          previous.leased_until.getTime() <= now.getTime(),
      ),
      state: previous,
    };
  }

  // Either the singleton does not exist yet, or a live owner holds it. Insert
  // is the first-run claim; the unique key index turns a first-run race into a
  // duplicate-key contention signal rather than a second singleton row.
  try {
    await collection.insertOne({
      key: SYNC_STATE_KEY,
      provider: "ringcentral",
      lastSyncFrom: null,
      lastSyncTo: null,
      lastRunAt: null,
      lastRunStatus: null,
      lastError: null,
      lastProcessedCount: null,
      lastQualifiedCount: null,
      lastLeadActionCount: null,
      ...leaseSet,
    });
    return {
      acquired: true,
      owner: params.owner,
      leaseAcquiredAt: now,
      leasedUntil,
      recovered: false,
      state: null,
    };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { acquired: false, reason: "lease_held" };
    }
    throw error;
  }
}

/**
 * Fenced renewal. A zero-document match means the lease was lost (expired and
 * taken over, or cleared); the caller must stop starting new work and must not
 * write terminal state as the former owner.
 */
export async function renewCallLogSyncLease(params: {
  owner: string;
  now: Date;
  leaseDurationMs?: number;
}): Promise<RingCentralCallLogLeaseRenewal> {
  const collection = await getCollection();
  const leasedUntil = new Date(
    params.now.getTime() +
      (params.leaseDurationMs ?? RINGCENTRAL_CALL_LOG_LEASE_DURATION_MS),
  );
  const result = await collection.updateOne(
    ownerFence(params.owner, params.now),
    { $set: { leased_until: leasedUntil, updatedAt: params.now } },
  );
  return result.matchedCount === 1
    ? { renewed: true, leasedUntil }
    : { renewed: false, leasedUntil: null };
}

function ownerFence(owner: string, now: Date) {
  return {
    key: SYNC_STATE_KEY,
    lease_owner: owner,
    leased_until: { $gt: now },
  };
}

const CLEAR_LEASE = {
  lease_owner: "",
  leased_until: "",
  lease_acquired_at: "",
} as const;

/**
 * Fenced full-success finalization. This is the only place the cursor moves,
 * and it moves only when the entire bounded run succeeded. Returns false when
 * the owner lost its fence, in which case nothing was written.
 */
export async function recordCallLogSyncSuccess(params: {
  owner: string;
  syncFrom: Date;
  syncTo: Date;
  processedCount: number;
  qualifiedCount: number;
  leadActionCount: number;
  telemetry: RingCentralCallLogRunTelemetry;
  now?: Date;
}): Promise<boolean> {
  const collection = await getCollection();
  const now = params.now ?? new Date();
  const result = await collection.updateOne(ownerFence(params.owner, now), {
    $set: {
      lastSyncFrom: params.syncFrom,
      lastSyncTo: params.syncTo,
      lastRunAt: now,
      lastRunStatus: "success",
      lastError: null,
      lastProcessedCount: params.processedCount,
      lastQualifiedCount: params.qualifiedCount,
      lastLeadActionCount: params.leadActionCount,
      last_runtime_ms: nonNegativeInteger(params.telemetry.runtimeMs),
      last_adopted_count: nonNegativeInteger(params.telemetry.adoptedCount),
      last_adoption_conflict_count: nonNegativeInteger(
        params.telemetry.adoptionConflictCount,
      ),
      last_throttled_count: nonNegativeInteger(params.telemetry.throttledCount),
      updatedAt: now,
    },
    $unset: CLEAR_LEASE,
  });
  return result.matchedCount === 1;
}

/**
 * Fenced terminal error write. Persists a bounded error code only — never a
 * provider body, caller value, or free-form message — and releases the lease.
 * The cursor is deliberately untouched.
 */
export async function recordCallLogSyncError(params: {
  owner: string;
  errorCode: RingCentralCallLogSyncErrorCode;
  telemetry: RingCentralCallLogRunTelemetry;
  now?: Date;
}): Promise<boolean> {
  const collection = await getCollection();
  const now = params.now ?? new Date();
  const errorCode = RINGCENTRAL_CALL_LOG_SYNC_ERROR_CODES.includes(params.errorCode)
    ? params.errorCode
    : "unknown_error";
  const result = await collection.updateOne(ownerFence(params.owner, now), {
    $set: {
      lastRunAt: now,
      lastRunStatus: "error",
      lastError: errorCode,
      last_runtime_ms: nonNegativeInteger(params.telemetry.runtimeMs),
      last_throttled_count: nonNegativeInteger(params.telemetry.throttledCount),
      updatedAt: now,
    },
    $unset: CLEAR_LEASE,
  });
  return result.matchedCount === 1;
}

/**
 * Fenced release with no terminal fact change. An old owner's release can
 * never clear a successor's lease.
 */
export async function releaseCallLogSyncLease(params: {
  owner: string;
  now?: Date;
}): Promise<boolean> {
  const collection = await getCollection();
  const now = params.now ?? new Date();
  const result = await collection.updateOne(ownerFence(params.owner, now), {
    $set: { updatedAt: now },
    $unset: CLEAR_LEASE,
  });
  return result.matchedCount === 1;
}
