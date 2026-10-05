import { createHash } from "node:crypto";
import type { SalesOutreachGoalCountScope } from "../../../config/domain/salesOutreach";
import type { SalesOutreachGoalCredit } from "../../../config/domain/salesOutreachContacts";
import { repDayGoal } from "../engine/credit";
import { newYorkBusinessDay, newYorkDayBounds } from "../reads/businessDay";
import { callsCoverageForDay, requiredCoverageThrough, type SalesOutreachCoverage } from "../reads/freshness";
import { resolveConfiguredGoal, type GoalsConfiguration } from "../reads/goals";

/**
 * Rep-day recount (IMPLEMENTATION-PLAN §4.6 / §6.2 `outreach_rep_day`, P07a/P07b/P07g, P08a, FAST-TRACK
 * "M1 goal scope"). Pure: inputs are the rep's contact events for one New York date, the day's count
 * scope, the active configuration's goals and the coverage watermarks; the output is the
 * `sales_outreach_rep_day_projections` row S1's reads expect, plus its fingerprint.
 *
 * Counting (one credit per canonical call — events are one row per source):
 * - `all_outbound` (M1): every `goal_credit: confirmed` event (a reviewed initiator's terminal outbound
 *   attempt present in the Call Log, not restricted), whether or not a subject is associated;
 * - `eligible_new_quoted` (M2): only those whose subject was an eligible New/Quoted subject at contact
 *   time (`goal_scope_eligible`, P07a);
 * - `actual_awaiting_confirmation`: the same scope's webhook-only attempts (never credit, never a miss);
 * - `unattributed` ("Other outbound"): confirmed attempts without an eligible subject, in both scopes
 *   (in M2 they are excluded from the goal until associated).
 *
 * Goal snapshot (SPECIFICATION §13.4, P08a): from the configured roster/schedule/override via S1's
 * `resolveConfiguredGoal`. Today's row carries no `configuration_version` (the read resolves today from
 * the active configuration so prospective overrides show at once); the first recount after the day
 * ends freezes it (sets `configuration_version`), and a frozen snapshot is never re-frozen: changes are
 * prospective, historical corrections need an explicit audited edit.
 *
 * Coverage: the day is `complete` only when both the capture watermark (Call Log
 * `known_complete_through` minus the 2-minute settlement allowance, RINGCENTRAL-CAPTURE §8) and the
 * contact-event derivation watermark cover it; a day before the derivation's first covered instant is
 * `unknown`. Incomplete coverage never turns a missing count into a confirmed zero.
 */

/** RINGCENTRAL-CAPTURE §8: a Call Log record may still settle within 2 minutes of the watermark. */
export const CALL_SETTLEMENT_ALLOWANCE_MS = 2 * 60_000;

export type RepDayEventFacts = Readonly<{
  source_id: string;
  goal_credit: SalesOutreachGoalCredit;
  goal_scope_eligible: boolean;
}>;

export type RepDayCounts = Readonly<{ actual_confirmed: number; actual_awaiting_confirmation: number; unattributed: number }>;

export function countRepDay(events: readonly RepDayEventFacts[], scope: SalesOutreachGoalCountScope): RepDayCounts {
  const seen = new Set<string>();
  let confirmed = 0;
  let awaiting = 0;
  let unattributed = 0;
  for (const event of events) {
    if (seen.has(event.source_id)) continue;
    seen.add(event.source_id);
    const inScope = scope === "all_outbound" || event.goal_scope_eligible;
    if (event.goal_credit === "confirmed") {
      if (inScope) confirmed++;
      if (!event.goal_scope_eligible) unattributed++;
    } else if (event.goal_credit === "awaiting_confirmation" && inScope) {
      awaiting++;
    }
  }
  return { actual_confirmed: confirmed, actual_awaiting_confirmation: awaiting, unattributed };
}

/**
 * The count scope of a business day (decision, not env): `eligible_new_quoted` from the New York date
 * after the first completed enrollment apply's activation boundary (M2 has landed and every earlier
 * call of that date may predate its subjects); every earlier date — and every date while nothing has
 * been enrolled — stays `all_outbound` (M1), so one scope is never presented as the other.
 */
export function countScopeFor(businessDay: string, firstActivationAt: Date | null): SalesOutreachGoalCountScope {
  if (!firstActivationAt) return "all_outbound";
  return newYorkBusinessDay(firstActivationAt) < businessDay ? "eligible_new_quoted" : "all_outbound";
}

export type CoverageWatermarks = Readonly<{
  /** Call Log capture `known_complete_through` (`call_log_all_directions`). */
  capture_known_complete_through: Date | null;
  /** Contact-event derivation watermark (`outreach_contact_calls.known_complete_through`). */
  derived_through: Date | null;
  /** First instant the derived evidence covers (the sweep's bootstrap start). */
  coverage_from: Date | null;
}>;

