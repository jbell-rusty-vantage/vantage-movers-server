import type { ReadContent } from "../../analysis/reads";
import type { SummaryStep } from "../../analysis/structuredContract";
import { defaultCsiPolicy } from "../../policy";
import type { LeadCandidate, StoryEvent, StoryLeadRef } from "../../story/types";
import { CASE_FILE_TIMEZONE, CASE_FILE_VERSION, type CaseCall, type CaseConversation, type CaseFileSources, type CaseFinding, type CaseFollowup, type CaseLead,
  type CaseRecord, type GranotObservationFacts, type VantageSideContext } from "../types";

/**
 * K5 golden fixtures (spec §4.14): six `CaseFileSources`, built in memory with fixed ids and fixed
 * instants, shaped exactly like the timeline-mode readers and the Case File readers return them.
 * Fake names and 555 numbers only.
 */
export const AS_OF = "2026-09-23T20:10:00.000Z";
const NUMBER = "6c0000000000000000000001", E164 = "+17575550143", ACCOUNT = "acct-synthetic";
const hex = (n: number) => `6c00000000000000000${String(n).padStart(5, "0")}`;
const at = (iso: string, plusMs = 0) => new Date(Date.parse(iso) + plusMs).toISOString();
const coverage: ReadContent["coverage"] = { known_through: "2026-09-23T20:05:00.000Z", gaps: [], capabilities: {}, ai_paused: false };
const staffing = (() => { const p = defaultCsiPolicy(); return { timezone: p.timezone, staffed_hours: p.staffed_hours }; })();

export function emptyVantage(): VantageSideContext {
  return { links: [
    { id: hex(901), revision: 1, agent_id: hex(801), agent_name: "Jordan Bell", rc_account_id: ACCOUNT, rc_extension_id: "e104", rc_extension_number: "104", rc_extension_name: "Jordan Bell",
      role_kind: "sales_rep", status: "reviewed", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null, reviewed_at: "2026-01-02T00:00:00.000Z", reviewed_by: "owner" },
    { id: hex(902), revision: 1, agent_id: hex(802), agent_name: "Mike Rivera", rc_account_id: ACCOUNT, rc_extension_id: "e118", rc_extension_number: "118", rc_extension_name: "Mike R.",
      role_kind: "sales_rep", status: "proposed", effective_from: "2026-01-01T00:00:00.000Z", effective_to: null, reviewed_at: null, reviewed_by: null },
  ], directories: [{ account_id: ACCOUNT, taken_at: "2026-09-20T00:00:00.000Z", extensions: { e104: { name: "Jordan Bell", extension_number: "104" },
    e118: { name: "Mike R.", extension_number: "118" } }, queues: { q900: { name: "Sales", extension_number: "900" } } }],
  routes: [{ id: hex(701), phone_number: "+18885550100", display_label: "Top10", queue_name: "Top10 Sales" }], call_leads: [] };
}

export function base(over: Partial<CaseFileSources> = {}): CaseFileSources {
  return { version: CASE_FILE_VERSION, audience: "findings", as_of: AS_OF, timezone: CASE_FILE_TIMEZONE, contact_number_id: NUMBER, e164: E164, provider_names: ["M LOPEZ"],
    leads: [], edges: [], candidates: [], events: [], granot: [], calls: [], vantage: emptyVantage(), conversations: [], summaries: [], focus_conversation_ids: null,
    findings: [], followups: [], allowed_followup_ids: null, records: [], agents: { [hex(801)]: "Jordan Bell" }, restrictions: [], reviews_open: [], bookings: [], prior: null,
    synthesis_covers: null, coverage, truncated_sources: [], evidence_lines: {}, staffing, ...over };
}

