/**
 * `evaluateSubject(input, policy, as_of)` — the pure Sales Outreach cadence evaluator (SRV-4).
 *
 * It recomputes the subject's whole requirement history from inputs on every call (IMPLEMENTATION-PLAN
 * §6.1), so late evidence (P07f) and assignment responsibility at each deadline (P06d) are automatic:
 *
 * 1. derive obligations from periods (New / Quoted), the intake arrival, human plans and the calendar;
 * 2. apply terminations in precedence order: period end/closure → restriction → callback → cutover;
 * 3. walk verified contact events chronologically with the P02e spacing anchor, crediting at most one
 *    callback, the initial response, the period's channel catch-up and one ordinary requirement per event;
 * 4. resolve each obligation's outcome at `as_of` with honest coverage (pending, never a guessed miss);
 * 5. summarize independent Call and SMS requirements (a deadline only coverage cannot prove yet reads
 *    `due`, SPEC §10.3), flags, history, the next evaluation instant and `coverage_wait` (olr A1).
 *
 * No clock reads, no I/O. `node:crypto` is used only to hash the result for change detection.
 */
import { createHash } from "node:crypto";
import { addDays, BusinessCalendar, daysBetween, parseInstant, scheduleDay as calendarScheduleDay, startOfDate, toIso } from "./calendar";
import { applyCallbackSuspension, callbackObligation, callbackSuspensionIntervals, type TimedCallback } from "./callbacks";
import { CatchUpLedger } from "./catchup";
import { isCadenceQualifying } from "./credit";
import { applyCutoverGuard } from "./cutover";
import { arrivalDateObligations, fullNewDayObligations, initialResponseObligation } from "./newCadence";
import { earliestTermination, isCreditableAt, terminatedBeforeDeadline, type WorkingObligation } from "./obligation";
import { closureInstant, periodAt, subjectState, timedPeriods, type TimedPeriod } from "./precedence";
import { governingSegment, quotedObligationsForDate, quotedSegments, type QuotedSegment } from "./quoted";
import { partialStartNewObligations, priorSameDateCredit } from "./reentry";
import { activeRestrictionAt, applyRestrictionWaivers, blockIntervals, restrictionWindows, type RestrictionWindow } from "./restrictions";
import {
  OUTREACH_ENGINE_VERSION,
  type BusinessDate,
  type Channel,
  type ChannelStatus,
  type CompletionKind,
  type EngineCallbackState,
  type EngineChannelRequirement,
  type EngineContactEvent,
  type EngineObligation,
  type EnginePolicy,
  type EngineQuotedDatePlan,
  type EngineQuotedState,
  type EngineWindowChannelSummary,
  type EngineWindowHistoryEntry,
  type EvaluateSubjectInput,
  type EvaluateSubjectResult,
  type ObligationOutcome,
} from "./types";

const HORIZON_DAYS = 400;
const HISTORY_DATES = 30;
const ROUTINE_KINDS = new Set(["ordinary", "quoted"]);
const NO_MISS_OUTCOMES = new Set<ObligationOutcome>(["waived_restriction", "suspended_callback", "superseded", "cancelled", "blocked_reschedule", "legacy_review"]);

interface TimedEvent {
  event: EngineContactEvent;
  at: number;
  restricted: boolean;
}

interface Context {
  input: EvaluateSubjectInput;
  policy: EnginePolicy;
  cal: BusinessCalendar;
  asOf: number;
  today: BusinessDate;
  periods: TimedPeriod[];
  closureMs: number | null;
  receivedMs: number | null;
  activationMs: number;
  windows: RestrictionWindow[];
  events: TimedEvent[];
  callbacks: TimedCallback[];
  quotedSegmentsByPeriod: Map<string, QuotedSegment[]>;
  /** A6: spacing-anchor seeds at New partial starts (the last counted prior same-date call). */
  anchorSeeds: Array<{ at: number; anchor: number }>;
}

/** Why a passed deadline is `pending` (olr A1): coverage behind it, or unconfirmed evidence that may fulfil it. */
interface PendingDetail {
  reason: "coverage" | "evidence";
  /** Coverage does not reach the deadline yet (also true for evidence-pending items while coverage lags). */
  coverage_short: boolean;
}

export function evaluateSubject(input: EvaluateSubjectInput, policy: EnginePolicy, asOf: string): EvaluateSubjectResult {
  const ctx = buildContext(input, policy, asOf);
  const obligations = deriveObligations(ctx);
  const ledger = walkEvidence(ctx, obligations);
  const outcomes = new Map<string, ObligationOutcome>();
  const pending = new Map<string, PendingDetail>();
  for (const ob of obligations) {
    const resolved = resolveOutcome(ctx, ob);
    outcomes.set(ob.id, resolved.outcome);
    if (resolved.pending) pending.set(ob.id, resolved.pending);
  }
  return summarize(ctx, obligations, outcomes, pending, ledger);
}

