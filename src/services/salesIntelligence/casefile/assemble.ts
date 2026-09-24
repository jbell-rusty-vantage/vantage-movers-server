import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../../config/domain/runtime";
import { csiDataset } from "../../../config/domain/salesIntelligence";
import { getIntelligenceEvidenceSnapshotModel } from "../../../models/IntelligenceEvidenceSnapshot";
import { getIntelligenceFindingModel } from "../../../models/IntelligenceFinding";
import { getIntelligenceRunModel } from "../../../models/IntelligenceRun";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { toObjectId } from "../../../utils/objectId";
import { readCaptureCoverage } from "../../numberActivity/coverage";
import { summaryStepSchema } from "../analysis/structuredContract";
import { moveViewsForLead, type LeadMoveSource } from "../assessment/views";
import { selectPriorAnalyses } from "../analysis/prior";
import type { ReadContent } from "../analysis/reads";
import { resolvePolicy } from "../policy";
import { subjectKey } from "../outreach/types";
import { resolveStorySubject } from "../story/assemble";
import { findLeadCandidates } from "../story/candidates";
import { readLeadBookings } from "../story/granot";
import { LEAD_PROJECTION, leadCollection, readLeadRows, readOutreachRecords, readStoryContactNumber, STORY_SOURCES, subjectKeysFor, TIMELINE_KINDS, TIMELINE_LEAD_FANOUT,
  type LeadRow, type TimelineReadContext } from "../story/sources";
import type { LeadCandidate, StoryEvent, StoryLeadRef, StorySubject } from "../story/types";
import { applyCaseFileBudget } from "./budget";
import { buildCaseFile } from "./build";
import { readAcceptedObservations } from "./granotHistory";
import { CASE_FILE_TIMEZONE, CASE_FILE_VERSION, type CaseFileAudience, type CaseConversation, type CaseEdge, type CaseFile, type CaseFileInput, type CaseFileSources, type CaseFinding,
  type CaseFollowup, type CaseLead, type CaseRecord, type CaseSummary, type RenderedCaseFile } from "./types";
import { readCaseCalls, readVantageSideContext } from "./vantageSide";

/**
 * `assembleCaseFile(input)` (spec §4.1): one bounded fan-out that reuses the story readers in
 * timeline mode (the reader fixes, V24/F3), the Prior Analysis page, the summaries and the §4.4/§4.5
 * readers, then the pure builder and the budget. Read only: nothing here writes.
 */
const db = () => mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
const oid = toObjectId;
const iso = (value: unknown) => (value instanceof Date && !Number.isNaN(+value) ? value.toISOString() : null);
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
export const CASE_FILE_CALL_LIMIT = 400;
export const CASE_FILE_READER_LIMIT = 400;
const CASE_FILE_KINDS = new Set(TIMELINE_KINDS.filter(kind => !["granot_observed", "followup_snoozed", "analysis_submitted"].includes(kind)));
const CASE_LEAD_PROJECTION = { ...LEAD_PROJECTION, receiver_agent_source: 1, receiver_agent_set_at: 1, "ringcentral.target_phone_number": 1, "ringcentral.target_name": 1,
  "ringcentral.source_label": 1, "ringcentral.route_id": 1, "ingested_contact_snapshot.name": 1, "ingested_contact_snapshot.evidence_status": 1,
  "current_contact_provenance.source_system": 1 } as const;

export type AssembledCaseFile = { sources: CaseFileSources; file: CaseFile; rendered: RenderedCaseFile };

async function resolveSubject(input: CaseFileInput): Promise<StorySubject> {
  const resolved = input.contact_number_id ? await resolveStorySubject({ contact_number_id: input.contact_number_id, as_of: input.as_of })
    : input.lead_refs[0] ? await resolveStorySubject({ lead: input.lead_refs[0], as_of: input.as_of }) : null;
  const base: StorySubject = resolved ?? { contact_number_id: input.contact_number_id, e164: input.e164, lead_refs: [], outreach_record_ids: [], conversation_ids: [], as_of: input.as_of, focus: null };
  const refs = [...base.lead_refs, ...input.lead_refs.filter(r => !base.lead_refs.some(b => b.model === r.model && b.id === r.id))].slice(0, 100);
  return { ...base, e164: base.e164 ?? input.e164, lead_refs: refs, outreach_record_ids: [...new Set([...base.outreach_record_ids, ...input.outreach_record_ids])].slice(0, 100),
    conversation_ids: [...new Set([...base.conversation_ids, ...input.conversation_ids])].slice(0, 100), as_of: input.as_of };
}

