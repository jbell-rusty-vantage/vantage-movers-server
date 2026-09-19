import type { ClientSession } from "mongoose";
import { z } from "zod";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { CsiError } from "../auth";
import { payloadHash, type CsiTransactionContext } from "../transactions";
import { enqueueCsiJob } from "../jobs";
import { subjectKey } from "../outreach/types";
import { readContentSchema } from "./reads";
import { newObjectIdHex } from "../../../utils/objectId";

type Source = { _id?: unknown; subject_key: string; contact_number_id?: unknown; conversation_id?: unknown; outreach_record_id?: unknown };
export const correctionContextSchema = z.array(z.object({ id: z.string(), instruction_id: z.string(), revision: z.number().int().positive(),
  field: z.string(), prior: z.json(), current: z.json(), happened_at: z.string() }).strict());
export async function authorizedCorrections(source: Source, ids: readonly string[], session: ClientSession) {
  if (new Set(ids).size !== ids.length) throw new CsiError("INVALID_INPUT");
  const subjects = [source.subject_key, `number:${source.contact_number_id}`];
  if (source.outreach_record_id) {
    const record = await getOutreachRecordModel().findOne({ _id: String(source.outreach_record_id), primary_contact_number_id: String(source.contact_number_id) }).session(session).lean();
    if (!record) throw new CsiError("RUN_SCOPE_DENIED");
    subjects.push(subjectKey(record.subject));
  }
  const rows = await getSalesIntelligenceOwnerInstructionModel().find({ _id: { $in: ids }, subject_key: { $in: subjects }, state: "active" }).session(session).lean();
  if (rows.length !== ids.length) throw new CsiError("RUN_SCOPE_DENIED");
  return rows.sort((a, b) => ids.indexOf(String(a._id)) - ids.indexOf(String(b._id)));
}
export async function retainedOriginal(sourceId: string, session?: ClientSession) {
  const run = await getIntelligenceRunModel().findOne({ _id: sourceId, ...csiDataset() }).session(session ?? null).lean();
  if (!run?.finalized_at || !run.rendered_prompt || !run.manifest_digest) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  const snapshots = await getIntelligenceEvidenceSnapshotModel().find({ run_id: run._id, ...csiDataset() }).sort({ _id: 1 }).session(session ?? null).lean();
  if (!snapshots.length || snapshots.length !== run.manifest_snapshot_ids.length ||
    payloadHash(snapshots.map(s => ({ id: String(s._id), digest: s.content_digest }))) !== run.manifest_digest) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
  for (const snapshot of snapshots) {
    const parsed = readContentSchema.safeParse(snapshot.response);
    if (snapshot.purged_at || !parsed.success || payloadHash(parsed.data) !== snapshot.content_digest) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
    if (parsed.data.transcript) {
      const transcript = await getIntelligenceEvidenceSnapshotModel().findOne({ _id: parsed.data.transcript.source_snapshot_id, ...csiDataset(), purged_at: null }).session(session ?? null).lean();
      if (!transcript) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
    }
  }
  return { run, snapshots };
}
export async function scheduleOwnerReanalysis(sourceId: string, mode: "original_evidence" | "current_context", correctionIds: string[], context: CsiTransactionContext) {
  const source = await getIntelligenceRunModel().findOne({ _id: sourceId, ...csiDataset() }).session(context.session).lean();
  if (!source?.output || !source.finalized_at) throw new CsiError("INVALID_INPUT");
  await authorizedCorrections(source, correctionIds, context.session);
  const original = mode === "original_evidence" ? await retainedOriginal(sourceId, context.session) : null;
  let refs: string[] = [];
  if (source.conversation_id) {
    const conversation = await getLeadConversationModel().findById(source.conversation_id).session(context.session).lean();
    const snapshot = original ? original.snapshots.map(s => readContentSchema.parse(s.response).transcript).find(Boolean)?.source_snapshot_id
      : conversation ? String((await getIntelligenceEvidenceSnapshotModel().findOne({ conversation_id: conversation._id, transcript_version: conversation.latest_transcript_version,
        source_type: "transcript", ...csiDataset(), purged_at: null }).session(context.session).lean())?._id ?? "") : "";
    if (!snapshot) throw new CsiError("ORIGINAL_EVIDENCE_UNAVAILABLE");
    refs = [String(source.conversation_id), snapshot];
  }
  const runId = newObjectIdHex();
  const job = await enqueueCsiJob({ dedupe_key: `csi:owner-reanalysis:${context.command_id}`, stage: source.conversation_id ? "analysis" : "number_refresh",
    subject_key: source.subject_key, input_revision: source.revision, input_refs: refs,
    owner_reanalysis: { run_id: runId, source_run_id: sourceId, mode, owner_correction_ids: correctionIds } }, context.session);
  return { run_id: runId, job_id: String(job._id), status: "queued" };
}
