import { createHash, randomBytes } from "node:crypto";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { logger } from "../../logger";
import { getRingCentralDirectorySnapshotModel } from "../../models/RingCentralDirectorySnapshot";
import { getSalesIntelligenceSyncStateModel } from "../../models/SalesIntelligenceSyncState";
import { canonicalJson } from "../durableWork/checksum";
import { MongoLeaseStore, type MongoLeaseModel } from "../durableWork/leases";
import type { LeaseToken } from "../durableWork/types";
import { recordOperationalEvent } from "../observability";
import { ringCentralRequest, RingCentralApiError } from "../ringcentral/client";
import { configuredRingCentralAccountId, resolveProviderAccountId, ProviderAccountError } from "./accountIdentity";
import { toE164 } from "./phone";

/**
 * CSI-04 daily directory snapshot sync (02 §9, 03 §0 `directory.ts`, §11).
 *
 * Reads the account's extensions, company numbers and call queues through
 * the shared RingCentral client, normalizes them into one
 * `RingCentralDirectorySnapshot` and appends it only when the digest changed.
 * Own sync-state scope `directory` with a fenced lease; bounded to the last
 * `DIRECTORY_SNAPSHOT_BOUND` snapshots per account. `loadDirectoryLookup`
 * (CSI-02) reads the latest snapshot; with none, roles stay unknown and
 * company classification is not guessed. Rep mapping review is Team C.
 */
export const DIRECTORY_SCOPE = "directory";
export const DIRECTORY_SNAPSHOT_BOUND = 30;
const PER_PAGE = 1000;
const MAX_PAGES_PER_LIST = 20;
const MAX_QUEUES_FOR_MEMBERS = 200;

export type DirectoryFetcher = {
  account(): Promise<unknown>;
  extensions(page: number): Promise<unknown>;
  phoneNumbers(page: number): Promise<unknown>;
  callQueues(page: number): Promise<unknown>;
  callQueueMembers(queueId: string): Promise<unknown>;
};

export function ringCentralDirectoryFetcher(request: typeof ringCentralRequest = ringCentralRequest): DirectoryFetcher {
  const page = (path: string, n: number) => request("GET", `${path}?perPage=${PER_PAGE}&page=${n}`);
  return {
    account: () => request("GET", "/restapi/v1.0/account/~"),
    extensions: (n) => page("/restapi/v1.0/account/~/extension", n),
    phoneNumbers: (n) => page("/restapi/v1.0/account/~/phone-number", n),
    callQueues: (n) => page("/restapi/v1.0/account/~/call-queues", n),
    callQueueMembers: (id) => request("GET", `/restapi/v1.0/account/~/call-queues/${encodeURIComponent(id)}/members?perPage=${PER_PAGE}`),
  };
}

export type NormalizedDirectory = {
  extensions: Array<{
    id: string;
    extension_number: string | null;
    type: string;
    name: string | null;
    status: string;
    direct_numbers: string[];
    sms_sender_numbers: string[];
  }>;
  company_numbers: Array<{ id: string; e164: string; usage_type: string | null; extension_id: string | null }>;
  queues: Array<{ id: string; extension_number: string | null; name: string | null; member_extension_ids: string[] }>;
  counts: { extensions: number; users: number; departments: number; company_numbers: number; queues: number };
};

export type RawDirectory = {
  extensions: unknown[];
  phoneNumbers: unknown[];
  queues: unknown[];
  queueMembers: Map<string, unknown[]>;
};

