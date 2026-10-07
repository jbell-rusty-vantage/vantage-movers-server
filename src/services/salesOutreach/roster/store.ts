import mongoose, { type ClientSession } from "mongoose";
import { Agent } from "../../../models/Agent";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { effectiveRoster, rosterRuleOf, type EffectiveRoster, type GoalsConfiguration } from "./rule";

/**
 * Who is a **desk rep** at an instant (P08a-1, F1): an Agent that is `active` and holds a reviewed
 * `sales_rep` identity link effective at `at`. One bounded query pair: the current reviewed links
 * (`ril_agent_current` / `ril_status`), then the Agents by `_id` with `active: true`. The link's name
 * snapshot is the display name (what every desk read already shows). Read-only; the optional session
 * lets a recount or a command read the roster inside its own transaction.
 */

export type DeskRep = Readonly<{ agent_id: string; agent_name: string }>;

const MAX_LINKS = 500;

export async function findDeskRepsAt(at: Date, session?: ClientSession | null, agentIds?: readonly string[] | null): Promise<DeskRep[]> {
  // The same authority rule as call credit (`repIdentity/resolve.ts`): a reviewed link, or a link reviewed
  // and later retired, inside its half-open interval — so a past day's roster still holds a rep whose
  // link was retired after that day. At `now` a retired link has already ended, so only reviewed ones count.
  const filter: Record<string, unknown> = {
    status: { $in: ["reviewed", "retired"] },
    role_kind: "sales_rep",
    effective_from: { $lte: at },
    $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
  };
  if (agentIds) {
    const ids = [...new Set(agentIds)].filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return [];
    filter.agent_id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  const links = (await getRepIdentityLinkModel()
    .find(filter, { agent_id: 1, agent_name_snapshot: 1, status: 1, reviewed_at: 1, reviewed_by: 1, effective_to: 1 })
    .limit(MAX_LINKS)
    .session(session ?? null)
    .lean()) as Array<{
    agent_id: unknown;
    agent_name_snapshot: string;
    status: string;
    reviewed_at?: Date | null;
    reviewed_by?: string | null;
    effective_to?: Date | null;
  }>;
  const authority = links.filter((link) => link.status === "reviewed" || (link.reviewed_at && link.reviewed_by && link.effective_to));
  if (!authority.length) return [];
  const linked = new Map<string, string>();
  for (const link of authority) linked.set(String(link.agent_id), link.agent_name_snapshot);
  const active = (await Agent.find({ _id: { $in: [...linked.keys()].map((id) => new mongoose.Types.ObjectId(id)) }, active: true }, { _id: 1 })
    .session(session ?? null)
    .lean()) as Array<{ _id: unknown }>;
  return active
    .map((row) => String(row._id))
    .sort()
    .map((agent_id) => ({ agent_id, agent_name: linked.get(agent_id)! }));
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
