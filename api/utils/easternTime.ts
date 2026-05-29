export const FLORIDA_TIME_ZONE = "America/New_York";

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
