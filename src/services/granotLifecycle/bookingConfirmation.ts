import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { getGranotLifecycleFlags, type GranotLifecycleFlags } from "../../config/domain/granotLifecycle";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { Merchant } from "../../models/Merchant";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import type { GranotRecordLinkDocument } from "../../models/GranotRecordLink";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { newObjectIdHex, toObjectId } from "../../utils/objectId";
import { canonicalJson } from "../durableWork/checksum";
import { createGranotLifecycleProcessorActor } from "../durableWork/actors";
import type { DurableActor } from "../durableWork/types";
import {
  BOOKED_LEAD_CHANGE_PATHS,
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
  RECORD_LINK_CHANGE_PATHS,
} from "../domainCommands/entityChange";
import { executeIdempotentCanonicalCommand } from "../domainCommands/idempotency";
import {
  assertOwnerCommandIdempotencyKey,
  type CanonicalCommandContext,
} from "../domainCommands/types";
import { officialBookingAgentIds, officialBookingAllocations } from "../agents";
import { upsertCustomerFromBookingContact } from "../customers";
import { finalizeSheetSync, persistSheetSyncIntent } from "../sheetSync";
import type { GranotLifecycleConfirmBookingCommandInput } from "../../validation/v1/granotLifecycle.validation";
import {
  LEADLESS_CONFIRM_OWNER_NOTICE,
  confirmSheetIntent,
  resolveConfirmAttachment,
  type ConfirmSelectedLead,
} from "./confirmAttachment";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
} from "./errors";
import type { EntityRef, LeadModel, ObservationChannel } from "./types";

const COMMAND_NAME = "confirmGranotBooking";

export type BookingOwnerCommandResult = {
  case_id: string;
  case_state: "resolved";
  case_revision: number;
  outcome: "booking_created" | "booking_updated" | "referral_booking_created" | "no_action" | "already_satisfied";
  command_execution_id: string;
  decision_id: string;
  booking_ref?: { id: string; domain_revision: number };
  record_link_ref?: { id: string; domain_revision: number };
  entity_refs: Array<{ model: string; id: string }>;
  replayed: boolean;
  owner_notice?: string;
  is_leadless_booking?: boolean;
};

export type ConfirmBookingInput = GranotLifecycleConfirmBookingCommandInput & {
  case_id: string;
  idempotency_key: string;
  owner: DurableActor;
  request_id?: string;
};

