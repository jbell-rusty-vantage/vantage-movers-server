import { BSON, ObjectId, type ClientSession, type Db, type Document } from "mongodb";
import { gzipSync } from "node:zlib";
import { getDailyOperationsCollectionName } from "../../config/domain/dailyOperations";
import { easternDayKey } from "../dailyOperations/dayDocument";
import { currentReceiptReplay } from "../granotLifecycle/receiptReplay";
import { readArchiveObject, storeArchiveObject, type ArchiveRead, type ArchiveStore } from "./archiveObjects";
import { automationRunId, closedRuns, readClosedRun, type ClosedOperation } from "./closedAutomationRun";
import { prepareClosedRun, publishClosedRun } from "./prepareClosedRun";
import {
  archivedReceipts,
  channelReceiptFormat,
  readGranotDecision,
  readGranotObservation,
  restoreRetiredReceipt,
  RETIRED_CHANNELS,
  webhookReceiptFormat,
} from "./retiredRecords";

/**
 * Retire on use. A Granot receipt leaves MongoDB as soon as the work it carried is finished: its
 * exact BSON goes to a verified GCS generation, a compact locator replaces it in
 * `granot_archived_receipts`, and the hot document is deleted, all after a transactional recheck.
 * "Used" is defined per channel (`usedReason`). Observations and Decisions follow through the Lead
 * evidence pass (`retireLeadEvidence.ts`) once nothing references them.
 *
 * Doc: docs/knowledge/granot-lifecycle/storage-retention-operations.md#retire-on-use.
 */
export const RETIRE_ON_USE_CONTROL = "receipts-on-use-v1";
const receiptsOf = (db: Db) => db.collection("granot_webhook_receipts");
const control = (db: Db) => db.collection<{ _id: string; enabled_from?: Date }>("granot_retention_control");
const LEAD_MODELS = ["FormLead", "CallLead"];
const WEBHOOK_ROUTES = ["lead_created", "priority_updated"];
/** Outcomes that finish a channel operation without changing a Lead. Nothing retries them. */
const POLICY_FINAL = new Set(["unmatched", "policy_blocked", "invalid", "unsupported", "insufficient_creation_data"]);
/** Hold reasons that cannot change with time. Their receipts leave the review queue. */
export const PERMANENT_HOLDS = new Set(["route_not_retired", "channel_not_retired"]);

export type RetireStorage = { store?: ArchiveStore; read?: ArchiveRead };
export type RetireContext = {
  storage: Required<RetireStorage>;
  /** Publish a missing closed-run replay (online pass and backlog `--apply`). Dry runs only inspect. */
  closeRuns?: boolean;
  now?: Date;
  runs?: Map<string, string>;
  rows?: Map<string, ClosedOperation[]>;
};
export type RetireResult =
  | { status: "retired" | "retirable"; channel: string; bytes: number; locator_bytes: number }
  | { status: "held"; channel: string; reason: string }
  | { status: "changed" | "absent"; channel?: string };

const context = (storage: RetireStorage = {}, extra: Partial<RetireContext> = {}): RetireContext => ({
  ...extra, storage: { store: storage.store ?? storeArchiveObject, read: storage.read ?? readArchiveObject },
});

/** The Lead effect of an accepted Decision is committed, or the outcome is a terminal no-change. */
async function leadOutcomeReason(db: Db, d: Document, route: string | undefined, session?: ClientSession) {
  const { model, id } = d.target ?? {};
  if (!LEAD_MODELS.includes(model) || !ObjectId.isValid(id ?? "")) return "no_lead_target";
  const effect = (kind: string) => d.effects?.some((e: Document) => e.kind === kind && e.ref?.model === model && String(e.ref.id) === String(id));
  const accepted =
    (d.outcome === "applied" && effect("lead_updated")) ||
    (d.outcome === "created" && model === "FormLead" && effect("lead_created") && (route === undefined || route === "lead_created")) ||
    (d.outcome === "already_current" && d.reason_code === "desired_state_already_current") ||
    (d.outcome === "linked" && d.reason_code === "record_link_established") ||
    (d.outcome === "stale" && d.reason_code === "older_than_temporal_winner");
  if (!accepted) return `unresolved_outcome:${d.outcome}`;
  const lead = await db.collection(model === "FormLead" ? "form_leads" : "call_leads").findOne(
    { _id: new ObjectId(id), ...(d.outcome === "created" && route ? { ingestion_origin: "granot_lead_created" } : {}) },
    { session, projection: { _id: 1 }, maxTimeMS: 3000 },
  );
  return lead ? null : "lead_missing";
}

