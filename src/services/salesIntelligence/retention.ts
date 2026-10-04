import { randomBytes } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import type { Document, ObjectId } from "mongodb";
import { csiFlag } from "../../config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { withTransaction } from "../../db";
import { MongoLeaseStore, activeTokenFilter } from "../durableWork/leases";
import { RETENTION_LEASE_SCOPE, syncStateLeaseModel } from "../numberActivity/reconcileCallLog";
import { resolveActivityRetentionDays } from "./retentionPolicy";

/**
 * Call activity retention over the retained provider metadata (`call_interactions`, `contact_numbers`
 * and their attachments). It never reads or writes a retired collection (conversations, analyses,
 * assessments, Outreach, Attention) and never touches `sales_intelligence_jobs`: completed jobs expire
 * through their own `completed_at` TTL, and pending, leased, retry, paused or dead-lettered work is
 * never expired here.
 */
export type RetentionSummary = {
  skipped: boolean;
  skip_reason: "disabled" | "lease_held" | null;
  activity_purged: number;
  numbers_purged: number;
};
function db() {
  const connected = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
  if (!connected) throw new Error("mongo_unavailable");
  return connected;
}

export async function runRetentionOnce(overrides: {
  now?: () => Date; leaseTtlMs?: number; limit?: number;
  beforeCommit?: () => Promise<void>;
} = {}): Promise<RetentionSummary> {
  const now = overrides.now ?? (() => new Date()), started = now();
  const summary: RetentionSummary = { skipped: false, skip_reason: null, activity_purged: 0, numbers_purged: 0 };
  if (!csiFlag("ENABLED")) return { ...summary, skipped: true, skip_reason: "disabled" };
  const leases = new MongoLeaseStore(syncStateLeaseModel());
  const token = await leases.acquire({ scope: RETENTION_LEASE_SCOPE, owner: `csi-retention:${randomBytes(8).toString("hex")}`, ttl_ms: overrides.leaseTtlMs ?? 300_000, now: started });
  if (!token) return { ...summary, skipped: true, skip_reason: "lease_held" };
  const limit = Math.max(1, Math.min(100, overrides.limit ?? 50));
  const commit = async (operation: (session: ClientSession) => Promise<void>) => withTransaction(async session => {
    // Writing the lease fences a concurrent expiry/reclaim, not merely a preflight read.
    const fenced = await db().collection("sales_intelligence_sync_state").updateOne(activeTokenFilter(token, now()), { $inc: { retention_fence: 1 } }, { session });
    if (fenced.modifiedCount !== 1) throw new Error("retention_lease_lost");
    await operation(session);
    await overrides.beforeCommit?.();
    const finalFence = await db().collection("sales_intelligence_sync_state").updateOne(activeTokenFilter(token, now()), { $inc: { retention_fence: 1 } }, { session });
    if (finalFence.modifiedCount !== 1) throw new Error("retention_lease_lost");
  });
  try {
    const activity_days = await resolveActivityRetentionDays();
    if (activity_days <= 0) return summary;
    const cutoff = new Date(started.getTime() - activity_days * 86_400_000);
    const rows = await db().collection("call_interactions").find({ started_at: { $lte: cutoff }, purged_at: null }).sort({ started_at: 1 }).limit(limit).toArray();
    for (const row of rows) await commit(async session => {
      // Read in the transaction: the recordings given back are exactly the ones this write clears.
      const current = await db().collection("call_interactions").findOne({ _id: row._id, purged_at: null }, { session, projection: { recordings: 1, merged_into_id: 1, contact_number_id: 1 } });
      // Keep provider identifiers and aliases to prevent replay from resurrecting the call.
      await db().collection("call_interactions").updateOne({ _id: row._id }, { $set: { purged_at: started, parties: [], legs: [], recordings: [], external_e164: null, provider_names: [] } }, { session });
      if (current) await releasePurgedRecordings(current, session);
    });
    summary.activity_purged = rows.length;
    const numbers = await db().collection("contact_numbers").find({ last_activity_at: { $lte: cutoff }, purged_at: null }).limit(limit).toArray();
    for (const number of numbers) await commit(async session => { await purgeNumberActivity(number._id, started, session); });
    summary.numbers_purged = numbers.length;
    return summary;
  } finally { await leases.release({ token, now: now() }).catch(() => undefined); }
}

/** `rollups.recordings_total` counts canonical, unpurged interactions: a purged canonical row gives its
 * recordings back, clamped at 0 for a Number the rebuild sweep has not reached yet. A merged tombstone's
 * recordings were already removed from its Number when it was merged. */
async function releasePurgedRecordings(row: Document, session: ClientSession) {
  const count = Array.isArray(row.recordings) ? row.recordings.length : 0;
  if (!count || row.merged_into_id || !row.contact_number_id) return;
  await db().collection("contact_numbers").updateOne({ _id: row.contact_number_id }, [{ $set: { "rollups.recordings_total":
    { $max: [0, { $subtract: [{ $ifNull: ["$rollups.recordings_total", 0] }, count] }] } } }], { session });
}

/** The retained `ContactNumber.rollups` shape, all zero. Retired rollup keys are never written. */
const EMPTY_ROLLUPS = {
  interactions_total: 0, inbound_total: 0, outbound_total: 0, human_conversations_total: 0,
  last_inbound_at: null, last_outbound_at: null, last_human_conversation_at: null,
  attached_lead_count: 0, candidate_lead_count: 0, recordings_total: 0,
};

async function purgeNumberActivity(id: ObjectId, at: Date, session: ClientSession) {
  const options = { session }, database = db();
  // A future genuine call may create a new Contact Number; retained call aliases still dedupe history.
  await database.collection("contact_numbers").updateOne({ _id: id }, { $set: { purged_at: at, e164: `purged:${id}`, national_ten: null, digits_reversed: "", provider_names: [], search_terms: [],
    rollups: EMPTY_ROLLUPS, contact_eligibility: { state: "suppressed", reason: "retention" } } }, options);
  await database.collection("number_lead_attachments").deleteMany({ contact_number_id: id }, options);
  await database.collection("owner_rep_nudges").updateMany({ contact_number_id: id }, { $set: { purged_at: at, body_as_sent: "", destination: "", authorized_command: null, sender_did: null, rc_extension_name_snapshot: null } }, options);
}
