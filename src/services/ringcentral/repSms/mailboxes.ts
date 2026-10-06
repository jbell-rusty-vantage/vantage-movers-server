import type { ClientSession } from "mongoose";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { resolveRepIdentityAt, type TemporalRepLink } from "../../salesIntelligence/repIdentity/resolve";
import { configuredRingCentralAccountId } from "../../numberActivity/accountIdentity";

/**
 * Reviewed rep mailboxes (RINGCENTRAL-CAPTURE §3/§5, P07e): the RingCentral extensions whose
 * `rep_identity_links` row is `reviewed` with `role_kind: sales_rep` at `at`. A conflicting or
 * proposed-only extension is not a reviewed mailbox. Read only.
 */
export type RepMailbox = {
  rc_account_id: string;
  extension_id: string;
  agent_id: string;
  link_id: string;
  /** DIDs the link recorded for the extension (`rc_direct_numbers` + `rc_sms_sender_number`). Empty = not known. */
  sender_numbers: string[];
};

type MailboxLinkRow = TemporalRepLink & { rc_direct_numbers?: string[] | null; rc_sms_sender_number?: string | null };

/** Pure: the reviewed `sales_rep` mailboxes among link rows effective at `at`. */
export function reviewedRepMailboxes(rows: readonly MailboxLinkRow[], account: string, at: Date): RepMailbox[] {
  const extensions = [...new Set(rows.filter((r) => r.rc_account_id === account).map((r) => r.rc_extension_id))].sort();
  const out: RepMailbox[] = [];
  for (const extension of extensions) {
    const resolution = resolveRepIdentityAt(rows, account, extension, at);
    if (resolution.status !== "reviewed" || !resolution.agent_id || !resolution.link_id) continue;
    const link = rows.find((r) => String(r._id) === resolution.link_id);
    const numbers = [...(link?.rc_direct_numbers ?? []), ...(link?.rc_sms_sender_number ? [link.rc_sms_sender_number] : [])];
    out.push({
      rc_account_id: account,
      extension_id: extension,
      agent_id: resolution.agent_id,
      link_id: resolution.link_id,
      sender_numbers: [...new Set(numbers.filter((n) => typeof n === "string" && n.trim()))].sort(),
    });
  }
  return out;
}

/**
 * Reads the effective links of the configured account. Without `RINGCENTRAL_ACCOUNT_ID` there is no
 * account to scope to, so there are no mailboxes (fail closed). `session` keeps the reads inside a
 * caller's transaction (the desk evaluation's SMS coverage).
 */
export async function listReviewedRepMailboxes(
  at: Date,
  account: string | null = configuredRingCentralAccountId(),
  session: ClientSession | null = null,
): Promise<RepMailbox[]> {
  if (!account) return [];
  const rows = (await getRepIdentityLinkModel()
    .find({
      rc_account_id: account,
      role_kind: "sales_rep",
      effective_from: { $lte: at },
      $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
    })
    .session(session)
    .lean()) as unknown as MailboxLinkRow[];
  // Re-read every row of those extensions so a conflicting non-sales_rep authority is not hidden.
  const extensions = [...new Set(rows.map((r) => r.rc_extension_id))];
  if (!extensions.length) return [];
  const all = (await getRepIdentityLinkModel()
    .find({
      rc_account_id: account,
      rc_extension_id: { $in: extensions },
      effective_from: { $lte: at },
      $or: [{ effective_to: null }, { effective_to: { $gt: at } }],
    })
    .session(session)
    .lean()) as unknown as MailboxLinkRow[];
  return reviewedRepMailboxes(all, account, at);
}
