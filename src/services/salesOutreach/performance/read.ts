import type { z } from "zod";
import { getSalesOutreachPerformanceStateModel, getSalesOutreachSmsRequirementDayModel, getSalesOutreachSmsVolumeContributionModel } from "../../../models/salesOutreach/performance";
import { getSalesOutreachRepDayProjectionModel } from "../../../models/salesOutreach/projections";
import { salesOutreachPerformanceSchema, type salesOutreachPerformanceQuerySchema, type SalesOutreachPerformanceDto } from "../../../validation/v1/salesOutreachPerformance";
import type { OutreachActor } from "../auth";
import { deskTimingOf } from "../config/timing";
import { localInstant, addDays } from "../engine/calendar";
import { goalCallCoverage } from "../evidence/coverage";
import { OutreachError } from "../errors";
import { effectiveRoster } from "../roster/rule";
import { newYorkBusinessDay } from "../reads/businessDay";
import { readFreshness, requireDeskConfiguration, type DeskReadDeps } from "../reads/common";
import { resolveConfiguredGoal, resolveSnapshotGoal } from "../reads/goals";
import { repDayCoverage } from "../contacts/repDay";
import { mongoSalesOutreachReadStore } from "../reads/store";
import { composeTeamPerformance, performanceWeek, type PerformanceCallDay, type PerformanceRequirementDay, type PerformanceVolume } from "./compose";

export type PerformanceEvidence = {
  requirements: PerformanceRequirementDay[]; volumes: PerformanceVolume[];
  call_reliable_from?: string | null;
  state: { volume_reliable_from: string | null; requirements_reliable_from: string | null; full_inventory_completed: boolean; volume_derived_through?: Date | null; volume_certified_through?: Date | null } | null;
};
export type PerformanceStore = { readWeek(start: string, end: string): Promise<PerformanceEvidence> };

export const mongoPerformanceStore: PerformanceStore = {
  async readWeek(start, end) {
    const range = { $gte: start, $lt: end };
    const [requirements, volumes, state, firstFrozenCallDay] = await Promise.all([
      getSalesOutreachSmsRequirementDayModel().find({ business_date: range }, { business_date: 1, obligations: 1, coverage_through: 1, input_complete: 1 }).limit(100001).lean(),
      getSalesOutreachSmsVolumeContributionModel().aggregate<PerformanceVolume>([
        { $match: { business_date: range, disposition: { $in: ["confirmed", "pending"] } } },
        { $group: { _id: { agent_id: "$agent_id", business_date: "$business_date" }, confirmed: { $sum: { $cond: [{ $eq: ["$disposition", "confirmed"] }, 1, 0] } }, pending: { $sum: { $cond: [{ $eq: ["$disposition", "pending"] }, 1, 0] } } } },
        { $project: { _id: 0, agent_id: "$_id.agent_id", business_date: "$_id.business_date", confirmed: 1, pending: 1 } },
        { $limit: 7001 },
      ]),
      getSalesOutreachPerformanceStateModel().findOne({ key: "team" }).lean(),
      getSalesOutreachRepDayProjectionModel().findOne({ "goal_snapshot.configuration_version": { $type: "string" } }, { business_day: 1 }).sort({ business_day: 1 }).lean(),
    ]);
    if (requirements.length > 100000 || volumes.length > 7000)
      throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "performance", code: "report_input_limit" }]);
    return {
      requirements: requirements.map((r) => ({ business_date: r.business_date, obligations: r.obligations as PerformanceRequirementDay["obligations"], coverage_through: r.coverage_through?.toISOString() ?? null, input_complete: r.input_complete })),
      call_reliable_from: firstFrozenCallDay?.business_day ?? null,
      volumes, state: state ? { volume_reliable_from: state.volume_reliable_from ?? null, requirements_reliable_from: state.requirements_reliable_from ?? null, full_inventory_completed: state.full_inventory_completed, volume_derived_through: state.volume_derived_through ?? null, volume_certified_through: state.volume_certified_through ?? null } : null,
    };
  },
};

