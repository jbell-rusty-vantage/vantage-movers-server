import { leadInstant, type LeadTimeSource } from "../salesOutreach/subjects/leadInstant";
import { easternDayKey, easternHour, type InstantBounds } from "./dayDocument";

/**
 * The one time rule for a Lead in Daily Operations (SPECIFICATION §14 repair, SRV-9): a Lead belongs to
 * the New York business day and hour of its real arrival instant, read through the Lead-instant rule
 * (`leadInstant`: `Lead.timestamp` is an ET wall clock for every ingestion path except Granot-created
 * Leads and legacy rows, which store the instant). Live recording and rebuild both use it, so they agree:
 * a Granot-created Lead at 22:00 EDT is that evening's Lead in both, and a wall-clock Lead at 01:30 ET is
 * that night's Lead in both (live used to read the wall clock as UTC).
 */
export type DailyOperationsLeadTime = LeadTimeSource & { timestamp?: Date | string | null };

export function leadArrivalInstant(lead: DailyOperationsLeadTime): Date | undefined {
  const timestamp = lead.timestamp instanceof Date ? lead.timestamp : typeof lead.timestamp === "string" ? new Date(lead.timestamp) : null;
  if (!timestamp || Number.isNaN(timestamp.getTime())) return undefined;
  return leadInstant({ timestamp, createdAt: lead.createdAt ?? null, ingestion_origin: lead.ingestion_origin ?? null }) ?? undefined;
}

/**
 * The stored `timestamp` range a rebuild must scan for `day`: both conventions (wall clock `[D 00:00Z,
 * D+1 00:00Z)` and instant `[D 04:00Z, D+1 05:00Z)`) fit in the wall-clock range widened by six hours.
 * Rows are then kept by `leadDayOf` (the scan is a superset).
 */
export function leadTimestampScanRange(floridaRange: InstantBounds): InstantBounds {
  return { start: floridaRange.start, end: new Date(floridaRange.end.getTime() + 6 * 3_600_000) };
}

export function leadDayOf(lead: DailyOperationsLeadTime): { day: string; hour: number } | null {
  const instant = leadArrivalInstant(lead);
  return instant ? { day: easternDayKey(instant), hour: easternHour(instant) } : null;
}
