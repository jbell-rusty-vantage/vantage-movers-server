/** America/New_York hours at which the Estimates cron collects and applies. */
export const ESTIMATES_RUN_HOURS = [8, 13, 18] as const;

const NEW_YORK = "America/New_York";

export type EstimatesCronDecision =
  | { run: false; reason: "outside_estimates_hours" }
  | { run: true; dateWindow: { from: string; to: string }; slotKey: string };

/**
 * Hourly cron gate. Vercel schedules are UTC; the New York hour decides, so
 * daylight saving time does not move the three runs.
 */
export function estimatesCronDecision(now: Date): EstimatesCronDecision {
  if (!ESTIMATES_RUN_HOURS.includes(newYorkHour(now) as (typeof ESTIMATES_RUN_HOURS)[number])) {
    return { run: false, reason: "outside_estimates_hours" };
  }
  const dateWindow = estimatesDateWindow(now);
  return { run: true, dateWindow, slotKey: `${dateWindow.to}:${newYorkHour(now)}` };
}

/** Last actual scheduled instant, including the overnight and DST gaps. */
export function estimatesLatestSlot(now: Date): { slotKey: string; at: Date } {
  let at = new Date(Math.floor(+now / 3_600_000) * 3_600_000);
  for (let offset = 0; offset < 25; offset++) {
    const decision = estimatesCronDecision(at);
    if (decision.run) return { slotKey: decision.slotKey, at };
    at = new Date(+at - 3_600_000);
  }
  throw new Error("Estimates schedule did not contain a recent slot.");
}

/** Inclusive trailing 90 Open Dates in America/New_York, `MM/DD/YYYY`. */
export function estimatesDateWindow(now: Date): { from: string; to: string } {
  const today = newYorkCalendarDate(now);
  const first = addCalendarDays(today, -89);
  return { from: formatGranotDate(first), to: formatGranotDate(today) };
}

/** Small durable runs bound planning and allow each window to resume separately. */
export function estimatesDateChunks(window: { from: string; to: string }, days = 7): Array<{ from: string; to: string }> {
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error("Estimates windows must contain 1–7 days.");
  const first = granotCalendarEpoch(window.from);
  const last = granotCalendarEpoch(window.to);
  if (last < first) throw new Error("Invalid Estimates date window.");
  const format = (value: number) => { const date = new Date(value); return formatGranotDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }); };
  const result = [];
  for (let start = first; start <= last; start += days * 86_400_000) {
    result.push({ from: format(start), to: format(Math.min(last, start + (days - 1) * 86_400_000)) });
  }
  return result;
}

export function granotCalendarEpoch(value: string): number {
  const [month, day, year] = value.split("/").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (formatGranotDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }) !== value) throw new Error("Invalid Estimates date window.");
  return +date;
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
