import { randomBytes } from "node:crypto";
import { del } from "@vercel/blob";
import mongoose, { type ClientSession } from "mongoose";
import type { Document, ObjectId } from "mongodb";
import { LEAD_CONVERSATION_COLLECTION } from "../../config/domain/conversations";
import { csiFlag, csiProviderConfiguration } from "../../config/domain/salesIntelligence";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { withTransaction } from "../../db";
import { MongoLeaseStore, activeTokenFilter } from "../durableWork/leases";
import { RETENTION_LEASE_SCOPE, syncStateLeaseModel } from "../numberActivity/reconcileCallLog";
import { resolveRetentionDays } from "./retentionPolicy";

export type RetentionSummary = {
  skipped: boolean;
  skip_reason: "disabled" | "lease_held" | "blob_delete_failed" | null;
  audio_purged: number;
  redacted_purged: number;
  activity_purged: number;
};
export type BlobDeleter = (pathname: string) => Promise<void>;
export class RetentionBlobDeleteError extends Error {
  constructor(message: string) { super(message); this.name = "RetentionBlobDeleteError"; }
}
export async function defaultDeleteStoredAudio(pathname: string) {
  const provider = csiProviderConfiguration();
  if (!pathname.trim()) throw new RetentionBlobDeleteError("missing_pathname");
  if (!provider.blobToken) throw new RetentionBlobDeleteError("blob_token_missing");
  await del(pathname, { token: provider.blobToken });
}
function db() {
  const connected = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).db;
  if (!connected) throw new Error("mongo_unavailable");
  return connected;
}
/** Completed media jobs retain a private cleanup pointer until deletion succeeds. */
export async function deletePendingStoredAudio(jobId: string, pathname: string, deleteAudio: BlobDeleter = defaultDeleteStoredAudio) {
  await deleteAudio(pathname);
  await db().collection("sales_intelligence_jobs").updateOne({ _id: new mongoose.Types.ObjectId(jobId), "result.pending_blob_delete": pathname },
    { $unset: { "result.pending_blob_delete": "" } });
}
const tombstone = { purged: true };
const identityKeys = ["projection_revision", "rep_identity_fingerprint", "outboundAttempt", "human", "happened_at", "interaction_id", "followup_id", "run_id", "finding_id", "job_id", "submission_id", "application_job_id", "target_id", "outreach_record_id", "contact_number_id", "lead_id", "revision", "state", "status", "published", "version", "source_interaction_id", "evidence_interaction_id", "trigger_at", "due_at", "completed_at", "closed_at"];
const retainedIdentity = (field: string) => ({ $arrayToObject: { $filter: { input: { $objectToArray: { $ifNull: [field, {}] } }, as: "entry", cond: { $in: ["$$entry.k", identityKeys] } } } });
const snapshotContent = { response: tombstone, arguments: tombstone, segments: [] };

/** Derived context does not carry complete transitive provenance. Invalidate the subject's
 * analysis cache conservatively; retain newer source transcripts for a fresh current-context run.
 * All copies and the root checkpoint commit together, so a crash cannot strand retained text. */
