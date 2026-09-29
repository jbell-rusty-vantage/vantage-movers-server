import mongoose from "mongoose";
import { z } from "zod";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { readOverviewIndex, type OverviewIndex } from "./overview/now";
import type { AttentionIndexEntry } from "./outreach/attentionIndex";

export const rosterQuerySchema = z.object({
  scope: z.literal("production").optional(), q: z.string().trim().max(100).transform(value => value.toLowerCase()).optional(),
  include_inactive: z.enum(["true", "false"]).optional(),
}).strict();
export type RosterAgent = { _id: mongoose.Types.ObjectId; name: string; active: boolean; archived_at?: Date | null };
export type RosterScope = { agent_id: string } | null;
export type RosterEntry = { id: string; name: string; active: boolean; has_open_work: boolean };

export function workloadIndexReady(index: OverviewIndex | null): boolean {
  return Boolean(index && index.entries.every(entry => entry.filter_keys.followup_counts !== undefined && entry.filter_keys.work !== undefined));
}
export const isOpenWorkEntry = (entry: AttentionIndexEntry) => entry.partition === "active" && entry.filter_keys.state !== null && entry.filter_keys.state !== "closed";

/** One catalog query, independent of roster size; rep scope narrows before reading names. */
export async function readRosterAgents(scope: RosterScope = null): Promise<RosterAgent[]> {
  return mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true }).collection<RosterAgent>("agents")
    .find(scope ? { _id: new mongoose.Types.ObjectId(scope.agent_id) } : {}, { projection: { _id: 1, name: 1, active: 1, archived_at: 1 } }).toArray();
}

/** Roster membership never depends on login, extension links, recent calls or promises. */
export function selectRoster(agents: readonly RosterAgent[], entries: readonly AttentionIndexEntry[], query: z.infer<typeof rosterQuerySchema>, scope: RosterScope = null): RosterEntry[] {
  const work = new Set<string>();
  for (const entry of entries) {
    if (!isOpenWorkEntry(entry)) continue;
    if (entry.filter_keys.responsible) work.add(entry.filter_keys.responsible);
    for (const count of entry.filter_keys.followup_counts ?? []) if (count.agent_id && count.actions > 0) work.add(count.agent_id);
  }
  return agents.flatMap(agent => {
    const id = String(agent._id), active = agent.active === true && !agent.archived_at, has_open_work = work.has(id);
    if (scope && id !== scope.agent_id) return [];
    if (!scope && query.include_inactive !== "true" && !active && !has_open_work) return [];
    if (query.q && !agent.name.toLowerCase().includes(query.q)) return [];
    return [{ id, name: agent.name, active, has_open_work }];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export async function readRoster(raw: z.input<typeof rosterQuerySchema>, options: { scope?: RosterScope; now?: Date } = {}) {
  const query = rosterQuerySchema.parse(raw), scope = options.scope ?? null, now = options.now ?? new Date();
  const [index, agents] = await Promise.all([readOverviewIndex(now), readRosterAgents(scope)]);
  if (!index || !workloadIndexReady(index)) return { as_of: index?.as_of.toISOString() ?? now.toISOString(), data: {
    agents: [] as RosterEntry[], status: "pending_projection" as const, snapshot_id: index?.snapshot_id ?? null,
  } };
  return { as_of: index.as_of.toISOString(), data: { agents: selectRoster(agents, index.entries, query, scope), status: "ready" as const, snapshot_id: index.snapshot_id } };
}