export type RawLead = LeadRow & LeadMoveSource & { receiver_agent_source?: string | null; receiver_agent_set_at?: Date | null;
  ingested_contact_snapshot?: { name?: string | null; evidence_status?: string | null } | null; current_contact_provenance?: { source_system?: string | null } | null;
  ringcentral?: (LeadRow["ringcentral"] & { target_phone_number?: string | null; target_name?: string | null; source_label?: string | null; route_id?: unknown }) | null };
export async function readCaseLeads(refs: readonly StoryLeadRef[]): Promise<RawLead[]> {
  const out = new Map<string, RawLead>();
  for (const model of ["FormLead", "CallLead"] as const) {
    const ids = refs.filter(r => r.model === model && mongoose.isValidObjectId(r.id)).map(r => oid(r.id));
    if (!ids.length) continue;
    const rows = await db().collection(leadCollection(model)).find({ _id: { $in: ids } }, { projection: CASE_LEAD_PROJECTION }).limit(ids.length).toArray();
    for (const row of rows) out.set(`${model}:${row._id}`, { ...(row as unknown as RawLead), model });
  }
  return refs.flatMap(r => { const row = out.get(`${r.model}:${r.id}`); return row ? [row] : []; });
}
export function toCaseLead(row: RawLead): CaseLead {
  const rc = row.model === "CallLead" ? row.ringcentral ?? null : null;
  return { ref: { model: row.model, id: String(row._id) }, name: str(row.name), granot_contact_name: str(row.granot_contact_snapshot?.name), received_at: iso(row.timestamp),
    created_at: iso(row.createdAt), source_label: str(row.source_company_label_snapshot) ?? str(row.source_company), job_no: str(row.job_no), normalized_job_no: str(row.normalized_job_no),
    normalized_phone: str(row.normalized_phone_number), duplicate: Boolean(row.duplicate), bad_lead: Boolean(row.bad_lead), no_sync: Boolean(row.no_sync), booked: Boolean(row.booked),
    cancelled: Boolean(row.cancelled), granot_priority: str(row.granot_priority), quoted: row.quoted === true, ingestion_origin: str(row.ingestion_origin),
    contact_origin: row.ingested_contact_snapshot || row.current_contact_provenance ? { ingested_name: str(row.ingested_contact_snapshot?.name),
      ingested_status: str(row.ingested_contact_snapshot?.evidence_status), current_source: str(row.current_contact_provenance?.source_system) } : null,
    receiver: row.receiver_agent || row.receiver_agent_name_snapshot ? { agent_id: row.receiver_agent ? String(row.receiver_agent) : null, name: str(row.receiver_agent_name_snapshot),
      source: str(row.receiver_agent_source), set_at: iso(row.receiver_agent_set_at) } : null,
    move: JSON.parse(JSON.stringify(moveViewsForLead(row, row.model))),
    ringcentral: rc ? { telephony_session_id: str(rc.telephony_session_id), qualification_reason: str(rc.qualification_reason), start_time: iso(rc.start_time),
      target_phone_number: str(rc.target_phone_number), target_name: str(rc.target_name), source_label: str(rc.source_label), route_id: rc.route_id ? String(rc.route_id) : null } : null };
}

/** The canonical summary per conversation: the artifact at the conversation's current transcript version, else the newest (as `prior.ts` selects). */
async function readCanonicalSummaries(conversations: Array<{ _id: unknown; latest_transcript_version?: string | null }>): Promise<Map<string, CaseSummary>> {
  const out = new Map<string, CaseSummary>();
  if (!conversations.length) return out;
  const rows = await getIntelligenceEvidenceSnapshotModel().find({ ...csiDataset(), source_type: "summary", artifact_key: { $type: "string" },
    conversation_id: { $in: conversations.map(c => oid(String(c._id))) }, purged_at: null, purge_started_at: null }).select("conversation_id response").sort({ _id: -1 }).limit(conversations.length * 5).lean();
  for (const conversation of conversations) {
    const id = String(conversation._id);
    const mine = rows.filter(r => String(r.conversation_id) === id);
    const row = mine.find(r => (r.response as { transcript?: { transcript_version?: string } } | null)?.transcript?.transcript_version === conversation.latest_transcript_version) ?? mine[0];
    const parsed = row ? summaryStepSchema.safeParse((row.response as { analysis_summary?: unknown } | null)?.analysis_summary) : null;
    if (parsed?.success) out.set(id, { conversation_id: id, summary: parsed.data, source: "canonical" });
  }
  return out;
}

