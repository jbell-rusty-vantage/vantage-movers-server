import { z } from "zod";
import { CsiError } from "../auth";
import { calendarDayParam } from "../outreach/attention";
import { resolveOverviewPeriod, type OverviewPeriod, type OverviewPeriodKey } from "./periods";

export const periodRangeShape = { from: calendarDayParam.optional(), through: calendarDayParam.optional() };
export function validatePeriodRange(key: OverviewPeriodKey, range: { from?: string; through?: string }, ctx: z.RefinementCtx) {
  if (key === "custom" && (!range.from || !range.through)) ctx.addIssue({ code: "custom", path: ["from"], message: "Custom period requires from and through" });
  if (key !== "custom" && (range.from !== undefined || range.through !== undefined)) ctx.addIssue({ code: "custom", path: ["from"], message: "Calendar bounds require custom period" });
  if (range.from && range.through && range.from > range.through) ctx.addIssue({ code: "custom", path: ["through"], message: "Must be on or after from" });
}
export function readPeriod(key: OverviewPeriodKey, now: Date, from?: string, through?: string): OverviewPeriod {
  if (key !== "custom" && (from !== undefined || through !== undefined)) throw new CsiError("INVALID_INPUT");
  try { return resolveOverviewPeriod(key, now, { from, to: through }); } catch { throw new CsiError("INVALID_INPUT"); }
}
