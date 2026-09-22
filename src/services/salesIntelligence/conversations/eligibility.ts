import type { ClientSession, InferSchemaType } from "mongoose";
import { SALES_INTELLIGENCE_POLICY_VERSION } from "../../../config/domain/salesIntelligence";
import { CallInteractionSchema } from "../../../models/CallInteraction";
import { getContactNumberModel } from "../../../models/ContactNumber";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { resolveRepIdentities } from "../repIdentity/resolve";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import { assertTrustedActor, type CsiActor } from "../auth";
import { attachmentPolicyInput } from "../attachment/store";
import { resolveAtInteraction, type Attachment } from "../attachment/suggest";
import { exactEvidence } from "../attachment/sources";

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
  const policyEdges: Attachment[] = [];
  const missingInputs: string[] = [];
  const eligibleAttachments = attachments.filter(a => a.state !== "rejected");
  const formLeads = await getFormLeadModel().find({ _id: { $in: eligibleAttachments.filter(a => a.lead_ref.model === "FormLead").map(a => a.lead_ref.id) } })
    .select({ _id: 1 }).session(session).lean();
  const callLeads = await getCallLeadModel().find({ _id: { $in: eligibleAttachments.filter(a => a.lead_ref.model === "CallLead").map(a => a.lead_ref.id) } })
    .select({ _id: 1, ringcentral: 1 }).session(session).lean();
  const forms = new Map(formLeads.map(lead => [String(lead._id), lead]));
  const calls = new Map(callLeads.map(lead => [String(lead._id), lead]));
  for (const attachment of eligibleAttachments) {
    const ref = attachment.lead_ref;
    const lead = ref.model === "FormLead"
      ? forms.get(String(ref.id)) : calls.get(String(ref.id));
    if (!lead) { missingInputs.push("lead_reference_missing"); continue; }
    const edge = attachmentPolicyInput(attachment);
    // Read-only compatibility for pre-CSI-05 exact evidence. New writes always pin account/identity.
    const rc = "ringcentral" in lead ? lead.ringcentral : null;
    for (const e of edge.evidence) {
      if (!["call_lead_ringcentral_identity", "ringcentral_call_adoption"].includes(e.source) || e.identity_value) continue;
      const kind = (["telephony_session_id", "session_id", "call_log_id"] as const).find(k => rc?.[k] &&
        (k === "call_log_id" ? interaction.call_log_ids.includes(rc[k]!) : interaction[k] === rc[k]));
      if (kind && rc) {
        const scoped = await exactEvidence(lead, ref.model, session);
        if (scoped.some(s => s.evidence.provider_account_id === interaction.provider_account_id &&
          s.evidence.identity_kind === kind && s.evidence.identity_value === rc[kind])) {
          e.identity_kind = kind; e.identity_value = rc[kind]!; e.provider_account_id = interaction.provider_account_id;
        }
      }
    }
    policyEdges.push(edge);
  }
  if (!attachments.length) missingInputs.push("csi05_attachment_context");
  const attribution = resolveAtInteraction(policyEdges, { id: "_id" in interaction ? String(interaction._id) : "",
    provider_account_id: interaction.provider_account_id, started_at: interaction.started_at,
    telephony_session_id: interaction.telephony_session_id, session_id: interaction.session_id, call_log_ids: interaction.call_log_ids });
  const leads = attribution.applicable_leads;
  const review = number ? await getOutreachRecordModel().exists({
    "subject.kind": "number_review", "subject.contact_number_id": number._id, trigger_kind: "owner_open",
  }).session(session) : null;
  const extensions = interaction.parties.filter(p => p.direction === "Outbound" && ["user", "unknown"].includes(p.role))
    .map(p => p.extension_id).filter((id): id is string => Boolean(id));
  const links = interaction.direction === "Outbound" ? (await resolveRepIdentities(interaction.provider_account_id, extensions, interaction.started_at, session)).agent_ids : [];
  if (interaction.direction === "Outbound" && !links.length) missingInputs.push("csi10_reviewed_rep_mapping");
  return {
    direction: interaction.direction,
    company: ["company_did", "extension"].includes(interaction.external_endpoint_kind ?? "") || number?.classification === "company",
    nonCustomer: number?.classification === "non_customer",
    leads, ambiguous: ["ambiguous_attachment", "competing_attached"].includes(attribution.blocked_reason ?? ""), ownerNumberReview: Boolean(review),
    mappedSalesInbound: Boolean(interaction.inbound_route_id), reviewedRepOutbound: links.length > 0, missingInputs,
  };
}
