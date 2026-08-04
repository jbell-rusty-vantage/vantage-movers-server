import { reportingError } from "./catalog";

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export type ReportingDateWindowSpec =
  | {
      kind: "explicit";
      fromLocal: string;
      throughLocal?: string;
      toExclusiveLocal?: string;
      repeatedTimeDisambiguation?: "earlier" | "later";
    }
  | {
      kind: "rolling";
      preset: "last_n_days";
      days: number;
      anchor: "preview_or_run_time";
      endPolicy: "include_current_local_day";
    };

export function resolveReportingDateWindow(
  spec: ReportingDateWindowSpec,
  timezone: string,
  now: Date,
) {
  if (spec.kind === "explicit") {
    return resolveLocalWindow({ ...spec, timezone });
  }
  if (
    spec.preset !== "last_n_days" ||
    spec.anchor !== "preview_or_run_time" ||
    spec.endPolicy !== "include_current_local_day" ||
    !Number.isSafeInteger(spec.days) ||
    spec.days < 1 ||
    spec.days > 366 ||
    !Number.isFinite(now.getTime())
  ) {
    throw reportingError("invalid_date_window", "Unsupported rolling window.");
  }
  const currentLocalDate = displayInstant(now, timezone).slice(0, 10);
  const fromLocal = addLocalDays(
    `${currentLocalDate}T00:00:00`,
    -(spec.days - 1),
  ).slice(0, 10);
  return resolveLocalWindow({
    fromLocal,
    throughLocal: currentLocalDate,
    timezone,
  });
}

export function assertIanaTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    if (timezone === "UTC" || timezone.includes("/")) return timezone;
  } catch {
    // Converted to a typed contract error below.
  }
  throw reportingError("invalid_timezone", `Invalid IANA timezone: ${timezone}`);
}

export function resolveLocalWindow(input: {
  fromLocal: string;
  throughLocal?: string;
  toExclusiveLocal?: string;
  timezone: string;
  repeatedTimeDisambiguation?: "earlier" | "later";
}) {
  const timezone = assertIanaTimezone(input.timezone);
  if ((input.throughLocal ? 1 : 0) + (input.toExclusiveLocal ? 1 : 0) !== 1) {
    throw reportingError("invalid_date_window", "Provide exactly one end boundary.");
  }
  const fromUtc = localBoundaryToUtc(
    normalizeBoundary(input.fromLocal),
    timezone,
    input.repeatedTimeDisambiguation,
  );
  const endLocal = input.throughLocal
    ? addLocalDays(parseDateOnly(input.throughLocal), 1)
    : normalizeBoundary(input.toExclusiveLocal!);
  const toUtc = localBoundaryToUtc(endLocal, timezone, input.repeatedTimeDisambiguation);
  if (fromUtc >= toUtc) {
    throw reportingError("invalid_date_window", "The exclusive end must be after the start.");
  }
  return {
    timezone,
    fromUtc: fromUtc.toISOString(),
    toExclusiveUtc: toUtc.toISOString(),
  };
}

export function localBoundaryToUtc(
  value: string,
  timezone: string,
  disambiguation?: "earlier" | "later",
): Date {
  assertIanaTimezone(timezone);
  const expected = parseLocal(value);
  const guess = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
    expected.second,
  );
  const matches: number[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = guess + offsetMinutes * 60_000;
    if (sameParts(partsInZone(new Date(candidate), timezone), expected)) matches.push(candidate);
  }
  const unique = [...new Set(matches)].sort((a, b) => a - b);
  if (!unique.length) {
    throw reportingError("invalid_date_window", `Nonexistent local time: ${value}`);
  }
  if (unique.length > 1 && !disambiguation) {
    throw reportingError("invalid_date_window", `Ambiguous local time requires earlier/later: ${value}`);
  }
  return new Date(disambiguation === "later" ? unique[unique.length - 1]! : unique[0]!);
}

export function displayInstant(instant: Date | string, timezone: string): string {
  assertIanaTimezone(timezone);
  const parts = partsInZone(new Date(instant), timezone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function halfOpenDatePredicate(window: { fromUtc: string; toExclusiveUtc: string }) {
  return { $gte: new Date(window.fromUtc), $lt: new Date(window.toExclusiveUtc) };
}

function normalizeBoundary(value: string): string {
  const date = DATE_ONLY.exec(value);
  return date ? `${value}T00:00:00` : value;
}

function parseDateOnly(value: string): string {
  if (!DATE_ONLY.test(value)) {
    throw reportingError("invalid_date_window", `Expected YYYY-MM-DD: ${value}`);
  }
  return `${value}T00:00:00`;
}

function addLocalDays(value: string, days: number): string {
  const parts = parseLocal(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T00:00:00`;
}

function parseLocal(value: string): LocalParts {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) throw reportingError("invalid_date_window", `Invalid local boundary: ${value}`);
  const parts: LocalParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0),
  };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  if (
    check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day || parts.hour > 23 || parts.minute > 59 || parts.second > 59
  ) throw reportingError("invalid_date_window", `Invalid local boundary: ${value}`);
  return parts;
}

function partsInZone(date: Date, timezone: string): LocalParts {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(values.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function sameParts(a: LocalParts, b: LocalParts): boolean {
  return Object.keys(a).every((key) => a[key as keyof LocalParts] === b[key as keyof LocalParts]);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}
