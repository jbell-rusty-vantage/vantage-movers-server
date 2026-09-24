import { z } from "zod";
import { easternDayKey, easternInstantBounds, floridaTimestampBounds, nextEasternDayKey, previousEasternDayKey } from "../../dailyOperations/dayDocument";
import { toFloridaTimestamp } from "../../../utils/easternTime";

/**
 * Addendum E18: one period picker, in America/New_York calendar days. Every period ends at the
 * read's `as_of` at the latest ("Today" is midnight ET → now). Two instant ranges come out:
 *
 * - `start`/`end`: real instants, for calls, Outreach records, follow-ups, audit rows and transitions;
 * - `lead_start`/`lead_end`: Lead `timestamp` bounds. Form/Call Lead `timestamp` is stored as Eastern
 *   wall-clock components in a UTC Date (`toFloridaTimestamp`), so its day bounds are UTC midnights
 *   of the ET day keys (`floridaTimestampBounds`, the Daily Operations convention).
 */
export const OVERVIEW_PERIODS = ["today", "yesterday", "last_7_days", "this_week", "last_30_days", "this_month", "custom"] as const;
export type OverviewPeriodKey = (typeof OVERVIEW_PERIODS)[number];
/** Custom ranges are at most this many ET days (bounded reads). */
export const OVERVIEW_CUSTOM_MAX_DAYS = 92;
const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type OverviewPeriod = {
  key: OverviewPeriodKey;
  /** First and last ET day of the period (inclusive). */
  from_day: string;
  to_day: string;
  days: string[];
  start: Date;
  end: Date;
  lead_start: Date;
  lead_end: Date;
};

export function addEasternDays(day: string, n: number): string {
  let out = day;
  for (let i = 0; i < Math.abs(n); i++) out = n > 0 ? nextEasternDayKey(out) : previousEasternDayKey(out);
  return out;
}
/** ISO weekday of an ET day key: 1 = Monday … 7 = Sunday. */
function isoWeekday(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
}
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = nextEasternDayKey(day)) {
    out.push(day);
    if (out.length > 400) throw new Error("Overview period too long");
  }
  return out;
}

export function resolveOverviewPeriod(key: OverviewPeriodKey, now: Date, custom?: { from?: string; to?: string }): OverviewPeriod {
  const today = easternDayKey(now);
  let from: string, to: string;
  switch (key) {
    case "today": from = to = today; break;
    case "yesterday": from = to = previousEasternDayKey(today); break;
    case "last_7_days": from = addEasternDays(today, -6); to = today; break;
    case "this_week": from = addEasternDays(today, -(isoWeekday(today) - 1)); to = today; break;
    case "last_30_days": from = addEasternDays(today, -29); to = today; break;
    case "this_month": from = `${today.slice(0, 8)}01`; to = today; break;
    case "custom": {
      const parsed = z.object({ from: dayString, to: dayString }).parse(custom ?? {});
      if (parsed.from > parsed.to) throw new RangeError("from after to");
      from = parsed.from; to = parsed.to > today ? today : parsed.to;
      if (from > to) throw new RangeError("period in the future");
      break;
    }
  }
  const days = daysBetween(from, to);
  if (key === "custom" && days.length > OVERVIEW_CUSTOM_MAX_DAYS) throw new RangeError("period too long");
  const start = easternInstantBounds(from).start, dayEnd = easternInstantBounds(to).end;
  const end = +dayEnd > +now ? now : dayEnd;
  const leadStart = floridaTimestampBounds(from).start, leadDayEnd = floridaTimestampBounds(to).end, leadNow = toFloridaTimestamp(now);
  return { key, from_day: from, to_day: to, days, start, end, lead_start: leadStart, lead_end: +leadDayEnd > +leadNow ? leadNow : leadDayEnd };
}

/** The DTO view of a period (instants as ISO strings). */
export function periodDto(period: OverviewPeriod) {
  return { key: period.key, from_day: period.from_day, to_day: period.to_day, start: period.start.toISOString(), end: period.end.toISOString() };
}