/**
 * Inbound webhook (`lead_created`, `priority_updated`): counted in its Daily Operations day, one live
 * Decision for its Observation, and either the Lead effect committed or a creation-policy-final
 * outcome verified against the source policy. `booking_status_changed` stays hot (Owner decision).
 */
async function usedWebhook(db: Db, r: Document, session?: ClientSession) {
  if (!WEBHOOK_ROUTES.includes(r.route_event_class)) return "route_not_retired";
  if (r.webhook_day_counted !== true) return "daily_count_missing";
  if (r.processing?.state !== "completed" || !(r.processing.completed_at instanceof Date) || !(r.processing.latest_decision_id instanceof ObjectId)) return "not_completed";
  const opts = { session, maxTimeMS: 3000 };
  const observation = await db.collection("granot_observations").findOne(
    { receipt_id: r._id, route_event_class: r.route_event_class, kind: "lead_snapshot" }, { ...opts, projection: { _id: 1 } });
  if (!observation) return "observation_missing";
  const d = await db.collection("synchronization_decisions").findOne(
    { _id: r.processing.latest_decision_id, observation_id: observation._id, execution_mode: "live" }, opts);
  if (!d) return "decision_missing";
  const day = await db.collection(getDailyOperationsCollectionName("days")).findOne(
    { day: easternDayKey(r.captured_at), webhook_counts_version: 1 }, { ...opts, projection: { _id: 1 } });
  if (!day) return "daily_operations_day_unversioned";
  const scope = d.source_scope ?? d.source_policy;
  const observationOnly = ["policy_blocked", "unmatched"].includes(d.outcome) && d.reason_code === "creation_policy_observation_only";
  const matchExpired = d.outcome === "unmatched" && d.reason_code === "match_window_expired";
  if (r.route_event_class === "lead_created" && (observationOnly || matchExpired)) {
    if (!scope?.granot_crm_source_id || !scope.policy_version) return "source_policy_unverified";
    const source = await db.collection("granot_crm_sources").findOne({
      _id: scope.granot_crm_source_id, lifecycle_policy_version: scope.policy_version,
      lead_created_policy: { $in: ["link_only", "observation_only"] },
    }, { ...opts, projection: { _id: 1 } });
    return source ? null : "source_policy_unverified";
  }
  return leadOutcomeReason(db, d, r.route_event_class, session);
}

/**
 * Whether the run has a closed-run replay row, read from MongoDB only. A missing row is published
 * when `closeRuns` is set (online pass, backlog `--apply`); otherwise the read-only preparation
 * names the reason it cannot close yet.
 */
async function closedRunState(db: Db, run: string, ctx: RetireContext) {
  const runs = (ctx.runs ??= new Map());
  if (!runs.has(run)) {
    let state = (await closedRuns(db).findOne({ _id: run }, { projection: { _id: 1 } })) ? "present" : "no_closed_run";
    if (state !== "present") {
      // Legacy runs close only after their original seven-day action expiry (prepareClosedRun).
      const cutoff = new Date(+(ctx.now ?? new Date()) - 7 * 86_400_000);
      if (ctx.closeRuns) {
        const result = await publishClosedRun(db, run, cutoff, ctx.storage);
        state = result === "closed" || result === "previously_closed" ? "present" : `closed_run:${result}`;
      } else {
        const prepared = await prepareClosedRun(db, run, cutoff);
        state = prepared.reason === "ready" ? "closed_run:publishable" : `closed_run:${prepared.reason}`;
      }
    }
    runs.set(run, state);
  }
  return runs.get(run)!;
}

/**
 * Browser extension and HTTP automation: a completed live Decision for this receipt's Observation
 * (hot or archived), the saved replay agreeing with it, and the Lead effect committed or a
 * policy-final outcome. An HTTP action also needs its exact row in a verified closed-run replay,
 * which fences re-application of the run after the receipt leaves. Pending matches, conflicts,
 * ambiguous and deferred outcomes stay hot.
 */
