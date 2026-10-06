import type { SalesOutreachCadenceExposure } from "../../../config/domain/salesOutreach";
import type {
  SalesOutreachQueueRowDto,
  SalesOutreachRepDayDto,
  SALES_OUTREACH_CADENCE_UNKNOWN_REASONS,
} from "../../../validation/v1/salesOutreachReads";
import type { ActiveConfiguration } from "../config/load";
import { newYorkBusinessDay } from "./businessDay";
import type { DeskReadCoverage } from "./common";
import { NO_AGENT_CADENCE, overdueCutoffs, type DeskQueueStore } from "./deskStore";
import { presentQueueRow } from "./present";
import { deskCadenceOf } from "./queue";
import { queueSortSpec, type QueueMatch } from "./queueQuery";
import type { SalesOutreachReadStore } from "./store";

/**
 * The team desk's cadence parts (SPECIFICATION §6.2; CONTRACTS "GET /team"): cards 3–4 (distinct overdue
 * Leads, Quoted Leads with an overdue Call requirement), the Unassigned count and its overdue part, the
 * first "Leads needing attention" rows; and the per-rep cadence counts shared by GET /rep-days and the
 * team's Daily call goals rows (`composeRepCadence`).
 *
 * Overdue is read-time: a Lead is overdue when a channel's earliest unsatisfied actionable deadline
 * (blocked channels excluded) is at or before `now` AND that channel's cadence coverage proves it (olr
 * A2: the same rule as each row's `verification`, so the cards and the rows agree and the count does not
 * dip while capture settles after 12:00/20:00). With call coverage unknown the overdue figures are null
 * (`coverage_incomplete`). Overdue figures exist only under enforcement; in shadow they are null
 * (`cadence_shadow`) because no overdue label may be shown. The Unassigned count is a count of subjects,
 * not a label, so it is served whenever the desk is on. Goals never hide overdue work.
 */

type UnknownReason = (typeof SALES_OUTREACH_CADENCE_UNKNOWN_REASONS)[number];
type Metric = { value: number | null; unknown_reason: UnknownReason | null };

export const TEAM_ATTENTION_LIMIT = 10;

const known = (value: number): Metric => ({ value, unknown_reason: null });
const unknown = (reason: UnknownReason): Metric => ({ value: null, unknown_reason: reason });
/** A coverage-gated count: null ⇒ call coverage unknown (`coverage_incomplete`). */
const verifiedCount = (value: number | null): Metric => (value === null ? unknown("coverage_incomplete") : known(value));

export type TeamCadence = Readonly<{
  exposure: SalesOutreachCadenceExposure | null;
  distinct_overdue_leads: Metric;
  quoted_overdue_leads: Metric;
  unassigned: { count: number | null; overdue: Metric };
  leads_needing_attention: { rows: SalesOutreachQueueRowDto[] | null; limit: number; unknown_reason: UnknownReason | null };
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
  /** The read's coverage (`readFreshness`). */
  coverage: DeskReadCoverage;
}): Promise<TeamCadence> {
  const { configuration, now, queueStore, coverage } = input;
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
  const attention = { rows: page.map((row) => presentQueueRow(row, { as_of: now, today, names, exposure: cadence.exposure, coverage })), limit: TEAM_ATTENTION_LIMIT, unknown_reason: null };
  if (cadence.exposure === "shadow")
    return {
      exposure: "shadow",
      distinct_overdue_leads: unknown("cadence_shadow"),
      quoted_overdue_leads: unknown("cadence_shadow"),
      unassigned: { count: unassignedScope.subjects, overdue: unknown("cadence_shadow") },
      leads_needing_attention: attention,
    };
  const counts = await queueStore.teamOverdue(now, coverage.cadence);
  return {
    exposure: "enforcement",
    distinct_overdue_leads: verifiedCount(counts.distinct_overdue),
    quoted_overdue_leads: verifiedCount(counts.quoted_call_overdue),
    unassigned: { count: unassignedScope.subjects, overdue: verifiedCount(counts.unassigned_overdue) },
    leads_needing_attention: attention,
  };
}

export type RepCadenceMetrics = Pick<SalesOutreachRepDayDto, "overdue_leads" | "calls_due_today" | "sms_due_today">;
/** Agent id → its cadence counts (an Agent with no active Lead reads 0 once cadence data can be shown). */
export type RepCadence = (agentId: string) => RepCadenceMetrics;

/**
 * Per-rep cadence counts at `now` for `agentIds` (SPECIFICATION §6.1 goal card; §6.2 Daily call goals
 * overdue column). Same rule and exposure as the team cards:
 * - cadence off or unresolvable → every count null (`cadence_disabled` / `policy_unavailable`);
 * - shadow → overdue null (`cadence_shadow`: no overdue label may be shown); the due counts are served,
 *   because a shadow queue row shows its requirements and remaining counts (its overdue status reads `due`);
 * - enforcement → every count; overdue Leads by the coverage-aware rule (null `coverage_incomplete`
 *   while call coverage is unknown).
 * A due count with any due requirement whose remaining is unknown is null (`coverage_incomplete`), never
 * a partial sum.
 */
export async function composeRepCadence(input: {
  configuration: ActiveConfiguration;
  now: Date;
  queueStore: DeskQueueStore;
  agentIds: readonly string[];
  /** The read's coverage (`readFreshness`). */
  coverage: DeskReadCoverage;
}): Promise<RepCadence> {
  const cadence = deskCadenceOf(input.configuration);
  if ("unavailable" in cadence) {
    const none = unknown(cadence.unavailable);
    return () => ({ overdue_leads: none, calls_due_today: none, sms_due_today: none });
  }
  const counts = input.agentIds.length ? await input.queueStore.agentCadence(input.now, input.agentIds, input.coverage.cadence) : new Map();
  const overdueKnowable = overdueCutoffs(input.now, input.coverage.cadence) !== null;
  const due = (remaining: number, unknownCount: number) =>
    unknownCount > 0 ? { value: null, unknown_reason: "coverage_incomplete" as const } : known(remaining);
  return (agentId) => {
    const c = counts.get(agentId) ?? NO_AGENT_CADENCE;
    return {
      overdue_leads:
        cadence.exposure !== "enforcement" ? unknown("cadence_shadow") : verifiedCount(overdueKnowable ? (c.overdue_leads ?? 0) : null),
      calls_due_today: due(c.call_due_remaining, c.call_due_unknown),
      sms_due_today: due(c.sms_due_remaining, c.sms_due_unknown),
    };
  };
}
