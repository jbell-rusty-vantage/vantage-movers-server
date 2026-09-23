import type { AttentionFilterKeysDto, AttentionOutcome, AttentionOutcomeDto, OutreachFactsDto } from "../dto";
import { assessmentApplicability, assessmentSortKeys, moveAssessmentProjectionDto, type ApplicabilityInput, type ProjectionRow } from "../assessment/presentation";
import { priorityLabel } from "./leadProgress";
import { moveViewsForLead, type LeadMoveSource } from "../assessment/views";
import { attentionDue } from "./derive";
import type { FollowupRow, RecordRow } from "./types";

/**
 * Data spec §3.3: the card facts for one Outreach Record, pure over rows the
 * caller already loaded. Two callers: the Attention publish (at publish time,
 * frozen on the snapshot row) and `GET /outreach/:id` (at request time). Every
 * boolean and enum is decided at `now` (§3.8 rule 1); nothing reads a clock.
 *
 * The return is a structure so S2 can add `filter_keys` and `outcome` next to
 * `facts` and `sort_keys` without changing either caller.
 */

/** The Contact Number rollups the facts read (§2.1); counts written before S1-ROLLUP read 0 until the rebuild sweep. */
export type FactsNumber = {
  rollups?: {
    interactions_total?: number | null;
    human_conversations_total?: number | null;
    recordings_total?: number | null;
    conversations_analyzed_total?: number | null;
    last_inbound_at?: Date | null;
    last_outbound_at?: Date | null;
  } | null;
} | null;

export type FactsRecord = ApplicabilityInput & Pick<RecordRow, "subject"> & {
  next_action?: { followup_id?: unknown } | null;
  move_assessment?: (Partial<ProjectionRow> & { status?: string | null; latest_conversation_at?: Date | string | null; conflict_targets?: readonly string[] | null }) | null;
  // S2 (filter keys and the closed outcome); optional so S1 callers and fixtures still type-check.
  responsible_agent_id?: unknown;
  trigger_at?: Date | string | null;
  closed_reason?: string | null;
  closed_at?: Date | string | null;
  closure_origin?: string | null;
  lead_progress?: ApplicabilityInput["lead_progress"] & { granot_priority?: string | null } | null;
};

/** A Booking row with the widened publish projection (§3.2). */
export type FactsBooking = { _id: unknown; book_date?: Date | string | null; total_binder_amount?: number | null; job_no?: string | null; agent?: unknown };
/** A Cancellation row (§3.2); `booked_lead` names its Booking when the caller has it. */
export type FactsCancellation = { _id: unknown; cancel_date?: Date | string | null; reason?: string | null; booked_lead?: unknown };

export type FactsInput = {
  record: FactsRecord;
  /** The record's follow-ups (the same list `derive()` reads). */
  followups: readonly (Pick<FollowupRow, "_id" | "status" | "due_at" | "base_attention_due_at" | "snoozed_until"> & { responsible_agent_id?: unknown; promised_by_agent_id?: unknown })[];
  /** The primary Contact Number, or null when the record has none. */
  number: FactsNumber;
  /** The subject Lead with the widened publish projection (§3.2), or null. */
  lead: LeadMoveSource | null;
  /** The subject Lead's exact Booking and Cancellation rows (closed outcome, §3.5). */
  bookings: readonly FactsBooking[];
  cancellations: readonly FactsCancellation[];
  /** Agent names the page already loaded (`Booked · {agent}`); a missing name reads null. */
  agentNames?: ReadonlyMap<string, string>;
  now: Date;
};

