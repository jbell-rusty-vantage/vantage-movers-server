import { createHash } from "node:crypto";
import type { SalesOutreachGoalCountScope } from "../../../config/domain/salesOutreach";
import {
  SALES_OUTREACH_OTHER_OUTBOUND_BUCKETS,
  type SalesOutreachAssociationReason,
  type SalesOutreachGoalCredit,
  type SalesOutreachOtherOutboundBreakdown,
  type SalesOutreachOtherOutboundBucket,
} from "../../../config/domain/salesOutreachContacts";
import type { DeskTiming } from "../config/timing";
import { repDayGoal } from "../engine/credit";
import { goalCallCoverage, type CallWatermarks } from "../evidence/coverage";
import { newYorkDayBounds } from "../reads/businessDay";
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
 *   (in M2 they are excluded from the goal until associated);
 * - olr C1b: the confirmed and awaiting counts of both scopes are stored too (`actual_*_all`,
 *   `actual_*_eligible`) and are part of the fingerprint;
 * - olr C8: `other_outbound` breaks `unattributed` down by the events' `association_reason` (a missing
 *   reason — an event derived before the field — counts as `unknown`); it always sums to `unattributed`
 *   and is part of the fingerprint.
 *
 * Goal snapshot (SPECIFICATION §13.4, P08a): from the configured roster/schedule/override via S1's
 * `resolveConfiguredGoal`. Today's row carries no `configuration_version` (the read resolves today from
 * the active configuration so prospective overrides show at once); the first recount after the day
 * ends freezes it (sets `configuration_version`), and a frozen snapshot is never re-frozen: changes are
 * prospective, historical corrections need an explicit audited edit.
 *
 * Coverage (olr C0, decision D-A3): the day is `complete` once goal call coverage
 * (`evidence/coverage.ts` `goalCallCoverage`: the observed Call Log watermark — finalization lag and
 * ISync cap kept, no provisional-row cap — minus the settlement allowance, never past the contact-event
 * derivation) reaches the end of a past day, or `now − today_coverage_tolerance` today (`deskTimingOf`);
 * a day before the derivation's first covered instant is `unknown`. Incomplete coverage never turns a
 * missing count into a confirmed zero.
 */

export type RepDayEventFacts = Readonly<{
  source_id: string;
  goal_credit: SalesOutreachGoalCredit;
  goal_scope_eligible: boolean;
  /** olr C8: the event's stored reason; null/absent for an event derived before the field existed. */
  association_reason?: SalesOutreachAssociationReason | null;
}>;

/** A breakdown with every bucket at 0 (olr C8). */
export function emptyOtherOutboundBreakdown(): SalesOutreachOtherOutboundBreakdown {
  return Object.fromEntries(SALES_OUTREACH_OTHER_OUTBOUND_BUCKETS.map((bucket) => [bucket, 0])) as SalesOutreachOtherOutboundBreakdown;
}

/**
 * The "Other outbound" bucket of a confirmed event without an eligible subject (olr C8). `eligible` on
 * such an event (impossible from `derive.ts`: an eligible outbound is in the goal scope) and a missing
 * reason both read `unknown`, so the breakdown always sums to `unattributed`.
 */
export function otherOutboundBucketOf(reason: SalesOutreachAssociationReason | null | undefined): SalesOutreachOtherOutboundBucket {
  if (!reason || reason === "eligible") return "unknown";
  return reason;
}

/**
 * A rep-day's counts (olr C1b): both scopes are counted in one pass. `actual_confirmed` and
 * `actual_awaiting_confirmation` stay the headline under the row's `count_scope` (what the reads, the
 * team sums and the admin use); `actual_{confirmed,awaiting}_{all,eligible}` keep the day under each
 * scope, so the read serves the other scope as a secondary figure (`alternate_scope`).
 */
export type RepDayCounts = Readonly<{
  actual_confirmed: number;
  actual_awaiting_confirmation: number;
  unattributed: number;
  actual_confirmed_all: number;
  actual_confirmed_eligible: number;
  actual_awaiting_all: number;
  actual_awaiting_eligible: number;
  /** olr C8: `unattributed` by association reason (sums to `unattributed`). */
  other_outbound: SalesOutreachOtherOutboundBreakdown;
}>;

export function countRepDay(events: readonly RepDayEventFacts[], scope: SalesOutreachGoalCountScope): RepDayCounts {
  const seen = new Set<string>();
  let confirmedAll = 0;
  let confirmedEligible = 0;
  let awaitingAll = 0;
  let awaitingEligible = 0;
  const other = emptyOtherOutboundBreakdown();
  for (const event of events) {
    if (seen.has(event.source_id)) continue;
    seen.add(event.source_id);
    if (event.goal_credit === "confirmed") {
      confirmedAll++;
      if (event.goal_scope_eligible) confirmedEligible++;
      else other[otherOutboundBucketOf(event.association_reason)]++;
    } else if (event.goal_credit === "awaiting_confirmation") {
      awaitingAll++;
      if (event.goal_scope_eligible) awaitingEligible++;
    }
  }
  const all = scope === "all_outbound";
  return {
    actual_confirmed: all ? confirmedAll : confirmedEligible,
    actual_awaiting_confirmation: all ? awaitingAll : awaitingEligible,
    // "Other outbound": confirmed attempts without an eligible subject, whatever the scope.
    unattributed: confirmedAll - confirmedEligible,
    actual_confirmed_all: confirmedAll,
    actual_confirmed_eligible: confirmedEligible,
    actual_awaiting_all: awaitingAll,
    actual_awaiting_eligible: awaitingEligible,
    other_outbound: other,
  };
}

/**
 * The count scope of a business day comes from the configuration (olr C1a): `goals.count_scope_schedule`,
 * absent = `all_outbound` (Owner decision D1). It no longer follows the first enrollment apply. The
 * pure resolver lives with the goal arithmetic (`reads/goals.ts`) so the read side and this projection
 * share it without an import cycle.
 */
export { countScopeForDay } from "../reads/goals";

/**
 * A rep-day's calls coverage (olr C0): goal call coverage (`goalCallCoverage`, D-A3) against the day's
 * requirement (`requiredCoverageThrough`, today tolerance from `timing`). A day that starts before the
 * derivation's `coverage_from` is `unknown`; a missing capture or derivation watermark is `unknown`.
 */
export function repDayCoverage(businessDay: string, today: string, now: Date, marks: CallWatermarks, timing: DeskTiming): SalesOutreachCoverage {
  const required = requiredCoverageThrough(businessDay, today, now, timing);
  if (marks.coverage_from && newYorkDayBounds(businessDay).start.getTime() < marks.coverage_from.getTime()) {
    return { state: "unknown", known_complete_through: null, required_through: required.toISOString(), gaps: [{ from: null, to: marks.coverage_from.toISOString() }] };
  }
  return callsCoverageForDay(goalCallCoverage(marks, timing), required);
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
  /** olr C1b: the day under each scope; the headline above is the one of `count_scope`. */
  actual_confirmed_all: number;
  actual_confirmed_eligible: number;
  actual_awaiting_all: number;
  actual_awaiting_eligible: number;
  /** olr C8: "Other outbound" by association reason; sums to `unattributed`. */
  other_outbound: SalesOutreachOtherOutboundBreakdown;
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
  watermarks: CallWatermarks;
  /** Effective desk timing of the configuration the recount runs under (`deskTimingOf`). */
  timing: DeskTiming;
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
  const coverage = repDayCoverage(input.business_day, input.today, input.now, input.watermarks, input.timing);
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
