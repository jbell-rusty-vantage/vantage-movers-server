import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { withTransaction } from "../../../db";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getSalesIntelligenceSyncStateModel, SALES_INTELLIGENCE_SYNC_STATE_INDEXES } from "../../../models/SalesIntelligenceSyncState";
import { activeTokenFilter, MongoLeaseStore } from "../../durableWork/leases";
import { CsiError } from "../auth";
import { claimCsiJob, completeCsiJob, enqueueCsiJob, failCsiJob } from "../jobs";
import { assertIndexes } from "../transactions";
import { loadCanonicalInteraction } from "../conversations/workerSupport";
import { loadLead, type LeadSource } from "./sources";
import type { LeadRef } from "./suggest";
import { persistLeadAttachments } from "./store";
import { rediscoverAttachmentPage } from "./hooks";

const PAGE = 250;
async function enqueueNumberScan(numberId: string, revision: number, session: ClientSession, model: LeadRef["model"], after?: string) {
  return enqueueCsiJob({ stage: "attachment_refresh", subject_key: `attachment-scan:${model}:${numberId}`,
    dedupe_key: `csi:attachment-scan:${model}:${numberId}:${revision}:${after ?? "start"}`,
    input_revision: revision, input_refs: [numberId, ...(after ? [after] : [])] }, session);
}
/** Queue payload remains {job_id}. Only durable input_refs and current documents supply inputs. */
export async function runAttachmentRefreshJob(jobId?: string) {
  if (!csiFlag("ATTACHMENT_REFRESH")) return { status: "disabled" };
  const row = await claimCsiJob(`attachment:${randomUUID()}`, jobId, 300_000, "attachment_refresh");
  if (!row) return { status: "not_claimable" };
  const lease = { job_id: String(row._id), owner: row.lease_owner!, epoch: row.lease_epoch };
  try {
    const changed = await completeCsiJob(lease, async session => {
      if (!csiFlag("ATTACHMENT_REFRESH")) throw new CsiError("FEATURE_DISABLED");
      const refs = row.input_refs.map(String), first = refs[0];
      if (!first) throw new CsiError("INVALID_INPUT");
      if (row.subject_key.startsWith("attachment-change:")) {
        return rediscoverAttachmentPage({ number_id: first, revision: row.input_revision }, session, refs[1]);
      }
      if (row.subject_key.startsWith("attachment-lead:")) {
        const model = row.subject_key.split(":")[1];
        if (model !== "FormLead" && model !== "CallLead") throw new CsiError("INVALID_INPUT");
        const lead = await loadLead({ model, id: first }, session);
        return lead ? persistLeadAttachments(lead, model, session, lease.job_id) : 0;
      }
      if (row.subject_key.startsWith("attachment-scan:")) {
        const model = row.subject_key.split(":")[1];
        if (model !== "FormLead" && model !== "CallLead") throw new CsiError("INVALID_INPUT");
        if (!await getContactNumberModel().exists({ _id: first }).session(session)) return 0;
        const filter = refs[1] ? { _id: { $gt: new mongoose.Types.ObjectId(refs[1]) } } : {};
        const leads: LeadSource[] = model === "FormLead" ? await getFormLeadModel().find(filter).sort({ _id: 1 }).limit(PAGE).session(session).lean() :
          await getCallLeadModel().find(filter).sort({ _id: 1 }).limit(PAGE).session(session).lean();
        let count = 0;
        for (const lead of leads) count += await persistLeadAttachments(lead, model, session, lease.job_id, new Date(), first);
        if (leads.length === PAGE) await enqueueNumberScan(first, row.input_revision, session, model, String(leads.at(-1)!._id));
        return count;
      }
      // B's frozen number job references an interaction, including merge tombstones.
      const interaction = await loadCanonicalInteraction(first, session);
      if (!interaction.contact_number_id) return 0;
      for (const model of ["FormLead", "CallLead"] as const) await enqueueNumberScan(String(interaction.contact_number_id), row.input_revision, session, model);
      return 0;
    }, { resultFrom: changed => ({ changed }) });
    return { status: "completed", changed };
  } catch (error) {
    if (error instanceof CsiError && error.code === "LEASE_LOST") return { status: "lease_lost" };
    await failCsiJob(lease, "transient");
    return { status: "retry" };
  }
}
export async function drainAttachmentRefreshJobs(max = 20) {
  const outcomes = [];
  const deadline = Date.now() + 40_000;
  for (let i = 0; i < Math.min(100, max) && Date.now() < deadline; i++) {
    const result = await runAttachmentRefreshJob();
    outcomes.push(result.status);
    if (["disabled", "not_claimable", "lease_lost"].includes(result.status)) break;
  }
  return { outcomes };
}
/** Bounded 500-source scan: 200 Form Leads, 200 Call Leads, 100 Contact Numbers.
 * Keyset (updatedAt,_id) prevents equal-timestamp loss. Checkpoints commit with job intents.
 * EntityChange.applied_at remains a later scan source; CSI never writes EntityChange.
 */