/** The rolling summary's covered conversations: its run's captured summary artifacts (`step_artifacts.summaries`). */
async function synthesisCovers(prior: CaseFileInput["prior"]): Promise<string[] | null> {
  const synthesis = prior?.page.records.find(r => r.record_type === "prior_summary" && r.fields.kind === "number_synthesis");
  const runId = synthesis ? str(synthesis.fields.run_id) : null;
  if (!runId || !mongoose.isValidObjectId(runId)) return null;
  const run = await getIntelligenceRunModel().findById(runId).select("step_artifacts").lean();
  const ids = (run?.step_artifacts as { summaries?: unknown } | null | undefined)?.summaries;
  if (!Array.isArray(ids)) return null;
  const valid = ids.map(String).filter(id => mongoose.isValidObjectId(id));
  if (!valid.length) return [];
  const rows = await getIntelligenceEvidenceSnapshotModel().find({ _id: { $in: valid.map(oid) } }).select("conversation_id").limit(valid.length).lean();
  return [...new Set(rows.flatMap(r => (r.conversation_id ? [String(r.conversation_id)] : [])))].sort();
}

export async function assembleCaseFileSources(input: CaseFileInput): Promise<CaseFileSources> {
  const subject = await resolveSubject(input);
  const numberId = subject.contact_number_id && mongoose.isValidObjectId(subject.contact_number_id) ? subject.contact_number_id : null;
  const asOf = input.as_of;
  const [number, edgeRows, records, rawLeads, calls, conversationRows, coverage, policy, restrictionRows] = await Promise.all([
    numberId ? readStoryContactNumber(numberId) : Promise.resolve(null),
    numberId ? getNumberLeadAttachmentModel().find({ contact_number_id: oid(numberId), state: { $ne: "rejected" } }).select("lead_ref state certainty decision_reason auto_decision decided_by")
      .sort({ _id: 1 }).limit(101).lean() : Promise.resolve([]),
    subject.outreach_record_ids.length ? getOutreachRecordModel().find({ _id: { $in: subject.outreach_record_ids.filter(id => mongoose.isValidObjectId(id)).map(oid) } })
      .select("subject state closed_reason closure_origin responsible_agent_id assignment wait_until move_assessment").sort({ _id: 1 }).limit(101).lean() : Promise.resolve([]),
    readCaseLeads(subject.lead_refs),
    numberId ? readCaseCalls(numberId, asOf, CASE_FILE_CALL_LIMIT) : Promise.resolve({ calls: [], truncated: false }),
    numberId ? getLeadConversationModel().find({ contact_number_id: oid(numberId), started_at: { $lte: asOf }, content_purged_at: null })
      .select("call_interaction_id started_at direction duration_seconds lead_ref state latest_transcript_version").sort({ started_at: -1, _id: -1 }).limit(101).lean()
      : subject.conversation_ids.length ? getLeadConversationModel().find({ _id: { $in: subject.conversation_ids.filter(id => mongoose.isValidObjectId(id)).map(oid) }, started_at: { $lte: asOf } })
        .select("call_interaction_id started_at direction duration_seconds lead_ref state latest_transcript_version").limit(101).lean() : Promise.resolve([]),
    input.coverage !== undefined ? Promise.resolve(input.coverage) : readCaptureCoverage(),
    resolvePolicy(),
    numberId ? getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: oid(numberId), state: "active" }).select("channels until").sort({ _id: 1 }).limit(51).lean() : Promise.resolve([]),
  ]);
  const truncated: string[] = [];
  if (calls.truncated) truncated.push("calls");
  if (conversationRows.length > 100) truncated.push("conversations");
  if (edgeRows.length > 100) truncated.push("attachments");
  const edges: CaseEdge[] = (edgeRows as unknown as Array<{ lead_ref: { model: "FormLead" | "CallLead"; id: unknown }; state: CaseEdge["state"]; certainty?: string | null;
    decision_reason?: string | null; auto_decision?: { reason?: string | null } | null; decided_by?: string | null }>).slice(0, 100)
    .map(e => ({ lead_ref: { model: e.lead_ref.model, id: String(e.lead_ref.id) }, state: e.state, certainty: e.certainty ?? null,
      reason: str(e.decision_reason) ?? str(e.auto_decision?.reason) ?? null, decided_by: str(e.decided_by) }));
  const leads = rawLeads.map(toCaseLead);
  const attachedRefs = numberId ? edges.filter(e => e.state === "attached").map(e => e.lead_ref) : subject.lead_refs;
  const recordRows = records as unknown as Array<{ _id: unknown; subject: { kind: string; model?: string | null; id?: unknown; contact_number_id?: unknown }; state: string;
    closed_reason?: string | null; closure_origin?: string | null; responsible_agent_id?: unknown; assignment?: { origin: string; assigned_at?: Date | null } | null; wait_until?: Date | null }>;
  const conversations = (conversationRows as unknown as Array<{ _id: unknown; call_interaction_id?: unknown; started_at: Date; direction?: string | null; duration_seconds?: number | null;
    lead_ref?: { model: "FormLead" | "CallLead"; id: unknown } | null; state?: string | null; latest_transcript_version?: string | null }>).slice(0, 100);

  // The story readers in timeline mode, every kind but the ones the Case File replaces or never shows.
  const storyRecords = await readOutreachRecords(subject.outreach_record_ids);
  const fanout = subject.lead_refs.slice(0, TIMELINE_LEAD_FANOUT);
  const leadRows = await readLeadRows(fanout);
  if (subject.lead_refs.length > fanout.length) truncated.push("leads");
  const timeline: TimelineReadContext = { scope: numberId ? "number" : "outreach", after: null, kinds: CASE_FILE_KINDS, subject_keys: subjectKeysFor(subject, storyRecords),
    records: storyRecords, lead_refs: fanout, leads: leadRows };
  const readers = Object.entries(STORY_SOURCES).filter(([name]) => name !== "granot_observed");
  const conversationIds = conversations.map(c => String(c._id));
  const findingFilter = { purged_at: null, purge_started_at: null, createdAt: { $lte: asOf },
    ...(numberId ? { contact_number_id: oid(numberId) } : { conversation_id: { $in: conversationIds.map(oid) } }) };
  const recordIds = recordRows.map(r => oid(String(r._id)));
  const subjectKeys = [...new Set([...timeline.subject_keys, ...recordRows.map(r => subjectKey(r.subject as Parameters<typeof subjectKey>[0]))])];
  const [results, granot, bookings, vantage, canonical, findingRows, followupRows, reviewRows, candidates, covers] = await Promise.all([
    Promise.all(readers.map(async ([name, source]) => [name, await source(subject, CASE_FILE_READER_LIMIT, { timeline })] as const)),
    readAcceptedObservations(leads.filter(l => attachedRefs.some(r => r.model === l.ref.model && r.id === l.ref.id))
      .map(l => ({ ref: l.ref, normalized_job_no: l.normalized_job_no, normalized_phone: l.normalized_phone })), asOf),
    readLeadBookings(leadRows),
    readVantageSideContext(calls.calls, leads),
    readCanonicalSummaries(conversations),
    getIntelligenceFindingModel().find(findingFilter).select("run_id conversation_id kind assertion review_state superseded_by resolved purged_at").sort({ _id: 1 }).limit(501).lean(),
    recordIds.length ? getOutreachFollowupModel().find({ outreach_record_id: { $in: recordIds }, createdAt: { $lte: asOf } }).sort({ _id: 1 }).limit(501).lean() : Promise.resolve([]),
    subjectKeys.length ? getSalesIntelligenceReviewItemModel().find({ subject_key: { $in: subjectKeys }, state: "open" }).select("cause_kind").sort({ _id: 1 }).limit(101).lean() : Promise.resolve([]),
    numberId && !edges.some(e => e.state === "attached") ? findLeadCandidates(subject, { window_anchor: asOf }) : Promise.resolve([] as LeadCandidate[]),
    synthesisCovers(input.prior),
  ]);
  const events: StoryEvent[] = [];
  const seen = new Set<string>();
  for (const [name, result] of results) {
    if (result.truncated) truncated.push(name);
    for (const event of result.events) {
      const key = `${event.kind}:${event.id}`;
      if (seen.has(key) || Date.parse(event.happened_at) > +asOf) continue;
      seen.add(key);
      events.push(event);
    }
  }
  if (findingRows.length > 500) truncated.push("findings");
  if (followupRows.length > 500) truncated.push("followups");
  if (granot.some(g => g.truncated)) truncated.push("granot_observations");

  const summaries = new Map<string, CaseSummary>(canonical);
  for (const [conversation, captured] of input.summaries) summaries.set(conversation, { conversation_id: conversation, summary: captured.summary, source: "captured" });
  const agentIds = [...new Set([...recordRows.flatMap(r => (r.responsible_agent_id ? [String(r.responsible_agent_id)] : [])),
    ...leads.flatMap(l => (l.receiver?.agent_id ? [l.receiver.agent_id] : []))])].filter(id => mongoose.isValidObjectId(id));
  const agentRows = agentIds.length ? await db().collection("agents").find({ _id: { $in: agentIds.map(oid) } }, { projection: { name: 1 } }).toArray() : [];

  const findings: CaseFinding[] = (findingRows as unknown as Array<{ _id: unknown; run_id?: unknown; conversation_id?: unknown; kind: string; review_state?: string; superseded_by?: unknown;
    resolved?: { due_at?: Date | null } | null; purged_at?: Date | null; assertion?: { claim?: string; action_status?: string | null; evidence?: Array<{ source?: string; segment_ids?: number[] }> } }>)
    .slice(0, 500).map(f => ({ id: String(f._id), run_id: f.run_id ? String(f.run_id) : null, conversation_id: f.conversation_id ? String(f.conversation_id) : null, kind: f.kind,
      claim: String(f.assertion?.claim ?? ""), action_status: f.assertion?.action_status ?? null, review_state: f.review_state ?? "unreviewed",
      superseded_by: f.superseded_by ? String(f.superseded_by) : null, resolved_due_at: iso(f.resolved?.due_at), purged: Boolean(f.purged_at),
      segment_ids: [...new Set((f.assertion?.evidence ?? []).filter(e => e.source === "transcript").flatMap(e => e.segment_ids ?? []))].sort((a, b) => a - b) }));
  const followups: CaseFollowup[] = (followupRows as unknown as Array<Record<string, unknown> & { _id: unknown }>).slice(0, 500).map(f => ({
    id: String(f._id), record_id: String(f.outreach_record_id), kind: String(f.kind), description: str(f.description), due_at: iso(f.due_at),
    precision: str((f.date_resolution as { precision?: string } | null | undefined)?.precision), origin: String(f.origin), status: String(f.status),
    completion_basis: str(f.completion_basis), disposition: str(f.disposition), completed_at: iso(f.completed_at), created_at: iso(f.createdAt),
    source_finding_ids: ((f.source_finding_ids as unknown[]) ?? []).map(String), commitment_key: str(f.commitment_key), cancel_reason: str(f.cancel_reason),
    supersedes_id: f.supersedes_id ? String(f.supersedes_id) : null, missed_episode_key: str(f.missed_episode_key),
    evidence_interaction_id: f.evidence_interaction_id ? String(f.evidence_interaction_id) : null,
    anchor_at: iso((f.date_resolution as { anchor?: unknown } | null | undefined)?.anchor)
      ?? (f.source_interaction_id ? calls.calls.find(c => c.id === String(f.source_interaction_id))?.started_at ?? null : null) }));
  const caseRecords: CaseRecord[] = recordRows.slice(0, 100).map(r => ({ id: String(r._id), subject: { kind: r.subject.kind, model: r.subject.model ?? null, id: r.subject.id ? String(r.subject.id) : null },
    state: r.state, closed_reason: str(r.closed_reason), closure_origin: str(r.closure_origin), responsible_agent_id: r.responsible_agent_id ? String(r.responsible_agent_id) : null,
    assignment: r.assignment ? { origin: r.assignment.origin, assigned_at: iso(r.assignment.assigned_at) } : null, wait_until: iso(r.wait_until) }));
  const caseConversations: CaseConversation[] = conversations.map(c => ({ id: String(c._id), call_interaction_id: c.call_interaction_id ? String(c.call_interaction_id) : null,
    started_at: c.started_at.toISOString(), direction: c.direction ?? null, duration_seconds: typeof c.duration_seconds === "number" ? c.duration_seconds : null,
    lead_ref: c.lead_ref ? { model: c.lead_ref.model, id: String(c.lead_ref.id) } : null, state: c.state ?? null }));

  return {
    version: CASE_FILE_VERSION, audience: input.audience, as_of: asOf.toISOString(), timezone: CASE_FILE_TIMEZONE, contact_number_id: numberId, e164: number?.e164 ?? subject.e164,
    provider_names: number?.provider_names ?? [], leads, edges, candidates: JSON.parse(JSON.stringify(candidates)), events: JSON.parse(JSON.stringify(events)), granot,
    calls: calls.calls, vantage, conversations: caseConversations, summaries: [...summaries.values()].sort((a, b) => (a.conversation_id < b.conversation_id ? -1 : 1)),
    focus_conversation_ids: input.focus_conversation_ids, findings, followups, allowed_followup_ids: input.allowed_followup_ids ? [...input.allowed_followup_ids] : null,
    records: caseRecords, agents: Object.fromEntries(agentRows.map(a => [String(a._id), String((a as { name?: unknown }).name ?? "")])),
    restrictions: (restrictionRows as unknown as Array<{ channels?: string[]; until?: Date | null }>).map(r => ({ channels: [...(r.channels ?? [])], until: iso(r.until) })),
    reviews_open: (reviewRows as unknown as Array<{ cause_kind: string }>).map(r => ({ cause_kind: r.cause_kind })),
    bookings: [...bookings.entries()].map(([key, b]) => ({ lead_key: key, id: String(b._id), job_no: str(b.job_no), book_date: iso(b.book_date),
      deposit_amount: typeof b.deposit_amount === "number" ? b.deposit_amount : null, total_binder_amount: typeof b.total_binder_amount === "number" ? b.total_binder_amount : null })),
    prior: input.prior, synthesis_covers: covers, coverage: coverage ?? null, truncated_sources: [...new Set(truncated)].sort(), evidence_lines: input.evidence_lines ?? {},
    staffing: { timezone: policy.timezone, staffed_hours: policy.staffed_hours },
  };
}

