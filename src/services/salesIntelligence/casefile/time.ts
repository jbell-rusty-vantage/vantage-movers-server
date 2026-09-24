/**
 * Case File time and money text (spec §4.3). Pure: every instant is rendered in America/New_York
 * from its ISO string, relative only to the file's `as_of`; nothing reads the clock.
 *
 * - full:     `Tue Sep 15, 2026 6:30 PM ET`
 * - date:     `Tue Sep 15, 2026`
 * - timeline: `Tue Sep 15 6:30 PM` (the year only when it differs from `as_of`'s year)
 */
const TIMEZONE = "America/New_York";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
type Parts = { weekday: string; month: string; day: string; year: string; hour: string; minute: string; period: string };

let formatter: Intl.DateTimeFormat | null = null;
function parts(date: Date): Parts {
  formatter ??= new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true });
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) out[part.type] = part.value;
  return { weekday: out.weekday ?? "", month: out.month ?? "", day: out.day ?? "", year: out.year ?? "", hour: out.hour ?? "", minute: out.minute ?? "", period: out.dayPeriod ?? "" };
}
export const parseIso = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(+date) ? null : date;
};

/** `Tue Sep 15, 2026 6:30 PM ET`; `an unknown time` when missing. */
export function fullTime(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) return "an unknown time";
  const p = parts(date);
  return `${p.weekday} ${p.month} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.period} ET`;
}
/** `Tue Sep 15, 2026`. */
export function fullDate(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) return "an unknown date";
  const p = parts(date);
  return `${p.weekday} ${p.month} ${p.day}, ${p.year}`;
}
const sameYear = (date: Date, asOf: string) => { const ref = parseIso(asOf); return !ref || parts(ref).year === parts(date).year; };
/** Inside the timeline: `Tue Sep 15 6:30 PM`, or `Tue Sep 15, 2025 6:30 PM` in another year. */
export function timelineTime(iso: string | null | undefined, asOf: string): string {
  const date = parseIso(iso);
  if (!date) return "time unknown";
  const p = parts(date);
  return `${p.weekday} ${p.month} ${p.day}${sameYear(date, asOf) ? "" : `, ${p.year}`} ${p.hour}:${p.minute} ${p.period}`;
}
/** Inside the timeline: `Fri Sep 18`, with the year only when it differs from `as_of`'s. */
export function timelineDate(iso: string | null | undefined, asOf: string): string {
  const date = parseIso(iso);
  if (!date) return "date unknown";
  const p = parts(date);
  return `${p.weekday} ${p.month} ${p.day}${sameYear(date, asOf) ? "" : `, ${p.year}`}`;
}
/** `h:mm PM` of an instant (a same-day range end). */
export function clockTime(iso: string | null | undefined): string {
  const date = parseIso(iso);
  if (!date) return "time unknown";
  const p = parts(date);
  return `${p.hour}:${p.minute} ${p.period}`;
}
/** ET calendar day number (for "n days", "today"). */
export function etDayNumber(iso: string): number {
  const date = parseIso(iso);
  if (!date) return 0;
  const p = parts(date);
  return Math.floor(Date.UTC(Number(p.year), Math.max(0, MONTHS.indexOf(p.month)), Number(p.day)) / DAY_MS);
}
export const etDaysBetween = (fromIso: string, toIso: string) => etDayNumber(toIso) - etDayNumber(fromIso);
export const sameEtDay = (a: string, b: string) => etDayNumber(a) === etDayNumber(b);

/** Lead move dates are calendar dates (`YYYY-MM-DD`, UTC midnight): `Oct 10, 2026`, never zone-shifted. */
export function calendarDate(value: string | null | undefined): string | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return value ? value : null;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : value ?? null;
}

/** `4m12s`, `45s`, `1h02m`; `duration unknown` when missing. */
export function duration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "duration unknown";
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const hours = Math.floor(whole / 3600), minutes = Math.floor((whole % 3600) / 60), rest = whole % 60;
  if (hours) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m${String(rest).padStart(2, "0")}s`;
}

/** `n days ago`, `today`, `yesterday`, `in n days` for an instant relative to `as_of`. */
export function relativeDays(iso: string, asOf: string): string {
  const days = etDaysBetween(iso, asOf);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days > 1) return `${days} days ago`;
  return days === -1 ? "tomorrow" : `in ${-days} days`;
}

const MONEY = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/**
 * Granot display money (spec §4.4): shown as Granot sent it, normalized to `$6,600` only when the raw
 * text parses cleanly as a number (`6600.00`, `$7,100`, `7,100.50` → `$7,100.50`); otherwise quoted.
 */
export function granotMoney(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const match = MONEY.exec(text);
  if (!match) return `"${text}"`;
  const whole = Number(match[1]!.replace(/,/g, ""));
  const cents = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  if (!Number.isSafeInteger(whole)) return `"${text}"`;
  return `$${grouped.format(whole)}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`;
}
/** Official Booking amounts (numbers): `$4,200` / `$4,200.50`. */
export function dollars(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  const whole = Math.trunc(cents / 100), rest = Math.abs(cents % 100);
  return `$${grouped.format(whole)}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}
