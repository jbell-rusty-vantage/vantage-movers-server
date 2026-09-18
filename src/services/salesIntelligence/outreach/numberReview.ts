import { getContactNumberModel } from "../../../models/ContactNumber";
import { getOutreachRecordModel } from "../../../models/OutreachRecord";
import { getNumberLeadAttachmentModel } from "../../../models/NumberLeadAttachment";
import { CsiError, assertTrustedActor } from "../auth";
import { loadLead } from "../attachment/sources";
import { lockNumber, attachmentPolicyInput } from "../attachment/store";
import { resolveAtInteraction, type InteractionIdentity } from "../attachment/suggest";
import { resolvePolicy } from "../policy";
import { type CsiTransactionContext } from "../transactions";
import { officialClosure } from "./transitions";
import { refreshRecord } from "./store";

/** Owner opening and D's clear sales commitment share eligibility; neither can escape related closed/ambiguous Leads. */
export async function ensureNumberReview(numberId: string, trigger: "owner_open" | "clear_sales_commitment", context: CsiTransactionContext, interaction?: InteractionIdentity) {
  assertTrustedActor(context.actor);
  if (!context.session.inTransaction()) throw new CsiError("INVALID_INPUT");
  const number = await getContactNumberModel().findById(numberId).session(context.session);
  if (!number || number.kind !== "external" || ["company", "non_customer"].includes(number.classification) || number.contact_eligibility.state === "suppressed") throw new CsiError("ILLEGAL_TRANSITION");
  await lockNumber(numberId, context.session);
  const edges = await getNumberLeadAttachmentModel().find({ contact_number_id: numberId, state: { $ne: "rejected" } }).session(context.session).lean();
  const at = interaction ?? { id: "", provider_account_id: "", call_log_ids: [], started_at: context.now };
  const attribution = resolveAtInteraction(edges.map(attachmentPolicyInput), at);
  if (attribution.blocked_reason !== "unlinked") throw new CsiError("IDENTITY_BLOCKED");
  for (const edge of edges) {
    const lead = await loadLead({ model: edge.lead_ref.model, id: String(edge.lead_ref.id) }, context.session);
    if (lead && officialClosure(lead)) throw new CsiError("OFFICIAL_STATE_BLOCKS_REOPEN");
    if (await getOutreachRecordModel().exists({ "subject.model": edge.lead_ref.model, "subject.id": edge.lead_ref.id, state: "closed" }).session(context.session)) throw new CsiError("ILLEGAL_TRANSITION");
  }
  let record = await getOutreachRecordModel().findOne({ "subject.kind": "number_review", "subject.contact_number_id": numberId }).session(context.session);
  if (record?.state === "closed") throw new CsiError("ILLEGAL_TRANSITION");
  if (!record) {
    const policy = await resolvePolicy();
    record = new (getOutreachRecordModel())({ subject: { kind: "number_review", contact_number_id: numberId }, primary_contact_number_id: numberId,
      trigger_kind: trigger, trigger_at: at.started_at, policy_version: policy.version });
    await refreshRecord(record, context, "number_review_opened", null);
  }
  return record;
}
