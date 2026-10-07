/**
 * Disk trim (DISK-TRIM.md, 2026-10-06): the exact scope of what `ops/disk-trim/trim.ts` may delete, expire
 * and drop, and the run itself over an abstract cluster so a test can drive it against an in-memory fake.
 *
 * Every target is an exact name from the brief's allowlist. Nothing here is a prefix, a pattern or a sweep.
 * A dry run (the default) reads only; `apply` performs, in this order, the deletes, the TTL index creation
 * and the drops, each re-checked against the allowlist immediately before it runs.
 */
import type { Document, Filter } from "mongodb";
import { CSI_AUDIT_RETENTION_SECONDS, SALES_INTELLIGENCE_AUDIT_EVENT_INDEXES } from "../../src/models/salesIntelligence/infrastructure";
import { DAILY_OPERATIONS_EVENT_TTL_INDEX } from "../../src/models/DailyOperationsEvent";
import { SHEET_SYNC_ATTEMPT_TTL_INDEX } from "../../src/models/SheetSyncAttempt";
import { SHEET_SYNC_RUN_TTL_INDEX } from "../../src/models/SheetSyncRun";
import { WEBHOOK_EVENT_TTL_INDEX } from "../../src/services/ringcentral/webhook-capture";

export const DISK_TRIM_DATABASE = "vantagemovers";
export const DISK_TRIM_VERSION = "disk-trim-v1";
const DAY_MS = 86_400_000;

/** Worker call-capture audit kinds: no screen reads them and their writers are gone (DISK-TRIM.md §1). */
export const WORKER_AUDIT_KINDS = [
  "interaction.updated",
  "interaction.created",
  "interaction.merged",
  "capture_projection.completed",
  "call_log_refresh.completed",
  "attachment_refreshed",
  "attachment_auto_attached",
  "attachment_auto_contested",
] as const;

export type DeleteScope = {
  id: string;
  collection: string;
  /** The rows this scope removes, given the run's clock. */
  filter: (now: Date) => Filter<Document>;
  /** Report the deleted rows grouped by this field (the audit kinds). */
  groupBy?: string;
};

const olderThan = (field: string, days: number) => (now: Date) => ({ [field]: { $lt: new Date(now.getTime() - days * DAY_MS) } });

export const DELETE_SCOPES: readonly DeleteScope[] = [
  { id: "audit_worker_kinds", collection: "sales_intelligence_audit_events", filter: () => ({ event_kind: { $in: [...WORKER_AUDIT_KINDS] } }), groupBy: "event_kind" },
  { id: "webhook_receipts_past_7d", collection: "ringcentral_webhook_events", filter: olderThan("receivedAt", 7) },
  { id: "sheet_sync_runs_past_90d", collection: "sheet_sync_runs", filter: olderThan("started_at", 90) },
  { id: "sheet_sync_attempts_past_90d", collection: "sheet_sync_attempts", filter: olderThan("createdAt", 90) },
  { id: "daily_operations_events_past_400d", collection: "daily_operations_events", filter: olderThan("createdAt", 400) },
];

export type TtlIndexTarget = { collection: string; name: string; key: Record<string, 1>; expireAfterSeconds: number };

const auditTtl = SALES_INTELLIGENCE_AUDIT_EVENT_INDEXES.find((i) => i.name === "csi_audit_happened_ttl");
if (!auditTtl || auditTtl.expireAfterSeconds !== CSI_AUDIT_RETENTION_SECONDS) throw new Error("csi_audit_happened_ttl is not declared on the audit model");

/** The TTL indexes the brief adds, taken from the schemas so a fresh environment and production agree. */
export const TTL_INDEXES: readonly TtlIndexTarget[] = [
  { collection: "sales_intelligence_audit_events", name: auditTtl.name, key: auditTtl.key as Record<string, 1>, expireAfterSeconds: CSI_AUDIT_RETENTION_SECONDS },
  { collection: "ringcentral_webhook_events", name: WEBHOOK_EVENT_TTL_INDEX.name, key: { ...WEBHOOK_EVENT_TTL_INDEX.key }, expireAfterSeconds: WEBHOOK_EVENT_TTL_INDEX.expireAfterSeconds },
  { collection: "sheet_sync_runs", name: SHEET_SYNC_RUN_TTL_INDEX.name, key: { ...SHEET_SYNC_RUN_TTL_INDEX.key }, expireAfterSeconds: SHEET_SYNC_RUN_TTL_INDEX.expireAfterSeconds },
  { collection: "sheet_sync_attempts", name: SHEET_SYNC_ATTEMPT_TTL_INDEX.name, key: { ...SHEET_SYNC_ATTEMPT_TTL_INDEX.key }, expireAfterSeconds: SHEET_SYNC_ATTEMPT_TTL_INDEX.expireAfterSeconds },
  { collection: "daily_operations_events", name: DAILY_OPERATIONS_EVENT_TTL_INDEX.name, key: { ...DAILY_OPERATIONS_EVENT_TTL_INDEX.key }, expireAfterSeconds: DAILY_OPERATIONS_EVENT_TTL_INDEX.expireAfterSeconds },
];