/** Assessment conflict targets that make the card's route line disagree with the customer (V7). */
export const ROUTE_CONFLICT_TARGETS = ["pickup_location", "delivery_location", "move_date"] as const;
const ROUTE_CONFLICTS = new Set<string>(ROUTE_CONFLICT_TARGETS);
const FACTS_TIME_ZONE = "America/New_York";
const DAY_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: FACTS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD of `at` in America/New_York: the calendar day flips at ET midnight, not UTC. */
export function easternDay(at: Date): string {
  const parts = Object.fromEntries(DAY_PARTS.formatToParts(at).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (value == null) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(+at) ? null : at;
};
const latest = (...values: Array<Date | null | undefined>): Date | null =>
  values.reduce<Date | null>((best, at) => (at && (!best || +at > +best) ? at : best), null);
const count = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/**
 * `next_action_state` for the record's `next_action` at `now`. It uses the same
 * `attentionDue` and the same `<= now` boundary as `derive()`, so an `overdue`
 * next action is exactly one of `derived.action_facts[].overdue`. Closed and
 * identity-review work is not actionable in `derive()` (no band, `overdue`
 * false), so it reports `none` here and the card never contradicts the band.
 * A snooze postpones `attention_due_at`; a contractual `due_at` in the past
 * under a snooze is therefore `due`, as in `derive()`.
 */
export function nextActionState(record: Pick<FactsRecord, "state" | "next_action">, followups: FactsInput["followups"], now: Date): OutreachFactsDto["next_action_state"] {
  if (record.state === "closed" || record.state === "identity_review") return "none";
  const id = record.next_action?.followup_id;
  const action = id == null ? undefined : followups.find(row => String(row._id) === String(id) && row.status === "open");
  if (!action) return "none";
  const due = attentionDue(action);
  if (!due) return "no_due_date";
  return +due <= +now ? "overdue" : "due";
}

/** One malformed Lead must not throw inside the all-or-nothing Attention walk: its card shows no route instead. */
function safeCanonicalView(lead: Parameters<typeof moveViewsForLead>[0], model: "FormLead" | "CallLead") {
  try {
    return moveViewsForLead(lead, model).canonical_current;
  } catch {
    return null;
  }
}

export function outreachFacts(input: FactsInput) {
  const { record, number, lead, now } = input;
  const model = record.subject.kind === "lead" ? record.subject.model : null;
  const view = lead && (model === "FormLead" || model === "CallLead") ? safeCanonicalView(lead, model) : null;
  const route: OutreachFactsDto["route"] = view ? { pickup_city: view.pickup.city, pickup_state: view.pickup.state,
    delivery_city: view.delivery.city, delivery_state: view.delivery.state, move_date: view.move_date, source: "lead" } : null;
  const rollups = number ? number.rollups ?? {} : null;
  const lastCall = rollups ? latest(rollups.last_inbound_at, rollups.last_outbound_at) : null;
  const assessment = record.move_assessment ?? null;
  const active = assessmentApplicability(record) === "active";
  const coveredThrough = toDate(assessment?.latest_conversation_at);
  const facts: OutreachFactsDto = {
    route,
    move_date_passed: Boolean(route?.move_date && route.move_date < easternDay(now)),
    last_call_at: lastCall?.toISOString() ?? null,
    calls_total: rollups ? count(rollups.interactions_total) : null,
    conversations_total: rollups ? count(rollups.human_conversations_total) : null,
    recordings_available: rollups ? count(rollups.recordings_total) : null,
    recordings_analyzed: rollups ? count(rollups.conversations_analyzed_total) : null,
    // Same gate as `moveAssessmentProjectionDto`: a closed or terminal subject's assessment is not a card state.
    newer_call_since_assessment: active && Boolean(coveredThrough && lastCall && +lastCall > +coveredThrough),
    details_disagree: Boolean(assessment && assessment.status !== "purged" && (assessment.conflict_targets ?? []).some(target => ROUTE_CONFLICTS.has(target))),
    next_action_state: nextActionState(record, input.followups, now),
    rep_thread: null,
  };
  const outcome = closedOutcome(input, facts.calls_total);
  return { facts, sort_keys: { last_call: facts.last_call_at, interactions: facts.calls_total }, filter_keys: recordFilterKeys(input, facts, outcome), outcome };
}

/** The record-owned filter keys (data spec §3.3). The publish adds `band`, `needs_review` and `state` from the derived row. */
export type RecordFilterKeys = Omit<AttentionFilterKeysDto, "band" | "needs_review" | "state">;
const SCORED = new Set(["ready", "insufficient_evidence"]);
const isoOf = (value: Date | string | null | undefined) => toDate(value)?.toISOString() ?? null;

export function recordFilterKeys(input: Pick<FactsInput, "record" | "followups">, facts: OutreachFactsDto, outcome: AttentionOutcomeDto | null): RecordFilterKeys {
  const { record } = input;
  // V10: assigned ∪ follow-up responsible ∪ promised, over every follow-up the row carries (the legacy match's set).
  const agents = [...new Set([record.responsible_agent_id, ...input.followups.flatMap(row => [row.responsible_agent_id, row.promised_by_agent_id])]
    .filter(value => value != null && value !== "").map(String))].sort();
  const active = assessmentApplicability(record) === "active";
  // Same projection the row's `outreach.move_assessment` and score sort keys come from (not actionable → null).
  const scores = assessmentSortKeys(record.move_assessment?.status ? moveAssessmentProjectionDto(record as Parameters<typeof moveAssessmentProjectionDto>[0], false) : null);
  return {
    agents,
    attachment: record.subject.kind === "lead" ? "lead" : "none",
    priority: record.lead_progress?.granot_priority ?? null,
    has_recording: (facts.recordings_available ?? 0) > 0,
    has_assessment: active && SCORED.has(record.move_assessment?.status ?? ""),
    newer_call: facts.newer_call_since_assessment,
    ti: scores.transaction_intent,
    ml: scores.move_likelihood,
    received_at: record.subject.kind === "lead" ? isoOf(record.trigger_at) : null,
    move_date: facts.route?.move_date ?? null,
    outcome: outcome?.reason ?? null,
    closed_at: outcome?.closed_at ?? null,
  };
}

/** Official reasons that are Closed-view outcomes (`transitions.ts` `officialClosure`). */
const OFFICIAL_OUTCOMES = new Set<AttentionOutcome>(["booked", "cancelled", "bad_lead", "duplicate", "no_sync"]);
/**
 * Data spec §3.5 mapping from `closure_origin` / `closed_reason`. Null for a record that is not
 * closed and for closures that are not outcomes: the Number-review `lead_context_available`
 * (`ensure.ts`) and the command path's `lead_unavailable` (`followups/commands.ts`), both official.
 */
export function outcomeReason(record: Pick<FactsRecord, "state" | "closed_reason" | "closure_origin">): AttentionOutcome | null {
  if (record.state !== "closed") return null;
  const reason = record.closed_reason ?? "";
  if (record.closure_origin === "owner") return "owner";
  if (record.closure_origin === "crm_disposition") return reason === "granot_dead_opportunity" ? "crm_dead" : reason === "granot_bad_unusable" ? "crm_bad_unusable" : null;
  if (record.closure_origin === "official") return OFFICIAL_OUTCOMES.has(reason as AttentionOutcome) ? reason as AttentionOutcome : null;
  return null;
}
const since = (at: Date | null, from: Date | null) => (at && from ? Math.max(0, +at - +from) : null);

/**
 * The Closed view's outcome line inputs (data spec §3.5, final spec §8). `time_to_close_ms`:
 * booked = `book_date − trigger_at`, cancelled = `cancel_date − trigger_at`, otherwise
 * `closed_at − trigger_at`; null when that instant is missing, and clamped at 0 when a
 * date-only Booking/Cancellation precedes the Lead's arrival on the same day.
 */
export function closedOutcome(input: Pick<FactsInput, "record" | "bookings" | "cancellations" | "agentNames">, callsTotal: number | null): AttentionOutcomeDto | null {
  const { record } = input;
  const reason = outcomeReason(record);
  const closedAt = toDate(record.closed_at);
  if (!reason || !closedAt) return null;
  const trigger = toDate(record.trigger_at);
  const byBookDate = [...input.bookings].sort((a, b) => +(toDate(b.book_date) ?? 0) - +(toDate(a.book_date) ?? 0));
  const cancellation = reason === "cancelled"
    ? [...input.cancellations].sort((a, b) => +(toDate(b.cancel_date) ?? 0) - +(toDate(a.cancel_date) ?? 0))[0] ?? null : null;
  const cancelledIds = new Set(input.cancellations.map(row => String(row.booked_lead ?? "")));
  const booking = reason === "cancelled"
    ? byBookDate.find(row => cancellation?.booked_lead != null && String(row._id) === String(cancellation.booked_lead)) ?? byBookDate[0] ?? null
    : reason === "booked" ? byBookDate.find(row => !cancelledIds.has(String(row._id))) ?? byBookDate[0] ?? null : null;
  const time = reason === "booked" ? since(toDate(booking?.book_date), trigger)
    : reason === "cancelled" ? since(toDate(cancellation?.cancel_date), trigger)
    : since(closedAt, trigger);
  const code = record.lead_progress?.granot_priority ?? null;
  return {
    reason,
    origin: record.closure_origin as AttentionOutcomeDto["origin"],
    closed_at: closedAt.toISOString(),
    time_to_close_ms: time,
    calls_total: callsTotal,
    booking: booking ? { id: String(booking._id), book_date: isoOf(booking.book_date), total_binder_amount: typeof booking.total_binder_amount === "number" ? booking.total_binder_amount : null,
      job_no: booking.job_no ?? null, agent_name: booking.agent != null ? input.agentNames?.get(String(booking.agent)) ?? null : null } : null,
    cancellation: cancellation ? { id: String(cancellation._id), cancel_date: isoOf(cancellation.cancel_date), reason: cancellation.reason ?? null } : null,
    priority: (reason === "crm_dead" || reason === "crm_bad_unusable") && code != null ? { code, label: priorityLabel(code) } : null,
    note: reason === "owner" ? record.closed_reason ?? null : null,
  };
}
export type OutreachFactsResult = ReturnType<typeof outreachFacts>;
