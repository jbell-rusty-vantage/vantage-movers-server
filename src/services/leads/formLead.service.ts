import mongoose, { type ClientSession } from "mongoose";
import {
  getMongoDatabaseName,
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
import { toObjectId } from "../../utils/objectId";
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
import { ConflictError, NotFoundError, ServiceUnavailableError } from "../errors";
import { deleteFormLeadFromSheets } from "../googleSheets.service";
import type { FormLeadIngestionOrigin } from "../granotLifecycle/types";
import { recordOperationalEvent } from "../observability";
import { getRegistryAgent, isRegistryError } from "../operationsRegistry";
import {
  dispatchOrQueuePersistedLeadMessage,
  persistLeadMessageIntent,
} from "../leadMessaging";
import {
  buildTombstonePreviousTargets,
  enqueueSheetSyncTombstone,
  finalizeSheetSync,
  finalizeSheetSyncDelete,
  persistSheetSyncIntent,
  runSheetSyncWrite,
  type FullSheetSyncJob,
} from "../sheetSync";
import {
  deleteBookedLead,
  refreshAttachedBookingFromLead,
} from "../v1.service";
import {
  findDuplicateFormLeadMatch,
  markMatchingCallLeadsWithFormFill,
} from "./duplicateLead.service";
import {
  recordMissingLeadCplRate,
  resolveLeadCplSnapshot,
} from "./leadCplResolution";
import {
  formLeadCreationProvenanceFields,
  noSyncOnCreate,
  omitForbiddenLeadLifecycleFields,
} from "./leadIngestionProvenance";
import {
  deriveFormLeadLocal,
  normalizeState,
  resolveRequiredLocation,
} from "./leadLocation.service";
import { normalizeLeadName, normalizeLeadNameUpdate } from "./leadName.service";
import { resolveLeadSourceAssignment } from "./leadSourceCompany";
import {
  captureWordpressReceiptThenCreateLead,
  createMongoWordpressReceiptStore,
} from "./wordpressFormSubmissionReceipt";

type FormLeadDocument = InstanceType<ReturnType<typeof getFormLeadModel>>;
type FormLeadSession = { session?: ClientSession; now: Date };
type SourceAssignment = Awaited<
  ReturnType<typeof resolveLeadSourceAssignment>
>["assignment"];
type DuplicateMatch = Awaited<ReturnType<typeof findDuplicateFormLeadMatch>>;

/**
 * Handoff from "the Form Lead is saved" to "tell Granot, the sheets,
 * messaging, and the owner."
 */
export type FormLeadIngestionInProgress = {
  lead: FormLeadDocument;
  jobs: FullSheetSyncJob[];
  leadMessage: Awaited<ReturnType<typeof persistLeadMessageIntent>>;
  shouldPostToGranot: boolean;
  crmLabel: string;
  source_company: SourceCompany;
  sourceAssignment: SourceAssignment;
  duplicate: boolean;
  duplicateMatch: DuplicateMatch;
  crm_company_label: string | undefined;
  sms_consent: boolean | undefined;
  reusedExistingLead?: boolean;
};

export type FormLeadCreateTransactionResult = FormLeadIngestionInProgress;

type FormLeadPersistInput = Omit<
  CreateFormLeadInput,
  | "crm_company_label"
  | "post_to_granot"
  | "sms_consent"
  | "ingestion_source"
  | "wordpress_submission_key"
  | "no_sync"
>;

type PreparedQuote = {
  input: CreateFormLeadInput;
  normalized: FormLeadPersistInput;
  location: Awaited<ReturnType<typeof resolveRequiredLocation>>;
  local: LocalType;
  sourceAssignment: SourceAssignment;
  source_company: SourceCompany;
  leadTimestamp: Date;
  duplicateMatch: DuplicateMatch;
  duplicate: boolean;
  shouldPostToGranot: boolean;
  crmLabel: string;
  cplSnapshot: Awaited<ReturnType<typeof resolveLeadCplSnapshot>>;
  lid: string;
  crm_company_label: string | undefined;
  sms_consent: boolean | undefined;
  wordpress_submission_key: string | undefined;
};

// Compatibility imports from the v1 service facade. `deleteBookedLead` and
// `refreshAttachedBookingFromLead` still live there because the booking
// extraction (refactor plan 04) has not happened yet. They are only ever
// referenced inside function bodies, so the temporary circular dependency
// resolves correctly via ESM/CJS late binding.

// A landing-page quote becomes a Form Lead.
// Later the owner may correct it, the extension may look it up,
// or the owner may remove it.

// ── 1. Form Lead Ingestion ────────────────────────────────

export async function ingestFormLead(input: CreateFormLeadInput) {
  const messagingAllowedInRuntime =
    !isTestMode() || shouldAllowLeadMessagingInTestMode();
  const pending = await runSheetSyncWrite(
    (session) =>
      beginFormLeadIngestion(input, {
        session,
        now: new Date(),
        ingestion_origin: "wordpress_form",
      }),
    {
      forceTransaction:
        (input.sms_consent === true && messagingAllowedInRuntime) ||
        Boolean(input.wordpress_submission_key),
    },
  );
  return completeFormLeadIngestion(pending);
}

export async function beginFormLeadIngestion(
  input: CreateFormLeadInput,
  tx: FormLeadSession & { ingestion_origin: FormLeadIngestionOrigin },
): Promise<FormLeadIngestionInProgress> {
  const FormLead = getFormLeadModel();
  const prepared = await prepareTheQuoteForIngestion(input);

  let createdPending: FormLeadIngestionInProgress | undefined;
  const capture = await captureWordpressReceiptThenCreateLead({
    authorization: {
      ingestionOrigin: tx.ingestion_origin,
      testMode: isTestMode(),
      databaseName: getMongoDatabaseName(),
    },
    submissionKey: prepared.wordpress_submission_key,
    now: tx.now,
    store: createMongoWordpressReceiptStore(),
    session: tx.session,
    leadExists: async (leadId) => {
      const existing = await FormLead.findById(leadId).session(tx.session ?? null);
      return Boolean(existing);
    },
    createLead: async () => {
      createdPending = await writeTheFormLead(prepared, tx);
      return { leadId: createdPending.lead._id.toString() };
    },
  });
  if (!capture.createdLead && capture.reusedLeadId) {
    const existing = await FormLead.findById(capture.reusedLeadId).session(
      tx.session ?? null,
    );
    if (!existing) {
      throw new ServiceUnavailableError(
        "WordPress submission receipt points at a missing Form Lead; refusing to invent a replacement",
      );
    }
    return {
      lead: existing,
      jobs: [],
      leadMessage: null,
      shouldPostToGranot: false,
      crmLabel: existing.crm_source_label_snapshot ?? "",
      source_company: existing.source_company as SourceCompany,
      sourceAssignment: {
        source_company: existing.source_company,
        lead_source_company: existing.lead_source_company,
        source_granularity_id: existing.source_granularity_id,
        source_granularity_key: existing.source_granularity_key,
      } as SourceAssignment,
      duplicate: existing.duplicate === true,
      duplicateMatch: {
        duplicate: existing.duplicate === true,
        matchedBy: null,
        matchedLeadIds: [],
      },
      crm_company_label: prepared.crm_company_label,
      sms_consent: prepared.sms_consent,
      reusedExistingLead: true,
    };
  }
  if (!createdPending) {
    throw new ServiceUnavailableError(
      "WordPress submission receipt capture failed; Form Lead was not created",
    );
  }
  return createdPending;
}

export async function completeFormLeadIngestion(
  pending: FormLeadIngestionInProgress,
) {
  if (pending.reusedExistingLead) {
    return {
      lead: pending.lead,
      sheet_sync_status: "skipped" as const,
      crm_sync_status: "skipped" as const,
      crm_company_label: pending.crmLabel,
      crm_response: "",
      messaging_status: "skipped",
      lead_message_id: undefined,
    };
  }
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

  await reportAMissingCplRate(lead, source_company, sourceAssignment);

  if (sms_consent !== undefined) {
    logger.info({
      msg: "form_lead.sms_consent.received",
      leadId,
      sms_consent,
      email: lead.email,
      phone_number: lead.phone_number,
    });
  }

  const messagingResult = await dispatchOrQueuePersistedLeadMessage(leadMessage);

  // Visible order: sheets then CRM. ADR-0002 wants CRM first — do not
  // silently swap here. Reorder only as a separate, tested change.
  for (const job of jobs) {
    await finalizeSheetSync(job);
  }

  const crmResult = await postTheLeadToGranotWhenDue(
    lead,
    shouldPostToGranot,
    crmLabel,
    {
      leadId,
      crm_company_label,
      duplicate,
    },
  );

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

  await recordWhatTheOwnerNeedsToKnow(pending);

  return {
    lead,
    sheet_sync_status: "pending",
    crm_sync_status: shouldPostToGranot
      ? crmResult.ok
        ? "synced"
        : "failed"
      : "skipped",
    crm_company_label: crmResult.payload.label,
    crm_response: crmResult.responseText || crmResult.error || "",
    messaging_status: messagingResult.status,
    lead_message_id: messagingResult.message_id,
  };
}

async function prepareTheQuoteForIngestion(
  input: CreateFormLeadInput,
): Promise<PreparedQuote> {
  const {
    crm_company_label,
    post_to_granot,
    sms_consent,
    ingestion_source,
    wordpress_submission_key,
    no_sync: _requestedNoSync,
    ...formLeadInput
  } = input;
  const normalized = normalizeTheCustomer(formLeadInput);
  const location = await locateTheMove(normalized);
  const local =
    (ingestion_source === "best_relocation_sheet"
      ? normalized.local
      : undefined) ??
    deriveFormLeadLocal(location.pickup_state, location.delivery_state);
  const { resolution: sourceResolution, assignment: sourceAssignment } =
    await resolveLeadSourceAssignment({
      value: normalized.source_company,
      company_slug: normalized.company_slug,
      granularity_key: normalized.source_granularity_key,
      channel: "form",
      local,
      source_site: normalized.source_company_site,
    });
  const source_company = sourceAssignment.source_company as SourceCompany;
  const leadTimestamp = toFloridaTimestamp(normalized.timestamp);
  const duplicateMatch = await findDuplicateFormLeadMatch(
    {
      sourceCompany: source_company,
      leadSourceCompany: sourceAssignment.lead_source_company,
      sourceGranularityId: sourceAssignment.source_granularity_id,
    },
    normalized.phone_number,
    normalized.email,
    leadTimestamp,
  );
  const duplicate = duplicateMatch.duplicate;
  const shouldPostToGranot = decideWhetherToPostToGranot(
    post_to_granot,
    duplicate,
  );
  const crmLabel = sourceResolution.crm_label_snapshot;
  const cplSnapshot = await resolveLeadCplSnapshot({
    sourceGranularityId: sourceAssignment.source_granularity_id
      ? String(sourceAssignment.source_granularity_id)
      : null,
    storedBusinessTimestamp: leadTimestamp,
  });
  return {
    input,
    normalized,
    location,
    local,
    sourceAssignment,
    source_company,
    leadTimestamp,
    duplicateMatch,
    duplicate,
    shouldPostToGranot,
    crmLabel,
    cplSnapshot,
    lid: giveTheLeadAnIdentity(normalized),
    crm_company_label,
    sms_consent,
    wordpress_submission_key,
  };
}

function normalizeTheCustomer(form: FormLeadPersistInput) {
  const normalized = normalizeLeadName(form);
  normalized.phone_number = normalizePhoneNumberForStorage(
    normalized.phone_number,
  );
  return normalized;
}

async function locateTheMove(form: FormLeadPersistInput) {
  return resolveRequiredLocation(form, { workflow: "form_lead_create" });
}

function decideWhetherToPostToGranot(
  requested: boolean | undefined,
  duplicate: boolean,
): boolean {
  return Boolean(requested) && !duplicate;
}

function giveTheLeadAnIdentity(form: FormLeadPersistInput) {
  return form.lid?.trim() || generateLeadId();
}

async function writeTheFormLead(
  prepared: PreparedQuote,
  tx: FormLeadSession & { ingestion_origin: FormLeadIngestionOrigin },
): Promise<FormLeadIngestionInProgress> {
  const FormLead = getFormLeadModel();
  const created = new FormLead({
    ...prepared.normalized,
    ...prepared.location,
    ...prepared.sourceAssignment,
    local: prepared.local,
    lid: prepared.lid,
    ref_no: prepared.normalized.ref_no?.trim() || "not provided",
    timestamp: prepared.leadTimestamp,
    move_date: prepared.normalized.move_date ?? tx.now,
    ...prepared.cplSnapshot,
    duplicate: prepared.duplicate,
    post_to_granot: prepared.shouldPostToGranot,
    ...formLeadCreationProvenanceFields({
      origin: tx.ingestion_origin,
      now: tx.now,
      contact: {
        first_name: prepared.normalized.first_name,
        last_name: prepared.normalized.last_name,
        name: prepared.normalized.name,
        phone_number: prepared.normalized.phone_number,
        email: prepared.normalized.email,
      },
      move: {
        pickup_city: prepared.normalized.pickup_city,
        pickup_zip: prepared.normalized.pickup_zip,
        pickup_state: prepared.location.pickup_state,
        delivery_city: prepared.normalized.delivery_city,
        destination_zip: prepared.normalized.destination_zip,
        delivery_state: prepared.location.delivery_state,
        move_date: prepared.normalized.move_date ?? tx.now,
        move_size: prepared.normalized.move_size,
      },
    }),
    no_sync: noSyncOnCreate(tx.ingestion_origin, prepared.input.no_sync),
  });
  await created.save({ session: tx.session });

  const leadId = created._id.toString();
  const sheetSyncJobs: FullSheetSyncJob[] = [];
  if (!created.duplicate) {
    const formFillJobs = await markMatchingCallLeadsWithFormFill(
      {
        sourceCompany: prepared.source_company,
        leadSourceCompany: prepared.sourceAssignment.lead_source_company,
      },
      created.phone_number,
      leadId,
      tx.session,
    );
    sheetSyncJobs.push(...formFillJobs);
  }
  if (created.no_sync !== true) {
    const formLeadJob: FullSheetSyncJob = {
      resource: "source_lead",
      operation: "form_lead.create",
      leadModel: "FormLead",
      leadId,
    };
    sheetSyncJobs.push(formLeadJob);
  }
  for (const job of sheetSyncJobs) {
    await persistSheetSyncIntent(job, tx.session);
  }
  const message = await persistLeadMessageIntent({
    formLeadId: leadId,
    destinationPhone: created.phone_number,
    formInput: prepared.input,
    duplicate: created.duplicate,
    testMode: isTestMode(),
    session: tx.session,
  });
  return {
    lead: created,
    jobs: sheetSyncJobs,
    leadMessage: message,
    shouldPostToGranot: prepared.shouldPostToGranot,
    crmLabel: prepared.crmLabel,
    source_company: prepared.source_company,
    sourceAssignment: prepared.sourceAssignment,
    duplicate: prepared.duplicate,
    duplicateMatch: prepared.duplicateMatch,
    crm_company_label: prepared.crm_company_label,
    sms_consent: prepared.sms_consent,
  };
}

async function reportAMissingCplRate(
  lead: FormLeadDocument,
  source_company: SourceCompany,
  sourceAssignment: SourceAssignment,
) {
  if (lead.cpl_resolution_status !== "missing_rate") return;
  await recordMissingLeadCplRate({
    leadModel: "FormLead",
    leadId: lead._id.toString(),
    sourceCompany: source_company,
    sourceGranularityId: sourceAssignment.source_granularity_id
      ? String(sourceAssignment.source_granularity_id)
      : null,
    sourceGranularityKey: sourceAssignment.source_granularity_key,
  });
}

async function postTheLeadToGranotWhenDue(
  lead: FormLeadDocument,
  shouldPostToGranot: boolean,
  crmLabel: string,
  log: {
    leadId: string;
    crm_company_label: string | undefined;
    duplicate: boolean;
  },
): Promise<CrmSubmitResult> {
  if (!shouldPostToGranot) {
    logger.info({
      msg: "crm.form_lead.submit.skipped",
      leadId: log.leadId,
      companyLabel: crmLabel,
      requestedCompanyLabel: log.crm_company_label,
      duplicate: log.duplicate,
    });
    return {
      ok: true,
      status: 0,
      responseText: "",
      payload: buildCrmFormLeadPayload(lead, crmLabel),
    };
  }
  return submitFormLeadToCrm(lead, { companyLabel: crmLabel });
}

async function recordWhatTheOwnerNeedsToKnow(
  pending: FormLeadIngestionInProgress,
) {
  const {
    lead,
    jobs,
    shouldPostToGranot,
    crmLabel,
    source_company,
    duplicate,
    duplicateMatch,
    crm_company_label,
  } = pending;
  const leadId = lead._id.toString();
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
}

// ── 2. Form Lead Correction ───────────────────────────────

export async function correctFormLead(
  id: string,
  input: UpdateFormLeadInput,
  options: {
    expected?: Record<string, unknown>;
    transaction?: FormLeadSession;
  } = {},
) {
  const lead = await loadTheLiveFormLead(id, options.expected, options.transaction);
  refuseIllegalCorrections(lead, input, id);

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

  let job: FullSheetSyncJob;
  try {
    job = options.transaction
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

export async function persistTheCorrectionAndRefreshTheBookingChain(
  lead: FormLeadDocument,
  tx: FormLeadSession,
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

async function loadTheLiveFormLead(
  id: string,
  expected: Record<string, unknown> | undefined,
  transaction: FormLeadSession | undefined,
) {
  const FormLead = getFormLeadModel();
  const lead = expected
    ? await FormLead.findOne({ _id: id, ...expected }).session(
        transaction?.session ?? null,
      )
    : await FormLead.findById(id).session(transaction?.session ?? null);
  if (!lead) {
    if (expected) {
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
  return lead;
}

function refuseIllegalCorrections(
  lead: FormLeadDocument,
  input: UpdateFormLeadInput,
  id: string,
) {
  if (
    lead.duplicate &&
    (input.quoted !== undefined ||
      input.cubic_feet !== undefined ||
      input.receiver_agent_source === "extension_crm_username_match")
  ) {
    throw new ConflictError(
      "Cannot update quoted or cubic_feet on a duplicate form lead",
      {
        metadata: { resource: "form_lead", id, duplicate: true },
      },
    );
  }

  if (
    hasOwnInput(input, "bad_lead") &&
    (lead.duplicate || lead.booked || lead.cancelled)
  ) {
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
}

function applyTheAllowedPatch(
  lead: FormLeadDocument,
  input: UpdateFormLeadInput,
) {
  const update = omitForbiddenLeadLifecycleFields(
    normalizeLeadNameUpdate({ ...input }, lead) as Record<string, unknown>,
  );
  if (input.phone_number !== undefined) {
    update.phone_number = normalizePhoneNumberForStorage(input.phone_number);
  }
  if (input.timestamp !== undefined) {
    update.timestamp = toFloridaTimestamp(input.timestamp);
  }
  Object.assign(lead, update);
}

async function relocateTheMoveIfAddressesChanged(
  lead: FormLeadDocument,
  input: UpdateFormLeadInput,
) {
  if (
    !hasOwnInput(input, "pickup_zip") &&
    !hasOwnInput(input, "destination_zip") &&
    !hasOwnInput(input, "pickup_state") &&
    !hasOwnInput(input, "delivery_state")
  ) {
    return;
  }
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

async function reassignTheSourceIfAttributionChanged(
  lead: FormLeadDocument,
  input: UpdateFormLeadInput,
) {
  if (!hasFormLeadSourceAffectingInput(input) && lead.lead_source_company) {
    return undefined;
  }
  const sourceResolutionForUpdate = await resolveLeadSourceAssignment({
    value: input.source_company ?? lead.source_company,
    company_slug: input.company_slug ?? lead.source_company,
    granularity_key: input.source_granularity_key ?? lead.source_granularity_key,
    channel: "form",
    local: lead.local as LocalType,
    source_site: input.source_company_site ?? lead.source_company_site,
  });
  Object.assign(lead, sourceResolutionForUpdate.assignment);
  return sourceResolutionForUpdate;
}

async function repriceIfTheCostBasisChanged(
  lead: FormLeadDocument,
  input: UpdateFormLeadInput,
  sourceResolutionForUpdate:
    | Awaited<ReturnType<typeof resolveLeadSourceAssignment>>
    | undefined,
) {
  if (sourceResolutionForUpdate === undefined && !hasOwnInput(input, "timestamp")) {
    return;
  }
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

async function assignTheReceiverAgent(
  lead: FormLeadDocument,
  input: UpdateFormLeadInput,
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
  lead: FormLeadDocument,
) {
  return (
    collectDocumentFieldChanges(
      beforeSnapshot,
      lead.toObject() as Record<string, unknown>,
      FORM_LEAD_CHANGE_PATHS,
    ).length === 0
  );
}

function isStateCode(value?: string): value is string {
  return Boolean(value && /^[A-Z]{2}$/.test(value));
}

// ── 3. Lookup ─────────────────────────────────────────────

export async function listRecentFormLeads() {
  const FormLead = getFormLeadModel();
  return FormLead.find().sort({ createdAt: -1 }).limit(200);
}

export async function findFormLeadForEnrichment(id: string) {
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

// ── 4. Removal ────────────────────────────────────────────

export async function removeFormLead(id: string, cascade: boolean) {
  const FormLead = getFormLeadModel();
  const lead = await FormLead.findById(id);
  if (!lead) {
    throw new NotFoundError("Form lead not found", {
      metadata: { resource: "form_lead", id },
    });
  }
  refuseRemovalIfBookedWithoutCascade(lead, cascade, id);
  if (lead.booked && cascade) {
    await deleteBookedLead(lead.booked.toString(), true);
  }

  if (getSheetSyncMode() === "queued") {
    await runSheetSyncWrite(async (session) => {
      await tombstoneSheetSync(lead, id, session);
      await eraseTheFormLead(lead, session);
    });
    await finalizeSheetSyncDelete();
    return;
  }

  await deleteFormLeadFromSheets(lead);
  await eraseTheFormLead(lead);
}

export async function beginFormLeadRemoval(
  id: string,
  cascade: boolean,
  tx: FormLeadSession,
) {
  const FormLead = getFormLeadModel();
  const lead = await FormLead.findById(id).session(tx.session ?? null);
  if (!lead) {
    throw new NotFoundError("Form lead not found", {
      metadata: { resource: "form_lead", id },
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
    { model: "FormLead", id },
  ];
  const { deleteBookedLeadInTransaction } =
    await import("../bookings/bookedLead.service.js");
  let cascaded:
    | Awaited<ReturnType<typeof deleteBookedLeadInTransaction>>
    | undefined;
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
    await tombstoneSheetSync(lead, id, tx.session);
  }
  mutations.push({
    entity: { model: "FormLead", id },
    revision_before: Number(lead.domain_revision ?? 0),
    fields: [{ path: "$deleted" }],
    deleted: true,
  });
  const captured = lead.toObject();
  await eraseTheFormLead(lead, tx.session);
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

function refuseRemovalIfBookedWithoutCascade(
  lead: FormLeadDocument,
  cascade: boolean,
  id: string,
) {
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
}

async function tombstoneSheetSync(
  lead: FormLeadDocument,
  id: string,
  session?: ClientSession,
) {
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
      session,
      targetHints: previousTargets.map((target) => target.target),
    },
  );
}

async function eraseTheFormLead(
  lead: FormLeadDocument,
  session?: ClientSession,
) {
  await lead.deleteOne(session ? { session } : undefined);
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

// ── Compatibility aliases ─────────────────────────────────
// Callers still learning the story names. Remove once existingWrites,
// the v1 facade, and CSV sync have migrated.

export async function createFormLead(input: CreateFormLeadInput) {
  return ingestFormLead(input);
}

export async function createFormLeadInTransaction(
  input: CreateFormLeadInput,
  tx: FormLeadSession & { ingestion_origin: FormLeadIngestionOrigin },
) {
  return beginFormLeadIngestion(input, tx);
}

export async function finalizeFormLeadCreateAfterCommit(
  pending: FormLeadIngestionInProgress,
) {
  return completeFormLeadIngestion(pending);
}

export async function updateFormLead(
  id: string,
  input: UpdateFormLeadInput,
  options: {
    expected?: Record<string, unknown>;
    transaction?: FormLeadSession;
  } = {},
) {
  return correctFormLead(id, input, options);
}

export async function updateFormLeadInTransaction(
  id: string,
  input: UpdateFormLeadInput,
  tx: FormLeadSession,
  options: { expected?: Record<string, unknown> } = {},
) {
  return correctFormLead(id, input, { ...options, transaction: tx });
}

export async function persistFormLeadUpdateInTransaction(
  lead: FormLeadDocument,
  tx: FormLeadSession,
) {
  return persistTheCorrectionAndRefreshTheBookingChain(lead, tx);
}

export async function findAllFormLeads() {
  return listRecentFormLeads();
}

export async function findFormLead(id: string) {
  return findFormLeadForEnrichment(id);
}

export async function deleteFormLead(id: string, cascade: boolean) {
  return removeFormLead(id, cascade);
}

export async function deleteFormLeadInTransaction(
  id: string,
  cascade: boolean,
  tx: FormLeadSession,
) {
  return beginFormLeadRemoval(id, cascade, tx);
}
