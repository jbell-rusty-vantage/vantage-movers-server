import { SALES_OUTREACH_CONTRACT_VERSION, SALES_OUTREACH_TIMEZONE } from "../../../config/domain/salesOutreach";
import type {
  SalesOutreachCapabilitiesDto,
  SalesOutreachRepDaysDto,
  SalesOutreachRepDaysQuery,
  SalesOutreachTeamDto,
  SalesOutreachTeamQuery,
} from "../../../validation/v1/salesOutreachReads";
import type { OutreachActor } from "../auth";
import type { ActiveConfiguration, ConfigurationLoader } from "../config/load";
import { configurationActivationBlockers } from "../config/reads";
import { OutreachError } from "../errors";
import { newYorkBusinessDay } from "./businessDay";
import { composeCapabilities } from "./capabilities";
import { callsCoverageForDay, composeFreshness, requiredCoverageThrough, type SalesOutreachFreshness } from "./freshness";
import {
  composeRepDay,
  composeTeamGoals,
  dayCountScope,
  fallbackCountScope,
  resolveRepDayGoal,
  type RepDayRow,
} from "./goals";
import { mongoSalesOutreachReadStore, type SalesOutreachReadStore } from "./store";

/**
 * Sales Outreach Desk M1 reads (FAST-TRACK M1; CONTRACTS "HTTP interface", "Common read data").
 * Each read takes one server reference instant (`now`), reads the configuration pointer once and
 * never writes, initializes configuration or calls a provider.
 */
export type DeskReadDeps = Readonly<{
  loader: ConfigurationLoader;
  store?: SalesOutreachReadStore;
  now: Date;
}>;

const NOT_AVAILABLE_IN_M1 = { value: null, unknown_reason: "not_available_in_m1" } as const;

function baseRead(actor: OutreachActor, now: Date, scopedAgent: string | null) {
  return {
    contract_version: SALES_OUTREACH_CONTRACT_VERSION,
    as_of: now.toISOString(),
    timezone: SALES_OUTREACH_TIMEZONE,
    scope: { role: actor.role, agent_id: scopedAgent },
  };
}

/**
 * The active configuration for a desk read, or a fail-closed refusal: uninitialized or broken
 * configuration and `controls.desk_enabled = false` all answer 503 `CONFIGURATION_UNAVAILABLE`
 * (with an issue naming why). The Owner's configuration and capabilities routes stay open.
 */
export async function requireDeskConfiguration(loader: ConfigurationLoader): Promise<ActiveConfiguration> {
  const loaded = await loader.load();
  if (loaded.state !== "active")
    throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "configuration", code: "configuration_uninitialized" }]);
  if (!loaded.value.controls.desk_enabled)
    throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "controls.desk_enabled", code: "desk_disabled" }]);
  return loaded;
}

/** The requested business day (default: today in New York at `now`); future days are refused. */
export function resolveBusinessDay(requested: string | undefined, now: Date): { business_day: string; today: string } {
  const today = newYorkBusinessDay(now);
  const business_day = requested ?? today;
  if (business_day > today) throw new OutreachError("INVALID_INPUT", [{ path: "business_day", code: "future_business_day" }]);
  return { business_day, today };
}

async function readFreshness(store: SalesOutreachReadStore, configuration: ActiveConfiguration, now: Date) {
  const smsEnabled = configuration.value.controls.rep_sms_capture_enabled;
  const [calls, mailboxes, granot] = await Promise.all([
    store.readCallsCapture(),
    smsEnabled ? store.readSmsMailboxes() : Promise.resolve([]),
    store.readLatestGranotObservationAt(),
  ]);
  return {
    calls,
    freshness: composeFreshness({ now, calls, sms_capture_enabled: smsEnabled, sms_mailboxes: mailboxes, granot_last_observed_at: granot }),
  };
}

/**
 * Per-rep goal rows for one day. `agentId` narrows to one rep; otherwise roster reps (in roster
 * order) come first, then Agents with a row that day who are not on the roster.
 */
async function composeRepDays(input: {
  store: SalesOutreachReadStore;
  configuration: ActiveConfiguration;
  business_day: string;
  today: string;
  now: Date;
  agent_id: string | null;
  calls_known_complete_through: Date | null;
}) {
  const { store, configuration, business_day, today, now } = input;
  const roster = (configuration.value.goals.rep_work_schedules ?? []).map((row) => row.agent_id);
  const rows: RepDayRow[] = await store.findRepDayRows(business_day, input.agent_id ? [input.agent_id] : null);
  const rowByAgent = new Map(rows.map((row) => [row.agent_id, row]));
  const agents = input.agent_id
    ? [input.agent_id]
    : [...roster, ...rows.map((row) => row.agent_id).filter((id) => !roster.includes(id)).sort()];
  const names = await store.findReviewedRepNames(agents, now);
  const coverage = callsCoverageForDay(input.calls_known_complete_through, requiredCoverageThrough(business_day, today, now));
  const fallback = fallbackCountScope(rows);
  const reps = agents.map((agent_id) => {
    const row = rowByAgent.get(agent_id) ?? null;
    return composeRepDay({
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
  });
  const projection_revision = rows.reduce<number | null>((max, row) => Math.max(max ?? 0, row.publication_revision), null);
  return { reps, scope: dayCountScope(rows), projection_revision };
}

function commonRead(
  actor: OutreachActor,
  now: Date,
  scopedAgent: string | null,
  configuration: ActiveConfiguration,
  projection_revision: number | null,
  freshness: SalesOutreachFreshness,
) {
  return {
    ...baseRead(actor, now, scopedAgent),
    configuration_state: "active" as const,
    configuration_version: configuration.version,
    configuration_revision: configuration.revision,
    projection_revision,
    freshness,
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
    configuration,
    business_day,
    today,
    now: deps.now,
    agent_id,
    calls_known_complete_through: calls?.known_complete_through ?? null,
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
  const days = goalMetrics
    ? await composeRepDays({
        store,
        configuration,
        business_day,
        today,
        now: deps.now,
        agent_id: null,
        calls_known_complete_through: calls?.known_complete_through ?? null,
      })
    : null;
  return {
    ...commonRead(actor, deps.now, null, configuration, days?.projection_revision ?? null, freshness),
    business_day,
    is_today: business_day === today,
    goal_metrics_enabled: goalMetrics,
    goals: days ? composeTeamGoals(days.reps, days.scope) : null,
    goals_unknown_reason: days ? null : "goal_metrics_disabled",
    daily_call_goals: days ? days.reps.map((rep) => ({ ...rep, overdue_leads: NOT_AVAILABLE_IN_M1 })) : null,
    distinct_overdue_leads: NOT_AVAILABLE_IN_M1,
    quoted_overdue_leads: NOT_AVAILABLE_IN_M1,
    unassigned: NOT_AVAILABLE_IN_M1,
    leads_needing_attention: NOT_AVAILABLE_IN_M1,
    readiness:
      actor.role === "owner"
        ? { configuration_state: "active", activation_blockers: configurationActivationBlockers(configuration.value) }
        : null,
  };
}
