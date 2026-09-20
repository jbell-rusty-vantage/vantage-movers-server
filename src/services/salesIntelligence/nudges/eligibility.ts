import type { ClientSession } from "mongoose";
import { z } from "zod";
import { csiFlag, csiNudgeConfiguration } from "../../../config/domain/salesIntelligence";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getOutreachFollowupModel } from "../../../models/OutreachFollowup";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getSalesIntelligenceContactRestrictionModel } from "../../../models/SalesIntelligenceContactRestriction";
import { getSalesIntelligenceReviewItemModel } from "../../../models/SalesIntelligenceReviewItem";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { getLeadMessageModel } from "../../../models/LeadMessage";
import { Agent } from "../../../models/Agent";
import { csiNudgeCommandSchema } from "../../../validation/v1/salesIntelligence";
import { CsiError, type CsiActor } from "../auth";
import { resolvePolicy } from "../policy";
import { resolveRepIdentities } from "../repIdentity/resolve";
import { loadRepDirectory } from "../repIdentity/propose";
import { derive } from "../outreach/derive";
import { stateWithActions, officialClosure } from "../outreach/transitions";
import { subjectKey } from "../outreach/types";
import { toE164 } from "../../numberActivity/phone";
import { renderNudgeTemplate } from "./templates";
import type { NudgeChannel, NudgeRecipient } from "./adapters";

