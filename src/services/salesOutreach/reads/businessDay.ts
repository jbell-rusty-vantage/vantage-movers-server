import { easternDateTimeParts, easternWallClockToUtc } from "../../../utils/easternTime";

/**
 * New York business dates for desk reads (CONTRACTS: business dates are YYYY-MM-DD interpreted in
 * America/New_York; each read uses one server reference instant). Dates are built with `Intl`
 * (via `utils/easternTime`), never by adding 86,400,000 ms, so DST days are 23 or 25 hours long.
 */

const pad = (value: number) => String(value).padStart(2, "0");

function parse(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

/** The New York calendar date containing `instant`. */
export function newYorkBusinessDay(instant: Date): string {
  const parts = easternDateTimeParts(instant);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The calendar date after `day` (pure calendar arithmetic, no time zone involved). */
export function nextBusinessDay(day: string): string {
  const [y, m, d] = parse(day);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** ISO weekday of a calendar date: Monday 1 … Sunday 7. */
export function isoWeekdayOf(day: string): number {
  const [y, m, d] = parse(day);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** `[start, end)` UTC instants of the New York day (midnight to next midnight; DST-aware). */
export function newYorkDayBounds(day: string): { start: Date; end: Date } {
  const [y, m, d] = parse(day);
  const [ny, nm, nd] = parse(nextBusinessDay(day));
  const start = easternWallClockToUtc(y, m, d, 0, 0, 0);
  const end = easternWallClockToUtc(ny, nm, nd, 0, 0, 0);
  if (!start || !end) throw new Error(`Cannot resolve America/New_York bounds for ${day}`);
  return { start, end };
}