/* -------------------------------------------------------------------------------------------------
 * Context
 * -----------------------------------------------------------------------------------------------*/

function buildContext(input: EvaluateSubjectInput, policy: EnginePolicy, asOfIso: string): Context {
  const cal = new BusinessCalendar(policy.calendar);
  const asOf = parseInstant(asOfIso);
  const periods = timedPeriods(input.periods).filter((p) => p.startMs <= asOf);
  const receivedMs = input.subject.received_at ? parseInstant(input.subject.received_at) : null;
  const windows = restrictionWindows(cal, input.restrictions);
  const seen = new Set<string>();
  const events: TimedEvent[] = [];
  for (const event of input.contact_events) {
    if (seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    let at = parseInstant(event.event_at);
    if (at > asOf) continue;
    const restricted = event.restricted_at_contact || activeRestrictionAt(windows, event.channel, at) !== null;
    // P07g originating answered inbound: it created the Call Lead, so it counts from the receipt instant.
    if (event.event_id === input.subject.originating_contact_event_id && receivedMs !== null) at = Math.max(at, receivedMs);
    events.push({ event, at, restricted });
  }
  events.sort((a, b) => a.at - b.at || a.event.event_id.localeCompare(b.event.event_id));
  const callbacks: TimedCallback[] = input.human_plans
    .filter((p) => p.kind === "callback")
    .map((plan) => ({
      plan,
      effectiveMs: parseInstant(plan.effective_at),
      appointmentMs: parseInstant(plan.appointment_at),
      endedMs: plan.ended_at === null ? null : parseInstant(plan.ended_at),
    }))
    .filter((cb) => cb.effectiveMs <= asOf)
    .sort((a, b) => a.effectiveMs - b.effectiveMs || a.plan.revision - b.plan.revision);
  return {
    input,
    policy,
    cal,
    asOf,
    today: cal.dateOf(asOf),
    periods,
    closureMs: closureInstant(input.subject, periods),
    receivedMs,
    activationMs: parseInstant(input.subject.activation_at),
    windows,
    events,
    callbacks,
    quotedSegmentsByPeriod: new Map(),
    anchorSeeds: [],
  };
}

/* -------------------------------------------------------------------------------------------------
 * 1–2. Obligations and terminations
 * -----------------------------------------------------------------------------------------------*/

function deriveObligations(ctx: Context): WorkingObligation[] {
  const { cal, policy } = ctx;
  let all: WorkingObligation[] = [];
  if (ctx.input.subject.status !== "review") {
    ctx.periods.forEach((period, index) => {
      if (period.workflow !== "new" && period.workflow !== "quoted") return;
      const endMs = Math.min(period.endMs, ctx.closureMs ?? Number.POSITIVE_INFINITY);
      if (endMs <= period.startMs) return;
      const obs = period.workflow === "new" ? newPeriodObligations(ctx, period, endMs) : quotedPeriodObligations(ctx, period, endMs);
      const next = ctx.periods[index + 1];
      const byClosure = (ctx.closureMs !== null && endMs >= ctx.closureMs) || next?.workflow === "closed";
      if (Number.isFinite(endMs)) {
        for (const ob of obs) if (ob.closes > endMs) ob.terminations.push({ at: endMs, outcome: byClosure ? "cancelled" : "superseded" });
      }
      all.push(...obs);
    });
  }
  const callbackObs = ctx.callbacks.map((cb) => {
    const ob = callbackObligation(cal, policy, cb);
    if (ctx.closureMs !== null) ob.terminations.unshift({ at: Math.max(ctx.closureMs, cb.effectiveMs), outcome: "cancelled" });
    return ob;
  });
  all.push(...callbackObs);
  applyRestrictionWaivers(ctx.windows, all);
  for (const cb of ctx.callbacks) {
    if (ctx.closureMs !== null && cb.effectiveMs >= ctx.closureMs) continue;
    applyCallbackSuspension(cal, cb, all);
  }
  all = applyCutoverGuard(ctx.activationMs, all);
  return all.sort((a, b) => a.opens - b.opens || a.id.localeCompare(b.id));
}

/** Iterate business dates of a period up to its end or, for the active period, past `as_of`. */
function* periodDates(ctx: Context, firstDate: BusinessDate, endMs: number, hasFutureObligation: () => boolean): Generator<BusinessDate> {
  const lastDate = Number.isFinite(endMs) ? ctx.cal.dateOf(endMs - 1) : null;
  for (let d = firstDate, i = 0; i < 20_000; d = addDays(d, 1), i += 1) {
    if (lastDate !== null && d > lastDate) return;
    if (d > ctx.today) {
      if (daysBetween(ctx.today, d) > HORIZON_DAYS) return;
      if (daysBetween(ctx.today, d) > 1 && hasFutureObligation()) return;
    }
    yield d;
  }
}

function newPeriodObligations(ctx: Context, period: TimedPeriod, endMs: number): WorkingObligation[] {
  const { cal, policy } = ctx;
  if (ctx.receivedMs === null) return []; // unknown age: review, never a guessed schedule
  const receivedDate = cal.dateOf(ctx.receivedMs);
  const startMs = period.start_kind === "intake" ? ctx.receivedMs : period.startMs;
  const startDate = cal.dateOf(startMs);
  const out: WorkingObligation[] = [];
  let initialDue: number | null = null;
  if (period.start_kind === "intake") {
    const ir = initialResponseObligation(cal, policy, period.period_id, ctx.receivedMs, blockIntervals(ctx.windows, "call"));
    initialDue = ir.due;
    if (ir.opens < endMs) out.push(ir);
  }
  const prior =
    period.start_kind === "intake"
      ? null
      : priorSameDateCredit(cal, policy, ctx.events, startMs, (_event, at) => {
          if (period.start_kind === "activation") return true;
          const active = periodAt(ctx.periods, at);
          return active !== null && active.period_id !== period.period_id && (active.workflow === "new" || active.workflow === "quoted");
        });
  // A6 (D-A6): a counted prior same-date call anchors P02e spacing from the start, so a call within
  // `spacing_minutes` of it is not credited again by this period.
  if (prior && prior.last_start !== null) ctx.anchorSeeds.push({ at: startMs, anchor: prior.last_start });
  // Generate past `as_of` until both channels show their next requirement (SMS dates are sparse).
  const future = () => out.some((ob) => ob.opens > ctx.asOf && ob.channel === "call") && out.some((ob) => ob.opens > ctx.asOf && ob.channel === "sms");
  for (const date of periodDates(ctx, startDate, endMs, future)) {
    if (!cal.isWorkingDate(date)) continue;
    const dayCtx = { cal, policy, period_id: period.period_id, date, scheduleDay: calendarScheduleDay(receivedDate, date) };
    let obs: WorkingObligation[];
    if (date === startDate) {
      obs = prior === null
        ? arrivalDateObligations(dayCtx, ctx.receivedMs, initialDue !== null && cal.dateOf(initialDue) === date ? initialDue : null)
        : partialStartNewObligations(dayCtx, startMs, prior);
    } else {
      obs = fullNewDayObligations(dayCtx);
    }
    out.push(...obs.filter((ob) => ob.opens < endMs));
  }
  return out;
}

function quotedPeriodObligations(ctx: Context, period: TimedPeriod, endMs: number): WorkingObligation[] {
  const { cal, policy } = ctx;
  const plans = ctx.input.human_plans
    .filter((p): p is EngineQuotedDatePlan => p.kind === "quoted_date" && p.period_id === period.period_id)
    .map((p) => ({ ...p, atMs: parseInstant(p.effective_at) }))
    .filter((p) => p.atMs <= ctx.asOf && p.atMs < endMs);
  const segments = quotedSegments(cal, policy, period, period.startMs, plans);
  ctx.quotedSegmentsByPeriod.set(period.period_id, segments);
  const out: WorkingObligation[] = [];
  const future = () => out.some((ob) => ob.opens > ctx.asOf);
  for (const date of periodDates(ctx, cal.dateOf(period.startMs), endMs, future)) {
    if (!cal.isWorkingDate(date)) continue;
    out.push(...quotedObligationsForDate(cal, policy, period.period_id, date, segments).filter((ob) => ob.opens < endMs && ob.opens >= period.startMs));
  }
  return out;
}

/* -------------------------------------------------------------------------------------------------
 * 3. Evidence walk
 * -----------------------------------------------------------------------------------------------*/

type TimelineItem =
  | { kind: "settle"; at: number; ob: WorkingObligation }
  | { kind: "period_end"; at: number; period: TimedPeriod }
  | { kind: "anchor_seed"; at: number; anchor: number }
  | { kind: "event"; at: number; ev: TimedEvent };

/** Same-instant order: settle, then period end, then the A6 anchor seed of a starting period, then events. */
const ORDER = { settle: 0, period_end: 1, anchor_seed: 1.5, event: 2 } as const;

function walkEvidence(ctx: Context, obligations: WorkingObligation[]): CatchUpLedger {
  const ledger = new CatchUpLedger();
  const items: TimelineItem[] = [];
  for (const ob of obligations) {
    if (!ROUTINE_KINDS.has(ob.kind)) continue;
    const term = earliestTermination(ob);
    const settleAt = Math.min(ob.closes, term?.at ?? Number.POSITIVE_INFINITY);
    if (settleAt <= ctx.asOf) items.push({ kind: "settle", at: settleAt, ob });
  }
  for (const period of ctx.periods) {
    const end = Math.min(period.endMs, ctx.closureMs ?? Number.POSITIVE_INFINITY);
    if (end <= ctx.asOf) items.push({ kind: "period_end", at: end, period });
  }
  for (const seed of ctx.anchorSeeds) if (seed.at <= ctx.asOf) items.push({ kind: "anchor_seed", at: seed.at, anchor: seed.anchor });
  for (const ev of ctx.events) items.push({ kind: "event", at: ev.at, ev });
  items.sort((a, b) => a.at - b.at || ORDER[a.kind] - ORDER[b.kind]);

  const spacingMs = ctx.policy.new_cadence.spacing_minutes * 60_000;
  let anchor: number | null = null;
  for (const item of items) {
    if (item.kind === "settle") {
      settle(ctx, ledger, item.ob, item.at);
      continue;
    }
    if (item.kind === "period_end") {
      ledger.endPeriod(item.period.period_id, item.at);
      continue;
    }
    if (item.kind === "anchor_seed") {
      anchor = anchor === null ? item.anchor : Math.max(anchor, item.anchor);
      continue;
    }
    const { event, at, restricted } = item.ev;
    const channel = event.channel;
    if (restricted || !isCadenceQualifying(event, channel)) continue;
    const spaced = channel === "sms" || anchor === null || at - anchor >= spacingMs;
    let credited = false;
    const fulfill = (ob: WorkingObligation) => {
      ob.fulfilledAt = at;
      ob.fulfilledBy = event.event_id;
      credited = true;
    };
    if (channel === "call") {
      const callback = obligations.find((ob) => ob.kind === "callback" && isCreditableAt(ob, at));
      if (callback) fulfill(callback);
    }
    if (spaced) {
      if (channel === "call") {
        const ir = obligations.find((ob) => ob.kind === "initial_response" && isCreditableAt(ob, at));
        if (ir) fulfill(ir);
      }
      const period = periodAt(ctx.periods, at);
      if (period && ledger.clear(period.period_id, channel, at, event.event_id)) credited = true;
      const ordinary = obligations
        .filter((ob) => ob.channel === channel && ROUTINE_KINDS.has(ob.kind) && isCreditableAt(ob, at))
        .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.slot - b.slot)[0];
      if (ordinary) fulfill(ordinary);
    }
    if (credited && channel === "call") anchor = at;
  }
  return ledger;
}

