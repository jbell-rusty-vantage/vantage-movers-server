import { dispositionFor, normalizePriority, priorityLabel } from "../outreach/leadProgress";
import { certaintyLabel, collapseEvents, completionBasisLabel, followupKindLabel, originLabel } from "../story/catalog";
import { renderSentence, type RenderContext } from "../story/prose";
import { timelineKindOrder } from "../story/sources";
import type { GranotLeadState, StoryEvent, StoryLeadRef } from "../story/types";
import { payloadHash } from "../transactions";
import { buildLedger } from "./commitments";
import { assignTiers, cleanText, clip, digestOutcome, firstSentence, fullSummaryText, saidOrder, saidText } from "./digest";
import { granotChangeText, granotHistory, granotHistoryEvent, granotValueText, mergeGranotHistory, type GranotHistory } from "./granotHistory";
import { calendarDate, clockTime, dollars, duration, etDaysBetween, fullDate, fullTime, parseIso, relativeDays, sameEtDay, timelineDate, timelineTime } from "./time";
import type { CaseCall, CaseCallBlock, CaseFile, CaseFileSources, CaseFollowup, CaseLead, CasePriorFinding, CaseSummary, CaseTimelineItem } from "./types";
import { lineText, vantageClauseText, vantageSide, type VantageSide } from "./vantageSide";

/**
 * Pure Case File builder (spec §4.1–§4.7): `CaseFileSources` (already read) → the sections as lines,
 * the T/C/P/F/K numbering, and the story page the citations resolve against. Identical input →
 * identical output; nothing reads the clock (everything is relative to `sources.as_of`).
 */
export const MAX_TIMELINE_EVENTS = 150;
const OLD_ATTEMPT_MS = 30 * 86_400_000;
const INDENT = "     ";
const LATE_MS = 60 * 60 * 1000;
const EXCLUDED_KINDS = new Set(["granot_observed", "followup_snoozed", "analysis_submitted"]);
const PROTECTED_KINDS = new Set(["lead_received", "number_attached", "booking_recorded", "cancellation_recorded", "closed"]);
const LEAD_KINDS = new Set(["lead_received", "call_qualified", "granot_priority_changed", "quoted_changed", "granot_observed", "booking_recorded", "cancellation_recorded", "number_attached"]);
const RECEIVER_SOURCE_LABELS: Record<string, string> = {
  extension_match: "RingCentral extension match", extension_selected: "extension selected", extension_created: "extension created",
  extension_crm_username_match: "extension CRM username match", granot_username_match: "Granot username match", best_relocation_sheet: "Best Relocation sheet", manual: "manual",
};
const ASSIGNMENT_LABELS: Record<string, string> = { owner: "Owner", first_conversation: "first conversation", rep_promise: "rep promise", inherited_outreach: "inherited",
  first_attempts: "first attempts" };
const leadKey = (ref: StoryLeadRef) => `lead:${ref.model}:${ref.id}`;
const cap = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);
const noPeriod = (text: string) => text.replace(/\.$/, "");
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** A follow-up's lifecycle order at equal instants: created before completed/cancelled/superseded (V-AC S4). */
/** V-AC N7: "unreviewed" is reserved for rep identity; a finding's Owner review reads differently. */
const REVIEW_WORDING: Readonly<Record<string, string>> = { unreviewed: "not yet reviewed by the Owner", confirmed: "confirmed by the Owner",
  corrected: "corrected by the Owner", retracted: "retracted by the Owner" };
const reviewWording = (state: string | null) => (state ? REVIEW_WORDING[state] ?? state.replace(/_/g, " ") : REVIEW_WORDING.unreviewed!);
const LIFECYCLE_ORDER: Readonly<Record<string, number>> = { followup_created: 0, followup_completed: 1, followup_cancelled: 1, followup_superseded: 1 };
function compareCase(a: StoryEvent, b: StoryEvent): number {
  const at = Date.parse(a.happened_at) - Date.parse(b.happened_at);
  if (at) return at;
  const order = timelineKindOrder(a.kind) - timelineKindOrder(b.kind);
  if (order) return order;
  const lifecycle = (LIFECYCLE_ORDER[a.kind] ?? 0) - (LIFECYCLE_ORDER[b.kind] ?? 0);
  if (lifecycle) return lifecycle;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * V-AC S4: a follow-up's "created" line sits at the promise (its `date_resolution.anchor`, else the
 * source call), never after its own completion/cancellation. The row's write time becomes
 * `observed_at`, so a follow-up written later reads `(recorded …)`. Pure.
 */
export function anchorFollowupCreation(events: readonly StoryEvent[], followups: readonly CaseFollowup[]): StoryEvent[] {
  const byId = new Map(followups.map(f => [f.id, f]));
  const firstTransition = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "followup_created") continue;
    if (!String(e.kind).startsWith("followup_")) continue;
    const id = String(e.detail.followup_id ?? ""), at = Date.parse(e.happened_at);
    if (!Number.isNaN(at)) firstTransition.set(id, Math.min(firstTransition.get(id) ?? at, at));
  }
  return events.map(e => {
    if (e.kind !== "followup_created") return e;
    const id = String(e.detail.followup_id ?? ""), written = Date.parse(e.happened_at);
    const anchor = Date.parse(byId.get(id)?.anchor_at ?? "");
    let at = Number.isNaN(anchor) ? written : Math.min(written, anchor);
    const transition = firstTransition.get(id);
    if (transition !== undefined && transition < at) at = transition;
    if (at === written) return e;
    const observed = Number.isNaN(Date.parse(e.observed_at)) ? e.happened_at : e.observed_at;
    return { ...e, happened_at: new Date(at).toISOString(), observed_at: new Date(Math.max(Date.parse(observed), written)).toISOString() };
  });
}
const leadIdOf = (event: StoryEvent): string | null => {
  const ref = event.detail.lead_ref as { id?: unknown } | null | undefined;
  if (ref && typeof ref === "object" && ref.id) return String(ref.id);
  const match = /^lead:(?:FormLead|CallLead):([a-f0-9]{24})$/.exec(event.subject_key);
  return match ? match[1]! : null;
};

type Ctx = {
  src: CaseFileSources; asOf: string; labels: Map<string, string>; labelById: Map<string, string>; multiLead: boolean;
  cIndex: Map<string, number>; summaries: Map<string, CaseSummary>; focus: Set<string>; newSince: (conversation: string) => boolean;
  sides: Map<string, VantageSide>; callById: Map<string, CaseCall>; followupLabel: (id: string) => string; render: RenderContext;
  conversationsByCall: Map<string, string[]>;
};

// ---------------------------------------------------------------------------------------------
// Timeline events
// ---------------------------------------------------------------------------------------------

