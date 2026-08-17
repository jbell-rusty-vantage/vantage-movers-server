import mongoose, { type ClientSession } from "mongoose";
import {
  getSheetSyncMode,
  isTestMode,
  shouldAllowLeadMessagingInTestMode,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { getFormLeadModel } from "../../models/FormLead";
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
import {
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
} from "../domainCommands/entityChange";
import { ConflictError, NotFoundError } from "../errors";
import { deleteFormLeadFromSheets } from "../googleSheets.service";
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
import {
  deriveFormLeadLocal,
  normalizeState,
  resolveRequiredLocation,
} from "./leadLocation.service";
import { resolveLeadSourceAssignment } from "./leadSourceCompany";
import {
  findDuplicateFormLeadMatch,
  markMatchingCallLeadsWithFormFill,
} from "./duplicateLead.service";
import { normalizeLeadName, normalizeLeadNameUpdate } from "./leadName.service";
import {
  recordMissingLeadCplRate,
  resolveLeadCplSnapshot,
} from "./leadCplResolution";
import { recordOperationalEvent } from "../observability";
import { getRegistryAgent, isRegistryError } from "../operationsRegistry";
import {
  dispatchPersistedLeadMessage,
  persistLeadMessageIntent,
  queueInitialLeadMessage,
  type LeadMessagingOutcome,
} from "../leadMessaging";

export type FormLeadCreateTransactionResult = {
  lead: InstanceType<ReturnType<typeof getFormLeadModel>>;
  jobs: FullSheetSyncJob[];
  leadMessage: Awaited<ReturnType<typeof persistLeadMessageIntent>>;
  shouldPostToGranot: boolean;
  crmLabel: string;
  source_company: SourceCompany;
  sourceAssignment: Awaited<
    ReturnType<typeof resolveLeadSourceAssignment>
  >["assignment"];
  duplicate: boolean;
  duplicateMatch: Awaited<ReturnType<typeof findDuplicateFormLeadMatch>>;
  crm_company_label: string | undefined;
  sms_consent: boolean | undefined;
};

export async function createFormLeadInTransaction(
  input: CreateFormLeadInput,
  tx: { session?: ClientSession; now: Date },
): Promise<FormLeadCreateTransactionResult> {
  const FormLead = getFormLeadModel();
  const {
    crm_company_label,
    post_to_granot,
    sms_consent,
    ingestion_source,
    ...formLeadInput
  } = input;
  const normalizedFormLeadInput = normalizeLeadName(formLeadInput);
  normalizedFormLeadInput.phone_number = normalizePhoneNumberForStorage(
    normalizedFormLeadInput.phone_number,
  );
  const location = await resolveRequiredLocation(normalizedFormLeadInput, {
    workflow: "form_lead_create",
  });
  const local =
    (ingestion_source === "best_relocation_sheet"
      ? normalizedFormLeadInput.local
      : undefined) ??
    deriveFormLeadLocal(location.pickup_state, location.delivery_state);
  const { resolution: sourceResolution, assignment: sourceAssignment } =
    await resolveLeadSourceAssignment({
      value: normalizedFormLeadInput.source_company,
      company_slug: normalizedFormLeadInput.company_slug,
      granularity_key: normalizedFormLeadInput.source_granularity_key,
      channel: "form",
      local,
      source_site: normalizedFormLeadInput.source_company_site,
    });
  const source_company = sourceAssignment.source_company as SourceCompany;
  const leadTimestamp = toFloridaTimestamp(normalizedFormLeadInput.timestamp);
  const duplicateMatch = await findDuplicateFormLeadMatch(
    {
      sourceCompany: source_company,
      leadSourceCompany: sourceAssignment.lead_source_company,
      sourceGranularityId: sourceAssignment.source_granularity_id,
    },
    normalizedFormLeadInput.phone_number,
    normalizedFormLeadInput.email,
    leadTimestamp,
  );
  const duplicate = duplicateMatch.duplicate;
  const shouldPostToGranot = post_to_granot && !duplicate;
  const crmLabel = sourceResolution.crm_label_snapshot;
  const cplSnapshot = await resolveLeadCplSnapshot({
    sourceGranularityId: sourceAssignment.source_granularity_id
      ? String(sourceAssignment.source_granularity_id)
      : null,
    storedBusinessTimestamp: leadTimestamp,
  });
  const lid = normalizedFormLeadInput.lid?.trim() || generateLeadId();
  const created = new FormLead({
    ...normalizedFormLeadInput,
    ...location,
    ...sourceAssignment,
    local,
    lid,
    ref_no: normalizedFormLeadInput.ref_no?.trim() || "not provided",
    timestamp: leadTimestamp,
    move_date: normalizedFormLeadInput.move_date ?? tx.now,
    ...cplSnapshot,
    duplicate,
    post_to_granot: shouldPostToGranot,
  });
  await created.save({ session: tx.session });

  const leadId = created._id.toString();
  const sheetSyncJobs: FullSheetSyncJob[] = [];
  if (!created.duplicate) {
    const formFillJobs = await markMatchingCallLeadsWithFormFill(
      {
        sourceCompany: source_company,
        leadSourceCompany: sourceAssignment.lead_source_company,
      },
      created.phone_number,
      leadId,
      tx.session,
    );
    sheetSyncJobs.push(...formFillJobs);
  }
  const formLeadJob: FullSheetSyncJob = {
    resource: "source_lead",
    operation: "form_lead.create",
    leadModel: "FormLead",
    leadId,
  };
  sheetSyncJobs.push(formLeadJob);
  for (const job of sheetSyncJobs) {
    await persistSheetSyncIntent(job, tx.session);
  }
  const message = await persistLeadMessageIntent({
    formLeadId: leadId,
    destinationPhone: created.phone_number,
    formInput: input,
    duplicate: created.duplicate,
    testMode: isTestMode(),
    session: tx.session,
  });
  return {
    lead: created,
    jobs: sheetSyncJobs,
    leadMessage: message,
    shouldPostToGranot,
    crmLabel,
    source_company,
    sourceAssignment,
    duplicate,
    duplicateMatch,
    crm_company_label,
    sms_consent,
  };
}

export async function createFormLead(input: CreateFormLeadInput) {
  const messagingAllowedInRuntime =
    !isTestMode() || shouldAllowLeadMessagingInTestMode();
  const pending = await runSheetSyncWrite(
    (session) =>
      createFormLeadInTransaction(input, { session, now: new Date() }),
    {
      forceTransaction:
        input.sms_consent === true && messagingAllowedInRuntime,
    },
  );
  return finalizeFormLeadCreateAfterCommit(pending);
}

export async function finalizeFormLeadCreateAfterCommit(
  pending: FormLeadCreateTransactionResult,
) {
  const {
    lead,
    jobs,
    leadMessage,
    shouldPostToGranot,
    crmLabel,
    source_company,
    sourceAssignment,
    duplicate,
    duplicateMatch,
    crm_company_label,
    sms_consent,
  } = pending;
  const leadId = lead._id.toString();

  if (lead.cpl_resolution_status === "missing_rate") {
    await recordMissingLeadCplRate({
      leadModel: "FormLead",
      leadId,
      sourceCompany: source_company,
      sourceGranularityId: sourceAssignment.source_granularity_id
        ? String(sourceAssignment.source_granularity_id)
        : null,
      sourceGranularityKey: sourceAssignment.source_granularity_key,
    });
  }

  if (sms_consent !== undefined) {
    logger.info({
      msg: "form_lead.sms_consent.received",
      leadId,
      sms_consent,
      email: lead.email,
      phone_number: lead.phone_number,
    });
  }

  const messagingResult = await dispatchLeadMessageAfterPersist(leadMessage);

  for (const job of jobs) {
    await finalizeSheetSync(job);
  }

  const crmResult: CrmSubmitResult = shouldPostToGranot
    ? await submitFormLeadToCrm(lead, { companyLabel: crmLabel })
    : {
        ok: true,
        status: 0,
        responseText: "",
        payload: buildCrmFormLeadPayload(lead, crmLabel),
      };

  if (!shouldPostToGranot) {
    logger.info({
      msg: "crm.form_lead.submit.skipped",
      leadId,
      companyLabel: crmLabel,
      requestedCompanyLabel: crm_company_label,
      duplicate,
    });
  }

  logger.info({
    msg: "form_lead.sheet_sync.pending_response",
    leadId,
    email: lead.email,
    phone_number: lead.phone_number,
    crmSyncOk: crmResult.ok,
    crmStatus: crmResult.status,
    crmSkipped: !shouldPostToGranot,
    messagingStatus: messagingResult.status,
    leadMessageId: messagingResult.message_id,
    duplicate,
  });

  const leadIdentity = {
    name: lead.name,
    phone: lead.phone_number,
    email: lead.email,
  };
  const formFillJobCount = jobs.filter(
    (job) => job.operation === "call_lead.form_fill.update",
  ).length;

  await recordOperationalEvent({
    level: "info",
    eventKey: "lead.form.created",
    category: "lead",
    workflow: "form_lead_create",
    summary: "Form lead created.",
    leadIdentity,
    sourceCompany: source_company,
    entity: { type: "form_lead", id: leadId },
    details: {
      pickup_zip: lead.pickup_zip,
      delivery_zip: lead.destination_zip,
      pickup_state: lead.pickup_state,
      delivery_state: lead.delivery_state,
      local: lead.local,
      duplicate,
      cpl: lead.cpl,
      post_to_granot: shouldPostToGranot,
    },
  });

  if (duplicate) {
    await recordOperationalEvent({
      level: "warn",
      eventKey: "lead.form.duplicate_detected",
      category: "lead",
      workflow: "form_lead_create",
      summary: "Duplicate form lead detected and saved as duplicate.",
      leadIdentity,
      sourceCompany: source_company,
      entity: { type: "form_lead", id: leadId },
      details: {
        duplicate: true,
        matched_by: duplicateMatch.matchedBy,
        matched_lead_count: duplicateMatch.matchedLeadIds.length,
      },
      notificationCandidate: false,
    });
  }

  if (formFillJobCount > 0) {
    await recordOperationalEvent({
      level: "info",
      eventKey: "lead.form.call_leads_marked_form_fill",
      category: "lead",
      workflow: "form_lead_create",
      summary: "Form lead marked existing call leads as form fill.",
      leadIdentity,
      sourceCompany: source_company,
      entity: { type: "form_lead", id: leadId },
      details: {
        form_lead_id: leadId,
        matched_call_lead_count: formFillJobCount,
      },
    });
  }

  if (!shouldPostToGranot) {
    await recordOperationalEvent({
      level: "info",
      eventKey: "crm.form_lead.submit.skipped",
      category: "crm",
      workflow: "crm_submit",
      summary: "CRM submission skipped for form lead.",
      leadIdentity,
      sourceCompany: source_company,
      entity: { type: "form_lead", id: leadId },
      details: {
        duplicate,
        post_to_granot: shouldPostToGranot,
        companyLabel: crmLabel,
        requestedCompanyLabel: crm_company_label,
      },
      reportable: false,
    });
  }

  return {
    lead,
    sheet_sync_status: "pending",
    crm_sync_status: shouldPostToGranot ? (crmResult.ok ? "synced" : "failed") : "skipped",
    crm_company_label: crmResult.payload.label,
    crm_response: crmResult.responseText || crmResult.error || "",
    messaging_status: messagingResult.status,
    lead_message_id: messagingResult.message_id,
  };
}

async function dispatchLeadMessageAfterPersist(
  message: Awaited<ReturnType<typeof persistLeadMessageIntent>>,
): Promise<LeadMessagingOutcome> {
  if (!message) return { message_id: null, status: "not_requested" };
  if (message.status === "skipped") {
    return { message_id: message._id.toString(), status: "skipped" };
  }
  try {
    if (message.dispatch_mode === "queued") {
      return queueInitialLeadMessage(message._id.toString());
    }
    return dispatchPersistedLeadMessage(message._id.toString());
  } catch (error) {
    logger.error({
      err: error,
      msg: "lead_messaging.post_persist_dispatch_failed",
      leadMessageId: message._id.toString(),
      leadId: message.form_lead.toString(),
    });
    return { message_id: message._id.toString(), status: "failed" };
  }
}

export async function persistFormLeadUpdateInTransaction(
  lead: InstanceType<ReturnType<typeof getFormLeadModel>>,
  tx: { session?: ClientSession; now: Date },
): Promise<FullSheetSyncJob> {
  await lead.save({ session: tx.session });
  const refreshJob = await refreshAttachedBookingFromLead(
    lead,
    "FormLead",
    "form_lead.update",
    tx.session,
  );
  await persistSheetSyncIntent(refreshJob, tx.session);
  return refreshJob;
}

export async function updateFormLeadInTransaction(
  id: string,
  input: UpdateFormLeadInput,
  tx: { session?: ClientSession; now: Date },
  options: { expected?: Record<string, unknown> } = {},
) {
  return updateFormLead(id, input, { ...options, transaction: tx });
}

export async function updateFormLead(
  id: string,
  input: UpdateFormLeadInput,
  options: {
    expected?: Record<string, unknown>;
    transaction?: { session?: ClientSession; now: Date };
  } = {},
) {
  const FormLead = getFormLeadModel();
  const lead = options.expected
    ? await FormLead.findOne({ _id: id, ...options.expected }).session(
        options.transaction?.session ?? null,
      )
    : await FormLead.findById(id).session(options.transaction?.session ?? null);
  if (!lead) {
    if (options.expected) {
      throw new ConflictError(
        "Form lead changed after preview; reload before applying",
        {
          metadata: { resource: "form_lead", id, reason: "preview_drift" },
        },
      );
    }
    throw new NotFoundError("Form lead not found", {
      metadata: { resource: "form_lead", id },
    });
  }

  if (
    lead.duplicate &&
    (
      input.quoted !== undefined ||
      input.cubic_feet !== undefined ||
      input.receiver_agent_source === "extension_crm_username_match"
    )
  ) {
    throw new ConflictError(
      "Cannot update quoted or cubic_feet on a duplicate form lead",
      {
        metadata: { resource: "form_lead", id, duplicate: true },
      },
    );
  }

  if (hasOwnInput(input, "bad_lead") && (lead.duplicate || lead.booked || lead.cancelled)) {
    throw new ConflictError(
      "Cannot mark a duplicate, booked, or cancelled form lead as bad",
      {
        metadata: {
          resource: "form_lead",
          id,
          duplicate: Boolean(lead.duplicate),
          booked: Boolean(lead.booked),
          cancelled: Boolean(lead.cancelled),
        },
      },
    );
  }

  const beforeSnapshot = lead.toObject() as Record<string, unknown>;
  const update = normalizeLeadNameUpdate({ ...input }, lead);
  let sourceResolutionForUpdate:
    | Awaited<ReturnType<typeof resolveLeadSourceAssignment>>
    | undefined;
  const sourceAffectingInputChanged = hasFormLeadSourceAffectingInput(input);
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
    const location = await resolveRequiredLocation(
      {
        pickup_zip: input.pickup_zip ?? lead.pickup_zip,
        destination_zip: input.destination_zip ?? lead.destination_zip,
        pickup_state: input.pickup_state ?? lead.pickup_state,
        delivery_state: input.delivery_state ?? lead.delivery_state,
      },
      { workflow: "form_lead_update" },
    );
    const explicitPickupState = normalizeState(input.pickup_state);
    const explicitDeliveryState = normalizeState(input.delivery_state);
    lead.pickup_state = isStateCode(explicitPickupState)
      ? explicitPickupState
      : location.pickup_state;
    lead.delivery_state = isStateCode(explicitDeliveryState)
      ? explicitDeliveryState
      : location.delivery_state;
    lead.local = deriveFormLeadLocal(lead.pickup_state, lead.delivery_state);
  }
  if (sourceAffectingInputChanged || !lead.lead_source_company) {
    sourceResolutionForUpdate = await resolveLeadSourceAssignment({
      value: input.source_company ?? lead.source_company,
      company_slug: input.company_slug ?? lead.source_company,
      granularity_key: input.source_granularity_key ?? lead.source_granularity_key,
      channel: "form",
      local: lead.local as LocalType,
      source_site: input.source_company_site ?? lead.source_company_site,
    });
    Object.assign(lead, sourceResolutionForUpdate.assignment);
  }
  if (
    sourceResolutionForUpdate !== undefined ||
    hasOwnInput(input, "timestamp")
  ) {
    Object.assign(
      lead,
      await resolveLeadCplSnapshot({
        sourceGranularityId: lead.source_granularity_id
          ? String(lead.source_granularity_id)
          : null,
        storedBusinessTimestamp: lead.timestamp,
      }),
    );
  }

  if (input.receiver_agent !== undefined) {
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

  const fieldChanges = collectDocumentFieldChanges(
    beforeSnapshot,
    lead.toObject() as Record<string, unknown>,
    FORM_LEAD_CHANGE_PATHS,
  );
  if (fieldChanges.length === 0) {
    return lead;
  }

  let job: FullSheetSyncJob;
  try {
    job = options.transaction
      ? await persistFormLeadUpdateInTransaction(lead, options.transaction)
      : await runSheetSyncWrite((session) =>
          persistFormLeadUpdateInTransaction(lead, {
            session,
            now: new Date(),
          }),
        );
  } catch (error) {
    if (error instanceof mongoose.Error.VersionError) {
      throw new ConflictError(
        "Form lead changed after preview; reload before applying",
        {
          metadata: { resource: "form_lead", id, reason: "preview_drift" },
        },
      );
    }
    throw error;
  }
  if (!options.transaction) {
    await finalizeSheetSync(job);
  }
  if (lead.cpl_resolution_status === "missing_rate") {
    await recordMissingLeadCplRate({
      leadModel: "FormLead",
      leadId: lead._id.toString(),
      sourceCompany: lead.source_company as SourceCompany,
      sourceGranularityId: lead.source_granularity_id
        ? String(lead.source_granularity_id)
        : null,
      sourceGranularityKey: lead.source_granularity_key,
    });
  }
  return lead;
}

function isStateCode(value?: string): value is string {
  return Boolean(value && /^[A-Z]{2}$/.test(value));
}

export async function findAllFormLeads() {
  const FormLead = getFormLeadModel();
  return FormLead.find().sort({ createdAt: -1 }).limit(200);
}

export async function findFormLead(id: string) {
  const FormLead = getFormLeadModel();
  const lead = await FormLead.findById(id).select(
    "_id ref_no source_company quoted cubic_feet pickup_city pickup_zip pickup_state delivery_city destination_zip delivery_state booked duplicate receiver_agent receiver_agent_name_snapshot receiver_agent_source receiver_agent_source_value",
  );
  if (!lead || lead.duplicate) {
    throw new NotFoundError("Form lead not found", {
      metadata: {
        resource: "form_lead",
        id,
        ...(lead?.duplicate ? { duplicate: true } : {}),
      },
    });
  }

  return lead;
}

export async function deleteFormLead(id: string, cascade: boolean) {
  const FormLead = getFormLeadModel();
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

  if (getSheetSyncMode() === "queued") {
    const previousTargets = buildTombstonePreviousTargets(lead.sheet_sync);
    await runSheetSyncWrite(async (session) => {
      await enqueueSheetSyncTombstone(
        {
          resource: "delete_source_lead",
          entityModel: "FormLead",
          entityId: id,
          operation: "delete_form_lead",
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

  await deleteFormLeadFromSheets(lead);
  await lead.deleteOne();
}

export async function deleteFormLeadInTransaction(
  id: string,
  cascade: boolean,
  tx: { session?: ClientSession; now: Date },
) {
  const FormLead = getFormLeadModel();
  const lead = await FormLead.findById(id).session(tx.session ?? null);
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
  const mutations: Array<{
    entity: { model: "FormLead" | "CallLead" | "BookedLead" | "CancelledLead"; id: string };
    revision_before: number;
    fields: Array<{ path: string; before?: unknown; after?: unknown }>;
    deleted?: boolean;
  }> = [];
  const entity_refs: Array<{ model: string; id: string }> = [
    { model: "FormLead", id },
  ];
  const { deleteBookedLeadInTransaction } = await import(
    "../bookings/bookedLead.service.js"
  );
  let cascaded: Awaited<ReturnType<typeof deleteBookedLeadInTransaction>> | undefined;
  if (lead.booked && cascade) {
    cascaded = await deleteBookedLeadInTransaction(lead.booked.toString(), true, tx);
    mutations.push(...cascaded.mutations);
    entity_refs.push(...cascaded.entity_refs);
  }
  if (getSheetSyncMode() === "queued") {
    const previousTargets = buildTombstonePreviousTargets(lead.sheet_sync);
    await enqueueSheetSyncTombstone(
      {
        resource: "delete_source_lead",
        entityModel: "FormLead",
        entityId: id,
        operation: "delete_form_lead",
        tombstone: {
          mongo_id: id,
          source_company: lead.source_company,
          duplicate: lead.duplicate,
          previous_targets: previousTargets,
        },
      },
      {
        session: tx.session,
        targetHints: previousTargets.map((target) => target.target),
      },
    );
  }
  mutations.push({
    entity: { model: "FormLead", id },
    revision_before: Number(lead.domain_revision ?? 0),
    fields: [{ path: "$deleted" }],
    deleted: true,
  });
  const captured = lead.toObject();
  await lead.deleteOne({ session: tx.session });
  return {
    mutations,
    entity_refs,
    finalize: async () => {
      if (getSheetSyncMode() === "queued") {
        await finalizeSheetSyncDelete();
        return;
      }
      await cascaded?.finalize();
      await deleteFormLeadFromSheets(captured as typeof lead);
    },
  };
}

function hasOwnInput<T extends object>(input: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function hasFormLeadSourceAffectingInput(input: UpdateFormLeadInput): boolean {
  return (
    hasOwnInput(input, "source_company") ||
    hasOwnInput(input, "company_slug") ||
    hasOwnInput(input, "source_granularity_key") ||
    hasOwnInput(input, "source_company_site") ||
    hasOwnInput(input, "pickup_zip") ||
    hasOwnInput(input, "destination_zip") ||
    hasOwnInput(input, "pickup_state") ||
    hasOwnInput(input, "delivery_state")
  );
}
