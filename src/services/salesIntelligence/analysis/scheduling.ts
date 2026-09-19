import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import { withTransaction } from "../../../db";
import { csiDataset, csiFlag } from "../../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
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
/** Reuse the existing durable sweep cursor/lease: all source changes are compared by meaning, never by clock. */
export async function scanIntelligenceChanges() {
  if (!csiFlag("ENABLED") || !csiFlag("EXTRACTION_ENABLED")) return { status: "disabled", scanned: 0 };
  const Model = getSalesIntelligenceSyncStateModel(), store = new MongoLeaseStore(Model);
  const token = await store.acquire({ scope: "intelligence_source_scan", owner: randomUUID(), now: new Date(), ttl_ms: 300_000 });
  if (!token) return { status: "lease_held", scanned: 0 };
  try {
    return await withTransaction(async session => {
      const state = await Model.findOne({ scope: token.scope }).session(session).lean();
      const after = state?.cursor?.attachment_source_id;
      const rows = await getContactNumberModel().find({ kind: "external", ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(5).session(session).lean();
      for (const number of rows) await scheduleNumberIntelligence(String(number._id), session);
      const updated = await Model.updateOne(activeTokenFilter(token, new Date()), { $set: { "cursor.attachment_source_id": rows.length === 5 ? rows.at(-1)!._id : null } }, { session });
      if (updated.modifiedCount !== 1 && updated.matchedCount !== 1) throw new CsiError("LEASE_LOST");
      return { status: "scanned", scanned: rows.length };
    });
  } finally { await store.release({ token, now: new Date() }); }
}
