import type {
  SalesOutreachCapabilitiesDto,
  SalesOutreachRepDaysDto,
  SalesOutreachRepDaysQuery,
  SalesOutreachRosterDto,
  SalesOutreachTeamDto,
  SalesOutreachTeamQuery,
} from "../../../validation/v1/salesOutreachReads";
import type { OutreachActor } from "../auth";
import type { ActiveConfiguration } from "../config/load";
import { configurationActivationBlockers } from "../config/reads";
import { OutreachError } from "../errors";
import { composeCapabilities } from "./capabilities";
import {
  baseRead,
  commonRead,
  readCallWatermarks,
  readFreshness,
  requireDeskConfiguration,
  resolveBusinessDay,
  type DeskReadCoverage,
  type DeskReadDeps,
} from "./common";
import { repDayCoverage } from "../contacts/repDay";
import { deskTimingOf } from "../config/timing";
import type { CallWatermarks } from "../evidence/coverage";
import { effectiveRoster, onRoster, rosterInstant, rosterRuleOf, type EffectiveRoster } from "../roster/rule";
import {
  composeOtherCallers,
  composeRepDay,
  composeTeamGoals,
  dayCountScope,
  fallbackCountScope,
  resolveRepDayGoal,
  type OtherCallers,
  type RepDayRow,
} from "./goals";
import { mongoDeskQueueStore, type DeskQueueStore } from "./deskStore";
import { mongoSalesOutreachReadStore, type SalesOutreachReadStore } from "./store";
import { composeRepCadence, composeTeamCadence } from "./teamCadence";

export { requireDeskConfiguration, resolveBusinessDay, type DeskReadDeps } from "./common";

/**
 * Sales Outreach Desk reads: capabilities, rep-days and team (CONTRACTS "HTTP interface", "Common read
 * data"). The queue and the outreach view live in `queue.ts` and `detail.ts`.
 */

/**
 * The call watermarks a rep-day read needs (olr C0): the Call Log capture row and the contact-event
 * derivation row `readFreshness` loads (olr A2 moved the assembly to `common.ts` `readCallWatermarks`
 * so every desk read shares it).
 */
export const repDayCallWatermarks = readCallWatermarks;

/**
 * The effective roster of a business day for a read (P08a-1): under `desk_reps` the desk reps (active
 * Agents with a current reviewed `sales_rep` link) at the day's roster instant — `now` today, the end
 * of the New York day for a past day — joined to their configured settings; under the explicit rule
 * the configured list. Names come from the reviewed link; a past-day member without a current link
 * falls back to the Agent record.
 */
async function readEffectiveRoster(input: {
  store: SalesOutreachReadStore;
  configuration: ActiveConfiguration;
  business_day: string;
  today: string;
  now: Date;
}): Promise<{ roster: EffectiveRoster; at: Date; names: Map<string, string> }> {
  const goals = input.configuration.value.goals;
  const at = rosterInstant(input.business_day, input.today, input.now);
  if (rosterRuleOf(goals) === "explicit") return { roster: effectiveRoster(goals, null), at, names: new Map() };
  const reps = await input.store.findDeskReps(at);
  return { roster: effectiveRoster(goals, [...reps.keys()]), at, names: reps };
}

function rosterDto(roster: EffectiveRoster, at: Date, names: Map<string, string>): SalesOutreachRosterDto {
  return {
    rule: roster.rule,
    roster_version: roster.roster_version,
    at: at.toISOString(),
    members: roster.members.map((member) => ({
      agent_id: member.agent_id,
      agent_name: names.get(member.agent_id) ?? null,
      working_days: [...member.working_days],
      scheduled_goal: member.scheduled_goal,
      schedule_source: member.schedule_source,
    })),
  };
}

/**
 * Per-rep goal rows for one day. `agentId` narrows to one rep. Otherwise, under the explicit roster
 * rule, roster reps (in roster order) come first, then Agents with a row that day who are not on the
 * roster; under `desk_reps` (P08a-1) only the effective roster's reps are rows, and the calls of any
 * other Agent with a row are summed into `other_callers` (the Owner's footnote), never listed as a rep
 * or counted in the team goal. Each row carries the rep's current cadence counts (same rule as the
 * team cards, at `now`).
 */
