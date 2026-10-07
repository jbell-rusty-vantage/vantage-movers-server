import mongoose, { type ClientSession } from "mongoose";
import { Agent } from "../../../models/Agent";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { deskMembership, effectiveRoster, rosterRuleOf, type DeskMembership, type EffectiveRoster, type GoalsConfiguration } from "./rule";

/**
 * Who is a **desk rep** at an instant (P08a-1, F1; People & access 2026-10-07): an `active` Agent that
 * `deskMembership` admits — the Owner's `Agent.outreach_desk` (`on` / `off`), else a Granot username or
 * a reviewed `sales_rep` identity link effective at `at`. One bounded query pair: the current reviewed
 * links (`ril_agent_current` / `ril_status`), then the active Agents. A linked rep's display name is the
 * link's name snapshot (what every desk read already shows); any other rep shows the Agent's name.
 * Read-only; the optional session lets a recount or a command read the roster inside its own transaction.
 */

export type DeskRep = Readonly<{ agent_id: string; agent_name: string }>;

const MAX_LINKS = 500;
const MAX_AGENTS = 1000;

type AgentRow = {
  _id: unknown;
  name: string;
  active?: boolean;
  outreach_desk?: string | null;
  granot_crm_username?: string | null;
  granot_identity?: { username?: string | null } | null;
};

/** The Agent's Granot username: the flat field, else the nested identity (the catalog read does the same). */
export const granotUsernameOf = (agent: Pick<AgentRow, "granot_crm_username" | "granot_identity">): string | null =>
  agent.granot_crm_username ?? agent.granot_identity?.username ?? null;

const objectIdsOf = (ids: readonly string[]) => [...new Set(ids)].filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));

/** Agent id → name snapshot of every reviewed `sales_rep` link effective at `at` (optionally for some Agents). */
async function salesRepLinksAt(at: Date, session: ClientSession | null, agentIds: mongoose.Types.ObjectId[] | null): Promise<Map<string, string>> {
  // The same authority rule as call credit (`repIdentity/resolve.ts`): a reviewed link, or a link reviewed
  // and later retired, inside its half-open interval — so a past day's roster still holds a rep whose
  // link was retired after that day. At `now` a retired link has already ended, so only reviewed ones count.
  const filter: Record<string, unknown> = {
    status: { $in: ["reviewed", "retired"] },
    role_kind: "sales_rep",
    effective_from: { $lte: at },
    $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
  };
  if (agentIds) filter.agent_id = { $in: agentIds };
  const links = (await getRepIdentityLinkModel()
    .find(filter, { agent_id: 1, agent_name_snapshot: 1, status: 1, reviewed_at: 1, reviewed_by: 1, effective_to: 1 })
    .limit(MAX_LINKS)
    .session(session)
    .lean()) as Array<{
    agent_id: unknown;
    agent_name_snapshot: string;
    status: string;
    reviewed_at?: Date | null;
    reviewed_by?: string | null;
    effective_to?: Date | null;
  }>;
  const linked = new Map<string, string>();
  for (const link of links) {
    if (link.status === "reviewed" || (link.reviewed_at && link.reviewed_by && link.effective_to)) linked.set(String(link.agent_id), link.agent_name_snapshot);
  }
  return linked;
}

export async function findDeskRepsAt(at: Date, session?: ClientSession | null, agentIds?: readonly string[] | null): Promise<DeskRep[]> {
  const ids = agentIds ? objectIdsOf(agentIds) : null;
  if (ids && !ids.length) return [];
  const linked = await salesRepLinksAt(at, session ?? null, ids);
  const agents = (await Agent.find(
    { active: true, ...(ids ? { _id: { $in: ids } } : {}) },
    { _id: 1, name: 1, outreach_desk: 1, granot_crm_username: 1, "granot_identity.username": 1 },
  )
    .limit(MAX_AGENTS)
    .session(session ?? null)
    .lean()) as AgentRow[];
  return agents
    .filter((agent) => deskMembership({ active: true, outreach_desk: agent.outreach_desk, granot_username: granotUsernameOf(agent) }, linked.has(String(agent._id))).on)
    .map((agent) => ({ agent_id: String(agent._id), agent_name: linked.get(String(agent._id)) ?? agent.name }))
    .sort((a, b) => (a.agent_id < b.agent_id ? -1 : a.agent_id > b.agent_id ? 1 : 0));
}

/**
 * Each Agent's desk membership now, for People & access (the same rule as `findDeskRepsAt`, but for every
 * Agent the caller lists, inactive ones included, with the reason).
 */
export async function deskMembershipsNow(agents: ReadonlyArray<AgentRow & { id?: string }>, now: Date = new Date()): Promise<Map<string, DeskMembership>> {
  const idOf = (agent: AgentRow & { id?: string }) => agent.id ?? String(agent._id);
  const linked = agents.length ? await salesRepLinksAt(now, null, objectIdsOf(agents.map(idOf))) : new Map<string, string>();
  return new Map(
    agents.map((agent) => [
      idOf(agent),
      deskMembership({ active: agent.active !== false, outreach_desk: agent.outreach_desk, granot_username: granotUsernameOf(agent) }, linked.has(idOf(agent))),
    ]),
  );
}

/** Desk-rep Agent ids at `at` (a convenience over `findDeskRepsAt`). */
export async function findDeskRepIdsAt(at: Date, session?: ClientSession | null): Promise<string[]> {
  return (await findDeskRepsAt(at, session)).map((rep) => rep.agent_id);
}

/** Whether one Agent is a desk rep at `at`. */
export async function isDeskRepAt(agentId: string, at: Date, session?: ClientSession | null): Promise<boolean> {
  return (await findDeskRepsAt(at, session, [agentId])).length === 1;
}

/** The injectable desk-rep lookup (tests, dry runs): Agent ids that are desk reps at `at`. */
export type DeskRepLookup = (at: Date, session?: ClientSession | null) => Promise<readonly string[]>;

/**
 * The effective roster of `goals` at `at`: the desk reps are read only under the `desk_reps` rule
 * (the explicit list needs no query).
 */
export async function loadEffectiveRoster(goals: GoalsConfiguration, at: Date, deskReps: DeskRepLookup = findDeskRepIdsAt, session?: ClientSession | null): Promise<EffectiveRoster> {
  if (rosterRuleOf(goals) === "explicit") return effectiveRoster(goals, null);
  return effectiveRoster(goals, await deskReps(at, session));
}
