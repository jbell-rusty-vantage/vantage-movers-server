import { redactTranscript } from "../../conversations/redaction";
import { certaintyLabel, completionBasisLabel, followupKindLabel, originLabel, purposeLabel, workStatusLabel } from "./catalog";
import type { StoryEvent, StoryEventKind, SubjectStory } from "./types";

/**
 * Sentence templates (context provenance specification §4.5). Pure and total-ordered: identical
 * input renders byte-identical text. Every free-text value (names, notes, reasons, Granot raw
 * text) passes through the transcript redactor and is clipped; nothing here is instruction.
 */
export type RenderContext = {
  timezone: string;
  /** Customer label already resolved by the assembler (Lead name → Granot name → caller ID → "the caller"). */
  customer: string;
  /** Full E.164, or null for a Lead-only subject. */
  phone: string | null;
  /** More than one Lead: attachment sentences name the Lead. */
  lead_count: number;
};
export type ProseOptions = { timezone: string };

export const SENTENCE_MAX = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

const clean = (value: unknown, max: number): string | null => {
  if (value === null || value === undefined) return null;
  const text = redactTranscript(String(value)).text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const capitalize = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

type Parts = { weekday: string; month: string; day: string; year: string; hour: string; minute: string; period: string; zone: string };
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timezone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timezone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" });
    formatters.set(timezone, cached);
  }
  return cached;
}
function parts(date: Date, timezone: string): Parts {
  const out: Record<string, string> = {};
  for (const part of formatter(timezone).formatToParts(date)) out[part.type] = part.value;
  return { weekday: out.weekday ?? "", month: out.month ?? "", day: out.day ?? "", year: out.year ?? "", hour: out.hour ?? "",
    minute: out.minute ?? "", period: out.dayPeriod ?? "", zone: timezone === "America/New_York" ? "ET" : out.timeZoneName ?? timezone };
}
const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(+date) ? null : date;
};
/** Calendar day number in the zone, for "later that day" / "the next day" / "n days later". */
function dayNumber(date: Date, timezone: string): number {
  const p = parts(date, timezone);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(p.month);
  return Math.floor(Date.UTC(Number(p.year), month < 0 ? 0 : month, Number(p.day)) / DAY_MS);
}
export const calendarDaysBetween = (from: Date, to: Date, timezone: string) => dayNumber(to, timezone) - dayNumber(from, timezone);

/** `Tue Sep 15, 2026 at 6:30 PM ET`. */
export function formatAbsolute(iso: string | null | undefined, timezone: string): string {
  const date = parse(iso);
  if (!date) return "an unknown time";
  const p = parts(date, timezone);
  return `${p.weekday} ${p.month} ${p.day}, ${p.year} at ${p.hour}:${p.minute} ${p.period} ${p.zone}`;
}
/** `Tue Sep 15, 2026` (time unknown or irrelevant). */
export function formatDate(iso: string | null | undefined, timezone: string, withWeekday = true): string {
  const date = parse(iso);
  if (!date) return "an unknown date";
  const p = parts(date, timezone);
  return `${withWeekday ? `${p.weekday} ` : ""}${p.month} ${p.day}, ${p.year}`;
}
/** `Mon Sep 21`, with the year only when it differs from the reference instant's year. */
export function formatShortDate(iso: string | null | undefined, timezone: string, reference: Date | null, withWeekday: boolean): string {
  const date = parse(iso);
  if (!date) return "an unknown date";
  const p = parts(date, timezone);
  const sameYear = reference ? parts(reference, timezone).year === p.year : true;
  return `${withWeekday ? `${p.weekday} ` : ""}${p.month} ${p.day}${sameYear ? "" : `, ${p.year}`}`;
}
/** Calendar dates (`YYYY-MM-DD`) render in UTC so the zone never shifts the day. */
export function formatCalendarDate(value: string | null | undefined): string | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(+date)) return null;
  const p = parts(date, "UTC");
  return `${p.month} ${p.day}, ${p.year}`;
}
const isUtcMidnight = (iso: string) => /T00:00:00(?:\.000)?Z$/.test(iso);