const views = (move: { pickup?: [string, string, string]; delivery?: [string, string, string]; date?: string; size?: string } | null, original = true) => {
  const endpoint = (e?: [string, string, string]) => ({ city: e?.[0] ?? null, state: e?.[1] ?? null, zip: e?.[2] ?? null });
  const view = { pickup: endpoint(move?.pickup), delivery: endpoint(move?.delivery), move_date: move?.date ?? null, move_size: move?.size ?? null, granot_move_size: null, cubic_feet: null, provenance: null };
  return { canonical_current: view, original_ingestion: original && move ? { ...view, captured_at: null, evidence_status: "captured_at_ingestion", ingestion_origin: "wordpress_form",
    label: "original_form_submission" as const } : null };
};
export function formLead(n: number, over: Partial<CaseLead> = {}): CaseLead {
  return { ref: { model: "FormLead", id: hex(n) }, name: "Maria Lopez", granot_contact_name: null, received_at: "2026-09-15T22:30:00.000Z", created_at: "2026-09-15T22:30:20.000Z",
    source_label: "Top10", job_no: "84521", normalized_job_no: "84521", normalized_phone: "7575550143", duplicate: false, bad_lead: false, no_sync: false, booked: false, cancelled: false,
    granot_priority: "1", quoted: true, ingestion_origin: "wordpress_form", receiver: { agent_id: hex(801), name: "Jordan Bell", source: "granot_username_match", set_at: "2026-09-17T15:20:00.000Z" },
    move: views({ pickup: ["Norfolk", "VA", "23510"], delivery: ["Raleigh", "NC", "27601"], date: "2026-10-10", size: "2 Bedrooms" }), ringcentral: null, ...over };
}

const leadKey = (ref: StoryLeadRef) => `lead:${ref.model}:${ref.id}`;
const actor = (kind: StoryEvent["actor"]["kind"], name: string | null = null, identity: StoryEvent["actor"]["identity_status"] = null): StoryEvent["actor"] =>
  ({ kind, agent_id: null, name, identity_status: identity });
function event(kind: StoryEvent["kind"], id: string, happened: string, subject: string, detail: Record<string, unknown>, observed = happened, who = actor("vantage")): StoryEvent {
  return { id: `${kind}:${id}`, kind, happened_at: happened, observed_at: observed, subject_key: subject, actor: who, record: { record_type: "story_event", record_id: `${kind}:${id}` },
    sentence: "", detail, evidence_refs: [`${kind}:${id}`] };
}
export function leadReceived(lead: CaseLead): StoryEvent {
  return event("lead_received", lead.ref.id, lead.received_at!, leadKey(lead.ref), { model: lead.ref.model, lead_ref: lead.ref, customer_name: lead.name,
    source_company_label: lead.source_label, job_no: lead.job_no, duplicate: lead.duplicate, bad_lead: lead.bad_lead, no_sync: lead.no_sync }, lead.created_at!, actor("customer", lead.name));
}
export function attached(lead: CaseLead, when: string, reason = "sole phone match"): StoryEvent {
  return event("number_attached", `${hex(600 + Number(lead.ref.id.slice(-3)))}:0`, when, leadKey(lead.ref), { lead_ref: lead.ref, state: "attached", certainty: "exact", reason, decided_by: "automatic" });
}
export function message(n: number, lead: CaseLead, when: string): StoryEvent {
  return event("lead_message_sent", hex(n), when, `number:${NUMBER}`, { purpose: "quote_request_confirmation", status: "delivered", delivered_at: at(when, 15_000), origin: "public_form", lead_ref: lead.ref });
}
export type CallSpec = { n: number; when: string; direction: "Inbound" | "Outbound"; ext?: string | null; connected?: boolean; human?: boolean; seconds?: number; result?: string;
  conversation?: number | null; late?: boolean; company?: string | null; queue?: boolean };
