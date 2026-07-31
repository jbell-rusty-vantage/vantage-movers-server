import { type ClientSession } from "mongoose";
import type { LeadModelName } from "../../config/domain";
import { FormLead } from "../../models/FormLead";
import { CallLead } from "../../models/CallLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import { resolveRequiredLocation, deriveFormLeadLocal, resolveOptionalLocation } from "../leads";
import {
  findDuplicateFormLeadMatch,
  hasFormFillForCallLead,
  markMatchingCallLeadsWithFormFill,
} from "../leads/duplicateLead.service";
import { normalizeLeadName } from "../leads/leadName.service";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";
import {
  recordMissingLeadCplRate,
  resolveLeadCplSnapshot,
} from "../leads/leadCplResolution";
import {
  claimAvailableLeadForBooking,
  clearBookingFromLead,
  mirrorBookingToLead,
} from "../bookings";
import { type FullSheetSyncJob } from "../sheetSync";
import { getLinkedLead } from "../leads";
import { normalizePhoneNumberForStorage } from "../../utils/phone";
import { V1ServiceError } from "../v1ServiceError";
import type {
  CreateReconciliationCallLeadInput,
  CreateReconciliationFormLeadInput,
} from "../../validation/v1.validation";
import type { PreparedEmployeeBookingSubmission } from "./types";
import { toObjectId } from "../../utils/objectId";

type SourceResolutionChoice =
  | "preserve_lead_source"
  | "apply_submission_source"
  | undefined;

export async function attachLeadToEmployeeBooking(args: {
  booking: any;
  prepared: PreparedEmployeeBookingSubmission;
  leadModel: LeadModelName;
  leadId: string;
  operation:
    | "booking_reconciliation.attach_existing"
    | "booking_reconciliation.create_and_attach"
    | "booking_reconciliation.reassign"
    | "booking_reconciliation.auto_attach_delayed";
  sourceResolution?: SourceResolutionChoice;
  session?: ClientSession;
}): Promise<FullSheetSyncJob> {
  const lead = await getLinkedLead(args.leadModel, args.leadId, args.session);
  if (args.sourceResolution === "apply_submission_source") {
    const resolution = await resolveLeadSourceAssignment({
      value: args.prepared.sourceAssignment.source_company,
      company_slug: args.prepared.sourceAssignment.source_company,
      granularity_key: args.prepared.sourceAssignment.source_granularity_key,
      channel: args.leadModel === "CallLead" ? "call" : "form",
      local: (lead.local as any) ?? args.prepared.local,
    });
    Object.assign(lead, resolution.assignment);
    Object.assign(
      lead,
      await resolveLeadCplSnapshot({
        sourceGranularityId: resolution.assignment.source_granularity_id
          ? String(resolution.assignment.source_granularity_id)
          : null,
        storedBusinessTimestamp: lead.timestamp,
        duplicate: args.leadModel === "CallLead" && lead.duplicate === true,
      }),
    );
  }

  const claimed = await claimAvailableLeadForBooking(
    lead,
    args.leadModel,
    args.booking._id,
    args.booking.over_2000,
    args.booking.over_4000,
    (lead.local as any) ?? args.prepared.local ?? args.booking.local,
    args.session,
  );
  if (!claimed) {
    throw new V1ServiceError(
      "Lead is no longer eligible for attachment; refresh the reconciliation case",
      409,
    );
  }

  args.booking.lead_ref = toObjectId(args.leadId);
  args.booking.lead_model = args.leadModel;
  args.booking.is_leadless_booking = false;
  args.booking.source =
    args.sourceResolution === "preserve_lead_source"
      ? sourceDisplayLabel(lead)
      : args.prepared.sourceDisplayLabel;
  args.booking.local = (lead.local as any) ?? args.prepared.local ?? args.booking.local;
  await args.booking.save({ session: args.session });
  await mirrorBookingToLead(
    lead,
    args.leadModel,
    args.booking._id,
    args.booking.over_2000,
    args.booking.over_4000,
    args.booking.local,
    undefined,
    args.session,
    true,
  );
  return {
    resource: "booking_chain",
    operation: args.operation,
    bookingId: args.booking._id.toString(),
  };
}

