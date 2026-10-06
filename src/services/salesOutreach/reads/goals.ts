import { z } from "zod";
import type { SalesOutreachGoalCountScope } from "../../../config/domain/salesOutreach";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";
import {
  SALES_OUTREACH_COUNT_SCOPE_LABELS,
  SALES_OUTREACH_GOAL_STATE_LABELS,
  SALES_OUTREACH_OTHER_OUTBOUND_LABEL,
  type SalesOutreachRepDayDto,
  type SalesOutreachTeamDto,
} from "../../../validation/v1/salesOutreachReads";
import { OutreachError } from "../errors";
import { isoWeekdayOf } from "./businessDay";
import { mergeRowCoverage, type SalesOutreachCoverage } from "./freshness";

/**
 * Daily outbound-goal arithmetic for the desk reads (SPECIFICATION §13.4, P08a, FAST-TRACK M1).
 * Pure: no Mongo, no clock. Inputs are the active configuration's `goals`, the rep-day projection
 * rows (written by the rep-day projection from verified call evidence; this module only reads
 * them) and capture coverage.
 *
 * - goal: an effective-dated override for the date wins; else the rep's scheduled goal (or the
 *   default scheduled goal) on a scheduled working day; else 0 ("No goal today"). An Agent that
 *   is not on the roster has no goal ("Not on roster").
 * - remaining = max(0, goal − actual); progress = min(1, actual / goal); actual above goal stays
 *   visible (108/100 → progress 1, remaining 0).
 * - A missing projection row is a confirmed zero only when capture coverage for the day is
 *   complete; otherwise the count is pending (null), never a guessed 0.
 * - Team goal = sum of applicable individual goals (never 100 × staff); zero-goal reps keep their
 *   actuals in the team total but are excluded from the reps-at-goal denominator.
 */

export type GoalsConfiguration = SalesOutreachConfigurationValue["goals"];
type GoalProvenance = SalesOutreachRepDayDto["goal_provenance"];

export type ResolvedGoal = Readonly<{
  goal_state: SalesOutreachRepDayDto["goal_state"];
  goal: number | null;
  provenance: GoalProvenance;
}>;

/** A `sales_outreach_rep_day_projections` row as the read uses it (agent id as a hex string). */
export type RepDayRow = Readonly<{
  agent_id: string;
  business_day: string;
  count_scope: SalesOutreachGoalCountScope;
  goal_snapshot: {
    roster_version: string | null;
    configuration_version: string | null;
    goal: number | null;
    scheduled: boolean;
    override: unknown;
  } | null;
  actual_confirmed: number;
  actual_awaiting_confirmation: number;
  unattributed: number;
  /**
   * olr C1b: the day under each scope. Absent or null on a row written before both counts were stored —
   * never read as 0.
   */
  actual_confirmed_all?: number | null;
  actual_confirmed_eligible?: number | null;
  actual_awaiting_all?: number | null;
  actual_awaiting_eligible?: number | null;
  coverage: unknown;
  computed_as_of: Date | null;
  publication_revision: number;
}>;

const stateOf = (goal: number | null): ResolvedGoal["goal_state"] =>
  goal === null ? "not_on_roster" : goal === 0 ? "no_goal_today" : "goal";

