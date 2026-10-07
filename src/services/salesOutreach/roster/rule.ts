import { createHash } from "node:crypto";
import { SALES_OUTREACH_ALL_WEEKDAYS, type SalesOutreachRosterRule } from "../../../config/domain/salesOutreach";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";
import { newYorkDayBounds } from "../reads/businessDay";

/**
 * The effective daily-goal roster (SPECIFICATION §13.4 P08a, amended P08a-1 on 2026-10-07: "only
 * active Agents with a RingCentral Account connection are shown on the Team desk and are eligible to
 * complete goals; enrollment is automatic"). Pure: no Mongo, no clock.
 *
 * - `explicit` (code default when `goals.roster_rule` is absent): the roster is the configured
 *   `goals.rep_work_schedules` list, versioned by `goals.roster_version` (the original encoding).
 * - `desk_reps`: the roster is the **desk reps** the caller resolved (`roster/store.ts`
 *   `findDeskRepsAt`: `Agent.active` and a reviewed `sales_rep` identity link effective at the roster
 *   instant), each joined to its `rep_work_schedules` entry when one exists, else every weekday and the
 *   default goal (the same defaults the installer gives a new rep). The version is a deterministic
 *   digest of the member set, so a frozen rep-day snapshot says which roster it was frozen under.
 *
 * Roster instant: today reads the roster at `now`; a past day at the end of that New York day (the
 * identity links are temporal; `Agent.active` carries no history, so a past day reads the Agent's
 * current flag — a documented limit that only matters for a past day without a frozen row).
 */

export type GoalsConfiguration = SalesOutreachConfigurationValue["goals"];

export type RosterMember = Readonly<{
  agent_id: string;
  working_days: readonly number[];
  /** The rep's own goal; null = `default_scheduled_goal`. */
  scheduled_goal: number | null;
  /** `configured`: a `rep_work_schedules` entry; `default`: a desk rep without one. */
  schedule_source: "configured" | "default";
}>;

export type EffectiveRoster = Readonly<{
  rule: SalesOutreachRosterRule;
  roster_version: string | null;
  members: readonly RosterMember[];
}>;

/** The configured rule; absent = `explicit` (R0 code default). */
export function rosterRuleOf(goals: Pick<GoalsConfiguration, "roster_rule"> | null | undefined): SalesOutreachRosterRule {
  return goals?.roster_rule ?? "explicit";
}

/** A deterministic roster version for a derived member set (sorted, de-duplicated ids). */
export function deskRosterVersion(agentIds: readonly string[]): string {
  const ids = [...new Set(agentIds.map((id) => id.toLowerCase()))].sort();
  return `roster-desk-${createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 12)}`;
}

/**
 * The instant the roster of `businessDay` is read at: `now` for today (and any later day), the end of
 * the New York day for a past day — never later than `now`.
 */
export function rosterInstant(businessDay: string, today: string, now: Date): Date {
  if (businessDay >= today) return now;
  const end = newYorkDayBounds(businessDay).end;
  return end.getTime() < now.getTime() ? end : now;
}

/**
 * The effective roster of a configuration. `deskRepIds` is the resolved desk-rep set for the roster
 * instant; it is only read under `desk_reps` (null there = no desk rep resolved: an empty roster, never
 * a fallback to the explicit list, so a missing lookup can never re-admit a retired rep).
 */
export function effectiveRoster(goals: GoalsConfiguration, deskRepIds: readonly string[] | null): EffectiveRoster {
  const rule = rosterRuleOf(goals);
  const schedules = goals.rep_work_schedules ?? [];
  if (rule === "explicit") {
    return {
      rule,
      roster_version: goals.roster_version ?? null,
      members: schedules.map((row) => ({ agent_id: row.agent_id, working_days: row.working_days, scheduled_goal: row.scheduled_goal, schedule_source: "configured" })),
    };
  }
  const ids = [...new Set((deskRepIds ?? []).map((id) => id.toLowerCase()))].sort();
  const byAgent = new Map(schedules.map((row) => [row.agent_id, row]));
  return {
    rule,
    roster_version: deskRosterVersion(ids),
    members: ids.map((agent_id) => {
      const row = byAgent.get(agent_id);
      return row
        ? { agent_id, working_days: row.working_days, scheduled_goal: row.scheduled_goal, schedule_source: "configured" }
        : { agent_id, working_days: SALES_OUTREACH_ALL_WEEKDAYS, scheduled_goal: null, schedule_source: "default" };
    }),
  };
}

/** Whether `agentId` is on the effective roster. */
export function onRoster(roster: EffectiveRoster, agentId: string): boolean {
  return roster.members.some((member) => member.agent_id === agentId);
}
