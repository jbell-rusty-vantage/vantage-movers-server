import { z } from "zod";
import { salesOutreachBusinessDateSchema } from "./salesOutreach";

export const salesOutreachPerformanceQuerySchema = z.object({
  scope: z.literal("production").optional(),
  week_start: salesOutreachBusinessDateSchema.optional(),
}).strict();

const count = z.number().int().nonnegative();
const nullableCount = count.nullable();
const rate = z.number().min(0).max(1).nullable();
const date = salesOutreachBusinessDateSchema;
const instant = z.iso.datetime().nullable();
const coverage = z.enum(["complete", "partial", "unknown"]);
const state = z.enum(["met", "not_met", "in_progress", "no_goal", "no_texts_due", "pending_data", "upcoming"]);
export const salesOutreachPerformanceDaySchema = z.object({
  business_date: date,
  future: z.boolean(),
  calls: z.object({ actual: nullableCount, goal: nullableCount, state, coverage }),
  texts: z.object({
    sent: nullableCount, on_time_required: count, resolved_due_required: count,
    applicable_required: count, pending: count, state, coverage,
  }),
});
export const salesOutreachPerformanceRowSchema = z.object({
  agent_id: z.string().regex(/^[a-f\d]{24}$/),
  name: z.string().nullable(),
  historical_membership_state: z.enum(["active", "historical", "unknown"]),
  calls: z.object({
    rank: count.positive().nullable(), weekly_volume: nullableCount, met_days: count,
    eligible_days: count, pending_days: count, completion_rate: rate, provisional: z.boolean(),
  }),
  texts: z.object({
    rank: count.positive().nullable(), weekly_volume: nullableCount, on_time_required: count,
    resolved_due_required: count, pending_requirements: count, completion_rate: rate, provisional: z.boolean(),
  }),
  days: z.array(salesOutreachPerformanceDaySchema).length(7),
});
export const salesOutreachPerformanceSchema = z.object({
  week: z.object({ start: date, end_exclusive: date, through: date, timezone: z.literal("America/New_York") }),
  as_of: z.iso.datetime(),
  earliest_reliable_dates: z.object({ calls: date.nullable(), text_volume: date.nullable(), text_requirements: date.nullable() }),
  channel_freshness: z.object({ calls: instant, texts: instant }),
  provisional: z.object({ calls: z.boolean(), texts: z.boolean() }),
  rows: z.array(salesOutreachPerformanceRowSchema),
  unassigned: z.object({ required_text_counts: count }),
});
export type SalesOutreachPerformanceDto = z.infer<typeof salesOutreachPerformanceSchema>;
export type PerformanceDay = z.infer<typeof salesOutreachPerformanceDaySchema>;
export type PerformanceRow = z.infer<typeof salesOutreachPerformanceRowSchema>;
