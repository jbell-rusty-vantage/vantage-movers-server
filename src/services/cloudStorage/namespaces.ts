import type { Db } from "mongodb";
import { CloudStorageError, type LifecycleRule, type ObjectStore, type ReusePolicy, type ReviewPolicy } from "./contract";
import type { BucketDriver } from "./driver";
import { createGcsDriver } from "./gcsDriver";
import { createObjectStore } from "./objectStore";

/**
 * Runtime configuration (Mongo, never an env var). One document per namespace:
 * `cloud_storage_control` `{ _id: "<namespace>", bucket?, prefix?, recovery_days?, updated_at, updated_by, reason }`.
 * A missing document or missing field means the code default below, which is today's production
 * value, so adopting the module changes nothing until the Owner writes a document. A present but
 * invalid value fails closed. Credentials stay in env (`googleAuth/serviceAccount.ts`).
 *
 * Until the Owner decides how a namespace may move (locators record neither bucket nor prefix),
 * `bucket` and `prefix` may only restate the built-in values; any other value is refused. A prefix
 * under another lifecycle rule (the 8-day backup rule) would otherwise expire live objects.
 */
export const CLOUD_STORAGE_CONTROL_COLLECTION = "cloud_storage_control";

export type CloudStorageNamespace =
  | "granot-history" | "sales-intelligence-packs" | "sales-intelligence-retirement" | "ringcentral-webhook-receipts"
  | "domain-records-retirement";

type NamespaceDefinition = {
  bucket: string;
  /** Store prefix; the database name is the next path segment for every current namespace. */
  prefix: string;
  /** Days from the recovery-clock marker to lifecycle deletion. The bucket rule must agree. */
  recoveryDays: number;
  holdKeys: Record<string, string>;
  reuse: ReusePolicy;
  /** The release review every recovery clock and delete must pass. Absent: no direct delete. */
  review?: ReviewPolicy;
  /** Names a put may create already on their recovery clock (a sealed catalog). Absent: none. */
  sealedNames?: RegExp;
  timeouts: { readMs: number; writeMs: number };
};

const PRIVATE_BACKUP_BUCKET = "vantage-mongodb-backups-496816";

export const CLOUD_STORAGE_NAMESPACES: Record<CloudStorageNamespace, NamespaceDefinition> = {
  /** Granot history chunks, month pages, closed runs, scheduled runs and retired receipts. */
  "granot-history": {
    bucket: PRIVATE_BACKUP_BUCKET,
    prefix: "history/granot/v1/",
    /** Owner decision 1 (2026-11-23): 90 days, the top of the 60–90 day band, for both older namespaces. */
    recoveryDays: 90,
    holdKeys: { publisher: "granotPublisherHold", review: "granotReleaseReview" },
    reuse: { mode: "rehold", holder: "publisher", cancels: ["review"] },
    /** 800 s: the server's maximum invocation lifetime, so any publication already in flight has finished. */
    review: { holder: "review", drainMs: 800_000 },
    timeouts: { readMs: 15_000, writeMs: 30_000 },
  },
  /** Sales Intelligence job rollback packs and their sealed range catalogs. */
  "sales-intelligence-packs": {
    bucket: PRIVATE_BACKUP_BUCKET,
    prefix: "history/sales-intelligence/v1/",
    recoveryDays: 90,
    holdKeys: {},
    reuse: { mode: "refuse_released" },
    sealedNames: /\/catalog\.json$/,
    timeouts: { readMs: 30_000, writeMs: 60_000 },
  },
  /**
   * Validated retirement of completed Sales Intelligence jobs (docs/knowledge/validated-retirement.md). Every pack is a
   * disposable copy whose recovery clock starts at creation, so the bucket deletes it 90 days later.
   */
  "sales-intelligence-retirement": {
    bucket: PRIVATE_BACKUP_BUCKET,
    prefix: "history/sales-intelligence/v2/",
    recoveryDays: 90,
    holdKeys: {},
    reuse: { mode: "refuse_released" },
    sealedNames: /\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.bson\.gz$/,
    timeouts: { readMs: 30_000, writeMs: 60_000 },
  },
  /**
   * Validated retirement of proven RingCentral webhook receipts (docs/knowledge/validated-retirement.md). Same shape
   * as the Sales Intelligence retirement packs: disposable from birth, deleted by the bucket 90 days after creation.
   */
  "ringcentral-webhook-receipts": {
    bucket: PRIVATE_BACKUP_BUCKET,
    prefix: "history/ringcentral-webhook-receipts/v1/",
    recoveryDays: 90,
    holdKeys: {},
    reuse: { mode: "refuse_released" },
    sealedNames: /\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.bson\.gz$/,
    timeouts: { readMs: 30_000, writeMs: 60_000 },
  },
  /**
   * Validated retirement of Domain Command history: proven `entity_changes` and `domain_command_executions` rows
   * (`domainCommands/retirement/`). Same sealed pack shape: disposable from birth, deleted by the bucket 90 days after
   * creation. Both collections share the prefix; each has its own catalog collection.
   */
  "domain-records-retirement": {
    bucket: PRIVATE_BACKUP_BUCKET,
    prefix: "history/domain-records/v1/",
    recoveryDays: 90,
    holdKeys: {},
    reuse: { mode: "refuse_released" },
    sealedNames: /\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.bson\.gz$/,
    timeouts: { readMs: 30_000, writeMs: 60_000 },
  },
};