/** The full pipeline: read (above), build (pure), budget (pure). */
export async function assembleCaseFile(input: CaseFileInput): Promise<AssembledCaseFile> {
  const sources = await assembleCaseFileSources(input);
  const file = buildCaseFile(sources);
  return { sources, file, rendered: applyCaseFileBudget(file) };
}

/**
 * A `CaseFileInput` for a subject outside a findings run (the Move assessment, tooling): the Number
 * and/or Lead, the Outreach record, and the Prior Analysis page selected exactly as a run selects it.
 */
export async function caseFileInputFor(input: { contact_number_id: string | null; e164?: string | null; lead_ref?: StoryLeadRef | null; outreach_record_id?: string | null;
  subject_key?: string; as_of: Date; audience: CaseFileAudience; prior?: ReadContent | null; focus_conversation_ids?: string[] | null;
  evidence_lines?: CaseFileInput["evidence_lines"]; coverage?: CaseFileInput["coverage"] }): Promise<CaseFileInput> {
  const coverage = input.coverage !== undefined ? input.coverage : await readCaptureCoverage();
  const prior = input.prior !== undefined ? input.prior : input.contact_number_id ? await selectPriorAnalyses({ contact_number_id: input.contact_number_id,
    subject_key: input.subject_key ?? `number:${input.contact_number_id}`, outreach_record_id: input.outreach_record_id ?? null, exclude_conversation_id: null, as_of: input.as_of }, coverage ?? await readCaptureCoverage()) : null;
  return { contact_number_id: input.contact_number_id, e164: input.e164 ?? null, lead_refs: input.lead_ref ? [input.lead_ref] : [],
    outreach_record_ids: input.outreach_record_id ? [input.outreach_record_id] : [], conversation_ids: [], focus_conversation_ids: input.focus_conversation_ids ?? [],
    summaries: new Map(), prior, as_of: input.as_of, timezone: CASE_FILE_TIMEZONE, audience: input.audience, coverage, evidence_lines: input.evidence_lines };
}
