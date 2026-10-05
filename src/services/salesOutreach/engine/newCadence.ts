/**
 * New cadence (P01, P02d–P02h, P03): age bands, fixed SMS days, the arrival-date allowance and the
 * 30-working-minute initial response. Partial start dates after a transition or activation are in
 * reentry.ts (P05f/P10a).
 */
import type { BusinessCalendar } from "./calendar";
import { makeObligation, type WorkingObligation } from "./obligation";
import type { BusinessDate, EngineDayAllowance, EngineNewCallBand, EnginePolicy } from "./types";

export function newCallBandFor(scheduleDay: number, policy: EnginePolicy): EngineNewCallBand {
  const bands = policy.new_cadence.call_bands;
  return bands.find((b) => scheduleDay >= b.first_day && (b.last_day === null || scheduleDay <= b.last_day)) ?? bands[bands.length - 1]!;
}

/** P03: fixed SMS sequence by schedule day (Days 1/2/3 then 6, 9, 12…); extra/missed sends never shift it. */
export function isFixedSmsDay(scheduleDay: number, policy: EnginePolicy): boolean {
  const c = policy.new_cadence;
  if (c.sms_initial_days.includes(scheduleDay)) return true;
  return scheduleDay >= c.sms_later_first_day && (scheduleDay - c.sms_later_first_day) % c.sms_later_interval_days === 0;
}

/** P02g/P05f: calls allowed on a partial start date by local minute (before / through / after). */
export function partialDayCallCap(minute: number, allowance: EngineDayAllowance): number {
  if (minute < allowance.two_calls_before_minute) return 2;
  if (minute <= allowance.one_call_through_minute) return 1;
  return 0;
}

export interface NewDayContext {
  cal: BusinessCalendar;
  policy: EnginePolicy;
  period_id: string;
  date: BusinessDate;
  scheduleDay: number;
}

/** A full New working date: band deadlines (first 12:00, second 20:00…) and the fixed-day SMS. */
export function fullNewDayObligations(ctx: NewDayContext): WorkingObligation[] {
  const { cal, policy, date, period_id } = ctx;
  const band = newCallBandFor(ctx.scheduleDay, policy);
  const opens = cal.opening(date);
  const closes = cal.closing(date);
  const out = band.deadline_minutes.map((minute, slot) =>
    makeObligation({ period_id, channel: "call", kind: "ordinary", date, slot, opens, due: cal.at(date, minute), closes, plan_id: null }),
  );
  if (isFixedSmsDay(ctx.scheduleDay, policy)) {
    out.push(makeObligation({ period_id, channel: "sms", kind: "ordinary", date, slot: 0, opens, due: cal.at(date, policy.new_cadence.sms_due_minute), closes, plan_id: null }));
  }
  return out;
}

/**
 * The arrival date of a fresh intake (P02g/P02h): before 18:00 two calls, 18:00–19:30 one, later zero.
 * The first call's deadline is the initial-response deadline (replacing noon); others are due at the
 * band's last deadline (20:00). One SMS when arrival is at/before 19:30 on a fixed SMS day.
 */
export function arrivalDateObligations(ctx: NewDayContext, receivedMs: number, initialDueMs: number | null): WorkingObligation[] {
  const { cal, policy, date, period_id } = ctx;
  const closes = cal.closing(date);
  const arrivalMinute = cal.dateOf(receivedMs) === date ? cal.minuteOf(receivedMs) : 0;
  if (receivedMs >= closes) return [];
  const band = newCallBandFor(ctx.scheduleDay, policy);
  const count = Math.min(band.deadline_minutes.length, partialDayCallCap(arrivalMinute, policy.arrival));
  const opens = Math.max(receivedMs, cal.opening(date));
  const lastDeadline = cal.at(date, band.deadline_minutes[band.deadline_minutes.length - 1] ?? policy.calendar.closing_minute);
  const out: WorkingObligation[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const due = slot === 0 && initialDueMs !== null ? Math.min(initialDueMs, lastDeadline) : lastDeadline;
    out.push(makeObligation({ period_id, channel: "call", kind: "ordinary", date, slot, opens, due, closes, plan_id: null }));
  }
  if (arrivalMinute <= policy.arrival.sms_through_minute && isFixedSmsDay(ctx.scheduleDay, policy)) {
    out.push(makeObligation({ period_id, channel: "sms", kind: "ordinary", date, slot: 0, opens, due: cal.at(date, policy.new_cadence.sms_due_minute), closes, plan_id: null }));
  }
  return out;
}

/**
 * P02d initial response: one call within N working minutes of normalized receipt; unused minutes carry
 * across closing/closed dates; P06c restriction intervals pause it. Satisfiable after hours (P07g).
 */
export function initialResponseObligation(
  cal: BusinessCalendar,
  policy: EnginePolicy,
  period_id: string,
  receivedMs: number,
  callBlocks: ReadonlyArray<readonly [number, number]>,
): WorkingObligation {
  const due = cal.addWorkingMinutes(receivedMs, policy.arrival.initial_response_working_minutes, callBlocks);
  return makeObligation({
    period_id,
    channel: "call",
    kind: "initial_response",
    date: cal.dateOf(due ?? receivedMs),
    slot: 0,
    opens: receivedMs,
    due,
    closes: Number.POSITIVE_INFINITY,
    plan_id: null,
  });
}
