import { getCplForSource, type LocalType, type SourceCompany } from "../../config/domain";
import { CallLead } from "../../models/CallLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import type {
  CreateCallLeadInput,
  UpdateCallLeadInput,
} from "../../validation/v1.validation";
import { ConflictError, NotFoundError } from "../errors";
import { deleteCallLeadFromSheets } from "../googleSheets.service";
import { scheduleFullSheetSyncProcess } from "../sheetSync";
// Compatibility imports from the v1 service facade. `deleteBookedLead` and
// `refreshAttachedBookingFromLead` still live there because the booking
// extraction (refactor plan 04) has not happened yet. They are only ever
// referenced inside function bodies, so the temporary circular dependency
// resolves correctly via ESM/CJS late binding.
import { deleteBookedLead, refreshAttachedBookingFromLead } from "../v1.service";
import { hasFormFillForCallLead } from "./duplicateLead.service";
import { resolveOptionalLocation } from "./leadLocation.service";
import { parseSourceCompany } from "./leadSourceCompany";

export async function createCallLead(input: CreateCallLeadInput) {
  const source_company = parseSourceCompany(input.source_company);
  const location = await resolveOptionalLocation(input);
  const local = location.local ?? input.local;
  const form_fill = await hasFormFillForCallLead(source_company, input.phone_number);
  const lead = await CallLead.create({
    ...input,
    ...location,
    source_company,
    local,
    form_fill,
    timestamp: toFloridaTimestamp(input.timestamp),
    cpl: getCplForSource(source_company, local),
  });

  scheduleFullSheetSyncProcess({
    resource: "source_lead",
    operation: "call_lead.create",
    leadModel: "CallLead",
    leadId: lead._id.toString(),
  });
  return lead;
}

export async function updateCallLead(id: string, input: UpdateCallLeadInput) {
  const lead = await CallLead.findById(id);
  if (!lead) {
    throw new NotFoundError("Call lead not found", {
      metadata: { resource: "call_lead", id },
    });
  }

  const update = { ...input };
  if (input.source_company !== undefined) {
    update.source_company = parseSourceCompany(input.source_company);
  }
  if (input.timestamp !== undefined) {
    update.timestamp = toFloridaTimestamp(input.timestamp);
  }
  Object.assign(lead, update);
  if (
    input.pickup_zip ||
    input.delivery_zip ||
    input.pickup_state ||
    input.delivery_state ||
    input.local
  ) {
    const location = await resolveOptionalLocation({
      pickup_zip: optionalValue(input.pickup_zip ?? lead.pickup_zip),
      delivery_zip: optionalValue(input.delivery_zip ?? lead.delivery_zip),
      pickup_state: optionalValue(input.pickup_state ?? lead.pickup_state),
      delivery_state: optionalValue(input.delivery_state ?? lead.delivery_state),
      local: optionalValue(input.local ?? lead.local),
    });
    lead.pickup_state = location.pickup_state;
    lead.delivery_state = location.delivery_state;
    lead.local = location.local ?? input.local ?? lead.local;
  }
  lead.cpl = getCplForSource(
    lead.source_company as SourceCompany,
    lead.local as LocalType | undefined,
  );
  await lead.save();
  const job = await refreshAttachedBookingFromLead(lead, "CallLead", "call_lead.update");
  scheduleFullSheetSyncProcess(job);
  return lead;
}

export async function findAllCallLeads() {
  return CallLead.find().sort({ createdAt: -1 }).limit(200);
}

export async function deleteCallLead(id: string, cascade: boolean) {
  const lead = await CallLead.findById(id);
  if (!lead) {
    throw new NotFoundError("Call lead not found", {
      metadata: { resource: "call_lead", id },
    });
  }
  if (lead.booked && !cascade) {
    throw new ConflictError(
      "Call lead has a booking; pass cascade=true to delete dependents",
      {
        metadata: {
          resource: "call_lead",
          id,
          bookedLeadId: lead.booked.toString(),
        },
      },
    );
  }
  if (lead.booked && cascade) {
    await deleteBookedLead(lead.booked.toString(), true);
  }
  await deleteCallLeadFromSheets(lead);
  await lead.deleteOne();
}

function optionalValue<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}
