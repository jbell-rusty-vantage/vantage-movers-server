import {
  getCplForSource,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { FormLead } from "../../models/FormLead";
import { logger } from "../../logger";
import { toFloridaTimestamp } from "../../utils/easternTime";
import { generateLeadId } from "../../utils/ids";
import { normalizePhoneNumberForStorage } from "../../utils/phone";
import type {
  CreateFormLeadInput,
  UpdateFormLeadInput,
} from "../../validation/v1.validation";
import {
  buildCrmFormLeadPayload,
  submitFormLeadToCrm,
  type CrmSubmitResult,
} from "../crm";
import { ConflictError, NotFoundError } from "../errors";
import { deleteFormLeadFromSheets } from "../googleSheets.service";
import { scheduleFullSheetSyncProcess } from "../sheetSync";
// Compatibility imports from the v1 service facade. `deleteBookedLead` and
// `refreshAttachedBookingFromLead` still live there because the booking
// extraction (refactor plan 04) has not happened yet. They are only ever
// referenced inside function bodies, so the temporary circular dependency
// resolves correctly via ESM/CJS late binding.
import { deleteBookedLead, refreshAttachedBookingFromLead } from "../v1.service";
import {
  deriveFormLeadLocal,
  resolveRequiredLocation,
} from "./leadLocation.service";
import { parseSourceCompany } from "./leadSourceCompany";
import {
  isDuplicateFormLead,
  markMatchingCallLeadsWithFormFill,
} from "./duplicateLead.service";

export async function createFormLead(input: CreateFormLeadInput) {
  const { crm_company_label, post_to_granot, ...formLeadInput } = input;
  formLeadInput.phone_number = normalizePhoneNumberForStorage(formLeadInput.phone_number);
  const source_company = parseSourceCompany(formLeadInput.source_company);
  const location = await resolveRequiredLocation(formLeadInput);
  const local = deriveFormLeadLocal(location.pickup_state, location.delivery_state);
  const duplicate = await isDuplicateFormLead(
    source_company,
    formLeadInput.phone_number,
    formLeadInput.email,
  );
  const shouldPostToGranot = post_to_granot && !duplicate;
  const lead = await FormLead.create({
    ...formLeadInput,
    ...location,
    source_company,
    local,
    lid: formLeadInput.lid?.trim() || generateLeadId(),
    ref_no: formLeadInput.ref_no?.trim() || "not provided",
    timestamp: toFloridaTimestamp(formLeadInput.timestamp),
    move_date: formLeadInput.move_date ?? new Date(),
    cpl: getCplForSource(source_company, local),
    duplicate,
    post_to_granot: shouldPostToGranot,
  });

  const leadId = lead._id.toString();
  if (!lead.duplicate) {
    await markMatchingCallLeadsWithFormFill(source_company, lead.phone_number, leadId);
  }

  const crmResult: CrmSubmitResult = shouldPostToGranot
    ? await submitFormLeadToCrm(lead, { companyLabel: crm_company_label })
    : {
        ok: true,
        status: 0,
        responseText: "",
        payload: buildCrmFormLeadPayload(lead, crm_company_label),
      };

  if (!shouldPostToGranot) {
    logger.info({
      msg: "crm.form_lead.submit.skipped",
      leadId,
      companyLabel: crm_company_label,
      duplicate,
    });
  }

  scheduleFullSheetSyncProcess({
    resource: "source_lead",
    operation: "form_lead.create",
    leadModel: "FormLead",
    leadId,
  });

  logger.info({
    msg: "form_lead.sheet_sync.pending_response",
    leadId,
    email: lead.email,
    phone_number: lead.phone_number,
    crmSyncOk: crmResult.ok,
    crmStatus: crmResult.status,
    crmSkipped: !shouldPostToGranot,
    duplicate,
  });

  return {
    lead,
    sheet_sync_status: "pending",
    crm_sync_status: shouldPostToGranot ? (crmResult.ok ? "synced" : "failed") : "skipped",
    crm_company_label: crmResult.payload.label,
    crm_response: crmResult.responseText || crmResult.error || "",
  };
}

export async function updateFormLead(id: string, input: UpdateFormLeadInput) {
  const lead = await FormLead.findById(id);
  if (!lead) {
    throw new NotFoundError("Form lead not found", {
      metadata: { resource: "form_lead", id },
    });
  }

  const update = { ...input };
  if (input.source_company !== undefined) {
    update.source_company = parseSourceCompany(input.source_company);
  }
  if (input.phone_number !== undefined) {
    update.phone_number = normalizePhoneNumberForStorage(input.phone_number);
  }
  if (input.timestamp !== undefined) {
    update.timestamp = toFloridaTimestamp(input.timestamp);
  }
  Object.assign(lead, update);
  if (
    hasOwnInput(input, "pickup_zip") ||
    hasOwnInput(input, "destination_zip") ||
    hasOwnInput(input, "pickup_state") ||
    hasOwnInput(input, "delivery_state")
  ) {
    const location = await resolveRequiredLocation({
      pickup_zip: input.pickup_zip ?? lead.pickup_zip,
      destination_zip: input.destination_zip ?? lead.destination_zip,
      pickup_state: input.pickup_state ?? lead.pickup_state,
      delivery_state: input.delivery_state ?? lead.delivery_state,
    });
    lead.pickup_state = location.pickup_state;
    lead.delivery_state = location.delivery_state;
    lead.local = deriveFormLeadLocal(location.pickup_state, location.delivery_state);
  }
  lead.cpl = getCplForSource(lead.source_company as SourceCompany, lead.local as LocalType);
  await lead.save();
  const job = await refreshAttachedBookingFromLead(lead, "FormLead", "form_lead.update");
  scheduleFullSheetSyncProcess(job);
  return lead;
}

export async function findAllFormLeads() {
  return FormLead.find().sort({ createdAt: -1 }).limit(200);
}

export async function findFormLead(id: string) {
  const lead = await FormLead.findById(id).select(
    "_id ref_no quoted cubic_feet booked",
  );
  if (!lead) {
    throw new NotFoundError("Form lead not found", {
      metadata: { resource: "form_lead", id },
    });
  }

  return lead;
}

export async function deleteFormLead(id: string, cascade: boolean) {
  const lead = await FormLead.findById(id);
  if (!lead) {
    throw new NotFoundError("Form lead not found", {
      metadata: { resource: "form_lead", id },
    });
  }
  if (lead.booked && !cascade) {
    throw new ConflictError(
      "Form lead has a booking; pass cascade=true to delete dependents",
      {
        metadata: {
          resource: "form_lead",
          id,
          bookedLeadId: lead.booked.toString(),
        },
      },
    );
  }
  if (lead.booked && cascade) {
    await deleteBookedLead(lead.booked.toString(), true);
  }
  await deleteFormLeadFromSheets(lead);
  await lead.deleteOne();
}

function hasOwnInput<T extends object>(input: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}
