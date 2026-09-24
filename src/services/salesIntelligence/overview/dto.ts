import { z } from "zod";

/**
 * S9-READS `GET /overview` response (assignment addendum §8: `{ as_of, now, desk, reps[], unmapped,
 * unassigned, spend{ total, by_rep[], by_source[] }, team_medians? }`), Zod-validated on the way out.
 * Money is dollars (two decimals, summed in cents); durations say their unit; a rate or median with no
 * denominator is null (unknown is never zero).
 */
const count = z.number().int().nonnegative();
const money = z.number().nonnegative();
const nullableNumber = z.number().nullable();
const iso = z.string();
const bands = z.object({ "1": count, "2": count, "3": count, "4": count, "5": count, "6": count, "7": count }).strict();
const period = z.object({ key: z.string(), from_day: z.string(), to_day: z.string(), start: iso, end: iso }).strict();
const spendBucket = z.object({ leads: count, spend: money, rate: money, legacy: money, unpriced_leads: count, zero_leads: count }).strict();
const sourceBucket = spendBucket.extend({ source: z.string(), unit_cpl: money.nullable() }).strict();
const outcomes = z.object({ leads: count, quoted: count, booked_in_granot: count, booked_official: count, bookings: count, booking_rate: nullableNumber }).strict();
const interactions = z.object({ outbound_attempts: count, answered_inbound: count, human_conversations: count, talk_minutes: z.number().nonnegative(),
  attempt_conversation_rate: nullableNumber, calls: count, recovered_calls: count }).strict();
const bandTime = z.object({ median_ms: nullableNumber, known: count, unknown: count }).strict();

export const overviewRepRowSchema = z.object({
  agent: z.object({ id: z.string(), name: z.string() }).strict(),
  open_assignments: z.object({ open: count, bands, overdue: count }).strict(),
  interactions,
  outcomes,
  spend: spendBucket,
  by_source: z.array(sourceBucket),
  cost_per_booking: money.nullable(),
}).strict();

export const overviewDtoSchema = z.object({
  as_of: iso,
  snapshot_id: z.string().nullable(),
  status: z.enum(["ready", "pending_projection"]),
  scope: z.object({ agent_id: z.string() }).strict().nullable(),
  filters: z.object({ priority: z.array(z.string()).nullable() }).strict(),
  periods: z.object({ activity: period, spend: period }).strict(),
  now: z.object({
    bands, needs_review: count, unassigned: count, live_calls: count, active: count,
    capture_health: z.object({ status: z.enum(["ok", "attention", "broken"]) }).strict(),
  }).strict(),
  desk: z.object({
    speed_to_lead: z.object({ leads: count, worked: count, median_staffed_minutes: nullableNumber, p90_staffed_minutes: nullableNumber, still_waiting: count,
      missed_target: count, target_staffed_minutes: count }).strict(),
    callbacks_kept: z.object({ due: count, kept: count, kept_share: nullableNumber, kept_unreached: count, kept_contact_unknown: count, not_kept: count,
      overdue_now: count, pending: count }).strict(),
    missed_calls_returned: z.object({ episodes: count, returned_on_time: count, returned_late: count, still_open: count, closed_unreturned: count,
      on_time_share: nullableNumber, median_staffed_minutes_to_return: nullableNumber }).strict(),
    flow: z.object({
      new_outreach: count, moved_to_quoted: count, booked_in_granot: count, booked: count, crm_bad_dead: count, owner_closed: count, closed_total: count,
      net_active_change: z.number().int(),
      bands: z.object({ moves: count, into_band: bands, out_of_band: bands, capture_repair: count, excluded_baseline_or_policy: count }).strict(),
      time_in_band: z.object({ "1": bandTime, "2": bandTime, "3": bandTime, "4": bandTime, "5": bandTime, "6": bandTime, "7": bandTime }).strict(),
    }).strict(),
  }).strict(),
  reps: z.array(overviewRepRowSchema),
  /** Calls on extensions without a reviewed sales-rep identity (E17). Null in a one-rep scope. */
  unmapped: z.object({ interactions, extensions: z.array(z.string()) }).strict().nullable(),
  /** Records with no rep now, and Leads with no `receiver_agent` (E19). Null in a one-rep scope. */
  unassigned: z.object({ records_now: count, outcomes, spend: spendBucket, by_source: z.array(sourceBucket), cost_per_booking: money.nullable() }).strict().nullable(),
  spend: z.object({
    total: spendBucket.extend({ outcomes }).strict(),
    by_rep: z.array(spendBucket.extend({ agent_id: z.string().nullable() }).strict()),
    by_source: z.array(sourceBucket),
  }).strict(),
  team_medians: z.object({ reps: count }).catchall(nullableNumber).optional(),
}).strict();
export type OverviewDto = z.infer<typeof overviewDtoSchema>;
