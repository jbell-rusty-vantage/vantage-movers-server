import mongoose from "mongoose";
import { logger } from "../../../logger";
import type { SalesOutreachRepDaysDto } from "../../../validation/v1/salesOutreachReads";
import { recordDailyOperationsFact, type RecordDailyOperationsFactInput } from "../../dailyOperations/recordDailyOperationsFact";
import type { OutreachActor } from "../auth";
import { salesOutreachConfigurationLoader } from "../config/load";
import { newYorkBusinessDay } from "../reads/businessDay";
import { composeTeamGoals } from "../reads/goals";
import { readRepDays } from "../reads/service";
import type { OutreachGoalChange } from "./goalPublish";

/**
 * Goal milestones on Daily Operations (dashboard redesign doc 16): `outreach.rep_goal_met` when a rep-day write
 * crosses its goal today, `outreach.team_goal_met` when today's team outbound count reaches the team goal. Both are
 * Daily Operations facts, so the admin feed pins them and the milestone toast shows them over the existing stream.
 *
 * Once per day by construction: the fact's `dedupe_key` (`…:<agent>:<day>`, `…:team:<day>`) is unique, so a repeat
 * crossing (a recount, a second instance, a retry) records nothing. A team fact already recorded is remembered in
 * this process so later calls skip the read. Runs after the rep-day commit and never throws.
 */

export type GoalMilestoneDeps = Readonly<{
  now?: () => Date;
  readDays?: (now: Date) => Promise<SalesOutreachRepDaysDto>;
  record?: (input: RecordDailyOperationsFactInput) => Promise<unknown>;
  connected?: () => boolean;
}>;

const teamRecorded = new Set<string>();

/** Test seam: forget the per-process team memo. */
export function resetGoalMilestoneMemo(): void {
  teamRecorded.clear();
}

const SYSTEM_ACTOR: OutreachActor = {
  role: "manager",
  actor: { kind: "worker", id: "sales-outreach-goal-milestones", request_id: "goal-milestones", run_id: null },
  agent_id: null,
};

const defaultReadDays = (now: Date) => readRepDays(SYSTEM_ACTOR, {}, { loader: salesOutreachConfigurationLoader, now });

export function repMilestoneDedupeKey(agentId: string, day: string): string {
  return `outreach.rep_goal_met:${agentId}:${day}`;
}

export function teamMilestoneDedupeKey(day: string): string {
  return `outreach.team_goal_met:team:${day}`;
}

/** The facts to record for one batch of committed rep-day changes, given today's rep-days read. */
export function goalMilestoneFacts(input: {
  changes: readonly OutreachGoalChange[];
  days: SalesOutreachRepDaysDto;
  now: Date;
  teamAlreadyRecorded: boolean;
}): RecordDailyOperationsFactInput[] {
  const reps = input.days.reps;
  if (!reps || !input.days.is_today) return [];
  const day = input.days.business_day;
  const team = composeTeamGoals(reps, input.days.count_scope ?? null);
  const teamFacts = {
    team_actual: team.outbound_calls.actual,
    team_goal: team.outbound_calls.goal,
    reps_at_goal: team.reps_at_goal.count,
    reps_on_roster: team.reps_at_goal.of,
  };
  const at = input.now;
  const facts: RecordDailyOperationsFactInput[] = [];
  const crossed = new Set(input.changes.filter((change) => change.goal_crossed && change.business_day === day).map((change) => change.agent_id));
  for (const rep of reps) {
    if (!crossed.has(rep.agent_id) || rep.goal_reached !== true) continue;
    facts.push({
      kind: "outreach.rep_goal_met",
      occurred_at: at,
      dedupe_key: repMilestoneDedupeKey(rep.agent_id, day),
      entity_type: "agent",
      entity_id: rep.agent_id,
      metric_touches: [],
      card: {
        agent_id: rep.agent_id,
        agent_name: rep.agent_name,
        actual: rep.actual_confirmed,
        goal: rep.goal,
        rank: team.reps_at_goal.count,
        reached_at: at.toISOString(),
        ...teamFacts,
      },
    });
  }
  const teamActual = team.outbound_calls.actual;
  if (!input.teamAlreadyRecorded && team.outbound_calls.goal > 0 && teamActual !== null && teamActual >= team.outbound_calls.goal) {
    facts.push({
      kind: "outreach.team_goal_met",
      occurred_at: at,
      dedupe_key: teamMilestoneDedupeKey(day),
      metric_touches: [],
      card: { reached_at: at.toISOString(), ...teamFacts },
    });
  }
  return facts;
}

export async function recordGoalMilestones(changes: readonly OutreachGoalChange[], deps: GoalMilestoneDeps = {}): Promise<void> {
  try {
    const now = (deps.now ?? (() => new Date()))();
    const today = newYorkBusinessDay(now);
    const todays = changes.filter((change) => change.business_day === today);
    if (!todays.length) return;
    const teamAlreadyRecorded = teamRecorded.has(today);
    if (teamAlreadyRecorded && !todays.some((change) => change.goal_crossed)) return;
    if (!(deps.connected ?? (() => mongoose.connection.readyState === 1))()) return;
    const days = await (deps.readDays ?? defaultReadDays)(now);
    const facts = goalMilestoneFacts({ changes: todays, days, now, teamAlreadyRecorded });
    const record = deps.record ?? recordDailyOperationsFact;
    for (const fact of facts) {
      await record(fact);
      if (fact.kind === "outreach.team_goal_met") teamRecorded.add(today);
    }
  } catch (error) {
    logger.warn({ msg: "sales_outreach.goal_milestones.failed", errorName: error instanceof Error ? error.name : "Error" });
  }
}
