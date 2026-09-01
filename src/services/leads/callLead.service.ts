import type { ClientSession } from "mongoose";
import {
  CALL_SHEET_HEADERS,
  getSheetSyncMode,
  SHEET_TAB_NAMES,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { CallLead } from "../../models/CallLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import type {
  CreateCallLeadInput,
  UpdateCallLeadInput,
} from "../../validation/v1.validation";
import {
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
} from "../domainCommands/entityChange";
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
import { toObjectId } from "../../utils/objectId";
// Compatibility imports from the v1 service facade. `deleteBookedLead` and
// `refreshAttachedBookingFromLead` still live there because the booking
// extraction (refactor plan 04) has not happened yet. They are only ever
// referenced inside function bodies, so the temporary circular dependency
// resolves correctly via ESM/CJS late binding.
import { deleteBookedLead, refreshAttachedBookingFromLead } from "../v1.service";
import { hasFormFillForCallLead } from "./duplicateLead.service";
import { normalizeLeadName, normalizeLeadNameUpdate } from "./leadName.service";
import {
  callLeadCreationProvenanceFields,
  omitForbiddenLeadLifecycleFields,
} from "./leadIngestionProvenance";
import type { CallLeadIngestionOrigin } from "../granotLifecycle/types";
import { resolveOptionalLocation } from "./leadLocation.service";
import { resolveLeadSourceAssignment } from "./leadSourceCompany";
import {
  recordMissingLeadCplRate,
  resolveLeadCplSnapshot,
} from "./leadCplResolution";
import { recordOperationalEvent } from "../observability";
import {
  getRegistryAgent,
  isRegistryError,
  type RingCentralRouteResolution,
} from "../operationsRegistry";

type CallLeadDocument = InstanceType<typeof CallLead>;
type CallLeadSession = { session?: ClientSession; now: Date };
type SourceAssignment = Awaited<
  ReturnType<typeof resolveLeadSourceAssignment>
>["assignment"];

export type CreateRingCentralCallLeadInput = {
  source_company: SourceCompany;
  source_resolution: RingCentralRouteResolution;
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
    route_id: string;
    route_assignment_id: string;
    target_phone_number: string;
  };
};

/**
 * Handoff from "the Call Lead is saved" to "tell the sheets and the owner."
 * Admin/sheet and RingCentral return the same bag.
 */
export type CallLeadIngestionInProgress = {
  lead: CallLeadDocument;
  job: FullSheetSyncJob;
  source_company: SourceCompany;
  sourceAssignment: SourceAssignment;
  form_fill: boolean;
};

// A phone call becomes a Call Lead.
// Admin / Best Relocation type it in. RingCentral promotes a qualified call.
// Later the owner may correct it, list recent ones, or remove it.

// ── 1a. Call Lead Ingestion — Admin / sheet ───────────────

export async function ingestCallLead(input: CreateCallLeadInput) {
  const pending = await runSheetSyncWrite((session) =>
    beginCallLeadIngestion(input, {
      session,
      now: new Date(),
      ingestion_origin: "vantage_admin",
    }),
  );
  return completeCallLeadIngestion(pending);
}

export async function beginCallLeadIngestion(
  input: CreateCallLeadInput,
  tx: CallLeadSession & { ingestion_origin: CallLeadIngestionOrigin },
): Promise<CallLeadIngestionInProgress> {
  const normalizedInput = normalizeTheCaller(input);
  const location = await locateTheMoveIfWeHaveZips(normalizedInput);
  const local = location.local ?? normalizedInput.local;
  const sourceAssignment = await assignTheSourceGranularity(
    normalizedInput,
    local,
  );
  const source_company = sourceAssignment.source_company as SourceCompany;
  const form_fill = await detectFormFill(
    {
      sourceCompany: source_company,
      leadSourceCompany: sourceAssignment.lead_source_company,
    },
    normalizedInput.phone_number,
  );
  const leadTimestamp = stampFloridaTime(normalizedInput.timestamp);
  const cplSnapshot = await priceTheLead(
    sourceAssignment.source_granularity_id
      ? String(sourceAssignment.source_granularity_id)
      : null,
    leadTimestamp,
  );
  const created = new CallLead({
    ...normalizedInput,
    ...location,
    ...sourceAssignment,
    local,
    form_fill,
    timestamp: leadTimestamp,
    ...cplSnapshot,
    ...rememberHowTheLeadArrived(tx.ingestion_origin, tx.now, {
      first_name: normalizedInput.first_name,
      last_name: normalizedInput.last_name,
      name: normalizedInput.name,
      phone_number: normalizedInput.phone_number,
      email: normalizedInput.email,
    }),
  });
  await writeTheCallLead(created, tx.session);
  const job = callLeadCreateJob(created._id.toString());
  await rememberSheetSync(job, tx.session);
  return { lead: created, job, source_company, sourceAssignment, form_fill };
}

