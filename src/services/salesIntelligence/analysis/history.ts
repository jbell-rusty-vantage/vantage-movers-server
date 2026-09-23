import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceEffectModel } from "../../../models/IntelligenceEffect";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { BookedLead } from "../../../models/BookedLead";
import { CancelledLead } from "../../../models/CancelledLead";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { getGranotObservationModel } from "../../../models/GranotObservation";
import { getLeadMessageModel } from "../../../models/LeadMessage";
import { isObjectIdString, toObjectId } from "../../../utils/objectId";
import { redactTranscript } from "../../conversations/redaction";
import { CsiError } from "../auth";
import { moveViewsForLead, type LeadMoveSource } from "../assessment/views";
import { subjectKey } from "../outreach/types";
import { readContentSchema } from "./reads";

/**
 * Read-only history over the CSI models for the MCP history tools (context provenance
 * specification §8.2). Every read is bounded and served by an existing index; no transcript
 * text, Lead Message body or email ever leaves this module: `serialize` redacts every string
 * (emails, card spans, SSNs) and the projections below never select transcript fields.
 */
type Row = Record<string, unknown>;
type LeadModel = "FormLead" | "CallLead";
export type LeadRef = { model: LeadModel; id: string };
export type AnalysisListItem = {
  run_id: string; subject_key: string; mode: string; status: string; analysis_pipeline: string | null;
  prompt_version: string; model_version: string; conversation_id: string | null; outreach_record_id: string | null;
  parent_run_id: string | null; predecessor_run_id: string | null; started_at: string | null; completed_at: string | null;
  created_at: string; findings_count: number; has_output: boolean; has_raw_output: boolean; purged: boolean;
};
export type AnalysisDetail = {
  run: Row; output: unknown; raw_output: unknown; raw_output_retained: boolean; step_artifacts: unknown;
  findings: Row[]; summaries: Row[];
};

const LIMITS = { findings: 300, effects: 1000, attachments: 50, changes: 50, observations: 20, bookings: 10,
  messages: 50, conversations: 50, outreach: 20, summaries: 60 } as const;
const RUN_LIST_FIELDS = "subject_key mode status analysis_pipeline prompt_version model_version conversation_id outreach_record_id parent_run_id predecessor_run_id started_at completed_at createdAt purged_at purge_started_at";
const CONVERSATION_FIELDS = "-transcript -transcript_segments -media -speaker_evidence -transcription_job_digest";

const isOid = (v: object) => ["ObjectId", "ObjectID"].includes(String((v as { _bsontype?: unknown })._bsontype));
const sid = (v: unknown) => v == null ? null : String(v);
const iso = (v: unknown) => v instanceof Date && !Number.isNaN(+v) ? v.toISOString() : null;
const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const bool = (v: unknown) => Boolean(v);
const dataset = () => csiDataset();

/** ObjectId → hex, Date → ISO, every string redacted; `undefined` keys disappear on JSON output. */
export function serialize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return redactTranscript(value).text;
  if (value instanceof Date) return iso(value);
  if (typeof value === "object") {
    if (isOid(value)) return String(value);
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return null;
    if (Array.isArray(value)) return value.map((item) => serialize(item, seen));
    if (seen.has(value)) return null;
    seen.add(value);
    return Object.fromEntries(Object.entries(value as Row).map(([key, nested]) => [key, serialize(nested, seen)]));
  }
  return value;
}

export function encodeAnalysisCursor(createdAt: Date, id: unknown): string {
  return Buffer.from(`${createdAt.toISOString()}|${String(id)}`).toString("base64url");
}
export function decodeAnalysisCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = at ? new Date(at) : null;
  if (!createdAt || Number.isNaN(+createdAt) || !id || !isObjectIdString(id)) throw new CsiError("INVALID_INPUT");
  return { createdAt, id };
}