/** A routine window stops being creditable: record a genuine miss into the period's catch-up. */
function settle(ctx: Context, ledger: CatchUpLedger, ob: WorkingObligation, settleAt: number): void {
  if (ob.fulfilledAt !== null && ob.fulfilledAt <= settleAt) return;
  if (ob.due === null) return;
  const term = earliestTermination(ob);
  const missed = term !== null && term.at <= ob.closes ? ob.due < term.at : ob.due <= ob.closes;
  if (!missed) return;
  const period = ctx.periods.find((p) => p.period_id === ob.period_id);
  const periodEnd = Math.min(period?.endMs ?? Number.POSITIVE_INFINITY, ctx.closureMs ?? Number.POSITIVE_INFINITY);
  if (periodEnd <= settleAt) return; // superseded with its period; earlier history stays
  ledger.addMiss(ob, settleAt);
}

/* -------------------------------------------------------------------------------------------------
 * 4. Outcomes at as_of
 * -----------------------------------------------------------------------------------------------*/

function coverageComplete(ctx: Context, channel: Channel, through: number): boolean {
  const iso = ctx.input.coverage[channel].complete_through;
  return iso !== null && parseInstant(iso) >= through;
}

function hasUnconfirmedEvidence(ctx: Context, ob: WorkingObligation): boolean {
  const end = Math.min(ob.closes, ctx.asOf);
  return ctx.events.some(
    (e) =>
      e.event.channel === ob.channel &&
      e.at >= ob.opens &&
      e.at <= end &&
      !e.restricted &&
      (e.event.verification === "awaiting_confirmation" || e.event.verification === "pending_identity" || e.event.verification === "pending_association") &&
      (ob.channel === "call" ? e.event.kind === "outbound_attempt" || e.event.kind === "inbound_answered" : e.event.kind === "sms_sent"),
  );
}

