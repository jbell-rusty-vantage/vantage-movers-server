/**
 * Explicit timed callbacks (P06e) and their effect on routine calls.
 *
 * - The requirement opens at the appointment and is due `callback_window_minutes` (15) later; an
 *   earlier call never fulfills it; a later qualifying call clears it while the miss stays in history.
 * - From the command until the end of the appointment date, unfinished routine Call requirements (and
 *   the initial response) are suspended — no miss; SMS is unaffected. Ordinary cadence resumes the next
 *   working date. A callback cancelled/replaced before its appointment stops suspending at that moment.
 * - Callbacks are subject-scoped: they survive nonterminal priority changes (P06f) and reassignment.
 */
import { addDays, startOfDate, type BusinessCalendar } from "./calendar";
import { makeObligation, type WorkingObligation } from "./obligation";
import type { EngineCallbackPlan, EnginePolicy } from "./types";

export interface TimedCallback {
  plan: EngineCallbackPlan;
  effectiveMs: number;
  appointmentMs: number;
  endedMs: number | null;
}

export function callbackObligation(cal: BusinessCalendar, policy: EnginePolicy, cb: TimedCallback): WorkingObligation {
  const ob = makeObligation({
    id: `callback:${cb.plan.plan_id}`,
    period_id: cb.plan.period_id,
    channel: "call",
    kind: "callback",
    date: cal.dateOf(cb.appointmentMs),
    slot: 0,
    opens: cb.appointmentMs,
    due: cb.appointmentMs + policy.callback.window_minutes * 60_000,
    closes: Number.POSITIVE_INFINITY,
    plan_id: cb.plan.plan_id,
  });
  if (cb.endedMs !== null) {
    ob.terminations.push({ at: cb.endedMs, outcome: cb.plan.end_reason === "cancelled" ? "cancelled" : "superseded" });
  }
  return ob;
}

/** End (exclusive) of the routine-call suspension a callback imposes. */
export function callbackSuspensionEnd(cal: BusinessCalendar, cb: TimedCallback): number {
  if (cb.endedMs !== null && cb.endedMs < cb.appointmentMs) return cb.endedMs;
  return startOfDate(addDays(cal.dateOf(cb.appointmentMs), 1), cal.timeZone);
}

/** Suspend unfinished routine call obligations (ordinary, quoted, initial response) in the interval. */
export function applyCallbackSuspension(cal: BusinessCalendar, cb: TimedCallback, obligations: readonly WorkingObligation[]): void {
  const end = callbackSuspensionEnd(cal, cb);
  if (end <= cb.effectiveMs) return;
  for (const ob of obligations) {
    if (ob.channel !== "call" || ob.kind === "callback") continue;
    if (ob.opens >= end) continue;
    if (ob.due !== null && ob.due <= cb.effectiveMs) continue; // earlier genuine misses stay
    if (ob.closes <= cb.effectiveMs) continue;
    ob.terminations.push({ at: Math.max(cb.effectiveMs, ob.opens), outcome: "suspended_callback" });
  }
}

/** Suspension intervals per callback (for catch-up prompt state). */
export function callbackSuspensionIntervals(cal: BusinessCalendar, callbacks: readonly TimedCallback[]): Array<[number, number]> {
  return callbacks.map((cb) => [cb.effectiveMs, Math.min(cb.appointmentMs, callbackSuspensionEnd(cal, cb))] as [number, number]).filter(([s, e]) => e > s);
}