async function usedChannelOperation(db: Db, r: Document, ctx: RetireContext, session?: ClientSession) {
  if (typeof r.channel_operation_id !== "string" || !r.channel_operation_kind || !/^[a-f0-9]{64}$/.test(r.payload_sha256 ?? "")) return "operation_identity_incomplete";
  const p = r.processing;
  if (p?.state !== "completed" || !(p.completed_at instanceof Date) || !(p.latest_decision_id instanceof ObjectId)) return "not_completed";
  // MongoDB-only proofs first, so a read-only review can name every reason that needs no GCS read.
  const run = r.observation_channel === "granot_http_automation" ? automationRunId(r.channel_operation_id) : null;
  if (r.observation_channel === "granot_http_automation") {
    if (!run) return "operation_without_run";
    const state = await closedRunState(db, run, ctx);
    if (state !== "present") return state;
  }
  const read = { session, read: ctx.storage.read };
  const d = await readGranotDecision(db, p.latest_decision_id, read);
  if (!d || d.execution_mode !== "live") return "decision_missing";
  const observation = await readGranotObservation(db, d.observation_id, read);
  if (!observation || String(observation.receipt_id) !== String(r._id)) return "observation_missing";
  const replay = currentReceiptReplay(p.replay_result, p.latest_decision_id);
  if (replay && (replay.outcome !== d.outcome || replay.observation_id !== String(d.observation_id) ||
      replay.target?.model !== d.target?.model || String(replay.target?.id ?? "") !== String(d.target?.id ?? "") ||
      (replay.effects?.length ?? 0) !== (d.effects?.length ?? 0))) return "replay_differs";
  if (!POLICY_FINAL.has(d.outcome)) {
    const reason = await leadOutcomeReason(db, d, undefined, session);
    if (reason) return reason;
  }
  if (run) {
    const rows = (ctx.rows ??= new Map()).get(run) ?? await readClosedRun(db, run, ctx.storage.read);
    if (!rows) return "no_closed_run";
    ctx.rows.set(run, rows);
    const row = rows.find((op: ClosedOperation) => op.operation === r.channel_operation_id);
    if (!row || row.receipt !== String(r._id) || row.hash !== r.payload_sha256 || row.kind !== r.channel_operation_kind ||
        row.result.decision_id !== String(d._id) || row.result.outcome !== d.outcome || row.result.observation_id !== String(d.observation_id)) {
      return "closed_run_differs";
    }
  }
  return null;
}

/** Why this receipt is not yet used, or `null` when it may leave MongoDB now. */
export function usedReason(db: Db, r: Document, ctx: RetireContext, session?: ClientSession) {
  if (r.observation_channel === "granot_webhook") return usedWebhook(db, r, session);
  if ((RETIRED_CHANNELS as readonly string[]).includes(r.observation_channel)) return usedChannelOperation(db, r, ctx, session);
  return Promise.resolve("channel_not_retired");
}

/** The compact locator that replaces the receipt: enough for replay, Owner requeue, Pool and the timeline. */
function locatorFor(r: Document, object: { hash: string; generation: string }) {
  const processing = {
    state: "completed",
    latest_decision_id: r.processing.latest_decision_id,
    ...(r.processing.certified_lead ? { certified_lead: r.processing.certified_lead } : {}),
  };
  if (r.observation_channel === "granot_webhook") {
    // Unchanged since the inbound webhook pass shipped.
    return {
      _id: r._id, format: webhookReceiptFormat, archived_at: new Date(), hash: object.hash, generation: object.generation,
      route_event_class: r.route_event_class, observation_channel: r.observation_channel, captured_at: r.captured_at,
      createdAt: r.createdAt, processing,
    };
  }
  return {
    _id: r._id, format: channelReceiptFormat, archived_at: new Date(), hash: object.hash, generation: object.generation,
    observation_channel: r.observation_channel, channel_operation_id: r.channel_operation_id,
    channel_operation_kind: r.channel_operation_kind, payload_sha256: r.payload_sha256,
    captured_at: r.captured_at, createdAt: r.createdAt,
    processing: {
      ...processing, completed_at: r.processing.completed_at,
      ...(r.processing.replay_result ? { replay_result: r.processing.replay_result } : {}),
    },
    ...(r.evidence_archive ? { evidence_archive: r.evidence_archive } : {}),
  };
}

/** The size the receipt's locator will have (placeholder hash and generation of the real lengths). */
export const locatorBytes = (r: Document) => BSON.calculateObjectSize(locatorFor(r, { hash: "0".repeat(64), generation: "1".repeat(16) }));

/**
 * Retires one receipt if it is used. Interrupted at any point it resumes safely: the GCS object is
 * content-addressed and create-only (a retry gets the same generation), and MongoDB changes only in
 * the final transaction, which rereads the exact source bytes and the "used" proof first.
 * `dryRun` reports what would happen without any write.
 */