/** Timeline events: readers (minus `granot_observed`) + Granot history, merged, focused, collapsed, bounded. */
function timelineEvents(src: CaseFileSources, histories: GranotHistory[], ctx: Pick<Ctx, "cIndex" | "focus" | "conversationsByCall">) {
  const base = src.events.filter(e => !EXCLUDED_KINDS.has(e.kind)).map(e => ({ ...e, detail: { ...e.detail }, evidence_refs: [...e.evidence_refs] }));
  const merged = mergeGranotHistory(anchorFollowupCreation(base, src.followups), histories.flatMap(h => h.entries));
  const all = [...merged.events, ...merged.history.map(granotHistoryEvent)].sort(compareCase);
  const conversationCalls = new Set<string>();
  for (const event of all) {
    if (event.kind !== "call") continue;
    const conversations = ctx.conversationsByCall.get(String(event.detail.interaction_id ?? "")) ?? [];
    if (conversations.some(c => ctx.focus.has(c))) event.focus = true;
    if (conversations.some(c => ctx.cIndex.has(c))) conversationCalls.add(event.id);
  }
  const notes = all.filter(e => e.kind === "owner_note");
  // Recorded conversations never collapse (they have recordings); attempt runs, Priority churn and review runs do.
  let collapsed = collapseEvents(all);
  // The collapse keeps five Owner notes; the budget (step 4) owns that cut here, so every note is restored.
  const present = new Set(collapsed.map(e => e.id));
  collapsed = [...collapsed.map(e => {
    if (e.kind !== "owner_note" || e.detail.older_notes_omitted === undefined) return e;
    const { older_notes_omitted: _omitted, ...detail } = e.detail;
    return { ...e, detail };
  }), ...notes.filter(n => !present.has(n.id))].sort(compareCase);
  const kept = collapsed.filter(e => !(e.kind === "conversation_analyzed" && ctx.cIndex.has(String(e.detail.conversation_id ?? ""))));
  return boundTimeline(kept, conversationCalls);
}

/** Newest `MAX_TIMELINE_EVENTS`; never-drop kinds and focus calls stay; attempts and notes go first, oldest first. */
function boundTimeline(events: StoryEvent[], conversationCalls: ReadonlySet<string>): { events: StoryEvent[]; dropped: number } {
  if (events.length <= MAX_TIMELINE_EVENTS) return { events, dropped: 0 };
  const isProtected = (e: StoryEvent) => PROTECTED_KINDS.has(e.kind) || Boolean(e.focus);
  const first = (e: StoryEvent) => e.kind === "call_attempts" || e.kind === "owner_note" || (e.kind === "call" && !conversationCalls.has(e.id) && !e.detail.provider_connected);
  const candidates = events.map((e, i) => ({ e, i })).filter(({ e }) => !isProtected(e));
  const order = [...candidates.filter(({ e }) => first(e)), ...candidates.filter(({ e }) => !first(e))];
  const drop = new Set<number>();
  for (const { i } of order) { if (events.length - drop.size <= MAX_TIMELINE_EVENTS) break; drop.add(i); }
  return { events: events.filter((_, i) => !drop.has(i)), dropped: drop.size };
}

function sourceOf(e: StoryEvent): string {
  switch (e.kind) {
    case "lead_received": return "Vantage intake";
    case "call_qualified": case "call": case "call_attempts": case "conversation_recorded": return "RingCentral";
    case "lead_message_sent": return "Vantage";
    case "conversation_analyzed": case "assessment_published": return "Analysis";
    case "granot_priority_changed": case "quoted_changed": case "granot_observed": return e.detail.source_system === "vantage" ? "Vantage" : "Granot";
    case "number_attached": return e.actor.kind === "owner" ? "Owner" : "Vantage";
    case "booking_recorded": case "cancellation_recorded": return "Vantage Bookings";
    case "followup_created": case "followup_completed": case "followup_cancelled": case "followup_superseded": return e.detail.origin === "owner" ? "Owner" : "Vantage Outreach";
    case "owner_correction": return "Owner";
    default: return e.actor.kind === "owner" ? "Owner" : "Vantage Outreach";
  }
}

function callResult(call: CaseCall | null, e: StoryEvent): string {
  const d = e.detail;
  const connected = call ? call.provider_connected : Boolean(d.provider_connected);
  const secs = call ? call.duration_seconds : typeof d.duration_seconds === "number" ? d.duration_seconds : null;
  const contact = call ? call.contact_type : String(d.contact_type ?? "unknown");
  const recorded = (call ? call.recording_count : Number(d.recording_count ?? 0)) > 0;
  const result = cleanText(call?.provider_result ?? d.provider_result ?? "", 40);
  if (contact === "voicemail") return `voicemail, ${duration(secs)}${recorded ? ", recorded" : ""}`;
  if (!connected) return `not connected${result ? ` (${result})` : ""}`;
  return `connected ${duration(secs)}${recorded ? ", recorded" : ""}${contact === "human_conversation" ? ", human conversation" : ""}`;
}

function leadPrefix(e: StoryEvent, ctx: Ctx): string {
  if (!ctx.multiLead || !LEAD_KINDS.has(e.kind)) return "";
  const id = leadIdOf(e);
  const label = id ? ctx.labelById.get(id) : undefined;
  return label ? `${label} ` : "";
}