async function purgeContent(root: Document, kind: "snapshot" | "run", at: Date, session: ClientSession) {
  const database = db(), options = { session };
  const conversation = root.conversation_id ? await database.collection(LEAD_CONVERSATION_COLLECTION).findOne({ _id: root.conversation_id }, options) : null;
  const sourceRun = kind === "run" ? root : root.run_id ? await database.collection("intelligence_runs").findOne({ _id: root.run_id }, options) : null;
  const numberId = conversation?.contact_number_id ?? sourceRun?.contact_number_id ?? null;
  const runs = await database.collection("intelligence_runs").find(numberId ? { contact_number_id: numberId, purged_at: null } : { _id: sourceRun?._id ?? root.run_id, purged_at: null }, options).project({ _id: 1, subject_key: 1, outreach_record_id: 1 }).sort({ _id: 1 }).limit(51).toArray();
  const more = runs.length > 50;
  const runIds = runs.slice(0, 50).map(r => r._id);
  const recordIds = runs.slice(0, 50).flatMap(r => r.outreach_record_id ? [r.outreach_record_id] : []);
  const records = await database.collection("outreach_records").find({ _id: { $in: recordIds } }, options).project({ subject: 1 }).limit(50).toArray();
  const recordSubjects = records.flatMap(r => r.subject?.kind === "lead" ? [`lead:${r.subject.model}:${r.subject.id}`]
    : r.subject?.contact_number_id ? [`number:${r.subject.contact_number_id}`] : []);
  const subjects = [...new Set([root.subject_key, ...recordSubjects, ...runs.slice(0, 50).map(r => r.subject_key), ...(numberId ? [`number:${numberId}`] : [])].filter((s): s is string => typeof s === "string"))];
  const findings = await database.collection("intelligence_findings").find({ run_id: { $in: runIds } }, options).project({ _id: 1 }).toArray();
  const findingIds = findings.map(r => r._id);
  await database.collection("intelligence_evidence_snapshots").updateMany({ $or: [
    ...(kind === "snapshot" && !more ? [{ _id: root._id }] : []), { run_id: { $in: runIds } },
    ...(root.source_type === "transcript" && !more ? [{ "response.transcript.source_snapshot_id": String(root._id) }, { conversation_id: root.conversation_id, source_type: "transcript" }] : []),
  ] }, { $set: { ...snapshotContent, purged_at: at, purge_reason: "retention" } }, options);
  await database.collection("intelligence_runs").updateMany({ _id: { $in: runIds } }, { $set: {
    purged_at: at, rendered_prompt: null, output: null, raw_output: null, owner_correction_context: null,
    processing_reason: "retention", token_nonce: null,
  }, $inc: { revision: 1 } }, options);
  if (more) await database.collection(kind === "snapshot" ? "intelligence_evidence_snapshots" : "intelligence_runs").updateOne({ _id: root._id }, { $set: { purge_started_at: at, purged_at: null } }, options);
  await database.collection("intelligence_findings").updateMany({ run_id: { $in: runIds } }, { $set: {
    purged_at: at, assertion: tombstone, resolved: null,
  } }, options);
  await database.collection("intelligence_submissions").updateMany({ run_id: { $in: runIds } }, { $set: { purged_at: at, envelope: tombstone } }, options);
  await database.collection("intelligence_effects").updateMany({ run_id: { $in: runIds } }, [{ $set: { purged_at: at, previous: retainedIdentity("$previous"), current: retainedIdentity("$current"), reason: "retention" } }], options);
  await database.collection("intelligence_owner_assessments").updateMany({ run_id: { $in: runIds } }, { $set: { purged_at: at, reason: "Evidence removed by retention." } }, options);
  await database.collection("outreach_followups").updateMany({ $or: [{ origin_run_id: { $in: runIds } }, { source_finding_ids: { $in: findingIds } }] }, { $set: {
    content_purged_at: at, description: "Content removed by retention.", date_text: null, date_resolution: null,
  } }, options);
  await database.collection("sales_intelligence_owner_instructions").updateMany({ $or: [{ finding_id: { $in: findingIds } }, { subject_key: { $in: subjects } }] }, { $set: { purged_at: at, prior: tombstone, current: tombstone } }, options);
  await database.collection("sales_intelligence_audit_events").updateMany({ subject_key: { $in: subjects } }, [{ $set: { purged_at: at, prior: retainedIdentity("$prior"), current: retainedIdentity("$current") } }], options);
  await database.collection("owner_rep_nudges").updateMany({ $or: [
    ...(numberId ? [{ contact_number_id: numberId }] : []), { outreach_record_id: { $in: recordIds } },
  ] }, { $set: { content_purged_at: at, body_as_sent: "", authorized_command: null } }, options);
  if (numberId) {
    await database.collection("contact_numbers").updateOne({ _id: numberId }, { $set: { running_summary: null, intelligence_schedule: null, content_purge_pending: more }, $inc: { revision: 1, retention_epoch: 1 } }, options);
    await database.collection(LEAD_CONVERSATION_COLLECTION).updateMany({ contact_number_id: numberId }, { $set: { summary: null, latest_completed_run_id: null } }, options);
  }
  if (root.source_type === "transcript" && root.conversation_id) {
    await database.collection(LEAD_CONVERSATION_COLLECTION).updateOne({ _id: root.conversation_id }, { $set: {
      content_purged_at: at, transcript: null, transcript_segments: [], latest_transcript_version: null,
      latest_completed_run_id: null, summary: null, pending_stage: null,
    } }, options);
  }
  return more;
}