/** `intelligence_runs` of a Number, newest first, keyset on `(createdAt, _id)` over `csi_run_number`. */
export async function listAnalysesForNumber(contact_number_id: string, args: { limit: number; cursor?: string | null }):
  Promise<{ items: AnalysisListItem[]; cursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(args.limit) || 25, 1), 100);
  const after = args.cursor ? decodeAnalysisCursor(args.cursor) : null;
  const rows = (await getIntelligenceRunModel().aggregate([
    { $match: { ...dataset(), contact_number_id: toObjectId(contact_number_id),
      ...(after ? { $or: [{ createdAt: { $lt: after.createdAt } }, { createdAt: after.createdAt, _id: { $lt: toObjectId(after.id) } }] } : {}) } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: limit + 1 },
    { $project: { ...Object.fromEntries(RUN_LIST_FIELDS.split(" ").map((field) => [field, 1])),
      has_output: { $ne: [{ $ifNull: ["$output", null] }, null] }, has_raw_output: { $ne: [{ $ifNull: ["$raw_output", null] }, null] } } },
  ])) as Row[];
  const page = rows.slice(0, limit);
  const counts = page.length ? (await getIntelligenceFindingModel().aggregate([
    { $match: { run_id: { $in: page.map((row) => row._id) }, purged_at: null } },
    { $group: { _id: "$run_id", n: { $sum: 1 } } },
  ])) as { _id: unknown; n: number }[] : [];
  const countById = new Map(counts.map((row) => [String(row._id), row.n]));
  const items = page.map((row): AnalysisListItem => ({
    run_id: String(row._id), subject_key: String(row.subject_key), mode: String(row.mode), status: String(row.status),
    analysis_pipeline: str(row.analysis_pipeline), prompt_version: String(row.prompt_version), model_version: String(row.model_version),
    conversation_id: sid(row.conversation_id), outreach_record_id: sid(row.outreach_record_id), parent_run_id: sid(row.parent_run_id),
    predecessor_run_id: sid(row.predecessor_run_id), started_at: iso(row.started_at), completed_at: iso(row.completed_at),
    created_at: iso(row.createdAt) ?? new Date(0).toISOString(), findings_count: countById.get(String(row._id)) ?? 0,
    has_output: bool(row.has_output), has_raw_output: bool(row.has_raw_output), purged: bool(row.purged_at),
  }));
  const last = rows.length > limit ? page[page.length - 1] : null;
  return { items, cursor: last && last.createdAt instanceof Date ? encodeAnalysisCursor(last.createdAt, last._id) : null };
}

function findingView(finding: Row, effects: Row[]) {
  const assertion = (finding.assertion ?? {}) as Row;
  const id = String(finding._id);
  return {
    id, run_id: sid(finding.run_id), key: finding.key, kind: finding.kind, claim: str(assertion.claim) ?? str(assertion.description),
    assertion, review_state: finding.review_state, superseded_by: sid(finding.superseded_by), resolved: finding.resolved ?? null,
    validation: finding.validation ?? null, conversation_id: sid(finding.conversation_id), prompt_version: finding.prompt_version,
    created_at: iso(finding.createdAt),
    effects: effects.filter((effect) => String(effect.finding_id) === id).map((effect) => ({
      id: String(effect._id), kind: effect.effect_kind, status: effect.status, reason: effect.reason ?? null, target_key: effect.target_key,
      target_id: sid(effect.target_id), previous: effect.previous ?? null, current: effect.current ?? null, applied_at: iso(effect.applied_at),
    })),
  };
}
async function findingsWithEffects(filter: Row) {
  const findings = (await getIntelligenceFindingModel().find({ ...filter, purged_at: null }).sort({ _id: 1 }).limit(LIMITS.findings).lean()) as unknown as Row[];
  const runIds = [...new Set(findings.map((finding) => String(finding.run_id)))];
  const effects = runIds.length ? (await getIntelligenceEffectModel().find({ run_id: { $in: runIds.map(toObjectId) } })
    .sort({ _id: 1 }).limit(LIMITS.effects).lean()) as unknown as Row[] : [];
  return findings.map((finding) => findingView(finding, effects));
}
function summaryView(row: Row | undefined, snapshotId: string) {
  if (!row || row.purged_at || row.purge_started_at) return { snapshot_id: snapshotId, unavailable: true as const, analysis_summary: null };
  const parsed = readContentSchema.safeParse(row.response);
  return { snapshot_id: snapshotId, unavailable: !parsed.success, conversation_id: sid(row.conversation_id),
    artifact_key: row.artifact_key ?? null, content_digest: row.content_digest ?? null, retrieved_at: iso(row.retrieved_at),
    analysis_summary: parsed.success ? parsed.data.analysis_summary ?? null : null };
}