export type NudgeCommand = z.infer<typeof csiNudgeCommandSchema>;
type DirectoryUser = { id: string; type: string; name?: string | null; status?: string | null; extension_number?: string | null; direct_numbers: string[] };
export function assertNudgesEnabled() {
  if (!csiFlag("ENABLED") || !csiFlag("NUDGE_ENABLED")) throw new CsiError("FEATURE_DISABLED");
}
export function canonicalDestination(value: unknown): string {
  if (typeof value !== "string" || !/^[+\d\s().-]+$/.test(value) || !toE164(value)) throw new CsiError("NUDGE_DESTINATION_EVIDENCE_INCOMPLETE");
  return toE164(value)!;
}
/** All stored Lead phone identities, including earlier snapshots, are safeguards, not attribution. */
export function collectCustomerPhones(value: unknown): string[] {
  if (!value || typeof value !== "object" || value instanceof Date) return [];
  const result: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (["phone", "phone_number", "normalized_phone_number"].includes(key) && child !== null && child !== undefined && child !== "") result.push(canonicalDestination(child));
    else if (typeof child === "object" && child !== null && !["_id", "target_phone_number"].includes(key)) result.push(...collectCustomerPhones(child));
  }
  return result;
}
export function guardDestination(destination: string, customers: readonly string[]) {
  if (customers.includes(canonicalDestination(destination))) throw new CsiError("NUDGE_DESTINATION_IS_CUSTOMER");
}
function snapshotChannels(extension: DirectoryUser, personId: string | null): NudgeChannel[] {
  const channels: NudgeChannel[] = [];
  if (personId) channels.push("team_messaging");
  if (extension.direct_numbers.length === 1) channels.push("sms_to_rep");
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
export async function checkNudge(command: NudgeCommand, actor: CsiActor, now: Date, session?: ClientSession) {
  assertNudgesEnabled();
  const config = csiNudgeConfiguration(), policy = await resolvePolicy(session);
  if (!policy.enabled_capabilities.includes("nudges")) throw new CsiError("FEATURE_DISABLED");
  const { nudge } = command;
  if (!config.account || nudge.rc_account_id !== config.account) throw new CsiError("IDENTITY_BLOCKED");
  if (!nudge.outreach_record_id) {
    if (nudge.purpose !== "review_context" || !nudge.body || nudge.channel === "sms_to_rep" || nudge.followup_id) throw new CsiError("INVALID_INPUT");
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
    const agent = link ? await Agent.findById(link.agent_id).session(session ?? null).lean() : null;
    const storedPerson = link?.rc_team_messaging_person_id ?? null;
    let channels = snapshotChannels(extension, storedPerson).filter(channel => config.channels[channel] && channel !== "sms_to_rep");
    if (link) channels = channels.filter(channel => link.nudge_channels_allowed.includes(channel));
    if (!channels.includes(nudge.channel) || !config.senderExtension || !config.senderPerson || config.senderExtension === extension.id) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
    const url = z.url().safeParse(config.recordBaseUrl);
    if (!url.success || new URL(url.data).protocol !== "https:" || new URL(url.data).username || new URL(url.data).password) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
    const recipient: NudgeRecipient = { account: config.account, extension: extension.id, person: storedPerson,
      senderExtension: config.senderExtension, senderExtensionNumber: config.senderExtensionNumber, senderPerson: config.senderPerson, senderDid: config.senderDid };
    const pager = extension.extension_number && /^\d{1,7}$/.test(extension.extension_number) ? extension.extension_number : null;
    if (nudge.channel === "pager" && (!channels.includes("pager") || !pager || !/^\d{1,7}$/.test(config.senderExtensionNumber))) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
    if (nudge.channel === "team_messaging" && !storedPerson) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
    const recordUrl = new URL("/sales-intelligence", url.data); recordUrl.searchParams.set("view", "reps");
    const repName = link && agent?.name ? agent.name : (extension.name ?? "User");
    const body = renderNudgeTemplate({ ...nudge, repName, customerName: null, customerNumber: null, reasons: [], lastContact: null, source: null,
      recordUrl: recordUrl.toString(), ownerId: actor.id, customerNumbers: [] });
    return { record: null, number: null, link, extension, recipient, destination: nudge.channel === "pager" ? pager! : storedPerson ?? "",
      pager, body, facts: { overdue: false, reasons: [], actions: [], call_blockers: [] }, channels, config, customerNumbers: [], policy };
  }
  const record = await getOutreachRecordModel().findById(nudge.outreach_record_id).session(session ?? null).lean();
  if (!record) throw new CsiError("INVALID_INPUT");
  if (record.revision !== command.expected_revision) throw new CsiError("REVISION_CONFLICT");
  if (record.state === "closed") throw new CsiError("NUDGE_NOT_ACTIONABLE");
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
  const agent = link ? await Agent.findById(link.agent_id).session(session ?? null).lean() : null;
  const number = await getContactNumberModel().findById(record.primary_contact_number_id).session(session ?? null).lean();
  if (!number) throw new CsiError("NUDGE_DESTINATION_EVIDENCE_INCOMPLETE");
  const customerNumbers = [canonicalDestination(number.e164)];
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: number._id }).limit(501).session(session ?? null).lean();
  if (edges.length > 500) throw new CsiError("NUDGE_DESTINATION_EVIDENCE_INCOMPLETE");
  const refs = new Map(edges.map(e => [`${e.lead_ref.model}:${e.lead_ref.id}`, e.lead_ref]));
  if (record.subject.kind === "lead" && record.subject.model && record.subject.id) refs.set(`${record.subject.model}:${record.subject.id}`, { model: record.subject.model, id: record.subject.id });
  let customerName: string | null = null, source: string | null = null;
  for (const ref of refs.values()) {
    const lead = ref.model === "FormLead" ? await getFormLeadModel().findById(ref.id).session(session ?? null).lean() : await getCallLeadModel().findById(ref.id).session(session ?? null).lean();
    if (!lead) throw new CsiError("NUDGE_DESTINATION_EVIDENCE_INCOMPLETE");
    const phones = collectCustomerPhones(lead);
    if (!phones.length) throw new CsiError("NUDGE_DESTINATION_EVIDENCE_INCOMPLETE");
    customerNumbers.push(...phones);
    if (String(ref.id) === String(record.subject.id) && ref.model === record.subject.model) {
      if (officialClosure(lead)) throw new CsiError("NUDGE_NOT_ACTIONABLE");
      customerName = lead.name ?? null; source = lead.source_company_label_snapshot ?? null;
    }
    const messages = await getLeadMessageModel().find({ $or: [{ "lead_ref.model": ref.model, "lead_ref.id": ref.id },
      ...(ref.model === "FormLead" ? [{ form_lead: ref.id }] : [])] }).select({ to: 1 }).limit(1001).session(session ?? null).lean();
    if (messages.length > 1000) throw new CsiError("NUDGE_DESTINATION_EVIDENCE_INCOMPLETE");
    for (const message of messages) customerNumbers.push(canonicalDestination(message.to));
  }
  const actions = await getOutreachFollowupModel().find({ outreach_record_id: record._id }).session(session ?? null).lean();
  const restrictions = await getSalesIntelligenceContactRestrictionModel().find({ contact_number_id: number._id }).session(session ?? null).lean();
  const reviews = await getSalesIntelligenceReviewItemModel().find({ subject_key: { $in: [subjectKey(record.subject), `number:${number._id}`] } }).session(session ?? null).lean();
  for (const expected of command.expected_revisions ?? []) {
    const row = expected.target === "outreach" && expected.id === String(record._id) ? record : expected.target === "rep" && link && expected.id === String(link._id) ? link :
      expected.target === "number" && expected.id === String(number._id) ? number : expected.target === "followup" ? actions.find(a => String(a._id) === expected.id) :
      expected.target === "restriction" ? restrictions.find(r => String(r._id) === expected.id) : expected.target === "review" ? reviews.find(r => String(r._id) === expected.id) :
      expected.target === "attachment" ? edges.find(e => String(e._id) === expected.id) : null;
    if (!row || row.revision !== expected.revision) throw new CsiError("REVISION_CONFLICT");
  }
  const facts = derive({ ...record, state: stateWithActions(record, actions, now) }, { now, policy, staffing: policy, followups: actions, restrictions, reviewItems: reviews,
    coverage: {}, suppressed: number.contact_eligibility.state === "suppressed" });
  if (nudge.purpose === "call_suggestion") {
    const eligible = number.contact_eligibility.state === "allowed" || (number.contact_eligibility.state === "temporarily_blocked" && number.contact_eligibility.until && number.contact_eligibility.until <= now);
    if (!eligible || facts.call_blockers.length || edges.some(e => e.state === "ambiguous")) throw new CsiError("CONTACT_RESTRICTED");
    if (nudge.followup_id ? !facts.actions.some(a => a.id === nudge.followup_id && a.call_allowed) :
      !facts.actions.some(a => a.call_allowed) && !(record.state === "unworked" && !actions.some(a => a.status === "open"))) throw new CsiError("NUDGE_NOT_ACTIONABLE");
  } else if (nudge.followup_id && !actions.some(a => String(a._id) === nudge.followup_id && a.status === "open")) throw new CsiError("NUDGE_NOT_ACTIONABLE");
  const storedPerson = link?.rc_team_messaging_person_id ?? null;
  let channels = snapshotChannels(extension, storedPerson).filter(channel => config.channels[channel]);
  if (link) channels = channels.filter(channel => link.nudge_channels_allowed.includes(channel));
  if (!channels.includes(nudge.channel) || !config.senderExtension || !config.senderPerson || config.senderExtension === extension.id) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  const url = z.url().safeParse(config.recordBaseUrl);
  if (!url.success || new URL(url.data).protocol !== "https:" || new URL(url.data).username || new URL(url.data).password) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  const recipient: NudgeRecipient = { account: config.account, extension: extension.id, person: storedPerson,
    senderExtension: config.senderExtension, senderExtensionNumber: config.senderExtensionNumber, senderPerson: config.senderPerson, senderDid: config.senderDid };
  for (const did of [...(link?.rc_direct_numbers ?? []), ...extension.direct_numbers]) guardDestination(did, customerNumbers);
  let destination = storedPerson ?? "";
  if (nudge.channel === "team_messaging" && !destination) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  if (nudge.channel === "sms_to_rep") {
    if (extension.direct_numbers.length !== 1) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
    destination = canonicalDestination(extension.direct_numbers[0]);
    canonicalDestination(config.senderDid);
    guardDestination(destination, customerNumbers);
  }
  const pager = extension.extension_number && /^\d{1,7}$/.test(extension.extension_number) ? extension.extension_number : null;
  if (nudge.channel === "pager" || nudge.allow_pager_fallback) {
    if (!channels.includes("pager") || !pager || !/^\d{1,7}$/.test(config.senderExtensionNumber) || (nudge.allow_pager_fallback && nudge.channel !== "team_messaging")) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
    if (nudge.channel === "pager") destination = pager;
  }
  const recordUrl = new URL("/sales-intelligence", url.data); recordUrl.searchParams.set("record", String(record._id));
  const repName = link && agent?.name ? agent.name : (extension.name ?? "User");
  const body = renderNudgeTemplate({ ...nudge, repName, customerName, customerNumber: number.e164, reasons: facts.reasons,
    lastContact: record.last_meaningful_contact_at ?? null, source, recordUrl: recordUrl.toString(), ownerId: actor.id, customerNumbers });
  return { record, number, link, extension, recipient, destination, pager, body, facts, channels, config, customerNumbers, policy };
}
