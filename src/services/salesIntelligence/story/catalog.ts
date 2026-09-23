import { STORY_EVENT_KINDS, type StoryActorKind, type StoryEvent, type StoryEventKind } from "./types";

/**
 * Event catalog helpers and the collapse rules (context provenance specification §4.4).
 * Everything here is pure: the same input always yields the same events in the same order.
 */
const KIND_ORDER = new Map<string, number>(STORY_EVENT_KINDS.map((kind, index) => [kind, index]));

/** Row order of §4.3; unknown kinds sort last so a future kind never displaces a known one. */
export function kindOrder(kind: string): number {
  return KIND_ORDER.get(kind) ?? STORY_EVENT_KINDS.length;
}

export const isStoryEventKind = (value: string): value is StoryEventKind => KIND_ORDER.has(value);

const PURPOSE_LABELS: Record<string, string> = {
  quote_request_confirmation: "quote request confirmation",
  granot_lead_created_confirmation: "Granot lead-created confirmation",
};
export const purposeLabel = (purpose: string | null | undefined) =>
  purpose ? PURPOSE_LABELS[purpose] ?? purpose.replace(/_/g, " ") : "text";

const CERTAINTY_LABELS: Record<string, string> = {
  exact: "Exact", likely: "Likely", unsure: "Unsure", owner_confirmed: "Confirmed by the Owner", rejected: "Rejected",
};
export const certaintyLabel = (certainty: string | null | undefined) =>
  certainty ? CERTAINTY_LABELS[certainty] ?? certainty : "unknown certainty";

const FOLLOWUP_KIND_LABELS: Record<string, string> = {
  call: "call", text_customer_via_lead_message: "text", send_estimate: "send estimate", check_availability: "check availability",
  review: "review", wait: "wait", reconcile_identity: "reconcile identity", other: "other",
};
export const followupKindLabel = (kind: string | null | undefined) => (kind ? FOLLOWUP_KIND_LABELS[kind] ?? kind.replace(/_/g, " ") : "follow-up");

const ORIGIN_LABELS: Record<string, string> = {
  owner: "Owner", rep_promise: "rep promise", customer_request: "customer request", customer_wait: "customer wait", system_default: "system default",
};
export const originLabel = (origin: string | null | undefined) => (origin ? ORIGIN_LABELS[origin] ?? origin.replace(/_/g, " ") : "origin unknown");

const COMPLETION_BASIS_LABELS: Record<string, string> = {
  owner: "by the Owner", call_attempt: "by a call attempt", customer_confirmation: "customer confirmed", rep_confirmation: "rep confirmed",
  vantage_evidence: "Vantage evidence",
};
export const completionBasisLabel = (basis: string | null | undefined) => (basis ? COMPLETION_BASIS_LABELS[basis] ?? basis.replace(/_/g, " ") : "basis unknown");

const WORK_STATUS_LABELS: Record<string, string> = {
  unknown: "unknown", not_contacted: "not contacted", worked_no_next_step: "worked, no next step", worked_with_next_step: "worked with a next step",
};
export const workStatusLabel = (status: string | null | undefined) => (status ? WORK_STATUS_LABELS[status] ?? status.replace(/_/g, " ") : "unknown");

/** Who a follow-up's origin speaks for (§4.3 follow-up rows). */
export function followupActorKind(origin: string | null | undefined): StoryActorKind {
  switch (origin) {
    case "owner": return "owner";
    case "rep_promise": return "rep";
    case "customer_request": case "customer_wait": return "customer";
    case "system_default": return "vantage";
    default: return "intelligence";
  }
}

/** Audit actors are `owner`/`worker`/`intelligence`; anything else is the worker. */
export function auditActorKind(kind: string | null | undefined): StoryActorKind {
  return kind === "owner" || kind === "intelligence" ? kind : "worker";
}

/**
 * `sales_intelligence_audit_events.event_kind` → story kind. Command names are the event
 * kinds (`followups/commands.ts`), so prefixes are matched; routine kinds are excluded by the
 * reader and anything unmapped is skipped.
 */
