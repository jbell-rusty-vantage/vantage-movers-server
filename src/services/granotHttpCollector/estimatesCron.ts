/** America/New_York hours at which the Estimates cron collects and applies. */
export const ESTIMATES_RUN_HOURS = [8, 13, 18] as const;

const NEW_YORK = "America/New_York";

export type EstimatesCronDecision =
  | { run: false; reason: "outside_estimates_hours" }
  | { run: true; dateWindow: { from: string; to: string } };

/**
 * Hourly cron gate. Vercel schedules are UTC; the New York hour decides, so
 * daylight saving time does not move the three runs.
 */
export function estimatesCronDecision(now: Date): EstimatesCronDecision {
  if (!ESTIMATES_RUN_HOURS.includes(newYorkHour(now) as (typeof ESTIMATES_RUN_HOURS)[number])) {
    return { run: false, reason: "outside_estimates_hours" };
  }
  return { run: true, dateWindow: estimatesDateWindow(now) };
}

/** Open Date yesterday through today in America/New_York, `MM/DD/YYYY`. */
export function estimatesDateWindow(now: Date): { from: string; to: string } {
  const today = newYorkCalendarDate(now);
  const yesterday = addCalendarDays(today, -1);
  return { from: formatGranotDate(yesterday), to: formatGranotDate(today) };
}

export function newYorkHour(now: Date): number {
  const hour = Number(part(now, "hour"));
  return hour === 24 ? 0 : hour;
}

function newYorkCalendarDate(now: Date): { year: number; month: number; day: number } {
  return {
    year: Number(part(now, "year")),
    month: Number(part(now, "month")),
    day: Number(part(now, "day")),
  };
}

function part(now: Date, type: "year" | "month" | "day" | "hour"): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: NEW_YORK,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  };
  const value = new Intl.DateTimeFormat("en-US", options)
    .formatToParts(now)
    .find((entry) => entry.type === type)?.value;
  if (!value) throw new Error(`America/New_York ${type} was not available`);
  return value;
}

function addCalendarDays(
  date: { year: number; month: number; day: number },
  delta: number,
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + delta));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatGranotDate(date: { year: number; month: number; day: number }): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${month}/${day}/${date.year}`;
}