function headText(e: StoryEvent, ctx: Ctx): string {
  const d = e.detail;
  const lead = leadPrefix(e, ctx);
  switch (e.kind) {
    case "lead_received": {
      const id = leadIdOf(e);
      const label = id ? ctx.labelById.get(id) ?? "" : "";
      const source = cleanText(d.source_company_label ?? "", 60) || "source unknown";
      const job = str(d.job_no) ? ` · Job ${cleanText(d.job_no, 30)}` : "";
      return `${label ? `${label} ` : ""}${d.model === "CallLead" ? "Call Lead created" : "Form Lead received"} (${source})${job}${d.duplicate ? " · duplicate" : ""}`;
    }
    case "call": {
      const call = ctx.callById.get(String(d.interaction_id ?? "")) ?? null;
      const side = call ? ctx.sides.get(call.id) : undefined;
      const conversations = (ctx.conversationsByCall.get(String(d.interaction_id ?? "")) ?? []).filter(c => ctx.cIndex.has(c));
      const cLabel = conversations.map(c => `C${ctx.cIndex.get(c)}`).join("/");
      const direction = String(d.direction ?? "Unknown");
      const clause = side ? vantageClauseText(side, direction, call!.provider_connected) : "on a Vantage line";
      return `${cLabel ? `${cLabel} ` : ""}${direction.toLowerCase()} ${clause}`;
    }
    case "call_attempts": {
      const ids = Array.isArray(d.interaction_ids) ? (d.interaction_ids as unknown[]).map(String) : [];
      const reps = [...new Set(ids.map(id => ctx.sides.get(id)?.rep.text ?? "a Vantage line"))];
      const results = (d.results && typeof d.results === "object" ? d.results : {}) as Record<string, number>;
      const buckets = [["voicemail", "voicemail"], ["missed", "missed"], ["no_answer", "no answer"], ["other", "other"]]
        .flatMap(([key, label]) => (results[key!] ? [`${results[key!]} ${label}`] : []));
      const lines = [...new Set(ids.map(id => { const s = ctx.sides.get(id); return s ? lineText(s.line) : "a Vantage line"; }))];
      const inbound = String(d.direction) === "Inbound";
      const where = lines.length === 1 ? ` ${inbound ? "to" : "from"} ${lines[0]}` : "";
      const results_ = buckets.join(", ") || "results not reported";
      if (inbound) return `${Number(d.count ?? ids.length)} inbound calls${where}, none answered (${results_})`;
      return `${Number(d.count ?? ids.length)} outbound attempts${where} by ${reps.length === 1 ? reps[0] : `${reps.length} different extensions`}, none connected (${results_})`;
    }
    case "number_attached": {
      const id = leadIdOf(e);
      const label = id ? ctx.labelById.get(id) ?? "the Lead" : "the Lead";
      const why = [certaintyLabel(str(d.certainty)), cleanText(d.reason ?? "", 120)].filter(Boolean).join(", ");
      const verb = d.state === "attached" ? "Number attached to" : d.state === "rejected" ? "Number rejected for" : d.state === "ambiguous" ? "Number marked ambiguous for" : "Number became a candidate for";
      return `${verb} ${label} (${why})`;
    }
    case "granot_priority_changed": {
      const by = str(d.granot_rep_raw) ? ` by ${cleanText(d.granot_rep_raw, 40)}` : "";
      const from = str(d.from), to = str(d.to);
      const churned = typeof d.churn_count === "number" && d.churn_count > 1;
      // V-AC S2: a change whose from equals its to is not a change: say what the record shows instead.
      const change = from === null ? `Priority set to ${to ?? "none"} ${priorityLabel(to)}`
        : from === to ? (churned ? `Priority changed and returned to ${to} ${priorityLabel(to)}` : `Priority re-recorded as ${to} ${priorityLabel(to)} (no change)`)
        : `Priority ${from} ${priorityLabel(from)} → ${to ?? "none"} ${priorityLabel(to)}`;
      const churn = churned ? ` (${d.churn_count} changes within an hour)` : "";
      const fields = (Array.isArray(d.granot_fields) ? d.granot_fields as Parameters<typeof granotChangeText>[0][] : []).filter(c => c.field !== "user_raw");
      const extra = fields.length ? ` · ${fields.map(granotChangeText).join(" · ")}` : "";
      return `${lead}${change}${by}${churn}${extra}`;
    }
    case "quoted_changed": {
      // V-AC S2: the sentence names the same source as the line's source label.
      const where = d.source_system === "vantage" ? "by a Vantage edit" : "in Granot";
      if (d.quoted !== false && d.quoted_before === true) return `${lead}Quoted mark re-recorded ${where} (no change)`;
      return `${lead}${d.quoted === false ? `Quoted mark removed ${where}` : `marked Quoted ${where}`}`;
    }
    case "granot_observed": {
      const changes = (Array.isArray(d.changes) ? d.changes : []) as Parameters<typeof granotChangeText>[0][];
      const shown = changes.filter(c => c.field !== "user_raw");
      if (d.baseline) return `${lead}Granot recorded the Lead: ${shown.map(granotChangeText).join(", ") || "no tracked values"}`;
      return `${lead}${shown.map(granotChangeText).join(" · ")}`;
    }
    case "booking_recorded": {
      const binder = dollars(typeof d.total_binder_amount === "number" ? d.total_binder_amount : null), deposit = dollars(typeof d.deposit_amount === "number" ? d.deposit_amount : null);
      return `${lead}Booking recorded (Job ${cleanText(d.job_no ?? "", 30) || "unknown"}${binder ? `, binder ${binder}` : ""}${deposit ? `, deposit ${deposit}` : ""})${d.book_date_missing ? " (no book date; timed by entry)" : ""}`;
    }
    case "followup_created": {
      const due = str(d.due_at) ? `, due ${fullTime(str(d.due_at))}` : "";
      return `${ctx.followupLabel(String(d.followup_id))} created: ${followupKindLabel(str(d.kind))} "${cleanText(d.description ?? "", 160)}"${due} (${originLabel(str(d.origin))})`;
    }
    case "followup_completed": {
      const disposition = str(d.disposition) ? `, ${String(d.disposition).replace(/_/g, " ")}` : "";
      return `${ctx.followupLabel(String(d.followup_id))} completed (${completionBasisLabel(str(d.completion_basis))}${disposition})`;
    }
    case "followup_cancelled": return `${ctx.followupLabel(String(d.followup_id))} cancelled${str(d.cancel_reason) ? `: ${cleanText(d.cancel_reason, 120)}` : ""}`;
    case "followup_superseded": return `${ctx.followupLabel(String(d.followup_id))} superseded by a later follow-up`;
    default: return `${lead}${cap(noPeriod(renderSentence(e, ctx.render)))}`;
  }
}

function timeSlot(e: StoryEvent, asOf: string): string {
  if (e.kind === "call_attempts" && str(e.detail.from) && str(e.detail.to)) {
    const from = String(e.detail.from), to = String(e.detail.to);
    return sameEtDay(from, to) ? `${timelineTime(from, asOf)} – ${clockTime(to)}` : `${timelineTime(from, asOf)} – ${timelineTime(to, asOf)}`;
  }
  return timelineTime(e.happened_at, asOf);
}