export function auditEventStoryKind(eventKind: string, invalidationKind?: string | null): StoryEventKind | null {
  if (eventKind === "add_note") return "owner_note";
  if (eventKind === "assign") return "assigned";
  if (eventKind === "start_call" || eventKind === "call_started") return "call_started";
  if (eventKind === "end_call" || eventKind === "call_ended") return "call_ended";
  if (eventKind.startsWith("close") || eventKind === "outreach_closed") return "closed";
  if (eventKind.startsWith("reopen")) return "reopened";
  if (eventKind.startsWith("wait") || eventKind === "set_waiting") return "waiting_set";
  if (eventKind.endsWith("review_opened") || eventKind === "open_number_review") return "review_opened";
  if (eventKind.endsWith("review_resolved") || eventKind === "resolve_review") return "review_resolved";
  if (eventKind === "restriction_resolved" || eventKind === "resolve_restriction") return "restriction_resolved";
  if (eventKind === "restriction" || eventKind === "restriction_set" || (invalidationKind === "restriction" && !eventKind.includes("resolved"))) return "restriction_set";
  if (eventKind.startsWith("nudge")) return "nudge_sent";
  return null;
}

/** Audit kinds that are routine bookkeeping, never story events (§4.3). */
export const EXCLUDED_AUDIT_EVENT_KINDS = [
  "clock_boundary", "outreach_interaction", "outreach_number_linked", "intelligence.submitted", "outreach_lead_attachment_mirrored",
  "attachment_refreshed", "projection_refreshed", "media_played",
] as const;

const ATTEMPT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PRIORITY_CHURN_MS = 60 * 60 * 1000;
export const MODEL_PAGE_OWNER_NOTES = 5;

const at = (event: StoryEvent) => Date.parse(event.happened_at);
const isAttempt = (event: StoryEvent) =>
  event.kind === "call" && event.detail.contact_type !== "human_conversation" && Number(event.detail.recording_count ?? 0) === 0 && !event.focus;

function attemptResultBucket(result: unknown): "voicemail" | "missed" | "no_answer" | "other" {
  const text = String(result ?? "").toLowerCase();
  if (text.includes("voicemail")) return "voicemail";
  if (text.includes("missed")) return "missed";
  if (text.includes("no answer") || text.includes("not answered") || text.includes("busy") || text.includes("rejected")) return "no_answer";
  return "other";
}

function attemptRun(run: StoryEvent[]): StoryEvent {
  const first = run[0]!, last = run[run.length - 1]!;
  const results = { voicemail: 0, missed: 0, no_answer: 0, other: 0 };
  for (const event of run) results[attemptResultBucket(event.detail.provider_result)] += 1;
  const interactionId = first.id.slice(first.id.indexOf(":") + 1);
  return {
    id: `call_attempts:${interactionId}`, kind: "call_attempts", happened_at: first.happened_at, observed_at: last.observed_at,
    subject_key: first.subject_key, actor: first.actor, record: { record_type: "story_event", record_id: `call_attempts:${interactionId}` },
    sentence: "", detail: { count: run.length, direction: first.detail.direction, from: first.happened_at, to: last.happened_at, results,
      interaction_ids: run.map(event => String(event.detail.interaction_id ?? event.id.slice(event.id.indexOf(":") + 1))) },
    evidence_refs: [...new Set(run.flatMap(event => event.evidence_refs))], collapsed_ids: run.map(event => event.id),
  };
}

function priorityRun(run: StoryEvent[]): StoryEvent {
  const first = run[0]!, last = run[run.length - 1]!;
  return { ...first, observed_at: last.observed_at,
    detail: { ...last.detail, from: first.detail.from, label_from: first.detail.label_from, change_id: last.detail.change_id,
      observation_id: last.detail.observation_id, churn_count: run.length, to_at: last.happened_at },
    evidence_refs: [...new Set(run.flatMap(event => event.evidence_refs))], collapsed_ids: run.map(event => event.id) };
}

/**
 * §4.4 collapse rules over an oldest-first list. Attempt runs (consecutive unconnected calls of
 * one direction within 7 days with nothing between them) become one `call_attempts`; Priority
 * churn within an hour becomes one change from the first `from` to the last `to`; only the
 * newest five Owner notes stay, the oldest kept note counting the rest in
 * `detail.older_notes_omitted`. Sentences are left empty: the caller renders after collapsing.
 */
