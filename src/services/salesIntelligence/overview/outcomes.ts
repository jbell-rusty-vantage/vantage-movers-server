import { z } from "zod";
import { type RosterScope } from "../roster";
import { periodRangeShape, readPeriod, validatePeriodRange } from "./queryPeriod";
import { OVERVIEW_PERIODS, periodDto } from "./periods";
import { aggregateCohort, loadSpendCohort, type SpendLead } from "./spend";

export const outcomesQuerySchema = z.object({ scope: z.literal("production").optional(),
  cohort: z.enum(OVERVIEW_PERIODS).default("last_7_days"), ...periodRangeShape }).strict().superRefine((query, ctx) => validatePeriodRange(query.cohort, query, ctx));

/** Every outcome is a Lead count in the received cohort, never a count of bookings or events. */
export function cohortOutcomes(leads: readonly SpendLead[], officialBooked: ReadonlySet<string>) {
  const result = aggregateCohort(leads, officialBooked).total.outcomes;
  return { leads_received: result.leads, quoted: result.quoted, booked_official: result.booked_official, booked_in_granot: result.booked_in_granot };
}

export async function readOutcomes(raw: z.input<typeof outcomesQuerySchema>, options: { now?: Date; scope?: RosterScope } = {}) {
  const query = outcomesQuerySchema.parse(raw), now = options.now ?? new Date();
  const period = readPeriod(query.cohort, now, query.from, query.through);
  const { leads, officialBooked } = await loadSpendCohort(period, { agent_id: options.scope?.agent_id });
  return { as_of: now.toISOString(), data: { ...cohortOutcomes(leads, officialBooked), cohort: periodDto(period), observed_through: now.toISOString(), status: "ready" as const } };
}