/** Owner/Manager weekly read. Historical goals require frozen rows; today's roster cannot invent them. */
export async function readTeamPerformance(
  actor: OutreachActor,
  query: z.infer<typeof salesOutreachPerformanceQuerySchema>,
  deps: DeskReadDeps & { performanceStore?: PerformanceStore },
): Promise<SalesOutreachPerformanceDto> {
  if (actor.role !== "owner" && actor.role !== "manager") throw new OutreachError("FORBIDDEN");
  const week = performanceWeek(query.week_start, deps.now);
  const configuration = await requireDeskConfiguration(deps.loader);
  const store = deps.store ?? mongoSalesOutreachReadStore;
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week.start, i)).filter((d) => d <= week.through);
  const [freshness, activeNames, dailyRows, evidence] = await Promise.all([
    readFreshness(store, configuration, deps.now), store.findDeskReps(deps.now),
    Promise.all(dates.map((d) => store.findRepDayRows(d, null))),
    (deps.performanceStore ?? mongoPerformanceStore).readWeek(week.start, week.end_exclusive),
  ]);
  const today = newYorkBusinessDay(deps.now);
  const roster = effectiveRoster(configuration.value.goals, [...activeNames.keys()]);
  const activeIds = new Set(roster.members.map((r) => r.agent_id));
  const timing = deskTimingOf(configuration.value);
  const watermark = goalCallCoverage(freshness.watermarks, timing);
  const workingDays = configuration.value.cadence.working_days;
  const closingMinute = workingDays?.[0]?.close_minute;
  if (closingMinute === undefined) throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "cadence.working_days", code: "missing_closing_time" }]);
  const calls: PerformanceCallDay[] = [];
  for (let index = 0; index < dates.length; index++) {
    const day = dates[index]!;
    const rows = dailyRows[index]!;
    const ids = new Set(rows.map((r) => r.agent_id));
    if (day === today) for (const id of activeIds) ids.add(id);
    for (const agent_id of ids) {
      const row = rows.find((r) => r.agent_id === agent_id);
      const goal = day === today
        ? configuration.value.controls.goal_metrics_enabled ? resolveConfiguredGoal(configuration.value.goals, configuration.version, agent_id, day, roster).goal : null
        : row ? resolveSnapshotGoal(row)?.goal ?? null : null;
      const storedCoverage = row?.coverage as { state?: string } | null;
      let coverage = storedCoverage?.state === "complete" ? "complete" as const : repDayCoverage(day, today, deps.now, freshness.watermarks, timing).state;
      if (day === today && deps.now.getTime() >= localInstant(day, closingMinute, "America/New_York") && (!watermark || watermark.getTime() < localInstant(day, closingMinute, "America/New_York"))) coverage = watermark ? "partial" : "unknown";
      const actual = row ? row.actual_confirmed_all ?? (row.count_scope === "all_outbound" ? row.actual_confirmed : null)
        : coverage === "complete" && day === today ? 0 : null;
      calls.push({ agent_id, business_date: day, goal, actual, coverage,
        awaiting: row?.actual_awaiting_all ?? row?.actual_awaiting_confirmation ?? 0 });
    }
  }
  const ids = new Set([...activeIds, ...calls.map((r) => r.agent_id), ...evidence.volumes.flatMap((r) => r.agent_id ? [r.agent_id] : []),
    ...evidence.requirements.flatMap((d) => d.obligations.flatMap((o) => o.responsible_agent_id ? [o.responsible_agent_id] : []))]);
  const names = await store.findAgentNames([...ids]);
  for (const [id, name] of activeNames) names.set(id, name);
  const capturedSms = configuration.value.controls.rep_sms_capture_enabled ? freshness.coverage.capture.sms : null;
  const derivedSms = evidence.state?.volume_derived_through ?? null;
  const liveSmsThrough = capturedSms && derivedSms ? Math.min(capturedSms.getTime(), derivedSms.getTime()) : 0;
  const retainedSmsThrough = evidence.state?.volume_certified_through?.getTime() ?? 0;
  const smsThrough = Math.max(liveSmsThrough, retainedSmsThrough) ? new Date(Math.max(liveSmsThrough, retainedSmsThrough)).toISOString() : null;
  const firstCallCoverageDate = freshness.watermarks.coverage_from ? newYorkBusinessDay(freshness.watermarks.coverage_from) : null;
  const reliableCallDate = firstCallCoverageDate && evidence.call_reliable_from ? (firstCallCoverageDate > evidence.call_reliable_from ? firstCallCoverageDate : evidence.call_reliable_from) : null;
  return salesOutreachPerformanceSchema.parse(composeTeamPerformance({
    now: deps.now, week_start: week.start, closing_minute: closingMinute, names, active_agent_ids: activeIds, calls,
    requirements: evidence.requirements, volumes: evidence.volumes,
    earliest: { calls: reliableCallDate,
      text_volume: evidence.state?.volume_reliable_from ?? null, text_requirements: evidence.state?.requirements_reliable_from ?? null },
    call_freshness: watermark?.toISOString() ?? null,
    sms_freshness: smsThrough,
    sms_inventory_complete: evidence.state?.full_inventory_completed ?? false,
    today_tolerance_ms: timing.today_coverage_tolerance_ms,
  }));
}
