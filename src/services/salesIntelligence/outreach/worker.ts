import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { withTransaction } from "../../../db";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { MongoLeaseStore, activeTokenFilter } from "../../durableWork/leases";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob } from "../jobs";
import { loadCanonicalInteraction } from "../conversations/workerSupport";
import { ensureInteraction, ensureLead, workerContext } from "./ensure";
import { refreshRecord, jsonValue } from "./store";
import { payloadHash } from "../transactions";
import { publishAttentionSnapshot } from "./attention";

export async function runOutreachEnsureJob(jobId?: string) {
  if (!csiFlag("OUTREACH_ENSURE")) return { status: "disabled" };
  const job = await claimCsiJob(`outreach:${randomUUID()}`, jobId, 300_000, "outreach_ensure");
  if (!job) return { status: "not_claimable" };
  const lease = { job_id: String(job._id), owner: job.lease_owner!, epoch: job.lease_epoch };
  try {
    await completeCsiJob(lease, async session => {
      if (!csiFlag("OUTREACH_ENSURE")) throw new CsiError("FEATURE_DISABLED");
      const context = workerContext(session, lease.job_id), first = String(job.input_refs[0] ?? "");
      if (!first) throw new CsiError("INVALID_INPUT");
      if (job.subject_key.startsWith("outreach-lead:")) {
        const model = job.subject_key.split(":")[1];
        if (model !== "FormLead" && model !== "CallLead") throw new CsiError("INVALID_INPUT");
        await ensureLead({ model, id: first }, context);
      } else if (job.subject_key.startsWith("outreach-clock:")) {
        const record = await getOutreachRecordModel().findById(first).session(session);
        if (record) {
          if (record.subject.kind === "lead") await ensureLead({ model: record.subject.model!, id: String(record.subject.id) }, context);
          const current = await getOutreachRecordModel().findById(first).session(session);
          if (current) await refreshRecord(current, context, "clock_boundary", current.toObject());
        }
      } else {
        const call = await loadCanonicalInteraction(first, session);
        await ensureInteraction(call, context);
      }
    });
    return { status: "completed" };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await failCsiJob(lease, "transient"); return { status: "retry" };
  }
}
export async function drainOutreachEnsureJobs(max = 50) {
  const outcomes: string[] = [], deadline = Date.now() + 40_000;
  for (let i = 0; i < max && Date.now() < deadline; i++) {
    const result = await runOutreachEnsureJob(); outcomes.push(result.status);
    if (["not_claimable", "disabled", "lease_lost"].includes(result.status)) break;
  }
  return { outcomes };
}
/** Durable applied_at scan plus paged baseline/repair sweeps. No updatedAt-based official event cursor. */
export async function runOutreachEnsureOnce() {
  if (!csiFlag("OUTREACH_ENSURE")) return { skipped: true, reason: "disabled", scanned: 0 };
  const State = getSalesIntelligenceSyncStateModel(), store = new MongoLeaseStore(State);
  const token = await store.acquire({ scope: "outreach_ensure", owner: randomUUID(), now: new Date(), ttl_ms: 300_000 });
  if (!token) return { skipped: true, reason: "lease_held", scanned: 0 };
  try {
    const scanned = await withTransaction(async session => {
      let count = 0;
      const state = await State.findOne({ scope: "outreach_entity_changes" }).session(session).lean();
      const at = state?.cursor?.entity_change_applied_at ?? new Date(0), id = state?.cursor?.entity_change_id ?? new mongoose.Types.ObjectId("000000000000000000000000");
      const changes = await getEntityChangeModel().find({ "entity.model": { $in: ["FormLead", "CallLead"] }, $or: [{ applied_at: { $gt: at } }, { applied_at: at, _id: { $gt: id } }] }).sort({ applied_at: 1, _id: 1 }).limit(100).session(session).lean();
      for (const change of changes) {
        await enqueueCsiJob({ stage: "outreach_ensure", subject_key: `outreach-lead:${change.entity.model}:${change.entity.id}`,
          dedupe_key: `csi:outreach:entity-change:${change._id}`, input_revision: Math.max(1, change.revision_after), input_refs: [change.entity.id] }, session);
        await State.updateOne({ scope: "outreach_entity_changes" }, { $set: { "cursor.entity_change_applied_at": change.applied_at, "cursor.entity_change_id": change._id } }, { session, upsert: true }); count++;
      }
      // Rolling _id sweeps recover old records and commits behind a time watermark, without expiring misses.
      for (const source of ["FormLead", "CallLead", "CallInteraction", "OutreachRecord"] as const) {
        const scope = `outreach_repair:${source}`;
        const prior = await State.findOne({ scope }).session(session).lean();
        const after = prior?.cursor?.attachment_source_id;
        const cycle = prior?.cursor?.provider_modified_watermark ?? new Date();
        const filter = after ? { _id: { $gt: after } } : {};
        const rows = source === "FormLead" ? await getFormLeadModel().find(filter).sort({ _id: 1 }).limit(50).session(session).lean() :
          source === "CallLead" ? await getCallLeadModel().find(filter).sort({ _id: 1 }).limit(50).session(session).lean() :
          source === "CallInteraction" ? await getCallInteractionModel().find({ ...filter, merged_into_id: null }).sort({ _id: 1 }).limit(50).session(session).lean() :
          await getOutreachRecordModel().find(filter).sort({ _id: 1 }).limit(50).session(session).lean();
        for (const row of rows) {
          const subject = source === "CallInteraction" ? `number:${"contact_number_id" in row ? row.contact_number_id : row._id}` : source === "OutreachRecord" ? `outreach-clock:${row._id}` : `outreach-lead:${source}:${row._id}`;
          const fingerprint = source === "OutreachRecord" ? String(+cycle) : "projection_revision" in row ? String(row.projection_revision) :
            payloadHash(jsonValue({ id: String(row._id), official: { booked: "booked" in row ? row.booked ?? null : null, cancelled: "cancelled" in row ? row.cancelled ?? null : null,
              duplicate: "duplicate" in row ? row.duplicate ?? false : false, bad_lead: "bad_lead" in row ? row.bad_lead ?? null : null, no_sync: "no_sync" in row ? row.no_sync ?? false : false } }));
          const revision = "projection_revision" in row ? row.projection_revision : parseInt(payloadHash(fingerprint).slice(0, 12), 16) + 1;
          await enqueueCsiJob({ stage: "outreach_ensure", subject_key: subject, dedupe_key: `csi:outreach:repair:${source}:${row._id}:${fingerprint}`,
            input_revision: revision, input_refs: [String(row._id)] }, session); count++;
        }
        await State.updateOne({ scope }, { $set: { "cursor.attachment_source_id": rows.length === 50 ? rows.at(-1)!._id : null,
          "cursor.provider_modified_watermark": rows.length === 50 ? cycle : new Date() } }, { session, upsert: true });
      }
      const fence = await State.updateOne(activeTokenFilter(token, new Date()), { $set: { "cursor.last_sync_to": new Date() } }, { session });
      if (fence.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
      return count;
    });
    return { skipped: false, scanned, ...(await drainOutreachEnsureJobs(100)), attention: await publishAttentionSnapshot() };
  } finally { await store.release({ token, now: new Date() }); }
}