/** The run (never `rendered_prompt`/`token_nonce`), its envelope, exact model object, findings with effects, and captured summaries. */
export async function readAnalysis(run_id: string): Promise<AnalysisDetail | null> {
  const run = (await getIntelligenceRunModel().findOne({ _id: run_id, ...dataset() }).select("-rendered_prompt -token_nonce").lean()) as unknown as Row | null;
  if (!run) return null;
  const { output, raw_output, step_artifacts, ...rest } = run;
  const findings = await findingsWithEffects({ run_id: run._id });
  const ids = (Array.isArray((step_artifacts as Row | null)?.summaries) ? ((step_artifacts as Row).summaries as unknown[]) : [])
    .map(String).filter(isObjectIdString).slice(0, LIMITS.summaries);
  const rows = ids.length ? (await getIntelligenceEvidenceSnapshotModel().find({ _id: { $in: ids }, ...dataset() })
    .select("conversation_id artifact_key content_digest retrieved_at response purged_at purge_started_at").lean()) as unknown as Row[] : [];
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  return serialize({ run: { ...rest, id: String(run._id), purged: bool(run.purged_at) }, output: output ?? null, raw_output: raw_output ?? null,
    raw_output_retained: raw_output != null, step_artifacts: step_artifacts ?? null, findings,
    summaries: ids.map((id) => summaryView(byId.get(id), id)) }) as AnalysisDetail;
}

/** Lead Conversation row without transcript text, its canonical summary, and its findings. */
export async function readConversationHistory(conversation_id: string) {
  const conversation = (await getLeadConversationModel().findById(conversation_id).select(CONVERSATION_FIELDS).lean()) as unknown as Row | null;
  if (!conversation) return null;
  const [canonical, findings] = await Promise.all([
    getIntelligenceEvidenceSnapshotModel().findOne({ ...dataset(), source_type: "summary", artifact_key: { $type: "string" },
      conversation_id: toObjectId(conversation_id), purged_at: null, purge_started_at: null })
      .select("conversation_id artifact_key content_digest retrieved_at response purged_at purge_started_at").sort({ _id: -1 }).lean(),
    findingsWithEffects({ conversation_id: conversation._id }),
  ]);
  const legacy = (conversation.summary ?? null) as Row | null;
  const { summary: _summary, ...row } = conversation;
  return serialize({ conversation: { ...row, id: String(conversation._id) }, latest_completed_run_id: sid(conversation.latest_completed_run_id),
    canonical_summary: canonical ? summaryView(canonical as unknown as Row, String((canonical as unknown as Row)._id)) : null,
    legacy_summary: legacy ? { text: legacy.text ?? null, sections: legacy.sections ?? null, model: legacy.model ?? null,
      prompt_version: legacy.prompt_version ?? null, created_at: iso(legacy.created_at) } : null, findings });
}

const SUBJECT_KEY = /^(lead:(FormLead|CallLead):[a-f\d]{24}|number:[a-f\d]{24})$/i;
/** Newest published, ready, non-shadow `move_assessment_artifacts` row for the subject. */
export async function readMoveAssessment(input: { outreach_record_id?: string; subject_key?: string; include_model_output?: boolean }) {
  let key = input.subject_key ?? null;
  if (!key && input.outreach_record_id) {
    const record = (await getOutreachRecordModel().findById(input.outreach_record_id).select("subject").lean()) as unknown as Row | null;
    if (!record) return null;
    key = subjectKey(record.subject as Parameters<typeof subjectKey>[0]);
  }
  if (!key || !SUBJECT_KEY.test(key)) throw new CsiError("INVALID_INPUT");
  const query = getMoveAssessmentArtifactModel().findOne({ ...dataset(), subject_key: key, status: "ready", shadow: false, purged_at: null })
    .sort({ published_at: -1, _id: -1 });
  const row = (await (input.include_model_output ? query : query.select("-model_output")).lean()) as unknown as Row | null;
  if (!row) return null;
  return serialize({ ...row, id: String(row._id), model_output_retained: input.include_model_output ? row.model_output != null : undefined });
}

function leadProjection(lead: Row, model: LeadModel) {
  const name = str(lead.name) ?? ([str(lead.first_name), str(lead.last_name)].filter(Boolean).join(" ") || null);
  return {
    model, id: String(lead._id), name, first_name: str(lead.first_name), last_name: str(lead.last_name),
    phone_number: str(lead.phone_number), normalized_phone_number: str(lead.normalized_phone_number), job_no: str(lead.job_no),
    normalized_job_no: str(lead.normalized_job_no), ref_no: model === "FormLead" ? str(lead.ref_no) : null,
    source_label: str(lead.source_company_label_snapshot) ?? str(lead.crm_source_label_snapshot) ?? str(lead.source_label) ?? str(lead.source_company),
    source_company: str(lead.source_company), source_granularity_key: str(lead.source_granularity_key), ingestion_origin: str(lead.ingestion_origin),
    timestamp: iso(lead.timestamp), captured_at: iso(lead.captured_at), created_at: iso(lead.createdAt), updated_at: iso(lead.updatedAt),
    granot_priority: str(lead.granot_priority), granot_service_type: str(lead.granot_service_type), quoted: bool(lead.quoted),
    move: moveViewsForLead(lead as unknown as LeadMoveSource, model),
    receiver_agent_id: sid(lead.receiver_agent), receiver_agent_name_snapshot: str(lead.receiver_agent_name_snapshot),
    flags: { booked: bool(lead.booked), cancelled: bool(lead.cancelled), duplicate: bool(lead.duplicate), bad_lead: bool(lead.bad_lead),
      no_sync: bool(lead.no_sync), post_to_granot: bool(lead.post_to_granot), form_fill: bool(lead.form_fill), created_on_unmatched: bool(lead.created_on_unmatched) },
    booked_id: sid(lead.booked), cancelled_id: sid(lead.cancelled),
  };
}
const hashed = (field: Row) => field.value_mode !== undefined && field.value_mode !== "plain" && field.before === undefined && field.after === undefined;