type ResolvedOutcome = { outcome: ObligationOutcome; pending: PendingDetail | null };

const settled = (outcome: ObligationOutcome): ResolvedOutcome => ({ outcome, pending: null });

function resolveOutcome(ctx: Context, ob: WorkingObligation): ResolvedOutcome {
  const A = ctx.asOf;
  if (ob.fulfilledAt !== null && ob.fulfilledAt <= A) {
    const term = earliestTermination(ob);
    if (!(term && term.at < ob.fulfilledAt && term.at <= (ob.due ?? Infinity))) {
      return settled(ob.due !== null && ob.fulfilledAt > ob.due ? "fulfilled_late" : "fulfilled");
    }
  }
  const stopped = terminatedBeforeDeadline(ob, A);
  if (stopped) return settled(stopped.outcome);
  if (A < ob.opens) return settled("scheduled");
  if (ob.due === null || A < ob.due) return settled("open");
  // A passed deadline is a verdict only once coverage reaches it and no unconfirmed evidence could fulfil it.
  const covered = coverageComplete(ctx, ob.channel, ob.due);
  const unconfirmed = hasUnconfirmedEvidence(ctx, ob);
  if (!covered || unconfirmed) return { outcome: "pending", pending: { reason: unconfirmed ? "evidence" : "coverage", coverage_short: !covered } };
  const term = earliestTermination(ob);
  const fulfillable = A < ob.closes && !(term && term.at <= A);
  return settled(fulfillable ? "overdue" : "missed");
}

