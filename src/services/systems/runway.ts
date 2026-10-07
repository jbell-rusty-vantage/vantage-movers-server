/**
 * "How long until this is full?" — the one projection every Systems capacity card shares (doc 11b, R3).
 * Pure: no clock, no Mongo. The caller passes the daily snapshot points, the limit and `now`.
 *
 * - At least {@link MIN_MEASURED_POINTS} points: least-squares slope over the newest {@link MAX_SLOPE_POINTS}.
 * - Fewer: the caller's seed rate, labelled `basis: "estimate"` so a guess never reads like a measurement.
 * - A slope of zero or less: "not growing". Beyond the cap (5 years for the disk, 15 for sheets): "more than N years".
 */

export const MIN_MEASURED_POINTS = 7;
export const MAX_SLOPE_POINTS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 365.25 / 12;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type RunwayPoint = { at: Date; value: number };

export type RunwayOptions = {
  /** Growth per day used until {@link MIN_MEASURED_POINTS} snapshots exist. */
  seedRatePerDay: number;
  /** The reading to project from; defaults to the newest point. Pass the live reading when there is one. */
  current?: number;
  /** Beyond this many years the label is "more than N years". */
  capYears: number;
};

export type Runway = {
  rate_per_day: number;
  /** Whole days until the limit; 0 when already reached; null when not growing or beyond the cap. */
  days_left: number | null;
  /** New York-agnostic calendar date (YYYY-MM-DD) the limit is reached; null when not growing or beyond the cap. */
  date: string | null;
  label: string;
  basis: "measured" | "estimate";
  /** Snapshot points the projection had (the "N of 7 days measured" figure). */
  points: number;
};

/** Least-squares slope of value per day. Needs at least two distinct times; otherwise 0. */
export function leastSquaresSlopePerDay(points: RunwayPoint[]): number {
  if (points.length < 2) return 0;
  const t0 = points[0]!.at.getTime();
  const xs = points.map((point) => (point.at.getTime() - t0) / DAY_MS);
  const ys = points.map((point) => point.value);
  const n = points.length;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (xs[i]! - meanX) * (ys[i]! - meanY);
    denominator += (xs[i]! - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/** "about 2 years 7 months", "about 5 months", "about 12 days". */
export function formatDuration(days: number): string {
  if (days < 1) return "less than a day";
  if (days < 45) {
    const whole = Math.round(days);
    return `about ${whole} ${whole === 1 ? "day" : "days"}`;
  }
  const totalMonths = Math.round(days / DAYS_PER_MONTH);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  return `about ${parts.join(" ")}`;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthYear(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function projectRunway(
  points: RunwayPoint[],
  limit: number,
  now: Date,
  options: RunwayOptions,
): Runway {
  const ordered = [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
  const measured = ordered.length >= MIN_MEASURED_POINTS;
  const rate = measured ? leastSquaresSlopePerDay(ordered.slice(-MAX_SLOPE_POINTS)) : options.seedRatePerDay;
  const current = options.current ?? ordered.at(-1)?.value ?? 0;
  const base = { rate_per_day: rate, basis: measured ? "measured" : "estimate", points: ordered.length } as const;

  if (current >= limit) {
    return { ...base, days_left: 0, date: isoDay(now), label: "already reached" };
  }
  if (!(rate > 0)) {
    return { ...base, days_left: null, date: null, label: "not growing" };
  }
  const daysLeft = (limit - current) / rate;
  if (daysLeft > options.capYears * 365.25) {
    return { ...base, days_left: null, date: null, label: `more than ${options.capYears} years` };
  }
  const reached = new Date(now.getTime() + daysLeft * DAY_MS);
  return {
    ...base,
    days_left: Math.floor(daysLeft),
    date: isoDay(reached),
    label: `${formatDuration(daysLeft)} (≈ ${monthYear(reached)})`,
  };
}