export function collapseEvents(events: StoryEvent[]): StoryEvent[] {
  const out: StoryEvent[] = [];
  for (let index = 0; index < events.length;) {
    const event = events[index]!;
    if (isAttempt(event)) {
      const run = [event];
      while (index + run.length < events.length) {
        const next = events[index + run.length]!, previous = run[run.length - 1]!;
        if (!isAttempt(next) || next.detail.direction !== event.detail.direction || at(next) - at(previous) > ATTEMPT_WINDOW_MS) break;
        run.push(next);
      }
      out.push(run.length > 1 ? attemptRun(run) : event);
      index += run.length;
      continue;
    }
    if (event.kind === "granot_priority_changed") {
      const run = [event];
      while (index + run.length < events.length) {
        const next = events[index + run.length]!, previous = run[run.length - 1]!;
        if (next.kind !== "granot_priority_changed" || next.subject_key !== event.subject_key || at(next) - at(previous) > PRIORITY_CHURN_MS) break;
        run.push(next);
      }
      out.push(run.length > 1 ? priorityRun(run) : event);
      index += run.length;
      continue;
    }
    if (event.kind === "review_opened") {
      // Several review items opened by one application pass read as one event; the kinds are kept.
      const run = [event];
      while (index + run.length < events.length) {
        const next = events[index + run.length]!, previous = run[run.length - 1]!;
        if (next.kind !== "review_opened" || at(next) - at(previous) > PRIORITY_CHURN_MS) break;
        run.push(next);
      }
      out.push(run.length > 1 ? { ...event, id: `${event.id}:run`, record: { record_type: "story_event", record_id: `${event.id}:run` },
        detail: { ...event.detail, count: run.length, cause_kinds: run.map(e => e.detail.cause_kind).filter(Boolean), from: run[0]!.happened_at, to: run[run.length - 1]!.happened_at },
        evidence_refs: [...new Set(run.flatMap(e => e.evidence_refs))], collapsed_ids: run.map(e => e.id) } : event);
      index += run.length;
      continue;
    }
    out.push(event);
    index += 1;
  }
  const notes = out.filter(event => event.kind === "owner_note");
  if (notes.length <= MODEL_PAGE_OWNER_NOTES) return out;
  const dropped = new Set(notes.slice(0, notes.length - MODEL_PAGE_OWNER_NOTES).map(event => event.id));
  const oldestKept = notes[notes.length - MODEL_PAGE_OWNER_NOTES]!;
  return out.filter(event => !dropped.has(event.id)).map(event => event === oldestKept
    ? { ...event, detail: { ...event.detail, older_notes_omitted: dropped.size } } : event);
}

const ALWAYS_KEPT = new Set<StoryEventKind>(["lead_received", "number_attached", "booking_recorded", "cancellation_recorded", "closed"]);
const DROPPED_FIRST = new Set<StoryEventKind>(["call_attempts", "owner_note"]);

const isFocus = (event: StoryEvent, focusConversationId: string | null) =>
  Boolean(event.focus) || (focusConversationId !== null && event.detail.conversation_id === focusConversationId);

/**
 * §4.4 step 5 over an oldest-first collapsed list: newest `model_events` survive, but Lead
 * arrivals, attachment edges, bookings, cancellations, closures and the focus conversation are
 * never dropped. When those alone overflow, attempt runs and Owner notes go first, oldest first.
 */
export function boundModelPage(events: StoryEvent[], model_events: number, focusConversationId: string | null = null): { kept: StoryEvent[]; dropped: number } {
  const limit = Math.max(0, Math.trunc(model_events));
  if (events.length <= limit) return { kept: [...events], dropped: 0 };
  const protectedIndex = new Set<number>();
  events.forEach((event, index) => { if (ALWAYS_KEPT.has(event.kind) || isFocus(event, focusConversationId)) protectedIndex.add(index); });
  const droppable = events.map((event, index) => ({ event, index })).filter(({ index }) => !protectedIndex.has(index));
  // Oldest first within each tier; the first tier is attempt runs and Owner notes.
  const order = [...droppable.filter(({ event }) => DROPPED_FIRST.has(event.kind)), ...droppable.filter(({ event }) => !DROPPED_FIRST.has(event.kind))];
  const drop = new Set<number>();
  for (const { index } of order) {
    if (events.length - drop.size <= limit) break;
    drop.add(index);
  }
  return { kept: events.filter((_, index) => !drop.has(index)), dropped: drop.size };
}
