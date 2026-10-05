import { getRepIdentityLinkModel } from "../../models/RepIdentityLink";
import { resolveRepIdentityAt, type TemporalRepLink } from "../salesIntelligence/repIdentity/resolve";

/**
 * Who on our side took or made a call: the user party of a Call Interaction and the Agent its
 * extension resolves to through the Rep Identity Link effective at the call time. Reads only.
 * Shared by the All Numbers call summary (`last_call.rc_extension_id`) and the All Numbers reads,
 * so they agree on the party and the name.
 */
export type CallPartyLike = { role: string; connected?: boolean | null; extension_id?: string | null; extension_number?: string | null };

/** The user party that answered (connected, with an extension), else the first user party with an extension. */
export function callUserParty<P extends CallPartyLike>(row: { parties?: readonly P[] | null }): P | null {
  const parties = row.parties ?? [];
  return parties.find((p) => p.role === "user" && p.connected && p.extension_id) ?? parties.find((p) => p.role === "user" && p.extension_id) ?? null;
}

export type RepLinkLean = TemporalRepLink & { agent_name_snapshot?: string | null };

/**
 * The Agent name of one extension at one instant, for All Numbers rows (CONTRACT §2 `last_call`).
 * The reviewed link effective then names it, whatever its role except `excluded`; several accounts
 * carrying the same extension id, a proposal only, or conflicting authority name nobody.
 */
export function agentNameAt(links: readonly RepLinkLean[], extensionId: string | null, at: Date): string | null {
  if (!extensionId) return null;
  const names = new Set<string>();
  for (const account of new Set(links.filter((l) => l.rc_extension_id === extensionId).map((l) => l.rc_account_id))) {
    const resolution = resolveRepIdentityAt(links, account, extensionId, at);
    // `link_id` is set only when exactly one reviewed (or reviewed-then-retired) link is in effect.
    if (!resolution.link_id) continue;
    const link = links.find((l) => String(l._id) === resolution.link_id);
    if (!link || link.role_kind === "excluded" || !link.agent_name_snapshot) continue;
    names.add(link.agent_name_snapshot);
  }
  return names.size === 1 ? [...names][0]! : null;
}

/** One bounded read of every link of the given extensions (all accounts, every interval). */
export async function loadRepLinksForExtensions(extensionIds: readonly (string | null | undefined)[]): Promise<RepLinkLean[]> {
  const ids = [...new Set(extensionIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return [];
  return (await getRepIdentityLinkModel()
    .find({ rc_extension_id: { $in: ids } })
    .limit(1_000)
    .lean()) as unknown as RepLinkLean[];
}
