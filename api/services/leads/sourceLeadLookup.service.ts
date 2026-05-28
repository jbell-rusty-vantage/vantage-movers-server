import type mongoose from "mongoose";
import type { LeadModelName } from "../../config/domain";
import { CallLead, type CallLeadDocument } from "../../models/CallLead";
import { FormLead, type FormLeadDocument } from "../../models/FormLead";
import { ConflictError, NotFoundError } from "../errors";

/**
 * Shared hydrated-document type for any form-or-call source lead. Exposed
 * here so booking, cancellation, mirror, and sheet-sync code can reuse it
 * without re-declaring the union.
 */
export type SourceLeadDocument = mongoose.HydratedDocument<FormLeadDocument | CallLeadDocument>;

/**
 * Looks up a source lead by model and id and throws a 404 `NotFoundError`
 * when it does not exist.
 *
 * This is the canonical lookup used by booking/cancellation mirror code and
 * by sheet-sync chain helpers.
 */
export async function getLinkedLead(
  leadModel: LeadModelName,
  leadId: string,
): Promise<SourceLeadDocument> {
  const lead =
    leadModel === "FormLead"
      ? await FormLead.findById(leadId)
      : await CallLead.findById(leadId);
  if (!lead) {
    throw new NotFoundError("Linked source lead not found", {
      metadata: { leadModel, leadId },
    });
  }

  return lead;
}

/**
 * Looks up a source lead by id without knowing its model in advance.
 *
 * Used by the cancellation flow when the caller supplies only `lead_id`.
 * Throws 409 when the same id matches both collections (model collision)
 * and 404 when it matches neither.
 */
export async function resolveSourceLeadById(
  leadId: string,
): Promise<{ lead: SourceLeadDocument; leadModel: LeadModelName }> {
  const [formLead, callLead] = await Promise.all([
    FormLead.findById(leadId),
    CallLead.findById(leadId),
  ]);
  if (formLead && callLead) {
    throw new ConflictError("Lead id matched both form and call leads", {
      metadata: { leadId },
    });
  }
  if (formLead) {
    return { lead: formLead, leadModel: "FormLead" };
  }
  if (callLead) {
    return { lead: callLead, leadModel: "CallLead" };
  }

  throw new NotFoundError("Source lead not found", { metadata: { leadId } });
}
