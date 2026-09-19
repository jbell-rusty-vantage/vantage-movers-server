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
export async function checkNudge(command: NudgeCommand, actor: CsiActor, now: Date, session?: ClientSession) {
  assertNudgesEnabled();
  const config = csiNudgeConfiguration(), policy = await resolvePolicy(session);
  if (!policy.enabled_capabilities.includes("nudges")) throw new CsiError("FEATURE_DISABLED");
  const { nudge } = command;
  const record = await getOutreachRecordModel().findById(nudge.outreach_record_id).session(session ?? null).lean();
  const link = await getRepIdentityLinkModel().findById(nudge.rep_identity_link_id).session(session ?? null).lean();
  if (!record || !link) throw new CsiError("INVALID_INPUT");
  if (record.revision !== command.expected_revision || link.revision !== command.expected_rep_revision) throw new CsiError("REVISION_CONFLICT");
  if (record.state === "closed") throw new CsiError("NUDGE_NOT_ACTIONABLE");
  if (!config.account || link.rc_account_id !== config.account || link.status !== "reviewed" || link.role_kind !== "sales_rep" ||
      link.effective_to !== null || link.effective_from > now || !link.reviewed_by || !link.reviewed_at || link.reviewed_at > now) throw new CsiError("IDENTITY_BLOCKED");
  const resolved = await resolveRepIdentities(config.account, [link.rc_extension_id], now, session);
  const identity = resolved.resolutions[0];
  if (identity?.status !== "reviewed" || identity.link_id !== String(link._id) || identity.agent_id !== String(link.agent_id)) throw new CsiError("IDENTITY_BLOCKED");
  const directory = await loadRepDirectory(config.account, session, false);
  const extension = directory.snapshot?.extensions.find(e => e.id === link.rc_extension_id);
  const agent = await Agent.findById(link.agent_id).session(session ?? null).lean();
  if (!agent?.active || directory.evidence.status !== "stored" || extension?.type !== "User" || extension.status !== "Enabled") throw new CsiError("IDENTITY_BLOCKED");
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
    const row = expected.target === "outreach" && expected.id === String(record._id) ? record : expected.target === "rep" && expected.id === String(link._id) ? link :
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
  const channels = (Object.keys(config.channels) as NudgeChannel[]).filter(c => config.channels[c] && link.nudge_channels_allowed.includes(c));
  if (!channels.includes(nudge.channel) || !config.senderExtension || !config.senderPerson || config.senderExtension === link.rc_extension_id) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  const url = z.url().safeParse(config.recordBaseUrl);
  if (!url.success || new URL(url.data).protocol !== "https:" || new URL(url.data).username || new URL(url.data).password) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  const recipient: NudgeRecipient = { account: config.account, extension: link.rc_extension_id, person: link.rc_team_messaging_person_id ?? null,
    senderExtension: config.senderExtension, senderExtensionNumber: config.senderExtensionNumber, senderPerson: config.senderPerson, senderDid: config.senderDid };
  // Directory direct numbers also participate in the guard for internal channels.
  for (const did of [...link.rc_direct_numbers, ...extension.direct_numbers]) guardDestination(did, customerNumbers);
  let destination = link.rc_team_messaging_person_id ?? "";
  if (nudge.channel === "team_messaging" && !destination) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
  if (nudge.channel === "sms_to_rep") {
    if (link.rc_direct_numbers.length !== 1) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
    destination = canonicalDestination(link.rc_direct_numbers[0]);
    if (!extension.direct_numbers.some(n => canonicalDestination(n) === destination)) throw new CsiError("IDENTITY_BLOCKED");
    canonicalDestination(config.senderDid);
    guardDestination(destination, customerNumbers);
  }
  const pager = link.rc_extension_number;
  if (nudge.channel === "pager" || nudge.allow_pager_fallback) {
    if (!channels.includes("pager") || !pager || !/^\d{1,7}$/.test(pager) || !/^\d{1,7}$/.test(config.senderExtensionNumber) || pager !== extension.extension_number || (nudge.allow_pager_fallback && nudge.channel !== "team_messaging")) throw new CsiError("NUDGE_CONFIGURATION_UNAVAILABLE");
    if (nudge.channel === "pager") destination = pager;
  }
  const recordUrl = new URL("/sales-intelligence", url.data); recordUrl.searchParams.set("record", String(record._id));
  const body = renderNudgeTemplate({ ...nudge, repName: agent.name, customerName, customerNumber: number.e164, reasons: facts.reasons,
    lastContact: record.last_meaningful_contact_at ?? null, source, recordUrl: recordUrl.toString(), ownerId: actor.id, customerNumbers });
  return { record, number, link, recipient, destination, pager, body, facts, channels, config, customerNumbers, policy };
}