export async function createAndAttachReconciliationCallLead(args: {
  booking: any;
  prepared: PreparedEmployeeBookingSubmission;
  leadFields: CreateReconciliationCallLeadInput;
  session?: ClientSession;
}): Promise<{ leadId: string; job: FullSheetSyncJob; extraJobs: FullSheetSyncJob[] }> {
  const normalized = normalizeLeadName({
    name: args.leadFields.name ?? args.prepared.leadName,
    email: args.leadFields.email ?? args.prepared.email,
    phone_number: normalizePhoneNumberForStorage(
      args.leadFields.phone_number ?? args.prepared.phoneNumber,
    ),
    job_no: args.leadFields.job_no ?? args.prepared.jobNo,
  });
  const location = await resolveOptionalLocation(
    {},
    { workflow: "booking_reconciliation_create_call" },
  );
  const resolution = await resolveLeadSourceAssignment({
    value: args.prepared.sourceAssignment.source_company,
    company_slug: args.prepared.sourceAssignment.source_company,
    granularity_key: args.prepared.sourceAssignment.source_granularity_key,
    channel: "call",
    local: location.local ?? args.prepared.local,
  });
  const formFill = await hasFormFillForCallLead(
    {
      sourceCompany: resolution.assignment.source_company,
      leadSourceCompany: resolution.assignment.lead_source_company,
    },
    normalized.phone_number,
  );
  const timestamp = toFloridaTimestamp(new Date());
  const cplSnapshot = await resolveLeadCplSnapshot({
    sourceGranularityId: resolution.assignment.source_granularity_id
      ? String(resolution.assignment.source_granularity_id)
      : null,
    storedBusinessTimestamp: timestamp,
  });
  const created = new CallLead({
    ...normalized,
    ...location,
    ...resolution.assignment,
    local: location.local ?? args.prepared.local,
    form_fill: formFill,
    timestamp,
    ...cplSnapshot,
    created_on_unmatched: false,
  });
  await created.save({ session: args.session });
  if (created.cpl_resolution_status === "missing_rate") {
    await recordMissingLeadCplRate({
      leadModel: "CallLead",
      leadId: created._id.toString(),
      sourceCompany: String(resolution.assignment.source_company),
      sourceGranularityId: resolution.assignment.source_granularity_id
        ? String(resolution.assignment.source_granularity_id)
        : null,
      sourceGranularityKey: resolution.assignment.source_granularity_key,
    });
  }
  const job = await attachLeadToEmployeeBooking({
    booking: args.booking,
    prepared: args.prepared,
    leadModel: "CallLead",
    leadId: created._id.toString(),
    operation: "booking_reconciliation.create_and_attach",
    sourceResolution: "apply_submission_source",
    session: args.session,
  });
  return { leadId: created._id.toString(), job, extraJobs: [] };
}

