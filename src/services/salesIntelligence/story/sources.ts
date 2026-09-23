import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getGranotObservationModel, type GranotObservationDocument } from "../../../models/GranotObservation";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getLeadMessageModel } from "../../../models/LeadMessage";
import { getMoveAssessmentArtifactModel } from "../../../models/MoveAssessmentArtifact";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceAuditEventModel } from "../../../models/SalesIntelligenceAuditEvent";
import { getSalesIntelligenceOwnerInstructionModel } from "../../../models/SalesIntelligenceOwnerInstruction";
import { toObjectId } from "../../../utils/objectId";
import { normalizePhoneNumberForMatch } from "../../../utils/phone";
import { redactTranscript } from "../../conversations/redaction";
import { moveViewsForLead, type LeadMoveSource, type MoveEndpoint } from "../assessment/views";
import { dispositionFor, normalizePriority, priorityLabel } from "../outreach/leadProgress";
import { subjectKey } from "../outreach/types";
import { resolveRepIdentityAt, type TemporalRepLink } from "../repIdentity/resolve";
import { auditActorKind, auditEventStoryKind, EXCLUDED_AUDIT_EVENT_KINDS, followupActorKind } from "./catalog";
import type { StoryActor, StoryEvent, StoryEventKind, StoryLeadRef, StorySubject } from "./types";

/**
 * One bounded, indexed reader per source (context provenance specification §3, §4.3). Every
 * reader returns raw events newest first, honours `subject.as_of`, and never writes. Sentences
 * are rendered later by the assembler, after collapse, so readers leave `sentence` empty.
 *
 * No transcript text, no Lead Message body and no email address ever enters an event.
 */
export type SourceResult = { events: StoryEvent[]; read: number; truncated: boolean };
export type StorySource = (subject: StorySubject, limit: number) => Promise<SourceResult>;

const db = () => mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
const oid = toObjectId;
const iso = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isNaN(+value) ? null : value.toISOString();
  if (typeof value === "string" && value) { const d = new Date(value); return Number.isNaN(+d) ? null : d.toISOString(); }
  return null;
};
const text = (value: unknown, max = 400): string | null => {
  if (value === null || value === undefined) return null;
  const s = redactTranscript(String(value)).text.trim();
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null;
};
const bool = (value: unknown) => Boolean(value);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const leadKey = (ref: StoryLeadRef) => `lead:${ref.model}:${ref.id}`;
const numberKey = (subject: StorySubject) => (subject.contact_number_id ? `number:${subject.contact_number_id}` : null);
const empty = (): SourceResult => ({ events: [], read: 0, truncated: false });
const bounded = <T>(rows: T[], limit: number) => ({ rows: rows.slice(0, limit), read: Math.min(rows.length, limit), truncated: rows.length > limit });
const byNewest = (a: StoryEvent, b: StoryEvent) => Date.parse(b.happened_at) - Date.parse(a.happened_at) || (a.id < b.id ? 1 : -1);
const withinAsOf = (subject: StorySubject) => (event: StoryEvent) => Date.parse(event.happened_at) <= +subject.as_of;
const dateWindow = (subject: StorySubject) => ({ $lte: subject.as_of });
/** Bounded JSON for audit/instruction payloads: whole records are display caches, not story. */
const smallJson = (value: unknown, max = 1000): unknown => {
  if (value === null || value === undefined) return null;
  try { const s = JSON.stringify(value); return s.length <= max ? JSON.parse(redactTranscript(s).text) : { truncated: true, keys: typeof value === "object" ? Object.keys(value as object).slice(0, 40) : [] }; }
  catch { return null; }
};

const actor = (kind: StoryActor["kind"], name: string | null = null, agent_id: string | null = null, identity_status: StoryActor["identity_status"] = null): StoryActor =>
  ({ kind, agent_id, name, identity_status });

type EventInput = { kind: StoryEventKind; id: string; happened_at: string; observed_at: string | null; subject_key: string; actor: StoryActor;
  detail: Record<string, unknown>; evidence_refs: string[] };
const event = (input: EventInput): StoryEvent => ({
  id: `${input.kind}:${input.id}`, kind: input.kind, happened_at: input.happened_at, observed_at: input.observed_at ?? input.happened_at,
  subject_key: input.subject_key, actor: input.actor, record: { record_type: "story_event", record_id: `${input.kind}:${input.id}` },
  sentence: "", detail: input.detail, evidence_refs: input.evidence_refs,
});

const endpoint = (e: MoveEndpoint): string | null => {
  const place = [e.city, e.state].filter(Boolean).join(", ");
  const full = [place, e.zip].filter(Boolean).join(" ");
  return full || null;
};

/** Lean Lead projection shared by the Lead readers, `granot.ts` and `candidates.ts`. */
export type LeadRow = LeadMoveSource & {
  _id: mongoose.Types.ObjectId; model: "FormLead" | "CallLead";
  name?: string | null; timestamp?: Date | null; createdAt?: Date | null; updatedAt?: Date | null;
  source_company?: string | null; source_company_label_snapshot?: string | null; source_granularity_label_snapshot?: string | null;
  job_no?: string | null; normalized_job_no?: string | null; ingestion_origin?: string | null;
  granot_priority?: string | null; granot_service_type?: string | null; quoted?: boolean | null;
  duplicate?: boolean | null; bad_lead?: string | boolean | null; no_sync?: boolean | null;
  booked?: mongoose.Types.ObjectId | null; cancelled?: mongoose.Types.ObjectId | null;
  receiver_agent?: mongoose.Types.ObjectId | null; receiver_agent_name_snapshot?: string | null;
  granot_contact_snapshot?: { name?: string | null } | null; normalized_phone_number?: string | null;
  ringcentral?: { telephony_session_id?: string | null; qualification_reason?: string | null; start_time?: Date | null;
    original_caller?: { captured_at?: Date | null } | null } | null;
};
export const LEAD_PROJECTION = {
  name: 1, timestamp: 1, createdAt: 1, updatedAt: 1, source_company: 1, source_company_label_snapshot: 1, source_granularity_label_snapshot: 1,
  job_no: 1, normalized_job_no: 1, ingestion_origin: 1, pickup_city: 1, pickup_state: 1, pickup_zip: 1, delivery_city: 1, delivery_state: 1,
  destination_zip: 1, delivery_zip: 1, move_size: 1, move_date: 1, cubic_feet: 1, granot_move_size: 1, granot_service_type: 1, granot_priority: 1,
  quoted: 1, duplicate: 1, bad_lead: 1, no_sync: 1, booked: 1, cancelled: 1, receiver_agent: 1, receiver_agent_name_snapshot: 1,
  "granot_contact_snapshot.name": 1, normalized_phone_number: 1, "ringcentral.telephony_session_id": 1, "ringcentral.qualification_reason": 1,
  "ringcentral.start_time": 1, "ringcentral.original_caller.captured_at": 1, current_move_provenance: 1, ingested_move_snapshot: 1,
} as const;
export const leadCollection = (model: "FormLead" | "CallLead") => (model === "FormLead" ? "form_leads" : "call_leads");
export const leadSourceLabel = (row: LeadRow) => row.source_company_label_snapshot ?? row.source_company ?? null;
export const leadCustomerName = (row: LeadRow) => row.name?.trim() || row.granot_contact_snapshot?.name?.trim() || null;