export async function runRetentionOnce(overrides: {
  now?: () => Date; deleteAudio?: BlobDeleter; leaseTtlMs?: number; limit?: number;
  beforeCommit?: () => Promise<void>;
} = {}): Promise<RetentionSummary> {
  const now = overrides.now ?? (() => new Date()), started = now();
  const summary: RetentionSummary = { skipped: false, skip_reason: null, audio_purged: 0, redacted_purged: 0, activity_purged: 0 };
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
    const days = await resolveRetentionDays();
    const cleanup = await db().collection("sales_intelligence_jobs").find({ status: "completed", stage: "media_fetch", "result.pending_blob_delete": { $type: "string" } }).sort({ updatedAt: 1 }).limit(limit).toArray();
    for (const job of cleanup) {
      if (!await leases.assertHeld({ token, now: now() })) throw new Error("retention_lease_lost");
      const pathname = job.result.pending_blob_delete as string;
      try { await (overrides.deleteAudio ?? defaultDeleteStoredAudio)(pathname); }
      catch { return { ...summary, skipped: true, skip_reason: "blob_delete_failed" }; }
      await commit(async session => {
        await db().collection("sales_intelligence_jobs").updateOne({ _id: job._id, "result.pending_blob_delete": pathname }, { $unset: { "result.pending_blob_delete": "" } }, { session });
      });
      summary.audio_purged++;
    }
    const cutoff = (n: number) => new Date(started.getTime() - n * 86_400_000);
    if (days.audio_days > 0) {
      const rows = await db().collection(LEAD_CONVERSATION_COLLECTION).find({ "media.stored_at": { $lte: cutoff(days.audio_days) }, "media.purged_at": null, "media.blob_pathname": { $type: "string" } }).sort({ "media.stored_at": 1 }).limit(limit).toArray();
      for (const row of rows) {
        if (!await leases.assertHeld({ token, now: now() })) throw new Error("retention_lease_lost");
        try { await (overrides.deleteAudio ?? defaultDeleteStoredAudio)(row.media.blob_pathname); }
        catch { return { ...summary, skipped: true, skip_reason: "blob_delete_failed" }; }
        await commit(async session => {
          await db().collection(LEAD_CONVERSATION_COLLECTION).updateOne({ _id: row._id, "media.blob_pathname": row.media.blob_pathname }, { $set: { "media.purged_at": started, "media.blob_url": null, "media.blob_pathname": null } }, { session });
        });
        summary.audio_purged++;
      }
    }
    if (days.redacted_days > 0) {
      const rows = await db().collection("intelligence_evidence_snapshots").find({ purged_at: null, retrieved_at: { $lte: cutoff(days.redacted_days) } }).sort({ retrieved_at: 1 }).limit(limit).toArray();
      for (const row of rows) {
        await commit(async session => { await purgeContent(row, "snapshot", started, session); });
        summary.redacted_purged++;
      }
      const legacy = await db().collection(LEAD_CONVERSATION_COLLECTION).find({ $or: [{ content_purge_pending: true }, { content_purged_at: null, $or: [
        { "transcript.created_at": { $lte: cutoff(days.redacted_days) } },
        { "summary.created_at": { $lte: cutoff(days.redacted_days) } },
      ] }] }).limit(limit).toArray();
      for (const row of legacy) {
        await commit(async session => { const more = await purgeContent({ ...row, conversation_id: row._id, source_type: "transcript", subject_key: `conversation:${row._id}` }, "snapshot", started, session);
          await db().collection(LEAD_CONVERSATION_COLLECTION).updateOne({ _id: row._id }, { $set: { content_purge_pending: more } }, { session }); });
        summary.redacted_purged++;
      }
      // Exact prompts can exist before the first captured response (failed/abandoned runs).
      const runs = await db().collection("intelligence_runs").find({ purged_at: null, createdAt: { $lte: cutoff(days.redacted_days) } }).sort({ createdAt: 1 }).limit(limit).toArray();
      for (const row of runs) {
        await commit(async session => { await purgeContent(row, "run", started, session); });
        summary.redacted_purged++;
      }
    }
    if (days.activity_days > 0) {
      const rows = await db().collection("call_interactions").find({ started_at: { $lte: cutoff(days.activity_days) }, purged_at: null }).sort({ started_at: 1 }).limit(limit).toArray();
      for (const row of rows) await commit(async session => {
        await db().collection("call_interactions").updateOne({ _id: row._id }, { $set: { purged_at: started, parties: [], legs: [], recordings: [], external_e164: null, provider_names: [] } }, { session });
        // Keep provider identifiers and aliases to prevent replay from resurrecting the call.
        await db().collection("outreach_followups").updateMany({ source_interaction_id: row._id }, { $set: { purged_at: started, description: "Activity removed by retention.", date_text: null, date_resolution: null, status: "cancelled" } }, { session });
      });
      summary.activity_purged = rows.length;
      const numbers = await db().collection("contact_numbers").find({ last_activity_at: { $lte: cutoff(days.activity_days) }, purged_at: null }).limit(limit).toArray();
      for (const number of numbers) await commit(async session => { await purgeNumberActivity(number._id, started, session); });
    }
    return summary;
  } finally { await leases.release({ token, now: now() }).catch(() => undefined); }
}