export async function completeCallLeadIngestion(
  pending: CallLeadIngestionInProgress,
) {
  const { lead, job, source_company, sourceAssignment, form_fill } = pending;
  await projectTheLeadOntoSheets(job);
  await reportAMissingCplRate(lead, source_company, sourceAssignment);

  const callLeadIdentity = { name: lead.name ?? null, phone: lead.phone_number };
  await recordThatACallLeadWasCreated(lead, source_company, form_fill, callLeadIdentity);
  await recordFormFillWhenTrue(lead, source_company, form_fill, {
    workflow: "call_lead_create",
    leadIdentity: callLeadIdentity,
    details: { form_fill: true },
  });

  return lead;
}

async function projectTheLeadOntoSheets(job: FullSheetSyncJob) {
  await finalizeSheetSync(job);
}

async function reportAMissingCplRate(
  lead: CallLeadDocument,
  source_company: SourceCompany,
  sourceAssignment: {
    source_granularity_id?: { toString(): string } | string | null;
    source_granularity_key?: string | null;
  },
) {
  if (lead.cpl_resolution_status !== "missing_rate") return;
  await recordMissingLeadCplRate({
    leadModel: "CallLead",
    leadId: lead._id.toString(),
    sourceCompany: source_company,
    sourceGranularityId: sourceAssignment.source_granularity_id
      ? String(sourceAssignment.source_granularity_id)
      : null,
    sourceGranularityKey: sourceAssignment.source_granularity_key ?? undefined,
  });
}