/** The subject's Leads by `_id`, in `lead_refs` order; missing Leads are skipped. */
export async function readLeadRows(lead_refs: readonly StoryLeadRef[]): Promise<LeadRow[]> {
  const out = new Map<string, LeadRow>();
  for (const model of ["FormLead", "CallLead"] as const) {
    const ids = lead_refs.filter(r => r.model === model && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
    if (!ids.length) continue;
    const rows = await db().collection(leadCollection(model)).find({ _id: { $in: ids } }, { projection: LEAD_PROJECTION }).limit(ids.length).toArray();
    for (const row of rows) out.set(`${model}:${row._id}`, { ...(row as unknown as LeadRow), model });
  }
  return lead_refs.flatMap(r => { const row = out.get(`${r.model}:${r.id}`); return row ? [row] : []; });
}

/** Newest Granot observation per Lead: by Job Number, else by the Lead's normalized phone. */
export async function newestObservations(leads: readonly LeadRow[], as_of: Date): Promise<Map<string, GranotObservationDocument>> {
  const out = new Map<string, GranotObservationDocument>();
  for (const lead of leads) {
    const filter = lead.normalized_job_no ? { "identity.normalized_job_no": lead.normalized_job_no }
      : lead.normalized_phone_number ? { "contact.normalized_phone": lead.normalized_phone_number } : null;
    if (!filter) continue;
    const [row] = await getGranotObservationModel().find({ ...filter, captured_at: { $lte: as_of } }).sort({ captured_at: -1 }).limit(1).lean();
    if (row) out.set(`${lead.model}:${lead._id}`, row as GranotObservationDocument);
  }
  return out;
}

type RecordRow = { _id: mongoose.Types.ObjectId; subject: { kind: "lead" | "number"; model?: "FormLead" | "CallLead" | null; id?: unknown; contact_number_id?: unknown };
  move_assessment?: { artifact_id?: unknown; stale?: boolean } | null };
export async function readOutreachRecords(ids: readonly string[]): Promise<RecordRow[]> {
  const valid = ids.filter(id => mongoose.isValidObjectId(id)).map(oid);
  if (!valid.length) return [];
  return (await getOutreachRecordModel().find({ _id: { $in: valid } }).select("subject move_assessment").limit(valid.length).lean()) as unknown as RecordRow[];
}

/** Every subject key the story spans: the number, its Leads, its Outreach records, its conversations. */
export async function storySubjectKeys(subject: StorySubject): Promise<string[]> {
  const records = await readOutreachRecords(subject.outreach_record_ids);
  return [...new Set([numberKey(subject), ...subject.lead_refs.map(leadKey), ...records.map(r => subjectKey(r.subject as Parameters<typeof subjectKey>[0])),
    ...subject.conversation_ids.map(id => `conversation:${id}`)].filter((k): k is string => k !== null))];
}

const leadEvents = (lead: LeadRow): StoryEvent[] => {
  const ref: StoryLeadRef = { model: lead.model, id: String(lead._id) };
  const views = moveViewsForLead(lead, lead.model).canonical_current;
  const received = iso(lead.timestamp) ?? iso(lead.createdAt);
  if (!received) return [];
  const customer = leadCustomerName(lead);
  const events = [event({ kind: "lead_received", id: String(lead._id), happened_at: received, observed_at: iso(lead.createdAt), subject_key: leadKey(ref),
    actor: actor("customer", text(customer, 120)),
    detail: { model: lead.model, lead_ref: ref, customer_name: text(customer, 120), source_company_label: text(leadSourceLabel(lead), 80),
      source_granularity_label: text(lead.source_granularity_label_snapshot, 80), job_no: text(lead.job_no, 40), ingestion_origin: lead.ingestion_origin ?? null,
      pickup: endpoint(views.pickup), delivery: endpoint(views.delivery), move_date: views.move_date, move_size: views.move_size,
      granot_move_size: views.granot_move_size, cubic_feet: views.cubic_feet, duplicate: bool(lead.duplicate), bad_lead: bool(lead.bad_lead),
      no_sync: bool(lead.no_sync), receiver_agent_name: text(lead.receiver_agent_name_snapshot, 80), receiver_agent_id: lead.receiver_agent ? String(lead.receiver_agent) : null },
    evidence_refs: [leadKey(ref)] })];
  const rc = lead.model === "CallLead" ? lead.ringcentral : null;
  const qualifiedAt = rc ? iso(rc.original_caller?.captured_at) ?? iso(rc.start_time) ?? received : null;
  if (rc && qualifiedAt) events.push(event({ kind: "call_qualified", id: String(lead._id), happened_at: qualifiedAt, observed_at: iso(lead.createdAt), subject_key: leadKey(ref),
    actor: actor("vantage"), detail: { lead_ref: ref, qualification_reason: text(rc.qualification_reason, 120), telephony_session_id: rc.telephony_session_id ?? null },
    evidence_refs: [leadKey(ref), ...(rc.telephony_session_id ? [`telephony_session:${rc.telephony_session_id}`] : [])] }));
  return events;
};

/** `lead_received` (+ `call_qualified`) for every Lead in scope. */
export const leadReceivedSource: StorySource = async (subject, limit) => {
  if (!subject.lead_refs.length) return empty();
  const leads = await readLeadRows(subject.lead_refs.slice(0, limit));
  const events = leads.flatMap(leadEvents).filter(withinAsOf(subject)).sort(byNewest);
  return { events, read: leads.length, truncated: subject.lead_refs.length > limit };
};

/** Texts by `lead_ref` ∪ `to` (both indexed). Body is never selected. */
export const leadMessageSource: StorySource = async (subject, limit) => {
  const model = getLeadMessageModel();
  const select = "purpose status sent_at delivered_at origin lead_ref createdAt";
  const queries: Array<Promise<unknown[]>> = [];
  for (const m of ["FormLead", "CallLead"] as const) {
    const ids = subject.lead_refs.filter(r => r.model === m && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
    if (ids.length) queries.push(model.find({ "lead_ref.model": m, "lead_ref.id": { $in: ids }, createdAt: dateWindow(subject) }).select(select).sort({ createdAt: -1 }).limit(limit + 1).lean());
  }
  const ten = subject.e164 ? normalizePhoneNumberForMatch(subject.e164) : null;
  if (subject.e164) {
    const addresses = [subject.e164, ...(ten && ten.length === 10 ? [ten, `1${ten}`] : [])];
    queries.push(model.find({ to: { $in: addresses }, createdAt: dateWindow(subject) }).select(select).sort({ createdAt: -1 }).limit(limit + 1).lean());
  }
  if (!queries.length) return empty();
  type Row = { _id: mongoose.Types.ObjectId; purpose: string; status: string; sent_at?: Date | null; delivered_at?: Date | null; origin?: string | null;
    lead_ref?: { model: "FormLead" | "CallLead"; id: mongoose.Types.ObjectId } | null; createdAt: Date };
  const merged = new Map<string, Row>();
  let truncated = false;
  for (const rows of await Promise.all(queries)) { truncated ||= rows.length > limit; for (const row of rows.slice(0, limit) as Row[]) merged.set(String(row._id), row); }
  const events = [...merged.values()].flatMap(row => {
    const happened = iso(row.sent_at) ?? iso(row.createdAt);
    if (!happened) return [];
    const ref = row.lead_ref ? { model: row.lead_ref.model, id: String(row.lead_ref.id) } : null;
    return [event({ kind: "lead_message_sent", id: String(row._id), happened_at: happened, observed_at: iso(row.createdAt),
      subject_key: numberKey(subject) ?? (ref ? leadKey(ref) : "number:unknown"), actor: actor("vantage"),
      detail: { purpose: row.purpose, status: row.status, delivered_at: iso(row.delivered_at), origin: row.origin ?? null, lead_ref: ref },
      evidence_refs: [`lead_message:${row._id}`] })];
  }).filter(withinAsOf(subject)).sort(byNewest);
  const page = bounded(events, limit);
  return { events: page.rows, read: page.read, truncated: truncated || page.truncated };
};

type LinkRow = TemporalRepLink & { agent_name_snapshot?: string | null };

/** Canonical `call_interactions` on the number with the rep resolved through reviewed identity links. */
export const callSource: StorySource = async (subject, limit) => {
  if (!subject.contact_number_id) return empty();
  const rows = await getCallInteractionModel().find({ contact_number_id: oid(subject.contact_number_id), merged_into_id: null, purged_at: null, started_at: dateWindow(subject) })
    .sort({ started_at: -1, _id: -1 }).limit(limit + 1).lean();
  const page = bounded(rows, limit);
  const userParty = (call: (typeof rows)[number]) => call.parties.find(p => p.role === "user" && p.connected && p.extension_id) ?? call.parties.find(p => p.role === "user" && p.extension_id) ?? null;
  const pairs = new Map<string, { account: string; extension: string }>();
  for (const call of page.rows) { const party = userParty(call); if (party?.extension_id) pairs.set(`${call.provider_account_id}:${party.extension_id}`, { account: call.provider_account_id, extension: party.extension_id }); }
  const links = pairs.size ? (await getRepIdentityLinkModel().find({ rc_account_id: { $in: [...new Set([...pairs.values()].map(p => p.account))] },
    rc_extension_id: { $in: [...new Set([...pairs.values()].map(p => p.extension))] } }).limit(500).lean()) as unknown as LinkRow[] : [];
  const events = page.rows.map(call => {
    const party = userParty(call);
    const resolution = party?.extension_id ? resolveRepIdentityAt(links, call.provider_account_id, party.extension_id, call.started_at) : null;
    const link = resolution?.link_id ? links.find(l => String(l._id) === resolution.link_id) : null;
    const reviewed = resolution?.status === "reviewed";
    const rep = { agent_id: reviewed ? resolution!.agent_id : null, name: reviewed ? text(link?.agent_name_snapshot, 80) : null,
      status: resolution ? (resolution.status === "reviewed" ? "reviewed" : resolution.status === "proposed_only" ? "proposed" : "unknown") : "unknown",
      extension: party?.extension_number ?? party?.extension_id ?? null };
    const identity: StoryActor["identity_status"] = rep.status === "reviewed" ? "reviewed" : rep.status === "proposed" ? "proposed" : "unknown";
    const recordings = call.recordings ?? [];
    return event({ kind: "call", id: String(call._id), happened_at: call.started_at.toISOString(), observed_at: iso(call.first_observed_at), subject_key: `number:${subject.contact_number_id}`,
      actor: call.direction === "Inbound" ? actor("customer") : actor("rep", rep.name, rep.agent_id, identity),
      detail: { interaction_id: String(call._id), direction: call.direction, provider_result: text(call.provider_result, 60), provider_connected: bool(call.provider_connected),
        contact_type: call.contact_type, contact_type_basis: call.contact_type_basis ?? null, duration_seconds: num(call.duration_seconds), recording_count: recordings.length,
        rep, transfer: bool(call.transfer), queue_fanout: bool(call.queue_fanout), account_id: call.provider_account_id,
        conversation_id: recordings.find(r => r.lead_conversation_id)?.lead_conversation_id ? String(recordings.find(r => r.lead_conversation_id)!.lead_conversation_id) : null },
      evidence_refs: [`interaction:${call._id}`, ...recordings.map(r => `recording:${r.provider_recording_id}`)] });
  });
  return { events, read: page.read, truncated: page.truncated };
};

type ConversationRow = { _id: mongoose.Types.ObjectId; call_interaction_id?: mongoose.Types.ObjectId | null; state: string; direction: string; contact_type?: string | null;
  duration_seconds?: number | null; started_at: Date; createdAt?: Date; updatedAt?: Date; provider_recording_id: string; latest_transcript_version?: string | null;
  latest_completed_run_id?: mongoose.Types.ObjectId | null; summary?: { sections?: { overview?: string | null } | null; created_at?: Date | null } | null;
  lead_ref?: { model: "FormLead" | "CallLead"; id: mongoose.Types.ObjectId } | null };
const CONVERSATION_SELECT = "call_interaction_id state direction contact_type duration_seconds started_at createdAt updatedAt provider_recording_id latest_transcript_version latest_completed_run_id summary.sections.overview summary.created_at lead_ref";

const firstSentence = (value: unknown): string | null => {
  const clean = text(value, 400);
  if (!clean) return null;
  const first = clean.split(/(?<=[.!?])\s+/)[0] ?? clean;
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
};

/** `conversation_recorded` and `conversation_analyzed` for the number's, the Leads' and the listed conversations. */
export const conversationSource: StorySource = async (subject, limit) => {
  const model = getLeadConversationModel();
  const queries: Array<Promise<unknown[]>> = [];
  if (subject.contact_number_id) queries.push(model.find({ contact_number_id: oid(subject.contact_number_id), started_at: dateWindow(subject) }).select(CONVERSATION_SELECT).sort({ started_at: -1, _id: -1 }).limit(limit + 1).lean());
  for (const m of ["FormLead", "CallLead"] as const) {
    const ids = subject.lead_refs.filter(r => r.model === m && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
    if (ids.length) queries.push(model.find({ "lead_ref.model": m, "lead_ref.id": { $in: ids }, started_at: dateWindow(subject) }).select(CONVERSATION_SELECT).sort({ started_at: -1 }).limit(limit + 1).lean());
  }
  const listed = subject.conversation_ids.filter(id => mongoose.isValidObjectId(id)).map(oid);
  if (listed.length) queries.push(model.find({ _id: { $in: listed.slice(0, limit) }, started_at: dateWindow(subject) }).select(CONVERSATION_SELECT).limit(limit + 1).lean());
  if (!queries.length) return empty();
  const merged = new Map<string, ConversationRow>();
  let truncated = false;
  for (const rows of await Promise.all(queries)) { truncated ||= rows.length > limit; for (const row of rows.slice(0, limit) as ConversationRow[]) merged.set(String(row._id), row); }
  const page = bounded([...merged.values()].sort((a, b) => +b.started_at - +a.started_at || (String(a._id) < String(b._id) ? 1 : -1)), limit);
  const analyzed = page.rows.filter(row => row.latest_completed_run_id);
  const [snapshots, findings] = await Promise.all([
    analyzed.length ? getIntelligenceEvidenceSnapshotModel().find({ ...csiDataset(), source_type: "summary", artifact_key: { $type: "string" }, run_id: null,
      conversation_id: { $in: analyzed.map(row => row._id) }, purged_at: null, purge_started_at: null }).select("conversation_id response").sort({ _id: -1 }).limit(analyzed.length * 3).lean() : Promise.resolve([]),
    analyzed.length ? getIntelligenceFindingModel().aggregate<{ _id: mongoose.Types.ObjectId; count: number; next_steps: unknown[] }>([
      { $match: { run_id: { $in: analyzed.map(row => row.latest_completed_run_id) }, purged_at: null } },
      { $group: { _id: "$run_id", count: { $sum: 1 }, next_steps: { $push: { $cond: [{ $eq: ["$kind", "next_step"] }, "$assertion.value", "$$REMOVE"] } } } },
      { $limit: analyzed.length + 1 }]) : Promise.resolve([]),
  ]);
  const overviewByConversation = new Map<string, { id: string; overview: unknown }>();
  for (const snapshot of snapshots as Array<{ _id: unknown; conversation_id?: unknown; response?: unknown }>) {
    const key = String(snapshot.conversation_id);
    if (overviewByConversation.has(key)) continue;
    const response = snapshot.response as { analysis_summary?: { summary?: { overview?: unknown } } } | null;
    overviewByConversation.set(key, { id: String(snapshot._id), overview: response?.analysis_summary?.summary?.overview ?? null });
  }
  const findingsByRun = new Map(findings.map(f => [String(f._id), f]));
  const events: StoryEvent[] = [];
  for (const row of page.rows) {
    const id = String(row._id), key = `conversation:${id}`;
    events.push(event({ kind: "conversation_recorded", id, happened_at: row.started_at.toISOString(), observed_at: iso(row.createdAt), subject_key: key, actor: actor("vantage"),
      detail: { conversation_id: id, call_interaction_id: row.call_interaction_id ? String(row.call_interaction_id) : null, state: row.state, direction: row.direction,
        contact_type: row.contact_type ?? null, duration_seconds: num(row.duration_seconds), transcript_version: row.latest_transcript_version ?? null, recording: row.provider_recording_id,
        lead_ref: row.lead_ref ? { model: row.lead_ref.model, id: String(row.lead_ref.id) } : null },
      evidence_refs: [key, `recording:${row.provider_recording_id}`] }));
    if (!row.latest_completed_run_id) continue;
    const runId = String(row.latest_completed_run_id);
    const snapshot = overviewByConversation.get(id) ?? null;
    const summary = findingsByRun.get(runId);
    const nextStep = summary?.next_steps.find(v => v && typeof v === "object") as { action_kind?: unknown; kind?: unknown } | undefined;
    events.push(event({ kind: "conversation_analyzed", id, happened_at: row.started_at.toISOString(), observed_at: iso(row.summary?.created_at) ?? iso(row.updatedAt), subject_key: key,
      actor: actor("intelligence"),
      detail: { conversation_id: id, run_id: runId, summary_snapshot_id: snapshot?.id ?? null,
        overview_first_sentence: firstSentence(snapshot?.overview ?? row.summary?.sections?.overview ?? null), findings_count: summary?.count ?? 0,
        next_step_kind: typeof nextStep?.action_kind === "string" ? nextStep.action_kind : typeof nextStep?.kind === "string" ? nextStep.kind : null },
      evidence_refs: [key, `run:${runId}`, ...(snapshot ? [`snapshot:${snapshot.id}`] : [])] }));
  }
  return { events: events.filter(withinAsOf(subject)).sort(byNewest), read: page.read, truncated: truncated || page.truncated };
};

/**
 * Fold each `conversation_recorded` into the `call` it belongs to (matching interaction id) so
 * one call is one event; only legacy rows without an interaction stay standalone. Pure.
 */
export function mergeConversationsIntoCalls(events: StoryEvent[]): StoryEvent[] {
  const calls = new Map<string, StoryEvent>();
  for (const e of events) if (e.kind === "call") calls.set(String(e.detail.interaction_id ?? e.id.slice(5)), e);
  const dropped = new Set<string>();
  for (const e of events) {
    if (e.kind !== "conversation_recorded") continue;
    const call = typeof e.detail.call_interaction_id === "string" ? calls.get(e.detail.call_interaction_id) : undefined;
    if (!call) continue;
    call.detail = { ...call.detail, conversation_id: e.detail.conversation_id, recording: e.detail.recording, transcript_version: e.detail.transcript_version,
      conversation_state: e.detail.state, recording_count: Math.max(Number(call.detail.recording_count ?? 0), 1) };
    call.evidence_refs = [...new Set([...call.evidence_refs, ...e.evidence_refs])];
    if (e.focus) call.focus = true;
    dropped.add(e.id);
  }
  return events.filter(e => !dropped.has(e.id));
}

const OWNER_LABELS = new Set(["automatic", "system", "evidence", "worker", "auto", "vantage", "intelligence"]);
const decidedBy = (by: unknown): StoryActor => (typeof by === "string" && by.trim() && !OWNER_LABELS.has(by.trim().toLowerCase()) ? actor("owner", null, text(by, 60)) : actor("vantage"));

/** One event per attachment edge transition; edges without history yield one event for the current state. */
export const attachmentSource: StorySource = async (subject, limit) => {
  const model = getNumberLeadAttachmentModel();
  const rows = subject.contact_number_id
    ? await model.find({ contact_number_id: oid(subject.contact_number_id) }).sort({ _id: 1 }).limit(limit + 1).lean()
    : subject.lead_refs.length ? (await Promise.all((["FormLead", "CallLead"] as const).map(m => {
      const ids = subject.lead_refs.filter(r => r.model === m && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
      return ids.length ? model.find({ "lead_ref.model": m, "lead_ref.id": { $in: ids } }).sort({ _id: 1 }).limit(limit + 1).lean() : Promise.resolve([]);
    }))).flat() : [];
  const page = bounded(rows, limit);
  const events: StoryEvent[] = [];
  for (const edge of page.rows) {
    const ref: StoryLeadRef = { model: edge.lead_ref.model, id: String(edge.lead_ref.id) };
    const base = { attachment_id: String(edge._id), lead_ref: ref, certainty: edge.certainty, lead_name: text(edge.lead_snapshot?.name, 80),
      evidence_sources: [...new Set((edge.evidence ?? []).map(e => e.source))] };
    const history = (edge.history ?? []).filter(h => h.to === "attached" || h.to === "rejected" || h.to === "ambiguous");
    if (history.length) {
      history.forEach((h, n) => {
        const at = iso(h.at) ?? iso(edge.updatedAt);
        if (!at) return;
        events.push(event({ kind: "number_attached", id: `${edge._id}:${n}`, happened_at: at, observed_at: iso(edge.updatedAt), subject_key: leadKey(ref), actor: decidedBy(h.by),
          detail: { ...base, state: h.to, from_state: h.from ?? null, decided_by: text(h.by, 60), reason: text(h.reason, 200) }, evidence_refs: [`attachment:${edge._id}`] }));
      });
      continue;
    }
    const at = iso(edge.decided_at) ?? iso(edge.auto_decision?.decided_at) ?? iso(edge.createdAt);
    if (!at) continue;
    events.push(event({ kind: "number_attached", id: String(edge._id), happened_at: at, observed_at: iso(edge.updatedAt), subject_key: leadKey(ref),
      actor: edge.decided_at ? decidedBy(edge.decided_by) : actor("vantage"),
      detail: { ...base, state: edge.state, from_state: null, decided_by: text(edge.decided_by, 60) ?? (edge.auto_decision ? "automatic" : null),
        reason: text(edge.decision_reason, 200) ?? text(edge.auto_decision?.reason, 200) ?? (base.evidence_sources.length ? base.evidence_sources.join(", ") : null),
        confidence: num(edge.auto_decision?.confidence) }, evidence_refs: [`attachment:${edge._id}`] }));
  }
  return { events: events.filter(withinAsOf(subject)).sort(byNewest), read: page.read, truncated: page.truncated };
};

type ChangeRow = { _id: mongoose.Types.ObjectId; entity: { model: string; id: string }; changed_paths: string[]; fields: Array<{ path: string; before?: unknown; after?: unknown }>;
  applied_at: Date; provenance?: { source_system?: string; observation_id?: unknown } | null };

/** `granot_priority_changed` / `quoted_changed` from append-only Lead changes, timed by the paired observation. */
export const granotChangeSource: StorySource = async (subject, limit) => {
  if (!subject.lead_refs.length) return empty();
  const batches = await Promise.all(subject.lead_refs.slice(0, limit).map(ref => db().collection("entity_changes")
    .find({ "entity.model": ref.model, "entity.id": ref.id, changed_paths: { $in: ["granot_priority", "quoted"] }, applied_at: dateWindow(subject) },
      { projection: { entity: 1, changed_paths: 1, fields: 1, applied_at: 1, "provenance.source_system": 1, "provenance.observation_id": 1 } })
    .sort({ applied_at: -1 }).limit(limit + 1).toArray()));
  const truncated = batches.some(rows => rows.length > limit);
  const changes = batches.flatMap(rows => rows.slice(0, limit) as unknown as ChangeRow[]);
  const observationIds = [...new Set(changes.map(c => c.provenance?.observation_id).filter(Boolean).map(String))].filter(id => mongoose.isValidObjectId(id));
  const observations = new Map<string, GranotObservationDocument>();
  if (observationIds.length) for (const row of await getGranotObservationModel().find({ _id: { $in: observationIds.map(oid) } }).select("captured_at agent_identity").limit(observationIds.length).lean())
    observations.set(String(row._id), row as GranotObservationDocument);
  const events: StoryEvent[] = [];
  for (const change of changes) {
    const ref: StoryLeadRef = { model: change.entity.model as StoryLeadRef["model"], id: change.entity.id };
    const observation = change.provenance?.observation_id ? observations.get(String(change.provenance.observation_id)) ?? null : null;
    const happened = iso(observation?.captured_at) ?? change.applied_at.toISOString();
    const source = change.provenance?.source_system ?? "granot";
    const who: StoryActor = source === "granot" ? actor("granot", text(observation?.agent_identity?.rep_raw, 60)) : actor("vantage");
    const common = { change_id: String(change._id), observation_id: observation ? String(observation._id) : null, source_system: source, applied_at: change.applied_at.toISOString() };
    const refs = [`change:${change._id}`, ...(observation ? [`observation:${observation._id}`] : [])];
    const priority = change.fields.find(f => f.path === "granot_priority");
    if (priority && change.changed_paths.includes("granot_priority")) {
      const from = normalizePriority(priority.before), to = normalizePriority(priority.after);
      events.push(event({ kind: "granot_priority_changed", id: String(change._id), happened_at: happened, observed_at: change.applied_at.toISOString(), subject_key: leadKey(ref), actor: who,
        detail: { ...common, lead_ref: ref, from, to, label_from: priorityLabel(from), label_to: priorityLabel(to), disposition_to: dispositionFor(to), granot_rep_raw: text(observation?.agent_identity?.rep_raw, 60) },
        evidence_refs: refs }));
    }
    const quoted = change.fields.find(f => f.path === "quoted");
    // A creation change carrying quoted:false is not a change of mind; only a real flip is an event.
    if (quoted && change.changed_paths.includes("quoted") && (quoted.after === true || quoted.before === true)) events.push(event({ kind: "quoted_changed", id: String(change._id), happened_at: happened, observed_at: change.applied_at.toISOString(),
      subject_key: leadKey(ref), actor: who, detail: { ...common, lead_ref: ref, quoted: quoted.after === true, quoted_before: quoted.before === true }, evidence_refs: refs }));
  }
  return { events: events.filter(withinAsOf(subject)).sort(byNewest), read: changes.length, truncated: truncated || subject.lead_refs.length > limit };
};

const moneyRaw = (amount: { raw?: string; canonical?: string } | undefined | null) => ({ raw: text(amount?.raw, 40), canonical: text(amount?.canonical, 40) });
const observationLocation = (loc: { city?: string; state?: string; zip?: string } | undefined) => loc ? endpoint({ city: loc.city ?? null, state: loc.state ?? null, zip: loc.zip ?? null }) : null;

/** ONE `granot_observed` per Lead: the newest observation, i.e. Granot's current display state. */
export const granotObservedSource: StorySource = async (subject, limit) => {
  if (!subject.lead_refs.length) return empty();
  const leads = await readLeadRows(subject.lead_refs.slice(0, limit));
  const observations = await newestObservations(leads, subject.as_of);
  const events = leads.flatMap(lead => {
    const observation = observations.get(`${lead.model}:${lead._id}`);
    if (!observation) return [];
    const ref: StoryLeadRef = { model: lead.model, id: String(lead._id) };
    const priority = normalizePriority(observation.priority?.canonical ?? observation.priority?.raw);
    const estimate = moneyRaw(observation.display_money?.estimate), payment = moneyRaw(observation.display_money?.payment), balance = moneyRaw(observation.display_money?.balance);
    return [event({ kind: "granot_observed", id: String(observation._id), happened_at: observation.captured_at.toISOString(), observed_at: iso(observation.createdAt), subject_key: leadKey(ref),
      actor: actor("granot", text(observation.agent_identity?.rep_raw, 60)),
      detail: { lead_ref: ref, observation_kind: observation.kind, source_label: observation.normalized_source_label ?? null, job_no: text(observation.identity?.job_no_raw, 40),
        priority, priority_label: priorityLabel(priority), disposition: dispositionFor(priority), priority_valid: bool(observation.priority?.valid),
        booking_action: observation.booking_action?.normalized ?? null, booking_action_raw: text(observation.booking_action?.raw, 40),
        estimate: estimate.raw, payment: payment.raw, balance: balance.raw, estimate_canonical: estimate.canonical, payment_canonical: payment.canonical, balance_canonical: balance.canonical,
        move: { pickup: observationLocation(observation.move?.origin), delivery: observationLocation(observation.move?.destination), move_date: iso(observation.move?.move_date)?.slice(0, 10) ?? text(observation.move?.move_date_raw, 40),
          granot_move_size: text(observation.move?.granot_move_size_raw, 40), service_type: text(observation.move?.service_type_raw, 40), cubic_feet: num(observation.move?.estimated_cubic_feet) },
        rep_raw: text(observation.agent_identity?.rep_raw, 60), user_raw: text(observation.agent_identity?.user_raw, 60) },
      evidence_refs: [`observation:${observation._id}`] })];
  }).filter(withinAsOf(subject)).sort(byNewest);
  return { events, read: leads.length, truncated: subject.lead_refs.length > limit };
};

/** `booking_recorded` by `lead_ref`/`job_no`, and `cancellation_recorded` by `booked_lead`/`lead_ref`. */
export const bookingSource: StorySource = async (subject, limit) => {
  if (!subject.lead_refs.length) return empty();
  const leads = await readLeadRows(subject.lead_refs.slice(0, limit));
  const leadIds = leads.map(l => l._id);
  const jobNos = [...new Set(leads.map(l => l.job_no?.trim()).filter((j): j is string => Boolean(j)))];
  const clauses: Record<string, unknown>[] = [{ lead_ref: { $in: leadIds } }, ...(jobNos.length ? [{ job_no: { $in: jobNos } }] : [])];
  const bookings = await db().collection("booked_leads").find({ $or: clauses, book_date: dateWindow(subject) },
    { projection: { book_date: 1, job_no: 1, deposit_amount: 1, total_binder_amount: 1, source: 1, lead_ref: 1, lead_model: 1, cancelled: 1, createdAt: 1 } })
    .sort({ book_date: -1 }).limit(limit + 1).toArray();
  const bookingPage = bounded(bookings, limit);
  const cancellations = await db().collection("cancelled_leads").find({ $or: [{ booked_lead: { $in: bookingPage.rows.map(b => b._id) } }, { lead_ref: { $in: leadIds } }], cancel_date: dateWindow(subject) },
    { projection: { cancel_date: 1, reason: 1, refund_amount: 1, booked_lead: 1, lead_ref: 1, lead_model: 1, lead_ref_snapshot: 1, job_no: 1, job_no_snapshot: 1, createdAt: 1 } })
    .sort({ cancel_date: -1 }).limit(limit + 1).toArray();
  const cancellationPage = bounded(cancellations, limit);
  const leadRefFor = (row: Record<string, unknown> & { lead_ref_snapshot?: { model?: unknown; id?: unknown } | null }): StoryLeadRef | null => {
    const id = row.lead_ref_snapshot?.id ?? row.lead_ref, model = row.lead_ref_snapshot?.model ?? row.lead_model;
    if (!id) return null;
    const match = leads.find(l => String(l._id) === String(id));
    return { model: (match?.model ?? (model === "CallLead" ? "CallLead" : "FormLead")) as StoryLeadRef["model"], id: String(id) };
  };
  const events: StoryEvent[] = [];
  for (const row of bookingPage.rows) {
    const happened = iso(row.book_date) ?? iso(row.createdAt);
    if (!happened) continue;
    const ref = leadRefFor(row);
    events.push(event({ kind: "booking_recorded", id: String(row._id), happened_at: happened, observed_at: iso(row.createdAt), subject_key: ref ? leadKey(ref) : numberKey(subject) ?? "number:unknown",
      actor: actor("vantage"), detail: { booking_id: String(row._id), lead_ref: ref, job_no: text(row.job_no, 40), deposit_amount: num(row.deposit_amount), total_binder_amount: num(row.total_binder_amount),
        source: text(row.source, 60), cancelled: Boolean(row.cancelled) }, evidence_refs: [`booking:${row._id}`] }));
  }
  for (const row of cancellationPage.rows) {
    const happened = iso(row.cancel_date) ?? iso(row.createdAt);
    if (!happened) continue;
    const ref = leadRefFor(row);
    events.push(event({ kind: "cancellation_recorded", id: String(row._id), happened_at: happened, observed_at: iso(row.createdAt), subject_key: ref ? leadKey(ref) : numberKey(subject) ?? "number:unknown",
      actor: actor("vantage"), detail: { cancellation_id: String(row._id), booking_id: row.booked_lead ? String(row.booked_lead) : null, lead_ref: ref, job_no: text(row.job_no_snapshot ?? row.job_no, 40),
        reason: text(row.reason, 200), refund_amount: num(row.refund_amount) }, evidence_refs: [`cancellation:${row._id}`, ...(row.booked_lead ? [`booking:${row.booked_lead}`] : [])] }));
  }
  return { events: events.filter(withinAsOf(subject)).sort(byNewest), read: bookingPage.read + cancellationPage.read, truncated: bookingPage.truncated || cancellationPage.truncated };
};

/** Follow-up lifecycle from `outreach_followups`: created, completed, cancelled, superseded. */
export const followupSource: StorySource = async (subject, limit) => {
  const ids = subject.outreach_record_ids.filter(id => mongoose.isValidObjectId(id)).map(oid);
  if (!ids.length) return empty();
  const records = await readOutreachRecords(subject.outreach_record_ids);
  const keyByRecord = new Map(records.map(r => [String(r._id), subjectKey(r.subject as Parameters<typeof subjectKey>[0])]));
  const rows = await getOutreachFollowupModel().find({ outreach_record_id: { $in: ids }, createdAt: dateWindow(subject) }).sort({ createdAt: -1 }).limit(limit + 1).lean();
  const page = bounded(rows, limit);
  const events: StoryEvent[] = [];
  for (const row of page.rows) {
    const id = String(row._id), key = keyByRecord.get(String(row.outreach_record_id)) ?? numberKey(subject) ?? "number:unknown";
    const who = actor(followupActorKind(row.origin), null, row.promised_by_agent_id ? String(row.promised_by_agent_id) : null);
    const detail = { followup_id: id, outreach_record_id: String(row.outreach_record_id), kind: row.kind, description: text(row.description, 300), due_at: iso(row.due_at), date_text: text(row.date_text, 60),
      origin: row.origin, promised_by: row.promised_by_agent_id ? String(row.promised_by_agent_id) : null, source_finding_ids: (row.source_finding_ids ?? []).map(String),
      completion_basis: row.completion_basis ?? null, disposition: row.disposition ?? null, cancel_reason: text(row.cancel_reason, 200), status: row.status };
    const refs = [`followup:${id}`, ...(row.source_interaction_id ? [`interaction:${row.source_interaction_id}`] : []), ...(row.source_finding_ids ?? []).map(f => `finding:${f}`)];
    const created = iso((row as { createdAt?: Date }).createdAt);
    if (created) events.push(event({ kind: "followup_created", id, happened_at: created, observed_at: created, subject_key: key, actor: who, detail, evidence_refs: refs }));
    const updated = iso((row as { updatedAt?: Date }).updatedAt);
    if (row.status === "completed" && (iso(row.completed_at) ?? updated)) events.push(event({ kind: "followup_completed", id, happened_at: iso(row.completed_at) ?? updated!, observed_at: updated, subject_key: key,
      actor: row.completion_basis === "owner" ? actor("owner", null, text(row.completed_by, 60)) : row.completion_basis === "customer_confirmation" ? actor("customer") : row.completion_basis === "rep_confirmation" ? actor("rep") : actor("vantage"),
      detail, evidence_refs: [...refs, ...(row.evidence_interaction_id ? [`interaction:${row.evidence_interaction_id}`] : []), ...(row.completion_finding_id ? [`finding:${row.completion_finding_id}`] : [])] }));
    if (row.status === "cancelled" && updated) events.push(event({ kind: "followup_cancelled", id, happened_at: updated, observed_at: updated, subject_key: key, actor: actor("owner"), detail, evidence_refs: refs }));
    if (row.status === "superseded" && updated) events.push(event({ kind: "followup_superseded", id, happened_at: updated, observed_at: updated, subject_key: key, actor: actor("intelligence"), detail, evidence_refs: refs }));
  }
  return { events: events.filter(withinAsOf(subject)).sort(byNewest), read: page.read, truncated: page.truncated };
};

type AuditRow = { _id: mongoose.Types.ObjectId; subject_key: string; event_kind: string; happened_at: Date; recorded_at: Date; prior?: unknown; current?: unknown;
  actor: { kind: string; id: string; run_id?: unknown }; invalidation: { kind: string; target_id: string } };
const pick = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), value);

/** Owner actions and worker transitions from the append-only audit stream, mapped like `outreach/timeline.ts`. */
export const auditSource: StorySource = async (subject, limit) => {
  const keys = await storySubjectKeys(subject);
  if (!keys.length) return empty();
  const rows = (await getSalesIntelligenceAuditEventModel().find({ subject_key: { $in: keys }, happened_at: dateWindow(subject), event_kind: { $nin: [...EXCLUDED_AUDIT_EVENT_KINDS] } })
    .sort({ happened_at: -1, _id: -1 }).limit(limit + 1).lean()) as unknown as AuditRow[];
  const page = bounded(rows, limit);
  const events: StoryEvent[] = [];
  for (const row of page.rows) {
    const kind = auditEventStoryKind(row.event_kind, row.invalidation?.kind);
    if (!kind) continue;
    const current = row.current, prior = row.prior;
    const detail: Record<string, unknown> = { event_kind: row.event_kind, invalidation_kind: row.invalidation?.kind ?? null, target_id: row.invalidation?.target_id ?? null,
      actor: row.actor?.id ?? null, actor_kind: row.actor?.kind ?? null, run_id: row.actor?.run_id ? String(row.actor.run_id) : null,
      note: text(pick(current, "note"), 400), reason: text(pick(current, "reason") ?? pick(current, "closed_reason") ?? pick(current, "cancel_reason") ?? pick(current, "wait_reason"), 300),
      agent_id: pick(current, "responsible_agent_id") ? String(pick(current, "responsible_agent_id")) : null, agent_name: text(pick(current, "agent_name") ?? pick(current, "agent_name_snapshot"), 80),
      until: iso(pick(current, "until") ?? pick(current, "wait_until")), channels: Array.isArray(pick(current, "channels")) ? (pick(current, "channels") as unknown[]).map(String) : null,
      channel: text(pick(current, "channel"), 30), cause_kind: text(pick(current, "cause_kind"), 40), state: text(pick(current, "state"), 40), state_before: text(pick(prior, "state"), 40), closure_origin: text(pick(current, "closure_origin"), 30),
      prior: smallJson(prior), current: smallJson(current) };
    if (kind === "closed" && !detail.reason) detail.reason = text(pick(current, "closed_reason"), 300);
    if (kind === "call_ended") detail.note = text(pick(current, "call_progress.note") ?? pick(current, "note"), 300);
    events.push(event({ kind, id: String(row._id), happened_at: row.happened_at.toISOString(), observed_at: iso(row.recorded_at), subject_key: row.subject_key,
      actor: actor(auditActorKind(row.actor?.kind), null, row.actor?.kind === "owner" ? text(row.actor.id, 60) : null),
      detail, evidence_refs: [`audit:${row._id}`, ...(row.invalidation?.target_id ? [`${row.invalidation.kind}:${row.invalidation.target_id}`] : [])] }));
  }
  return { events, read: page.read, truncated: page.truncated };
};

/** Published, non-shadow Move assessments for every subject key in scope. */
export const assessmentSource: StorySource = async (subject, limit) => {
  const [keys, records] = await Promise.all([storySubjectKeys(subject), readOutreachRecords(subject.outreach_record_ids)]);
  if (!keys.length) return empty();
  const rows = await getMoveAssessmentArtifactModel().find({ subject_key: { $in: keys }, status: "ready", shadow: false, purged_at: null, published_at: dateWindow(subject) })
    .select("subject_key scores engagement published_at createdAt").sort({ createdAt: -1 }).limit(limit + 1).lean();
  const page = bounded(rows, limit);
  const current = new Set(records.map(r => r.move_assessment?.artifact_id).filter(Boolean).map(String));
  const staleById = new Map(records.filter(r => r.move_assessment?.artifact_id).map(r => [String(r.move_assessment!.artifact_id), Boolean(r.move_assessment!.stale)]));
  const events = page.rows.flatMap(row => {
    const happened = iso(row.published_at) ?? iso((row as { createdAt?: Date }).createdAt);
    if (!happened) return [];
    const id = String(row._id);
    const scores = row.scores as { transaction_intent?: { score?: unknown }; move_likelihood?: { score?: unknown } } | null;
    return [event({ kind: "assessment_published", id, happened_at: happened, observed_at: happened, subject_key: row.subject_key, actor: actor("intelligence"),
      detail: { artifact_id: id, transaction_intent: num(scores?.transaction_intent?.score), move_likelihood: num(scores?.move_likelihood?.score),
        work_status: text((row.engagement as { work_status?: unknown } | null)?.work_status, 40), stale: current.has(id) ? staleById.get(id) ?? false : current.size > 0 },
      evidence_refs: [`assessment:${id}`] })];
  });
  return { events: events.filter(withinAsOf(subject)), read: page.read, truncated: page.truncated };
};

/** Active Owner instructions (corrections) on any subject key in scope. */
export const correctionSource: StorySource = async (subject, limit) => {
  const keys = await storySubjectKeys(subject);
  if (!keys.length) return empty();
  const rows = await getSalesIntelligenceOwnerInstructionModel().find({ subject_key: { $in: keys }, state: "active", happened_at: dateWindow(subject) }).sort({ happened_at: -1 }).limit(limit + 1).lean();
  const page = bounded(rows, limit);
  const events = page.rows.map(row => event({ kind: "owner_correction", id: `${row.instruction_id}:${row.revision}`, happened_at: row.happened_at.toISOString(), observed_at: row.happened_at.toISOString(),
    subject_key: row.subject_key, actor: actor("owner", null, text(row.actor?.id, 60)),
    detail: { instruction_id: String(row.instruction_id), revision: row.revision, field: row.field, current: smallJson(row.current, 600), prior: smallJson(row.prior, 600),
      followup_id: row.followup_id ? String(row.followup_id) : null, finding_id: row.finding_id ? String(row.finding_id) : null },
    evidence_refs: [`instruction:${row.instruction_id}`] }));
  return { events, read: page.read, truncated: page.truncated };
};

/** Every reader, keyed by its coverage name. */
export const STORY_SOURCES: Readonly<Record<string, StorySource>> = {
  lead_received: leadReceivedSource, lead_messages: leadMessageSource, calls: callSource, conversations: conversationSource, attachments: attachmentSource,
  granot_changes: granotChangeSource, granot_observed: granotObservedSource, bookings: bookingSource, followups: followupSource, audit: auditSource,
  assessments: assessmentSource, corrections: correctionSource,
};

/** The Contact Number fields the story needs; null when purged or missing. */
export async function readStoryContactNumber(id: string): Promise<{ e164: string; provider_names: string[] } | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const row = await getContactNumberModel().findOne({ _id: oid(id), purged_at: null }).select("e164 provider_names").lean();
  return row ? { e164: row.e164, provider_names: [...(row.provider_names ?? [])] } : null;
}
