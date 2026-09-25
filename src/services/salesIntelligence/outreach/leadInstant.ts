import { easternDateTimeParts, easternWallClockToUtc } from "../../../utils/easternTime";

/**
 * S11-TIME (UI-1 §7, UX8): the real instant a Lead arrived, for the Outreach time base.
 *
 * `Lead.timestamp` has two conventions and it does not change here (Daily Operations, CPL periods and
 * the lead-spend report read it as a wall clock):
 * - **ET wall clock in a UTC `Date`** (`toFloridaTimestamp`): every Form/Call ingestion path (WordPress
 *   form, RingCentral, Best Relocation sheet, Vantage admin, booking-created Call Leads, legacy rows).
 * - **Real instant**: Leads created from Granot (`createLeadFromGranot` stores `observation.captured_at`),
 *   the only writers with `ingestion_origin: "granot_lead_created"`; and any row whose `timestamp` cannot be a
 *   wall clock because read that way the Lead would have arrived after its own row was created. Those are rows
 *   written without `toFloridaTimestamp`: the historical consolidation (`historicalConsolidation/planner.ts`
 *   stores `easternWallClockToUtc(sheet time)` with `createdAt` = the same instant, later labelled
 *   `legacy_unknown`), a `timestamp` left to the schema default `Date.now`, and synthetic rows.
 *
 * Rule, in order:
 * 1. `ingestion_origin === "granot_lead_created"` → instant;
 * 2. `createdAt` present and the wall-clock reading is more than `ARRIVAL_AFTER_CREATION_SLACK_MS` (1 h) after
 *    `createdAt` → instant. A live wall-clock row has `createdAt − timestamp` ≥ the UTC offset (4–5 h) plus the
 *    ingestion lag; the hour of slack absorbs a submitting client's clock running ahead of the server;
 * 3. anything else, including a missing origin (booking-created Call Leads are written without one, with
 *    `toFloridaTimestamp`) → wall clock.
 */
export const INSTANT_TIMESTAMP_ORIGINS: ReadonlySet<string> = new Set(["granot_lead_created"]);
export const ARRIVAL_AFTER_CREATION_SLACK_MS = 3_600_000;
export type LeadTimeSource = { timestamp?: Date | null; createdAt?: Date | null; ingestion_origin?: string | null };
export type LeadTimestampConvention = "instant" | "wall_clock";

export function leadTimestampConvention(lead: LeadTimeSource): LeadTimestampConvention {
  if (INSTANT_TIMESTAMP_ORIGINS.has(lead.ingestion_origin ?? "")) return "instant";
  const stored = lead.timestamp, created = lead.createdAt;
  if (stored instanceof Date && created instanceof Date && Number.isFinite(+stored) && Number.isFinite(+created)
    && +wallClockToInstant(stored) > +created + ARRIVAL_AFTER_CREATION_SLACK_MS) return "instant";
  return "wall_clock";
}

const HOUR = 3_600_000;
/**
 * The inverse of `toFloridaTimestamp`: read the stored UTC components as America/New_York wall clock.
 * - Fall-back hour (first Sunday of November, 01:00–01:59 happens twice): the **first** occurrence (EDT).
 *   `toFloridaTimestamp` maps both to the same value, so the stored value cannot tell them apart.
 * - Spring-forward gap (second Sunday of March, 02:00–02:59 never happens): `toFloridaTimestamp` never
 *   writes one; a value there (hand-edited or imported) is read at the standard offset UTC−5, so
 *   02:30 becomes 07:30Z (= 03:30 EDT), the "clock moved forward" reading.
 * Milliseconds are kept (`toFloridaTimestamp` keeps them).
 */
export function wallClockToInstant(stored: Date): Date {
  const y = stored.getUTCFullYear(), mo = stored.getUTCMonth() + 1, d = stored.getUTCDate();
  const h = stored.getUTCHours(), mi = stored.getUTCMinutes(), s = stored.getUTCSeconds(), ms = stored.getUTCMilliseconds();
  const found = easternWallClockToUtc(y, mo, d, h, mi, s);
  if (!found) return new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms) + 5 * HOUR);
  // `easternWallClockToUtc` tries EST before EDT, so in the repeated hour it returns the second occurrence.
  const earlier = new Date(+found - HOUR), p = easternDateTimeParts(earlier);
  const first = p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi && p.second === s ? earlier : found;
  return new Date(+first + ms);
}

/** The Lead's arrival as a real instant (`trigger_at` of its Outreach record). */
export function leadInstant(lead: LeadTimeSource & { timestamp: Date }): Date;
export function leadInstant(lead: LeadTimeSource): Date | null;
export function leadInstant(lead: LeadTimeSource): Date | null {
  const stored = lead.timestamp;
  if (!(stored instanceof Date) || !Number.isFinite(+stored)) return null;
  return leadTimestampConvention(lead) === "instant" ? stored : wallClockToInstant(stored);
}