async function recordThatACallLeadWasCreated(
  lead: CallLeadDocument,
  source_company: SourceCompany,
  form_fill: boolean,
  leadIdentity: { name: string | null; phone?: string | null },
) {
  await recordOperationalEvent({
    level: "info",
    eventKey: "lead.call.created",
    category: "lead",
    workflow: "call_lead_create",
    summary: "Call lead created.",
    leadIdentity,
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
}

async function recordFormFillWhenTrue(
  lead: CallLeadDocument,
  source_company: SourceCompany,
  form_fill: boolean,
  event: {
    workflow: string;
    leadIdentity: { name: string | null; phone?: string | null };
    details: Record<string, unknown>;
  },
) {
  if (!form_fill) return;
  await recordOperationalEvent({
    level: "info",
    eventKey: "lead.call.form_fill_detected",
    category: "lead",
    workflow: event.workflow,
    summary:
      event.workflow === "ringcentral_call_lead_create"
        ? "RingCentral call lead is a form fill."
        : "Call lead is a form fill.",
    leadIdentity: event.leadIdentity,
    sourceCompany: source_company,
    entity: { type: "call_lead", id: lead._id.toString() },
    details: event.details,
  });
}

// ── 1b. Call Lead Ingestion — RingCentral ─────────────────

export async function beginRingCentralCallLeadIngestion(
  input: CreateRingCentralCallLeadInput,
  tx: CallLeadSession,
): Promise<CallLeadIngestionInProgress> {
  const { source_company } = input;
  const sourceAssignment = acceptTheAlreadyResolvedSource(input);
  const duplicate = acceptTheDuplicateLeadFlag(input);
  const form_fill = await detectFormFill(
    {
      sourceCompany: source_company,
      leadSourceCompany: sourceAssignment.lead_source_company,
    },
    input.phone_number,
  );
  const leadTimestamp = stampFloridaTime(input.timestamp ?? new Date());
  const cplSnapshot = await priceTheLead(
    sourceAssignment.source_granularity_id
      ? String(sourceAssignment.source_granularity_id)
      : null,
    leadTimestamp,
    duplicate,
  );
  const created = new CallLead({
    ...sourceAssignment,
    phone_number: input.phone_number,
    name: input.name ?? undefined,
    duration: input.duration ?? undefined,
    start_time: input.start_time ?? undefined,
    end_time: input.end_time ?? undefined,
    timestamp: leadTimestamp,
    form_fill,
    duplicate,
    ...cplSnapshot,
    ...rememberHowTheLeadArrived("ringcentral", tx.now, {
      name: input.name,
      phone_number: input.phone_number,
    }),
    ringcentral: rememberRingCentralTransport(input),
  });
  await writeTheCallLead(created, tx.session);
  const job = callLeadCreateJob(created._id.toString());
  await rememberSheetSync(job, tx.session);
  return { lead: created, job, source_company, sourceAssignment, form_fill };
}

/**
 * Injectable RingCentral ingest adapter. Default ingest does **not** call
 * this — it uses begin + completeCallLeadIngestion, which emits
 * `lead.call.created`. This adapter does not emit that event.
 */
export async function ingestRingCentralCallLead(
  input: CreateRingCentralCallLeadInput,
) {
  const pending = await runSheetSyncWrite(async (session) =>
    beginRingCentralCallLeadIngestion(input, {
      session,
      now: new Date(),
    }),
  );
  const { lead, source_company, sourceAssignment, form_fill } = pending;

  await projectTheLeadOntoSheets(callLeadCreateJob(lead._id.toString()));
  await reportAMissingCplRate(lead, source_company, sourceAssignment);
  await recordFormFillWhenTrue(lead, source_company, form_fill, {
    workflow: "ringcentral_call_lead_create",
    leadIdentity: { name: lead.name ?? null, phone: lead.phone_number },
    details: { form_fill: true, duplicate: lead.duplicate },
  });

  return lead;
}

function normalizeTheCaller(input: CreateCallLeadInput) {
  return normalizeLeadName(input);
}

async function locateTheMoveIfWeHaveZips(input: CreateCallLeadInput) {
  return resolveOptionalLocation(input, { workflow: "call_lead_create" });
}

async function assignTheSourceGranularity(
  input: CreateCallLeadInput,
  local: LocalType | undefined,
) {
  const { assignment } = await resolveLeadSourceAssignment({
    value: input.source_company,
    company_slug: input.company_slug,
    granularity_key: input.source_granularity_key,
    channel: "call",
    local,
    source_site: input.source_company_site,
  });
  return assignment;
}

function acceptTheAlreadyResolvedSource(input: CreateRingCentralCallLeadInput) {
  return {
    source_company: input.source_company,
    lead_source_company: toObjectId(input.source_resolution.company_id),
    source_granularity_id: toObjectId(input.source_resolution.granularity_id),
    source_granularity_key: input.source_resolution.granularity_key,
    source_company_label_snapshot:
      input.source_resolution.company_label_snapshot,
    source_granularity_label_snapshot:
      input.source_resolution.granularity_label_snapshot,
    crm_source_label_snapshot: input.source_resolution.crm_label_snapshot,
  };
}

function acceptTheDuplicateLeadFlag(input: CreateRingCentralCallLeadInput) {
  return input.duplicate;
}

async function detectFormFill(
  source: {
    sourceCompany: SourceCompany;
    leadSourceCompany: SourceAssignment["lead_source_company"];
  },
  phoneNumber: string | undefined,
) {
  return hasFormFillForCallLead(source, phoneNumber);
}

function stampFloridaTime(timestamp?: Date | null) {
  return toFloridaTimestamp(timestamp ?? undefined);
}

async function priceTheLead(
  sourceGranularityId: string | null,
  timestamp: Date,
  duplicate?: boolean,
) {
  return resolveLeadCplSnapshot({
    sourceGranularityId,
    storedBusinessTimestamp: timestamp,
    ...(duplicate !== undefined ? { duplicate } : {}),
  });
}

function rememberHowTheLeadArrived(
  origin: CallLeadIngestionOrigin,
  now: Date,
  contact: {
    first_name?: string | null;
    last_name?: string | null;
    name?: string | null;
    phone_number?: string | null;
    email?: string | null;
  },
) {
  return callLeadCreationProvenanceFields({ origin, now, contact });
}

function rememberRingCentralTransport(input: CreateRingCentralCallLeadInput) {
  return {
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
    route_id: input.ringcentral.route_id,
    route_assignment_id: input.ringcentral.route_assignment_id,
    target_phone_number: input.ringcentral.target_phone_number,
  };
}

async function writeTheCallLead(
  lead: CallLeadDocument,
  session?: ClientSession,
) {
  await lead.save({ session });
}

async function rememberSheetSync(
  job: FullSheetSyncJob,
  session?: ClientSession,
) {
  await persistSheetSyncIntent(job, session);
}

function callLeadCreateJob(leadId: string): FullSheetSyncJob {
  return {
    resource: "source_lead",
    operation: "call_lead.create",
    leadModel: "CallLead",
    leadId,
  };
}

// ── 2. Call Lead Correction ───────────────────────────────

export async function correctCallLead(
  id: string,
  input: UpdateCallLeadInput,
  options: { transaction?: CallLeadSession } = {},
) {
  const lead = await loadTheLiveCallLead(id, options.transaction);
  refuseToMarkABookedCallAsDuplicate(lead, input, id);

  const beforeSnapshot = lead.toObject() as Record<string, unknown>;
  applyTheAllowedPatch(lead, input);
  await relocateTheMoveIfAddressesChanged(lead, input);
  const sourceResolutionForUpdate = await reassignTheSourceIfAttributionChanged(
    lead,
    input,
  );
  await repriceIfTheCostBasisChanged(lead, input, sourceResolutionForUpdate);
  await assignTheReceiverAgent(lead, input);

  if (nothingMaterialChanged(beforeSnapshot, lead)) {
    return lead;
  }

  const job = options.transaction
    ? await persistTheCorrectionAndRefreshTheBookingChain(
        lead,
        options.transaction,
      )
    : await runSheetSyncWrite((session) =>
        persistTheCorrectionAndRefreshTheBookingChain(lead, {
          session,
          now: new Date(),
        }),
      );
  if (!options.transaction) {
    await finalizeSheetSync(job);
  }
  // Missing CPL can fire before command commit on the in-transaction path.
  // Move it only as a separate, tested change.
  await reportAMissingCplRate(lead, lead.source_company as SourceCompany, lead);
  return lead;
}

export async function persistTheCorrectionAndRefreshTheBookingChain(
  lead: CallLeadDocument,
  tx: CallLeadSession,
): Promise<FullSheetSyncJob> {
  await lead.save({ session: tx.session });
  const refreshJob = await refreshAttachedBookingFromLead(
    lead,
    "CallLead",
    "call_lead.update",
    tx.session,
  );
  await persistSheetSyncIntent(refreshJob, tx.session);
  return refreshJob;
}

async function loadTheLiveCallLead(id: string, transaction?: CallLeadSession) {
  const lead = await CallLead.findById(id).session(
    transaction?.session ?? null,
  );
  if (!lead) {
    throw new NotFoundError("Call lead not found", {
      metadata: { resource: "call_lead", id },
    });
  }
  return lead;
}

function refuseToMarkABookedCallAsDuplicate(
  lead: CallLeadDocument,
  input: UpdateCallLeadInput,
  id: string,
) {
  if (input.duplicate === true && lead.booked) {
    throw new ConflictError("Cannot mark a booked call lead as duplicate", {
      metadata: {
        resource: "call_lead",
        id,
        bookedLeadId: lead.booked.toString(),
      },
    });
  }
}

function applyTheAllowedPatch(
  lead: CallLeadDocument,
  input: UpdateCallLeadInput,
) {
  const update = omitForbiddenLeadLifecycleFields(
    normalizeLeadNameUpdate({ ...input }, lead) as Record<string, unknown>,
  );
  if (input.timestamp !== undefined) {
    update.timestamp = stampFloridaTime(input.timestamp);
  }
  Object.assign(lead, update);
}

async function relocateTheMoveIfAddressesChanged(
  lead: CallLeadDocument,
  input: UpdateCallLeadInput,
) {
  if (
    !hasOwnInput(input, "pickup_zip") &&
    !hasOwnInput(input, "delivery_zip") &&
    !hasOwnInput(input, "pickup_state") &&
    !hasOwnInput(input, "delivery_state") &&
    !hasOwnInput(input, "local")
  ) {
    return;
  }
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

async function reassignTheSourceIfAttributionChanged(
  lead: CallLeadDocument,
  input: UpdateCallLeadInput,
) {
  if (!hasCallLeadSourceAffectingInput(input) && lead.lead_source_company) {
    return undefined;
  }
  const sourceResolutionForUpdate = await resolveLeadSourceAssignment({
    value: input.source_company ?? lead.source_company,
    company_slug: input.company_slug ?? lead.source_company,
    granularity_key: input.source_granularity_key ?? lead.source_granularity_key,
    channel: "call",
    local: lead.local as LocalType | undefined,
    source_site: input.source_company_site ?? lead.source_company_site,
  });
  Object.assign(lead, sourceResolutionForUpdate.assignment);
  return sourceResolutionForUpdate;
}

async function repriceIfTheCostBasisChanged(
  lead: CallLeadDocument,
  input: UpdateCallLeadInput,
  sourceResolutionForUpdate:
    | Awaited<ReturnType<typeof resolveLeadSourceAssignment>>
    | undefined,
) {
  if (
    sourceResolutionForUpdate === undefined &&
    !hasOwnInput(input, "timestamp") &&
    !hasOwnInput(input, "duplicate")
  ) {
    return;
  }
  Object.assign(
    lead,
    await resolveLeadCplSnapshot({
      sourceGranularityId: lead.source_granularity_id
        ? String(lead.source_granularity_id)
        : null,
      storedBusinessTimestamp: lead.timestamp,
      duplicate: lead.duplicate,
    }),
  );
}

async function assignTheReceiverAgent(
  lead: CallLeadDocument,
  input: UpdateCallLeadInput,
) {
  if (input.receiver_agent === undefined) return;
  let agent: Awaited<ReturnType<typeof getRegistryAgent>>;
  try {
    agent = await getRegistryAgent(input.receiver_agent);
  } catch (error) {
    if (!isRegistryError(error)) throw error;
    throw new NotFoundError("Agent not found", {
      metadata: { resource: "agent", id: input.receiver_agent },
    });
  }
  lead.receiver_agent = toObjectId(agent.id);
  lead.receiver_agent_name_snapshot = agent.name;
  lead.receiver_agent_source = input.receiver_agent_source ?? "manual";
  lead.receiver_agent_source_value = input.receiver_agent_source_value;
  lead.receiver_agent_set_at = new Date();
}

function nothingMaterialChanged(
  beforeSnapshot: Record<string, unknown>,
  lead: CallLeadDocument,
) {
  return (
    collectDocumentFieldChanges(
      beforeSnapshot,
      lead.toObject() as Record<string, unknown>,
      CALL_LEAD_CHANGE_PATHS,
    ).length === 0
  );
}

// ── 3. List ───────────────────────────────────────────────

export async function listRecentCallLeads() {
  return CallLead.find().sort({ createdAt: -1 }).limit(200);
}

// ── 4. Removal ────────────────────────────────────────────

export async function removeCallLead(id: string, cascade: boolean) {
  const lead = await CallLead.findById(id);
  if (!lead) {
    throw new NotFoundError("Call lead not found", {
      metadata: { resource: "call_lead", id },
    });
  }
  refuseRemovalIfBookedWithoutCascade(lead, cascade, id);
  if (lead.booked && cascade) {
    await deleteBookedLead(lead.booked.toString(), true);
  }

  if (getSheetSyncMode() === "queued") {
    await runSheetSyncWrite(async (session) => {
      await tombstoneBothCallSheetTabs(lead, id, session);
      await eraseTheCallLead(lead, session);
    });
    await finalizeSheetSyncDelete();
    return;
  }

  await deleteCallLeadFromSheets(lead);
  await eraseTheCallLead(lead);
}

export async function beginCallLeadRemoval(
  id: string,
  cascade: boolean,
  tx: CallLeadSession,
) {
  const lead = await CallLead.findById(id).session(tx.session ?? null);
  if (!lead) {
    throw new NotFoundError("Call lead not found", {
      metadata: { resource: "call_lead", id },
    });
  }
  refuseRemovalIfBookedWithoutCascade(lead, cascade, id);
  const mutations: Array<{
    entity: {
      model: "FormLead" | "CallLead" | "BookedLead" | "CancelledLead";
      id: string;
    };
    revision_before: number;
    fields: Array<{ path: string; before?: unknown; after?: unknown }>;
    deleted?: boolean;
  }> = [];
  const entity_refs: Array<{ model: string; id: string }> = [
    { model: "CallLead", id },
  ];
  const { deleteBookedLeadInTransaction } = await import(
    "../bookings/bookedLead.service.js"
  );
  let cascaded: Awaited<ReturnType<typeof deleteBookedLeadInTransaction>> | undefined;
  if (lead.booked && cascade) {
    cascaded = await deleteBookedLeadInTransaction(
      lead.booked.toString(),
      true,
      tx,
    );
    mutations.push(...cascaded.mutations);
    entity_refs.push(...cascaded.entity_refs);
  }
  if (getSheetSyncMode() === "queued") {
    await tombstoneBothCallSheetTabs(lead, id, tx.session);
  }
  mutations.push({
    entity: { model: "CallLead", id },
    revision_before: Number(lead.domain_revision ?? 0),
    fields: [{ path: "$deleted" }],
    deleted: true,
  });
  const captured = lead.toObject();
  await eraseTheCallLead(lead, tx.session);
  return {
    mutations,
    entity_refs,
    finalize: async () => {
      if (getSheetSyncMode() === "queued") {
        await finalizeSheetSyncDelete();
        return;
      }
      await cascaded?.finalize();
      await deleteCallLeadFromSheets(captured as typeof lead);
    },
  };
}

export function rememberBothCallSheetTabsForTombstone(
  lead: CallLeadDeleteTargetSource,
) {
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

function refuseRemovalIfBookedWithoutCascade(
  lead: CallLeadDocument,
  cascade: boolean,
  id: string,
) {
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
}

async function tombstoneBothCallSheetTabs(
  lead: CallLeadDocument,
  id: string,
  session?: ClientSession,
) {
  const previousTargets = rememberBothCallSheetTabsForTombstone(lead);
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
    {
      session,
      targetHints: previousTargets.map((target) => target.target),
    },
  );
}

async function eraseTheCallLead(
  lead: CallLeadDocument,
  session?: ClientSession,
) {
  await lead.deleteOne(session ? { session } : undefined);
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

// ── Compatibility aliases ─────────────────────────────────
// Callers still learning the story names. Remove once existingWrites,
// RingCentral ingest, the v1 facade, and the replica test have migrated.

export async function createCallLead(input: CreateCallLeadInput) {
  return ingestCallLead(input);
}

export async function createCallLeadInTransaction(
  input: CreateCallLeadInput,
  tx: CallLeadSession & { ingestion_origin: CallLeadIngestionOrigin },
) {
  return beginCallLeadIngestion(input, tx);
}

export async function finalizeCallLeadCreateAfterCommit(
  pending: CallLeadIngestionInProgress,
) {
  return completeCallLeadIngestion(pending);
}

export async function createRingCentralCallLead(
  input: CreateRingCentralCallLeadInput,
) {
  return ingestRingCentralCallLead(input);
}

export async function createRingCentralCallLeadInTransaction(
  input: CreateRingCentralCallLeadInput,
  tx: CallLeadSession,
) {
  return beginRingCentralCallLeadIngestion(input, tx);
}

export async function updateCallLead(
  id: string,
  input: UpdateCallLeadInput,
  options: { transaction?: CallLeadSession } = {},
) {
  return correctCallLead(id, input, options);
}

export async function updateCallLeadInTransaction(
  id: string,
  input: UpdateCallLeadInput,
  tx: CallLeadSession,
) {
  return correctCallLead(id, input, { transaction: tx });
}

export async function persistCallLeadUpdateInTransaction(
  lead: CallLeadDocument,
  tx: CallLeadSession,
) {
  return persistTheCorrectionAndRefreshTheBookingChain(lead, tx);
}

export async function findAllCallLeads() {
  return listRecentCallLeads();
}

export async function deleteCallLead(id: string, cascade: boolean) {
  return removeCallLead(id, cascade);
}

export async function deleteCallLeadInTransaction(
  id: string,
  cascade: boolean,
  tx: CallLeadSession,
) {
  return beginCallLeadRemoval(id, cascade, tx);
}

export function buildCallLeadDeletePreviousTargets(
  lead: CallLeadDeleteTargetSource,
) {
  return rememberBothCallSheetTabsForTombstone(lead);
}