export function call(spec: CallSpec): { call: CaseCall; event: StoryEvent; conversation: CaseConversation | null } {
  const connected = spec.connected ?? Boolean(spec.human);
  const ext = spec.ext === undefined ? "e104" : spec.ext;
  const parties = [{ role: "external", extension_id: null, extension_number: null, name_raw: "M LOPEZ", connected },
    ...(spec.queue ? [{ role: "queue", extension_id: "q900", extension_number: "900", name_raw: null, connected: false }, { role: "user", extension_id: "e104", extension_number: "104", name_raw: null, connected: false }] : []),
    ...(ext ? [{ role: "user", extension_id: ext, extension_number: ext.slice(1), name_raw: null, connected }] : [])];
  const record: CaseCall = { id: hex(spec.n), provider_account_id: ACCOUNT, telephony_session_id: `sess-${spec.n}`, direction: spec.direction, started_at: spec.when,
    company_e164: spec.company === undefined ? "+18885550100" : spec.company, inbound_route_id: null, parties, queue_fanout: Boolean(spec.queue), transfer: false,
    duration_seconds: spec.seconds ?? (connected ? 252 : 30), provider_result: spec.result ?? (connected ? "Call connected" : "No Answer"), provider_connected: connected,
    contact_type: spec.human ? "human_conversation" : "unknown", recording_count: spec.conversation ? 1 : 0 };
  const conversationId = spec.conversation ? hex(spec.conversation) : null;
  const ev = event("call", hex(spec.n), spec.when, `number:${NUMBER}`, { interaction_id: hex(spec.n), direction: spec.direction, provider_result: record.provider_result,
    provider_connected: connected, contact_type: record.contact_type, contact_type_basis: null, duration_seconds: record.duration_seconds, recording_count: record.recording_count,
    rep: { agent_id: null, name: null, status: "unknown", extension: ext ? ext.slice(1) : null }, transfer: false, queue_fanout: Boolean(spec.queue), account_id: ACCOUNT,
    conversation_id: conversationId, analyzed_conversation_id: conversationId, recording_state: conversationId ? "analyzed" : "none" },
  spec.late ? at(spec.when, 3 * 3_600_000) : at(spec.when, 40_000), spec.direction === "Inbound" ? actor("customer") : actor("rep"));
  const conversation = conversationId ? { id: conversationId, call_interaction_id: hex(spec.n), started_at: spec.when, direction: spec.direction, duration_seconds: record.duration_seconds,
    lead_ref: null, state: "complete" } : null;
  return { call: record, event: ev, conversation };
}
export function summary(overview: string, extra: Partial<SummaryStep["summary"]> = {}, said: SummaryStep["said_on_call"] = []): SummaryStep {
  return { summary: { overview, customer_wanted: "", money_and_dates: "", outcome: "", commitments: "", discrepancies: "", ...extra }, said_on_call: said };
}
export function promise(claim: string, segment: number, speaker: "rep" | "customer" = "rep", kind: "promised_callback" | "customer_requested_callback" = "promised_callback"): SummaryStep["said_on_call"][number] {
  return { kind, claim, value: { action_kind: "call", description: claim, date_text: null, timezone_text: null, target_followup_id: null }, actor: speaker, clarity: "clear",
    action_status: speaker === "rep" ? "promised" : "requested", speaker, segment_ids: [segment], quote: null } as SummaryStep["said_on_call"][number];
}
export function fact(claim: string, segment: number, speaker: "rep" | "customer" = "customer"): SummaryStep["said_on_call"][number] {
  return { kind: "objection", claim, value: { description: claim }, actor: speaker, clarity: "clear", action_status: null, speaker, segment_ids: [segment], quote: null } as SummaryStep["said_on_call"][number];
}
export function followup(n: number, over: Partial<CaseFollowup> = {}): CaseFollowup {
  return { id: hex(n), record_id: hex(500), kind: "call", description: "Call back Monday after 5 PM", due_at: "2026-09-21T21:00:00.000Z", precision: "exact", origin: "rep_promise",
    status: "open", completion_basis: null, disposition: null, completed_at: null, created_at: "2026-09-17T14:30:00.000Z", source_finding_ids: [], commitment_key: `commitment:${n}`,
    cancel_reason: null, supersedes_id: null, missed_episode_key: null, ...over };
}
export function followupEvents(f: CaseFollowup): StoryEvent[] {
  const detail = { followup_id: f.id, outreach_record_id: f.record_id, kind: f.kind, description: f.description, due_at: f.due_at, origin: f.origin, status: f.status,
    completion_basis: f.completion_basis, disposition: f.disposition, source_finding_ids: f.source_finding_ids };
  const out = [event("followup_created", f.id, f.created_at!, `lead:FormLead:${hex(1)}`, detail, f.created_at!, actor(f.origin === "owner" ? "owner" : "rep"))];
  if (f.status === "completed" && f.completed_at) out.push(event("followup_completed", f.id, f.completed_at, `lead:FormLead:${hex(1)}`, detail));
  return out;
}
export function record(over: Partial<CaseRecord> = {}): CaseRecord {
  return { id: hex(500), subject: { kind: "lead", model: "FormLead", id: hex(1) }, state: "open", closed_reason: null, closure_origin: null, responsible_agent_id: hex(801),
    assignment: { origin: "first_conversation", assigned_at: "2026-09-17T14:10:00.000Z" }, wait_until: null, ...over };
}
export function observation(n: number, when: string, values: Partial<GranotObservationFacts["values"]>): GranotObservationFacts {
  return { id: hex(n), kind: "lead_snapshot", captured_at: when, observed_at: at(when, 5_000), source_label: "top10",
    values: { priority: null, estimate: null, payment: null, balance: null, move_date: null, move_size: null, cubic_feet: null, service_type: null, pickup: null, delivery: null,
      user_raw: null, rep_raw: null, ...values } };
}
export function priorityChange(n: number, lead: CaseLead, when: string, from: string | null, to: string, rep: string | null): StoryEvent {
  return event("granot_priority_changed", hex(n), when, leadKey(lead.ref), { lead_ref: lead.ref, from, to, granot_rep_raw: rep, change_id: hex(n), observation_id: null, source_system: "granot",
    applied_at: at(when, 60_000) }, at(when, 60_000), actor("granot", rep));
}
export function finding(n: number, conversation: number, kind: string, claim: string, segments: number[], over: Partial<CaseFinding> = {}): CaseFinding {
  return { id: hex(n), run_id: hex(400), conversation_id: hex(conversation), kind, claim, action_status: "promised", review_state: "unreviewed", superseded_by: null,
    resolved_due_at: null, segment_ids: segments, purged: false, ...over };
}
export function priorPage(records: ReadContent["page"]["records"], missing: string[] = []): ReadContent {
  return { page: { records, next_cursor: null, complete: !missing.length, missing_ranges: missing }, coverage, allowed_followup_ids: [], instructions: [], speaker_refs: [] };
}

