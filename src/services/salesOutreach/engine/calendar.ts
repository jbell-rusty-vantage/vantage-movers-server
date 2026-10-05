/**
 * Business calendar for the outreach engine (P02a–P02d, P02i). DST-safe: local dates and minutes come
 * from `Intl` for the policy timezone; the next day is calendar arithmetic on `YYYY-MM-DD`, never
 * `+ 86_400_000`. A business day is `[local 00:00, next local 00:00)` and can be 23 or 25 hours long.
 *
 * Instants are epoch milliseconds internally; inputs/outputs of the engine are ISO strings.
 */
import type { BusinessDate, EngineCalendarPolicy, Weekday } from "./types";

const MINUTE_MS = 60_000;
const WEEKDAY_BY_INDEX: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

function localParts(ms: number, timeZone: string): LocalParts {
  const out: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function parseInstant(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new RangeError(`invalid instant: ${iso}`);
  return ms;
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** UTC offset (local − UTC) in ms at an instant. */
function offsetAt(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export function businessDateOf(ms: number, timeZone: string): BusinessDate {
  const p = localParts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local minute of day (0–1439) of an instant. */
export function minuteOfDay(ms: number, timeZone: string): number {
  const p = localParts(ms, timeZone);
  return p.hour * 60 + p.minute;
}

function splitDate(date: BusinessDate): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`invalid business date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Calendar arithmetic on a business date (timezone-independent). */
export function addDays(date: BusinessDate, days: number): BusinessDate {
  const [y, m, d] = splitDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  const [y1, m1, d1] = splitDate(from);
  const [y2, m2, d2] = splitDate(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function weekdayOf(date: BusinessDate): Weekday {
  const [y, m, d] = splitDate(date);
  return WEEKDAY_BY_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/**
 * The instant at local `minute` of `date`. A nonexistent local time (spring-forward gap) resolves to
 * the instant just after the gap; an ambiguous one (fall-back hour) resolves to its first occurrence.
 * `minute` may be 1440 (= next local midnight).
 */
export function localInstant(date: BusinessDate, minute: number, timeZone: string): number {
  if (minute >= 1440) return localInstant(addDays(date, 1), minute - 1440, timeZone);
  const [y, m, d] = splitDate(date);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60);
  const offsets = new Set([offsetAt(naive - 36 * 3_600_000, timeZone), offsetAt(naive + 36 * 3_600_000, timeZone), offsetAt(naive, timeZone)]);
  const valid: number[] = [];
  for (const offset of offsets) {
    const candidate = naive - offset;
    if (businessDateOf(candidate, timeZone) === date && minuteOfDay(candidate, timeZone) === minute) valid.push(candidate);
  }
  if (valid.length > 0) return Math.min(...valid);
  // Gap: interpret with the offset in force before the transition (moves the time forward).
  return naive - offsetAt(naive - 36 * 3_600_000, timeZone);
}

export function startOfDate(date: BusinessDate, timeZone: string): number {
  return localInstant(date, 0, timeZone);
}

/** Calendar age: received date is Day 1, advancing on every date (P02a, P05a). */
export function scheduleDay(receivedDate: BusinessDate, date: BusinessDate): number {
  return daysBetween(receivedDate, date) + 1;
}

export class BusinessCalendar {
  readonly timeZone: string;
  private readonly weekdays: Set<Weekday>;
  private readonly closed: Set<BusinessDate>;

  constructor(readonly policy: EngineCalendarPolicy) {
    this.timeZone = policy.timezone;
    this.weekdays = new Set(policy.working_weekdays);
    this.closed = new Set(policy.closed_dates);
  }

  dateOf(ms: number): BusinessDate {
    return businessDateOf(ms, this.timeZone);
  }

  minuteOf(ms: number): number {
    return minuteOfDay(ms, this.timeZone);
  }

  at(date: BusinessDate, minute: number): number {
    return localInstant(date, minute, this.timeZone);
  }

  isClosedDate(date: BusinessDate): boolean {
    return this.closed.has(date);
  }

  /** A working date: a configured weekday that the Owner has not explicitly closed (P02b/P02i). */
  isWorkingDate(date: BusinessDate): boolean {
    return this.weekdays.has(weekdayOf(date)) && !this.closed.has(date);
  }

  opening(date: BusinessDate): number {
    return this.at(date, this.policy.opening_minute);
  }

  closing(date: BusinessDate): number {
    return this.at(date, this.policy.closing_minute);
  }

  /** Inside ordinary contact hours: a working date and `[opening, closing)` (P02c). */
  isWithinOrdinaryHours(ms: number): boolean {
    const date = this.dateOf(ms);
    return this.isWorkingDate(date) && ms >= this.opening(date) && ms < this.closing(date);
  }

  /** First working date strictly after `date`. */
  nextWorkingDateAfter(date: BusinessDate, maxDays = 3660): BusinessDate | null {
    for (let i = 1; i <= maxDays; i += 1) {
      const candidate = addDays(date, i);
      if (this.isWorkingDate(candidate)) return candidate;
    }
    return null;
  }

  /** First working date on or after `date`. */
  workingDateOnOrAfter(date: BusinessDate, maxDays = 3660): BusinessDate | null {
    return this.isWorkingDate(date) ? date : this.nextWorkingDateAfter(date, maxDays);
  }

  /**
   * Add working minutes from `startMs` (P02d): only `[opening, closing)` of working dates count; unused
   * minutes carry across closing and closed dates. `blocked` intervals (P06c restriction pauses) do not
   * count either. Returns null when the deadline cannot be reached (an open-ended block).
   */
  addWorkingMinutes(startMs: number, minutes: number, blocked: ReadonlyArray<readonly [number, number]> = [], maxDays = 3660): number | null {
    let remaining = minutes * MINUTE_MS;
    let date = this.dateOf(startMs);
    let cursor = startMs;
    const sortedBlocks = [...blocked].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i <= maxDays; i += 1) {
      if (this.isWorkingDate(date)) {
        const close = this.closing(date);
        let seg = Math.max(cursor, this.opening(date));
        while (seg < close) {
          const block = sortedBlocks.find(([s, e]) => e > seg && s < close);
          if (block && block[0] <= seg) {
            if (!Number.isFinite(block[1])) return null;
            seg = block[1];
            continue;
          }
          const freeEnd = block ? block[0] : close;
          if (remaining <= freeEnd - seg) return seg + remaining;
          remaining -= freeEnd - seg;
          seg = freeEnd;
        }
      }
      date = addDays(date, 1);
      cursor = startOfDate(date, this.timeZone);
    }
    return null;
  }
}