export async function runAttachmentRefreshOnce() {
  if (!csiFlag("ATTACHMENT_REFRESH")) return { skipped: true, reason: "disabled", scanned: 0 };
  const State = getSalesIntelligenceSyncStateModel();
  await assertIndexes(State.collection, SALES_INTELLIGENCE_SYNC_STATE_INDEXES);
  const store = new MongoLeaseStore(State);
  const token = await store.acquire({ scope: "attachment_suggest", owner: randomUUID(), now: new Date(), ttl_ms: 300_000 });
  if (!token) return { skipped: true, reason: "lease_held", scanned: 0 };
  try {
    const scanned = await withTransaction(async session => {
      let count = 0;
      for (const model of ["FormLead", "CallLead", "ContactNumber"] as const) {
        const scope = `attachment_watermark:${model}`;
        const cursor = (await State.findOne({ scope }).session(session).lean())?.cursor;
        const at = cursor?.provider_modified_watermark ?? new Date(0), id = cursor?.attachment_source_id;
        const field = model === "ContactNumber" ? "last_activity_at" : "updatedAt";
        const filter = { $or: [{ [field]: { $gt: at } }, { [field]: at, _id: { $gt: id ?? new mongoose.Types.ObjectId("000000000000000000000000") } }] };
        const sort: Record<string, 1> = { [field]: 1, _id: 1 };
        const rows = model === "FormLead" ? await getFormLeadModel().find(filter).sort(sort).limit(200).session(session).lean() :
          model === "CallLead" ? await getCallLeadModel().find(filter).sort(sort).limit(200).session(session).lean() :
            await getContactNumberModel().find(filter).sort(sort).limit(100).session(session).lean();
        for (const source of rows) {
          const sourceId = String(source._id);
          const time = "last_activity_at" in source ? source.last_activity_at : source.updatedAt;
          if (!time) continue;
          if (model === "ContactNumber") {
            if (!await getNumberLeadAttachmentModel().exists({ contact_number_id: sourceId }).session(session)) {
              for (const leadModel of ["FormLead", "CallLead"] as const) await enqueueNumberScan(sourceId, +time, session, leadModel);
            }
          } else await enqueueCsiJob({ stage: "attachment_refresh", subject_key: `attachment-lead:${model}:${sourceId}`,
            dedupe_key: `csi:attachment-lead:${model}:${sourceId}:${+time}`, input_revision: +time, input_refs: [sourceId] }, session);
          await State.updateOne({ scope }, { $set: { "cursor.provider_modified_watermark": time, "cursor.attachment_source_id": source._id } }, { session, upsert: true });
          count++;
        }
      }
      const fence = await State.updateOne(activeTokenFilter(token, new Date()), { $set: { "cursor.last_sync_to": new Date() } }, { session });
      if (fence.modifiedCount !== 1) throw new CsiError("LEASE_LOST");
      return count;
    });
    return { skipped: false, scanned, ...(await drainAttachmentRefreshJobs()) };
  } finally { await store.release({ token, now: new Date() }); }
}