// ---------------------------------------------------------------------------------------------
// The six fixtures
// ---------------------------------------------------------------------------------------------

/** 1. A Form Lead with one call (a conversation run on C0). */
export function formLeadOneCall(): CaseFileSources {
  const lead = formLead(1);
  const c0 = call({ n: 11, when: "2026-09-17T14:04:00.000Z", direction: "Outbound", human: true, conversation: 21 });
  const said = [promise("Rep promised to email the estimate today.", 3), promise("Rep promised to call back Monday after 5 PM.", 4), fact("Customer said her husband decides.", 5)];
  const f = followup(31, { source_finding_ids: [hex(41)] });
  return base({
    leads: [lead], edges: [{ lead_ref: lead.ref, state: "attached", certainty: "exact", reason: "sole phone match", decided_by: "automatic" }],
    events: [leadReceived(lead), message(51, lead, "2026-09-15T22:31:00.000Z"), attached(lead, "2026-09-15T22:35:00.000Z"), c0.event, ...followupEvents(f)],
    calls: [c0.call], conversations: [c0.conversation!],
    summaries: [{ conversation_id: hex(21), source: "captured", summary: summary("Customer is moving a 2 bedroom home from Norfolk to Raleigh around October 10. She wants a written estimate.",
      { customer_wanted: "A written estimate.", money_and_dates: "Move around Oct 10.", outcome: "Rep will email the estimate today.", commitments: "Email estimate today; call back Monday after 5 PM." }, said) }],
    focus_conversation_ids: [hex(21)], findings: [finding(41, 21, "promised_callback", "Rep promised to call back Monday after 5 PM.", [4])],
    followups: [f], allowed_followup_ids: [hex(31)], records: [record()],
    granot: [{ lead_ref: lead.ref, basis: "job_no", truncated: false, observations: [observation(61, "2026-09-17T15:20:00.000Z", { priority: "1", estimate: "7100.00", move_date: "2026-10-10",
      cubic_feet: "540", service_type: "Long distance", rep_raw: "JBELL", user_raw: "JBELL" })] }],
    prior: priorPage([]),
  });
}

