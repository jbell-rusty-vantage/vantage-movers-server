import { z } from "zod";
import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceSyncWindowModel } from "../../../models/SalesIntelligenceSyncWindow";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { easternDayKey, easternInstantBounds } from "../../dailyOperations/dayDocument";
import { CALL_LOG_BACKFILL_STREAM } from "../backfill/windows";
import { readRosterAgents, type RosterScope } from "../roster";
import type { TemporalRepLink } from "../repIdentity/resolve";
import { OVERVIEW_PERIODS, periodDto, type OverviewPeriod } from "./periods";
import { periodRangeShape, readPeriod, validatePeriodRange } from "./queryPeriod";
import { buildRepDayDocs, repDayCallFilter, UNMAPPED_REP, type RepDayCall } from "./repDays";

export const activityQuerySchema = z.object({ scope: z.literal("production").optional(), period: z.enum(OVERVIEW_PERIODS).default("today"), ...periodRangeShape })
  .strict().superRefine((query, ctx) => validatePeriodRange(query.period, query, ctx));

export type CaptureInterval = { from: Date; through: Date; complete: boolean };
type ActivityCounts = { human_conversations: number; outbound_attempts: number };
const empty = (): ActivityCounts => ({ human_conversations: 0, outbound_attempts: 0 });
const add = (to: ActivityCounts, value: ActivityCounts) => { to.human_conversations += value.human_conversations; to.outbound_attempts += value.outbound_attempts; };

/** Complete means the union of stored successful capture intervals covers this entire requested day. */
export function activityDayCoverage(from: Date, through: Date, intervals: readonly CaptureInterval[], hasCalls: boolean): "complete" | "partial" | "missing" {
  const overlap = intervals.filter(row => +row.from < +through && +row.through > +from);
  let cursor = +from;
  for (const range of overlap.filter(row => row.complete).sort((a, b) => +a.from - +b.from)) {
    if (+range.from > cursor) break;
    cursor = Math.max(cursor, +range.through);
    if (cursor >= +through) return "complete";
  }
  return overlap.length || hasCalls ? "partial" : "missing";
}

/** Reuses repDays attribution, but totals each interaction once even across transferred rep legs. */
export function buildActivity(period: OverviewPeriod, calls: readonly RepDayCall[], links: readonly TemporalRepLink[], intervals: readonly CaptureInterval[], scope: RosterScope = null) {
  const byRep = new Map<string, ActivityCounts>(), team = empty(), unmapped = empty();
  const lastConversation = new Map<string, Date>();
  const days = period.days.map(day => {
    const dayCalls = calls.filter(call => easternDayKey(call.started_at) === day);
    const totals = empty(), missingRep = empty();
    for (const call of dayCalls) {
      const attributed = buildRepDayDocs(day, [call], links);
      const visible = scope ? attributed.filter(row => row.agent_key === scope.agent_id) : attributed;
      totals.human_conversations += visible.some(row => row.human_conversations > 0) ? 1 : 0;
      totals.outbound_attempts += visible.some(row => row.outbound_attempts > 0) ? 1 : 0;
      for (const row of visible) {
        const value = { human_conversations: row.human_conversations, outbound_attempts: row.outbound_attempts };
        if (row.agent_key === UNMAPPED_REP) { add(missingRep, value); continue; }
        const target = byRep.get(row.agent_key) ?? empty(); add(target, value); byRep.set(row.agent_key, target);
        if (row.human_conversations > 0 && +call.started_at > +(lastConversation.get(row.agent_key) ?? 0)) lastConversation.set(row.agent_key, call.started_at);
      }
    }
    const bounds = easternInstantBounds(day), through = +bounds.end > +period.end ? period.end : bounds.end;
    const coverage = activityDayCoverage(bounds.start, through, intervals, dayCalls.length > 0);
    add(team, totals); add(unmapped, missingRep);
    return { day, coverage, human_conversations: coverage === "missing" ? null : totals.human_conversations, outbound_attempts: coverage === "missing" ? null : totals.outbound_attempts };
  });
  const missing = days.some(day => day.coverage === "missing");
  const counted = (value: ActivityCounts) => ({ human_conversations: missing ? null : value.human_conversations, outbound_attempts: missing ? null : value.outbound_attempts });
  return { totals: counted(team), by_rep: [...byRep].map(([agent_id, count]) => ({ agent_id, ...counted(count), last_conversation_at: missing ? null : lastConversation.get(agent_id)?.toISOString() ?? null })),
    unmapped: scope ? null : counted(unmapped), coverage: days,
    status: days.every(day => day.coverage === "complete") ? "complete" as const : "partial" as const };
}

