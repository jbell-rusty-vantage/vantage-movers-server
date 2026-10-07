/**
 * The Insights period engine (doc 09 "Period engine"). Every range is a half-open run of New York business dates
 * `[start, end_exclusive)`. Lead, booking and cancellation dates are stored as New York wall clocks (or dates) in UTC
 * `Date` fields, so a business date D matches the stored range `[D 00:00Z, D+1 00:00Z)`; that replaces the old
 * `$lte to` filter that cut off the last day of every range.
 */
import { easternDayKey } from "../dailyOperations/dayDocument";
import type {
  InsightsBucket,
  InsightsCompareMode,
  InsightsComparison,
  InsightsPeriod,
  InsightsPeriodPreset,
  InsightsRange,
} from "./types";

const DAY_MS = 86_400_000;

export type PeriodInput = {
  preset: InsightsPeriodPreset;
  /** Inclusive `YYYY-MM-DD`, custom only. */
  from?: string;
  /** Inclusive `YYYY-MM-DD`, custom only. */
  to?: string;
  compare: InsightsCompareMode;
};

export type ResolvedPeriods = {
  today: string;
  period: InsightsPeriod;
  comparison: Omit<InsightsComparison, "coverage"> | null;
};

export function dayToUtc(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export function utcToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return utcToDay(new Date(dayToUtc(day).getTime() + days * DAY_MS));
}

export function daysBetween(start: string, endExclusive: string): number {
  return Math.round((dayToUtc(endExclusive).getTime() - dayToUtc(start).getTime()) / DAY_MS);
}

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const weekday = dayToUtc(day).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function addMonths(day: string, months: number): string {
  const date = dayToUtc(day);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return utcToDay(target);
}

function quarterStart(day: string): string {
  const date = dayToUtc(day);
  const month = Math.floor(date.getUTCMonth() / 3) * 3;
  return utcToDay(new Date(Date.UTC(date.getUTCFullYear(), month, 1)));
}

/** The same span shifted to the period before it, keeping elapsed length (clamped to the previous unit's end). */
function previousToDate(start: string, endExclusive: string, unitStart: (day: string) => string, shift: (day: string) => string) {
  const prevStart = shift(start);
  const elapsed = daysBetween(start, endExclusive);
  const prevUnitEnd = start; // the previous unit ends where this one starts
  const candidateEnd = addDays(prevStart, elapsed);
  const end = candidateEnd > prevUnitEnd ? prevUnitEnd : candidateEnd;
  return { start: unitStart(prevStart), end_exclusive: end };
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const SHORT_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function rangeLabel(start: string, endExclusive: string): string {
  const last = addDays(endExclusive, -1);
  if (start === last) return SHORT_YEAR.format(dayToUtc(start));
  const sameYear = start.slice(0, 4) === last.slice(0, 4);
  return `${(sameYear ? SHORT : SHORT_YEAR).format(dayToUtc(start))} – ${SHORT_YEAR.format(dayToUtc(last))}`;
}

function range(start: string, endExclusive: string): InsightsRange {
  return {
    start,
    end_exclusive: endExclusive,
    end: addDays(endExclusive, -1),
    days: daysBetween(start, endExclusive),
    label: rangeLabel(start, endExclusive),
  };
}

export function bucketFor(days: number): InsightsBucket {
  return days > 31 ? "week" : "day";
}

export class InsightsPeriodError extends Error {
  readonly statusCode = 400;
}

function assertDay(value: string | undefined, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(dayToUtc(value).getTime()) || utcToDay(dayToUtc(value)) !== value) {
    throw new InsightsPeriodError(`${name} must be a date (YYYY-MM-DD).`);
  }
  return value;
}