/** 2. A Call Lead: an inbound qualifying call to a routed line, answered by a reviewed rep. */
export function callLead(): CaseFileSources {
  const lead: CaseLead = { ...formLead(2, { ref: { model: "CallLead", id: hex(2) }, name: "Dan Whit", job_no: "84600", normalized_job_no: "84600", granot_priority: null, quoted: false,
    receiver: null, move: views(null, false), source_label: "MovingQuotes", received_at: "2026-09-20T17:00:00.000Z", created_at: "2026-09-20T17:08:00.000Z" }),
  ringcentral: { telephony_session_id: "sess-12", qualification_reason: "Answered inbound call over 60 seconds", start_time: "2026-09-20T17:00:00.000Z",
    target_phone_number: "+18005550199", target_name: "MovingQuotes", source_label: "MQ", route_id: null } };
  const c0 = call({ n: 12, when: "2026-09-20T17:00:00.000Z", direction: "Inbound", human: true, conversation: 22, seconds: 410, company: "+18005550199" });
  const vantage = emptyVantage();
  vantage.call_leads = [{ lead_ref: lead.ref, telephony_session_id: "sess-12", target_phone_number: "+18005550199", target_name: "MovingQuotes", source_label: "MQ" }];
  return base({ provider_names: ["DAN WHIT"], vantage,
    leads: [lead], edges: [{ lead_ref: lead.ref, state: "attached", certainty: "exact", reason: "RingCentral call identity", decided_by: "automatic" }],
    events: [leadReceived(lead), event("call_qualified", hex(2), "2026-09-20T17:00:00.000Z", leadKey(lead.ref), { lead_ref: lead.ref, qualification_reason: "Answered inbound call over 60 seconds" }),
      attached(lead, "2026-09-20T17:09:00.000Z", "RingCentral call identity"), c0.event],
    calls: [c0.call], conversations: [c0.conversation!],
    summaries: [{ conversation_id: hex(22), source: "captured", summary: summary("Customer called about moving a studio to Tampa next week.", { outcome: "Rep quoted over the phone." },
      [fact("Customer said the price is too high.", 2)]) }],
    focus_conversation_ids: [hex(22)], records: [record({ id: hex(502), subject: { kind: "lead", model: "CallLead", id: hex(2) }, assignment: { origin: "first_conversation", assigned_at: "2026-09-20T17:10:00.000Z" } })],
    prior: priorPage([]),
  });
}

/** 3. A Number without a Lead: two candidates by phone, a Number review record, one conversation and a missed call. */
export function noLeadWithCandidates(): CaseFileSources {
  const candidates: LeadCandidate[] = [
    { lead_ref: { model: "FormLead", id: hex(3) }, basis: ["phone:normalized_phone_number"], name: "Ann Lee", received_at: "2026-09-10T13:00:00.000Z", source_company_label: "Top10",
      job_no: "84000", duplicate: false, booked: false, cancelled: false, bad_lead: false, attachment_state: null, certainty: null },
    { lead_ref: { model: "FormLead", id: hex(4) }, basis: ["phone:normalized_phone_number"], name: "Ann Lee", received_at: "2026-09-11T13:00:00.000Z", source_company_label: "MovingQuotes",
      job_no: null, duplicate: true, booked: false, cancelled: false, bad_lead: false, attachment_state: null, certainty: null },
  ];
  const missed = call({ n: 13, when: "2026-09-21T15:00:00.000Z", direction: "Inbound", ext: null, result: "Missed", company: "+15615550100" });
  const c0 = call({ n: 14, when: "2026-09-21T15:30:00.000Z", direction: "Outbound", ext: "e104", human: true, conversation: 24, company: "+15615550100" });
  return base({ provider_names: [], candidates, events: [missed.event, c0.event], calls: [missed.call, c0.call], conversations: [c0.conversation!],
    summaries: [{ conversation_id: hex(24), source: "canonical", summary: summary("Caller asked whether Vantage had received her form last week.", { outcome: "Rep will look up the form." }) }],
    records: [record({ id: hex(503), subject: { kind: "number_review", model: null, id: null }, state: "unworked", responsible_agent_id: null, assignment: null })],
    reviews_open: [{ cause_kind: "reconcile_identity" }], prior: priorPage([]) });
}

