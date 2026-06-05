import {
  getCplForSource,
  getSheetSyncMode,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { CallLead } from "../../models/CallLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import type {
  CreateCallLeadInput,
  UpdateCallLeadInput,
} from "../../validation/v1.validation";
import { ConflictError, NotFoundError } from "../errors";
import { deleteCallLeadFromSheets } from "../googleSheets.service";
import {
  buildTombstonePreviousTargets,
  enqueueSheetSyncTombstone,
  finalizeSheetSync,
  finalizeSheetSyncDelete,
  persistSheetSyncIntent,
  runSheetSyncWrite,
  type FullSheetSyncJob,
} from "../sheetSync";
// Compatibility imports from the v1 service facade. `deleteBookedLead` and
// `refreshAttachedBookingFromLead` still live there because the booking
// extraction (refactor plan 04) has not happened yet. They are only ever
// referenced inside function bodies, so the temporary circular dependency
// resolves correctly via ESM/CJS late binding.
import { deleteBookedLead, refreshAttachedBookingFromLead } from "../v1.service";
import { hasFormFillForCallLead } from "./duplicateLead.service";
import { normalizeLeadName, normalizeLeadNameUpdate } from "./leadName.service";
import { resolveOptionalLocation } from "./leadLocation.service";
import { parseSourceCompany } from "./leadSourceCompany";

export type CreateRingCentralCallLeadInput = {
  source_company: SourceCompany;
  phone_number: string;
  name?: string | null;
  duration?: number | null;
  start_time?: Date | null;
  end_time?: Date | null;
  timestamp?: Date | null;
  duplicate: boolean;
  ringcentral: {
    telephony_session_id?: string | null;
    session_id?: string | null;
    party_id?: string | null;
    call_log_id?: string | null;
    source_label?: string | null;
    ingestion_source: "webhook" | "call_log_sync" | "manual";
    qualification_reason?: string | null;
    answered_at?: Date | null;
    terminal_at?: Date | null;
    duration_seconds?: number | null;
  };
};

/**
 * Creates a real `call_leads` document from a qualified RingCentral call.
 *
 * Mirrors `createCallLead` (form-fill detection, Florida timestamp, sheet
 * sync scheduling) but carries RingCentral provenance and the duplicate flag.
 * Duplicates are still recorded for visibility but get `cpl = 0` so the owner
 * is never charged twice for the same caller/source. The unique sparse index
 * on `ringcentral.telephony_session_id` is the final guard against double
 * inserts across the webhook and cron paths.
 */
export async function createRingCentralCallLead(
  input: CreateRingCentralCallLeadInput,
) {
  const { source_company, duplicate } = input;
  const form_fill = await hasFormFillForCallLead(source_company, input.phone_number);
  const lead = await runSheetSyncWrite(async (session) => {
    const created = new CallLead({
      source_company,
      phone_number: input.phone_number,
      name: input.name ?? undefined,
      duration: input.duration ?? undefined,
      start_time: input.start_time ?? undefined,
      end_time: input.end_time ?? undefined,
      timestamp: toFloridaTimestamp(input.timestamp ?? new Date()),
      form_fill,
      duplicate,
      cpl: duplicate ? 0 : getCplForSource(source_company, undefined),
      ringcentral: {
        telephony_session_id: input.ringcentral.telephony_session_id ?? undefined,
        session_id: input.ringcentral.session_id ?? undefined,
        party_id: input.ringcentral.party_id ?? undefined,
        call_log_id: input.ringcentral.call_log_id ?? undefined,
        source_label: input.ringcentral.source_label ?? undefined,
        ingestion_source: input.ringcentral.ingestion_source,
        qualification_reason: input.ringcentral.qualification_reason ?? undefined,
        answered_at: input.ringcentral.answered_at ?? undefined,
        terminal_at: input.ringcentral.terminal_at ?? undefined,
        duration_seconds: input.ringcentral.duration_seconds ?? undefined,
      },
    });
    await created.save({ session });
    await persistSheetSyncIntent(callLeadCreateJob(created._id.toString()), session);
    return created;
  });

  await finalizeSheetSync(callLeadCreateJob(lead._id.toString()));
  return lead;
}

function callLeadCreateJob(leadId: string): FullSheetSyncJob {
  return {
    resource: "source_lead",
    operation: "call_lead.create",
    leadModel: "CallLead",
    leadId,
  };
}

export async function createCallLead(input: CreateCallLeadInput) {
  const normalizedInput = normalizeLeadName(input);
  const source_company = parseSourceCompany(normalizedInput.source_company);
  const location = await resolveOptionalLocation(normalizedInput);
  const local = location.local ?? normalizedInput.local;
  const form_fill = await hasFormFillForCallLead(source_company, normalizedInput.phone_number);
  const lead = await runSheetSyncWrite(async (session) => {
    const created = new CallLead({
      ...normalizedInput,
      ...location,
      source_company,
      local,
      form_fill,
      timestamp: toFloridaTimestamp(normalizedInput.timestamp),
      cpl: getCplForSource(source_company, local),
    });
    await created.save({ session });
    await persistSheetSyncIntent(callLeadCreateJob(created._id.toString()), session);
    return created;
  });

  await finalizeSheetSync(callLeadCreateJob(lead._id.toString()));
  return lead;
}

export async function updateCallLead(id: string, input: UpdateCallLeadInput) {
  const lead = await CallLead.findById(id);
  if (!lead) {
    throw new NotFoundError("Call lead not found", {
      metadata: { resource: "call_lead", id },
    });
  }

  const update = normalizeLeadNameUpdate({ ...input }, lead);
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

  const job = await runSheetSyncWrite(async (session) => {
    await lead.save({ session });
    const refreshJob = await refreshAttachedBookingFromLead(
      lead,
      "CallLead",
      "call_lead.update",
      session,
    );
    await persistSheetSyncIntent(refreshJob, session);
    return refreshJob;
  });
  await finalizeSheetSync(job);
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

  if (getSheetSyncMode() === "queued") {
    const previousTargets = buildTombstonePreviousTargets(lead.sheet_sync);
    await runSheetSyncWrite(async (session) => {
      await enqueueSheetSyncTombstone(
        {
          resource: "delete_source_lead",
          entityModel: "CallLead",
          entityId: id,
          operation: "delete_call_lead",
          tombstone: {
            mongo_id: id,
            source_company: lead.source_company,
            duplicate: lead.duplicate,
            previous_targets: previousTargets,
          },
        },
        { session, targetHints: previousTargets.map((target) => target.target) },
      );
      await lead.deleteOne({ session });
    });
    await finalizeSheetSyncDelete();
    return;
  }

  await deleteCallLeadFromSheets(lead);
  await lead.deleteOne();
}

function optionalValue<T>(value: T | null | undefined): T | undefined {
  return value === null ? undefined : value;
}
