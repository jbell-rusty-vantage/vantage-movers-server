import {
  CALL_SHEET_HEADERS,
  getCplForSource,
  getSheetSyncMode,
  SHEET_TAB_NAMES,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { Agent } from "../../models/Agent";
import { CallLead } from "../../models/CallLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import type {
  CreateCallLeadInput,
  UpdateCallLeadInput,
} from "../../validation/v1.validation";
import { ConflictError, NotFoundError } from "../errors";
import { deleteCallLeadFromSheets } from "../googleSheets.service";
import { getLeadTargets } from "../googleSheets/targets";
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
import { parseSourceCompany, resolveLeadSourceAssignment } from "./leadSourceCompany";
import { recordOperationalEvent } from "../observability";

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
  const { resolution: sourceResolution, assignment: sourceAssignment } =
    await resolveLeadSourceAssignment({
      value: input.ringcentral.source_label ?? source_company,
      company_slug: source_company,
      channel: "call",
    });
  const form_fill = await hasFormFillForCallLead(
    {
      sourceCompany: source_company,
      leadSourceCompany: sourceAssignment.lead_source_company,
    },
    input.phone_number,
  );
  const lead = await runSheetSyncWrite(async (session) => {
    const created = new CallLead({
      ...sourceAssignment,
      phone_number: input.phone_number,
      name: input.name ?? undefined,
      duration: input.duration ?? undefined,
      start_time: input.start_time ?? undefined,
      end_time: input.end_time ?? undefined,
      timestamp: toFloridaTimestamp(input.timestamp ?? new Date()),
      form_fill,
      duplicate,
      cpl: duplicate ? 0 : sourceResolution.granularity.cpl,
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

  if (lead.form_fill) {
    await recordOperationalEvent({
      level: "info",
      eventKey: "lead.call.form_fill_detected",
      category: "lead",
      workflow: "ringcentral_call_lead_create",
      summary: "RingCentral call lead is a form fill.",
      leadIdentity: { name: lead.name ?? null, phone: lead.phone_number },
      sourceCompany: source_company,
      entity: { type: "call_lead", id: lead._id.toString() },
      details: { form_fill: true, duplicate },
    });
  }

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
  const location = await resolveOptionalLocation(normalizedInput, {
    workflow: "call_lead_create",
  });
  const local = location.local ?? normalizedInput.local;
  const { resolution: sourceResolution, assignment: sourceAssignment } =
    await resolveLeadSourceAssignment({
      value: normalizedInput.source_company,
      company_slug: normalizedInput.company_slug,
      granularity_key: normalizedInput.source_granularity_key,
      channel: "call",
      local,
      source_site: normalizedInput.source_company_site,
    });
  const source_company = sourceAssignment.source_company as SourceCompany;
  const form_fill = await hasFormFillForCallLead(
    {
      sourceCompany: source_company,
      leadSourceCompany: sourceAssignment.lead_source_company,
    },
    normalizedInput.phone_number,
  );
  const lead = await runSheetSyncWrite(async (session) => {
    const created = new CallLead({
      ...normalizedInput,
      ...location,
      ...sourceAssignment,
      local,
      form_fill,
      timestamp: toFloridaTimestamp(normalizedInput.timestamp),
      cpl: sourceResolution.granularity.cpl,
    });
    await created.save({ session });
    await persistSheetSyncIntent(callLeadCreateJob(created._id.toString()), session);
    return created;
  });

  await finalizeSheetSync(callLeadCreateJob(lead._id.toString()));

  const callLeadIdentity = { name: lead.name ?? null, phone: lead.phone_number };
  await recordOperationalEvent({
    level: "info",
    eventKey: "lead.call.created",
    category: "lead",
    workflow: "call_lead_create",
    summary: "Call lead created.",
    leadIdentity: callLeadIdentity,
    sourceCompany: source_company,
    entity: { type: "call_lead", id: lead._id.toString() },
    details: {
      form_fill,
      pickup_zip: lead.pickup_zip ?? null,
      delivery_zip: lead.delivery_zip ?? null,
      local: lead.local ?? null,
      cpl: lead.cpl,
    },
  });

  if (form_fill) {
    await recordOperationalEvent({
      level: "info",
      eventKey: "lead.call.form_fill_detected",
      category: "lead",
      workflow: "call_lead_create",
      summary: "Call lead is a form fill.",
      leadIdentity: callLeadIdentity,
      sourceCompany: source_company,
      entity: { type: "call_lead", id: lead._id.toString() },
      details: { form_fill: true },
    });
  }

  return lead;
}

export async function updateCallLead(id: string, input: UpdateCallLeadInput) {
  const lead = await CallLead.findById(id);
  if (!lead) {
    throw new NotFoundError("Call lead not found", {
      metadata: { resource: "call_lead", id },
    });
  }
  if (input.duplicate === true && lead.booked) {
    throw new ConflictError("Cannot mark a booked call lead as duplicate", {
      metadata: { resource: "call_lead", id, bookedLeadId: lead.booked.toString() },
    });
  }

  const update = normalizeLeadNameUpdate({ ...input }, lead);
  let sourceResolutionForUpdate:
    | Awaited<ReturnType<typeof resolveLeadSourceAssignment>>
    | undefined;
  const sourceAffectingInputChanged = hasCallLeadSourceAffectingInput(input);
  if (input.timestamp !== undefined) {
    update.timestamp = toFloridaTimestamp(input.timestamp);
  }
  Object.assign(lead, update);
  if (
    hasOwnInput(input, "pickup_zip") ||
    hasOwnInput(input, "delivery_zip") ||
    hasOwnInput(input, "pickup_state") ||
    hasOwnInput(input, "delivery_state") ||
    hasOwnInput(input, "local")
  ) {
    const location = await resolveOptionalLocation(
      {
        pickup_zip: optionalValue(input.pickup_zip ?? lead.pickup_zip),
        delivery_zip: optionalValue(input.delivery_zip ?? lead.delivery_zip),
        pickup_state: optionalValue(input.pickup_state ?? lead.pickup_state),
        delivery_state: optionalValue(input.delivery_state ?? lead.delivery_state),
        local: optionalValue(input.local ?? lead.local),
      },
      { workflow: "call_lead_update" },
    );
    lead.pickup_state = location.pickup_state;
    lead.delivery_state = location.delivery_state;
    lead.local = location.local ?? input.local ?? lead.local;
  }
  if (sourceAffectingInputChanged || !lead.lead_source_company) {
    sourceResolutionForUpdate = await resolveLeadSourceAssignment({
      value: input.source_company ?? lead.source_company,
      company_slug: input.company_slug ?? lead.source_company,
      granularity_key: input.source_granularity_key ?? lead.source_granularity_key,
      channel: "call",
      local: lead.local as LocalType | undefined,
      source_site: input.source_company_site ?? lead.source_company_site,
    });
    Object.assign(lead, sourceResolutionForUpdate.assignment);
  }
  lead.cpl = lead.duplicate
    ? 0
    : sourceResolutionForUpdate?.resolution.granularity.cpl ??
      (await getCplForSource(
          lead.source_company as SourceCompany,
          "call",
          lead.local as LocalType | undefined,
        ));

  if (input.receiver_agent !== undefined) {
    const agent = await Agent.findById(input.receiver_agent);
    if (!agent) {
      throw new NotFoundError("Agent not found", {
        metadata: { resource: "agent", id: input.receiver_agent },
      });
    }
    lead.receiver_agent = agent._id;
    lead.receiver_agent_name_snapshot = agent.name;
    lead.receiver_agent_source = input.receiver_agent_source ?? "manual";
    lead.receiver_agent_source_value = input.receiver_agent_source_value;
    lead.receiver_agent_set_at = new Date();
  }

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
    const previousTargets = buildCallLeadDeletePreviousTargets(lead);
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

function hasOwnInput<T extends object>(input: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function hasCallLeadSourceAffectingInput(input: UpdateCallLeadInput): boolean {
  return (
    hasOwnInput(input, "source_company") ||
    hasOwnInput(input, "company_slug") ||
    hasOwnInput(input, "source_granularity_key") ||
    hasOwnInput(input, "source_company_site") ||
    hasOwnInput(input, "pickup_zip") ||
    hasOwnInput(input, "delivery_zip") ||
    hasOwnInput(input, "pickup_state") ||
    hasOwnInput(input, "delivery_state") ||
    hasOwnInput(input, "local")
  );
}

type CallLeadDeleteTargetSource = {
  source_company: SourceCompany | string;
  sheet_sync?: Parameters<typeof buildTombstonePreviousTargets>[0];
};

export function buildCallLeadDeletePreviousTargets(lead: CallLeadDeleteTargetSource) {
  const byTarget = new Map<
    string,
    {
      target: string;
      spreadsheet_id: string;
      tab_name: string;
      row_number?: number;
    }
  >();

  for (const previous of buildTombstonePreviousTargets(lead.sheet_sync)) {
    byTarget.set(previous.target, previous);
  }

  for (const target of [
    ...getCallLeadDeleteFallbackTargets(lead.source_company, false),
    ...getCallLeadDeleteFallbackTargets(lead.source_company, true),
  ]) {
    if (byTarget.has(target.target)) {
      continue;
    }
    byTarget.set(target.target, {
      target: target.target,
      spreadsheet_id: target.spreadsheetId,
      tab_name: target.tabName,
    });
  }

  return [...byTarget.values()];
}

function getCallLeadDeleteFallbackTargets(
  sourceCompany: SourceCompany | string,
  duplicate: boolean,
) {
  const targetBase = duplicate
    ? {
        masterTarget: "master_duplicate_calls",
        sourceTarget: "source_duplicate_calls",
        tabName: SHEET_TAB_NAMES.duplicateCalls,
      }
    : {
        masterTarget: "master_calls",
        sourceTarget: "source_calls",
        tabName: SHEET_TAB_NAMES.calls,
      };

  return getLeadTargets(
    targetBase.masterTarget,
    targetBase.sourceTarget,
    sourceCompany,
    targetBase.tabName,
    CALL_SHEET_HEADERS,
  );
}
