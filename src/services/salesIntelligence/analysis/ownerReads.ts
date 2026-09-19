import { z } from "zod";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceOwnerAssessmentModel } from "../../../models/IntelligenceOwnerAssessment";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { csiIdSchema } from "../../../validation/v1/salesIntelligence";
import { ownerRead } from "../../numberActivity/coverage";
import { payloadHash } from "../transactions";
import { CsiError } from "../auth";
import { subjectKey } from "../outreach/types";
import { readContentSchema } from "./reads";
import { retainedOriginal } from "./ownerReanalysis";
import { getSalesIntelligenceJobModel } from "../../../models/SalesIntelligenceJob";

export const ownerAnalysisQuery = z.object({ scope: z.literal("production").optional(), contact_number_id: csiIdSchema.optional(),
  conversation_id: csiIdSchema.optional(), cursor: csiIdSchema.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).strict();
const runSummary = (r: { _id: unknown; revision: number; status: string; mode: string; conversation_id?: unknown; completed_at?: Date | null; createdAt: Date }) =>
  ({ id: String(r._id), revision: r.revision, status: r.status, mode: r.mode, conversation_id: r.conversation_id ? String(r.conversation_id) : null,
    created_at: r.createdAt.toISOString(), completed_at: r.completed_at?.toISOString() ?? null });
export async function listOwnerRuns(raw: unknown) {
  const q = ownerAnalysisQuery.parse(raw);
  if (!q.contact_number_id && !q.conversation_id) throw new CsiError("INVALID_INPUT");
  const rows = await getIntelligenceRunModel().find({ ...csiDataset(), ...(q.contact_number_id ? { contact_number_id: q.contact_number_id } : {}),
    ...(q.conversation_id ? { conversation_id: q.conversation_id } : {}), ...(q.cursor ? { _id: { $lt: q.cursor } } : {}) }).sort({ _id: -1 }).limit(q.limit + 1).lean();
  return ownerRead({ items: rows.slice(0, q.limit).map(runSummary), next_cursor: rows.length > q.limit ? String(rows[q.limit - 1]._id) : null });
}
export async function readOwnerRun(id: string, raw: unknown = {}) {
  const query = z.object({ scope: z.literal("production").optional(), history_cursor: csiIdSchema.optional() }).strict().parse(raw);
  const run = await getIntelligenceRunModel().findOne({ _id: csiIdSchema.parse(id), ...csiDataset() }).lean();
  if (!run) return null;
  const [findings, effects, instructions, assessments, number, conversation, record, history] = await Promise.all([
    getIntelligenceFindingModel().find({ run_id: run._id }).sort({ _id: 1 }).lean(),
    getIntelligenceEffectModel().find({ run_id: run._id }).sort({ _id: 1 }).lean(),
    getSalesIntelligenceOwnerInstructionModel().find({ $or: [{ finding_id: { $in: await getIntelligenceFindingModel().find({ run_id: run._id }).distinct("_id") } },
      { subject_key: run.subject_key }, { subject_key: `number:${run.contact_number_id}` }] }).sort({ happened_at: -1 }).limit(201).lean(),
    getIntelligenceOwnerAssessmentModel().find({ run_id: run._id }).lean(),
    getContactNumberModel().findById(run.contact_number_id).lean(),
    run.conversation_id ? getLeadConversationModel().findById(run.conversation_id).lean() : null,
    run.outreach_record_id ? getOutreachRecordModel().findById(run.outreach_record_id).lean() : getOutreachRecordModel().findOne({ "subject.kind": "number_review", "subject.contact_number_id": run.contact_number_id }).lean(),
    getSalesIntelligenceAuditEventModel().find({ subject_key: run.subject_key, "invalidation.kind": "analysis",
      ...(query.history_cursor ? { _id: { $lt: query.history_cursor } } : {}) }).sort({ _id: -1 }).limit(101).lean(),
  ]);
  if (record) {
    const extra = await getSalesIntelligenceOwnerInstructionModel().find({ subject_key: subjectKey(record.subject) }).sort({ happened_at: -1 }).limit(201).lean();
    const seen = new Set(instructions.map(i => String(i._id)));
    instructions.push(...extra.filter(i => !seen.has(String(i._id))));
  }
  const current = String(run.conversation_id ? conversation?.latest_completed_run_id : number?.running_summary?.run_id) === id;
  const editable = current && run.status === "completed" && Boolean(run.output);
  const actionIds = effects.filter(e => e.target_id && ["create_followup", "revise_followup", "complete_followup"].includes(e.effect_kind)).map(e => e.target_id);
  const actions = await getOutreachFollowupModel().find({ _id: { $in: actionIds.map(String) } }).lean();
  const requests = await getSalesIntelligenceJobModel().find({ ...csiDataset(), "owner_reanalysis.source_run_id": run._id }).sort({ _id: -1 }).limit(50).lean();
  let available = false;
  try { await retainedOriginal(id); available = true; } catch (error) {
    if (!(error instanceof CsiError) || error.code !== "ORIGINAL_EVIDENCE_UNAVAILABLE") throw error;
  }
  return ownerRead({ ...runSummary(run), current, editable, output: run.output, output_digest: run.output ? payloadHash(run.output) : null,
    suggestion_output_digest: run.output?.next_step_suggestion ? payloadHash(run.output.next_step_suggestion) : null,
    model_version: run.model_version, prompt_version: run.prompt_version, processing_reason: run.processing_reason, original_evidence_available: available,
    reanalysis_requests: requests.map(j => ({ id: String(j._id), run_id: String(j.owner_reanalysis!.run_id), mode: j.owner_reanalysis!.mode,
      status: j.status, reason: j.reason, created_at: j.createdAt.toISOString() })),
    contact_number_id: String(run.contact_number_id), outreach: record ? { id: String(record._id), revision: record.revision, state: record.state } : null,
    findings: findings.map(f => ({ id: String(f._id), revision: f.revision, assertion: f.assertion, review_state: f.review_state, validation: f.validation,
      effects: effects.filter(e => String(e.finding_id) === String(f._id)).map(e => ({ id: String(e._id), kind: e.effect_kind, status: e.status, reason: e.reason,
        target_id: e.target_id ? String(e.target_id) : null, applied_at: e.applied_at.toISOString() })) })),
    actions: actions.map(a => ({ id: String(a._id), revision: a.revision, kind: a.kind, description: a.description, due_at: a.due_at?.toISOString() ?? null,
      responsible_agent_id: a.responsible_agent_id ? String(a.responsible_agent_id) : null, status: a.status, origin: a.origin })),
    instructions: instructions.slice(0, 200).map(i => {
      const assessment = assessments.find(a => String(a.instruction_id) === String(i.instruction_id) && a.instruction_revision === i.revision);
      return { id: String(i._id), instruction_id: String(i.instruction_id), revision: i.revision, finding_id: i.finding_id ? String(i.finding_id) : null,
        field: i.field, prior: i.prior, current: i.current, actor: i.actor.id, happened_at: i.happened_at.toISOString(),
        assessment: assessment?.assessment ?? "cannot_determine", reason: assessment?.reason ?? "This analysis did not assess this instruction version.",
        finding_ids: assessment?.finding_ids.map(String) ?? [], stale: assessments.some(a => String(a.instruction_id) === String(i.instruction_id) && a.instruction_revision !== i.revision) };
    }), instructions_complete: instructions.length <= 200,
    history: history.slice(0, 100).map(h => ({ id: String(h._id), event: h.event_kind, actor: h.actor.id, happened_at: h.happened_at.toISOString(), prior: h.prior, current: h.current })),
    history_next_cursor: history.length > 100 ? String(history[99]._id) : null,
  });
}
export async function readOwnerEvidence(runId: string, snapshotId?: string, raw: unknown = {}) {
  const q = z.object({ scope: z.literal("production").optional(), cursor: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).strict().parse(raw);
  const run = await getIntelligenceRunModel().findOne({ _id: csiIdSchema.parse(runId), ...csiDataset() }).lean();
  if (!run) return null;
  if (snapshotId) {
    csiIdSchema.parse(snapshotId);
    if (!run.manifest_snapshot_ids.some(s => String(s) === snapshotId)) throw new CsiError("EVIDENCE_SCOPE_INVALID");
    const row = await getIntelligenceEvidenceSnapshotModel().findOne({ _id: snapshotId, run_id: run._id, ...csiDataset() }).lean();
    if (!row || row.purged_at || !readContentSchema.safeParse(row.response).success || payloadHash(row.response) !== row.content_digest)
      return ownerRead({ id: snapshotId, unavailable: true, reason: row?.purge_reason ?? "original_evidence_unavailable",
        purged_at: row?.purged_at?.toISOString() ?? null, content: null, next_cursor: null });
    const offset = q.cursor ? Number(q.cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new CsiError("INVALID_INPUT");
    const serialized = JSON.stringify(row.response, null, 2), size = 16000;
    if (offset > serialized.length) throw new CsiError("INVALID_INPUT");
    return ownerRead({ id: snapshotId, unavailable: false, digest: row.content_digest, as_of: row.retrieved_at.toISOString(),
      content: serialized.slice(offset, offset + size), complete: offset === 0 && serialized.length <= size,
      next_cursor: offset + size < serialized.length ? String(offset + size) : null });
  }
  const cursor = q.cursor ? csiIdSchema.parse(q.cursor) : null;
  const ids = run.manifest_snapshot_ids.map(String).sort().filter(id => !cursor || id > cursor).slice(0, q.limit + 1);
  const rows = await getIntelligenceEvidenceSnapshotModel().find({ _id: { $in: ids.slice(0, q.limit) }, run_id: run._id, ...csiDataset() }).select("_id tool_name content_digest retrieved_at completeness purged_at purge_reason").lean();
  return ownerRead({ items: ids.slice(0, q.limit).map(id => { const row = rows.find(r => String(r._id) === id); return { id, tool: row?.tool_name ?? null,
    digest: row?.content_digest ?? null, retrieved_at: row?.retrieved_at.toISOString() ?? null, unavailable: !row || Boolean(row.purged_at), completeness: row?.completeness ?? null }; }),
    next_cursor: ids.length > q.limit ? ids[q.limit - 1] : null });
}
