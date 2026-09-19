import type { ClientSession } from "mongoose";
import { Agent } from "../../../models/Agent";
import { getRingCentralDirectorySnapshotModel } from "../../../models/RingCentralDirectorySnapshot";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getSalesIntelligenceSyncStateModel } from "../../../models/SalesIntelligenceSyncState";
import { CsiError } from "../auth";
import { payloadHash } from "../transactions";

type CandidateAgent = { _id: unknown; name: string; name_aliases?: readonly string[] };
type UserExtension = { id: string; type: string; name?: string | null };
const nameKey = (name: string) => name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
/** All matches are evidence only. Do not break ties with sort order or match strength. */
export function proposeRepCandidates(extension: UserExtension, agents: readonly CandidateAgent[]) {
  const name = nameKey(extension.name ?? "");
  const candidates = extension.type !== "User" || !name ? [] : agents.flatMap(agent => {
    const primary = nameKey(agent.name), aliases = (agent.name_aliases ?? []).map(nameKey);
    const basis = primary === name ? "exact_full_name" : aliases.includes(name) ? "alias" :
      [primary, ...aliases].some(n => n.split(" ")[0] === name.split(" ")[0]) ? "first_token" : null;
    return basis ? [{ agent_id: String(agent._id), agent_name: agent.name, basis }] : [];
  }).sort((a,b) => a.agent_id.localeCompare(b.agent_id));
  return { extension_id: extension.id, extension_name: extension.name ?? null, candidates,
    status: extension.type !== "User" ? "non_user" as const : candidates.length > 1 ? "ambiguous" as const : candidates.length === 1 ? "proposed" as const : "unmatched" as const };
}
export async function loadRepDirectory(account: string, session?: ClientSession, includeAgents = true) {
  const snapshot = await getRingCentralDirectorySnapshotModel().findOne({ provider_account_id: account }).sort({ taken_at: -1, _id: -1 }).session(session ?? null).lean();
  const agents = includeAgents ? await Agent.find({ active: true }).select({ name: 1, name_aliases: 1, granot_identity: 1, granot_crm_username: 1 }).session(session ?? null).lean() : [];
  const incomplete = !snapshot || snapshot.counts.extensions !== snapshot.extensions.length ||
    snapshot.counts.users !== snapshot.extensions.filter(e => e.type === "User").length || new Set(snapshot.extensions.map(e => e.id)).size !== snapshot.extensions.length;
  return { snapshot, agents, evidence: { status: !snapshot ? "missing" as const : incomplete ? "incomplete" as const : "stored" as const,
    snapshot_id: snapshot ? String(snapshot._id) : null, taken_at: snapshot?.taken_at.toISOString() ?? null,
    completeness: "provider_completeness_unverified" as const } };
}
/** A shared transactional write fence prevents write skew even for disjoint historical intervals. */
export async function lockRepExtension(account: string, extension: string, session: ClientSession) {
  if (!session.inTransaction()) throw new CsiError("INVALID_INPUT");
  await getSalesIntelligenceSyncStateModel().updateOne({ scope: `rep_identity:${payloadHash([account, extension])}` },
    { $inc: { lease_epoch: 1 } }, { upsert: true, session });
}
export async function assertNoRepOverlap(account: string, extension: string, from: Date, to: Date | null, session: ClientSession, except?: string) {
  if (!Number.isFinite(+from) || (to && (!Number.isFinite(+to) || to <= from))) throw new CsiError("INVALID_INPUT");
  const rows = await getRepIdentityLinkModel().find({ rc_account_id: account, rc_extension_id: extension,
    ...(except ? { _id: { $ne: except } } : {}) }).session(session).lean();
  if (rows.some(r => (r.status !== "retired" || (r.reviewed_at && r.reviewed_by)) &&
    (!to || r.effective_from < to) && (!r.effective_to || from < r.effective_to))) throw new CsiError("IDENTITY_BLOCKED");
}
