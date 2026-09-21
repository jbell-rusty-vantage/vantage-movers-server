import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../../db";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceSubmissionModel } from "../../../models/IntelligenceSubmission";
import { MongoLeaseStore, activeTokenFilter } from "../../durableWork/leases";
import { enqueueCsiJob } from "../jobs";
import { CsiError } from "../auth";
import { intelligenceSources } from "./sources";

/** Existing Outreach intents are change signals, coalesced into one number-owned analysis job. */
export async function scheduleNumberIntelligence(numberId: string, session: ClientSession) {
  let sources: Awaited<ReturnType<typeof intelligenceSources>>;
  try { sources = await intelligenceSources(numberId, session); }
  catch (error) {
    if (!(error instanceof CsiError) || error.code !== "EVIDENCE_LIMIT_REACHED") throw error;
    const overflow = await enqueueCsiJob({ stage: "number_refresh", subject_key: `number:${numberId}`,
      dedupe_key: `csi:number-analysis:overflow:${numberId}`, input_revision: 1, input_refs: [numberId] }, session);
    await getSalesIntelligenceJobModel().updateOne({ _id: overflow._id, status: "pending" },
      { $set: { status: "paused", reason: "evidence_limit_reached", result: { reason: "incomplete_coverage" } } }, { session });
    return String(overflow._id);
  }
  const prior = sources.number.intelligence_schedule;
  if (prior) {
    const active = await getSalesIntelligenceJobModel().findOne({ _id: prior.job_id, ...csiDataset() }).session(session).lean();
    if (active && !["completed", "dead_letter"].includes(active.status)) return String(active._id);
    // Analysis delivery completes at submission, but its run remains active through application.
    const applying = active ? await getIntelligenceRunModel().findOne({ job_id: active._id, ...csiDataset(), status: "submitted" }).session(session).lean() : null;
    if (applying) {
      const receipt = await getIntelligenceSubmissionModel().findOne({ run_id: applying._id }).session(session).lean();
      if (receipt && await getSalesIntelligenceJobModel().exists({ _id: receipt.application_job_id, status: { $nin: ["completed", "dead_letter"] } }).session(session)) return String(active!._id);
    }
    if (prior.fingerprint === sources.fingerprint) return null;
  }
  const generation = (prior?.generation ?? 0) + 1;
  const job = await enqueueCsiJob({ stage: "number_refresh", subject_key: `number:${numberId}`,
    dedupe_key: `csi:number-analysis:${numberId}:${generation}`, input_revision: generation, input_refs: [numberId], priority: 0 }, session,
    new Date(Date.now() + 15_000));
  const changed = await getContactNumberModel().updateOne({ _id: numberId, revision: sources.number.revision },
    { $set: { intelligence_schedule: { fingerprint: sources.fingerprint, generation, job_id: job._id } }, $inc: { revision: 1 } }, { session });
  if (changed.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
  return String(job._id);
}
export async function consumeNumberRefreshSignal(subject: string, refs: readonly unknown[], session: ClientSession) {
  const record = refs[0] ? await getOutreachRecordModel().findById(refs[0]).session(session).lean() : null;
  const numberId = record?.primary_contact_number_id ? String(record.primary_contact_number_id) : subject.startsWith("number:") ? subject.slice(7) : null;
  return numberId ? scheduleNumberIntelligence(numberId, session) : null;
}
const AUDIT_PAGE = 200;
const CHANGE_DRIVEN_LIMIT = 20;
const REPAIR_SWEEP_LIMIT = 5;

/**
 * Contact Numbers named by committed CSI audit events, in stream order.
 *
 * Nomination is deliberately allowed to be imperfect in both directions: a
 * number nominated for a change that does not move its fingerprint costs one
 * `scheduleNumberIntelligence` no-op, and a change this mapping does not
 * recognise is still picked up by the repair sweep. `scheduleNumberIntelligence`
 * remains the only authority on whether a run is warranted, because it
 * compares the real fingerprint.
 */
async function numbersNamedByAudit(
  events: readonly { subject_key: string }[],
  session: ClientSession,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const interactionIds: string[] = [], conversationIds: string[] = [], leadKeys: string[] = [];
  for (const event of events) {
    const [kind, ...rest] = event.subject_key.split(":");
    if (kind === "number" && rest[0]) out.set(event.subject_key, rest[0]);
    else if (kind === "interaction" && rest[0]) interactionIds.push(rest[0]);
    else if (kind === "conversation" && rest[0]) conversationIds.push(rest[0]);
    else if (kind === "lead" && rest[1]) leadKeys.push(event.subject_key);
  }
  if (interactionIds.length) {
    for (const row of await getCallInteractionModel().find({ _id: { $in: interactionIds }, contact_number_id: { $ne: null } },
      { contact_number_id: 1 }).session(session).lean()) out.set(`interaction:${row._id}`, String(row.contact_number_id));
  }
  if (conversationIds.length) {
    for (const row of await getLeadConversationModel().find({ _id: { $in: conversationIds }, contact_number_id: { $ne: null } },
      { contact_number_id: 1 }).session(session).lean()) out.set(`conversation:${row._id}`, String(row.contact_number_id));
  }
  if (leadKeys.length) {
    const refs: Array<{ "subject.model": "FormLead" | "CallLead"; "subject.id": string }> = [];
    for (const key of leadKeys) {
      const [, model, id] = key.split(":");
      if ((model === "FormLead" || model === "CallLead") && id) refs.push({ "subject.model": model, "subject.id": id });
    }
    for (const row of refs.length ? await getOutreachRecordModel().find({ primary_contact_number_id: { $ne: null }, $or: refs },
      { subject: 1, primary_contact_number_id: 1 }).session(session).lean() : []) {
      out.set(`lead:${row.subject.model}:${row.subject.id}`, String(row.primary_contact_number_id));
    }
  }
  return out;
}

/**
 * Number synthesis scheduling, driven by the durable audit stream with the
 * round-robin kept as a slow repair sweep (14 §10).
 *
 * The round-robin alone walked five external numbers per five-minute cron:
 * 1,440 a day against 4,000+ numbers, so roughly 2.8 days per lap, and a
 * fingerprint change arriving through a non-publishing path waited that long
 * for synthesis. Source changes are still compared by meaning, never by clock:
 * the stream only nominates candidates.
 */
export async function scanIntelligenceChanges() {
  if (!csiFlag("ENABLED") || !csiFlag("EXTRACTION_ENABLED")) return { status: "disabled", scanned: 0, changed: 0 };
  const Model = getSalesIntelligenceSyncStateModel(), store = new MongoLeaseStore(Model);
  const token = await store.acquire({ scope: "intelligence_source_scan", owner: randomUUID(), now: new Date(), ttl_ms: 300_000 });
  if (!token) return { status: "lease_held", scanned: 0, changed: 0 };
  try {
    return await withTransaction(async session => {
      const state = await Model.findOne({ scope: token.scope }).session(session).lean();
      const scheduled = new Set<string>();

      // 1. Change-driven: everything the audit stream has named since the cursor.
      const at = state?.cursor?.audit_recorded_at ?? new Date(0);
      const id = state?.cursor?.audit_event_id ?? new mongoose.Types.ObjectId("000000000000000000000000");
      const events = await getSalesIntelligenceAuditEventModel().find({
        $or: [{ recorded_at: { $gt: at } }, { recorded_at: at, _id: { $gt: id } }],
      }, { recorded_at: 1, subject_key: 1 }).sort({ recorded_at: 1, _id: 1 }).limit(AUDIT_PAGE).session(session).lean();
      const named = await numbersNamedByAudit(events, session);
      // The cursor advances only over events this run actually consumed, so a
      // burst that exceeds the per-run schedule budget is resumed, not dropped.
      let consumed: (typeof events)[number] | null = null;
      for (const event of events) {
        const numberId = named.get(event.subject_key);
        if (numberId && !scheduled.has(numberId) && scheduled.size >= CHANGE_DRIVEN_LIMIT) break;
        if (numberId) scheduled.add(numberId);
        consumed = event;
      }
      for (const numberId of scheduled) await scheduleNumberIntelligence(numberId, session);

      // 2. Repair sweep: the original round-robin, unchanged, so a number no
      //    audit event ever names is still revisited.
      const after = state?.cursor?.attachment_source_id;
      const rows = await getContactNumberModel().find({ kind: "external", ...(after ? { _id: { $gt: after } } : {}) })
        .sort({ _id: 1 }).limit(REPAIR_SWEEP_LIMIT).session(session).lean();
      for (const number of rows) {
        if (scheduled.has(String(number._id))) continue;
        await scheduleNumberIntelligence(String(number._id), session);
      }

      const updated = await Model.updateOne(activeTokenFilter(token, new Date()), { $set: {
        "cursor.attachment_source_id": rows.length === REPAIR_SWEEP_LIMIT ? rows.at(-1)!._id : null,
        ...(consumed ? { "cursor.audit_recorded_at": consumed.recorded_at, "cursor.audit_event_id": consumed._id } : {}),
      } }, { session });
      if (updated.modifiedCount !== 1 && updated.matchedCount !== 1) throw new CsiError("LEASE_LOST");
      return { status: "scanned", scanned: rows.length, changed: scheduled.size };
    });
  } finally { await store.release({ token, now: new Date() }); }
}