/** 4. A busy Number: 25 summarized calls, attempt runs, eleven Owner notes, prior findings, a rolling summary. Over the soft budget. */
export function busyNumber(): CaseFileSources {
  const lead = formLead(1, { receiver: { agent_id: hex(803), name: "Alex Park", source: "granot_username_match", set_at: "2026-06-02T15:00:00.000Z" }, received_at: "2026-06-01T13:00:00.000Z",
    created_at: "2026-06-01T13:00:20.000Z" });
  const events: StoryEvent[] = [leadReceived(lead), attached(lead, "2026-06-01T13:05:00.000Z")];
  const calls: CaseCall[] = [], conversations: CaseConversation[] = [], summaries: CaseFileSources["summaries"] = [];
  const long = (i: number) => `${"The customer and the rep went over the inventory room by room, the access at both ends, the packing materials and the insurance options in detail. ".repeat(11)}Call ${i}.`;
  for (let i = 0; i < 25; i++) {
    const day = at("2026-06-03T14:00:00.000Z", i * 4 * 86_400_000);
    const c = call({ n: 100 + i, when: day, direction: i % 2 ? "Inbound" : "Outbound", human: true, conversation: 200 + i, seconds: 300 + i, ext: i % 5 === 4 ? "e118" : "e104" });
    events.push(c.event); calls.push(c.call); conversations.push(c.conversation!);
    summaries.push({ conversation_id: hex(200 + i), source: i >= 18 ? "captured" : "canonical", summary: summary(`Call ${i}: the customer reviewed the plan. ${long(i)}`,
      { customer_wanted: long(i), money_and_dates: `Estimate discussed around $${6000 + i * 10}.`, outcome: `Outcome of call ${i}: waiting on the customer.`, commitments: `Rep promised a callback after call ${i}.` },
      [promise(`Rep promised to call back after call ${i}.`, 2), fact(`Customer raised a concern on call ${i}.`, 3), fact(`Customer compared another mover on call ${i}.`, 4, "customer"),
        ...Array.from({ length: 8 }, (_, k) => fact(`Customer described room ${k + 1} of the home in detail on call ${i}, including the large furniture.`, 5 + k))]) });
    for (let a = 0; a < 4; a++) {
      const attempt = call({ n: 300 + i * 4 + a, when: at(day, (a + 1) * 26 * 3_600_000), direction: "Outbound", ext: "e104", result: a === 1 ? "Voicemail" : "No Answer" });
      events.push(attempt.event); calls.push(attempt.call);
    }
  }
  for (let k = 0; k < 11; k++) events.push(event("owner_note", hex(600 + k), at("2026-06-05T16:00:00.000Z", k * 9 * 86_400_000), `lead:FormLead:${hex(1)}`,
    { note: `Owner note ${k}: keep pushing for the booking.` }, at("2026-06-05T16:00:00.000Z", k * 9 * 86_400_000), actor("owner")));
  const prior = priorPage([
    { record_type: "prior_summary", record_id: hex(450), revision: "sales_intelligence_analyze_v4", fields: { kind: "number_synthesis", run_id: hex(450), happened_at: "2026-09-01T12:00:00.000Z",
      description: "The customer has been worked for three months; the estimate sits near $6,200 and the customer keeps comparing movers.", status: "completed",
      details: JSON.stringify({ sections: { outcome: "Waiting on the customer.", commitments: "Rep callbacks after each call." } }) } },
    ...Array.from({ length: 8 }, (_, p) => ({ record_type: "prior_finding" as const, record_id: hex(460 + p), revision: "1", fields: { kind: p % 2 ? "objection" : "promised_callback",
      description: `Prior finding ${p} about call ${24 - p}.`, actor: "rep", action_status: p % 2 ? null : "promised", review_state: p < 3 ? "confirmed" : "unreviewed",
      conversation_id: hex(224 - p), run_id: hex(450), happened_at: at("2026-06-03T14:00:00.000Z", (24 - p) * 4 * 86_400_000), effects: [] } })),
  ]);
  return base({ leads: [lead], edges: [{ lead_ref: lead.ref, state: "attached", certainty: "exact", reason: "sole phone match", decided_by: "automatic" }], events, calls, conversations, summaries,
    focus_conversation_ids: null, synthesis_covers: conversations.slice(0, 18).map(c => c.id), records: [record()], agents: { [hex(801)]: "Jordan Bell", [hex(803)]: "Alex Park" },
    as_of: "2026-10-05T20:10:00.000Z", prior });
}