async function composeRepDays(input: {
  store: SalesOutreachReadStore;
  queueStore: DeskQueueStore;
  configuration: ActiveConfiguration;
  business_day: string;
  today: string;
  now: Date;
  agent_id: string | null;
  /** Capture + derivation call watermarks (`repDayCallWatermarks`). */
  watermarks: CallWatermarks;
  /** The read's channel coverage (olr A2): the overdue counts honour it. */
  coverage: DeskReadCoverage;
}) {
  const { store, configuration, business_day, today, now } = input;
  const effective = await readEffectiveRoster({ store, configuration, business_day, today, now });
  const { roster } = effective;
  const derived = roster.rule === "desk_reps";
  const rosterIds = roster.members.map((member) => member.agent_id);
  const rows: RepDayRow[] = await store.findRepDayRows(business_day, input.agent_id ? [input.agent_id] : null);
  const rowByAgent = new Map(rows.map((row) => [row.agent_id, row]));
  const offRoster = rows.filter((row) => !onRoster(roster, row.agent_id));
  const agents = input.agent_id
    ? [input.agent_id]
    : derived
      ? rosterIds
      : [...rosterIds, ...offRoster.map((row) => row.agent_id).sort()];
  const reviewed = await store.findReviewedRepNames(agents, now);
  // A past-day member without a current reviewed link keeps its name from the Agent record (not "Unknown rep").
  const agentNames = await store.findAgentNames(agents.filter((id) => !reviewed.has(id) && !effective.names.has(id)));
  const nameOf = (id: string) => reviewed.get(id) ?? effective.names.get(id) ?? agentNames.get(id) ?? null;
  // A missing rep-day row is a confirmed 0 only when goal call coverage (observed capture minus the
  // settlement allowance, never past the contact-event derivation; D-A3) reaches the day's requirement
  // (today: as_of − today tolerance), and the day starts on/after the derivation's coverage start (olr C0).
  const coverage = repDayCoverage(business_day, today, now, input.watermarks, deskTimingOf(configuration.value));
  const fallback = fallbackCountScope(configuration.value.goals, business_day);
  const cadence = await composeRepCadence({ configuration, now, queueStore: input.queueStore, agentIds: agents, coverage: input.coverage });
  const reps = agents.map((agent_id) => {
    const row = rowByAgent.get(agent_id) ?? null;
    const goals = composeRepDay({
      agent_id,
      agent_name: nameOf(agent_id),
      reviewed_link: reviewed.has(agent_id),
      goal: resolveRepDayGoal({
        goals: configuration.value.goals,
        configuration_version: configuration.version,
        agent_id,
        business_day,
        today,
        row,
        roster,
      }),
      row,
      fallback_scope: fallback,
      capture_coverage: coverage,
    });
    return { ...goals, ...cadence(agent_id) };
  });
  const projection_revision = rows.reduce<number | null>((max, row) => Math.max(max ?? 0, row.publication_revision), null);
  const other_callers: OtherCallers | null = derived && !input.agent_id ? composeOtherCallers(offRoster) : null;
  return {
    reps,
    scope: dayCountScope(rows),
    projection_revision,
    roster: rosterDto(roster, effective.at, new Map([...effective.names, ...reviewed, ...agentNames])),
    other_callers,
  };
}


/** `GET /capabilities` — Owner, Manager and linked Rep; answers even when the desk is off or broken. */
export async function readDeskCapabilities(actor: OutreachActor, deps: DeskReadDeps): Promise<SalesOutreachCapabilitiesDto> {
  const inspected = await deps.loader.inspect();
  return composeCapabilities(actor, inspected, baseRead(actor, deps.now, actor.role === "rep" ? actor.agent_id : null));
}

/**
 * `GET /rep-days` — Owner/Manager for any rep (or every roster rep), Rep for itself only: a Rep's
 * foreign `agent_id` is refused (403), never broadened or silently replaced.
 */