/** Lead projection, attachment edges, entity changes, Granot observations, bookings, messages (no bodies), conversations, Outreach. */
export async function readLeadHistory(lead: LeadRef) {
  const oid = toObjectId(lead.id);
  const hidden = "-email -sheet_sync -ingested_contact_snapshot -granot_contact_snapshot -ringcentral";
  const row = (await (lead.model === "FormLead" ? getFormLeadModel().findById(oid).select(hidden).lean()
    : getCallLeadModel().findById(oid).select(hidden).lean())) as unknown as Row | null;
  if (!row) return null;
  const leadRef = { "lead_ref.model": lead.model, "lead_ref.id": oid };
  const jobNo = str(row.normalized_job_no);
  const [attachments, changes, observations, bookings, cancellations, messages, conversations, outreach] = await Promise.all([
    getNumberLeadAttachmentModel().find(leadRef).sort({ _id: 1 }).limit(LIMITS.attachments).lean(),
    getEntityChangeModel().find({ "entity.model": lead.model, "entity.id": lead.id } as Row).sort({ applied_at: -1 }).limit(LIMITS.changes)
      .select("changed_paths fields applied_at provenance command_name revision_before revision_after").lean(),
    jobNo ? getGranotObservationModel().find({ "identity.normalized_job_no": jobNo }).sort({ captured_at: -1 })
      .limit(LIMITS.observations).select("kind captured_at normalized_source_label route_event_class normalization_result identity priority booking_action agent_identity display_money move provider_context").lean() : [],
    BookedLead.find({ lead_ref: oid, lead_model: lead.model }).sort({ _id: -1 }).limit(LIMITS.bookings)
      .select("job_no normalized_job_no book_date timestamp binder_amount total_binder_amount deposit_amount agent_name_snapshot source booking_origin is_referral_booking cancelled createdAt").lean(),
    CancelledLead.find({ lead_ref: oid }).sort({ _id: -1 }).limit(LIMITS.bookings)
      .select("booked_lead reason cancelled_by cancel_date book_date job_no refund_amount source timestamp createdAt").lean(),
    getLeadMessageModel().find(lead.model === "FormLead" ? { $or: [leadRef, { form_lead: oid }] } : leadRef).sort({ createdAt: -1 }).limit(LIMITS.messages)
      .select("purpose origin status dispatch_mode template_version to from sent_at delivered_at accepted_at attempt_count skip_reason last_error_code provider_status createdAt").lean(),
    getLeadConversationModel().find(leadRef).sort({ started_at: -1 }).limit(LIMITS.conversations)
      .select("started_at direction duration_seconds contact_type state contact_number_id receiver_agent_name_snapshot latest_completed_run_id rc_result match_method").lean(),
    getOutreachRecordModel().find({ "subject.kind": "lead", "subject.model": lead.model, "subject.id": oid }).limit(LIMITS.outreach)
      .select("subject state primary_contact_number_id trigger_kind trigger_at first_action_due_at next_action responsible_agent_id closed_reason closed_at lead_progress move_assessment revision updatedAt").lean(),
  ]);
  return serialize({
    lead: leadProjection(row, lead.model),
    attachments: (attachments as unknown as Row[]).map((edge) => ({ id: String(edge._id), contact_number_id: sid(edge.contact_number_id), state: edge.state,
      certainty: edge.certainty, evidence: ((edge.evidence as Row[] | undefined) ?? []).map((item) => ({ source: item.source, field_path: item.field_path, observed_at: iso(item.observed_at) })),
      lead_snapshot: edge.lead_snapshot ?? null, decided_by: edge.decided_by ?? null, decided_at: iso(edge.decided_at), decision_reason: edge.decision_reason ?? null,
      auto_decision: edge.auto_decision ?? null, updated_at: iso(edge.updatedAt) })),
    changes: (changes as unknown as Row[]).map((change) => ({ id: String(change._id), applied_at: iso(change.applied_at), command_name: change.command_name,
      source_system: (change.provenance as Row | null)?.source_system ?? null, changed_paths: change.changed_paths ?? [],
      revision_before: change.revision_before ?? null, revision_after: change.revision_after ?? null,
      fields: ((change.fields as Row[] | undefined) ?? []).map((field) => hashed(field) ? { path: field.path, changed: true }
        : { path: field.path, before: field.before ?? null, after: field.after ?? null }) })),
    granot_observations: (observations as unknown as Row[]).map((observation) => ({ id: String(observation._id), kind: observation.kind, captured_at: iso(observation.captured_at),
      source_label: observation.normalized_source_label ?? null, route_event_class: observation.route_event_class ?? null, normalization_result: observation.normalization_result,
      job_no: (observation.identity as Row | null)?.job_no_raw ?? null, priority: observation.priority ?? null, booking_action: observation.booking_action ?? null,
      rep_raw: (observation.agent_identity as Row | null)?.rep_raw ?? null, user_raw: (observation.agent_identity as Row | null)?.user_raw ?? null,
      display_money: observation.display_money ?? null, move: observation.move ?? null, type_raw: (observation.provider_context as Row | null)?.type_raw ?? null })),
    bookings: (bookings as unknown as Row[]).map((booking) => ({ ...booking, id: String(booking._id) })),
    cancellations: (cancellations as unknown as Row[]).map((cancellation) => ({ ...cancellation, id: String(cancellation._id) })),
    messages: (messages as unknown as Row[]).map((message) => ({ ...message, id: String(message._id), created_at: iso(message.createdAt), createdAt: undefined })),
    conversations: (conversations as unknown as Row[]).map((conversation) => ({ ...conversation, id: String(conversation._id) })),
    outreach: (outreach as unknown as Row[]).map((record) => ({ ...record, id: String(record._id), subject_key: subjectKey(record.subject as Parameters<typeof subjectKey>[0]) })),
  });
}

