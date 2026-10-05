import type {
  SalesOutreachCapabilitiesDto,
  SalesOutreachRepDaysDto,
  SalesOutreachRepDaysQuery,
  SalesOutreachTeamDto,
  SalesOutreachTeamQuery,
} from "../../../validation/v1/salesOutreachReads";
import type { OutreachActor } from "../auth";
import type { ActiveConfiguration } from "../config/load";
import { configurationActivationBlockers } from "../config/reads";
import { OutreachError } from "../errors";
import { composeCapabilities } from "./capabilities";
import { baseRead, commonRead, readFreshness, requireDeskConfiguration, resolveBusinessDay, type DeskReadDeps } from "./common";
import { repDayCoverage } from "../contacts/repDay";
import {
  composeRepDay,
  composeTeamGoals,
  dayCountScope,
  fallbackCountScope,
  resolveRepDayGoal,
  type RepDayRow,
} from "./goals";
import { mongoDeskQueueStore, type DeskQueueStore } from "./deskStore";
import { mongoSalesOutreachReadStore, type ContactDerivationMark, type SalesOutreachReadStore } from "./store";
import { composeRepCadence, composeTeamCadence } from "./teamCadence";

export { requireDeskConfiguration, resolveBusinessDay, type DeskReadDeps } from "./common";

/**
 * Sales Outreach Desk reads: capabilities, rep-days and team (CONTRACTS "HTTP interface", "Common read
 * data"). The queue and the outreach view live in `queue.ts` and `detail.ts`.
 */

/**
 * Per-rep goal rows for one day. `agentId` narrows to one rep; otherwise roster reps (in roster
 * order) come first, then Agents with a row that day who are not on the roster. Each row carries the
 * rep's current cadence counts (same rule as the team cards, at `now`).
 */
async function composeRepDays(input: {
  store: SalesOutreachReadStore;
  queueStore: DeskQueueStore;
  configuration: ActiveConfiguration;
  business_day: string;
  today: string;
  now: Date;
  agent_id: string | null;
  calls_known_complete_through: Date | null;
  /** The contact-event derivation watermark (`outreach_contact_calls`); null until S3's sweep has run. */
  derivation: ContactDerivationMark | null;
}) {
  const { store, configuration, business_day, today, now } = input;
  const roster = (configuration.value.goals.rep_work_schedules ?? []).map((row) => row.agent_id);
  const rows: RepDayRow[] = await store.findRepDayRows(business_day, input.agent_id ? [input.agent_id] : null);
  const rowByAgent = new Map(rows.map((row) => [row.agent_id, row]));
  const agents = input.agent_id
    ? [input.agent_id]
    : [...roster, ...rows.map((row) => row.agent_id).filter((id) => !roster.includes(id)).sort()];
  const names = await store.findReviewedRepNames(agents, now);
  // A missing rep-day row is a confirmed 0 only when capture (minus the settlement allowance) AND the
  // contact-event derivation cover the day, and the day starts on/after the derivation's coverage start.
  const coverage = repDayCoverage(business_day, today, now, {
    capture_known_complete_through: input.calls_known_complete_through,
    derived_through: input.derivation?.known_complete_through ?? null,
    coverage_from: input.derivation?.coverage_from ?? null,
  });
  const fallback = fallbackCountScope(rows);
  const cadence = await composeRepCadence({ configuration, now, queueStore: input.queueStore, agentIds: agents });
  const reps = agents.map((agent_id) => {
    const row = rowByAgent.get(agent_id) ?? null;
    const goals = composeRepDay({
      agent_id,
      agent_name: names.get(agent_id) ?? null,
      reviewed_link: names.has(agent_id),
      goal: resolveRepDayGoal({
        goals: configuration.value.goals,
        configuration_version: configuration.version,
        agent_id,
        business_day,
        today,
        row,
      }),
      row,
      fallback_scope: fallback,
      capture_coverage: coverage,
    });
    return { ...goals, ...cadence(agent_id) };
  });
  const projection_revision = rows.reduce<number | null>((max, row) => Math.max(max ?? 0, row.publication_revision), null);
  return { reps, scope: dayCountScope(rows), projection_revision };
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
  const { calls, freshness } = await readFreshness(store, configuration, deps.now);
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
    calls_known_complete_through: calls?.known_complete_through ?? null,
    derivation: await store.readContactDerivation(),
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
 * `not_available_in_m1` fields until the queue lands. Readiness blockers are Owner-only.
 */
export async function readTeam(actor: OutreachActor, query: SalesOutreachTeamQuery, deps: DeskReadDeps): Promise<SalesOutreachTeamDto> {
  const store = deps.store ?? mongoSalesOutreachReadStore;
  const configuration = await requireDeskConfiguration(deps.loader);
  const { business_day, today } = resolveBusinessDay(query.business_day, deps.now);
  const { calls, freshness } = await readFreshness(store, configuration, deps.now);
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
        calls_known_complete_through: calls?.known_complete_through ?? null,
        derivation: await store.readContactDerivation(),
      })
    : null;
  const cadence = await composeTeamCadence({ configuration, now: deps.now, queueStore, readStore: store });
  const attentionRevision = (cadence.leads_needing_attention.rows ?? []).reduce<number | null>((max, row) => Math.max(max ?? 0, row.publication_revision), null);
  const projection_revision =
    days?.projection_revision === null || days?.projection_revision === undefined ? attentionRevision : Math.max(days.projection_revision, attentionRevision ?? 0);
  return {
    ...commonRead(actor, deps.now, null, configuration, projection_revision, freshness),
    business_day,
    is_today: business_day === today,
    goal_metrics_enabled: goalMetrics,
    goals: days ? composeTeamGoals(days.reps, days.scope) : null,
    goals_unknown_reason: days ? null : "goal_metrics_disabled",
    daily_call_goals: days ? days.reps : null,
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