export type DropTarget = {
  collection: string;
  reason: string;
  /** The `_test` suffix names: production must be writing the unsuffixed names and the suffix must be idle. */
  requiresProductionCollectionMode: boolean;
  requiresNoInsertsForDays: number | null;
  /** `sales_intelligence_review_items`: refused while any `src/` file still calls `openReview(`. */
  requiresNoOpenReviewCaller: boolean;
};

export const DROP_TARGETS: readonly DropTarget[] = [
  { collection: "ringcentral_webhook_events_test", reason: "test suffix on production; no writes in 30 days", requiresProductionCollectionMode: true, requiresNoInsertsForDays: 30, requiresNoOpenReviewCaller: false },
  { collection: "ringcentral_call_candidates_test", reason: "test suffix on production; no writes in 30 days", requiresProductionCollectionMode: true, requiresNoInsertsForDays: 30, requiresNoOpenReviewCaller: false },
  { collection: "ringcentral_call_candidate_decisions_test", reason: "test suffix on production; no writes in 30 days", requiresProductionCollectionMode: true, requiresNoInsertsForDays: 30, requiresNoOpenReviewCaller: false },
  { collection: "sales_intelligence_owner_instructions", reason: "retired handoff notes; no writer and no reader under src/", requiresProductionCollectionMode: false, requiresNoInsertsForDays: null, requiresNoOpenReviewCaller: false },
  { collection: "sales_intelligence_sync_windows", reason: "no writer and no reader; model existed only to build indexes", requiresProductionCollectionMode: false, requiresNoInsertsForDays: null, requiresNoOpenReviewCaller: false },
  { collection: "sales_intelligence_review_items", reason: "openReview had no caller; the admin route is unregistered", requiresProductionCollectionMode: false, requiresNoInsertsForDays: null, requiresNoOpenReviewCaller: true },
];

/** Live namespaces the report proves present (and counts) before and after; never a target. */
export const PROTECTED_COLLECTIONS = [
  "sales_intelligence_jobs",
  "sales_intelligence_sync_state",
  "sales_intelligence_policy_versions",
  "sales_intelligence_policy_pointers",
  "sales_intelligence_contact_restrictions",
  "sales_intelligence_command_executions",
  "sales_intelligence_coverage_projections",
  "call_interactions",
  "call_interaction_aliases",
  "ringcentral_rep_sms_evidence",
  "ringcentral_call_sessions",
  "ringcentral_processed_calls",
  "sales_outreach_subjects",
  "sales_outreach_contact_events",
  "sales_outreach_live_events",
  "sheet_sync_jobs",
  "form_leads",
  "call_leads",
  "booked_leads",
  "cancelled_leads",
  "entity_changes",
  "contact_numbers",
] as const;

export const DELETE_COLLECTIONS = new Set(DELETE_SCOPES.map((s) => s.collection));
export const DROP_COLLECTIONS = new Set(DROP_TARGETS.map((t) => t.collection));
export const INDEX_COLLECTIONS = new Set(TTL_INDEXES.map((i) => i.collection));

/** Driver commands a dry run may send, and what `--apply` adds. Anything else is refused before it is sent. */
const READ_COMMANDS = new Set(["aggregate", "count", "distinct", "find", "getMore", "killCursors", "listDatabases", "listCollections", "listIndexes", "dbStats", "collStats", "hello", "isMaster", "ismaster", "ping", "buildInfo", "endSessions", "saslStart", "saslContinue", "authenticate"]);
const APPLY_COMMANDS = new Set(["delete", "createIndexes", "drop"]);
export type TrimMode = "dry_run" | "apply";
export function isTrimCommandAllowed(mode: TrimMode, commandName: string): boolean {
  return READ_COMMANDS.has(commandName) || (mode === "apply" && APPLY_COMMANDS.has(commandName));
}

export type ObservedIndex = { name: string; key: Record<string, unknown>; expireAfterSeconds?: number | null; unique?: boolean; partialFilterExpression?: unknown };
export type IndexAction = "create" | "exists" | "conflict";

