/**
 * Partial start date of a New period that did not start with a fresh arrival (P05a/P05f reentry, P10a
 * activation): original received-date age; subtract earlier qualifying same-date calls from the
 * age-based quota; cap by start time (before 18:00 ≤2, 18:00–19:30 ≤1, later 0); every call due at
 * closing (no fabricated noon miss); no initial-response clock. SMS only on a fixed SMS date when the
 * start is at/before 19:30, and an earlier qualifying same-date SMS already fulfills it.
 */
import type { BusinessCalendar } from "./calendar";
import { isCadenceQualifying, selectSpacedStarts } from "./credit";
import { isFixedSmsDay, newCallBandFor, partialDayCallCap, type NewDayContext } from "./newCadence";
import { makeObligation, type WorkingObligation } from "./obligation";
import type { EngineContactEvent, EnginePolicy } from "./types";

export interface PriorSameDateCredit {
  calls: number;
  sms_event: EngineContactEvent | null;
}

/**
 * Earlier qualifying contact on the start date, before `startMs`. `counts(event)` filters events to
 * those that may count (transition: made while New or Quoted was active; activation: any verified).
 * Calls are spaced among themselves (P02e) so a burst never counts twice.
 */
export function priorSameDateCredit(
  cal: BusinessCalendar,
  policy: EnginePolicy,
  events: readonly { event: EngineContactEvent; at: number; restricted: boolean }[],
  startMs: number,
  counts: (event: EngineContactEvent, at: number) => boolean,
): PriorSameDateCredit {
  const date = cal.dateOf(startMs);
  const sameDate = events.filter((e) => e.at < startMs && cal.dateOf(e.at) === date && !e.restricted && counts(e.event, e.at));
  const callStarts = sameDate.filter((e) => isCadenceQualifying(e.event, "call")).map((e) => e.at);
  const sms = sameDate.find((e) => isCadenceQualifying(e.event, "sms"))?.event ?? null;
  return { calls: selectSpacedStarts(callStarts, policy.new_cadence.spacing_minutes).length, sms_event: sms };
}

export function partialStartNewObligations(ctx: NewDayContext, startMs: number, prior: PriorSameDateCredit): WorkingObligation[] {
  const { cal, policy, date, period_id } = ctx;
  const closes = cal.closing(date);
  if (startMs >= closes) return [];
  const minute = cal.dateOf(startMs) === date ? cal.minuteOf(startMs) : 0;
  const band = newCallBandFor(ctx.scheduleDay, policy);
  const quota = Math.max(0, band.deadline_minutes.length - prior.calls);
  const count = Math.min(quota, partialDayCallCap(minute, policy.reentry));
  const opens = Math.max(startMs, cal.opening(date));
  const due = cal.at(date, band.deadline_minutes[band.deadline_minutes.length - 1] ?? policy.calendar.closing_minute);
  const out: WorkingObligation[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    out.push(makeObligation({ period_id, channel: "call", kind: "ordinary", date, slot, opens, due, closes, plan_id: null }));
  }
  if (minute <= policy.reentry.sms_through_minute && isFixedSmsDay(ctx.scheduleDay, policy)) {
    const sms = makeObligation({ period_id, channel: "sms", kind: "ordinary", date, slot: 0, opens, due: cal.at(date, policy.new_cadence.sms_due_minute), closes, plan_id: null });
    if (prior.sms_event) {
      // Same-date contact reuse: adjusts remaining coverage, creates no new provider/goal credit.
      sms.fulfilledAt = opens;
      sms.fulfilledBy = prior.sms_event.event_id;
    }
    out.push(sms);
  }
  return out;
}