/** The rep's goal for `businessDay` from the active configuration's roster, schedules and overrides. */
export function resolveConfiguredGoal(
  goals: GoalsConfiguration,
  configurationVersion: string,
  agentId: string,
  businessDay: string,
): ResolvedGoal {
  const base = { source: "configuration" as const, configuration_version: configurationVersion, roster_version: goals.roster_version };
  const schedule = (goals.rep_work_schedules ?? []).find((row) => row.agent_id === agentId);
  if (!schedule) {
    return {
      goal_state: "not_on_roster",
      goal: null,
      provenance: { ...base, basis: "not_on_roster", scheduled_working_day: null, override: null },
    };
  }
  const workingDay = schedule.working_days.includes(isoWeekdayOf(businessDay));
  const override = (goals.effective_day_overrides ?? []).find((row) => row.agent_id === agentId && row.business_date === businessDay);
  if (override) {
    return {
      goal_state: stateOf(override.goal),
      goal: override.goal,
      provenance: {
        ...base,
        basis: "override",
        scheduled_working_day: workingDay,
        override: { business_date: override.business_date, goal: override.goal, reason: override.reason },
      },
    };
  }
  if (!workingDay) {
    return { goal_state: "no_goal_today", goal: 0, provenance: { ...base, basis: "not_scheduled", scheduled_working_day: false, override: null } };
  }
  const goal = schedule.scheduled_goal ?? goals.default_scheduled_goal;
  // The strict schema requires a default goal whenever goal metrics are enabled; fail closed otherwise.
  if (goal === null) throw new OutreachError("CONFIGURATION_UNAVAILABLE", [{ path: "goals.default_scheduled_goal", code: "missing" }]);
  return {
    goal_state: stateOf(goal),
    goal,
    provenance: {
      ...base,
      basis: schedule.scheduled_goal === null ? "default_goal" : "work_schedule",
      scheduled_working_day: true,
      override: null,
    },
  };
}

const snapshotOverrideSchema = z.object({
  business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goal: z.number().int().min(0),
  reason: z.enum(["absence", "partial_day"]),
});

/**
 * The goal frozen on a rep-day row (SPECIFICATION §13.4: snapshot each day's denominator so later
 * edits do not rewrite history). Null when the row carries no snapshot (no configuration version).
 */
export function resolveSnapshotGoal(row: RepDayRow): ResolvedGoal | null {
  const snapshot = row.goal_snapshot;
  if (!snapshot?.configuration_version) return null;
  const parsedOverride = snapshotOverrideSchema.safeParse(snapshot.override);
  const override = parsedOverride.success ? parsedOverride.data : null;
  const goal = override ? override.goal : snapshot.goal;
  const basis: GoalProvenance["basis"] = override
    ? "override"
    : goal === null
      ? "not_on_roster"
      : snapshot.scheduled
        ? "work_schedule"
        : "not_scheduled";
  return {
    goal_state: stateOf(goal),
    goal,
    provenance: {
      source: "projection_snapshot",
      basis,
      configuration_version: snapshot.configuration_version,
      roster_version: snapshot.roster_version,
      scheduled_working_day: goal === null ? null : snapshot.scheduled,
      override,
    },
  };
}

/**
 * Past days prefer the row's frozen snapshot; today (and past days without a snapshot) resolve
 * from the active configuration, so a prospective override recorded today shows immediately.
 */
