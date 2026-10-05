/**
 * Quoted cadence (P04a–P04d, P05f Quoted reentry, P10a active schedules): one call per working date from
 * the first required date, opening 08:00 (or the command time for a same-day selection), due 20:00.
 * Without a selected date the first required date is the next working date strictly after entry.
 * A reschedule supersedes an open unfulfilled requirement (no miss) and never erases earlier misses.
 */
import { addDays, type BusinessCalendar } from "./calendar";
import { makeObligation, type WorkingObligation } from "./obligation";
import type { BusinessDate, EnginePolicy, EnginePolicyPeriod, EngineQuotedDatePlan, EngineQuotedState } from "./types";

export interface QuotedSegment {
  /** When this schedule takes effect. */
  at: number;
  /** First date with a requirement (dates before it are deferred). Non-working dates are skipped. */
  firstDate: BusinessDate;
  /** Opening of `firstDate` when the schedule starts that same day (command time or activation time). */
  sameDayOpens: number | null;
  basis: EngineQuotedState["basis"];
  plan_id: string | null;
}

export function quotedSegments(
  cal: BusinessCalendar,
  policy: EnginePolicy,
  period: EnginePolicyPeriod,
  startMs: number,
  plans: readonly (EngineQuotedDatePlan & { atMs: number })[],
): QuotedSegment[] {
  const startDate = cal.dateOf(startMs);
  const prior = plans.filter((p) => p.atMs <= startMs);
  const later = plans.filter((p) => p.atMs > startMs).sort((a, b) => a.atMs - b.atMs || a.revision - b.revision);
  const latestPrior = prior.sort((a, b) => a.atMs - b.atMs || a.revision - b.revision)[prior.length - 1];
  let seg0: QuotedSegment;
  if (latestPrior && period.start_kind === "activation" && latestPrior.selected_date <= startDate) {
    // P10a: an already-active verified schedule owes one activation-date call through 19:30.
    const owesToday = cal.minuteOf(startMs) <= policy.quoted.activation_call_through_minute && startMs < cal.closing(startDate);
    seg0 = {
      at: startMs,
      firstDate: owesToday ? startDate : addDays(startDate, 1),
      sameDayOpens: owesToday ? Math.max(startMs, cal.opening(startDate)) : null,
      basis: "activation_active_schedule",
      plan_id: latestPrior.plan_id,
    };
  } else if (latestPrior) {
    seg0 = planSegment(cal, { ...latestPrior, atMs: startMs });
  } else {
    // P04d/P05f/P10a: next working date strictly after the entry date; no entry-date call.
    seg0 = { at: startMs, firstDate: addDays(startDate, 1), sameDayOpens: null, basis: "next_working_date_default", plan_id: null };
  }
  return [seg0, ...later.map((p) => planSegment(cal, p))];
}

function planSegment(cal: BusinessCalendar, plan: EngineQuotedDatePlan & { atMs: number }): QuotedSegment {
  const commandDate = cal.dateOf(plan.atMs);
  const sameDay = plan.selected_date <= commandDate;
  return {
    at: plan.atMs,
    firstDate: sameDay ? commandDate : plan.selected_date,
    sameDayOpens: sameDay ? Math.max(plan.atMs, cal.opening(commandDate)) : null,
    basis: "human_selected",
    plan_id: plan.plan_id,
  };
}

/** The segment governing at an instant. */
export function governingSegment(segments: readonly QuotedSegment[], ms: number): QuotedSegment {
  let gov = segments[0]!;
  for (const s of segments) if (s.at <= ms) gov = s;
  return gov;
}

/** Quoted obligations of one working date (normally 0 or 1; a reschedule back to today can add one). */
export function quotedObligationsForDate(
  cal: BusinessCalendar,
  policy: EnginePolicy,
  periodId: string,
  date: BusinessDate,
  segments: readonly QuotedSegment[],
): WorkingObligation[] {
  const opening = cal.opening(date);
  const closing = cal.closing(date);
  const due = cal.at(date, policy.quoted.due_minute);
  const out: WorkingObligation[] = [];
  let active: WorkingObligation | null = null;
  const create = (opens: number, plan_id: string | null) => {
    active = makeObligation({ period_id: periodId, channel: "call", kind: "quoted", date, slot: out.length, opens, due, closes: closing, plan_id });
    out.push(active);
  };
  const gov = governingSegment(segments, opening);
  if (gov.firstDate <= date) {
    const opens = gov.firstDate === date && gov.sameDayOpens !== null ? gov.sameDayOpens : opening;
    if (opens < closing) create(opens, gov.plan_id);
  }
  for (const seg of segments) {
    if (seg.at <= opening || seg.at >= closing) continue;
    if (seg.firstDate <= date) {
      if (active === null) create(Math.max(seg.at, opening), seg.plan_id);
    } else if (active !== null) {
      (active as WorkingObligation).terminations.push({ at: seg.at, outcome: "superseded" });
      active = null;
    }
  }
  return out;
}

export type QuotedSelectionResult =
  | { allowed: true; activation_at_ms: number; due_at_ms: number }
  | { allowed: false; reason: "past_date" | "closed_date" | "after_same_day_cutoff" };

/**
 * P04c command validation for S1's quoted-followup command: future working dates, or today through the
 * configurable cutoff (19:30 inclusive); past and explicitly closed dates are rejected, never shifted.
 */
export function validateQuotedSelection(cal: BusinessCalendar, policy: EnginePolicy, commandMs: number, selected: BusinessDate): QuotedSelectionResult {
  const today = cal.dateOf(commandMs);
  if (selected < today) return { allowed: false, reason: "past_date" };
  if (!cal.isWorkingDate(selected)) return { allowed: false, reason: "closed_date" };
  if (selected === today) {
    if (cal.minuteOf(commandMs) > policy.quoted.same_day_cutoff_minute) return { allowed: false, reason: "after_same_day_cutoff" };
    return { allowed: true, activation_at_ms: Math.max(commandMs, cal.opening(today)), due_at_ms: cal.at(today, policy.quoted.due_minute) };
  }
  return { allowed: true, activation_at_ms: cal.opening(selected), due_at_ms: cal.at(selected, policy.quoted.due_minute) };
}