async function purgeNumberActivity(id: ObjectId, at: Date, session: ClientSession) {
  const options = { session }, database = db();
  // A future genuine call may create a new Contact Number; retained call aliases still dedupe history.
  await database.collection("contact_numbers").updateOne({ _id: id }, { $set: { purged_at: at, e164: `purged:${id}`, national_ten: null, digits_reversed: "", provider_names: [], search_terms: [], running_summary: null, rollups: { interactions_total: 0, inbound_total: 0, outbound_total: 0, human_conversations_total: 0, attached_lead_count: 0, candidate_lead_count: 0, open_outreach_count: 0 }, contact_eligibility: { state: "suppressed", reason: "retention" }, intelligence_schedule: null } }, options);
  await database.collection("number_lead_attachments").deleteMany({ contact_number_id: id }, options);
  const records = await database.collection("outreach_records").find({ primary_contact_number_id: id }, options).project({ _id: 1 }).toArray();
  await database.collection("outreach_records").updateMany({ primary_contact_number_id: id }, { $set: { purged_at: at, state: "closed", closed_reason: "manual", closed_at: at, assignment: null } }, options);
  await database.collection("outreach_followups").updateMany({ outreach_record_id: { $in: records.map(r => r._id) } }, { $set: { purged_at: at, description: "Activity removed by retention.", date_text: null, date_resolution: null, assignment: null, status: "cancelled" } }, options);
  await database.collection("owner_rep_nudges").updateMany({ contact_number_id: id }, { $set: { purged_at: at, body_as_sent: "", destination: "", authorized_command: null, sender_did: null, rc_extension_name_snapshot: null } }, options);
}