/** 5. An estimate change with a money-less newest observation; the Priority line comes from `entity_changes`. */
export function estimateChange(): CaseFileSources {
  const sources = formLeadOneCall();
  const lead = sources.leads[0]!;
  sources.focus_conversation_ids = [];
  sources.summaries = sources.summaries.map(s => ({ ...s, source: "canonical" as const }));
  sources.events = [...sources.events, priorityChange(71, lead, "2026-09-17T15:20:00.000Z", "0", "1", "JBELL")];
  sources.granot = [{ lead_ref: lead.ref, basis: "job_no", truncated: false, observations: [
    observation(61, "2026-09-17T15:20:00.000Z", { priority: "1", estimate: "7100.00", move_date: "2026-10-10", cubic_feet: "540", service_type: "Long distance", rep_raw: "JBELL", user_raw: "JBELL" }),
    observation(62, "2026-09-22T19:02:00.000Z", { priority: "1", estimate: "6600.00", move_date: "2026-10-12", cubic_feet: "540", service_type: "Long distance", rep_raw: "JBELL", user_raw: "JBELL" }),
    observation(63, "2026-09-23T13:00:00.000Z", { priority: "1", move_date: "2026-10-12", rep_raw: "JBELL", user_raw: "JBELL" }),
  ] }];
  sources.bookings = [];
  return sources;
}

/** 6. An unreviewed extension (directory name) answers through a queue; an unknown extension dials out. */
export function unreviewedExtension(): CaseFileSources {
  const sources = formLeadOneCall();
  const c1 = call({ n: 15, when: "2026-09-23T19:40:00.000Z", direction: "Inbound", ext: "e118", human: true, conversation: 25, seconds: 362, queue: true, company: "+15615550100" });
  const c2 = call({ n: 16, when: "2026-09-22T13:00:00.000Z", direction: "Outbound", ext: "e999", result: "No Answer", late: true });
  sources.events = [...sources.events, c1.event, c2.event];
  sources.calls = [...sources.calls, c2.call, c1.call];
  sources.conversations = [...sources.conversations, c1.conversation!];
  sources.summaries = [{ ...sources.summaries[0]!, source: "canonical" }, { conversation_id: hex(25), source: "captured", summary: summary("Customer called back about the estimate and asked for a lower price.",
    { outcome: "The person who answered said someone would call her back tomorrow." }, [promise("Someone at Vantage said they would call her back tomorrow.", 2)]) }];
  sources.focus_conversation_ids = [hex(25)];
  return sources;
}

export const FIXTURES: Record<string, () => CaseFileSources> = {
  "form-lead-one-call": formLeadOneCall, "call-lead": callLead, "no-lead-candidates": noLeadWithCandidates, "busy-number": busyNumber,
  "estimate-change": estimateChange, "unreviewed-extension": unreviewedExtension,
};
