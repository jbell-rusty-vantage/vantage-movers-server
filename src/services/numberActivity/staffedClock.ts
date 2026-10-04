import type { CsiPolicy } from "../../validation/v1/salesIntelligence";

/**
 * Staffed-hours clock for capture health: the webhook silence window is
 * measured in staffed minutes of the policy timezone, so nights and closed
 * days never read as a degraded webhook. Pure; DST-exact.
 */
export type Staffing = Pick<CsiPolicy, "timezone" | "staffed_hours">;
const minute = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
const calendarDays = new Map<string, { start: Date; end: Date }[]>();
function localParts(at: Date, timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (formatters.size >= 16) formatters.delete(formatters.keys().next().value!);
    formatters.set(timezone, formatter);
  }
  const parts = formatter.formatToParts(at);
  const value = (key: string) => Number(parts.find(p => p.type === key)!.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}
/** Reject nonexistent and repeated local times rather than silently choosing a DST offset. */
function localInstant(day: string, minuteOfDay: number, timezone: string): Date | null {
  const [year, month, date] = day.split("-").map(Number);
  const wall = Date.UTC(year!, month! - 1, date!, 0, minuteOfDay);
  const offsets = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const probe = wall + delta * 3_600_000;
    const p = localParts(new Date(probe), timezone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - probe);
  }
  const matches = [...offsets].map(offset => new Date(wall - offset)).filter(at => {
    const p = localParts(at, timezone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) === wall;
  });
  return matches.length === 1 ? matches[0]! : null;
}
function dayKey(at: Date, timezone: string) {
  const p = localParts(at, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
function shiftDay(day: string, offset: number) {
  return new Date(+new Date(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}
function intervals(day: string, staffing: Staffing) {
  // Value-keyed and bounded: changed policy hours cannot reuse stale intervals.
  const key = JSON.stringify([staffing.timezone, staffing.staffed_hours, day]);
  const cached = calendarDays.get(key);
  if (cached) return cached;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  const result = staffing.staffed_hours.filter(s => s.day === weekday).sort((a, b) => a.start_minute - b.start_minute).flatMap(s => {
    const start = localInstant(day, s.start_minute, staffing.timezone);
    const end = localInstant(day, s.end_minute, staffing.timezone);
    return start && end ? [{ start, end }] : [];
  });
  if (calendarDays.size >= 8192) calendarDays.delete(calendarDays.keys().next().value!);
  calendarDays.set(key, result);
  return result;
}
/** `staffed minutes between from and to >= minutes`, stopping as soon as the threshold is reached. */
export function staffedMinutesAtLeast(from: Date, to: Date, minutes: number, staffing: Staffing): boolean {
  if (minutes <= 0) return true;
  if (to <= from) return false;
  let total = 0;
  const target = minutes * minute, lastDay = dayKey(to, staffing.timezone);
  for (let day = dayKey(from, staffing.timezone); day <= lastDay; day = shiftDay(day, 1)) {
    for (const span of intervals(day, staffing)) total += Math.max(0, Math.min(+to, +span.end) - Math.max(+from, +span.start));
    if (total >= target) return true;
  }
  return false;
}
/**
 * The latest instant `t <= from` with exactly `minutes` staffed minutes between `t` and `from`;
 * an exact fit lands on an opening, never on the previous closing. Zero returns `from`.
 */
export function subtractStaffedMinutes(from: Date, minutes: number, staffing: Staffing): Date {
  if (!Number.isFinite(minutes) || minutes < 0 || !staffing.staffed_hours.length) throw new Error("Invalid staffed clock");
  if (minutes === 0) return new Date(+from);
  let remaining = minutes * minute;
  for (let day = dayKey(from, staffing.timezone), count = 0; count < 36600; day = shiftDay(day, -1), count++) {
    const spans = intervals(day, staffing);
    for (let i = spans.length - 1; i >= 0; i--) {
      const span = spans[i]!;
      const end = Math.min(+from, +span.end);
      if (end <= +span.start) continue;
      if (remaining <= end - +span.start) return new Date(end - remaining);
      remaining -= end - +span.start;
    }
  }
  throw new Error("Staffing horizon exceeded");
}
