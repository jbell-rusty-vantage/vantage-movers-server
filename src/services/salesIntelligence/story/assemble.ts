import mongoose from "mongoose";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getLeadConversationModel } from "../../../models/LeadConversation";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { toObjectId } from "../../../utils/objectId";
import { normalizePhoneNumberForMatch } from "../../../utils/phone";
import { redactTranscript } from "../../conversations/redaction";
import { payloadHash } from "../transactions";
import { boundModelPage, collapseEvents, kindOrder } from "./catalog";
import { findLeadCandidates, type CandidateDeps } from "./candidates";
import { granotLeadStates } from "./granot";
import { formatDate, renderSentence, renderStoryProse, renderTail, type RenderContext } from "./prose";
import { leadCustomerName, leadSourceLabel, mergeConversationsIntoCalls, readLeadRows, readStoryContactNumber, STORY_SOURCES, type LeadRow } from "./sources";
import type { LeadCandidate, StoryCoverage, StoryEvent, StoryLeadRef, StoryOptions, StorySubject, SubjectStory } from "./types";

/**
 * Assemble one Subject Story (context provenance specification §4): resolve the subject once,
 * fan every reader out in one `Promise.all`, merge on `(happened_at, kind_order, id)`, dedupe,
 * bound, collapse, render. Deterministic for a fixed database state and `as_of`. Read only.
 */
