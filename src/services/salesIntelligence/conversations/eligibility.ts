import type { ClientSession, InferSchemaType } from "mongoose";
import { SALES_INTELLIGENCE_POLICY_VERSION } from "../../../config/domain/salesIntelligence";
import { CallInteractionSchema } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getRepIdentityLinkModel } from "../../../models/RepIdentityLink";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { assertTrustedActor, type CsiActor } from "../auth";

export type EligibilityInputs = {
  direction: string;
  company: boolean;
  nonCustomer: boolean;
  leads: Array<{ model: "FormLead" | "CallLead"; id: string }>;
  ambiguous: boolean;
  ownerNumberReview: boolean;
  mappedSalesInbound: boolean;
  reviewedRepOutbound: boolean;
  missingInputs: string[];
};
/** No duration, voicemail, sampling, contact restriction or closed-work gate. */
export function decideAnalysisEligibility(input: EligibilityInputs, now = new Date(),
  ownerException?: { actor: CsiActor; audit_ref: string }) {
  if (ownerException) {
    assertTrustedActor(ownerException.actor, "owner");
    if (!ownerException.audit_ref.trim()) throw new Error("owner_audit_required");
  }
  const ambiguous = input.ambiguous || input.leads.length > 1;
  const lead = !ambiguous && input.leads.length === 1 ? input.leads[0]! : null;
  const reasons: string[] = [];
  if (ownerException) reasons.push("owner_requested");
  else if (input.direction === "Internal" || input.company) reasons.push("internal_company");
  else if (input.nonCustomer) reasons.push("known_non_customer");
  else {
    if (lead) reasons.push(lead.model === "FormLead" ? "form_linked" : "call_linked");
    if (input.ownerNumberReview) reasons.push("number_review");
    if (input.direction === "Inbound" && input.mappedSalesInbound) reasons.push("mapped_sales_inbound");
    if (input.direction === "Outbound" && input.reviewedRepOutbound) reasons.push("reviewed_rep_outbound");
    if (ambiguous) reasons.push("ambiguous_lead_context");
  }
  const excluded = reasons.some(r => ["internal_company", "known_non_customer"].includes(r));
  const eligible = !excluded && reasons.length > 0;
  const undetermined = !excluded && !eligible && input.missingInputs.length > 0;
  return {
    eligible: undetermined ? null : eligible,
    status: undetermined ? "undetermined" as const : eligible ? "eligible" as const : "excluded" as const,
    scope: lead ? "lead" as const : "number" as const,
    reasons: reasons.length ? reasons : [undetermined ? "inputs_missing" : "no_sales_context"],
    missing_inputs: [...new Set(input.missingInputs)],
    decided_at: now,
    policy_version: SALES_INTELLIGENCE_POLICY_VERSION,
  };
}

export type CurrentInteraction = InferSchemaType<typeof CallInteractionSchema>;

/** Read existing CSI-05/10 evidence only. Absence is not a negative decision. */
export async function loadEligibilityInputs(interaction: CurrentInteraction, session: ClientSession): Promise<EligibilityInputs> {
  const number = interaction.contact_number_id
    ? await getContactNumberModel().findById(interaction.contact_number_id).session(session).lean() : null;
  const attachments = number ? await getNumberLeadAttachmentModel().find({ contact_number_id: number._id }).session(session).lean() : [];
  const applicable: Array<{ state: string; lead: EligibilityInputs["leads"][number] }> = [];
  const missingInputs: string[] = [];
  for (const attachment of attachments.filter(a => a.state !== "rejected")) {
    const ref = attachment.lead_ref;
    const lead = ref.model === "FormLead"
      ? await getFormLeadModel().findById(ref.id).select({ _id: 1 }).session(session).lean()
      : await getCallLeadModel().findById(ref.id).select({ _id: 1, ringcentral: 1 }).session(session).lean();
    if (!lead) { missingInputs.push("lead_reference_missing"); continue; }
    const rc = "ringcentral" in lead ? lead.ringcentral : null;
    const exact = attachment.evidence.some(e => ["call_lead_ringcentral_identity", "ringcentral_call_adoption"].includes(e.source));
    const identityMatches = Boolean(rc && (
      (interaction.telephony_session_id && rc.telephony_session_id === interaction.telephony_session_id) ||
      (interaction.session_id && rc.session_id === interaction.session_id) ||
      (rc.call_log_id && interaction.call_log_ids.includes(rc.call_log_id))
    ));
    const windows = attachment.evidence.filter(e => !["call_lead_ringcentral_identity", "ringcentral_call_adoption"].includes(e.source) && e.window_from && e.window_to);
    const inWindow = windows.some(e => e.window_from! <= interaction.started_at && e.window_to! >= interaction.started_at);
    if (!exact && !windows.length) missingInputs.push("csi05_attachment_event_scope");
    if ((exact && identityMatches) || inWindow) applicable.push({ state: attachment.state, lead: { model: ref.model, id: String(ref.id) } });
  }
  if (!attachments.length) missingInputs.push("csi05_attachment_context");
  const attached = applicable.filter(a => a.state === "attached");
  const selected = attached.length ? attached : applicable;
  const leads = selected.map(a => a.lead);
  const review = number ? await getOutreachRecordModel().exists({
    "subject.kind": "number_review", "subject.contact_number_id": number._id, trigger_kind: "owner_open",
  }).session(session) : null;
  const extensions = interaction.parties.filter(p => p.direction === "Outbound" && ["user", "unknown"].includes(p.role))
    .map(p => p.extension_id).filter((id): id is string => Boolean(id));
  const links = interaction.direction === "Outbound" ? await getRepIdentityLinkModel().find({
    rc_account_id: interaction.provider_account_id, rc_extension_id: { $in: extensions },
    status: "reviewed", role_kind: "sales_rep", effective_from: { $lte: interaction.started_at },
    $or: [{ effective_to: null }, { effective_to: { $gt: interaction.started_at } }],
  }).session(session).lean() : [];
  if (interaction.direction === "Outbound" && !links.length) missingInputs.push("csi10_reviewed_rep_mapping");
  return {
    direction: interaction.direction,
    company: ["company_did", "extension"].includes(interaction.external_endpoint_kind ?? "") || number?.classification === "company",
    nonCustomer: number?.classification === "non_customer",
    leads, ambiguous: selected.some(a => a.state === "ambiguous") || selected.length > 1, ownerNumberReview: Boolean(review),
    mappedSalesInbound: Boolean(interaction.inbound_route_id), reviewedRepOutbound: links.length > 0, missingInputs,
  };
}