/** Metadata key the Granot release review stores its evidence digest under. */
export const GRANOT_RELEASE_EVIDENCE_KEY = "granotReleaseEvidence";
/** Content types of today's objects. */
export const CONTENT_TYPES = { granotHistory: "application/octet-stream", pack: "application/gzip", catalog: "application/json" } as const;

export type ResolvedNamespace = NamespaceDefinition & { namespace: CloudStorageNamespace; source: "default" | "mongo" };

const BUCKET = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;
const PREFIX = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9._-]+)*\/$/;
const HASH = /^[a-f0-9]{64}$/;
const GRANOT_DATABASE = /^(vantagemovers|testvantagemovers(?:_[a-z0-9]+)?)$/;

function invalid(message: string): never {
  throw new CloudStorageError("invalid_configuration", message);
}

export async function readCloudStorageConfig(db: Db, namespace: CloudStorageNamespace): Promise<ResolvedNamespace> {
  const definition = CLOUD_STORAGE_NAMESPACES[namespace] ?? invalid(`Unknown storage namespace ${namespace}`);
  const row = await db
    .collection<{ _id: string; bucket?: unknown; prefix?: unknown; recovery_days?: unknown }>(CLOUD_STORAGE_CONTROL_COLLECTION)
    .findOne({ _id: namespace });
  if (!row) return { ...definition, namespace, source: "default" };
  const resolved: ResolvedNamespace = { ...definition, namespace, source: "mongo" };
  if (row.bucket !== undefined) {
    if (typeof row.bucket !== "string" || !BUCKET.test(row.bucket)) invalid(`${namespace}: invalid bucket`);
    if (row.bucket !== definition.bucket) invalid(`${namespace}: moving the bucket is not supported until the Owner decides namespace moves`);
  }
  if (row.prefix !== undefined) {
    if (typeof row.prefix !== "string" || !PREFIX.test(row.prefix)) invalid(`${namespace}: invalid prefix`);
    if (row.prefix !== definition.prefix) invalid(`${namespace}: moving the prefix is not supported until the Owner decides namespace moves`);
  }
  if (row.recovery_days !== undefined) {
    if (!Number.isInteger(row.recovery_days) || (row.recovery_days as number) < 1 || (row.recovery_days as number) > 3650) {
      invalid(`${namespace}: invalid recovery_days`);
    }
    resolved.recoveryDays = row.recovery_days as number;
  }
  return resolved;
}

export type StoreCapability = "write" | "release";
export type OpenOptions = {
  /** `write` (default): put, read, list and holds. `release` also starts recovery clocks and deletes. */
  capability?: StoreCapability;
  /** Test seam (a fake bucket). */
  driver?: BucketDriver;
  now?: () => Date;
};

function build(config: ResolvedNamespace, driver: BucketDriver, canRelease: boolean, now?: () => Date): ObjectStore {
  return createObjectStore(driver, {
    prefix: config.prefix, holdKeys: config.holdKeys, reuse: config.reuse, review: config.review,
    sealedNames: config.sealedNames, canRelease, now,
  });
}
const driverFor = (config: ResolvedNamespace, driver?: BucketDriver) =>
  driver ?? createGcsDriver({ bucket: config.bucket, timeouts: config.timeouts });

/** A write-capable store for an already resolved namespace. It can never start a recovery clock or delete. */
export function storeForNamespace(config: ResolvedNamespace, driver?: BucketDriver, now?: () => Date): ObjectStore {
  return build(config, driverFor(config, driver), false, now);
}