/** Idempotent plan for one TTL index: same name and shape is `exists`; a name or key clash with a different shape is a `conflict`. */
export function planTtlIndex(target: TtlIndexTarget, observed: readonly ObservedIndex[]): { action: IndexAction; detail: string | null } {
  const sameKey = (a: Record<string, unknown>) => JSON.stringify(a) === JSON.stringify(target.key);
  const byName = observed.find((i) => i.name === target.name);
  if (byName) {
    if (sameKey(byName.key) && byName.expireAfterSeconds === target.expireAfterSeconds && !byName.unique && !byName.partialFilterExpression) return { action: "exists", detail: null };
    return { action: "conflict", detail: `an index named ${target.name} exists with a different shape (${JSON.stringify(byName.key)}, ttl ${byName.expireAfterSeconds ?? "none"})` };
  }
  const byKey = observed.find((i) => sameKey(i.key) && !i.partialFilterExpression);
  if (byKey) {
    if (byKey.expireAfterSeconds === target.expireAfterSeconds) return { action: "exists", detail: `same shape under the name ${byKey.name}` };
    return { action: "conflict", detail: `${byKey.name} already indexes ${JSON.stringify(target.key)} with ttl ${byKey.expireAfterSeconds ?? "none"}` };
  }
  return { action: "create", detail: null };
}

/** The cluster the trim talks to: exact reads, and exact apply-only mutations on allowlisted names. */
export interface TrimCluster {
  databaseName(): string;
  replicaSetName(): Promise<string | null>;
  listCollections(): Promise<string[]>;
  count(collection: string, filter: Filter<Document>): Promise<number>;
  countBy(collection: string, filter: Filter<Document>, field: string): Promise<Record<string, number>>;
  /** Insert time of the newest `_id` (ObjectId timestamp), or null when empty. */
  newestInsertAt(collection: string): Promise<Date | null>;
  indexes(collection: string): Promise<ObservedIndex[]>;
  findIds(collection: string, filter: Filter<Document>, limit: number): Promise<unknown[]>;
  storage(): Promise<{ dataMB: number; storageMB: number; indexMB: number; fsUsedMB: number | null; fsTotalMB: number | null }>;
  deployment(): Promise<{ commit: string | null; recorded_at: string | null; vercel_deployment_id: string | null }>;
  /** `sheet_sync_jobs` rows stuck in `processing` (reported, never touched). */
  stuckSheetSyncJobs(): Promise<Array<{ id: string; operation: string | null; updated_at: string | null }>>;
  // apply only
  deleteByIds(collection: string, ids: unknown[], filter: Filter<Document>): Promise<number>;
  createIndex(collection: string, target: TtlIndexTarget): Promise<void>;
  dropCollection(collection: string): Promise<void>;
}

/** Deletes everything matching `filter` in `_id` pages so the primary never holds one huge multi-delete. */
export async function deleteInBatches(cluster: TrimCluster, collection: string, filter: Filter<Document>, batch: number): Promise<number> {
  if (!DELETE_COLLECTIONS.has(collection)) throw new Error(`refusing to delete from ${collection}: not on the disk-trim allowlist`);
  let deleted = 0;
  for (;;) {
    const ids = await cluster.findIds(collection, filter, batch);
    if (!ids.length) return deleted;
    deleted += await cluster.deleteByIds(collection, ids, filter);
  }
}

export type TrimOptions = {
  mode: TrimMode;
  now: () => Date;
  /** `RINGCENTRAL_COLLECTION_MODE` of the environment the run targets, as resolved by `ringcentral-config`. */
  ringcentralCollectionMode: "production" | "test";
  /** `src/` files that still call `openReview(`; the review-items drop is refused while any exist. */
  openReviewCallers: readonly string[];
  localHead: string | null;
  batch?: number;
  log?: (line: string) => void;
};