export function resolvePeriods(input: PeriodInput, now: Date = new Date()): ResolvedPeriods {
  const today = easternDayKey(now);
  const tomorrow = addDays(today, 1);
  let start: string;
  let endExclusive: string;
  let previous: { start: string; end_exclusive: string };

  switch (input.preset) {
    case "today":
      start = today;
      endExclusive = tomorrow;
      previous = { start: addDays(today, -1), end_exclusive: today };
      break;
    case "yesterday":
      start = addDays(today, -1);
      endExclusive = today;
      previous = { start: addDays(today, -2), end_exclusive: start };
      break;
    case "this_week":
      start = weekStart(today);
      endExclusive = tomorrow;
      previous = previousToDate(start, endExclusive, weekStart, (d) => addDays(d, -7));
      break;
    case "last_week":
      start = addDays(weekStart(today), -7);
      endExclusive = weekStart(today);
      previous = { start: addDays(start, -7), end_exclusive: start };
      break;
    case "this_month":
      start = monthStart(today);
      endExclusive = tomorrow;
      previous = previousToDate(start, endExclusive, monthStart, (d) => addMonths(d, -1));
      break;
    case "last_month":
      start = addMonths(monthStart(today), -1);
      endExclusive = monthStart(today);
      previous = { start: addMonths(start, -1), end_exclusive: start };
      break;
    case "quarter_to_date":
      start = quarterStart(today);
      endExclusive = tomorrow;
      previous = previousToDate(start, endExclusive, quarterStart, (d) => addMonths(d, -3));
      break;
    case "year_to_date":
      start = `${today.slice(0, 4)}-01-01`;
      endExclusive = tomorrow;
      previous = previousToDate(start, endExclusive, (d) => `${d.slice(0, 4)}-01-01`, (d) => addMonths(d, -12));
      break;
    case "last_90":
    case "last_30": {
      const length = input.preset === "last_30" ? 30 : 90;
      start = addDays(tomorrow, -length);
      endExclusive = tomorrow;
      previous = { start: addDays(start, -length), end_exclusive: start };
      break;
    }
    case "custom": {
      const from = assertDay(input.from, "from");
      const to = assertDay(input.to, "to");
      if (to < from) throw new InsightsPeriodError("to must be on or after from.");
      if (daysBetween(from, to) > 731) throw new InsightsPeriodError("A custom period can be at most two years.");
      start = from;
      endExclusive = addDays(to, 1);
      const length = daysBetween(start, endExclusive);
      previous = { start: addDays(start, -length), end_exclusive: start };
      break;
    }
  }

  const base = range(start, endExclusive);
  const period: InsightsPeriod = {
    ...base,
    preset: input.preset,
    bucket: bucketFor(base.days),
    includes_today: start <= today && today < endExclusive,
  };

  let comparison: ResolvedPeriods["comparison"] = null;
  if (input.compare === "previous") {
    comparison = { ...range(previous.start, previous.end_exclusive), mode: "previous" };
  } else if (input.compare === "last_year") {
    comparison = { ...range(addMonths(start, -12), addMonths(endExclusive, -12)), mode: "last_year" };
  }
  return { today, period, comparison };
}

/** Bucket key (first day of the bucket) for a business date inside a period. */
export function bucketKey(day: string, rangeStart: string, bucket: InsightsBucket): string {
  if (bucket === "day") return day;
  const start = weekStart(day);
  return start < rangeStart ? rangeStart : start;
}

/** Every bucket key in a range, in order. */
export function bucketKeys(rangeValue: Pick<InsightsRange, "start" | "end_exclusive">, bucket: InsightsBucket): string[] {
  const keys: string[] = [];
  let day = rangeValue.start;
  while (day < rangeValue.end_exclusive) {
    const key = bucketKey(day, rangeValue.start, bucket);
    if (keys[keys.length - 1] !== key) keys.push(key);
    day = addDays(day, 1);
  }
  return keys;
}

/** Stored-field range for a business-date range (wall-clock and date-only fields). */
export function storedRange(rangeValue: Pick<InsightsRange, "start" | "end_exclusive">): { $gte: Date; $lt: Date } {
  return { $gte: dayToUtc(rangeValue.start), $lt: dayToUtc(rangeValue.end_exclusive) };
}

export function inRange(day: string | null | undefined, rangeValue: Pick<InsightsRange, "start" | "end_exclusive">): boolean {
  return Boolean(day) && day! >= rangeValue.start && day! < rangeValue.end_exclusive;
}