export async function confirmBooking(
  input: ConfirmBookingInput,
  options: { flags?: GranotLifecycleFlags } = {},
): Promise<BookingOwnerCommandResult> {
  assertOwnerCommandIdempotencyKey(input.idempotency_key);
  assertOwner(input.owner, input.request_id);
  const causal = await loadCausalContext(input.case_id, input.request_id);
  const validatedBody = commandBody(input);
  const context: CanonicalCommandContext = {
    command_id: newObjectIdHex(),
    idempotency_key: input.idempotency_key,
    payload_checksum: createHash("sha256").update(canonicalJson({
      command_name: COMMAND_NAME,
      case_id: input.case_id,
      validated_body: validatedBody,
    })).digest("hex"),
    actor: createGranotLifecycleProcessorActor(causal.receipt_id),
    initiator: input.owner,
    provenance: {
      origin: "granot_lifecycle",
      run_id: null,
      source_receipt_id: causal.receipt_id,
      source_connection_key: null,
      observation_id: causal.observation_id,
      decision_id: causal.decision_id,
      case_id: input.case_id,
      discrepancy_id: null,
      observation_channel: causal.channel,
    },
  };
  const changeIds = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
  ];
  let outcome;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      outcome = await executeIdempotentCanonicalCommand({
        command_name: COMMAND_NAME,
        context,
        operation: ({ session, now, command_execution_id }) => applyConfirmation({
          input,
          flags: options.flags ?? getGranotLifecycleFlags(),
          session,
          now,
          command_execution_id,
          context,
          causal,
          change_ids: changeIds,
        }),
      });
      break;
    } catch (error) {
      if (attempt === 1 || !isDuplicateKey(error)) throw error;
    }
  }
  if (!outcome) throw new Error("Booking confirmation did not produce a command outcome.");

  const execution = await DomainCommandExecution.findOne({
    origin: "granot_lifecycle",
    command_name: COMMAND_NAME,
    idempotency_key: input.idempotency_key,
  }).select({ _id: 1 }).lean().exec();
  const resolvedCase = await getGranotBookingReconciliationCaseModel()
    .findById(input.case_id).lean().exec();
  const bookingId = entityId(outcome.result.entity_refs, "BookedLead");
  const linkId = entityId(outcome.result.entity_refs, "GranotRecordLink");
  const [booking, link] = await Promise.all([
    BookedLead.findById(bookingId).select({ domain_revision: 1, is_leadless_booking: 1 }).lean().exec(),
    getGranotRecordLinkModel().findById(linkId).select({ domain_revision: 1 }).lean().exec(),
  ]);
  if (!execution || !resolvedCase?.resolution || !booking || !link) {
    throw new Error("Committed Booking confirmation evidence could not be reloaded.");
  }
  const leadless = booking.is_leadless_booking === true;
  if (!outcome.replayed && resolvedCase.resolution.outcome === "booking_created") {
    await finalizeSheetSync({ ...confirmSheetIntent(leadless), bookingId });
  }
  return {
    case_id: input.case_id,
    case_state: "resolved",
    case_revision: resolvedCase.case_revision,
    outcome: resolvedCase.resolution.outcome === "already_satisfied"
      ? "already_satisfied"
      : "booking_created",
    command_execution_id: String(execution._id),
    decision_id: causal.decision_id,
    booking_ref: { id: bookingId, domain_revision: booking.domain_revision },
    record_link_ref: { id: linkId, domain_revision: link.domain_revision },
    entity_refs: outcome.result.entity_refs.map((row) => ({ ...row })),
    replayed: outcome.replayed,
    is_leadless_booking: leadless,
    ...(leadless && resolvedCase.resolution.outcome === "booking_created"
      ? { owner_notice: LEADLESS_CONFIRM_OWNER_NOTICE }
      : {}),
  };
}