function callBlock(conversation: string, ctx: Ctx, claims: Map<string, { k: number; tag: string }>): CaseCallBlock | null {
  const c = ctx.cIndex.get(conversation);
  const entry = ctx.summaries.get(conversation);
  if (c === undefined || !entry) return null;
  const { summary } = entry;
  const said = saidOrder(summary).map(i => { const claim = claims.get(`${conversation}:${i}`); return `${saidText(summary.said_on_call[i]!)}${claim ? ` (${claim.tag})` : ""}`; });
  const tags = summary.said_on_call.flatMap((_, i) => { const claim = claims.get(`${conversation}:${i}`); return claim ? [claim.tag] : []; });
  const full = [`${INDENT}C${c} SUMMARY (full): ${fullSummaryText(summary) || "empty summary"}`, ...(said.length ? [`${INDENT}C${c} SAID: ${said.join(" · ")}`] : [])];
  const outcome = digestOutcome(summary, tags);
  const evidence = ctx.src.audience === "assessment" ? (ctx.src.evidence_lines[conversation] ?? []).map(l => `[${l.id}] ${cleanText(l.text, 200)}`) : [];
  return { c, conversation_id: conversation, focus: ctx.focus.has(conversation), tier: "full", full_rank: null, full,
    digest: { overview: `${INDENT}C${c} DIGEST: ${firstSentence(summary.summary.overview) || "no overview"}`, outcome: outcome ? `${INDENT}C${c} OUTCOME: ${outcome}` : null },
    evidence: evidence.length ? [`${INDENT}C${c} EVIDENCE: ${evidence.join(" · ")}`] : [] };
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

const FORM_SUBMISSION_ORIGINS = new Set(["wordpress_form"]);
/**
 * V-AC S3: `name` is also a Granot write path, so it is labelled by where it came from. `[form name]`
 * only for the name captured at ingestion from a form submission (`ingested_contact_snapshot`); the
 * current value is `[Granot]` when the contact provenance says Granot wrote it, else `[Lead record]`.
 */
export function customerNameText(lead: CaseLead): string | null {
  const current = str(lead.name) ? cleanText(lead.name, 80) : null;
  const origin = lead.contact_origin ?? null;
  const submitted = origin?.ingested_status === "captured_at_ingestion" && FORM_SUBMISSION_ORIGINS.has(lead.ingestion_origin ?? "") && str(origin.ingested_name)
    ? cleanText(origin.ingested_name, 80) : null;
  const currentLabel = origin?.current_source === "granot" ? "Granot" : "Lead record";
  if (submitted && (!current || current === submitted)) return `${submitted} [form name]`;
  if (submitted && current) return `${submitted} [form name] · Lead record now "${current}" [${currentLabel}]`;
  return current ? `${current} [${currentLabel}]` : null;
}

function customerLine(src: CaseFileSources, leads: CaseLead[]): string {
  const named = leads.find(l => str(l.name) || str(l.contact_origin?.ingested_name)) ?? null;
  const granot = named ? null : leads.find(l => str(l.granot_contact_name)) ?? null;
  const callerId = src.provider_names.map(n => cleanText(n, 60)).find(Boolean) ?? null;
  const name = named ? customerNameText(named) : granot ? `${cleanText(granot.granot_contact_name, 80)} [Granot]` : null;
  const parts = [name, callerId ? `caller ID "${callerId}" [RingCentral]` : null].filter(Boolean);
  return `Customer: ${parts.length ? parts.join(" · ") : "name not recorded"}`;
}

function leadLine(lead: CaseLead, label: string, edge: CaseFileSources["edges"][number] | undefined, lonely: boolean): string {
  const flags = [lead.duplicate ? "duplicate" : null, lead.bad_lead ? "bad lead" : null, lead.no_sync ? "no-sync" : null, lead.booked ? "booked" : null, lead.cancelled ? "cancelled" : null].filter(Boolean);
  const state = edge ? edge.state === "attached" ? `attached (${[certaintyLabel(edge.certainty), cleanText(edge.reason ?? "", 80)].filter(Boolean).join(", ")})`
    : `${edge.state} (${[certaintyLabel(edge.certainty), cleanText(edge.reason ?? "", 80)].filter(Boolean).join(", ")}), not attached` : lonely ? "no Contact Number" : "in scope";
  return `  ${label} ${lead.ref.model === "FormLead" ? "Form Lead" : "Call Lead"} · ${cleanText(lead.source_label ?? "", 60) || "source unknown"}${lead.job_no ? ` · Job ${cleanText(lead.job_no, 30)}` : ""}${flags.length ? ` · ${flags.join(" · ")}` : ""} · received ${fullTime(lead.received_at ?? lead.created_at)} · ${state}`;
}

const endpoint = (e: { city: string | null; state: string | null; zip: string | null }) => { const place = [e.city, e.state].filter(Boolean).join(", "); return [place, e.zip].filter(Boolean).join(" ") || null; };
function moveLine(view: { pickup: { city: string | null; state: string | null; zip: string | null }; delivery: { city: string | null; state: string | null; zip: string | null };
  move_date: string | null; move_size: string | null; granot_move_size?: string | null; cubic_feet?: number | null }): string | null {
  const route = [endpoint(view.pickup), endpoint(view.delivery)];
  const parts = [cleanText(view.move_size ?? "", 40) || null, route[0] || route[1] ? `${route[0] ?? "pickup unknown"} → ${route[1] ?? "delivery unknown"}` : null,
    view.move_date ? `move date ${calendarDate(view.move_date)}` : null, typeof view.cubic_feet === "number" ? `${view.cubic_feet} cu ft` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export type OriginContext = { calls: readonly CaseCall[]; sides: ReadonlyMap<string, VantageSide>; routes: CaseFileSources["vantage"]["routes"] };
/** §2 for one Lead: how it started, as submitted (or as the qualifying call shows). Also the summary step's `lead_origin` (§4.12). */
export function originLines(lead: CaseLead, label: string, ctx: OriginContext): string[] {
  const source = cleanText(lead.source_label ?? "", 60) || "an unknown source";
  if (lead.ref.model === "CallLead") {
    const rc = lead.ringcentral;
    const call = rc?.telephony_session_id ? ctx.calls.find(c => c.telephony_session_id === rc.telephony_session_id) ?? null : null;
    const side = call ? ctx.sides.get(call.id) : undefined;
    // The qualifying call's line when it is on the Number; else the Call Lead's own RingCentral target (lookup step 2).
    const target = side ? lineText(side.line, true) : lineText({ label: cleanText(rc?.target_name ?? rc?.source_label ?? lead.source_label ?? "", 60) || null,
      e164: rc?.target_phone_number ?? null, source: "call_lead" }, true);
    const route = rc?.route_id ? ctx.routes.find(r => r.id === rc.route_id) : undefined;
    const answered = side && call?.provider_connected ? `; answered by ${side.rep.text}` : "";
    return [`${label} [RingCentral] Inbound call ${fullTime(rc?.start_time ?? lead.received_at)} to ${target}${route ? `, route "${cleanText(route.display_label, 60)}"` : ""},`,
      `   qualified as a Call Lead${rc?.qualification_reason ? ` (${cleanText(rc.qualification_reason, 100)})` : ""}${answered}`];
  }
  const original = lead.move.original_ingestion;
  if (original && original.label === "original_form_submission") {
    const move = moveLine(original);
    return [`${label} [Vantage intake] Form submitted ${fullTime(lead.received_at)} on ${source}:`, ...(move ? [`   ${move}`] : []), "   (as submitted; §3 shows Granot's current values)"];
  }
  if (original && original.label === "granot_created") {
    const move = moveLine(original);
    return [`${label} [Granot] Lead created from Granot ${fullTime(lead.received_at)} (${source}):`, ...(move ? [`   ${move}`] : []), "   (as first recorded)"];
  }
  if (original) {
    const move = moveLine(original);
    return [`${label} [Vantage intake] Form Lead recorded ${fullTime(lead.received_at)} on ${source}:`, ...(move ? [`   ${move}`] : []),
      `   (recorded at ingestion, ${original.label === "legacy_baseline" ? "legacy baseline" : "origin not proven"}; not proof of what the customer submitted)`];
  }
  const current = moveLine(lead.move.canonical_current);
  return [`${label} [Vantage intake] Form Lead recorded ${fullTime(lead.received_at)} on ${source}; the original submission was not captured.`,
    ...(current ? [`   Current Lead values: ${current}`] : [])];
}

function granotLines(lead: CaseLead, label: string, history: GranotHistory | undefined, bookings: CaseFileSources["bookings"]): string[] {
  const lines: string[] = [];
  const known = history?.last_known ?? {};
  if (!history || !history.observations) {
    const priority = normalizePriority(lead.granot_priority);
    lines.push(`${label} No accepted Granot observation on record. Lead record: ${priority === null ? "Priority not set" : `Priority ${priority} ${priorityLabel(priority)}`} · Quoted ${lead.quoted ? "yes" : "no"} [Lead]`);
  } else {
    const p = known.priority;
    const money = (field: "estimate" | "payment" | "balance", name: string) => { const v = known[field]; return `${name} ${v ? `${granotValueText(field, v.value)} (${fullDate(v.captured_at)})` : "—"}`; };
    lines.push(`${label} ${p ? `Priority ${granotValueText("priority", p.value)} (since ${fullTime(p.since)})` : "Priority not observed"} · Quoted ${lead.quoted ? "yes" : "no"} [Lead] · ${money("estimate", "Estimate")} · ${money("payment", "Payment")} · ${money("balance", "Balance")}`);
    const md = known.move_date;
    const moveParts = [md ? `Move date ${granotValueText("move_date", md.value)}${md.previous ? ` (Granot changed it from ${granotValueText("move_date", md.previous.value)} on ${fullDate(md.previous.changed_at)})` : ""}` : null,
      known.move_size ? `Size ${known.move_size.value}` : null, known.cubic_feet ? granotValueText("cubic_feet", known.cubic_feet.value) : null,
      known.service_type ? `Service ${known.service_type.value}` : null].filter(Boolean);
    if (moveParts.length) lines.push(`   ${moveParts.join(" · ")}`);
    const route = [known.pickup ? `Pickup ${known.pickup.value}` : null, known.delivery ? `Delivery ${known.delivery.value}` : null].filter(Boolean);
    if (route.length) lines.push(`   ${route.join(" · ")}`);
    if (known.rep_raw || known.user_raw) lines.push(`   Granot rep ${known.rep_raw?.value ?? "not shown"}${known.user_raw ? ` (user ${known.user_raw.value})` : ""}`);
    lines.push(`   Last accepted observation ${fullTime(history.newest?.captured_at)}; ${history.observations} accepted observation${history.observations === 1 ? "" : "s"} read${history.truncated ? " (history limited to the newest 50)" : ""}.`);
  }
  const booking = bookings.find(b => b.lead_key === `${lead.ref.model}:${lead.ref.id}`);
  lines.push(booking ? `   Vantage Booking: Job ${cleanText(booking.job_no ?? "", 30) || "unknown"}${dollars(booking.total_binder_amount) ? ` · binder ${dollars(booking.total_binder_amount)}` : ""}${dollars(booking.deposit_amount) ? ` · deposit ${dollars(booking.deposit_amount)}` : ""} · booked ${fullDate(booking.book_date)}${lead.cancelled ? " · later cancelled" : ""} [Vantage Bookings]`
    : "   No Vantage Booking recorded.");
  return lines;
}

function granotState(lead: CaseLead, history: GranotHistory | undefined, bookings: CaseFileSources["bookings"]): GranotLeadState {
  const known = history?.last_known ?? {};
  const priority = known.priority?.value ?? normalizePriority(lead.granot_priority);
  const booking = bookings.find(b => b.lead_key === `${lead.ref.model}:${lead.ref.id}`) ?? null;
  const cubic = known.cubic_feet ? Number(known.cubic_feet.value) : null;
  return { lead_ref: lead.ref, job_no: lead.job_no, granot_priority: priority, priority_label: priorityLabel(priority), disposition: dispositionFor(priority), quoted: lead.quoted,
    booked: lead.booked || booking !== null, cancelled: lead.cancelled, duplicate: lead.duplicate, bad_lead: lead.bad_lead, no_sync: lead.no_sync,
    receiver_agent_name: lead.receiver?.name ?? null, granot_rep_raw: known.rep_raw?.value ?? null,
    move: { pickup: known.pickup?.value ?? null, delivery: known.delivery?.value ?? null, move_date: known.move_date?.value ?? null, move_size: null,
      granot_move_size: known.move_size?.value ?? null, cubic_feet: Number.isFinite(cubic) ? cubic : null, service_type: known.service_type?.value ?? null },
    money: { estimate: known.estimate?.value ?? null, payment: known.payment?.value ?? null, balance: known.balance?.value ?? null }, booking_action: null,
    observation: history?.newest ? { id: history.newest.id, kind: history.newest.kind, captured_at: history.newest.captured_at, source_label: history.newest.source_label } : null,
    booking: booking ? { id: booking.id, job_no: booking.job_no, book_date: booking.book_date, deposit_amount: booking.deposit_amount, total_binder_amount: booking.total_binder_amount } : null };
}

/** `C0–C17, C20`: consecutive call numbers as ranges. */
export function callRanges(indices: readonly number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(j - i >= 2 ? `C${sorted[i]}–C${sorted[j]}` : sorted.slice(i, j + 1).map(n => `C${n}`).join(", "));
    i = j + 1;
  }
  return out.join(", ");
}

function dueState(iso: string | null, asOf: string): string {
  const at = parseIso(iso);
  if (!at) return "(no due date)";
  const days = etDaysBetween(at.toISOString(), asOf);
  if (+at <= Date.parse(asOf)) return days >= 1 ? `— overdue ${days} day${days === 1 ? "" : "s"}` : "— overdue (today)";
  return `— ${relativeDays(at.toISOString(), asOf) === "today" ? "due later today" : `due ${relativeDays(at.toISOString(), asOf)}`}`;
}

// ---------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------

export function buildCaseFile(src: CaseFileSources): CaseFile {
  const asOf = src.as_of;
  const edges = src.edges;
  const attachedKeys = new Set(edges.filter(e => e.state === "attached").map(e => leadKey(e.lead_ref)));
  if (src.contact_number_id === null) for (const lead of src.leads) attachedKeys.add(leadKey(lead.ref));
  const orderedLeads = [...src.leads.filter(l => attachedKeys.has(leadKey(l.ref))), ...src.leads.filter(l => !attachedKeys.has(leadKey(l.ref)))];
  const labels = new Map<string, string>(), labelById = new Map<string, string>();
  orderedLeads.forEach((lead, i) => { labels.set(leadKey(lead.ref), `L${i + 1}`); labelById.set(lead.ref.id, `L${i + 1}`); });
  const candidates = src.candidates.filter(c => !labels.has(leadKey(c.lead_ref)));
  candidates.forEach((c, i) => { const label = `L${orderedLeads.length + i + 1}`; labels.set(leadKey(c.lead_ref), label); labelById.set(c.lead_ref.id, label); });
  const attachedLeads = orderedLeads.filter(l => attachedKeys.has(leadKey(l.ref)));

  // Calls with a summary are the C calls, ordered by `started_at` (fixes V2).
  const summaries = new Map(src.summaries.map(s => [s.conversation_id, s]));
  const cConversations = src.conversations.filter(c => summaries.has(c.id))
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || (a.id < b.id ? -1 : 1));
  const cIndex = new Map(cConversations.map((c, i) => [c.id, i]));
  const conversationsByCall = new Map<string, string[]>();
  for (const c of [...src.conversations].sort((a, b) => (a.id < b.id ? -1 : 1))) if (c.call_interaction_id) conversationsByCall.set(c.call_interaction_id, [...(conversationsByCall.get(c.call_interaction_id) ?? []), c.id]);

  const priorRecords = src.prior?.page.records ?? [];
  const synthesis = priorRecords.find(r => r.record_type === "prior_summary" && r.fields.kind === "number_synthesis") ?? null;
  const covered = new Set(src.synthesis_covers ?? []);
  const newSince = (conversation: string) => Boolean(synthesis) && src.synthesis_covers !== null && !covered.has(conversation);
  const captured = src.summaries.filter(s => s.source === "captured").map(s => s.conversation_id);
  const focusIds = src.focus_conversation_ids ?? (synthesis && src.synthesis_covers !== null ? cConversations.filter(c => newSince(c.id)).map(c => c.id) : captured);
  const focus = new Set(focusIds.filter(id => cIndex.has(id)));

  const callById = new Map(src.calls.map(c => [c.id, c]));
  const sides = new Map(src.calls.map(c => [c.id, vantageSide(c, src.vantage)]));
  const allowed = src.allowed_followup_ids ?? [...src.records].sort((a, b) => (a.id < b.id ? -1 : 1))
    .flatMap(r => src.followups.filter(f => f.record_id === r.id).sort((a, b) => (a.id < b.id ? -1 : 1)).map(f => f.id));
  const followupIndex = new Map(allowed.map((id, i) => [id, i]));
  const followupLabel = (id: string) => (followupIndex.has(id) ? `F-${followupIndex.get(id)}` : "a follow-up on another record");
  const customerName = orderedLeads.map(l => str(l.name) ?? str(l.granot_contact_name)).find(Boolean) ?? null;
  const callerId = src.provider_names.map(n => cleanText(n, 60)).find(Boolean) ?? null;
  const ctx: Ctx = { src, asOf, labels, labelById, multiLead: labels.size > 1, cIndex, summaries, focus, newSince, sides, callById, followupLabel, conversationsByCall,
    render: { timezone: src.timezone, customer: customerName ? cleanText(customerName, 80) : callerId ? `${callerId} (caller ID)` : "the caller", phone: src.e164, lead_count: labels.size } };

  const histories = src.granot.filter(g => attachedKeys.has(leadKey(g.lead_ref))).map(granotHistory);
  const historyByLead = new Map(histories.map(h => [leadKey(h.lead_ref), h]));
  const { events, dropped } = timelineEvents(src, histories, ctx);

  const tiers = assignTiers(cConversations.map(c => ({ conversation_id: c.id, started_at: c.started_at, focus: focus.has(c.id) })));
  const ledger = buildLedger({ calls: cConversations.map(c => ({ conversation_id: c.id, c: cIndex.get(c.id)!, started_at: c.started_at, summary: summaries.get(c.id)!.summary })),
    findings: src.findings, followups: src.followups, events, as_of: asOf, staffing: src.staffing, followupLabel });

  // §4 timeline items. Tn = index (only story events carry T numbers).
  const placed = new Set<string>();
  const timeline: CaseTimelineItem[] = events.map((e, t) => {
    const late = e.observed_at && Date.parse(e.observed_at) - Date.parse(e.happened_at) > LATE_MS ? ` (recorded ${timelineDate(e.observed_at, asOf)})` : "";
    const head = `[T${t}] ${timeSlot(e, asOf)} · ${sourceOf(e)} · ${headText(e, ctx)}${late}`;
    const lines = [head];
    const conversations = e.kind === "call" ? conversationsByCall.get(String(e.detail.interaction_id ?? "")) ?? []
      : e.kind === "conversation_recorded" ? [String(e.detail.conversation_id ?? "")] : [];
    const blocks = conversations.filter(c => cIndex.has(c) && !placed.has(c)).flatMap(c => { const block = callBlock(c, ctx, ledger.claims); if (block) placed.add(c); return block ? [block] : []; })
      .map(block => ({ ...block, tier: tiers.get(block.conversation_id)?.tier ?? "digest", full_rank: tiers.get(block.conversation_id)?.full_rank ?? null }));
    if (e.kind === "call") {
      const call = callById.get(String(e.detail.interaction_id ?? "")) ?? null;
      const markers = [blocks.some(b => b.focus) ? "◀ THIS RUN" : null, blocks.some(b => newSince(b.conversation_id)) ? "(new since the rolling summary)" : null].filter(Boolean);
      if (blocks.length) lines.push(`${INDENT}→ ${callResult(call, e)}${markers.length ? `   ${markers.join(" ")}` : ""}`);
      else lines[0] = `${lines[0]} → ${callResult(call, e)}`;
    }
    const at = Date.parse(asOf);
    const oldAttempt = (e.kind === "call_attempts" && Date.parse(String(e.detail.to ?? e.happened_at)) < at - OLD_ATTEMPT_MS)
      || (e.kind === "call" && !blocks.length && !e.detail.provider_connected && Date.parse(e.happened_at) < at - OLD_ATTEMPT_MS);
    return { t, event_id: e.id, kind: e.kind, happened_at: e.happened_at, lines, calls: blocks, protected: PROTECTED_KINDS.has(e.kind) || blocks.some(b => b.focus),
      old_attempt: oldAttempt, owner_note: e.kind === "owner_note" };
  });
  const storyEvents = events.map((e, t) => ({ ...e, sentence: clip(timeline[t]!.lines[0]!.replace(/^\[T\d+\] /, ""), 300) }));

  // §1
  const who: string[] = ["§1 WHO AND WHAT", customerLine(src, orderedLeads)];
  if (!orderedLeads.length && !candidates.length) who.push(src.contact_number_id ? "Leads on this number: none attached; no candidates found." : "Leads: none.");
  else {
    who.push(src.contact_number_id ? "Leads on this number:" : "Leads:");
    for (const lead of orderedLeads) who.push(leadLine(lead, labels.get(leadKey(lead.ref))!, edges.find(e => leadKey(e.lead_ref) === leadKey(lead.ref)), src.contact_number_id === null));
    for (const c of candidates) who.push(`  ${labels.get(leadKey(c.lead_ref))} ${c.lead_ref.model === "FormLead" ? "Form Lead" : "Call Lead"} · ${cleanText(c.source_company_label ?? "", 60) || "source unknown"}${c.job_no ? ` · Job ${cleanText(c.job_no, 30)}` : ""}${c.duplicate ? " · duplicate" : ""} · received ${fullTime(c.received_at)} · candidate (${c.basis.map(b => b.split(":")[0]).join(", ")}), not attached`);
  }
  const recordLabel = (r: CaseFileSources["records"][number]) => r.subject.kind === "lead" && r.subject.model && r.subject.id ? `${labelById.get(r.subject.id) ?? "Lead"} work` : "Number review";
  const multiRecord = src.records.length > 1;
  if (!src.records.length) who.push("Assigned rep: no Outreach record");
  for (const r of src.records) {
    const agent = r.responsible_agent_id ? cleanText(src.agents[r.responsible_agent_id] ?? `agent ${r.responsible_agent_id}`, 60) : null;
    const how = r.assignment ? ` (${ASSIGNMENT_LABELS[r.assignment.origin] ?? r.assignment.origin.replace(/_/g, " ")}${r.assignment.assigned_at ? `, ${fullDate(r.assignment.assigned_at)}` : ""})` : "";
    who.push(`Assigned rep${multiRecord ? ` (${recordLabel(r)})` : ""}: ${agent ? `${agent}${how}` : "none"}`);
  }
  for (const lead of attachedLeads) {
    const r = lead.receiver;
    const prefix = attachedLeads.length > 1 ? ` (${labels.get(leadKey(lead.ref))})` : "";
    who.push(`Receiver agent${prefix}: ${r?.name ? `${cleanText(r.name, 60)} [${r.source ? RECEIVER_SOURCE_LABELS[r.source] ?? r.source.replace(/_/g, " ") : "source not recorded"}${r.set_at ? `, set ${fullDate(r.set_at)}` : ""}]` : "none recorded"}`);
  }
  const repCounts = new Map<string, number>();
  for (const call of src.calls) { const side = sides.get(call.id)!; if (side.rep.kind !== "no_extension") repCounts.set(side.rep.short, (repCounts.get(side.rep.short) ?? 0) + 1); }
  who.push(`Phone reps seen: ${repCounts.size ? [...repCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([rep, n]) => `${rep} (${n} call${n === 1 ? "" : "s"})`).join(", ") : "none identified"}`);
  const humanReps = new Map<string, string>();
  for (const call of src.calls) { const side = sides.get(call.id)!; if (call.contact_type === "human_conversation" && side.rep.kind === "reviewed" && side.rep.agent_id) humanReps.set(side.rep.agent_id, side.rep.name!); }
  const receivers = attachedLeads.flatMap(l => (l.receiver?.agent_id && l.receiver.name ? [{ id: l.receiver.agent_id, name: l.receiver.name }] : []));
  if (humanReps.size && receivers.length && !receivers.some(r => humanReps.has(r.id)))
    who.push(`Note: calls were handled by ${[...humanReps.values()].sort().join(", ")}; the Receiver agent (Granot) is ${[...new Set(receivers.map(r => cleanText(r.name, 60)))].join(", ")}.`);

  // §2
  const origins: string[] = ["§2 HOW THE LEAD STARTED"];
  for (const lead of attachedLeads) origins.push(...originLines(lead, labels.get(leadKey(lead.ref))!, { calls: src.calls, sides, routes: src.vantage.routes }));
  if (!attachedLeads.length) {
    origins.push(src.contact_number_id ? "No Lead is attached to this number." : "No Lead.");
    const first = src.calls[0];
    if (first) { const side = sides.get(first.id)!; origins.push(`First call on record: ${fullTime(first.started_at)} · ${first.direction.toLowerCase()} ${vantageClauseText(side, first.direction, first.provider_connected, true)} [RingCentral]`); }
  }

  // §3
  const granot: string[] = ["§3 GRANOT NOW   (last known value per field, each with the observation time)"];
  for (const lead of attachedLeads) granot.push(...granotLines(lead, labels.get(leadKey(lead.ref))!, historyByLead.get(leadKey(lead.ref)), src.bookings));
  if (!attachedLeads.length) granot.push("No attached Lead: Granot state is shown only for attached Leads.");

  // Tail
  const human = src.calls.filter(c => c.contact_type === "human_conversation");
  const lastHuman = human.at(-1) ?? null;
  const unanswered = src.calls.filter(c => (!lastHuman || Date.parse(c.started_at) > Date.parse(lastHuman.started_at)) && c.contact_type !== "human_conversation" && c.direction === "Outbound");
  const tail = src.calls.length ? lastHuman
    ? `Tail: last human conversation ${timelineDate(lastHuman.started_at, asOf)} (${relativeDays(lastHuman.started_at, asOf)}).${unanswered.length ? ` ${unanswered.length} unanswered outbound attempt${unanswered.length === 1 ? "" : "s"} since.` : " No outbound attempt since."}`
    : `Tail: no human conversation on record; ${src.calls.length} call${src.calls.length === 1 ? "" : "s"}, ${unanswered.length} of them unanswered outbound attempts.`
    : "Tail: no calls on record.";

  // §5
  const open_work: string[] = ["§5 OPEN WORK NOW   [Vantage Outreach, as of this file]"];
  open_work.push(ledger.lines.length ? "Commitments ledger:" : "Commitments ledger: none recorded.");
  for (const line of ledger.lines) open_work.push(`  ${line.text}`);
  if (ledger.omitted) open_work.push(`  (${ledger.omitted} older commitment${ledger.omitted === 1 ? "" : "s"} not listed)`);
  const openActions = src.followups.filter(f => f.status === "open")
    .sort((a, b) => (Date.parse(a.due_at ?? "") || Number.MAX_SAFE_INTEGER) - (Date.parse(b.due_at ?? "") || Number.MAX_SAFE_INTEGER) || (a.id < b.id ? -1 : 1));
  open_work.push(openActions.length ? "Open actions:" : "Open actions: none.");
  for (const f of openActions) open_work.push(`  ${followupLabel(f.id)} ${followupKindLabel(f.kind)} "${cleanText(f.description ?? "", 160)}"${f.due_at ? ` due ${fullTime(f.due_at)}` : ""} (${originLabel(f.origin)}${f.precision ? `, ${f.precision}` : ""}) ${dueState(f.due_at, asOf)}`);
  const restrictions = src.restrictions.length ? src.restrictions.map(r => `${r.channels.join(", ") || "all channels"}${r.until ? ` until ${fullDate(r.until)}` : ""}`).join("; ") : "none";
  const reviewKinds = [...new Set(src.reviews_open.map(r => r.cause_kind.replace(/_/g, " ")))].sort();
  const reviews = src.reviews_open.length ? `${src.reviews_open.length} (${reviewKinds.join(", ")})` : "none";
  if (!src.records.length) open_work.push(`State: no Outreach record · Restrictions: ${restrictions} · Reviews open: ${reviews}`);
  for (const r of src.records) {
    const agent = r.responsible_agent_id ? cleanText(src.agents[r.responsible_agent_id] ?? `agent ${r.responsible_agent_id}`, 60) : "none";
    const state = r.state === "closed" ? `closed (${cleanText(r.closed_reason ?? "", 80) || "no reason"}${r.closure_origin ? `, ${r.closure_origin.replace(/_/g, " ")}` : ""})`
      : r.state === "waiting" && r.wait_until ? `waiting until ${fullTime(r.wait_until)}` : r.state;
    open_work.push(`State${multiRecord ? ` (${recordLabel(r)})` : ""}: ${state} · Assigned: ${agent} · Restrictions: ${restrictions} · Reviews open: ${reviews}`);
  }

  // §6
  const priorFindings: CasePriorFinding[] = [];
  const rolling: string[] = [], assessment: string[] = [], notes: string[] = [];
  const priorFindingIds = priorRecords.filter(r => r.record_type === "prior_finding").map(r => r.record_id);
  if (synthesis && src.audience === "findings") {
    const run = str(synthesis.fields.run_id);
    const coversText = src.synthesis_covers === null ? "covers: not recorded"
      : src.synthesis_covers.length ? `covers ${callRanges(src.synthesis_covers.flatMap(id => (cIndex.has(id) ? [cIndex.get(id)!] : []))) || "calls no longer summarized"}` : "covers no call";
    let sections = "";
    try { const details = JSON.parse(String(synthesis.fields.details ?? "{}")) as { sections?: Record<string, string> };
      sections = ["outcome", "commitments"].flatMap(k => (details.sections?.[k] ? [`${k}: ${cleanText(details.sections[k], 400)}`] : [])).join(" | "); } catch { sections = ""; }
    rolling.push(`Rolling summary (Number synthesis${run ? `, run …${run.slice(-6)}` : ""}, ${fullDate(str(synthesis.fields.happened_at))}, ${coversText}): ${cleanText(synthesis.fields.description ?? "", 600) || "no overview"}${sections ? ` | ${sections}` : ""}`);
  }
  if (src.audience === "findings") {
    priorRecords.filter(r => r.record_type === "prior_finding").forEach((r, p) => {
      const conversation = str(r.fields.conversation_id);
      const where = conversation && cIndex.has(conversation) ? `C${cIndex.get(conversation)}` : fullDate(str(r.fields.happened_at));
      const effects = Array.isArray(r.fields.effects) ? (r.fields.effects as Array<{ kind?: string; status?: string; target_id?: string | null }>)
        .map(e => `${String(e.kind ?? "effect").replace(/_/g, " ")} ${e.status ?? ""}${e.target_id && followupIndex.has(e.target_id) ? ` → ${followupLabel(e.target_id)}` : ""}`.trim()) : [];
      priorFindings.push({ p, id: r.record_id, review_state: str(r.fields.review_state),
        text: `  P${p} ${String(r.fields.kind ?? "finding").replace(/_/g, " ")} "${clip(cleanText(r.fields.description ?? "", 300), 200)}" (${where}, ${reviewWording(str(r.fields.review_state))}${r.fields.action_status ? `, ${r.fields.action_status}` : ""})${effects.length ? `; ${effects.join(", ")}` : ""}` });
    });
    if (src.prior?.page.missing_ranges.length) notes.push(`(earlier model output not shown: ${src.prior.page.missing_ranges.join(", ")})`);
  }
  const priorAssessment = priorRecords.find(r => r.record_type === "prior_assessment");
  if (priorAssessment) assessment.push(`Move assessment (${fullDate(str(priorAssessment.fields.happened_at))}): ${cleanText(priorAssessment.fields.description ?? "", 300)}`);

  // §7
  const focusText = [...focus].sort((a, b) => cIndex.get(a)! - cIndex.get(b)!).map(id => {
    const conversation = cConversations[cIndex.get(id)!]!;
    const call = conversation.call_interaction_id ? callById.get(conversation.call_interaction_id) : undefined;
    return `C${cIndex.get(id)} (${fullTime(conversation.started_at)}, ${(conversation.direction ?? call?.direction ?? "direction unknown").toLowerCase()}, ${duration(conversation.duration_seconds ?? call?.duration_seconds ?? null)})`;
  });
  const verb = src.audience === "assessment" ? "Assess" : "Analyze";
  const analyze = focusText.length ? `${verb}: ${focusText.join(", ")}. Earlier calls are context.` : `${verb}: no call is new in this run; the whole file is context.`;
  const known = src.coverage?.known_through ? `capture complete through ${fullTime(src.coverage.known_through)}` : "capture coverage not reported";
  const gaps = src.coverage?.gaps.length ? `; ${src.coverage.gaps.length} capture gap${src.coverage.gaps.length === 1 ? "" : "s"}` : "";
  const truncated = src.truncated_sources.length ? `; truncated sources: ${[...new Set(src.truncated_sources)].sort().join(", ")}` : "";
  const omitted = dropped ? `; ${dropped} older timeline event${dropped === 1 ? "" : "s"} omitted` : "";

  const header = [`CASE FILE (data) · ${src.e164 ? `Number ${src.e164}` : orderedLeads[0] ? `${labels.get(leadKey(orderedLeads[0].ref))} (no Contact Number)` : "no subject"} · as of ${fullTime(asOf)}`,
    "Sources: Vantage intake, RingCentral, Granot, Vantage Bookings, Vantage Outreach, Owner, Analysis."];

  const customerEvidence = { origins: origins.slice(1), calls: cConversations.map(c => ({ c: cIndex.get(c.id), at: c.started_at, direction: c.direction, duration_seconds: c.duration_seconds,
    summary: fullSummaryText(summaries.get(c.id)!.summary), said: summaries.get(c.id)!.summary.said_on_call.map(saidText) })) };
  return {
    version: src.version, audience: src.audience, as_of: asOf, header, who, origins, granot, timeline, tail, open_work,
    prior: { rolling, findings: priorFindings, assessment, notes }, run: { analyze, coverage: `Coverage: ${known}${gaps}${truncated}${omitted}.` },
    story_events: storyEvents, call_conversation_ids: cConversations.map(c => c.id), prior_finding_ids: priorFindingIds, followup_ids: [...allowed],
    granot_states: attachedLeads.map(l => granotState(l, historyByLead.get(leadKey(l.ref)), src.bookings)), candidates: src.candidates,
    customer_evidence: customerEvidence, coverage: { truncated_sources: [...new Set(src.truncated_sources)].sort(), timeline_dropped: dropped },
  };
}

/** payloadHash of the customer-evidence subset (§2 and the §4 call summaries): the assessment fingerprint input (§4.10). */
export const customerEvidenceDigest = (file: Pick<CaseFile, "customer_evidence">) => payloadHash(file.customer_evidence);
export type { CaseFollowup };
