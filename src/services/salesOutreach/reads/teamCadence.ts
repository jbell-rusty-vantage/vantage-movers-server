import type { SalesOutreachCadenceExposure } from "../../../config/domain/salesOutreach";
import type { SalesOutreachQueueRowDto, SALES_OUTREACH_CADENCE_UNKNOWN_REASONS } from "../../../validation/v1/salesOutreachReads";
import type { ActiveConfiguration } from "../config/load";
import { newYorkBusinessDay } from "./businessDay";
import type { DeskQueueStore } from "./deskStore";
import { presentQueueRow } from "./present";
import { deskCadenceOf } from "./queue";
import { queueSortSpec, type QueueMatch } from "./queueQuery";
import type { SalesOutreachReadStore } from "./store";

/**
 * The team desk's cadence parts (SPECIFICATION §6.2; CONTRACTS "GET /team"): cards 3–4 (distinct overdue
 * Leads, Quoted Leads with an overdue Call requirement), the Unassigned count and its overdue part, the
 * per-rep overdue column and the first "Leads needing attention" rows.
 *
 * Overdue is read-time: a Lead is overdue when its earliest unsatisfied actionable deadline (blocked
 * channels excluded) is at or before `now`. Overdue figures exist only under enforcement; in shadow they
 * are null (`cadence_shadow`) because no overdue label may be shown. The Unassigned count is a count of
 * subjects, not a label, so it is served whenever the desk is on. Goals never hide overdue work.
 */

type UnknownReason = (typeof SALES_OUTREACH_CADENCE_UNKNOWN_REASONS)[number];
type Metric = { value: number | null; unknown_reason: UnknownReason | null };

export const TEAM_ATTENTION_LIMIT = 10;

const known = (value: number): Metric => ({ value, unknown_reason: null });
const unknown = (reason: UnknownReason): Metric => ({ value: null, unknown_reason: reason });

export type TeamCadence = Readonly<{
  exposure: SalesOutreachCadenceExposure | null;
  distinct_overdue_leads: Metric;
  quoted_overdue_leads: Metric;
  unassigned: { count: number | null; overdue: Metric };
  leads_needing_attention: { rows: SalesOutreachQueueRowDto[] | null; limit: number; unknown_reason: UnknownReason | null };
  overdueFor(agentId: string): Metric;
}>;

const TEAM_ATTENTION_MATCH: QueueMatch = {
  assignment: { kind: "all" },
  state: "needs_contact",
  priority: { kind: "all" },
  workflow: null,
  move_date: null,
  search: null,
};

export async function composeTeamCadence(input: {
  configuration: ActiveConfiguration;
  now: Date;
  queueStore: DeskQueueStore;
  readStore: SalesOutreachReadStore;
}): Promise<TeamCadence> {
  const { configuration, now, queueStore } = input;
  const cadence = deskCadenceOf(configuration);
  const unassignedScope = await queueStore.countScope({ kind: "unassigned" });
  if ("unavailable" in cadence) {
    const reason = cadence.unavailable;
    return {
      exposure: null,
      distinct_overdue_leads: unknown(reason),
      quoted_overdue_leads: unknown(reason),
      unassigned: { count: unassignedScope.subjects, overdue: unknown(reason) },
      leads_needing_attention: { rows: null, limit: TEAM_ATTENTION_LIMIT, unknown_reason: reason },
      overdueFor: () => unknown(reason),
    };
  }
  const page = await queueStore.findQueuePage({
    match: TEAM_ATTENTION_MATCH,
    sort: queueSortSpec("urgency", "asc"),
    after: null,
    limit: TEAM_ATTENTION_LIMIT,
  });
  const agents = [...new Set(page.map((row) => row.assigned_agent_id).filter((id): id is string => id !== null))];
  const names = await input.readStore.findReviewedRepNames(agents, now);
  const today = newYorkBusinessDay(now);
  const attention = { rows: page.map((row) => presentQueueRow(row, { as_of: now, today, names, exposure: cadence.exposure })), limit: TEAM_ATTENTION_LIMIT, unknown_reason: null };
  if (cadence.exposure === "shadow")
    return {
      exposure: "shadow",
      distinct_overdue_leads: unknown("cadence_shadow"),
      quoted_overdue_leads: unknown("cadence_shadow"),
      unassigned: { count: unassignedScope.subjects, overdue: unknown("cadence_shadow") },
      leads_needing_attention: attention,
      overdueFor: () => unknown("cadence_shadow"),
    };
  const counts = await queueStore.teamOverdue(now);
  return {
    exposure: "enforcement",
    distinct_overdue_leads: known(counts.distinct_overdue),
    quoted_overdue_leads: known(counts.quoted_call_overdue),
    unassigned: { count: unassignedScope.subjects, overdue: known(counts.unassigned_overdue) },
    leads_needing_attention: attention,
    overdueFor: (agentId) => known(counts.per_agent.get(agentId) ?? 0),
  };
}