async function applyConfirmation(input: {
  input: ConfirmBookingInput;
  flags: GranotLifecycleFlags;
  session: ClientSession;
  now: Date;
  command_execution_id: mongoose.Types.ObjectId;
  context: CanonicalCommandContext;
  causal: Awaited<ReturnType<typeof loadCausalContext>>;
  change_ids: mongoose.Types.ObjectId[];
}) {
  const Case = getGranotBookingReconciliationCaseModel();
  const caseRow = await Case.findById(input.input.case_id).session(input.session).lean().exec();
  if (!caseRow) throw lifecycle("Granot reconciliation case not found", "CASE_NOT_FOUND", 404, input.input.request_id);
  if (
    caseRow.action_kind !== "booked" ||
    caseRow.mode !== "create_missing_booking" ||
    caseRow.state !== "open" ||
    caseRow.case_revision !== input.input.expected_case_revision
  ) {
    throw lifecycle("Granot reconciliation case revision changed", "CASE_REVISION_CONFLICT", 409, input.input.request_id);
  }
  if (!input.flags.booking_commands_enabled) {
    throw lifecycle("Granot Booking commands are disabled", "POLICY_BLOCKED", 422, input.input.request_id);
  }
  if (!caseRow.source_scope) {
    throw lifecycle("Booking case has no reviewed source scope", "POLICY_BLOCKED", 422, input.input.request_id);
  }
  assertStableCausalEvidence(caseRow, input.causal);
  const attachment = resolveConfirmAttachment({
    selected_lead: input.input.selected_lead,
    suggested_lead: caseRow.suggested_lead
      ? {
          lead_ref: {
            model: caseRow.suggested_lead.lead_ref.model,
            id: caseRow.suggested_lead.lead_ref.id,
          },
          confidence: caseRow.suggested_lead.confidence,
          match_method: caseRow.suggested_lead.match_method,
        }
      : undefined,
  });
  const selectedLead = attachment.kind === "attach" ? attachment.selected_lead : undefined;
  const source = await loadActiveSourceScope(
    caseRow.source_scope,
    attachment.kind === "attach" ? attachment.selected_lead.lead_model : undefined,
    input.session,
    input.input.request_id,
  );
  const catalogs = await loadActiveCatalog(input.input.official_booking_details, input.session, input.input.request_id);
  const activeLink = await getGranotRecordLinkModel().findOne({
    provider: "granot",
    normalized_job_no: caseRow.normalized_job_no,
    state: "active",
  }).session(input.session).lean().exec();
  const existingByJob = await BookedLead.findOne({ normalized_job_no: caseRow.normalized_job_no })
    .session(input.session).lean().exec();
  assertCompatibleLink(activeLink, caseRow, existingByJob?._id, input.input.request_id);

  if (attachment.kind === "leadless" || !selectedLead) {
    return persistLeadlessConfirmation({
      input,
      caseRow,
      source,
      catalogs,
      activeLink,
      existingByJob,
    });
  }

  const leadBefore = await loadLead(selectedLead, input.session);
  if (!leadBefore || leadBefore.duplicate === true || ("bad_lead" in leadBefore && leadBefore.bad_lead != null)) {
    throw lifecycle("Selected Lead is not eligible", "IDENTITY_CONFLICT", 409, input.input.request_id);
  }
  const inScope = String(leadBefore.lead_source_company ?? "") === String(caseRow.source_scope.lead_source_company) &&
    String(leadBefore.source_granularity_id ?? "") === String(caseRow.source_scope.source_granularity_id);
  if (!inScope && !validOverride(input.input.out_of_scope_override_reason)) {
    throw lifecycle("Out-of-scope Lead selection requires an override reason", "VALIDATION_FAILED", 400, input.input.request_id, [
      { path: "out_of_scope_override_reason", message: "must be 10-500 trimmed characters for all-scope selection" },
    ]);
  }
  if (leadBefore.cancelled) {
    throw lifecycle("Selected Lead is already cancelled", "IDENTITY_CONFLICT", 409, input.input.request_id);
  }
  if (existingByJob) {
    if (!sameOfficialBooking(existingByJob, input.input, catalogs.merchant_name) ||
      String(existingByJob.lead_ref ?? "") !== selectedLead.lead_id ||
      existingByJob.lead_model !== selectedLead.lead_model ||
      !activeLink || String(activeLink.booking_ref ?? "") !== String(existingByJob._id) ||
      !sameLeadRef(activeLink.lead_ref, selectedLead)) {
      throw lifecycle("A conflicting Booking or Record Link already exists", "IDENTITY_CONFLICT", 409, input.input.request_id);
    }
    await resolveCase({
      case_id: caseRow._id,
      expected_revision: input.input.expected_case_revision,
      outcome: "already_satisfied",
      booking_id: existingByJob._id,
      link_id: activeLink._id,
      command_execution_id: input.command_execution_id,
      actor: input.input.owner,
      now: input.now,
      session: input.session,
    });
    return { entity_refs: refs(caseRow._id, existingByJob._id, selectedLead, activeLink._id), warnings: [] };
  }
  if (leadBefore.booked || await BookedLead.exists({
    lead_ref: toObjectId(selectedLead.lead_id),
    lead_model: selectedLead.lead_model,
  }).session(input.session)) {
    throw lifecycle("Selected Lead is already attached to another Booking", "IDENTITY_CONFLICT", 409, input.input.request_id);
  }

  const booking = new BookedLead({
    _id: new mongoose.Types.ObjectId(),
    timestamp: input.now,
    book_date: new Date(`${input.input.official_booking_details.book_date}T00:00:00.000Z`),
    job_no: caseRow.job_no_snapshot,
    lead_ref: leadBefore._id,
    lead_model: selectedLead.lead_model,
    customer_name: leadDisplayName(leadBefore),
    agent_allocations: officialBookingAllocations(input.input.official_booking_details).map((row) => ({
      agent: toObjectId(row.agent_id),
      agent_name_snapshot: catalogs.agent_names.get(row.agent_id)!,
      binder_amount: cents(row.binder_amount) / 100,
    })),
    total_binder_amount: cents(input.input.official_booking_details.total_binder_amount) / 100,
    deposit_amount: cents(input.input.official_booking_details.deposit_amount) / 100,
    merchant: catalogs.merchant_name,
    source: source.company_slug,
    local: leadBefore.local,
    over_2000: input.input.official_booking_details.deposit_amount > 2000,
    over_4000: input.input.official_booking_details.deposit_amount > 4000,
    is_referral_booking: false,
    is_leadless_booking: false,
    domain_revision: 0,
  });
  await booking.save({ session: input.session });

  const leadUpdate = await updateLeadForBooking(selectedLead.lead_model,
    {
      _id: leadBefore._id,
      domain_revision: Number(leadBefore.domain_revision ?? 0),
      duplicate: { $ne: true },
      $and: [
        { $or: [{ booked: null }, { booked: { $exists: false } }] },
        { $or: [{ cancelled: null }, { cancelled: { $exists: false } }] },
      ],
      ...(selectedLead.lead_model === "FormLead" ? { bad_lead: { $in: [null, ""] } } : {}),
    },
    { $set: { booked: booking._id, over_2000: booking.over_2000, over_4000: booking.over_4000 } },
    input.session,
  );
  if (leadUpdate.matchedCount !== 1) {
    throw lifecycle("Selected Lead revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.input.request_id);
  }
  const leadAfter = await loadLead(selectedLead, input.session);
  if (!leadAfter) throw new Error("Selected Lead disappeared during Booking confirmation.");

  const link = await persistLink({
    current: activeLink,
    case_row: caseRow,
    selected_lead: selectedLead,
    booking_id: booking._id,
    causal: input.causal,
    now: input.now,
    session: input.session,
    request_id: input.input.request_id,
  });
  const bookingAfter = booking.toObject() as Record<string, unknown>;
  const mutations = [
    {
      change_id: input.change_ids[0]!, entity: { model: "BookedLead" as const, id: String(booking._id) }, revision_before: 0,
      fields: collectDocumentFieldChanges(null, bookingAfter, BOOKED_LEAD_CHANGE_PATHS),
    },
    {
      change_id: input.change_ids[1]!, entity: { model: selectedLead.lead_model, id: selectedLead.lead_id },
      revision_before: Number(leadBefore.domain_revision ?? 0),
      fields: collectDocumentFieldChanges(leadBefore as Record<string, unknown>, leadAfter as Record<string, unknown>,
        selectedLead.lead_model === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS),
    },
    {
      change_id: input.change_ids[2]!, entity: { model: "GranotRecordLink" as const, id: String(link.after._id) },
      revision_before: Number(link.before?.domain_revision ?? 0),
      fields: collectDocumentFieldChanges(link.before as Record<string, unknown> | null, link.after as Record<string, unknown>, RECORD_LINK_CHANGE_PATHS),
    },
  ];
  await persistEntityChangeMutations({
    session: input.session,
    now: input.now,
    command_name: COMMAND_NAME,
    command_execution_id: input.command_execution_id,
    context: input.context,
    mutations,
  });
  await resolveCase({
    case_id: caseRow._id,
    expected_revision: input.input.expected_case_revision,
    outcome: "booking_created",
    booking_id: booking._id,
    link_id: link.after._id,
    command_execution_id: input.command_execution_id,
    actor: input.input.owner,
    now: input.now,
    session: input.session,
  });
  await persistSheetSyncIntent({
    ...confirmSheetIntent(false),
    bookingId: String(booking._id),
  }, input.session);
  return { entity_refs: refs(caseRow._id, booking._id, selectedLead, link.after._id), warnings: [] };
}

async function persistLeadlessConfirmation(input: {
  input: Parameters<typeof applyConfirmation>[0];
  caseRow: import("../../models/GranotBookingReconciliationCase").GranotBookingReconciliationCaseDocument;
  source: { company_slug: string };
  catalogs: Awaited<ReturnType<typeof loadActiveCatalog>>;
  activeLink: GranotRecordLinkDocument | null;
  existingByJob: Record<string, unknown> | null;
}) {
  const { caseRow, source, catalogs, activeLink, existingByJob } = input;
  if (existingByJob) {
    if (
      existingByJob.is_leadless_booking !== true ||
      existingByJob.lead_ref ||
      existingByJob.lead_model ||
      existingByJob.is_referral_booking === true ||
      !sameOfficialBooking(existingByJob, input.input.input, catalogs.merchant_name) ||
      !activeLink || String(activeLink.booking_ref ?? "") !== String(existingByJob._id) ||
      activeLink.lead_ref
    ) {
      throw lifecycle("A conflicting Booking or Record Link already exists", "IDENTITY_CONFLICT", 409, input.input.input.request_id);
    }
    await resolveCase({
      case_id: caseRow._id,
      expected_revision: input.input.input.expected_case_revision,
      outcome: "already_satisfied",
      booking_id: existingByJob._id as mongoose.Types.ObjectId,
      link_id: activeLink._id,
      command_execution_id: input.input.command_execution_id,
      actor: input.input.input.owner,
      now: input.input.now,
      session: input.input.session,
    });
    return { entity_refs: refs(caseRow._id, existingByJob._id as mongoose.Types.ObjectId, undefined, activeLink._id), warnings: [] };
  }

  const observation = await getGranotObservationModel()
    .findById(input.input.causal.observation_id)
    .session(input.input.session)
    .lean()
    .exec();
  const contact = observation?.contact;
  const customerName = contact?.display_name
    || [contact?.first_name, contact?.last_name].filter(Boolean).join(" ")
    || undefined;
  const customer = customerName
    ? await upsertCustomerFromBookingContact(
        { customer_name: customerName, customer_phone: contact?.phone_raw },
        input.input.session,
      )
    : undefined;

  const booking = new BookedLead({
    _id: new mongoose.Types.ObjectId(),
    timestamp: input.input.now,
    book_date: new Date(`${input.input.input.official_booking_details.book_date}T00:00:00.000Z`),
    job_no: caseRow.job_no_snapshot,
    ...(customerName ? { customer_name: customerName } : {}),
    ...(customer ? { customer: customer._id } : {}),
    agent_allocations: officialBookingAllocations(input.input.input.official_booking_details).map((row) => ({
      agent: toObjectId(row.agent_id),
      agent_name_snapshot: catalogs.agent_names.get(row.agent_id)!,
      binder_amount: cents(row.binder_amount) / 100,
    })),
    total_binder_amount: cents(input.input.input.official_booking_details.total_binder_amount) / 100,
    deposit_amount: cents(input.input.input.official_booking_details.deposit_amount) / 100,
    merchant: catalogs.merchant_name,
    source: source.company_slug,
    over_2000: input.input.input.official_booking_details.deposit_amount > 2000,
    over_4000: input.input.input.official_booking_details.deposit_amount > 4000,
    is_referral_booking: false,
    is_leadless_booking: true,
    domain_revision: 0,
  });
  await booking.save({ session: input.input.session });

  const link = await persistLink({
    current: activeLink,
    case_row: caseRow,
    selected_lead: undefined,
    booking_id: booking._id,
    causal: input.input.causal,
    now: input.input.now,
    session: input.input.session,
    request_id: input.input.input.request_id,
  });
  await persistEntityChangeMutations({
    session: input.input.session,
    now: input.input.now,
    command_name: COMMAND_NAME,
    command_execution_id: input.input.command_execution_id,
    context: input.input.context,
    mutations: [
      {
        change_id: input.input.change_ids[0]!,
        entity: { model: "BookedLead" as const, id: String(booking._id) },
        revision_before: 0,
        fields: collectDocumentFieldChanges(null, booking.toObject() as Record<string, unknown>, BOOKED_LEAD_CHANGE_PATHS),
      },
      {
        change_id: input.input.change_ids[2]!,
        entity: { model: "GranotRecordLink" as const, id: String(link.after._id) },
        revision_before: Number(link.before?.domain_revision ?? 0),
        fields: collectDocumentFieldChanges(
          link.before as Record<string, unknown> | null,
          link.after as Record<string, unknown>,
          RECORD_LINK_CHANGE_PATHS,
        ),
      },
    ],
  });
  await resolveCase({
    case_id: caseRow._id,
    expected_revision: input.input.input.expected_case_revision,
    outcome: "booking_created",
    booking_id: booking._id,
    link_id: link.after._id,
    command_execution_id: input.input.command_execution_id,
    actor: input.input.input.owner,
    now: input.input.now,
    session: input.input.session,
  });
  await persistSheetSyncIntent({
    ...confirmSheetIntent(true),
    bookingId: String(booking._id),
  }, input.input.session);
  return { entity_refs: refs(caseRow._id, booking._id, undefined, link.after._id), warnings: [] };
}

async function loadCausalContext(caseId: string, requestId?: string) {
  const row = await getGranotBookingReconciliationCaseModel().findById(caseId).lean().exec();
  if (!row) throw lifecycle("Granot reconciliation case not found", "CASE_NOT_FOUND", 404, requestId);
  const first = row.evidence[0];
  if (!first) throw lifecycle("Booking case has no causal evidence", "IDENTITY_CONFLICT", 409, requestId);
  const observation = await getGranotObservationModel().findById(first.observation_id).lean().exec();
  if (!observation) throw lifecycle("Booking case Observation is unavailable", "IDENTITY_CONFLICT", 409, requestId);
  const receipt = await getGranotObservationReceiptModel().findById(observation.receipt_id).lean().exec();
  if (!receipt) throw lifecycle("Booking case Receipt is unavailable", "IDENTITY_CONFLICT", 409, requestId);
  return {
    receipt_id: String(receipt._id),
    observation_id: String(first.observation_id),
    decision_id: String(first.decision_id),
    channel: receipt.observation_channel as ObservationChannel,
  };
}

async function loadActiveSourceScope(scope: NonNullable<Awaited<ReturnType<typeof getGranotBookingReconciliationCaseModel>> extends never ? never : import("../../models/GranotBookingReconciliationCase").GranotBookingReconciliationCaseDocument["source_scope"]>, leadModel: LeadModel | undefined, session: ClientSession, requestId?: string) {
  const [granotSource, company, granularity] = await Promise.all([
    getGranotCrmSourceModel().findOne({
      _id: scope.granot_crm_source_id,
      enabled: true,
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_source_company: scope.lead_source_company,
    }).session(session).lean().exec(),
    getLeadSourceCompanyModel().findOne({ _id: scope.lead_source_company, active: true }).session(session).lean().exec(),
    getLeadSourceGranularityModel().findOne({
      _id: scope.source_granularity_id,
      source_company: scope.lead_source_company,
      active: true,
      ...(leadModel ? { channel: leadModel === "FormLead" ? "form" : "call" } : {}),
    }).session(session).lean().exec(),
  ]);
  if (!granotSource || !company || !granularity) {
    throw lifecycle("Reviewed Booking source policy is no longer active", "POLICY_BLOCKED", 422, requestId);
  }
  return { company_slug: company.company_slug };
}

async function loadActiveCatalog(details: ConfirmBookingInput["official_booking_details"], session: ClientSession, requestId?: string) {
  const ids = officialBookingAgentIds(details).map((id) => toObjectId(id));
  const [agents, merchant] = await Promise.all([
    Agent.find({ _id: { $in: ids }, active: true }).session(session).lean().exec(),
    Merchant.findOne({ _id: toObjectId(details.merchant_id), active: true }).session(session).lean().exec(),
  ]);
  if (agents.length !== ids.length || !merchant) {
    throw lifecycle("Submitted Agent or Merchant is unknown or inactive", "VALIDATION_FAILED", 400, requestId);
  }
  return {
    agent_names: new Map(agents.map((row) => [String(row._id), row.name])),
    merchant_name: merchant.name,
  };
}

async function persistLink(input: {
  current: GranotRecordLinkDocument | null;
  case_row: import("../../models/GranotBookingReconciliationCase").GranotBookingReconciliationCaseDocument;
  selected_lead?: ConfirmSelectedLead;
  booking_id: mongoose.Types.ObjectId;
  causal: Awaited<ReturnType<typeof loadCausalContext>>;
  now: Date;
  session: ClientSession;
  request_id?: string;
}) {
  const Link = getGranotRecordLinkModel();
  const before = input.current;
  if (!before) {
    const [created] = await Link.create([{
      provider: "granot",
      normalized_job_no: input.case_row.normalized_job_no,
      job_no_snapshot: input.case_row.job_no_snapshot,
      state: "active",
      ...(input.selected_lead
        ? { lead_ref: { model: input.selected_lead.lead_model, id: toObjectId(input.selected_lead.lead_id) } }
        : {}),
      booking_ref: input.booking_id,
      source_scope: input.case_row.source_scope ? {
        lead_source_company: input.case_row.source_scope.lead_source_company,
        source_granularity_id: input.case_row.source_scope.source_granularity_id,
      } : undefined,
      disputed: false,
      established_by_decision_id: toObjectId(input.causal.decision_id),
      established_at: input.now,
      last_observation_id: toObjectId(input.causal.observation_id),
      last_observed_at: input.now,
      domain_revision: 0,
    }], { session: input.session });
    if (!created) throw new Error("Record Link creation returned no row.");
    return { before: null, after: created.toObject() };
  }
  // Command-owned CAS seam: ordinary model updates intentionally forbid booking_ref.
  const updated = await Link.collection.updateOne(
    { _id: before._id, state: "active", domain_revision: before.domain_revision },
    { $set: {
      ...(input.selected_lead
        ? { lead_ref: { model: input.selected_lead.lead_model, id: toObjectId(input.selected_lead.lead_id) } }
        : {}),
      booking_ref: input.booking_id,
      disputed: false,
      dispute_reason: undefined,
      last_observation_id: toObjectId(input.causal.observation_id),
      last_observed_at: input.now,
    } },
    { session: input.session },
  );
  if (updated.matchedCount !== 1) throw lifecycle("Record Link revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
  const after = await Link.findById(before._id).session(input.session).lean().exec();
  if (!after) throw new Error("Updated Record Link could not be reloaded.");
  return { before, after };
}

async function resolveCase(input: {
  case_id: mongoose.Types.ObjectId; expected_revision: number;
  outcome: "booking_created" | "already_satisfied";
  booking_id: mongoose.Types.ObjectId; link_id: mongoose.Types.ObjectId;
  command_execution_id: mongoose.Types.ObjectId; actor: DurableActor; now: Date; session: ClientSession;
}) {
  const result = await getGranotBookingReconciliationCaseModel().updateOne(
    { _id: input.case_id, state: "open", case_revision: input.expected_revision },
    { $set: {
      state: "resolved", resolved_at: input.now,
      deterministic_booking_id: input.booking_id, record_link_id: input.link_id,
      resolution: {
        outcome: input.outcome,
        command_execution_id: input.command_execution_id,
        actor: input.actor,
        resolved_at: input.now,
        entity_ref: { model: "BookedLead", id: String(input.booking_id) },
      },
    }, $inc: { case_revision: 1 } },
    { session: input.session },
  );
  if (result.matchedCount !== 1) throw lifecycle("Granot reconciliation case revision changed", "CASE_REVISION_CONFLICT", 409);
}

function assertCompatibleLink(link: Record<string, unknown> | null, caseRow: import("../../models/GranotBookingReconciliationCase").GranotBookingReconciliationCaseDocument, existingBookingId?: mongoose.Types.ObjectId, requestId?: string) {
  if (!link) return;
  const scope = link.source_scope as { lead_source_company?: unknown; source_granularity_id?: unknown } | undefined;
  const permittedBookingId = existingBookingId ?? caseRow.deterministic_booking_id;
  if ((link.booking_ref && String(link.booking_ref) !== String(permittedBookingId ?? "")) ||
    (scope && (String(scope.lead_source_company ?? "") !== String(caseRow.source_scope?.lead_source_company ?? "") ||
      String(scope.source_granularity_id ?? "") !== String(caseRow.source_scope?.source_granularity_id ?? "")))) {
    throw lifecycle("Record Link has an incompatible Booking or source claim", "IDENTITY_CONFLICT", 409, requestId);
  }
}

function sameOfficialBooking(row: Record<string, unknown>, input: ConfirmBookingInput, merchantName: string) {
  const date = row.book_date instanceof Date ? row.book_date.toISOString().slice(0, 10) : new Date(String(row.book_date)).toISOString().slice(0, 10);
  const allocations = (row.agent_allocations as Array<{ agent: unknown; binder_amount: number }> ?? []);
  const desired = officialBookingAllocations(input.official_booking_details);
  return date === input.official_booking_details.book_date &&
    cents(Number(row.total_binder_amount)) === cents(input.official_booking_details.total_binder_amount) &&
    cents(Number(row.deposit_amount)) === cents(input.official_booking_details.deposit_amount) &&
    row.merchant === merchantName && allocations.length === desired.length &&
    allocations.every((allocation, index) => String(allocation.agent) === desired[index]?.agent_id &&
      cents(allocation.binder_amount) === cents(desired[index]!.binder_amount));
}

async function loadLead(selected: ConfirmSelectedLead, session: ClientSession): Promise<Record<string, unknown> | null> {
  if (selected.lead_model === "FormLead") {
    return getFormLeadModel().findById(selected.lead_id).session(session).lean().exec() as Promise<Record<string, unknown> | null>;
  }
  return getCallLeadModel().findById(selected.lead_id).session(session).lean().exec() as Promise<Record<string, unknown> | null>;
}

async function updateLeadForBooking(
  model: LeadModel,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  session: ClientSession,
) {
  return model === "FormLead"
    ? getFormLeadModel().collection.updateOne(filter, update, { session })
    : getCallLeadModel().collection.updateOne(filter, update, { session });
}

function commandBody(input: ConfirmBookingInput): GranotLifecycleConfirmBookingCommandInput {
  return {
    expected_case_revision: input.expected_case_revision,
    ...(input.selected_lead ? { selected_lead: input.selected_lead } : {}),
    ...(input.out_of_scope_override_reason ? { out_of_scope_override_reason: input.out_of_scope_override_reason.trim() } : {}),
    official_booking_details: input.official_booking_details,
  };
}
function cents(value: number) { return Math.round(value * 100); }
function validOverride(value?: string) { return Boolean(value && value === value.trim() && value.length >= 10 && value.length <= 500); }
function sameLeadRef(ref: unknown, selected: ConfirmSelectedLead) {
  const row = ref as { model?: unknown; id?: unknown } | undefined;
  return row?.model === selected.lead_model && String(row.id ?? "") === selected.lead_id;
}
function leadDisplayName(lead: Record<string, unknown>) {
  return String(lead.name ?? [lead.first_name, lead.last_name].filter(Boolean).join(" ") ?? "").trim() || undefined;
}
function refs(caseId: mongoose.Types.ObjectId, bookingId: mongoose.Types.ObjectId, selected: ConfirmSelectedLead | undefined, linkId: mongoose.Types.ObjectId): EntityRef[] {
  return [
    { model: "GranotBookingReconciliationCase", id: String(caseId) },
    { model: "BookedLead", id: String(bookingId) },
    ...(selected ? [{ model: selected.lead_model, id: selected.lead_id }] : []),
    { model: "GranotRecordLink", id: String(linkId) },
  ];
}
function entityId(rows: readonly { model: string; id: string }[], model: string) {
  const row = rows.find((entry) => entry.model === model);
  if (!row) throw new Error(`Committed command result omitted ${model}.`);
  return row.id;
}
function assertOwner(owner: DurableActor, requestId?: string) {
  if (owner.actor_type !== "owner" || owner.actor_role !== "owner" || owner.origin !== "vantage_admin") {
    throw lifecycle("Owner authority is required", "OWNER_REQUIRED", 403, requestId);
  }
}
function assertStableCausalEvidence(row: import("../../models/GranotBookingReconciliationCase").GranotBookingReconciliationCaseDocument, causal: Awaited<ReturnType<typeof loadCausalContext>>) {
  const first = row.evidence[0];
  if (!first || String(first.observation_id) !== causal.observation_id || String(first.decision_id) !== causal.decision_id) {
    throw lifecycle("Booking case causal evidence changed", "IDENTITY_CONFLICT", 409);
  }
}
function isDuplicateKey(error: unknown) { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000); }
function lifecycle(message: string, key: keyof typeof GRANOT_LIFECYCLE_ERROR_CODES, status: number, requestId?: string, issues?: Array<{ path?: string; message: string }>) {
  return new GranotLifecycleError(message, GRANOT_LIFECYCLE_ERROR_CODES[key], status, requestId, issues);
}