export async function retireReceipt(db: Db, id: ObjectId, storage: RetireStorage = {}, options: { dryRun?: boolean; channels?: string[]; ctx?: RetireContext } = {}): Promise<RetireResult> {
  const ctx = options.ctx ?? context(storage);
  const original = await receiptsOf(db).findOne({ _id: id }, { raw: true });
  if (!Buffer.isBuffer(original)) return { status: "absent" };
  const r = BSON.deserialize(original);
  const channel = String(r.observation_channel);
  if (options.channels && !options.channels.includes(channel)) return { status: "held", channel, reason: "channel_not_retired" };
  const reason = await usedReason(db, r, ctx);
  if (reason) return { status: "held", channel, reason };
  if (options.dryRun) return { status: "retirable", channel, bytes: original.length, locator_bytes: locatorBytes(r) };
  const format = channel === "granot_webhook" ? webhookReceiptFormat : channelReceiptFormat;
  const object = await ctx.storage.store(db.databaseName, gzipSync(original));
  if (!object.generation || !restoreRetiredReceipt(object.persisted, object.hash, id, format).raw.equals(original)) {
    throw new Error("Retired receipt restore mismatch");
  }
  const locator = locatorFor(r, object);
  const session = db.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const fresh = await receiptsOf(db).findOne({ _id: id }, { raw: true, session });
      if (!Buffer.isBuffer(fresh) || !fresh.equals(original) || (await usedReason(db, r, ctx, session))) return { status: "changed", channel };
      await archivedReceipts(db).insertOne(locator, { session });
      const removed = await receiptsOf(db).deleteOne({ _id: id }, { session });
      if (removed.deletedCount !== 1) throw new Error("Receipt retirement lost its source");
      return { status: "retired", channel, bytes: original.length, locator_bytes: BSON.calculateObjectSize(locator) };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }) as RetireResult;
  } finally {
    await session.endSession();
  }
}

/** The locator's unique operation key: duplicate delivery and changed input keep working after retirement. */
export const RETIRED_OPERATION_INDEX = {
  key: { observation_channel: 1, channel_operation_id: 1 },
  options: { name: "granot_archived_receipt_operation_unique", unique: true, partialFilterExpression: { channel_operation_id: { $type: "string" } } },
} as const;
export const installRetiredOperationIndex = (db: Db) =>
  archivedReceipts(db).createIndex(RETIRED_OPERATION_INDEX.key, RETIRED_OPERATION_INDEX.options);
async function operationIndexReady(db: Db) {
  const indexes = await archivedReceipts(db).listIndexes().toArray().catch(() => []);
  return indexes.some((index) => index.name === RETIRED_OPERATION_INDEX.options.name && index.unique === true);
}

/**
 * The online pass, every two minutes from the storage cron. Drives the review queue the drainer
 * stamps at completion (`processing.retention_review_at`). Off until the Owner writes
 * `granot_retention_control` `{ _id: "receipts-on-use-v1", enabled_from }`; only receipts captured
 * at or after `enabled_from` are reviewed here. The older backlog goes through
 * `ops/granot-retire-used-receipts.ts`, which uses the same `retireReceipt`.
 */
export async function retireUsedReceipts(db: Db, now = new Date(), storage: RetireStorage = {}, limit = 32) {
  const config = await control(db).findOne({ _id: RETIRE_ON_USE_CONTROL });
  if (!(config?.enabled_from instanceof Date)) return { status: "not_configured" as const };
  const counts = { status: "processed" as const, examined: 0, retired: 0, held: 0, failures: 0, bytes_removed: 0, locator_bytes: 0, holds: {} as Record<string, number> };
  const channels = (await operationIndexReady(db)) ? undefined : ["granot_webhook"];
  const due = await receiptsOf(db).find(
    { "processing.retention_review_at": { $lte: now }, captured_at: { $gte: config.enabled_from } },
    { projection: { _id: 1, "processing.retention_review_at": 1 }, maxTimeMS: 3000 },
  ).hint("granot_retention_review_v1").sort({ "processing.retention_review_at": 1 }).limit(limit).toArray();
  const ctx = context(storage, { closeRuns: true, now });
  for (const row of due) {
    // Claim before any network I/O, so a failing receipt cannot starve the queue.
    const claim = await receiptsOf(db).updateOne(
      { _id: row._id, "processing.retention_review_at": row.processing.retention_review_at },
      { $set: { "processing.retention_review_at": new Date(+now + 30 * 60_000) } },
    );
    if (!claim.modifiedCount) continue;
    counts.examined++;
    let result: RetireResult;
    try {
      result = await retireReceipt(db, row._id, storage, { ctx, channels });
    } catch {
      counts.failures++;
      continue;
    }
    if (result.status === "retired") {
      counts.retired++;
      counts.bytes_removed += result.bytes;
      counts.locator_bytes += result.locator_bytes;
    } else if (result.status === "held") {
      counts.held++;
      const reason = channels && result.reason === "channel_not_retired" ? "locator_operation_index_missing" : result.reason;
      counts.holds[reason] = (counts.holds[reason] ?? 0) + 1;
      await receiptsOf(db).updateOne({ _id: row._id }, PERMANENT_HOLDS.has(reason)
        ? { $unset: { "processing.retention_review_at": "", "processing.retention_reason": "" } }
        : { $set: { "processing.retention_review_at": new Date(+now + 86_400_000), "processing.retention_reason": reason } });
    }
  }
  return counts;
}
