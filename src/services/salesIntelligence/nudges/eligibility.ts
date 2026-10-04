import type { ClientSession } from "mongoose";
import { z } from "zod";
import { csiFlag, csiNudgeConfiguration } from "../../../config/domain/salesIntelligence";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { csiNudgeCommandSchema } from "../../../validation/v1/salesIntelligence";
import { CsiError } from "../auth";
import { resolvePolicy } from "../policy";
import { resolveRepIdentities } from "../repIdentity/resolve";
import { loadRepDirectory } from "../repIdentity/propose";
import { renderNudgeTemplate } from "./templates";
import type { NudgeChannel, NudgeRecipient } from "./adapters";

export type NudgeCommand = z.infer<typeof csiNudgeCommandSchema>;
type DirectoryUser = { id: string; type: string; name?: string | null; status?: string | null; extension_number?: string | null; direct_numbers: string[] };
export function assertNudgesEnabled() {
  if (!csiFlag("ENABLED") || !csiFlag("NUDGE_ENABLED")) throw new CsiError("FEATURE_DISABLED");
}
/** Internal channels only: team messaging to the User's person id, or a pager page to its extension. */
function snapshotChannels(extension: DirectoryUser, personId: string | null): NudgeChannel[] {
  const channels: NudgeChannel[] = [];
  if (personId) channels.push("team_messaging");
  if (extension.extension_number && /^\d{1,7}$/.test(extension.extension_number)) channels.push("pager");
  return channels;
}
function isCurrentReviewedSalesRep(link: { rc_account_id: string; status: string; role_kind: string; effective_to?: Date | null; effective_from: Date; reviewed_by?: string | null; reviewed_at?: Date | null }, account: string, now: Date) {
  return link.rc_account_id === account && link.status === "reviewed" && link.role_kind === "sales_rep" &&
    (link.effective_to ?? null) === null && link.effective_from <= now && Boolean(link.reviewed_by && link.reviewed_at && link.reviewed_at <= now);
}
async function optionalCurrentReviewedLink(account: string, extensionId: string, now: Date, session?: ClientSession) {
  const resolved = await resolveRepIdentities(account, [extensionId], now, session);
  const identity = resolved.resolutions[0];
  if (identity?.status !== "reviewed" || !identity.link_id) return null;
  const link = await getRepIdentityLinkModel().findById(identity.link_id).session(session ?? null).lean();
  if (!link || identity.agent_id !== String(link.agent_id) || link.rc_extension_id !== extensionId || !isCurrentReviewedSalesRep(link, account, now)) return null;
  return link;
}
/**
 * RingCentral Accounts message eligibility: an Enabled directory User of the configured account,
 * optionally through its current reviewed Rep Identity Link, by an internal channel the User has
 * and the link allows. The body is the Owner's own text; no customer, record or phone is involved.
 */
export async function checkNudge(command: NudgeCommand, now: Date, session?: ClientSession) {
  assertNudgesEnabled();
  const config = csiNudgeConfiguration(), policy = await resolvePolicy(session);
  if (!policy.enabled_capabilities.includes("nudges")) throw new CsiError("FEATURE_DISABLED");
  const { nudge } = command;
  if (!config.account || nudge.rc_account_id !== config.account) throw new CsiError("IDENTITY_BLOCKED");
  const directory = await loadRepDirectory(config.account, session, false);
  const extension = directory.snapshot?.extensions.find(e => e.id === nudge.rc_extension_id);
  if (directory.evidence.status !== "stored" || !extension || extension.type !== "User" || extension.status !== "Enabled") throw new CsiError("IDENTITY_BLOCKED");
  let link = null as Awaited<ReturnType<typeof optionalCurrentReviewedLink>>;
  if (nudge.rep_identity_link_id) {
    if (command.expected_rep_revision === undefined) throw new CsiError("INVALID_INPUT");
    link = await getRepIdentityLinkModel().findById(nudge.rep_identity_link_id).session(session ?? null).lean();
    if (!link) throw new CsiError("INVALID_INPUT");
    if (link.revision !== command.expected_rep_revision) throw new CsiError("REVISION_CONFLICT");
    if (link.rc_extension_id !== nudge.rc_extension_id || !isCurrentReviewedSalesRep(link, config.account, now)) throw new CsiError("IDENTITY_BLOCKED");
  } else {
    if (command.expected_rep_revision !== undefined) throw new CsiError("INVALID_INPUT");
    link = await optionalCurrentReviewedLink(config.account, nudge.rc_extension_id, now, session);
  }
  const storedPerson = link?.rc_team_messaging_person_id ?? null;
  let channels = snapshotChannels(extension, storedPerson).filter(channel => config.channels[channel]);
  if (link) channels = channels.filter(channel => link.nudge_channels_allowed.includes(channel));
  if (!channels.includes(nudge.channel) || !config.senderExtension || !config.senderPerson || config.senderExtension === extension.id) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  const url = z.url().safeParse(config.recordBaseUrl);
  if (!url.success || new URL(url.data).protocol !== "https:" || new URL(url.data).username || new URL(url.data).password) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  const recipient: NudgeRecipient = { account: config.account, extension: extension.id, person: storedPerson,
    senderExtension: config.senderExtension, senderExtensionNumber: config.senderExtensionNumber, senderPerson: config.senderPerson, senderDid: config.senderDid };
  const pager = extension.extension_number && /^\d{1,7}$/.test(extension.extension_number) ? extension.extension_number : null;
  if (nudge.channel === "pager" && (!channels.includes("pager") || !pager || !/^\d{1,7}$/.test(config.senderExtensionNumber))) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  if (nudge.channel === "team_messaging" && !storedPerson) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  const body = renderNudgeTemplate(nudge);
  return { link, extension, recipient, destination: nudge.channel === "pager" ? pager! : storedPerson ?? "", pager, body, channels, config, policy };
}