/** Contact Number (no search terms), its attachment edges and Outreach records. */
export async function readContactNumberHistory(contact_number_id: string) {
  const number = (await getContactNumberModel().findById(contact_number_id).select("-search_terms -digits_reversed -intelligence_schedule").lean()) as unknown as Row | null;
  if (!number || number.purged_at) return null;
  const [attachments, outreach] = await Promise.all([
    getNumberLeadAttachmentModel().find({ contact_number_id }).sort({ _id: 1 }).limit(LIMITS.attachments).lean(),
    getOutreachRecordModel().find({ $or: [{ primary_contact_number_id: contact_number_id }, { "subject.kind": "number_review", "subject.contact_number_id": contact_number_id }] })
      .limit(LIMITS.outreach).select("subject state primary_contact_number_id trigger_kind trigger_at first_action_due_at next_action responsible_agent_id closed_reason closed_at lead_progress move_assessment revision updatedAt").lean(),
  ]);
  const summary = number.running_summary as Row | null;
  return serialize({
    contact_number: { id: String(number._id), e164: number.e164, national_ten: number.national_ten ?? null, country: number.country, kind: number.kind,
      classification: number.classification, classification_reason: number.classification_reason ?? null, contact_eligibility: number.contact_eligibility,
      provider_names: number.provider_names ?? [], first_observed_at: iso(number.first_observed_at), last_activity_at: iso(number.last_activity_at),
      rollups: number.rollups ?? null, content_purge_pending: bool(number.content_purge_pending), revision: number.revision,
      running_summary: summary ? { text: summary.text, run_id: sid(summary.run_id), created_at: iso(summary.computed_at) } : null },
    attachments: (attachments as unknown as Row[]).map((edge) => ({ id: String(edge._id), lead_ref: edge.lead_ref, state: edge.state, certainty: edge.certainty,
      evidence: ((edge.evidence as Row[] | undefined) ?? []).map((item) => ({ source: item.source, field_path: item.field_path, observed_at: iso(item.observed_at) })),
      lead_snapshot: edge.lead_snapshot ?? null, decided_by: edge.decided_by ?? null, decided_at: iso(edge.decided_at), decision_reason: edge.decision_reason ?? null,
      auto_decision: edge.auto_decision ?? null, updated_at: iso(edge.updatedAt) })),
    outreach: (outreach as unknown as Row[]).map((record) => ({ ...record, id: String(record._id), subject_key: subjectKey(record.subject as Parameters<typeof subjectKey>[0]) })),
  });
}
