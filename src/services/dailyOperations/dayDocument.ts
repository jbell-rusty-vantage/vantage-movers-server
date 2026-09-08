import { SOURCE_COMPANIES } from "../../config/domain/sources";
import type {
  DailyOperationsCompanyCount,
  DailyOperationsDayDocument,
  DailyOperationsHourlyBucket,
} from "../../models/DailyOperationsDay";
import {
  easternDateTimeParts,
  easternWallClockToUtc,
  FLORIDA_TIME_ZONE,
} from "../../utils/easternTime";

export const DAILY_OPERATIONS_ORIGIN_KEYS = [
  "wordpress_form",
  "ringcentral",
  "granot_lead_created",
  "best_relocation_sheet",
  "vantage_admin",
] as const;

export type DailyOperationsOriginKey = (typeof DAILY_OPERATIONS_ORIGIN_KEYS)[number];

export type InstantBounds = {
  start: Date;
  end: Date;
};

export type DailyOperationsDaySeed = Omit<
  DailyOperationsDayDocument,
  "_id" | "createdAt" | "updatedAt" | "revision"
> & {
  revision?: number;
};

const ALREADY_EXPANDED_HOURLY = /^hourly\.\d+\./;

export function easternDayKey(occurredAt: Date): string {
  const parts = easternDateTimeParts(occurredAt);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function easternHour(occurredAt: Date): number {
  return easternDateTimeParts(occurredAt).hour;
}

export function previousEasternDayKey(day: string): string {
  const [year, month, date] = parseDayKey(day);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return formatUtcDateKey(utc);
}

export function nextEasternDayKey(day: string): string {
  const [year, month, date] = parseDayKey(day);
  const utc = new Date(Date.UTC(year, month - 1, date));
  utc.setUTCDate(utc.getUTCDate() + 1);
  return formatUtcDateKey(utc);
}

/**
 * Real-instant bounds for the NY calendar day. Use for `captured_at`,
 * `createdAt`, `decided_at`, and Lead Message times.
 */
export function easternInstantBounds(day: string): InstantBounds {
  const [year, month, date] = parseDayKey(day);
  const [nextYear, nextMonth, nextDate] = parseDayKey(nextEasternDayKey(day));
  const start = easternWallClockToUtc(year, month, date, 0, 0, 0);
  const end = easternWallClockToUtc(nextYear, nextMonth, nextDate, 0, 0, 0);
  if (!start || !end) {
    throw new Error(`Cannot resolve America/New_York bounds for ${day}`);
  }
  return { start, end };
}

/**
 * Bounds for Form / Call Lead `timestamp`, which is stored as Eastern
 * wall-clock components in UTC (`toFloridaTimestamp`).
 */
export function floridaTimestampBounds(day: string): InstantBounds {
  const [year, month, date] = parseDayKey(day);
  const [nextYear, nextMonth, nextDate] = parseDayKey(nextEasternDayKey(day));
  return {
    start: new Date(Date.UTC(year, month - 1, date, 0, 0, 0, 0)),
    end: new Date(Date.UTC(nextYear, nextMonth - 1, nextDate, 0, 0, 0, 0)),
  };
}

export function sumHourlyThrough(
  hourly: readonly DailyOperationsHourlyBucket[] | undefined,
  throughHour: number,
  field: Exclude<keyof DailyOperationsHourlyBucket, "hour">,
): number {
  if (!hourly?.length) return 0;
  let sum = 0;
  const capped = Math.min(Math.max(throughHour, 0), 23);
  for (let hour = 0; hour <= capped; hour += 1) {
    const bucket =
      hourly.find((entry) => entry.hour === hour) ?? hourly[hour];
    sum += Number(bucket?.[field] ?? 0);
  }
  return sum;
}

function parseDayKey(day: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) {
    throw new Error(`Invalid Daily Operations day key: ${day}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function formatUtcDateKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const date = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}

export function seedHourlyBuckets(): DailyOperationsHourlyBucket[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    leads: 0,
    bookings: 0,
    cancellations: 0,
    webhooks: 0,
    messages: 0,
  }));
}

export function seedCompanyCounts(): Record<string, DailyOperationsCompanyCount> {
  const companies: Record<string, DailyOperationsCompanyCount> = {};
  for (const slug of SOURCE_COMPANIES) {
    companies[slug] = { form: 0, call: 0, total: 0 };
  }
  return companies;
}

export function buildDaySeed(day: string): DailyOperationsDaySeed {
  return {
    day,
    timezone: FLORIDA_TIME_ZONE,
    status: "open",
    closed_at: null,
    leads: {
      total: 0,
      form: 0,
      call: 0,
      duplicate_form: 0,
      duplicate_call: 0,
      unmatched_call: 0,
    },
    origins: {
      wordpress_form: 0,
      ringcentral: 0,
      granot_lead_created: 0,
      best_relocation_sheet: 0,
      vantage_admin: 0,
    },
    companies: seedCompanyCounts(),
    webhooks: {
      lead_created: 0,
      priority_updated: 0,
      booking_status_changed: 0,
      booked: 0,
      release: 0,
    },
    decisions: {
      minted: 0,
      linked: 0,
      observed: 0,
      pending_match: 0,
      unmatched: 0,
    },
    messages: {
      successful: 0,
      deferred: 0,
      skipped: 0,
      failed: 0,
    },
    bookings: {
      total: 0,
      granot_confirm: 0,
      employee_linked: 0,
      employee_pending: 0,
      admin: 0,
      leadless: 0,
      referral: 0,
    },
    cancellations: { total: 0 },
    intakes: { opened: 0, refreshed: 0 },
    exceptions: {
      zip_missing: 0,
      crm_failed: 0,
      dead_letter: 0,
      adoption_conflict: 0,
    },
    hourly: seedHourlyBuckets(),
  };
}

/**
 * Turns caller `metric_touches` into Mongo `$inc` dotted paths.
 * `hourly.leads` becomes `hourly.{nyHour}.leads`. Always increments `revision`.
 */
export function buildDayIncrements(
  metricTouches: readonly string[],
  nyHour: number,
): Record<string, number> {
  const increments: Record<string, number> = { revision: 1 };
  for (const touch of metricTouches) {
    const path =
      touch.startsWith("hourly.") && !ALREADY_EXPANDED_HOURLY.test(touch)
        ? `hourly.${nyHour}.${touch.slice("hourly.".length)}`
        : touch;
    increments[path] = (increments[path] ?? 0) + 1;
  }
  return increments;
}

export function applyDottedIncrements(
  target: Record<string, unknown>,
  increments: Record<string, number>,
): void {
  for (const [path, amount] of Object.entries(increments)) {
    const parts = path.split(".");
    let current: Record<string, unknown> | unknown[] = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const key = parts[index];
      const nextIsIndex = /^\d+$/.test(parts[index + 1] ?? "");
      if (Array.isArray(current)) {
        const arrayIndex = Number(key);
        if (current[arrayIndex] === undefined) {
          current[arrayIndex] = nextIsIndex ? [] : {};
        }
        current = current[arrayIndex] as Record<string, unknown> | unknown[];
      } else if (current[key] === undefined) {
        current[key] = nextIsIndex ? [] : {};
        current = current[key] as Record<string, unknown> | unknown[];
      } else {
        current = current[key] as Record<string, unknown> | unknown[];
      }
    }
    const last = parts[parts.length - 1];
    if (Array.isArray(current)) {
      const arrayIndex = Number(last);
      current[arrayIndex] = (Number(current[arrayIndex]) || 0) + amount;
    } else {
      current[last] = (Number(current[last]) || 0) + amount;
    }
  }
}
