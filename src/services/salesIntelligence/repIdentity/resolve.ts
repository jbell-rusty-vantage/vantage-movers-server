import type { ClientSession } from "mongoose";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { payloadHash } from "../transactions";

export type TemporalRepLink = {
  _id: unknown; revision: number; agent_id: unknown; rc_account_id: string; rc_extension_id: string;
  role_kind: string; status: string; effective_from: Date; effective_to?: Date | null;
  reviewed_at?: Date | null; reviewed_by?: string | null;
};
export type RepResolution = {
  status: "reviewed" | "unknown" | "proposed_only" | "conflicting" | "excluded_role";
  agent_id: string | null; link_id: string | null; fingerprint: string;
};
/** Half-open intervals [from,to). Retirement retains authority only when review preceded retirement. */
export function resolveRepIdentityAt(rows: readonly TemporalRepLink[], account: string, extension: string, at: Date): RepResolution {
  const scoped = rows.filter(r => r.rc_account_id === account && r.rc_extension_id === extension &&
    r.effective_from <= at && (!r.effective_to || at < r.effective_to));
  const authority = scoped.filter(r => r.status === "reviewed" ||
    (r.status === "retired" && r.reviewed_at && r.reviewed_by && r.effective_to));
  const fingerprint = payloadHash(scoped.map(r => ({ id: String(r._id), revision: r.revision, status: r.status,
    agent: String(r.agent_id), role: r.role_kind, from: r.effective_from.toISOString(), to: r.effective_to?.toISOString() ?? null,
    reviewed: r.reviewed_at?.toISOString() ?? null })).sort((a,b) => a.id.localeCompare(b.id)));
  const row = authority.length === 1 ? authority[0] : null;
  const status = authority.length > 1 ? "conflicting" : row ? row.role_kind === "sales_rep" ? "reviewed" : "excluded_role" :
    scoped.some(r => r.status === "proposed") ? "proposed_only" : "unknown";
  return { status, agent_id: status === "reviewed" ? String(row!.agent_id) : null, link_id: row ? String(row._id) : null, fingerprint };
}
/** Authoritative account-scoped resolver for CSI-06/08/09/11/12/13 and future CSI-14. Read only. */
export async function resolveRepIdentities(account: string, extensions: readonly string[], at: Date, session?: ClientSession) {
  const ids = [...new Set(extensions)].sort();
  const rows = await getRepIdentityLinkModel().find({ rc_account_id: account, rc_extension_id: { $in: ids },
    effective_from: { $lte: at }, $or: [{ effective_to: null }, { effective_to: { $gt: at } }] }).session(session ?? null).lean();
  const resolutions = ids.map(id => ({ extension_id: id, ...resolveRepIdentityAt(rows, account, id, at) }));
  // Multiple possible participants never establish a promising speaker. Callers must supply actual participant evidence.
  return { resolutions, agent_ids: [...new Set(resolutions.flatMap(r => r.agent_id ? [r.agent_id] : []))],
    fingerprint: payloadHash(resolutions) };
}
