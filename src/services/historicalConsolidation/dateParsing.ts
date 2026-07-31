import type { ParseResult } from "./normalization";

const DATE_TIME = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/iu;
const DATE_ONLY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/u;

export function parseEasternDate(rawValue: unknown, options: { allow_known_0205_correction?: boolean } = {}): ParseResult<string> {
  const raw = String(rawValue ?? "").normalize("NFKC").trim().replace(/^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+/iu, "");
  if (!raw) return { disposition: "empty", reason_codes: ["missing_date"] };
  const match = raw.match(DATE_TIME) ?? raw.match(DATE_ONLY);
  if (!match) return { disposition: "invalid", reason_codes: ["unsupported_date_format"] };
  let year = Number(match[3]);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const reasons: string[] = [];
  if (year === 205 && month === 7 && day === 20 && options.allow_known_0205_correction) {
    year = 2025;
    reasons.push("corrected_7_20_0205_to_2025_07_20");
  }
  let hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const meridiem = match[7]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (!validCalendar(year, month, day, hour, minute, second)) return { disposition: "invalid", reason_codes: ["invalid_calendar_date"] };
  const instant = easternWallClockToUtc(year, month, day, hour, minute, second);
  if (!instant) return { disposition: "invalid", reason_codes: ["nonexistent_or_ambiguous_eastern_time"] };
  return { disposition: "accepted", value: instant.toISOString(), reason_codes: reasons };
}

export function googleSerialToEastern(serial: unknown): ParseResult<string> {
  if (typeof serial !== "number" || !Number.isFinite(serial)) return { disposition: "invalid", reason_codes: ["invalid_google_date_serial"] };
  const milliseconds = Math.round(serial * 86_400_000);
  const local = new Date(Date.UTC(1899, 11, 30) + milliseconds);
  const instant = easternWallClockToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds());
  return instant ? { disposition: "accepted", value: instant.toISOString(), reason_codes: [] } : { disposition: "invalid", reason_codes: ["invalid_google_date_serial"] };
}

function easternWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number): Date | null {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  for (const offsetHours of [-5, -4]) {
    const candidate = new Date(desired - offsetHours * 3_600_000);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(candidate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (Number(values.year) === year && Number(values.month) === month && Number(values.day) === day && Number(values.hour) === hour && Number(values.minute) === minute && Number(values.second) === second) return candidate;
  }
  return null;
}

function validCalendar(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