export async function readRepDays(actor: OutreachActor, query: SalesOutreachRepDaysQuery, deps: DeskReadDeps): Promise<SalesOutreachRepDaysDto> {
  const store = deps.store ?? mongoSalesOutreachReadStore;
  if (actor.role === "rep" && query.agent_id !== undefined && query.agent_id !== actor.agent_id)
    throw new OutreachError("FORBIDDEN", [{ path: "agent_id", code: "foreign_agent" }]);
  const agent_id = actor.role === "rep" ? actor.agent_id : (query.agent_id ?? null);
  const configuration = await requireDeskConfiguration(deps.loader);
  const { business_day, today } = resolveBusinessDay(query.business_day, deps.now);
  const { freshness, watermarks, coverage } = await readFreshness(store, configuration, deps.now);
  const base = { business_day, is_today: business_day === today, goal_metrics_enabled: configuration.value.controls.goal_metrics_enabled };
  if (!base.goal_metrics_enabled) {
    return {
      ...commonRead(actor, deps.now, agent_id, configuration, null, freshness),
      ...base,
      count_scope: null,
      reps: null,
      unknown_reason: "goal_metrics_disabled",
    };
  }
  const days = await composeRepDays({
    store,
    queueStore: deps.queueStore ?? mongoDeskQueueStore,
    configuration,
    business_day,
    today,
    now: deps.now,
    agent_id,
    watermarks,
    coverage,
  });
  return {
    ...commonRead(actor, deps.now, agent_id, configuration, days.projection_revision, freshness),
    ...base,
    count_scope: days.scope ?? days.reps[0]?.count_scope ?? null,
    reps: days.reps,
    unknown_reason: null,
  };
}

/**
 * `GET /team` — Owner/Manager. M1 serves the goal parts (cards 1–2, Daily call goals table) and
 * freshness; overdue cards, Unassigned and Leads needing attention are explicit
 * `not_available_in_m1` fields until the queue lands. Readiness blockers are Owner-only, and so is
 * the `other_callers` footnote (P08a-1).
 */
export async function readTeam(actor: OutreachActor, query: SalesOutreachTeamQuery, deps: DeskReadDeps): Promise<SalesOutreachTeamDto> {
  const store = deps.store ?? mongoSalesOutreachReadStore;
  const configuration = await requireDeskConfiguration(deps.loader);
  const { business_day, today } = resolveBusinessDay(query.business_day, deps.now);
  const { freshness, watermarks, coverage } = await readFreshness(store, configuration, deps.now);
  const goalMetrics = configuration.value.controls.goal_metrics_enabled;
  const queueStore = deps.queueStore ?? mongoDeskQueueStore;
  const days = goalMetrics
    ? await composeRepDays({
        store,
        queueStore,
        configuration,
        business_day,
        today,
        now: deps.now,
        agent_id: null,
        watermarks,
        coverage,
      })
    : null;
  const cadence = await composeTeamCadence({ configuration, now: deps.now, queueStore, readStore: store, coverage });
  const attentionRevision = (cadence.leads_needing_attention.rows ?? []).reduce<number | null>((max, row) => Math.max(max ?? 0, row.publication_revision), null);
  const projection_revision =
    days?.projection_revision === null || days?.projection_revision === undefined ? attentionRevision : Math.max(days.projection_revision, attentionRevision ?? 0);
  return {
    ...commonRead(actor, deps.now, null, configuration, projection_revision, freshness),
    business_day,
    is_today: business_day === today,
    goal_metrics_enabled: goalMetrics,
    goals: days ? composeTeamGoals(days.reps, days.scope, actor.role === "owner" ? days.other_callers : null) : null,
    goals_unknown_reason: days ? null : "goal_metrics_disabled",
    daily_call_goals: days ? days.reps : null,
    roster: days ? days.roster : null,
    distinct_overdue_leads: cadence.distinct_overdue_leads,
    quoted_overdue_leads: cadence.quoted_overdue_leads,
    unassigned: cadence.unassigned,
    leads_needing_attention: cadence.leads_needing_attention,
    cadence_exposure: cadence.exposure,
    readiness:
      actor.role === "owner"
        ? { configuration_state: "active", activation_blockers: configurationActivationBlockers(configuration.value) }
        : null,
  };
}