export function repDayCoverage(businessDay: string, today: string, now: Date, marks: CoverageWatermarks): SalesOutreachCoverage {
  const required = requiredCoverageThrough(businessDay, today, now);
  if (marks.coverage_from && newYorkDayBounds(businessDay).start.getTime() < marks.coverage_from.getTime()) {
    return { state: "unknown", known_complete_through: null, required_through: required.toISOString(), gaps: [{ from: null, to: marks.coverage_from.toISOString() }] };
  }
  const capture = marks.capture_known_complete_through ? new Date(marks.capture_known_complete_through.getTime() - CALL_SETTLEMENT_ALLOWANCE_MS) : null;
  const effective = capture && marks.derived_through ? new Date(Math.min(capture.getTime(), marks.derived_through.getTime())) : null;
  return callsCoverageForDay(effective, required);
}

export type GoalSnapshot = {
  roster_version: string | null;
  configuration_version: string | null;
  goal: number | null;
  scheduled: boolean;
  override: { agent_id: string; business_date: string; goal: number; reason: string } | null;
};

/** The goal for the row: a frozen snapshot stays; otherwise resolve from the active configuration. */
export function goalSnapshotFor(input: {
  agent_id: string;
  business_day: string;
  today: string;
  goals: GoalsConfiguration | null;
  configuration_version: string;
  existing: GoalSnapshot | null;
}): GoalSnapshot {
  if (input.existing?.configuration_version) return input.existing;
  const freeze = input.business_day < input.today;
  if (!input.goals) return { roster_version: null, configuration_version: null, goal: null, scheduled: false, override: null };
  try {
    const resolved = resolveConfiguredGoal(input.goals, input.configuration_version, input.agent_id, input.business_day);
    const override = resolved.provenance.override
      ? { agent_id: input.agent_id, ...resolved.provenance.override }
      : null;
    return {
      roster_version: input.goals.roster_version ?? null,
      configuration_version: freeze ? input.configuration_version : null,
      goal: resolved.goal,
      scheduled: resolved.provenance.scheduled_working_day === true,
      override,
    };
  } catch {
    // Goals not resolvable (e.g. no default goal installed): leave the goal to the read, which fails closed.
    return { roster_version: input.goals.roster_version ?? null, configuration_version: null, goal: null, scheduled: false, override: null };
  }
}

export type RepDayRowFields = {
  agent_id: string;
  business_day: string;
  count_scope: SalesOutreachGoalCountScope;
  goal_snapshot: GoalSnapshot;
  actual_confirmed: number;
  actual_awaiting_confirmation: number;
  unattributed: number;
  remaining: number | null;
  progress: number | null;
  goal_state: "goal" | "no_goal_today" | "not_on_roster";
  coverage: SalesOutreachCoverage;
  input_fingerprint: string;
};

export function composeRepDayRow(input: {
  agent_id: string;
  business_day: string;
  today: string;
  now: Date;
  events: readonly RepDayEventFacts[];
  scope: SalesOutreachGoalCountScope;
  goals: GoalsConfiguration | null;
  configuration_version: string;
  existing_snapshot: GoalSnapshot | null;
  watermarks: CoverageWatermarks;
}): RepDayRowFields {
  const counts = countRepDay(input.events, input.scope);
  const goal_snapshot = goalSnapshotFor({
    agent_id: input.agent_id,
    business_day: input.business_day,
    today: input.today,
    goals: input.goals,
    configuration_version: input.configuration_version,
    existing: input.existing_snapshot,
  });
  const coverage = repDayCoverage(input.business_day, input.today, input.now, input.watermarks);
  let remaining: number | null = null;
  let progress: number | null = null;
  let goal_state: RepDayRowFields["goal_state"] = "not_on_roster";
  if (goal_snapshot.goal !== null) {
    const day = repDayGoal(counts.actual_confirmed, goal_snapshot.goal);
    goal_state = day.goal_state;
    remaining = day.goal_state === "goal" ? day.remaining : 0;
    progress = day.goal_state === "goal" ? Math.round(day.progress * 10_000) / 10_000 : null;
  }
  // The fingerprint keeps the coverage state but not the moving watermark instant, so a day whose
  // counts and state are unchanged is not rewritten every minute.
  const semantic = { scope: input.scope, counts, goal_snapshot, coverage_state: coverage.state, remaining, progress, goal_state };
  const input_fingerprint = createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
  return {
    agent_id: input.agent_id,
    business_day: input.business_day,
    count_scope: input.scope,
    goal_snapshot,
    ...counts,
    remaining,
    progress,
    goal_state,
    coverage,
    input_fingerprint,
  };
}
