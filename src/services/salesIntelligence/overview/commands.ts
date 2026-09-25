import { z } from "zod";
import { csiFlag } from "../../../config/domain/salesIntelligence";
import { csiTextSchema } from "../../../validation/v1/salesIntelligence";
import { easternDayKey } from "../../dailyOperations/dayDocument";
import { CsiError, type CsiActor } from "../auth";
import { appendCsiAudit, executeCsiCommand } from "../transactions";
import { rebuildRepDay } from "./repDays";

/**
 * Addendum §6.4: the Owner command `rebuild_overview_day` recomputes any ET day's `outreach_rep_days`
 * (for example after a capture repair filled an older day). It runs through the idempotent command
 * ledger: the rebuild and its audit row commit in the command's transaction, and a retry with the same
 * `Idempotency-Key` replays the stored result. Behind `SALES_INTELLIGENCE_OVERVIEW`.
 */
export const rebuildOverviewDayCommandSchema = z.object({
  command: z.literal("rebuild_overview_day"),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: csiTextSchema,
  scope: z.literal("production").optional(),
}).strict();

/** V-T3 m5: a real `YYYY-MM-DD` calendar date, by round-trip (`2026-02-31` is refused, not rolled into March). */
export function isCalendarDayKey(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const at = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(+at) && at.toISOString().slice(0, 10) === day;
}

export async function commandRebuildOverviewDay(input: { actor: CsiActor; idempotency_key: string; command: unknown; now?: Date }) {
  if (!csiFlag("OVERVIEW")) throw new CsiError("FEATURE_DISABLED");
  const body = rebuildOverviewDayCommandSchema.parse(input.command);
  if (!isCalendarDayKey(body.day) || body.day > easternDayKey(input.now ?? new Date())) throw new CsiError("INVALID_INPUT");
  const { response, replayed } = await executeCsiCommand({
    actor: input.actor,
    command: "rebuild_overview_day",
    idempotency_key: input.idempotency_key,
    payload: { day: body.day, reason: body.reason },
    operation: async (ctx) => {
      const result = await rebuildRepDay(body.day, { session: ctx.session });
      await appendCsiAudit(ctx, { kind: "job", target_id: `overview-day:${body.day}`, subject_key: `overview_day:${body.day}`, revision: 1,
        event_kind: "overview_day_rebuilt", prior: { day: body.day }, current: { ...result, reason: body.reason } });
      return result;
    },
  });
  return { ...response, replayed };
}
