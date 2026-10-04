import { getContactNumberModel } from "../../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { BookedLead } from "../../../models/BookedLead";
import { CancelledLead } from "../../../models/CancelledLead";
import { getEntityChangeModel } from "../../../models/EntityChange";
import { getGranotObservationModel } from "../../../models/GranotObservation";
import { getLeadMessageModel } from "../../../models/LeadMessage";
import { toObjectId } from "../../../utils/objectId";
import { moveViewsForLead, type LeadMoveSource } from "./moveViews";
import { redactSensitiveText } from "./redaction";
import type { HistoryLeadRef } from "./candidates";

/**
 * Read-only canonical history for the MCP history tools (`find_contact_number`,
 * `get_lead_history`). Sources are canonical records and provider metadata only: Contact Numbers,
 * Number↔Lead attachments, Leads, Bookings, Cancellations, EntityChanges, Granot observations and
 * Lead Message delivery metadata. Every read is bounded and served by an existing index. No email
 * or Lead Message body leaves this module, and `serialize` redacts every string.
 */
type Row = Record<string, unknown>;
type LeadModel = HistoryLeadRef["model"];

const LIMITS = { attachments: 50, changes: 50, observations: 20, bookings: 10, messages: 50 } as const;
/** Provider-metadata rollups of a Contact Number. A stored key outside this list (a retired AI/Outreach rollup) is never returned. */
const NUMBER_ROLLUPS = ["interactions_total", "inbound_total", "outbound_total", "human_conversations_total", "last_inbound_at", "last_outbound_at",
  "last_human_conversation_at", "attached_lead_count", "candidate_lead_count", "recordings_total"] as const;

const isOid = (v: object) => ["ObjectId", "ObjectID"].includes(String((v as { _bsontype?: unknown })._bsontype));
const sid = (v: unknown) => v == null ? null : String(v);
const iso = (v: unknown) => v instanceof Date && !Number.isNaN(+v) ? v.toISOString() : null;
const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
const bool = (v: unknown) => Boolean(v);

/** ObjectId → hex, Date → ISO, every string redacted; `undefined` keys disappear on JSON output. */
export function serialize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return redactSensitiveText(value).text;
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
const evidenceView = (edge: Row) => ((edge.evidence as Row[] | undefined) ?? [])
  .map((item) => ({ source: item.source, field_path: item.field_path, observed_at: iso(item.observed_at) }));
const decisionView = (edge: Row) => ({
  lead_snapshot: edge.lead_snapshot ?? null, decided_by: edge.decided_by ?? null, decided_at: iso(edge.decided_at), decision_reason: edge.decision_reason ?? null,
  auto_decision: edge.auto_decision ?? null, updated_at: iso(edge.updatedAt),
});

/** Lead projection, attachment edges, entity changes, Granot observations, bookings, cancellations and messages (no bodies). */
export async function readLeadHistory(lead: HistoryLeadRef) {
  const oid = toObjectId(lead.id);
  const hidden = "-email -sheet_sync -ingested_contact_snapshot -granot_contact_snapshot -ringcentral";
  const row = (await (lead.model === "FormLead" ? getFormLeadModel().findById(oid).select(hidden).lean()
    : getCallLeadModel().findById(oid).select(hidden).lean())) as unknown as Row | null;
  if (!row) return null;
  const leadRef = { "lead_ref.model": lead.model, "lead_ref.id": oid };
  const jobNo = str(row.normalized_job_no);
  const [attachments, changes, observations, bookings, cancellations, messages] = await Promise.all([
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
  ]);
  return serialize({
    lead: leadProjection(row, lead.model),
    attachments: (attachments as unknown as Row[]).map((edge) => ({ id: String(edge._id), contact_number_id: sid(edge.contact_number_id), state: edge.state,
      certainty: edge.certainty, evidence: evidenceView(edge), ...decisionView(edge) })),
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
  });
}

/** Contact Number (no search terms) with provider-metadata rollups and its attachment edges. */
export async function readContactNumberHistory(contact_number_id: string) {
  const number = (await getContactNumberModel().findById(contact_number_id).select("-search_terms -digits_reversed").lean()) as unknown as Row | null;
  if (!number || number.purged_at) return null;
  const attachments = (await getNumberLeadAttachmentModel().find({ contact_number_id }).sort({ _id: 1 }).limit(LIMITS.attachments).lean()) as unknown as Row[];
  return serialize({
    contact_number: { id: String(number._id), e164: number.e164, national_ten: number.national_ten ?? null, country: number.country, kind: number.kind,
      classification: number.classification, classification_reason: number.classification_reason ?? null, contact_eligibility: number.contact_eligibility,
      provider_names: number.provider_names ?? [], first_observed_at: iso(number.first_observed_at), last_activity_at: iso(number.last_activity_at),
      rollups: number.rollups ? Object.fromEntries(NUMBER_ROLLUPS.map((key) => [key, (number.rollups as Row)[key] ?? null])) : null,
      revision: number.revision },
    attachments: attachments.map((edge) => ({ id: String(edge._id), lead_ref: edge.lead_ref, state: edge.state, certainty: edge.certainty,
      evidence: evidenceView(edge), ...decisionView(edge) })),
  });
}
