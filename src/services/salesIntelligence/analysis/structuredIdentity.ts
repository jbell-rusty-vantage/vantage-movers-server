import { getCallInteractionModel } from "../../../models/CallInteraction";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { resolveRepIdentityAt } from "../repIdentity/resolve";
import { CsiError } from "../auth";
import type { ReadContent } from "./reads";

/** One call join and one reviewed-link join for all summaries; no per-call MCP/identity requests. */
export async function readStructuredIdentities(numberId: string, interactionIds: string[], coverage: ReadContent["coverage"]) {
  const calls = await getCallInteractionModel().find({ _id: { $in: interactionIds }, contact_number_id: numberId,
    merged_into_id: null, purged_at: null }).lean();
  if (calls.length !== new Set(interactionIds).size) throw new CsiError("EVIDENCE_SCOPE_INVALID");
  const clauses = calls.map(call => ({ rc_account_id: call.provider_account_id,
    rc_extension_id: { $in: [...new Set(call.parties.filter(p => p.role === "user").flatMap(p => p.extension_id ? [p.extension_id] : []))] },
    effective_from: { $lte: call.started_at }, $or: [{ effective_to: null }, { effective_to: { $gt: call.started_at } }] }));
  const links = clauses.length ? await getRepIdentityLinkModel().find({ $or: clauses }).limit(2001).lean() : [];
  if (links.length > 2000) throw new CsiError("EVIDENCE_LIMIT_REACHED");
  return new Map(calls.map(call => {
    const extensions = [...new Set(call.parties.filter(p => p.role === "user").flatMap(p => p.extension_id ? [p.extension_id] : []))];
    const resolutions = extensions.map(extension => ({ extension,
      ...resolveRepIdentityAt(links, call.provider_account_id, extension, call.started_at) }));
    const data: ReadContent = { page: { complete: true, next_cursor: null, missing_ranges: [],
      records: resolutions.map(r => ({ record_type: "rep_identity", record_id: r.link_id ?? `${call._id}:${r.extension}`,
        revision: r.fingerprint, fields: { account_id: call.provider_account_id, extension_id: r.extension,
          agent_id: r.agent_id, status: r.status, occurred_at: call.started_at.toISOString() } })) },
      coverage, allowed_followup_ids: [], instructions: [],
      speaker_refs: [...new Set(resolutions.flatMap(r => r.agent_id ? [`agent:${r.agent_id}`] : []))] };
    return [String(call._id), data];
  }));
}