export type TrimReport = {
  version: typeof DISK_TRIM_VERSION;
  mode: TrimMode;
  database: string;
  replica_set: string | null;
  started_at: string;
  finished_at: string;
  ringcentral_collection_mode: "production" | "test";
  deployment: { commit: string | null; recorded_at: string | null; vercel_deployment_id: string | null; local_head: string | null; local_head_deployed: boolean | null };
  storage_before: Awaited<ReturnType<TrimCluster["storage"]>>;
  storage_after: Awaited<ReturnType<TrimCluster["storage"]>> | null;
  deletes: Array<{ id: string; collection: string; present: boolean; matched_before: number; deleted: number; by_group: Record<string, number> | null; remaining_after: number | null }>;
  ttl_indexes: Array<{ collection: string; name: string; expire_after_seconds: number; present: boolean; action: IndexAction | "collection_absent"; detail: string | null; created: boolean }>;
  drops: Array<{ collection: string; present: boolean; count: number | null; newest_insert_at: string | null; decision: "drop" | "dropped" | "refused" | "absent"; reason: string }>;
  protected: Array<{ collection: string; present_before: boolean; count_before: number | null; present_after: boolean | null; count_after: number | null }>;
  stuck_sheet_sync_jobs: Array<{ id: string; operation: string | null; updated_at: string | null }>;
  problems: string[];
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function runDiskTrim(cluster: TrimCluster, options: TrimOptions): Promise<TrimReport> {
  const log = options.log ?? (() => undefined);
  const batch = Math.max(1, Math.min(options.batch ?? 5_000, 20_000));
  const now = options.now();
  const database = cluster.databaseName();
  if (database !== DISK_TRIM_DATABASE) throw new Error(`refusing database ${database}: the disk trim runs only against ${DISK_TRIM_DATABASE}`);

  const existing = new Set(await cluster.listCollections());
  const deployment = await cluster.deployment();
  const report: TrimReport = {
    version: DISK_TRIM_VERSION,
    mode: options.mode,
    database,
    replica_set: await cluster.replicaSetName(),
    started_at: now.toISOString(),
    finished_at: now.toISOString(),
    ringcentral_collection_mode: options.ringcentralCollectionMode,
    deployment: { ...deployment, local_head: options.localHead, local_head_deployed: deployment.commit && options.localHead ? deployment.commit === options.localHead : null },
    storage_before: await cluster.storage(),
    storage_after: null,
    deletes: [],
    ttl_indexes: [],
    drops: [],
    protected: [],
    stuck_sheet_sync_jobs: await cluster.stuckSheetSyncJobs(),
    problems: [],
  };

  for (const name of PROTECTED_COLLECTIONS) {
    const present = existing.has(name);
    report.protected.push({ collection: name, present_before: present, count_before: present ? await cluster.count(name, {}) : null, present_after: null, count_after: null });
  }

  // (a) deletes: count first, in every mode; delete only in apply.
  for (const scope of DELETE_SCOPES) {
    const present = existing.has(scope.collection);
    const filter = scope.filter(now);
    const matched = present ? await cluster.count(scope.collection, filter) : 0;
    const byGroup = present && scope.groupBy ? await cluster.countBy(scope.collection, filter, scope.groupBy) : null;
    const row: TrimReport["deletes"][number] = { id: scope.id, collection: scope.collection, present, matched_before: matched, deleted: 0, by_group: byGroup, remaining_after: null };
    log(`${options.mode === "apply" ? "deleting" : "would delete"} ${matched} rows: ${scope.id} (${scope.collection})`);
    if (options.mode === "apply" && present && matched > 0) {
      row.deleted = await deleteInBatches(cluster, scope.collection, filter, batch);
      row.remaining_after = await cluster.count(scope.collection, filter);
      if (row.remaining_after > 0) report.problems.push(`${scope.id}: ${row.remaining_after} matching rows remain after the delete`);
    }
    report.deletes.push(row);
  }

  // (b) TTL indexes, idempotent.
  for (const target of TTL_INDEXES) {
    const present = existing.has(target.collection);
    const row: TrimReport["ttl_indexes"][number] = { collection: target.collection, name: target.name, expire_after_seconds: target.expireAfterSeconds, present, action: "collection_absent", detail: null, created: false };
    if (present) {
      const plan = planTtlIndex(target, await cluster.indexes(target.collection));
      row.action = plan.action;
      row.detail = plan.detail;
      if (plan.action === "conflict") report.problems.push(`${target.collection}: TTL index ${target.name} conflicts: ${plan.detail}`);
      if (plan.action === "create" && options.mode === "apply") {
        await cluster.createIndex(target.collection, target);
        row.created = true;
      }
    } else report.problems.push(`${target.collection} is absent; its TTL index was not created`);
    log(`ttl ${target.collection}.${target.name}: ${row.action}${row.created ? " (created)" : ""}`);
    report.ttl_indexes.push(row);
  }

  // (c) drops, each gated on its own conditions.
  for (const target of DROP_TARGETS) {
    const present = existing.has(target.collection);
    const row: TrimReport["drops"][number] = { collection: target.collection, present, count: null, newest_insert_at: null, decision: "absent", reason: target.reason };
    if (present) {
      row.count = await cluster.count(target.collection, {});
      const newest = await cluster.newestInsertAt(target.collection);
      row.newest_insert_at = iso(newest);
      const refusals: string[] = [];
      if (target.requiresProductionCollectionMode && options.ringcentralCollectionMode !== "production") refusals.push(`RINGCENTRAL_COLLECTION_MODE is ${options.ringcentralCollectionMode}, not production`);
      if (target.requiresNoInsertsForDays !== null && newest && now.getTime() - newest.getTime() < target.requiresNoInsertsForDays * DAY_MS) refusals.push(`inserted ${iso(newest)}, inside the last ${target.requiresNoInsertsForDays} days`);
      if (target.requiresNoOpenReviewCaller && options.openReviewCallers.length) refusals.push(`openReview( is still called by ${options.openReviewCallers.join(", ")}`);
      if (refusals.length) {
        row.decision = "refused";
        row.reason = refusals.join("; ");
        report.problems.push(`drop ${target.collection} refused: ${row.reason}`);
      } else if (options.mode === "apply") {
        await cluster.dropCollection(target.collection);
        row.decision = "dropped";
      } else row.decision = "drop";
    }
    log(`drop ${target.collection}: ${row.decision}${row.decision === "refused" ? ` (${row.reason})` : ""}`);
    report.drops.push(row);
  }

  if (options.mode === "apply") {
    const after = new Set(await cluster.listCollections());
    for (const row of report.protected) {
      row.present_after = after.has(row.collection);
      row.count_after = row.present_after ? await cluster.count(row.collection, {}) : null;
      if (row.present_before && !row.present_after) report.problems.push(`protected ${row.collection} is missing after the run`);
    }
    for (const row of report.drops) if (row.decision === "dropped" && after.has(row.collection)) report.problems.push(`${row.collection} exists again after its drop (a writer recreated it)`);
    report.storage_after = await cluster.storage();
  }
  report.finished_at = options.now().toISOString();
  return report;
}

/** The one-screen summary printed after a run. Counts and names only. */
export function summarizeTrimReport(r: TrimReport): string {
  const lines: string[] = [];
  lines.push(`${r.version} ${r.mode} on ${r.database} (${r.replica_set ?? "no replica set"}), RINGCENTRAL_COLLECTION_MODE=${r.ringcentral_collection_mode}`);
  lines.push(`deployed commit ${r.deployment.commit ?? "unknown"}; local HEAD ${r.deployment.local_head ?? "unknown"} (${r.deployment.local_head_deployed === null ? "unknown" : r.deployment.local_head_deployed ? "deployed" : "not deployed"}); the audit stop is live only once the commit carrying it is deployed`);
  lines.push(`storage before: data ${r.storage_before.dataMB} MB, storage ${r.storage_before.storageMB} MB, index ${r.storage_before.indexMB} MB`);
  if (r.storage_after) lines.push(`storage after:  data ${r.storage_after.dataMB} MB, storage ${r.storage_after.storageMB} MB, index ${r.storage_after.indexMB} MB`);
  for (const d of r.deletes) {
    lines.push(`delete ${d.id} (${d.collection}): matched ${d.matched_before}${r.mode === "apply" ? `, deleted ${d.deleted}, remaining ${d.remaining_after ?? 0}` : ""}`);
    if (d.by_group) for (const [k, v] of Object.entries(d.by_group).sort((a, b) => b[1] - a[1])) lines.push(`    ${k}: ${v}`);
  }
  for (const i of r.ttl_indexes) lines.push(`ttl ${i.collection}.${i.name} (${i.expire_after_seconds / 86_400} days): ${i.action}${i.created ? ", created" : ""}${i.detail ? ` (${i.detail})` : ""}`);
  for (const d of r.drops) lines.push(`drop ${d.collection}: ${d.decision}${d.count !== null ? ` (${d.count} docs, newest insert ${d.newest_insert_at ?? "none"})` : ""}${d.decision === "refused" ? `: ${d.reason}` : ""}`);
  for (const p of r.protected) lines.push(`protected ${p.collection}: ${p.present_before ? p.count_before : "absent"}${p.present_after !== null ? ` -> ${p.present_after ? p.count_after : "ABSENT"}` : ""}`);
  if (r.stuck_sheet_sync_jobs.length) lines.push(`sheet_sync_jobs stuck in processing (not touched): ${r.stuck_sheet_sync_jobs.map((j) => `${j.id} ${j.operation ?? "?"} ${j.updated_at ?? "?"}`).join("; ")}`);
  lines.push(r.problems.length ? `PROBLEMS (${r.problems.length}):` : "no problems");
  for (const p of r.problems) lines.push(`  - ${p}`);
  return lines.join("\n");
}
