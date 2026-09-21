import type { CsiPolicy } from "../../../validation/v1/salesIntelligence";

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
export function localInstant(day: string, minuteOfDay: number, timezone: string): Date | null {
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
export function staffedMinutesBetween(from: Date, to: Date, staffing: Staffing): number {
  if (to <= from) return 0;
  let total = 0;
  const lastDay = dayKey(to, staffing.timezone);
  for (let day = dayKey(from, staffing.timezone); day <= lastDay; day = shiftDay(day, 1)) {
    for (const span of intervals(day, staffing)) total += Math.max(0, Math.min(+to, +span.end) - Math.max(+from, +span.start));
  }
  return total / minute;
}
export function addStaffedMinutes(from: Date, minutes: number, staffing: Staffing): Date {
  if (!Number.isFinite(minutes) || minutes < 0 || !staffing.staffed_hours.length) throw new Error("Invalid staffed clock");
  let remaining = minutes * minute;
  for (let day = dayKey(from, staffing.timezone), count = 0; count < 36600; day = shiftDay(day, 1), count++) {
    for (const span of intervals(day, staffing)) {
      const start = Math.max(+from, +span.start);
      if (start >= +span.end) continue;
      if (remaining <= +span.end - start) return new Date(start + remaining);
      remaining -= +span.end - start;
    }
  }
  throw new Error("Staffing horizon exceeded");
}
export const nextOpening = (at: Date, staffing: Staffing) => addStaffedMinutes(at, 0, staffing);
/** Dates are resolved from explicit structured evidence; ambiguous language stays undated. */
export function resolveActionDate(input: { exact?: string; day?: string; wait?: boolean }, policy: CsiPolicy, anchor: Date) {
  const resolution = { precision: "unresolved" as "exact" | "day" | "unresolved", timezone: policy.timezone, assumption: null as string | null, anchor, policy_version: policy.version };
  if (input.exact && /(?:Z|[+-]\d\d:\d\d)$/.test(input.exact)) {
    const due = new Date(input.exact);
    if (Number.isFinite(+due) && due >= anchor) return { due_at: due, base_attention_due_at: due, date_resolution: { ...resolution, precision: "exact" as const } };
  }
  if (input.day && /^\d{4}-\d{2}-\d{2}$/.test(input.day) && Number.isFinite(+new Date(`${input.day}T00:00:00Z`)) && new Date(`${input.day}T00:00:00Z`).toISOString().slice(0,10) === input.day) {
    const due = intervals(input.day, policy).at(-1)?.end;
    if (due && due >= anchor) return { due_at: due, base_attention_due_at: input.wait ? nextOpening(due, policy) : due,
      date_resolution: { ...resolution, precision: "day" as const, assumption: "End of sales day" } };
  }
  return { due_at: null, base_attention_due_at: null, date_resolution: resolution };
}

/** Small deterministic vocabulary. Unrecognized/ambiguous speech is deliberately undated. */
export function resolveActionDateText(text: string | null | undefined, policy: CsiPolicy, anchor: Date, wait = false) {
  const wording = text?.trim().toLowerCase().replace(/^on /, "") ?? "";
  if (/^\d{4}-\d{2}-\d{2}t/.test(wording)) return resolveActionDate({ exact: text!.trim(), wait }, policy, anchor);
  if (/^\d{4}-\d{2}-\d{2}$/.test(wording)) return resolveActionDate({ day: wording, wait }, policy, anchor);
  const match = /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/.exec(wording);
  if (!match) return resolveActionDate({}, policy, anchor);
  const today = dayKey(anchor, policy.timezone), weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const targetDay = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(match[1]!);
  const delta = match[1] === "today" ? 0 : match[1] === "tomorrow" ? 1 : (targetDay - weekday + 7) % 7;
  const day = shiftDay(today, delta);
  if (!match[2]) return resolveActionDate({ day, wait }, policy, anchor);
  let hour = Number(match[2]); const minutes = Number(match[3] ?? 0), meridiem = match[4];
  if (minutes > 59 || (meridiem ? hour < 1 || hour > 12 : !match[3] || hour > 23)) return resolveActionDate({}, policy, anchor);
  if (meridiem) hour = hour % 12 + (meridiem === "pm" ? 12 : 0);
  const instant = localInstant(day, hour * 60 + minutes, policy.timezone);
  if (!instant) return resolveActionDate({}, policy, anchor);
  const resolved = resolveActionDate({ exact: instant.toISOString(), wait }, policy, anchor);
  return { ...resolved, date_resolution: { ...resolved.date_resolution, assumption: `${policy.timezone} assumed from call context` } };
}