/**
 * Resolves the namespace from Mongo and opens its store. A `release` store is returned only after
 * the bucket lifecycle rule for `<prefix><database>/` has been read and matches the namespace's
 * recovery days (`checkRecoveryPolicy`), so nothing is released into an unexpected expiry rule.
 */
export async function openObjectStore(db: Db, namespace: CloudStorageNamespace, options: OpenOptions = {}) {
  const config = await readCloudStorageConfig(db, namespace);
  const driver = driverFor(config, options.driver);
  if (options.capability !== "release") return { config, store: build(config, driver, false, options.now) };
  const scope = `${config.prefix}${db.databaseName}/`;
  const policy = checkRecoveryPolicy(await driver.lifecycle(), scope, config.recoveryDays);
  if (!policy.ok) invalid(`${namespace}: lifecycle rule check failed: ${policy.reason}`);
  return { config, store: build(config, driver, true, options.now) };
}

/** Today's Granot address: `history/granot/v1/<database>/<hh>/<sha256>.bson.gz`, content-addressed. */
export function granotHistoryObjectName(prefix: string, database: string, hash: string) {
  if (!GRANOT_DATABASE.test(database) || !HASH.test(hash)) throw new CloudStorageError("invalid_name", "Invalid Granot archive address");
  return `${prefix}${database}/${hash.slice(0, 2)}/${hash}.bson.gz`;
}

/** Today's Sales Intelligence address: `history/sales-intelligence/v1/<database>/<run>/<sha256>.bson.gz | catalog.json`. */
export function salesIntelligencePackObjectName(prefix: string, database: string, run: string, file: string) {
  if (database !== "vantagemovers" && !/^testvantagemovers(?:_[a-z0-9]+)?$/.test(database)) {
    throw new CloudStorageError("invalid_name", "Invalid pack database");
  }
  if (!/^[a-f0-9-]{36}$/.test(run) || !(file === "catalog.json" || /^[a-f0-9]{64}\.bson\.gz$/.test(file))) {
    throw new CloudStorageError("invalid_name", "Invalid pack address");
  }
  return `${prefix}${database}/${run}/${file}`;
}

/**
 * Validated-retirement pack address, content-addressed: `<prefix><database>/<YYYY-MM-DD>/<sha256>.bson.gz`, for the
 * `sales-intelligence-retirement` (`history/sales-intelligence/v2/`), `ringcentral-webhook-receipts` and
 * `domain-records-retirement` namespaces.
 */
export function retirementPackObjectName(prefix: string, database: string, day: string, hash: string) {
  if (database !== "vantagemovers" && !/^testvantagemovers(?:_[a-z0-9]+)?$/.test(database)) {
    throw new CloudStorageError("invalid_name", "Invalid pack database");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !HASH.test(hash)) throw new CloudStorageError("invalid_name", "Invalid pack address");
  return `${prefix}${database}/${day}/${hash}.bson.gz`;
}

/**
 * Checks, read-only, that exactly one bucket Delete rule governs `scope` (a store prefix plus the
 * database segment) and that it deletes `days` after the recovery-clock marker. The module never
 * writes lifecycle rules: a change is an Owner-approved bucket change.
 */
export function checkRecoveryPolicy(rules: LifecycleRule[], scope: string, days: number): { ok: true } | { ok: false; reason: string } {
  const overlapping = rules.filter((rule) => rule.action?.type === "Delete" &&
    (!rule.condition?.matchesPrefix || rule.condition.matchesPrefix.some((p) => scope.startsWith(p) || p.startsWith(scope))));
  if (overlapping.length !== 1) return { ok: false, reason: `expected one Delete rule for ${scope}, found ${overlapping.length}` };
  const [rule] = overlapping;
  if (!rule.condition.matchesPrefix?.some((p) => scope.startsWith(p))) return { ok: false, reason: `Delete rule does not cover all of ${scope}` };
  if (rule.condition.daysSinceCustomTime !== days) return { ok: false, reason: `Delete rule is not daysSinceCustomTime ${days}` };
  const extra = Object.keys(rule.condition).filter((key) => key !== "matchesPrefix" && key !== "daysSinceCustomTime");
  if (extra.length) return { ok: false, reason: `Delete rule has extra conditions: ${extra.join(", ")}` };
  return { ok: true };
}