/* -------------------------------------------------------------------------------------------------
 * 5. Summary
 * -----------------------------------------------------------------------------------------------*/

function assignmentAt(ctx: Context, ms: number): string | null {
  let agent: string | null = null;
  let bestFrom = -Infinity;
  for (const a of ctx.input.assignments) {
    const from = parseInstant(a.from);
    const to = a.to === null ? Number.POSITIVE_INFINITY : parseInstant(a.to);
    if (from <= ms && ms < to && from >= bestFrom) {
      agent = a.agent_id;
      bestFrom = from;
    }
  }
  return agent;
}

function summarize(
  ctx: Context,
  obligations: WorkingObligation[],
  outcomes: Map<string, ObligationOutcome>,
  pending: Map<string, PendingDetail>,
  ledger: CatchUpLedger,
): EvaluateSubjectResult {
  const { cal, asOf: A, today } = ctx;
  const currentAssignee = assignmentAt(ctx, A);
  const current = periodAt(ctx.periods, A);
  const closed = ctx.closureMs !== null && ctx.closureMs <= A;
  const state = subjectState(ctx.input.subject, current, closed, ctx.receivedMs !== null);

  const exported: EngineObligation[] = obligations.map((ob) => {
    const outcome = outcomes.get(ob.id)!;
    const deadlineMissed = outcome === "missed" || outcome === "overdue" || outcome === "fulfilled_late";
    const responsible = ob.due !== null ? assignmentAt(ctx, Math.min(ob.due, A)) : currentAssignee;
    return {
      obligation_id: ob.id,
      period_id: ob.period_id,
      channel: ob.channel,
      kind: ob.kind,
      business_date: ob.date,
      slot_index: ob.slot,
      opens_at: toIso(ob.opens),
      due_at: ob.due === null ? null : toIso(ob.due),
      closes_at: Number.isFinite(ob.closes) ? toIso(ob.closes) : null,
      outcome,
      fulfilled_by_event_id: ob.fulfilledAt !== null && ob.fulfilledAt <= A ? ob.fulfilledBy : null,
      fulfilled_at: ob.fulfilledAt !== null && ob.fulfilledAt <= A ? toIso(ob.fulfilledAt) : null,
      deadline_missed: deadlineMissed,
      responsible_agent_id: responsible,
      inherited: deadlineMissed && responsible !== currentAssignee,
      plan_id: ob.plan_id,
    };
  });
  const byId = new Map(exported.map((o) => [o.obligation_id, o]));
  const suspensions = callbackSuspensionIntervals(cal, ctx.callbacks);

  const channelRequirement = (channel: Channel): EngineChannelRequirement => {
    const restriction = activeRestrictionAt(ctx.windows, channel, A);
    const mine = obligations.filter((ob) => ob.channel === channel);
    const todays = mine.filter((ob) => ob.date === today && ob.kind !== "initial_response");
    const counted = todays.filter((ob) => {
      const o = outcomes.get(ob.id)!;
      return !NO_MISS_OUTCOMES.has(o) || (ob.fulfilledAt !== null && ob.fulfilledAt <= A);
    });
    const done = counted.filter((ob) => ["fulfilled", "fulfilled_late"].includes(outcomes.get(ob.id)!));
    // P06e: a callback suspends routine Call prompts (catch-up and an overdue initial response) until
    // its appointment; the misses stay in history.
    const callSuspended = channel === "call" && suspensions.some(([s, e]) => A >= s && A < e);
    // A1.2 (SPEC §10.3, D-A1b): a passed deadline that only coverage cannot prove yet — no unconfirmed
    // evidence, and the channel has coverage (merely delayed) — stays an actionable `due` with its past
    // `due_at` ("not yet verified" at read time), so the lead stays in Needs contact. Its obligation is
    // still `pending` (never a guessed miss). Without any coverage (SMS not connected) it stays `pending`.
    const hasCoverage = ctx.input.coverage[channel].complete_through !== null;
    const coveragePending = (ob: WorkingObligation) => outcomes.get(ob.id) === "pending" && pending.get(ob.id)?.reason === "coverage" && hasCoverage;
    const unverified = new Set(
      mine
        .filter((ob) => coveragePending(ob) && !(callSuspended && ob.kind === "initial_response"))
        .filter((ob) => ob.date === today || ob.kind === "initial_response" || ob.kind === "callback")
        .map((ob) => ob.id),
    );
    const actionable = mine.filter((ob) => {
      const o = outcomes.get(ob.id)!;
      if (callSuspended && ob.kind === "initial_response") return false;
      if (o === "overdue" || unverified.has(ob.id)) return true;
      return o === "open" && (ob.date === today || ob.kind === "initial_response" || ob.kind === "callback");
    });
    const overdue = actionable.filter((ob) => outcomes.get(ob.id) === "overdue");
    // `pending` narrows to evidence uncertainty (and channels without coverage).
    const evidencePending = mine.filter((ob) => outcomes.get(ob.id) === "pending" && !unverified.has(ob.id));
    const group = ledger.outstanding(channel);
    let catchUpState: EngineChannelRequirement["catch_up"]["state"] = null;
    if (group) {
      if (restriction) catchUpState = "blocked";
      else if (callSuspended) catchUpState = "suspended";
      else if (group.members.every((m) => outcomes.get(m.id) === "pending")) catchUpState = "pending";
      else catchUpState = "actionable";
    }
    // A catch-up whose every member waits only on coverage reads due/unverified (its oldest deadline), not pending.
    const catchUpUnverified = catchUpState === "pending" && group !== null && group.members.every((m) => coveragePending(m));
    const oldestMissed = group ? Math.min(...group.members.map((m) => m.due ?? Infinity)) : null;
    const overdueDues = overdue.map((ob) => ob.due!).concat(catchUpState === "actionable" && oldestMissed !== null ? [oldestMissed] : []);
    const openDues = actionable
      .filter((ob) => (outcomes.get(ob.id) === "open" || unverified.has(ob.id)) && ob.due !== null)
      .map((ob) => ob.due!)
      .concat(catchUpUnverified && oldestMissed !== null && Number.isFinite(oldestMissed) ? [oldestMissed] : []);
    const futureScheduled = mine.some((ob) => outcomes.get(ob.id) === "scheduled");

    let status: ChannelStatus;
    let completion: CompletionKind | null = null;
    if (restriction) status = "blocked";
    else if (overdueDues.length > 0) status = "overdue";
    else if (evidencePending.some((ob) => ob.date === today || !ROUTINE_KINDS.has(ob.kind)) || (catchUpState === "pending" && !catchUpUnverified)) status = "pending";
    else if (openDues.length > 0 || actionable.length > 0) status = "due";
    else if (counted.length > 0 && done.length === counted.length) status = "completed";
    else if (futureScheduled) status = "scheduled";
    else status = "not_required";
    if (status === "completed") completion = done.some((ob) => outcomes.get(ob.id) === "fulfilled_late") ? "fulfilled_late" : "fulfilled_in_window";
    else if (status === "pending") completion = "evidence_pending";
    else if (status === "not_required" && todays.length > 0) {
      const outs = todays.map((ob) => outcomes.get(ob.id)!);
      if (outs.some((o) => o === "waived_restriction" || o === "suspended_callback")) completion = "waived";
      else if (outs.some((o) => o === "cancelled")) completion = "cancelled";
      else if (outs.some((o) => o === "superseded")) completion = "superseded";
    }
    const noCoverage = ctx.input.coverage[channel].complete_through === null;
    return {
      channel,
      required: counted.length,
      verified_completed: noCoverage && done.length === 0 ? null : done.length,
      remaining: noCoverage && done.length === 0 ? null : counted.length - done.length,
      due_at: openDues.length > 0 ? toIso(Math.min(...openDues)) : null,
      oldest_actionable_due_at: overdueDues.length > 0 && status !== "blocked" ? toIso(Math.min(...overdueDues)) : null,
      status,
      completion_kind: completion,
      blocked_reason: restriction ? restriction.restriction.reason ?? "contact_restriction" : null,
      blocked_until: restriction && Number.isFinite(restriction.releaseMs) ? toIso(restriction.releaseMs) : null,
      catch_up: {
        outstanding: group !== null,
        missed_count: group?.members.length ?? 0,
        oldest_missed_due_at: oldestMissed !== null && Number.isFinite(oldestMissed) ? toIso(oldestMissed) : null,
        state: catchUpState,
      },
    };
  };

  const call = channelRequirement("call");
  const sms = channelRequirement("sms");

  // Callback, initial response and Quoted state.
  const latestCallback = [...ctx.callbacks].reverse().find((cb) => cb.endedMs === null) ?? ctx.callbacks[ctx.callbacks.length - 1];
  let callback: EngineCallbackState | null = null;
  if (latestCallback) {
    const ob = byId.get(`callback:${latestCallback.plan.plan_id}`);
    if (ob) callback = { plan_id: latestCallback.plan.plan_id, appointment_at: ob.opens_at, due_at: ob.due_at!, outcome: ob.outcome, fulfilled_by_event_id: ob.fulfilled_by_event_id };
  }
  const ir = [...exported].reverse().find((o) => o.kind === "initial_response");
  let quoted: EngineQuotedState | null = null;
  if (current?.workflow === "quoted") {
    const segments = ctx.quotedSegmentsByPeriod.get(current.period_id);
    if (segments) {
      const gov = governingSegment(segments, A);
      quoted = { selected_date: gov.firstDate, first_required_date: cal.workingDateOnOrAfter(gov.firstDate), basis: gov.basis, plan_id: gov.plan_id };
    }
  }

  // P06b advisory warning (never a hard pause).
  const windowMs = ctx.policy.cooldown.window_hours * 3_600_000;
  const attempts = ctx.events.filter(
    (e) => e.event.channel === "call" && e.event.kind === "outbound_attempt" && e.event.verification === "confirmed" && e.event.outcome === "unanswered" && e.at > A - windowMs,
  );
  const cooldownWarning = attempts.length >= ctx.policy.cooldown.threshold;

  const moveDate = ctx.input.subject.move_date;
  const overdueObs = exported.filter((o) => o.outcome === "overdue");
  const routineActive = state === "active" || state === "no_routine_cadence" || state === "no_policy_configured" || state === "review";
  const flags = {
    needs_contact: routineActive && [call, sms].some((c) => c.status === "due" || c.status === "overdue"),
    overdue: [call, sms].some((c) => c.status === "overdue"),
    blocked: [call, sms].some((c) => c.status === "blocked"),
    pending: [call, sms].some((c) => c.status === "pending"),
    move_date_passed: moveDate !== null && moveDate < today,
    move_date_unknown: moveDate === null,
    advisory_cooldown: cooldownWarning,
    priority_uncertain: ctx.input.subject.priority_uncertain,
    review: state === "review" || state === "no_policy_configured",
    callback_blocked_reschedule: callback?.outcome === "blocked_reschedule",
    inherited_overdue: overdueObs.some((o) => o.inherited) || (call.catch_up.outstanding && [...(ledger.outstanding("call")?.members ?? [])].some((m) => byId.get(m.id)?.inherited)),
  };

  const oldest = [call.oldest_actionable_due_at, sms.oldest_actionable_due_at].filter((v): v is string => v !== null).sort()[0] ?? null;
  const futureDues = exported
    .filter((o) => (o.outcome === "open" || o.outcome === "scheduled") && o.due_at !== null && parseInstant(o.due_at) > A)
    .map((o) => o.due_at!)
    .sort();
  const nextEval = nextEvaluation(ctx, obligations, attempts.map((e) => e.at + windowMs));
  // A1.1: the earliest deadline per channel whose verdict waits on coverage (evidence-pending items
  // included: once coverage passes they may resolve); the evaluate sweep pulls on it.
  const coverageWait = (channel: Channel): string | null => {
    const dues = obligations.filter((ob) => ob.channel === channel && ob.due !== null && pending.get(ob.id)?.coverage_short === true).map((ob) => ob.due!);
    return dues.length > 0 ? toIso(Math.min(...dues)) : null;
  };

  const lastInteraction = ctx.events
    .filter((e) => e.event.verification === "confirmed" && ["outbound_attempt", "inbound_answered", "inbound_missed", "sms_sent", "sms_inbound"].includes(e.event.kind))
    .reduce<number | null>((max, e) => (max === null || e.at > max ? e.at : max), null);

  const { history, summary } = windowHistory(ctx, exported);
  const result: Omit<EvaluateSubjectResult, "fingerprint" | "input_fingerprint"> = {
    engine_version: OUTREACH_ENGINE_VERSION,
    policy_version: ctx.policy.policy_version,
    subject_id: ctx.input.subject.subject_id,
    computed_as_of: toIso(A),
    business_date: today,
    state,
    workflow: current?.workflow ?? null,
    period_id: current?.period_id ?? null,
    priority_raw: current?.priority_raw ?? null,
    schedule_day: ctx.receivedMs === null ? null : calendarScheduleDay(cal.dateOf(ctx.receivedMs), today),
    requirements: { call, sms },
    initial_response: ir ? { due_at: ir.due_at, outcome: ir.outcome, fulfilled_at: ir.fulfilled_at } : null,
    callback,
    quoted,
    cooldown: { warning: cooldownWarning, unsuccessful_attempts: attempts.map((e) => ({ event_id: e.event.event_id, event_at: toIso(e.at) })) },
    flags,
    oldest_actionable_due_at: oldest,
    next_action_due_at: futureDues[0] ?? null,
    next_evaluation_at: nextEval === null ? null : toIso(nextEval),
    coverage_wait: { call: coverageWait("call"), sms: coverageWait("sms") },
    last_interaction_at: lastInteraction === null ? null : toIso(lastInteraction),
    current_assignee_agent_id: currentAssignee,
    obligations: exported,
    window_history: history,
    history_summary: summary,
  };
  const { computed_as_of: _ignored, ...stable } = result;
  void _ignored;
  return {
    ...result,
    input_fingerprint: sha256(stableStringify({ input: ctx.input, policy: ctx.policy })),
    fingerprint: sha256(stableStringify(stable)),
  };
}

