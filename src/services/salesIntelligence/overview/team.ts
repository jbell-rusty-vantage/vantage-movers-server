import { z } from "zod";
import { attentionQuerySchema, type AttentionQuery } from "../outreach/attention";
import { entryMatchesAttentionQuery, type AttentionIndexEntry } from "../outreach/attentionIndex";
import { readRosterAgents, selectRoster, workloadIndexReady, type RosterAgent, type RosterScope } from "../roster";
import { readOverviewIndex, type OverviewIndex } from "./now";

export const teamQuerySchema = z.object({ scope: z.literal("production").optional(),
  priority: z.preprocess(value => value == null || value === "" ? undefined : [...new Set((Array.isArray(value) ? value : [value]).flatMap(item => String(item).split(",")).map(item => item.trim()).filter(Boolean))].sort(),
    z.array(z.string().regex(/^(not_set|no_lead|[A-Za-z0-9]{1,8})$/)).min(1).optional()),
}).strict();
type TeamQuery = z.infer<typeof teamQuerySchema>;
type DrillParams = Record<string, string | string[] | number>;
export type WorkloadCount = { count: number; drill: { params: DrillParams } };
const OPEN_STATES = ["unworked", "open", "waiting_on_customer", "identity_review"];

/** Pure index-only read. The exact same S2 predicate supplies every count and every drill. */
export function buildTeamWorkload(index: OverviewIndex, agents: readonly RosterAgent[], query: TeamQuery, scope: RosterScope = null) {
  const common: DrillParams = { view: "all_outreach", snapshot_id: index.snapshot_id,
    ...(query.priority?.length ? { priority: query.priority } : {}), ...(scope ? { agent_id: [scope.agent_id] } : {}) };
  const matched = (params: DrillParams, candidates: readonly AttentionIndexEntry[] = index.entries) => {
    const parsed: AttentionQuery = attentionQuerySchema.parse(params);
    return candidates.filter(entry => entryMatchesAttentionQuery(entry, parsed, { as_of: index.as_of }));
  };
  const open = matched({ ...common, state: OPEN_STATES });
  const assigned = new Map<string, AttentionIndexEntry[]>(), followups = new Map<string, AttentionIndexEntry[]>(), involved = new Map<string, AttentionIndexEntry[]>();
  const unassigned: AttentionIndexEntry[] = [];
  const append = (map: Map<string, AttentionIndexEntry[]>, id: string, entry: AttentionIndexEntry) => {
    const bucket = map.get(id); if (bucket) bucket.push(entry); else map.set(id, [entry]);
  };
  // Narrow once by frozen relationships, then retain the S2 predicate as the metric authority.
  // Each row visits only its relevant Agents instead of rescanning 10k rows for every column.
  for (const entry of open) {
    const keys = entry.filter_keys;
    if (keys.responsible) append(assigned, keys.responsible, entry); else unassigned.push(entry);
    for (const id of keys.followup_agents ?? []) append(followups, id, entry);
    for (const id of keys.agents) append(involved, id, entry);
  }
  const metric = (filters: DrillParams, project?: (entries: readonly AttentionIndexEntry[]) => number): WorkloadCount => {
    const params = { ...common, state: OPEN_STATES, ...filters };
    const first = (value: string | string[] | number | undefined) => Array.isArray(value) ? value[0] : typeof value === "string" ? value : undefined;
    const assignedId = first(filters.assigned_agent_id), followupId = first(filters.followup_agent_id), involvedId = first(filters.agent_id);
    const candidates = assignedId ? assigned.get(assignedId) ?? [] : followupId ? followups.get(followupId) ?? []
      : involvedId ? involved.get(involvedId) ?? [] : filters.assignment === "unassigned" ? unassigned : open;
    const entries = matched(params, candidates);
    return { count: project ? project(entries) : entries.length, drill: { params } };
  };
  const assignedMetrics = (assignment: DrillParams) => ({
    assigned: metric(assignment), records_with_overdue: metric({ ...assignment, work: ["overdue_followup"] }),
    due_today: metric({ ...assignment, work: ["due_today"] }), no_next_step: metric({ ...assignment, work: ["no_next_step"] }),
    blocked: metric({ ...assignment, work: ["blocked"] }),
  });
  const roster = selectRoster(agents, index.entries, {}, scope);
  const rows = roster.map(agent => {
    const followup = { followup_agent_id: [agent.id] };
    const overdue = { ...followup, work: ["overdue_followup"] };
    const actionCount = (field: "actions" | "overdue") => (entries: readonly AttentionIndexEntry[]) => entries.reduce((total, entry) =>
      total + (entry.filter_keys.followup_counts?.find(count => count.agent_id === agent.id)?.[field] ?? 0), 0);
    return { agent: { id: agent.id, name: agent.name, active: agent.active }, ...assignedMetrics({ assigned_agent_id: [agent.id] }),
      followups: { actions: metric(followup, actionCount("actions")), records: metric(followup) },
      followups_overdue: { actions: metric(overdue, actionCount("overdue")), records: metric(overdue) },
      involved: metric({ agent_id: [agent.id] }),
    };
  });
  // Review-only and closed-review records belong here, never in Assigned or the open-work counts.
  const reviewParams = { ...common, needs_review: "true" };
  return { rows, unassigned: scope ? null : assignedMetrics({ assignment: "unassigned" }),
    attention: { records_with_overdue: metric({ work: ["overdue_followup"] }), awaiting_first_call: metric({ band: ["2"] }),
      ...(scope ? {} : { unassigned: metric({ assignment: "unassigned" }) }),
      needs_review: { count: matched(reviewParams).length, drill: { params: reviewParams } },
    }, snapshot_id: index.snapshot_id, as_of: index.as_of.toISOString(), status: "ready" as const };
}

/** Two batched reads, regardless of roster size; no per-Agent queries or writes. */
export async function readTeamWorkload(raw: z.input<typeof teamQuerySchema>, options: { now?: Date; scope?: RosterScope } = {}) {
  const query = teamQuerySchema.parse(raw), now = options.now ?? new Date(), scope = options.scope ?? null;
  const [index, agents] = await Promise.all([readOverviewIndex(now), readRosterAgents(scope)]);
  if (!index || !workloadIndexReady(index)) return { as_of: index?.as_of.toISOString() ?? now.toISOString(), data: {
    rows: [], unassigned: null, attention: null, snapshot_id: index?.snapshot_id ?? null, as_of: index?.as_of.toISOString() ?? now.toISOString(), status: "pending_projection" as const,
  } };
  const data = buildTeamWorkload(index, agents, query, scope);
  return { as_of: data.as_of, data };
}