/** Pure. Provider originals are reduced to the snapshot shape; nothing is inferred. */
export function normalizeDirectory(raw: RawDirectory): NormalizedDirectory {
  const numbers = raw.phoneNumbers
    .map((n) => rec(n))
    .filter((n): n is Record<string, unknown> => n !== null)
    .map((n) => {
      const e164 = toE164(str(n.phoneNumber) ?? "");
      return e164
        ? {
            id: str(n.id) ?? e164,
            e164,
            usage_type: str(n.usageType),
            extension_id: str(rec(n.extension)?.id),
            features: Array.isArray(n.features) ? n.features.map(str).filter((f): f is string => f !== null) : [],
          }
        : null;
    })
    .filter((n): n is NonNullable<typeof n> => n !== null)
    .sort((a, b) => a.e164.localeCompare(b.e164));

  const extensions = raw.extensions
    .map((e) => rec(e))
    .filter((e): e is Record<string, unknown> => e !== null && str(e.id) !== null)
    .map((e) => {
      const id = str(e.id)!;
      const owned = numbers.filter((n) => n.extension_id === id);
      return {
        id,
        extension_number: str(e.extensionNumber),
        type: str(e.type) ?? "Unknown",
        name: str(e.name),
        status: str(e.status) ?? "Unknown",
        direct_numbers: owned.filter((n) => n.usage_type === "DirectNumber").map((n) => n.e164),
        sms_sender_numbers: owned.filter((n) => n.features.includes("SmsSender")).map((n) => n.e164),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const queues = raw.queues
    .map((q) => rec(q))
    .filter((q): q is Record<string, unknown> => q !== null && str(q.id) !== null)
    .map((q) => {
      const id = str(q.id)!;
      const members = (raw.queueMembers.get(id) ?? [])
        .map((m) => str(rec(m)?.id))
        .filter((m): m is string => m !== null)
        .sort();
      return { id, extension_number: str(q.extensionNumber), name: str(q.name), member_extension_ids: members };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    extensions,
    company_numbers: numbers.map(({ features: _f, ...n }) => n),
    queues,
    counts: {
      extensions: extensions.length,
      users: extensions.filter((e) => e.type === "User").length,
      departments: extensions.filter((e) => e.type === "Department").length,
      company_numbers: numbers.length,
      queues: queues.length,
    },
  };
}

export function directoryDigest(normalized: NormalizedDirectory): string {
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

export type DirectorySyncErrorCode =
  | "provider_throttled"
  | "provider_request_failed"
  | "account_unresolved"
  | "account_mismatch"
  | "page_limit"
  | "lease_lost"
  | "state_write_failed"
  | "snapshot_write_failed";

export type DirectorySyncSummary = {
  ran_at: string;
  skipped: boolean;
  skip_reason: "disabled" | "lease_held" | null;
  lease_owner_hash: string | null;
  changed: boolean;
  snapshot_id: string | null;
  digest: string | null;
  counts: NormalizedDirectory["counts"] | null;
  pruned: number;
  truncated: boolean;
  requests: number;
  error_code: DirectorySyncErrorCode | null;
  runtime_ms: number;
};

export type DirectorySyncDependencies = {
  now: () => Date;
  owner: string;
  fetcher: DirectoryFetcher;
  configuredAccountId: string | null;
  recordEvent: typeof recordOperationalEvent;
  requireFlag: boolean;
  leaseTtlMs: number;
  bound: number;
};

class LeaseLostError extends Error {
  constructor() {
    super("CSI directory sync lease lost");
    this.name = "LeaseLostError";
  }
}
class ProviderFailure extends Error {
  constructor(readonly code: DirectorySyncErrorCode) {
    super(code);
    this.name = "ProviderFailure";
  }
}

export async function runDirectorySyncOnce(overrides: Partial<DirectorySyncDependencies> = {}): Promise<DirectorySyncSummary> {
  const deps: DirectorySyncDependencies = {
    now: () => new Date(),
    owner: `csi-directory:${randomBytes(8).toString("hex")}`,
    fetcher: ringCentralDirectoryFetcher(),
    configuredAccountId: configuredRingCentralAccountId(),
    recordEvent: recordOperationalEvent,
    requireFlag: true,
    leaseTtlMs: 300_000,
    bound: DIRECTORY_SNAPSHOT_BOUND,
    ...overrides,
  };
  const startedAt = deps.now();
  const summary: DirectorySyncSummary = {
    ran_at: startedAt.toISOString(),
    skipped: false,
    skip_reason: null,
    lease_owner_hash: null,
    changed: false,
    snapshot_id: null,
    digest: null,
    counts: null,
    pruned: 0,
    truncated: false,
    requests: 0,
    error_code: null,
    runtime_ms: 0,
  };
  if (deps.requireFlag && !csiFlag("DIRECTORY_SYNC")) {
    summary.skipped = true;
    summary.skip_reason = "disabled";
    return summary;
  }

  const State = getSalesIntelligenceSyncStateModel();
  const leaseModel: MongoLeaseModel = {
    findOneAndUpdate: (filter, update, options) => State.findOneAndUpdate(filter, update, { ...options, lean: true }) as never,
    updateOne: (filter, update) => State.updateOne(filter, update),
    findOne: (filter) => State.findOne(filter).lean() as never,
  };
  const leases = new MongoLeaseStore(leaseModel);
  const ownerHash = createHash("sha256").update(deps.owner).digest("hex").slice(0, 12);
  const token = await leases.acquire({ scope: DIRECTORY_SCOPE, owner: deps.owner, ttl_ms: deps.leaseTtlMs, now: startedAt });
  if (!token) {
    summary.skipped = true;
    summary.skip_reason = "lease_held";
    summary.runtime_ms = elapsed(startedAt, deps.now());
    return summary;
  }
  summary.lease_owner_hash = ownerHash;
  let lease: LeaseToken = token;
  const state = (await State.findOne({ scope: DIRECTORY_SCOPE }).lean()) as { consecutive_failures?: number } | null;
  const renew = async () => {
    const renewed = await leases.renew({ token: lease, ttl_ms: deps.leaseTtlMs, now: deps.now() });
    if (!renewed) throw new LeaseLostError();
    lease = renewed;
  };
  const call = async <T>(work: () => Promise<T>): Promise<T> => {
    await renew();
    summary.requests += 1;
    try {
      return await work();
    } catch (error) {
      if (error instanceof RingCentralApiError) {
        throw new ProviderFailure(error.status === 429 ? "provider_throttled" : "provider_request_failed");
      }
      throw error;
    }
  };
  const listAll = async (fetch: (page: number) => Promise<unknown>): Promise<unknown[]> => {
    const out: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES_PER_LIST; page += 1) {
      const response = rec(await call(() => fetch(page)));
      const records = Array.isArray(response?.records) ? response.records : [];
      out.push(...records);
      const nav = rec(response?.navigation);
      const hasNext = Boolean(rec(nav?.nextPage)?.uri);
      if (!hasNext) return out;
    }
    throw new ProviderFailure("page_limit");
  };

  try {
    const account = rec(await call(() => deps.fetcher.account()));
    const accountId = resolveProviderAccountId([str(account?.id)], deps.configuredAccountId);
    const [extensions, phoneNumbers, queues] = [
      await listAll((p) => deps.fetcher.extensions(p)),
      await listAll((p) => deps.fetcher.phoneNumbers(p)),
      await listAll((p) => deps.fetcher.callQueues(p)),
    ];
    const queuesForMembers = [...queues].sort((a, b) =>
      (str(rec(a)?.id) ?? "").localeCompare(str(rec(b)?.id) ?? ""),
    );
    summary.truncated = queuesForMembers.length > MAX_QUEUES_FOR_MEMBERS;
    const queueMembers = new Map<string, unknown[]>();
    for (const queue of queuesForMembers.slice(0, MAX_QUEUES_FOR_MEMBERS)) {
      const id = str(rec(queue)?.id);
      if (!id) continue;
      const response = rec(await call(() => deps.fetcher.callQueueMembers(id)));
      queueMembers.set(id, Array.isArray(response?.records) ? response.records : []);
    }
    const normalized = normalizeDirectory({ extensions, phoneNumbers, queues, queueMembers });
    const digest = directoryDigest(normalized);
    summary.digest = digest;
    summary.counts = normalized.counts;

    const Snapshot = getRingCentralDirectorySnapshotModel();
    const latest = await Snapshot.findOne({ provider_account_id: accountId }).sort({ taken_at: -1 }).lean();
    const takenAt = deps.now();
    if (latest?.digest === digest) {
      summary.snapshot_id = String(latest._id);
    } else {
      try {
        const created = await Snapshot.create([{ provider_account_id: accountId, taken_at: takenAt, digest, ...normalized }]);
        summary.snapshot_id = String(created[0]!._id);
        summary.changed = true;
      } catch (error) {
        if (isDuplicateKey(error)) {
          // A→B→A: unique (account, digest) already holds A. Advance taken_at
          // so loadDirectoryLookup (latest by taken_at) sees the current roster.
          const existing = await Snapshot.findOne({ provider_account_id: accountId, digest }).lean();
          if (!existing) throw new ProviderFailure("snapshot_write_failed");
          await Snapshot.collection.updateOne({ _id: existing._id }, { $set: { taken_at: takenAt } });
          summary.snapshot_id = String(existing._id);
          summary.changed = true;
        } else {
          throw new ProviderFailure("snapshot_write_failed");
        }
      }
      // Bound to the last N snapshots. The model is append-only by design
      // (hooks forbid application-level deletes), so the retention bound is a
      // privileged raw-collection operation, recorded in the summary.
      const stale = await Snapshot.find({ provider_account_id: accountId }, { _id: 1 })
        .sort({ taken_at: -1, _id: -1 })
        .skip(deps.bound)
        .lean();
      if (stale.length) {
        const removed = await Snapshot.collection.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
        summary.pruned = removed.deletedCount ?? 0;
      }
    }

    const finishedAt = deps.now();
    summary.runtime_ms = elapsed(startedAt, finishedAt);
    await writeState(State, lease, finishedAt, {
      started_at: startedAt,
      runtime_ms: summary.runtime_ms,
      records: normalized.counts.extensions + normalized.counts.company_numbers + normalized.counts.queues,
      upserts: summary.changed ? 1 : 0,
      error_code: null,
      consecutive_failures: 0,
      last_sync_to: takenAt,
    });
    await deps.recordEvent(event("completed", "info", summary.ran_at, {
      leaseOwnerHash: ownerHash,
      changed: summary.changed,
      counts: normalized.counts,
      pruned: summary.pruned,
      requests: summary.requests,
    }));
    return summary;
  } catch (error) {
    summary.runtime_ms = elapsed(startedAt, deps.now());
    if (error instanceof LeaseLostError) {
      summary.error_code = "lease_lost";
      await deps.recordEvent(event("failed", "warn", summary.ran_at, { leaseOwnerHash: ownerHash, errorCode: summary.error_code }));
      return summary;
    }
    summary.error_code =
      error instanceof ProviderFailure
        ? error.code
        : error instanceof ProviderAccountError
          ? error.code
          : "state_write_failed";
    logger.warn({
      msg: "sales_intelligence.directory_sync.failed",
      leaseOwnerHash: ownerHash,
      errorCode: summary.error_code,
      errorName: error instanceof Error ? error.name : "Error",
    });
    try {
      await writeState(State, lease, deps.now(), {
        started_at: startedAt,
        runtime_ms: summary.runtime_ms,
        records: 0,
        upserts: 0,
        error_code: summary.error_code,
        consecutive_failures: (state?.consecutive_failures ?? 0) + 1,
        last_sync_to: null,
      });
    } catch {
      /* lease expiry is the recovery path */
    }
    await deps.recordEvent(event("failed", "warn", summary.ran_at, { leaseOwnerHash: ownerHash, errorCode: summary.error_code }));
    return summary;
  }
}

async function writeState(
  State: ReturnType<typeof getSalesIntelligenceSyncStateModel>,
  lease: LeaseToken,
  finishedAt: Date,
  run: { started_at: Date; runtime_ms: number; records: number; upserts: number; error_code: string | null; consecutive_failures: number; last_sync_to: Date | null },
) {
  const set: Record<string, unknown> = {
    consecutive_failures: run.consecutive_failures,
    last_run: {
      started_at: run.started_at,
      finished_at: finishedAt,
      runtime_ms: run.runtime_ms,
      pages: 0,
      records: run.records,
      upserts: run.upserts,
      throttled_count: run.error_code === "provider_throttled" ? 1 : 0,
      error_code: run.error_code,
    },
    lease_owner: null,
    leased_until: finishedAt,
  };
  if (run.last_sync_to) {
    set["cursor.last_sync_to"] = run.last_sync_to;
  }
  const written = await State.updateOne(
    { scope: DIRECTORY_SCOPE, lease_owner: lease.owner, lease_epoch: lease.epoch, leased_until: { $gt: finishedAt } },
    { $set: set },
  );
  if (written.modifiedCount !== 1) throw new LeaseLostError();
}

function event(kind: "completed" | "failed", level: "info" | "warn", runId: string, details: Record<string, unknown>) {
  return {
    level,
    eventKey: `sales_intelligence.directory_sync.${kind}`,
    category: "ringcentral" as const,
    workflow: "sales_intelligence",
    summary: `Directory snapshot sync ${kind}.`,
    runId,
    details,
    notificationCandidate: false,
    reportable: false,
    piiPolicy: "none" as const,
  };
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === 11000);
}
function elapsed(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}
function rec(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