export type StoryDeps = Pick<CandidateDeps, "stated_name" | "reference_mentions">;
export const DEFAULT_STORY_OPTIONS: StoryOptions = { limit_events: 400, model_events: 80, timezone: "America/New_York" };
const MAX_LIMIT_EVENTS = 400, MAX_MODEL_EVENTS = 80;
const CONTACT_KINDS = new Set(["call", "call_attempts", "lead_message_sent", "conversation_recorded"]);
const EDGE_ORDER: Record<string, number> = { attached: 0, ambiguous: 1, candidate: 2 };
const oid = toObjectId;
const sameRef = (a: StoryLeadRef, b: StoryLeadRef) => a.model === b.model && a.id === b.id;
const compareEvents = (a: StoryEvent, b: StoryEvent) =>
  Date.parse(a.happened_at) - Date.parse(b.happened_at) || kindOrder(a.kind) - kindOrder(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const clean = (value: unknown, max: number) => {
  const s = redactTranscript(String(value ?? "")).text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

type Edge = { lead_ref: StoryLeadRef; state: "candidate" | "ambiguous" | "attached" | "rejected"; certainty: string };
type Resolved = { subject: StorySubject; edges: Edge[]; number: { e164: string; provider_names: string[] } | null };

/** Widen a subject with everything the Contact Number (or the Lead) is joined to. Rejected edges never enter. */
async function resolveScope(input: StorySubject): Promise<Resolved> {
  const subject: StorySubject = { ...input, lead_refs: [...input.lead_refs], outreach_record_ids: [...input.outreach_record_ids], conversation_ids: [...input.conversation_ids] };
  let edges: Edge[] = [];
  let number: Resolved["number"] = null;
  if (subject.contact_number_id && mongoose.isValidObjectId(subject.contact_number_id)) {
    const numberId = oid(subject.contact_number_id);
    const [numberRow, edgeRows, records, conversations] = await Promise.all([
      readStoryContactNumber(subject.contact_number_id),
      getNumberLeadAttachmentModel().find({ contact_number_id: numberId, state: { $ne: "rejected" } }).select("lead_ref state certainty").sort({ _id: 1 }).limit(101).lean(),
      getOutreachRecordModel().find({ primary_contact_number_id: numberId }).select("_id").sort({ _id: 1 }).limit(101).lean(),
      getLeadConversationModel().find({ contact_number_id: numberId, started_at: { $lte: subject.as_of } }).select("_id").sort({ started_at: -1, _id: -1 }).limit(101).lean(),
    ]);
    number = numberRow;
    subject.e164 = numberRow?.e164 ?? subject.e164;
    edges = edgeRows.map(e => ({ lead_ref: { model: e.lead_ref.model, id: String(e.lead_ref.id) }, state: e.state, certainty: e.certainty }))
      .sort((a, b) => (EDGE_ORDER[a.state] ?? 9) - (EDGE_ORDER[b.state] ?? 9) || a.lead_ref.id.localeCompare(b.lead_ref.id));
    const attached = edges.filter(e => e.state === "attached").map(e => e.lead_ref);
    const others = [...subject.lead_refs, ...edges.filter(e => e.state !== "attached").map(e => e.lead_ref)];
    subject.lead_refs = [...attached, ...others].filter((ref, index, all) => all.findIndex(r => sameRef(r, ref)) === index).slice(0, 100);
    subject.outreach_record_ids = [...new Set([...subject.outreach_record_ids, ...records.map(r => String(r._id))])].slice(0, 100);
    subject.conversation_ids = [...new Set([...subject.conversation_ids, ...conversations.map(c => String(c._id))])].slice(0, 100);
  } else if (subject.lead_refs.length) {
    // A Lead-only subject: its own Outreach record and conversations, no number.
    const [records, conversations] = await Promise.all([
      Promise.all(subject.lead_refs.filter(r => mongoose.isValidObjectId(r.id)).map(r => getOutreachRecordModel().findOne({ "subject.kind": "lead", "subject.model": r.model, "subject.id": oid(r.id) }).select("_id").lean())),
      Promise.all(subject.lead_refs.filter(r => mongoose.isValidObjectId(r.id)).map(r => getLeadConversationModel().find({ "lead_ref.model": r.model, "lead_ref.id": oid(r.id), started_at: { $lte: subject.as_of } }).select("_id").sort({ started_at: -1 }).limit(50).lean())),
    ]);
    subject.outreach_record_ids = [...new Set([...subject.outreach_record_ids, ...records.flatMap(r => (r ? [String(r._id)] : []))])].slice(0, 100);
    subject.conversation_ids = [...new Set([...subject.conversation_ids, ...conversations.flat().map(c => String(c._id))])].slice(0, 100);
  }
  return { subject, edges, number };
}

const toE164 = (phone: string): string | null => {
  const digits = normalizePhoneNumberForMatch(phone);
  if (!digits) return null;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
};

/** Resolve a phone, Contact Number id or Lead into a story subject; null when nothing matches. */
export async function resolveStorySubject(input: { phone?: string; contact_number_id?: string; lead?: StoryLeadRef; as_of?: Date }): Promise<StorySubject | null> {
  const as_of = input.as_of ?? new Date();
  const base: StorySubject = { contact_number_id: null, e164: null, lead_refs: [], outreach_record_ids: [], conversation_ids: [], as_of, focus: null };
  if (input.contact_number_id) {
    const number = await readStoryContactNumber(input.contact_number_id);
    if (!number) return null;
    base.contact_number_id = input.contact_number_id; base.e164 = number.e164;
  } else if (input.phone) {
    const e164 = toE164(input.phone);
    const row = e164 ? await getContactNumberModel().findOne({ e164, purged_at: null }).select("e164").lean() : null;
    if (!row) return null;
    base.contact_number_id = String(row._id); base.e164 = row.e164;
  } else if (input.lead && mongoose.isValidObjectId(input.lead.id)) {
    base.lead_refs.push({ model: input.lead.model, id: input.lead.id });
    const [edge] = await getNumberLeadAttachmentModel().find({ "lead_ref.model": input.lead.model, "lead_ref.id": oid(input.lead.id), state: "attached" }).select("contact_number_id").sort({ _id: -1 }).limit(1).lean();
    const number = edge ? await readStoryContactNumber(String(edge.contact_number_id)) : null;
    if (edge && number) { base.contact_number_id = String(edge.contact_number_id); base.e164 = number.e164; }
  } else return null;
  return (await resolveScope(base)).subject;
}

const leadClause = (lead: LeadRow, timezone: string) => {
  const name = leadCustomerName(lead);
  const parts = [`${lead.model === "FormLead" ? "Form Lead" : "Call Lead"}${name ? ` ${clean(name, 60)}` : ""}`, clean(leadSourceLabel(lead) ?? "source unknown", 60),
    `received ${formatDate(lead.timestamp instanceof Date ? lead.timestamp.toISOString() : null, timezone, false)}`, ...(lead.job_no ? [`Job ${clean(lead.job_no, 30)}`] : []), ...(lead.duplicate ? ["duplicate"] : [])];
  return parts.join(", ");
};
const candidateClause = (c: LeadCandidate, timezone: string) => [`${c.lead_ref.model === "FormLead" ? "Form Lead" : "Call Lead"}${c.name ? ` ${c.name}` : ""}`, c.source_company_label ?? "source unknown",
  `received ${formatDate(c.received_at, timezone, false)}`, ...(c.job_no ? [`Job ${c.job_no}`] : []), ...(c.duplicate ? ["duplicate"] : [])].join(", ");

/** Customer label for the prose (Lead name → Granot name → caller ID → "the caller"); the Owner timeline adapter reuses it. */
export function customerLabel(leads: readonly LeadRow[], attachedRefs: readonly StoryLeadRef[], number: Pick<NonNullable<Resolved["number"]>, "provider_names"> | null): string {
  const ordered = [...attachedRefs.flatMap(ref => leads.filter(l => l.model === ref.model && String(l._id) === ref.id)), ...leads];
  for (const lead of ordered) { const name = leadCustomerName(lead); if (name) return clean(name, 80); }
  const callerId = number?.provider_names.find(n => n.trim());
  return callerId ? `${clean(callerId, 60)} (caller ID)` : "the caller";
}

export async function assembleSubjectStory(input: StorySubject, options: Partial<StoryOptions> = {}, deps: StoryDeps = {}): Promise<SubjectStory> {
  const limit_events = Math.min(MAX_LIMIT_EVENTS, Math.max(1, Math.trunc(options.limit_events ?? DEFAULT_STORY_OPTIONS.limit_events)));
  const model_events = Math.min(MAX_MODEL_EVENTS, Math.max(1, Math.trunc(options.model_events ?? DEFAULT_STORY_OPTIONS.model_events)));
  const timezone = options.timezone ?? DEFAULT_STORY_OPTIONS.timezone;
  const { subject, edges, number } = await resolveScope(input);
  const attachedRefs = edges.filter(e => e.state === "attached").map(e => e.lead_ref);
  const hasAttached = attachedRefs.length > 0;
  const ambiguous = edges.filter(e => e.state === "ambiguous" || e.state === "candidate");
  const wantCandidates = subject.contact_number_id !== null && !hasAttached;
  const recordIds = subject.outreach_record_ids.filter(id => mongoose.isValidObjectId(id)).map(oid);

  const [results, leads, granot, candidates, openFollowups] = await Promise.all([
    Promise.all(Object.entries(STORY_SOURCES).map(async ([name, source]) => [name, await source(subject, limit_events)] as const)),
    readLeadRows(subject.lead_refs),
    granotLeadStates(subject),
    wantCandidates ? findLeadCandidates(subject, { ...deps, window_anchor: subject.as_of }) : Promise.resolve([] as LeadCandidate[]),
    recordIds.length ? getOutreachFollowupModel().find({ outreach_record_id: { $in: recordIds }, status: "open" }).select("kind description due_at").sort({ due_at: 1, _id: 1 }).limit(20).lean() : Promise.resolve([]),
  ]);

  const coverage: StoryCoverage = { sources: {}, dropped_from_model_page: 0, from: null, to: null };
  const seen = new Set<string>();
  let merged: StoryEvent[] = [];
  for (const [name, result] of results) {
    coverage.sources[name] = { read: result.read, truncated: result.truncated };
    for (const event of result.events) {
      const key = `${event.kind}:${event.id}`;
      if (seen.has(key) || Date.parse(event.happened_at) > +subject.as_of || Number.isNaN(Date.parse(event.happened_at))) continue;
      seen.add(key);
      merged.push(event);
    }
  }
  merged.sort(compareEvents);
  merged = mergeConversationsIntoCalls(merged);
  if (merged.length > limit_events) {
    coverage.sources.total = { read: limit_events, truncated: true };
    merged = merged.slice(merged.length - limit_events);
  }
  const focusId = subject.focus?.conversation_id ?? null;
  if (focusId) for (const event of merged) if (event.detail.conversation_id === focusId || ((event.kind === "conversation_recorded" || event.kind === "conversation_analyzed") && event.id.endsWith(`:${focusId}`))) event.focus = true;
  coverage.from = merged[0]?.happened_at ?? null;
  coverage.to = merged[merged.length - 1]?.happened_at ?? null;

  const collapsed = collapseEvents(merged);
  const page = boundModelPage(collapsed, model_events, focusId);
  coverage.dropped_from_model_page = page.dropped;
  const ctx: RenderContext = { timezone, customer: customerLabel(leads, attachedRefs, number), phone: subject.e164, lead_count: subject.lead_refs.length };
  const events = page.kept.map(event => ({ ...event, sentence: renderSentence(event, ctx) }));

  const who = ctx.phone ? `${ctx.customer} (${ctx.phone})` : ctx.customer;
  const sentences: string[] = [];
  const truncated = Object.values(coverage.sources).some(s => s.truncated);
  if (truncated && coverage.from) sentences.push(`History before ${formatDate(coverage.from, timezone)} is not shown.`);
  if (subject.contact_number_id === null) {
    sentences.push(leads.length ? `${who} — ${leads.length} Lead${leads.length === 1 ? "" : "s"}, no Contact Number: ${leads.map(l => leadClause(l, timezone)).join("; ")}.` : `${who} — no Lead and no Contact Number resolved.`);
  } else if (hasAttached) {
    const attachedLeads = attachedRefs.flatMap(ref => leads.filter(l => l.model === ref.model && String(l._id) === ref.id));
    sentences.push(`${who} — ${attachedRefs.length} Lead${attachedRefs.length === 1 ? "" : "s"} attached: ${attachedLeads.map(l => leadClause(l, timezone)).join("; ") || "details unavailable"}.`);
  } else if (ambiguous.length) {
    const ambiguousLeads = ambiguous.flatMap(e => leads.filter(l => l.model === e.lead_ref.model && String(l._id) === e.lead_ref.id));
    sentences.push(`Attachment is ambiguous between ${ambiguous.length} Lead${ambiguous.length === 1 ? "" : "s"}: ${ambiguousLeads.map(l => leadClause(l, timezone)).join("; ") || "details unavailable"}.`);
  } else if (candidates.length) {
    const bases = [...new Set(candidates.flatMap(c => c.basis.map(b => b.split(":")[0]!)))].sort().join(", ");
    sentences.push(`No Lead is attached; ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} by ${bases}: ${candidates.map(c => candidateClause(c, timezone)).join("; ")}.`);
  } else sentences.push("No Lead is attached to this number.");
  const opening = sentences.join(" ");

  const lastContact = [...merged].reverse().find(e => CONTACT_KINDS.has(e.kind));
  const tail = renderTail({ last_contact_at: lastContact ? (lastContact.kind === "call_attempts" && typeof lastContact.detail.to === "string" ? lastContact.detail.to : lastContact.happened_at) : null,
    as_of: subject.as_of.toISOString(),
    open_followups: openFollowups.map(f => ({ kind: f.kind ?? null, description: f.description ?? null, due_at: f.due_at instanceof Date ? f.due_at.toISOString() : null })) }, { timezone });
  const prose = renderStoryProse({ opening, events, tail }, { timezone });
  return { as_of: subject.as_of.toISOString(), subject, opening, events, tail, prose, coverage, candidates, granot,
    digest: payloadHash({ events, candidates, granot, opening, tail }) };
}