async function readCaptureIntervals(period: OverviewPeriod): Promise<CaptureInterval[]> {
  const [windows, states] = await Promise.all([
    getSalesIntelligenceSyncWindowModel().find({ stream: CALL_LOG_BACKFILL_STREAM, window_from: { $lt: period.end }, window_to: { $gt: period.start } })
      .select({ window_from: 1, window_to: 1, status: 1, records: 1 }).lean(),
    getSalesIntelligenceSyncStateModel().find({ scope: { $in: ["call_log_all_directions", "call_log_sweep"] } })
      .select({ scope: 1, cursor: 1, known_complete_through: 1, last_run: 1, gaps: 1 }).lean(),
  ]);
  const intervals: CaptureInterval[] = windows.filter(window => window.status === "complete" || window.records > 0)
    .map(window => ({ from: window.window_from, through: window.window_to, complete: window.status === "complete" }));
  for (const state of states) {
    const from = state.scope === "call_log_sweep" ? state.last_run?.from : state.cursor?.last_sync_from;
    const through = state.scope === "call_log_sweep" ? state.last_run?.to : state.known_complete_through;
    if (!from || !through || +from >= +through) continue;
    // Gaps explicitly prevent treating the containing capture interval as complete.
    const gap = (state.gaps ?? []).some(g => +g.from < +through && +g.to > +from);
    const complete = Boolean(state.last_run?.finished_at && !gap && !state.last_run.error_code && !state.last_run.failures && !state.last_run.quarantined);
    if (complete || (state.last_run?.records ?? 0) > 0 || (state.last_run?.provider_records ?? 0) > 0) intervals.push({ from, through, complete });
  }
  return intervals;
}

export async function readActivity(raw: z.input<typeof activityQuerySchema>, options: { now?: Date; scope?: RosterScope } = {}) {
  const query = activityQuerySchema.parse(raw), now = options.now ?? new Date(), scope = options.scope ?? null;
  const period = readPeriod(query.period, now, query.from, query.through);
  const [calls, intervals, agents] = await Promise.all([
    getCallInteractionModel().find({ ...repDayCallFilter(period.from_day), direction: { $in: ["Inbound", "Outbound"] }, started_at: { $gte: period.start, $lt: period.end } })
      .select({ provider_account_id: 1, started_at: 1, direction: 1, contact_type: 1, provider_connected: 1, duration_seconds: 1, capture_recovery: 1, parties: 1, legs: 1 }).lean(),
    readCaptureIntervals(period), readRosterAgents(scope),
  ]);
  const accounts = [...new Set(calls.map(call => call.provider_account_id))];
  const extensions = [...new Set(calls.flatMap(call => call.parties.flatMap(p => p.extension_id ? [p.extension_id] : [])))];
  const links = extensions.length ? await getRepIdentityLinkModel().find({ rc_account_id: { $in: accounts }, rc_extension_id: { $in: extensions } }).lean() : [];
  const result = buildActivity(period, calls, links, intervals, scope);
  const names = new Map(agents.map(agent => [String(agent._id), agent.name]));
  return { as_of: now.toISOString(), data: { ...result, by_rep: result.by_rep.map(row => ({ ...row, name: names.get(row.agent_id) ?? "Unknown Agent" })), period: periodDto(period) } };
}