export function resolveRepDayGoal(input: {
  goals: GoalsConfiguration;
  configuration_version: string;
  agent_id: string;
  business_day: string;
  today: string;
  row: RepDayRow | null;
}): ResolvedGoal {
  if (input.row && input.business_day < input.today) {
    const snapshot = resolveSnapshotGoal(input.row);
    if (snapshot) return snapshot;
  }
  return resolveConfiguredGoal(input.goals, input.configuration_version, input.agent_id, input.business_day);
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** min(1, actual / goal) rounded to 4 places; null without a positive goal or a known actual. */
export function cappedProgress(actual: number | null, goal: number | null): number | null {
  if (actual === null || goal === null || goal <= 0) return null;
  return round4(Math.min(1, actual / goal));
}

/** The uniform count scope of a day's rows: the shared scope, `mixed`, or null when there are no rows. */
export function dayCountScope(rows: readonly RepDayRow[]): SalesOutreachGoalCountScope | "mixed" | null {
  const scopes = new Set(rows.map((row) => row.count_scope));
  if (scopes.size === 0) return null;
  return scopes.size === 1 ? rows[0]!.count_scope : "mixed";
}

/**
 * The count scope of a New York business day from the configuration (olr C1a, Owner decision D1):
 * the last `goals.count_scope_schedule` entry with `from_day <= day`, else `all_outbound`. Absent or
 * empty schedule = `all_outbound` for every day. The PATCH guard keeps entries on or before today
 * immutable, so a day's scope never changes once the day has started.
 */
export function countScopeForDay(day: string, schedule: GoalsConfiguration["count_scope_schedule"] | null | undefined): SalesOutreachGoalCountScope {
  let scope: SalesOutreachGoalCountScope = "all_outbound";
  for (const entry of schedule ?? []) {
    if (entry.from_day > day) break;
    scope = entry.scope;
  }
  return scope;
}

/** The scope a rep without a row is presented in: the configured scope of the day (rows are not consulted). */
export function fallbackCountScope(goals: Pick<GoalsConfiguration, "count_scope_schedule"> | null | undefined, businessDay: string): SalesOutreachGoalCountScope {
  return countScopeForDay(businessDay, goals?.count_scope_schedule);
}

/** The other of the two count scopes (olr C1b: the secondary figure's scope). */
export function alternateCountScope(scope: SalesOutreachGoalCountScope): SalesOutreachGoalCountScope {
  return scope === "all_outbound" ? "eligible_new_quoted" : "all_outbound";
}

/**
 * The rep-day's count under the other scope (olr C1b), with the headline's honesty rule: a positive
 * count is a confirmed lower bound, a 0 only once coverage is complete. A rep without a row reads 0
 * once coverage is complete (pending before). A row written before both counts were stored is null.
 */
function alternateScopeOf(row: RepDayRow | null, scope: SalesOutreachGoalCountScope, complete: boolean): SalesOutreachRepDayDto["alternate_scope"] {
  const count_scope = alternateCountScope(scope);
  const label = SALES_OUTREACH_COUNT_SCOPE_LABELS[count_scope];
  if (!row) {
    return { count_scope, count_scope_label: label, actual_confirmed: complete ? 0 : null, actual_awaiting_confirmation: complete ? 0 : null };
  }
  const all = count_scope === "all_outbound";
  const confirmed = (all ? row.actual_confirmed_all : row.actual_confirmed_eligible) ?? null;
  const awaiting = (all ? row.actual_awaiting_all : row.actual_awaiting_eligible) ?? null;
  if (confirmed === null || awaiting === null) return null;
  return {
    count_scope,
    count_scope_label: label,
    actual_confirmed: confirmed > 0 || complete ? confirmed : null,
    actual_awaiting_confirmation: awaiting,
  };
}

/** A rep-day row's goal parts; the cadence counts are composed separately (`teamCadence.ts` `composeRepCadence`). */
export type RepDayGoalDto = Omit<SalesOutreachRepDayDto, "overdue_leads" | "calls_due_today" | "sms_due_today">;

export function composeRepDay(input: {
  agent_id: string;
  agent_name: string | null;
  reviewed_link: boolean;
  goal: ResolvedGoal;
  row: RepDayRow | null;
  fallback_scope: SalesOutreachGoalCountScope;
  capture_coverage: SalesOutreachCoverage;
}): RepDayGoalDto {
  const { row, goal } = input;
  const coverage = row ? mergeRowCoverage(row.coverage, input.capture_coverage) : input.capture_coverage;
  const complete = coverage.state === "complete";
  let actual: number | null;
  let awaiting: number | null;
  let other: number | null;
  let basis: SalesOutreachRepDayDto["actual_basis"];
  if (row) {
    // A positive count is a confirmed lower bound; a zero is only a zero once coverage is complete.
    actual = row.actual_confirmed > 0 || complete ? row.actual_confirmed : null;
    awaiting = row.actual_awaiting_confirmation;
    other = row.unattributed > 0 || complete ? row.unattributed : null;
    basis = actual === null ? "pending" : "projection";
  } else {
    actual = complete ? 0 : null;
    awaiting = complete ? 0 : null;
    other = complete ? 0 : null;
    basis = complete ? "no_activity_recorded" : "pending";
  }
  const scope = row?.count_scope ?? input.fallback_scope;
  let remaining: number | null = null;
  let reached: boolean | null = null;
  if (goal.goal !== null && actual !== null) {
    remaining = Math.max(0, goal.goal - actual);
    reached = goal.goal > 0 ? actual >= goal.goal : false;
  }
  return {
    agent_id: input.agent_id,
    agent_name: input.agent_name,
    reviewed_link: input.reviewed_link,
    goal_state: goal.goal_state,
    goal_label: SALES_OUTREACH_GOAL_STATE_LABELS[goal.goal_state],
    goal: goal.goal,
    goal_provenance: goal.provenance,
    count_scope: scope,
    count_scope_label: SALES_OUTREACH_COUNT_SCOPE_LABELS[scope],
    actual_confirmed: actual,
    actual_awaiting_confirmation: awaiting,
    actual_basis: basis,
    remaining,
    progress: cappedProgress(actual, goal.goal),
    goal_reached: reached,
    other_outbound: { count: other, label: SALES_OUTREACH_OTHER_OUTBOUND_LABEL },
    alternate_scope: alternateScopeOf(row, scope, complete),
    coverage,
    unknown_reason: complete ? null : "coverage_incomplete",
    projection_revision: row?.publication_revision ?? null,
    computed_as_of: row?.computed_as_of?.toISOString() ?? null,
  };
}

/** The team goal cards (Team outreach cards 1–2) from the composed per-rep rows. */
export function composeTeamGoals(
  reps: readonly RepDayGoalDto[],
  scope: SalesOutreachGoalCountScope | "mixed" | null,
): NonNullable<SalesOutreachTeamDto["goals"]> {
  const roster = reps.filter((rep) => rep.goal_state !== "not_on_roster");
  const goal = roster.reduce((sum, rep) => sum + (rep.goal ?? 0), 0);
  const pending = roster.filter((rep) => rep.actual_confirmed === null);
  const known = roster.reduce((sum, rep) => sum + (rep.actual_confirmed ?? 0), 0);
  let actual: number | null = known;
  let unknownReason: string | null = pending.length ? "coverage_incomplete" : null;
  if (scope === "mixed") {
    actual = null;
    unknownReason = "mixed_count_scope";
  } else if (roster.length > 0 && pending.length === roster.length) {
    actual = null;
  }
  const goalReps = roster.filter((rep) => rep.goal_state === "goal");
  const effectiveScope = scope ?? (roster[0]?.count_scope ?? null);
  // olr C1b: the team's secondary figure sums the roster reps' alternate counts; one unknown (pending,
  // a pre-C1b row, or a rep presented under another scope) makes the sum unknown, never a partial sum.
  let alternate: NonNullable<SalesOutreachTeamDto["goals"]>["outbound_calls"]["alternate"] = null;
  if (effectiveScope && effectiveScope !== "mixed") {
    const alternateScope = alternateCountScope(effectiveScope);
    const known = roster.every(
      (rep) => rep.alternate_scope?.count_scope === alternateScope && rep.alternate_scope.actual_confirmed !== null,
    );
    alternate = {
      count_scope: alternateScope,
      actual: known ? roster.reduce((sum, rep) => sum + (rep.alternate_scope?.actual_confirmed ?? 0), 0) : null,
    };
  }
  return {
    count_scope: effectiveScope,
    count_scope_label: effectiveScope && effectiveScope !== "mixed" ? SALES_OUTREACH_COUNT_SCOPE_LABELS[effectiveScope] : null,
    outbound_calls: {
      actual,
      goal,
      progress: cappedProgress(actual, goal),
      incomplete: pending.length > 0,
      pending_agent_ids: pending.map((rep) => rep.agent_id),
      unknown_reason: unknownReason,
      alternate,
    },
    reps_at_goal: {
      count: goalReps.filter((rep) => rep.goal_reached === true).length,
      of: goalReps.length,
      pending: goalReps.filter((rep) => rep.goal_reached === null).length,
    },
    other_outbound_total: roster.some((rep) => rep.other_outbound.count === null)
      ? null
      : roster.reduce((sum, rep) => sum + (rep.other_outbound.count ?? 0), 0),
    roster_size: roster.length,
  };
}
