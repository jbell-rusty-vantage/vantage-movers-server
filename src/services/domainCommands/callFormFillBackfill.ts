import { getCallLeadModel } from "../../models/CallLead";
import { hasFormFillForCallLead } from "../leads/duplicateLead.service";
import { hasReportingEligibleCall } from "../leads/callLeadAdmission";
import { emitLeadChange } from "./leadChangeEmission";
import { executeCanonicalCommandWithPostCommit } from "./idempotency";
import { DomainRevisionConflictError, type CanonicalCommandContext } from "./types";
import { finalizeSheetSync, persistSheetSyncIntent, type FullSheetSyncJob } from "../sheetSync";

/** Owner-authorized one-time repair using precisely the live eligible Form rule. */
export async function repairCallFormFillForReporting(input: {
  lead_id: string;
  expected_revision: number;
  context: CanonicalCommandContext;
}) {
  if (input.context.provenance.origin !== "vantage_admin" ||
      !["owner", "admin"].includes(input.context.actor.actor_type)) {
    throw new Error("Form Fill reporting repair requires the authenticated owner/admin context");
  }
  return executeCanonicalCommandWithPostCommit({
    command_name: "repairCallFormFillForReporting",
    context: input.context,
    operation: async (tx) => {
      const lead = await getCallLeadModel().findById(input.lead_id).session(tx.session).exec();
      if (!lead || !hasReportingEligibleCall(lead)) {
        throw new Error("Trusted Call reporting admission required for Form Fill repair");
      }
      if (Number(lead.domain_revision ?? 0) !== input.expected_revision) throw new DomainRevisionConflictError();
      if (lead.form_fill === true) return { entity_refs: [{ model: "CallLead", id: input.lead_id }] };
      if (!await hasFormFillForCallLead({
        sourceCompany: lead.source_company,
        leadSourceCompany: lead.lead_source_company,
      }, lead.phone_number, tx.session)) {
        throw new Error("Eligible non-duplicate Form Lead proof changed since planning");
      }
      const before = lead.toObject() as Record<string, unknown>;
      lead.form_fill = true;
      await lead.save({ session: tx.session });
      await emitLeadChange({
        model: "CallLead", id: input.lead_id, before, paths: ["form_fill"],
        command_name: "repairCallFormFillForReporting", context: input.context,
        command_execution_id: tx.command_execution_id, session: tx.session, now: tx.now,
      });
      const job: FullSheetSyncJob = { resource: "source_lead", operation: "call_lead.form_fill.update", leadModel: "CallLead", leadId: input.lead_id };
      await persistSheetSyncIntent(job, tx.session);
      return { entity_refs: [{ model: "CallLead", id: input.lead_id }], pending: job };
    },
    finalize: finalizeSheetSync,
  });
}