export async function createAndAttachReconciliationFormLead(args: {
  booking: any;
  prepared: PreparedEmployeeBookingSubmission;
  leadFields: CreateReconciliationFormLeadInput;
  session?: ClientSession;
}): Promise<{ leadId: string; job: FullSheetSyncJob; extraJobs: FullSheetSyncJob[] }> {
  const normalized = normalizeLeadName({
    name: args.leadFields.name,
    email: args.leadFields.email ?? args.prepared.email,
    phone_number: normalizePhoneNumberForStorage(args.leadFields.phone_number),
    lid: args.leadFields.lid ?? args.prepared.lid,
    pickup_zip: args.leadFields.pickup_zip,
    destination_zip: args.leadFields.destination_zip,
    move_size: args.leadFields.move_size,
    move_date: args.leadFields.move_date,
    source_company: args.prepared.sourceAssignment.source_company,
    source_granularity_key: args.prepared.sourceAssignment.source_granularity_key,
  });
  const location = await resolveRequiredLocation(normalized as any, {
    workflow: "booking_reconciliation_create_form",
  });
  const local = deriveFormLeadLocal(location.pickup_state, location.delivery_state);
  const resolution = await resolveLeadSourceAssignment({
    value: args.prepared.sourceAssignment.source_company,
    company_slug: args.prepared.sourceAssignment.source_company,
    granularity_key: args.prepared.sourceAssignment.source_granularity_key,
    channel: "form",
    local,
  });
  const timestamp = toFloridaTimestamp(new Date());
  const duplicateMatch = await findDuplicateFormLeadMatch(
    {
      sourceCompany: resolution.assignment.source_company,
      leadSourceCompany: resolution.assignment.lead_source_company,
      sourceGranularityId: resolution.assignment.source_granularity_id,
    },
    normalized.phone_number,
    normalized.email,
    timestamp,
  );
  const cplSnapshot = await resolveLeadCplSnapshot({
    sourceGranularityId: resolution.assignment.source_granularity_id
      ? String(resolution.assignment.source_granularity_id)
      : null,
    storedBusinessTimestamp: timestamp,
  });
  const created = new FormLead({
    ...normalized,
    ...location,
    ...resolution.assignment,
    local,
    timestamp,
    ...cplSnapshot,
    duplicate: duplicateMatch.duplicate,
    post_to_granot: false,
  });
  await created.save({ session: args.session });
  if (created.cpl_resolution_status === "missing_rate") {
    await recordMissingLeadCplRate({
      leadModel: "FormLead",
      leadId: created._id.toString(),
      sourceCompany: String(resolution.assignment.source_company),
      sourceGranularityId: resolution.assignment.source_granularity_id
        ? String(resolution.assignment.source_granularity_id)
        : null,
      sourceGranularityKey: resolution.assignment.source_granularity_key,
    });
  }
  const formFillJobs = created.duplicate
    ? []
    : await markMatchingCallLeadsWithFormFill(
        {
          sourceCompany: resolution.assignment.source_company,
          leadSourceCompany: resolution.assignment.lead_source_company,
        },
        created.phone_number,
        created._id.toString(),
        args.session,
      );
  const job = await attachLeadToEmployeeBooking({
    booking: args.booking,
    prepared: args.prepared,
    leadModel: "FormLead",
    leadId: created._id.toString(),
    operation: "booking_reconciliation.create_and_attach",
    sourceResolution: "apply_submission_source",
    session: args.session,
  });
  return { leadId: created._id.toString(), job, extraJobs: formFillJobs };
}

export async function reassignEmployeeBookingLead(args: {
  booking: any;
  prepared: PreparedEmployeeBookingSubmission;
  nextLeadModel: LeadModelName;
  nextLeadId: string;
  sourceResolution?: SourceResolutionChoice;
  session?: ClientSession;
}): Promise<FullSheetSyncJob[]> {
  const jobs: FullSheetSyncJob[] = [];
  const previousLead =
    args.booking.lead_ref && args.booking.lead_model
      ? {
          model: args.booking.lead_model as LeadModelName,
          id: args.booking.lead_ref.toString(),
        }
      : undefined;

  // Claim and attach the replacement first. A failed claim throws and lets the
  // surrounding transaction preserve the existing attachment.
  const attachJob = await attachLeadToEmployeeBooking({
    booking: args.booking,
    prepared: args.prepared,
    leadModel: args.nextLeadModel,
    leadId: args.nextLeadId,
    operation: "booking_reconciliation.reassign",
    sourceResolution: args.sourceResolution,
    session: args.session,
  });

  if (previousLead) {
    await clearBookingFromLead(previousLead.model, previousLead.id, {
      session: args.session,
      syncAfterClear: false,
    });
    jobs.push({
      resource: "source_lead",
      operation: "booking_reconciliation.detach_old",
      leadModel: previousLead.model,
      leadId: previousLead.id,
    });
  }
  jobs.push(attachJob);
  return jobs;
}

function sourceDisplayLabel(lead: {
  crm_source_label_snapshot?: unknown;
  source_granularity_label_snapshot?: unknown;
  source_company_label_snapshot?: unknown;
  source_company?: unknown;
}): string {
  return [
    lead.crm_source_label_snapshot,
    lead.source_granularity_label_snapshot,
    lead.source_company_label_snapshot,
    lead.source_company,
  ].find((value) => typeof value === "string" && value.trim())
    ? String(
        [
          lead.crm_source_label_snapshot,
          lead.source_granularity_label_snapshot,
          lead.source_company_label_snapshot,
          lead.source_company,
        ].find((value) => typeof value === "string" && value.trim()),
      )
    : "unknown";
}