export function formatDuration(seconds: unknown): string {
  const total = num(seconds);
  if (total === null) return "duration unknown";
  const whole = Math.max(0, Math.round(total));
  if (whole < 60) return `${whole} s`;
  const hours = Math.floor(whole / 3600), minutes = Math.floor((whole % 3600) / 60), rest = whole % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const formatMoney = (value: unknown) => { const n = num(value); return n === null ? null : `$${money.format(n)}`; };

/** Kinds whose template carries its own `{when}`, or reads as a continuation; they take no connector. */
const NO_CONNECTOR: ReadonlySet<StoryEventKind> = new Set<StoryEventKind>(["lead_received", "call_qualified", "conversation_analyzed"]);
/** Kinds whose sentence states its own times (a leading absolute connector would repeat them). */
const SELF_TIMED: ReadonlySet<StoryEventKind> = new Set<StoryEventKind>(["lead_received", "call_qualified", "call_attempts"]);

/**
 * Relative connector between consecutive events (§4.5), computed from `happened_at` deltas in
 * the story zone; eight weeks or more falls back to the absolute date.
 */
export function connector(previous: Date, current: Date, timezone: string): string {
  const delta = +current - +previous;
  if (delta < 60 * 60 * 1000) return "Minutes later";
  const days = calendarDaysBetween(previous, current, timezone);
  if (days <= 0) return "Later that day";
  if (days === 1) return "The next day";
  if (days < 7) return `${days} days later`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks} weeks later`;
  return `On ${formatDate(current.toISOString(), timezone)}`;
}

const repLabel = (rep: unknown): string => {
  const r = (rep && typeof rep === "object" ? rep : {}) as { name?: unknown; status?: unknown; extension?: unknown };
  const name = clean(r.name, 80);
  if (r.status === "reviewed" && name) return name;
  const extension = str(r.extension);
  return extension ? `a rep (extension ${clean(extension, 20)}, identity not reviewed)` : "a Vantage line";
};
const flags = (detail: Record<string, unknown>) => {
  const list = [detail.duplicate ? "duplicate" : null, detail.bad_lead ? "bad lead" : null, detail.no_sync ? "no-sync" : null].filter((f): f is string => f !== null);
  return list.length ? `; flagged ${list.join(", ")}` : "";
};
const quoted = (value: unknown, max: number) => `"${clean(value, max) ?? ""}"`;

function leadReceived(event: StoryEvent, ctx: RenderContext): string {
  const d = event.detail;
  const customer = clean(event.actor.name, 80) ?? ctx.customer;
  const who = ctx.phone ? `${customer} (${ctx.phone})` : customer;
  const source = clean(d.source_company_label, 60) ?? "an unknown source";
  const when = formatAbsolute(event.happened_at, ctx.timezone);
  const job = str(d.job_no) ? ` (Job ${clean(d.job_no, 30)})` : "";
  if (d.model === "CallLead") return `${who} called ${source} on ${when}; the call qualified as a Call Lead${job}${flags(d)}.`;
  const size = clean(d.move_size, 40);
  const pickup = clean(d.pickup, 80), delivery = clean(d.delivery, 80);
  const route = pickup && delivery ? ` from ${pickup} to ${delivery}` : pickup ? ` from ${pickup}` : delivery ? ` to ${delivery}` : "";
  const moveDate = formatCalendarDate(str(d.move_date));
  return `${who} submitted a Form Lead on ${source} on ${when} for a ${size ? `${size} ` : ""}move${route}${moveDate ? `, move date ${moveDate}` : ""}${job}${flags(d)}.`;
}

function call(event: StoryEvent, ctx: RenderContext): string {
  const d = event.detail;
  const focus = event.focus ? " (this call)" : "";
  const rep = repLabel(d.rep);
  const duration = formatDuration(d.duration_seconds);
  const recorded = Number(d.recording_count ?? 0) > 0;
  const result = clean(d.provider_result, 40) ?? "result not reported";
  if (d.direction === "Inbound") {
    if (d.provider_connected) return `${ctx.customer} called in; ${rep} answered, ${duration}${recorded ? ", recorded" : ""}${d.contact_type === "human_conversation" ? ", human conversation" : d.contact_type === "voicemail" ? ", voicemail" : ""}${focus}.`;
    return `${ctx.customer} called in; not answered (${result})${focus}.`;
  }
  if (d.direction === "Outbound") {
    if (!d.provider_connected) return `${rep} made an outbound call: not connected (${result})${focus}.`;
    return `${rep} made an outbound call: connected, ${duration}, ${recorded ? "recorded" : "not recorded"}${d.contact_type === "human_conversation" ? ", human conversation" : d.contact_type === "voicemail" ? ", voicemail" : ""}${focus}.`;
  }
  return `a ${String(d.direction ?? "unknown").toLowerCase()} call was logged (${result}, ${duration})${focus}.`;
}

function callAttempts(event: StoryEvent, ctx: RenderContext): string {
  const d = event.detail;
  const results = (d.results && typeof d.results === "object" ? d.results : {}) as Record<string, unknown>;
  const buckets = [["voicemail", "voicemail"], ["missed", "missed"], ["no_answer", "no answer"], ["other", "other"]]
    .map(([key, label]) => [num(results[key!]) ?? 0, label] as const).filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  return `${num(d.count) ?? 0} ${String(d.direction ?? "").toLowerCase()} attempts between ${formatAbsolute(str(d.from), ctx.timezone)} and ${formatAbsolute(str(d.to), ctx.timezone)}, none connected (${buckets.join(", ") || "results not reported"}).`;
}

function numberAttached(event: StoryEvent, ctx: RenderContext): string {
  const d = event.detail;
  const lead = ctx.lead_count > 1 && str(d.lead_name) ? ` ${clean(d.lead_name, 60)}` : "";
  const reason = clean(d.reason, 120);
  const why = `(${certaintyLabel(str(d.certainty))}${reason ? `, ${reason}` : ""})`;
  switch (d.state) {
    case "attached": return `this number was attached to the Lead${lead} ${why}.`;
    case "ambiguous": return `this number was marked ambiguous for the Lead${lead} ${why}.`;
    case "rejected": return `this number was rejected for the Lead${lead} ${why}.`;
    default: return `this number became a candidate for the Lead${lead} ${why}.`;
  }
}

function granotObserved(event: StoryEvent): string {
  const d = event.detail;
  const priority = str(d.priority) ? `Priority ${clean(d.priority, 10)} (${clean(d.priority_label, 30)})` : "no Priority set";
  const extras = [str(d.booking_action) ? `booking action ${clean(d.booking_action, 40)}` : null, str(d.estimate) ? `estimate ${clean(d.estimate, 30)}` : null,
    str(d.payment) ? `payment ${clean(d.payment, 30)}` : null, str(d.balance) ? `balance ${clean(d.balance, 30)}` : null,
    str(d.rep_raw) ? `rep ${clean(d.rep_raw, 40)}` : null].filter((x): x is string => x !== null);
  return `Granot recorded the Lead with ${priority}${extras.length ? `, ${extras.join(", ")}` : ""}.`;
}

function followupCreated(event: StoryEvent, ctx: RenderContext): string {
  const d = event.detail;
  const due = str(d.due_at) ? ` due ${formatShortDate(str(d.due_at), ctx.timezone, parse(event.happened_at), true)}` : "";
  return `a follow-up was recorded: ${followupKindLabel(str(d.kind))} ${quoted(d.description, 160)}${due} (${originLabel(str(d.origin))}).`;
}

/** The sentence without its connector; lowercase-led unless it begins with a name. */
export function renderSentence(event: StoryEvent, ctx: RenderContext): string {
  const d = event.detail;
  let text: string;
  switch (event.kind) {
    case "lead_received": text = leadReceived(event, ctx); break;
    case "call_qualified": text = `RingCentral qualified the call${str(d.qualification_reason) ? `: ${clean(d.qualification_reason, 100)}` : ""}.`; break;
    case "lead_message_sent": text = `Vantage sent the customer a ${purposeLabel(str(d.purpose))} text (${clean(d.status, 30) ?? "status unknown"}).`; break;
    case "call": text = call(event, ctx); break;
    case "call_attempts": text = callAttempts(event, ctx); break;
    case "conversation_recorded": text = `a recorded conversation was captured (${clean(d.state, 30) ?? "state unknown"}, ${formatDuration(d.duration_seconds)})${event.focus ? " (this call)" : ""}.`; break;
    case "conversation_analyzed": {
      const count = num(d.findings_count) ?? 0;
      const next = str(d.next_step_kind) ? `; next step: ${clean(d.next_step_kind, 40)}` : "";
      text = `That call was analyzed: ${quoted(d.overview_first_sentence, 200)} (${count} finding${count === 1 ? "" : "s"}${next}).`; break;
    }
    case "number_attached": text = numberAttached(event, ctx); break;
    case "granot_priority_changed": {
      const rep = str(d.granot_rep_raw) ? ` by ${clean(d.granot_rep_raw, 40)}` : "";
      text = str(d.from) === null
        ? `Granot Priority was set to ${clean(d.to, 10)} (${clean(d.label_to, 30)})${rep}.`
        : `Granot Priority changed from ${clean(d.from, 10)} (${clean(d.label_from, 30)}) to ${clean(d.to, 10) ?? "none"} (${clean(d.label_to, 30)})${rep}.`; break;
    }
    case "quoted_changed": text = d.quoted === false ? "the Lead's Quoted mark was removed in Granot." : "the Lead was marked Quoted in Granot."; break;
    case "granot_observed": text = granotObserved(event); break;
    case "booking_recorded": {
      const binder = formatMoney(d.total_binder_amount), deposit = formatMoney(d.deposit_amount);
      text = `a Booking was recorded (Job ${clean(d.job_no, 30) ?? "unknown"}${binder ? `, binder ${binder}` : ""}${deposit ? `, deposit ${deposit}` : ""}).`; break;
    }
    case "cancellation_recorded": text = `the Booking was cancelled${str(d.reason) ? `: ${clean(d.reason, 120)}` : ""}.`; break;
    case "followup_created": text = followupCreated(event, ctx); break;
    case "followup_completed": text = `that follow-up (${quoted(d.description, 80)}) was completed (${completionBasisLabel(str(d.completion_basis))}).`; break;
    case "followup_cancelled": text = `the follow-up ${quoted(d.description, 80)} was cancelled${str(d.cancel_reason) ? `: ${clean(d.cancel_reason, 100)}` : ""}.`; break;
    case "followup_superseded": text = `the follow-up ${quoted(d.description, 80)} was superseded.`; break;
    case "assigned": text = `the Owner assigned the work to ${clean(d.agent_name, 60) ?? (str(d.agent_id) ? `agent ${clean(d.agent_id, 30)}` : "no one")}.`; break;
    case "owner_note": text = `the Owner noted: ${quoted(d.note, 200)}.`; break;
    case "closed": text = `the work was closed: ${clean(d.reason, 120) ?? "no reason recorded"}.`; break;
    case "reopened": text = `the Owner reopened the work${str(d.reason) ? `: ${clean(d.reason, 120)}` : ""}.`; break;
    case "waiting_set": text = `the work was set to wait${str(d.until) ? ` until ${formatDate(str(d.until), ctx.timezone)}` : ""}${str(d.reason) ? `: ${clean(d.reason, 120)}` : ""}.`; break;
    case "review_opened": {
      const kinds = Array.isArray(d.cause_kinds) ? (d.cause_kinds as unknown[]).map(k => (clean(k, 40) ?? "").replace(/_/g, " ")).filter(Boolean) : str(d.cause_kind) ? [(clean(d.cause_kind, 40) ?? "").replace(/_/g, " ")] : [];
      const count = typeof d.count === "number" && d.count > 1 ? d.count : 1;
      text = `${count > 1 ? `${count} reviews were opened for the Owner` : "a review was opened for the Owner"}${kinds.length ? ` (${[...new Set(kinds)].join(", ")})` : str(d.reason) ? ` (${clean(d.reason, 80)})` : ""}.`; break;
    }
    case "review_resolved": text = `the review was resolved${str(d.reason) ? ` (${clean(d.reason, 80)})` : ""}.`; break;
    case "restriction_set": text = `a contact restriction was set${Array.isArray(d.channels) && d.channels.length ? ` on ${clean(d.channels.join(", "), 40)}` : ""}${str(d.until) ? ` until ${formatDate(str(d.until), ctx.timezone)}` : ""}.`; break;
    case "restriction_resolved": text = "the contact restriction was resolved."; break;
    case "nudge_sent": text = `a rep nudge was sent${str(d.channel) ? ` via ${clean(d.channel, 30)}` : ""}.`; break;
    case "call_started": text = "the Owner started a call."; break;
    case "call_ended": text = `the Owner ended the call${str(d.note) ? `: ${clean(d.note, 120)}` : ""}.`; break;
    case "assessment_published": text = `a Move assessment was published: transaction intent ${num(d.transaction_intent) ?? "unknown"}, move likelihood ${num(d.move_likelihood) ?? "unknown"}, work status ${workStatusLabel(str(d.work_status))}.`; break;
    case "owner_correction": text = `the Owner corrected ${clean(d.field, 30) ?? "the record"}${d.current !== undefined && d.current !== null ? `: ${clean(typeof d.current === "string" ? d.current : JSON.stringify(d.current), 120)}` : ""}.`; break;
    default: text = `${String(event.kind).replace(/_/g, " ")}.`;
  }
  return clip(redactTranscript(text).text, SENTENCE_MAX);
}

export type TailInput = {
  /** Newest contact instant (call, message, conversation), or null. */
  last_contact_at: string | null;
  as_of: string;
  open_followups: Array<{ kind: string | null; description: string | null; due_at: string | null }>;
};

/** `No contact since …` and `Open now: …` (§4.5 tail). */
export function renderTail(input: TailInput, options: ProseOptions): string {
  const asOf = parse(input.as_of) ?? new Date(0);
  const sentences: string[] = [];
  const last = parse(input.last_contact_at);
  if (last) {
    const days = Math.max(0, calendarDaysBetween(last, asOf, options.timezone));
    sentences.push(`No contact since ${formatShortDate(last.toISOString(), options.timezone, asOf, true)} (${days} day${days === 1 ? "" : "s"} before this analysis).`);
  } else sentences.push("No contact recorded.");
  for (const followup of input.open_followups) {
    const due = parse(followup.due_at);
    let when = "(no due date)";
    if (due) {
      const days = calendarDaysBetween(due, asOf, options.timezone);
      const state = days > 0 ? `overdue by ${days} day${days === 1 ? "" : "s"}` : days === 0 ? "due today" : `due in ${-days} day${days === -1 ? "" : "s"}`;
      when = `due ${formatShortDate(due.toISOString(), options.timezone, asOf, false)} (${state})`;
    }
    sentences.push(clip(redactTranscript(`Open now: ${followupKindLabel(followup.kind)} ${quoted(followup.description, 160)} ${when}.`).text, SENTENCE_MAX));
  }
  return sentences.join(" ");
}

/**
 * The paragraph: opening, each event with its connector, then the tail. Events must already be
 * oldest first with rendered sentences; the connector is computed here from `happened_at`.
 */
export function renderStoryProse(story: Pick<SubjectStory, "opening" | "events" | "tail">, options: ProseOptions): string {
  const pieces: string[] = [];
  if (story.opening.trim()) pieces.push(story.opening.trim());
  let previous: Date | null = null;
  for (const event of story.events) {
    const current = parse(event.happened_at);
    const sentence = event.sentence.trim();
    if (!sentence) continue;
    if (NO_CONNECTOR.has(event.kind)) pieces.push(capitalize(sentence));
    else if (previous && current) pieces.push(`${connector(previous, current, options.timezone)} ${sentence}`);
    else if (current && !SELF_TIMED.has(event.kind)) pieces.push(`On ${isUtcMidnight(event.happened_at) ? formatDate(event.happened_at, options.timezone) : formatAbsolute(event.happened_at, options.timezone)} ${sentence}`);
    else pieces.push(capitalize(sentence));
    if (current) previous = current;
  }
  if (story.tail.trim()) pieces.push(story.tail.trim());
  return pieces.join(" ");
}

// ---------------------------------------------------------------------------------------------
// Owner timeline copy (final specification §10.2; data spec §5.2 adapter). The description the
// Owner reads is `renderTimelineSentence`, i.e. the same sentence the model reads; the title is
// the short §10.2 heading. Nothing above this line changes for the model's story page.
// ---------------------------------------------------------------------------------------------

/** `Sep 20, 3:10 PM ET`, with the year only when it differs from the reference instant's year (§3.3). */
export function formatTimelineTime(iso: string | null | undefined, timezone: string, reference: Date | null): string {
  const date = parse(iso);
  if (!date) return "Time unknown";
  const p = parts(date, timezone);
  const sameYear = reference ? parts(reference, timezone).year === p.year : true;
  return `${p.month} ${p.day}${sameYear ? "" : `, ${p.year}`}, ${p.hour}:${p.minute} ${p.period} ${p.zone}`;
}

const OWNER_CERTAINTY_LABELS: Record<string, string> = { exact: "Exact", likely: "Likely", unsure: "Unsure", owner_confirmed: "Confirmed by you", rejected: "Rejected" };
const sentenceCase = (value: string) => capitalize(value.replace(/_/g, " "));

/**
 * The sentence for the Owner timeline: `renderSentence` capitalised, plus the two kinds the
 * model never sees (`followup_snoozed`, `analysis_submitted`).
 */
export function renderTimelineSentence(event: StoryEvent, ctx: RenderContext): string {
  const d = event.detail;
  const kind = event.kind as string;
  if (kind === "followup_snoozed") return clip(redactTranscript(`The follow-up was snoozed${str(d.until) ? ` until ${formatAbsolute(str(d.until), ctx.timezone)}` : ""}${str(d.reason) ? `: ${clean(d.reason, 120)}` : ""}.`).text, SENTENCE_MAX);
  if (kind === "analysis_submitted") return "An analysis run was submitted for processing.";
  return capitalize(renderSentence(event, ctx));
}

/** The §10.2 title of one timeline event. `reference` is the response `as_of` (year rule). */
export function renderTimelineTitle(event: StoryEvent, ctx: RenderContext, reference: Date | null): string {
  const d = event.detail;
  const when = (value: unknown) => formatTimelineTime(str(value), ctx.timezone, reference);
  let title: string;
  switch (event.kind as string) {
    case "lead_received": title = d.model === "CallLead" ? "Call Lead created after Call Qualification" : `Form Lead received from ${clean(d.source_company_label, 60) ?? "an unknown source"}`; break;
    case "call_qualified": title = "Call qualified as a Lead"; break;
    case "call": title = `${d.direction === "Inbound" ? "Inbound" : d.direction === "Outbound" ? "Outbound" : sentenceCase(String(d.direction ?? "Unknown"))} call · ${clean(d.provider_result, 40) ?? "result not reported"} · ${formatDuration(d.duration_seconds)}`; break;
    case "conversation_recorded": title = "Recorded conversation captured"; break;
    case "conversation_analyzed": title = "Conversation analyzed"; break;
    case "assessment_published": title = `Assessment published · Transaction intent ${num(d.transaction_intent) ?? "not scored"} · Move likelihood ${num(d.move_likelihood) ?? "not scored"}`; break;
    case "granot_priority_changed": title = `Granot Priority ${clean(d.to, 10) ?? "cleared"}${str(d.label_to) ? ` (${clean(d.label_to, 30)})` : ""}`; break;
    case "quoted_changed": title = d.quoted === false ? "Quoted mark removed in Granot" : "Marked Quoted in Granot"; break;
    case "granot_observed": title = "Granot record observed"; break;
    case "number_attached": {
      const verb = d.state === "rejected" ? "Number rejected for this Lead" : d.state === "ambiguous" ? "Number marked ambiguous for this Lead" : d.state === "attached" ? "Number attached to this Lead" : "Number is a candidate for this Lead";
      const certainty = str(d.certainty) ? OWNER_CERTAINTY_LABELS[str(d.certainty)!] ?? clean(d.certainty, 30) : null;
      title = [verb, certainty, clean(d.reason, 60)].filter((p): p is string => Boolean(p)).join(" · "); break;
    }
    case "followup_created":
      title = d.kind === "call" ? (str(d.due_at) ? `Callback promised for ${when(d.due_at)}` : "Callback promised · no due date")
        : `Follow-up created · ${followupKindLabel(str(d.kind))}${str(d.due_at) ? ` · due ${when(d.due_at)}` : ""}`; break;
    case "followup_completed": title = `Follow-up completed · ${completionBasisLabel(str(d.completion_basis))}`; break;
    case "followup_snoozed": title = str(d.until) ? `Snoozed until ${when(d.until)}` : "Follow-up snoozed"; break;
    case "followup_cancelled": title = `Follow-up cancelled · ${clean(d.cancel_reason, 80) ?? "no reason recorded"}`; break;
    case "followup_superseded": title = "Follow-up replaced by a later one"; break;
    case "assigned": title = `Assigned to ${clean(d.agent_name, 60) ?? (str(d.agent_id) ? `agent ${clean(d.agent_id, 30)}` : "no one")}`; break;
    case "owner_note": title = "Owner note"; break;
    case "closed": title = `Closed · ${clean(d.reason, 60) ?? "no reason recorded"}`; break;
    case "reopened": title = "Reopened"; break;
    case "waiting_set": title = str(d.until) ? `Waiting until ${when(d.until)}` : "Set to wait"; break;
    case "review_opened": title = "Review opened"; break;
    case "review_resolved": title = "Review resolved"; break;
    case "restriction_set": title = "Contact restriction set"; break;
    case "restriction_resolved": title = "Contact restriction resolved"; break;
    case "nudge_sent": title = `Rep nudge sent${str(d.channel) ? ` · ${clean(d.channel, 30)}` : ""}`; break;
    case "call_started": title = "Call started"; break;
    case "call_ended": title = "Call ended"; break;
    case "analysis_submitted": title = "Analysis submitted"; break;
    case "owner_correction": title = `You corrected ${clean(String(d.field ?? "the record").replace(/_/g, " "), 30)}`; break;
    case "booking_recorded": {
      const binder = formatMoney(d.total_binder_amount);
      title = ["Booked", binder ? `binder ${binder}` : null, clean(d.agent_name, 60)].filter((p): p is string => Boolean(p)).join(" · "); break;
    }
    case "cancellation_recorded": title = `Cancelled · ${clean(d.reason, 80) ?? "no reason recorded"}`; break;
    case "lead_message_sent": title = `Text sent to the customer · ${purposeLabel(str(d.purpose))} · ${clean(d.status, 30) ?? "status unknown"}`; break;
    default: title = sentenceCase(String(event.kind));
  }
  return clip(redactTranscript(title).text, 160);
}