function nextEvaluation(ctx: Context, obligations: WorkingObligation[], extra: number[]): number | null {
  const A = ctx.asOf;
  const candidates: number[] = [...extra, startOfDate(addDays(ctx.today, 1), ctx.cal.timeZone)];
  for (const ob of obligations) {
    candidates.push(ob.opens, ob.closes);
    if (ob.due !== null) candidates.push(ob.due);
    for (const t of ob.terminations) candidates.push(t.at);
  }
  for (const w of ctx.windows) candidates.push(w.startMs, w.releaseMs, w.resumeMs);
  for (const [s, e] of callbackSuspensionIntervals(ctx.cal, ctx.callbacks)) candidates.push(s, e);
  const future = candidates.filter((t) => Number.isFinite(t) && t > A);
  return future.length > 0 ? Math.min(...future) : null;
}

function emptySummary(): EngineWindowChannelSummary {
  return { required: 0, completed: 0, missed: 0, waived: 0, superseded: 0, open: 0 };
}

function windowHistory(ctx: Context, exported: EngineObligation[]): { history: EngineWindowHistoryEntry[]; summary: EvaluateSubjectResult["history_summary"] } {
  const { cal, today } = ctx;
  const starts = [...ctx.periods.map((p) => cal.dateOf(p.startMs))];
  if (ctx.receivedMs !== null) starts.push(cal.dateOf(ctx.receivedMs));
  if (starts.length === 0) return { history: [], summary: { dates: 0, call_missed: 0, sms_missed: 0 } };
  const first = starts.sort()[0]!;
  const entries: EngineWindowHistoryEntry[] = [];
  const byDate = new Map<string, EngineObligation[]>();
  for (const o of exported) {
    if (o.kind === "initial_response") continue;
    const list = byDate.get(o.business_date) ?? [];
    list.push(o);
    byDate.set(o.business_date, list);
  }
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const entry: EngineWindowHistoryEntry = {
      business_date: d,
      schedule_day: ctx.receivedMs === null ? null : calendarScheduleDay(cal.dateOf(ctx.receivedMs), d),
      workflow: periodAt(ctx.periods, Math.min(startOfDate(addDays(d, 1), cal.timeZone) - 1, ctx.asOf))?.workflow ?? null,
      closed_date: !cal.isWorkingDate(d),
      call: emptySummary(),
      sms: emptySummary(),
    };
    for (const o of byDate.get(d) ?? []) {
      const s = entry[o.channel];
      if (o.outcome === "waived_restriction" || o.outcome === "suspended_callback" || o.outcome === "blocked_reschedule" || o.outcome === "legacy_review") s.waived += 1;
      else if (o.outcome === "superseded" || o.outcome === "cancelled") s.superseded += 1;
      else {
        s.required += 1;
        if (o.outcome === "fulfilled" || o.outcome === "fulfilled_late") s.completed += 1;
        if (o.outcome === "open" || o.outcome === "overdue" || o.outcome === "scheduled" || o.outcome === "pending") s.open += 1;
      }
      if (o.deadline_missed && (o.outcome === "missed" || o.outcome === "fulfilled_late" || o.outcome === "overdue")) s.missed += 1;
    }
    entries.push(entry);
  }
  const older = entries.slice(0, Math.max(0, entries.length - HISTORY_DATES));
  return {
    history: entries.slice(-HISTORY_DATES),
    summary: {
      dates: older.length,
      call_missed: older.reduce((n, e) => n + e.call.missed, 0),
      sms_missed: older.reduce((n, e) => n + e.sms.missed, 0),
    },
  };
}

/* -------------------------------------------------------------------------------------------------
 * Fingerprints
 * -----------------------------------------------------------------------------------------------*/

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
