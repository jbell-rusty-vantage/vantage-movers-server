export const FLORIDA_TIME_ZONE = "America/New_York";

const easternDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: FLORIDA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const floridaCalendarDisplayFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const easternDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: FLORIDA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

/**
 * Stores the Florida/Eastern wall-clock value in a Date field.
 *
 * Mongo Date values are UTC instants and do not carry timezone metadata. The
 * leads workflow treats `timestamp` as an owner-facing local clock value, so we
 * convert incoming/default timestamps to their America/New_York components
 * before persisting them.
 */
function easternCalendarParts(value: Date) {
  const parts = easternDateFormatter.formatToParts(value);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<"year" | "month" | "day", string>;
}

/**
 * Owner-facing calendar dates (book_date, move_date, cancel_date) are stored as
 * UTC midnight using the Florida calendar day the owner entered.
 */
export function parseFloridaCalendarDate(value: unknown): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("Invalid calendar date");
    }
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return parseFloridaCalendarDate(new Date(value));
  }

  if (typeof value !== "string") {
    throw new TypeError("Invalid calendar date");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError("Invalid calendar date");
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Invalid calendar date");
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

export function formatFloridaCalendarDate(value: Date): string {
  return floridaCalendarDisplayFormatter.format(value);
}

export function formatFloridaCalendarDateIso(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function floridaCalendarDateInputValue(value: Date = new Date()): string {
  const parts = value instanceof Date ? easternCalendarParts(value) : easternCalendarParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function floridaCalendarToday(now: Date = new Date()): Date {
  const parts = easternCalendarParts(now);
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
}

export function toFloridaTimestamp(value: Date = new Date()): Date {
  const parts = easternDateTimeFormatter.formatToParts(value);
  const dateParts = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return new Date(
    Date.UTC(
      Number(dateParts.year),
      Number(dateParts.month) - 1,
      Number(dateParts.day),
      Number(dateParts.hour),
      Number(dateParts.minute),
      Number(dateParts.second),
      value.getMilliseconds(),
    ),
  );
}
