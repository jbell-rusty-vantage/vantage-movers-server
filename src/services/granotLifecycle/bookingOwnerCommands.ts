import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { getGranotLifecycleFlags, type GranotLifecycleFlags } from "../../config/domain/granotLifecycle";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { Merchant } from "../../models/Merchant";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import {
  getGranotBookingReconciliationCaseModel,
  type GranotBookingReconciliationCaseDocument,
} from "../../models/GranotBookingReconciliationCase";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { officialBookingAgentIds, officialBookingAllocations } from "../agents";
import { toObjectId } from "../../utils/objectId";
import type {
  GranotLifecycleBookingNoActionCommandInput,
  GranotLifecycleOfficialBookingDetails,
  GranotLifecycleUpdateBookingCommandInput,
} from "../../validation/v1/granotLifecycle.validation";
import { canonicalJson } from "../durableWork/checksum";
import { createGranotLifecycleProcessorActor } from "../durableWork/actors";
import type { DurableActor } from "../durableWork/types";
import {
  BOOKED_LEAD_CHANGE_PATHS,
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
  type AggregateMutationPlan,
} from "../domainCommands/entityChange";
import { executeIdempotentCanonicalCommand } from "../domainCommands/idempotency";
import {
  assertOwnerCommandIdempotencyKey,
  type CanonicalCommandContext,
} from "../domainCommands/types";
import { finalizeSheetSync, persistSheetSyncIntent } from "../sheetSync";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
} from "./errors";
import type { BookingOwnerCommandResult } from "./bookingConfirmation";
import type { LeadModel, ObservationChannel } from "./types";

export const UPDATE_BOOKING_COMMAND_NAME = "updateBooking";
export const BOOKING_NO_ACTION_COMMAND_NAME = "resolveGranotBookingCaseNoAction";

type OwnerEnvelope = {
  case_id: string;
  idempotency_key: string;
  owner: DurableActor;
  request_id?: string;
};

export type UpdateExistingBookingInput = GranotLifecycleUpdateBookingCommandInput & OwnerEnvelope;
export type BookingNoActionInput = GranotLifecycleBookingNoActionCommandInput & OwnerEnvelope;
type UpdateFailurePoint = "booking" | "lead" | "changes" | "case" | "outbox";

export async function updateExistingBooking(
  input: UpdateExistingBookingInput,
  options: { flags?: GranotLifecycleFlags; test_fail_after?: UpdateFailurePoint } = {},
): Promise<BookingOwnerCommandResult> {
  const causal = await prepareOwnerCommand(input, UPDATE_BOOKING_COMMAND_NAME, updateBody(input));
  const changeIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: UPDATE_BOOKING_COMMAND_NAME,
    context: causal.context,
    operation: ({ session, now, command_execution_id }) => applyUpdate({
      input,
      flags: options.flags ?? getGranotLifecycleFlags(),
      session,
      now,
      command_execution_id,
      context: causal.context,
      causal,
      change_ids: changeIds,
      test_fail_after: options.test_fail_after,
    }),
  });
  const result = await reloadResult(input.case_id, outcome.result.entity_refs, causal.decision_id, outcome.replayed);
  if (!outcome.replayed && result.outcome === "booking_updated" && result.booking_ref) {
    const updatedBooking = await BookedLead.findById(result.booking_ref.id)
      .select({ is_referral_booking: 1 }).lean().exec();
    await finalizeSheetSync(updatedBooking?.is_referral_booking === true
      ? {
          resource: "booked_lead",
          operation: "referral_booking.update",
          bookingId: result.booking_ref.id,
        }
      : {
          resource: "booking_chain",
          operation: "booked_lead.update",
          bookingId: result.booking_ref.id,
        });
  }
  return result;
}

export async function noAction(
  input: BookingNoActionInput,
  options: { flags?: GranotLifecycleFlags; test_fail_after_case?: boolean } = {},
): Promise<BookingOwnerCommandResult> {
  const causal = await prepareOwnerCommand(input, BOOKING_NO_ACTION_COMMAND_NAME, noActionBody(input));
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: BOOKING_NO_ACTION_COMMAND_NAME,
    context: causal.context,
    operation: ({ session, now, command_execution_id }) => applyNoAction({
      input,
      flags: options.flags ?? getGranotLifecycleFlags(),
      session,
      now,
      command_execution_id,
      causal,
      test_fail_after_case: options.test_fail_after_case,
    }),
  });
  return reloadResult(input.case_id, outcome.result.entity_refs, causal.decision_id, outcome.replayed);
}

async function applyUpdate(input: {
  input: UpdateExistingBookingInput;
  flags: GranotLifecycleFlags;
  session: ClientSession;
  now: Date;
  command_execution_id: mongoose.Types.ObjectId;
  context: CanonicalCommandContext;
  causal: Awaited<ReturnType<typeof prepareOwnerCommand>>;
  change_ids: mongoose.Types.ObjectId[];
  test_fail_after?: UpdateFailurePoint;
}) {
  const caseRow = await loadOpenCase(input.input, input.session, ["review_existing_booking"]);
  assertCommandAllowed(caseRow, input.flags, input.input.request_id);
  if (!caseRow.deterministic_booking_id) {
    throw lifecycle("Booking case has no deterministic Booking", "IDENTITY_CONFLICT", 409, input.input.request_id);
  }
  const bookingBefore = await BookedLead.findById(caseRow.deterministic_booking_id)
    .session(input.session).lean().exec();
  if (
    !bookingBefore || bookingBefore.cancelled ||
    bookingBefore.domain_revision !== input.input.expected_booking_revision
  ) {
    throw lifecycle("Booking revision changed or Booking is no longer active", "DOMAIN_REVISION_CONFLICT", 409, input.input.request_id);
  }
  const referral = bookingBefore.is_referral_booking === true;
  const companySlug = referral
    ? await assertActiveReferralPolicy(caseRow, input.session, input.input.request_id)
    : await assertActiveSourceScope(caseRow, input.session, input.input.request_id);
  if (
    bookingBefore.normalized_job_no !== caseRow.normalized_job_no ||
    bookingBefore.source !== companySlug ||
    bookingBefore.is_leadless_booking ||
    (!referral && (!bookingBefore.lead_ref || !bookingBefore.lead_model)) ||
    (referral && (Boolean(bookingBefore.lead_ref) || Boolean(bookingBefore.lead_model)))
  ) {
    throw lifecycle("Deterministic Booking identity is incompatible with the case", "IDENTITY_CONFLICT", 409, input.input.request_id);
  }
  const leadBefore = !referral && bookingBefore.lead_model && bookingBefore.lead_ref
    ? await loadLead(bookingBefore.lead_model, bookingBefore.lead_ref, input.session)
    : null;
  if (!referral && (
    !leadBefore || String(leadBefore.booked ?? "") !== String(bookingBefore._id) ||
    String(leadBefore.lead_source_company ?? "") !== String(caseRow.source_scope?.lead_source_company ?? "") ||
    String(leadBefore.source_granularity_id ?? "") !== String(caseRow.source_scope?.source_granularity_id ?? "")
  )) {
    throw lifecycle("Booking Lead or source identity is incompatible with the case", "IDENTITY_CONFLICT", 409, input.input.request_id);
  }
  const link = await loadAndAssertLink(caseRow, bookingBefore, input.session, input.input.request_id);
  const catalogs = await loadActiveCatalog(input.input.official_booking_details, input.session, input.input.request_id);
  const desired = desiredBooking(input.input.official_booking_details, catalogs);
  const bookingSatisfied = sameOfficialBooking(bookingBefore, desired);
  const leadSatisfied = referral || (Boolean(leadBefore?.over_2000) === desired.over_2000 &&
    Boolean(leadBefore?.over_4000) === desired.over_4000);
  if (bookingSatisfied && leadSatisfied) {
    await resolveCase({
      case_row: caseRow,
      command_execution_id: input.command_execution_id,
      actor: input.input.owner,
      outcome: "already_satisfied",
      booking_id: bookingBefore._id,
      now: input.now,
      session: input.session,
    });
    return { entity_refs: ownerRefs(caseRow, bookingBefore._id, bookingBefore.lead_model, bookingBefore.lead_ref, link?._id), warnings: [] };
  }

  const bookingWrite = await BookedLead.collection.updateOne(
    {
      _id: bookingBefore._id,
      domain_revision: input.input.expected_booking_revision,
      normalized_job_no: caseRow.normalized_job_no,
      $or: [{ cancelled: null }, { cancelled: { $exists: false } }],
    },
    { $set: desired },
    { session: input.session },
  );
  if (bookingWrite.matchedCount !== 1) {
    throw lifecycle("Booking revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.input.request_id);
  }
  failAfter(input.test_fail_after, "booking");
  const bookingAfter = await BookedLead.findById(bookingBefore._id).session(input.session).lean().exec();
  if (!bookingAfter) throw new Error("Updated Booking could not be reloaded.");

  let leadAfter = leadBefore;
  if (!leadSatisfied && bookingBefore.lead_model && bookingBefore.lead_ref && leadBefore) {
    const Lead = bookingBefore.lead_model === "FormLead" ? getFormLeadModel() : getCallLeadModel();
    const leadWrite = await Lead.collection.updateOne(
      {
        _id: bookingBefore.lead_ref,
        domain_revision: Number(leadBefore.domain_revision ?? 0),
        booked: bookingBefore._id,
      },
      { $set: { over_2000: desired.over_2000, over_4000: desired.over_4000 } },
      { session: input.session },
    );
    if (leadWrite.matchedCount !== 1) {
      throw lifecycle("Booking Lead revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.input.request_id);
    }
    failAfter(input.test_fail_after, "lead");
    const loadedLeadAfter = await loadLead(bookingBefore.lead_model, bookingBefore.lead_ref, input.session);
    if (!loadedLeadAfter) throw new Error("Updated Booking Lead could not be reloaded.");
    leadAfter = loadedLeadAfter;
  }

  const mutations: AggregateMutationPlan[] = [{
    change_id: input.change_ids[0]!,
    entity: { model: "BookedLead" as const, id: String(bookingBefore._id) },
    revision_before: bookingBefore.domain_revision,
    fields: collectDocumentFieldChanges(
      bookingBefore as unknown as Record<string, unknown>,
      bookingAfter as unknown as Record<string, unknown>,
      BOOKED_LEAD_CHANGE_PATHS,
    ),
  }];
  if (!leadSatisfied && bookingBefore.lead_model && bookingBefore.lead_ref && leadBefore) {
    mutations.push({
      change_id: input.change_ids[1]!,
      entity: { model: bookingBefore.lead_model, id: String(bookingBefore.lead_ref) },
      revision_before: Number(leadBefore.domain_revision ?? 0),
      fields: collectDocumentFieldChanges(
        leadBefore,
        leadAfter!,
        bookingBefore.lead_model === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS,
      ),
    });
  }
  await persistEntityChangeMutations({
    session: input.session,
    now: input.now,
    command_name: UPDATE_BOOKING_COMMAND_NAME,
    command_execution_id: input.command_execution_id,
    context: input.context,
    mutations,
  });
  failAfter(input.test_fail_after, "changes");
  await resolveCase({
    case_row: caseRow,
    command_execution_id: input.command_execution_id,
    actor: input.input.owner,
    outcome: "booking_updated",
    booking_id: bookingBefore._id,
    now: input.now,
    session: input.session,
  });
  failAfter(input.test_fail_after, "case");
  await persistSheetSyncIntent(referral
    ? {
        resource: "booked_lead",
        operation: "referral_booking.update",
        bookingId: String(bookingBefore._id),
      }
    : {
        resource: "booking_chain",
        operation: "booked_lead.update",
        bookingId: String(bookingBefore._id),
      }, input.session);
  failAfter(input.test_fail_after, "outbox");
  return { entity_refs: ownerRefs(caseRow, bookingBefore._id, bookingBefore.lead_model, bookingBefore.lead_ref, link?._id), warnings: [] };
}

async function applyNoAction(input: {
  input: BookingNoActionInput;
  flags: GranotLifecycleFlags;
  session: ClientSession;
  now: Date;
  command_execution_id: mongoose.Types.ObjectId;
  causal: Awaited<ReturnType<typeof prepareOwnerCommand>>;
  test_fail_after_case?: boolean;
}) {
  const caseRow = await loadOpenCase(input.input, input.session, ["create_missing_booking", "review_existing_booking", "create_referral_booking"]);
  assertCommandAllowed(caseRow, input.flags, input.input.request_id);
  if (caseRow.source_scope) {
    await assertActiveSourceScope(caseRow, input.session, input.input.request_id);
  } else {
    await assertActiveReferralPolicy(caseRow, input.session, input.input.request_id);
  }
  const result = await getGranotBookingReconciliationCaseModel().updateOne(
    { _id: caseRow._id, state: "open", case_revision: input.input.expected_case_revision },
    {
      $set: {
        state: "resolved",
        resolved_at: input.now,
        resolution: {
          outcome: "no_action",
          command_execution_id: input.command_execution_id,
          actor: input.input.owner,
          ...(input.input.reason_code ? { reason_code: input.input.reason_code } : {}),
          ...(input.input.reason_text !== undefined ? { reason_text: input.input.reason_text } : {}),
          resolved_at: input.now,
          ...(caseRow.deterministic_booking_id ? {
            entity_ref: { model: "BookedLead", id: String(caseRow.deterministic_booking_id) },
          } : {}),
        },
      },
      $inc: { case_revision: 1 },
    },
    { session: input.session },
  );
  if (result.matchedCount !== 1) {
    throw lifecycle("Granot reconciliation case revision changed", "CASE_REVISION_CONFLICT", 409, input.input.request_id);
  }
  if (input.test_fail_after_case) throw new Error("UNIT25_INJECTED_NO_ACTION_FAILURE_AFTER_CASE");
  return {
    entity_refs: [
      { model: "GranotBookingReconciliationCase", id: String(caseRow._id) },
      ...(caseRow.deterministic_booking_id ? [{ model: "BookedLead", id: String(caseRow.deterministic_booking_id) }] : []),
    ],
    warnings: [],
  };
}

async function prepareOwnerCommand(
  input: OwnerEnvelope,
  commandName: string,
  validatedBody: Record<string, unknown>,
) {
  assertOwnerCommandIdempotencyKey(input.idempotency_key);
  assertOwner(input.owner, input.request_id);
  const row = await getGranotBookingReconciliationCaseModel().findById(input.case_id).lean().exec();
  if (!row) throw lifecycle("Granot reconciliation case not found", "CASE_NOT_FOUND", 404, input.request_id);
  const first = row.evidence[0];
  if (!first) throw lifecycle("Booking case has no causal evidence", "IDENTITY_CONFLICT", 409, input.request_id);
  const observation = await getGranotObservationModel().findById(first.observation_id).lean().exec();
  const receipt = observation
    ? await getGranotObservationReceiptModel().findById(observation.receipt_id).lean().exec()
    : null;
  if (!observation || !receipt) {
    throw lifecycle("Booking case causal evidence is unavailable", "IDENTITY_CONFLICT", 409, input.request_id);
  }
  const receiptId = String(receipt._id);
  const observationId = String(first.observation_id);
  const decisionId = String(first.decision_id);
  const context: CanonicalCommandContext = {
    command_id: new mongoose.Types.ObjectId().toHexString(),
    idempotency_key: input.idempotency_key,
    payload_checksum: createHash("sha256").update(canonicalJson({
      command_name: commandName,
      case_id: input.case_id,
      validated_body: validatedBody,
    })).digest("hex"),
    actor: createGranotLifecycleProcessorActor(receiptId),
    initiator: input.owner,
    provenance: {
      origin: "granot_lifecycle",
      run_id: null,
      source_receipt_id: receiptId,
      source_connection_key: null,
      observation_id: observationId,
      decision_id: decisionId,
      case_id: input.case_id,
      discrepancy_id: null,
      observation_channel: receipt.observation_channel as ObservationChannel,
    },
  };
  return { context, receipt_id: receiptId, observation_id: observationId, decision_id: decisionId };
}

async function loadOpenCase(
  input: OwnerEnvelope & { expected_case_revision: number },
  session: ClientSession,
  modes: GranotBookingReconciliationCaseDocument["mode"][],
) {
  const row = await getGranotBookingReconciliationCaseModel().findById(input.case_id).session(session).lean().exec();
  if (!row) throw lifecycle("Granot reconciliation case not found", "CASE_NOT_FOUND", 404, input.request_id);
  if (
    row.action_kind !== "booked" || !modes.includes(row.mode) || row.state !== "open" ||
    row.case_revision !== input.expected_case_revision
  ) {
    throw lifecycle("Granot reconciliation case revision changed", "CASE_REVISION_CONFLICT", 409, input.request_id);
  }
  return row;
}

function assertCommandAllowed(row: GranotBookingReconciliationCaseDocument, flags: GranotLifecycleFlags, requestId?: string) {
  if (!flags.booking_commands_enabled) {
    throw lifecycle("Granot Booking commands are disabled", "POLICY_BLOCKED", 422, requestId);
  }
  if (!row.source_scope && !flags.referral_booking_enabled) {
    throw lifecycle("Granot Referral Booking commands are disabled", "POLICY_BLOCKED", 422, requestId);
  }
  if (!row.source_scope && row.mode !== "create_referral_booking" && row.mode !== "review_existing_booking") {
    throw lifecycle("Booking case source policy does not permit this command", "POLICY_BLOCKED", 422, requestId);
  }
}

async function assertActiveReferralPolicy(
  row: GranotBookingReconciliationCaseDocument,
  session: ClientSession,
  requestId?: string,
) {
  const first = row.evidence[0];
  const observation = first
    ? await getGranotObservationModel().findById(first.observation_id).session(session).lean().exec()
    : null;
  const decision = first
    ? await getSynchronizationDecisionModel().findById(first.decision_id).session(session).lean().exec()
    : null;
  const activation = await getGranotLifecycleActivationModel().findOne({ key: "granot_lifecycle" })
    .session(session).lean().exec();
  if (
    !observation || observation.booking_action?.normalized !== "booked" ||
    !decision || decision.execution_mode !== "live" || !activation ||
    observation.captured_at < activation.activated_at ||
    observation.identity?.normalized_job_no !== row.normalized_job_no
  ) {
    throw lifecycle("Referral Booking evidence no longer matches the case", "IDENTITY_CONFLICT", 409, requestId);
  }
  const sourcePolicy = decision?.source_policy;
  const source = sourcePolicy?.disposition === "referral_booking"
    ? await getGranotCrmSourceModel().findOne({
        _id: sourcePolicy.granot_crm_source_id,
        enabled: true,
        lifecycle_enabled: true,
        lifecycle_disposition: "referral_booking",
        lead_created_policy: "observation_only",
        lead_source_company: null,
        lifecycle_routes: { $size: 0 },
        lifecycle_policy_version: sourcePolicy.policy_version,
      }).session(session).lean().exec()
    : null;
  if (!source || !source.lifecycle_policy_version) {
    throw lifecycle("Reviewed Referral source policy is no longer active", "POLICY_BLOCKED", 422, requestId);
  }
  return "referral";
}

async function assertActiveSourceScope(row: GranotBookingReconciliationCaseDocument, session: ClientSession, requestId?: string) {
  if (!row.source_scope) throw lifecycle("Booking case has no reviewed source scope", "POLICY_BLOCKED", 422, requestId);
  const [source, company, granularity] = await Promise.all([
    getGranotCrmSourceModel().findOne({
      _id: row.source_scope.granot_crm_source_id,
      enabled: true,
      lifecycle_enabled: true,
      lifecycle_disposition: "source_scoped_lead",
      lead_source_company: row.source_scope.lead_source_company,
    }).session(session).lean().exec(),
    getLeadSourceCompanyModel().findOne({ _id: row.source_scope.lead_source_company, active: true }).session(session).lean().exec(),
    getLeadSourceGranularityModel().findOne({
      _id: row.source_scope.source_granularity_id,
      source_company: row.source_scope.lead_source_company,
      active: true,
    }).session(session).lean().exec(),
  ]);
  if (!source || !company || !granularity) {
    throw lifecycle("Reviewed Booking source policy is no longer active", "POLICY_BLOCKED", 422, requestId);
  }
  return company.company_slug;
}

async function loadActiveCatalog(details: GranotLifecycleOfficialBookingDetails, session: ClientSession, requestId?: string) {
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

async function loadAndAssertLink(
  row: GranotBookingReconciliationCaseDocument,
  booking: { _id: mongoose.Types.ObjectId; lead_ref?: mongoose.Types.ObjectId | null; lead_model?: LeadModel | null },
  session: ClientSession,
  requestId?: string,
) {
  const Link = getGranotRecordLinkModel();
  const link = row.record_link_id
    ? await Link.findById(row.record_link_id).session(session).lean().exec()
    : await Link.findOne({ provider: "granot", normalized_job_no: row.normalized_job_no, state: "active" }).session(session).lean().exec();
  if (row.record_link_id && !link) {
    throw lifecycle("Case Record Link is no longer active", "IDENTITY_CONFLICT", 409, requestId);
  }
  if (!link) return null;
  const scope = link.source_scope;
  if (
    link.state !== "active" || link.normalized_job_no !== row.normalized_job_no ||
    String(link.booking_ref ?? "") !== String(booking._id) ||
    (link.lead_ref && (
      link.lead_ref.model !== booking.lead_model || String(link.lead_ref.id) !== String(booking.lead_ref)
    )) ||
    (scope && (
      String(scope.lead_source_company) !== String(row.source_scope?.lead_source_company ?? "") ||
      String(scope.source_granularity_id) !== String(row.source_scope?.source_granularity_id ?? "")
    ))
  ) {
    throw lifecycle("Record Link identity is incompatible with the case", "IDENTITY_CONFLICT", 409, requestId);
  }
  return link;
}

function desiredBooking(details: GranotLifecycleOfficialBookingDetails, catalogs: Awaited<ReturnType<typeof loadActiveCatalog>>) {
  return {
    book_date: new Date(`${details.book_date}T00:00:00.000Z`),
    agent_allocations: officialBookingAllocations(details).map((row) => ({
      agent: toObjectId(row.agent_id),
      agent_name_snapshot: catalogs.agent_names.get(row.agent_id)!,
      binder_amount: cents(row.binder_amount) / 100,
    })),
    total_binder_amount: cents(details.total_binder_amount) / 100,
    deposit_amount: cents(details.deposit_amount) / 100,
    merchant: catalogs.merchant_name,
    over_2000: details.deposit_amount > 2000,
    over_4000: details.deposit_amount > 4000,
  };
}

function sameOfficialBooking(row: Record<string, unknown>, desired: ReturnType<typeof desiredBooking>) {
  const currentDate = row.book_date instanceof Date
    ? row.book_date.toISOString().slice(0, 10)
    : new Date(String(row.book_date)).toISOString().slice(0, 10);
  const desiredDate = desired.book_date.toISOString().slice(0, 10);
  const allocations = row.agent_allocations as Array<{ agent: unknown; agent_name_snapshot: string; binder_amount: number }> ?? [];
  return currentDate === desiredDate &&
    cents(Number(row.total_binder_amount)) === cents(desired.total_binder_amount) &&
    cents(Number(row.deposit_amount)) === cents(desired.deposit_amount) &&
    row.merchant === desired.merchant &&
    Boolean(row.over_2000) === desired.over_2000 && Boolean(row.over_4000) === desired.over_4000 &&
    allocations.length === desired.agent_allocations.length && allocations.every((allocation, index) => {
      const next = desired.agent_allocations[index];
      return next && String(allocation.agent) === String(next.agent) &&
        allocation.agent_name_snapshot === next.agent_name_snapshot &&
        cents(allocation.binder_amount) === cents(next.binder_amount);
    });
}

async function loadLead(model: LeadModel, id: mongoose.Types.ObjectId, session: ClientSession): Promise<Record<string, unknown> | null> {
  const query = model === "FormLead" ? getFormLeadModel().findById(id) : getCallLeadModel().findById(id);
  return query.session(session).lean().exec() as Promise<Record<string, unknown> | null>;
}

async function resolveCase(input: {
  case_row: GranotBookingReconciliationCaseDocument;
  command_execution_id: mongoose.Types.ObjectId;
  actor: DurableActor;
  outcome: "booking_updated" | "already_satisfied";
  booking_id: mongoose.Types.ObjectId;
  now: Date;
  session: ClientSession;
}) {
  const result = await getGranotBookingReconciliationCaseModel().updateOne(
    { _id: input.case_row._id, state: "open", case_revision: input.case_row.case_revision },
    {
      $set: {
        state: "resolved",
        resolved_at: input.now,
        resolution: {
          outcome: input.outcome,
          command_execution_id: input.command_execution_id,
          actor: input.actor,
          resolved_at: input.now,
          entity_ref: { model: "BookedLead", id: String(input.booking_id) },
        },
      },
      $inc: { case_revision: 1 },
    },
    { session: input.session },
  );
  if (result.matchedCount !== 1) {
    throw lifecycle("Granot reconciliation case revision changed", "CASE_REVISION_CONFLICT", 409);
  }
}

async function reloadResult(
  caseId: string,
  entityRefs: readonly { model: string; id: string }[],
  decisionId: string,
  replayed: boolean,
): Promise<BookingOwnerCommandResult> {
  const row = await getGranotBookingReconciliationCaseModel().findById(caseId).lean().exec();
  if (!row?.resolution) throw new Error("Committed Booking owner-command evidence could not be reloaded.");
  const bookingId = entityRefs.find((entry) => entry.model === "BookedLead")?.id;
  const linkId = entityRefs.find((entry) => entry.model === "GranotRecordLink")?.id;
  const [booking, link] = await Promise.all([
    bookingId ? BookedLead.findById(bookingId).select({ domain_revision: 1 }).lean().exec() : null,
    linkId ? getGranotRecordLinkModel().findById(linkId).select({ domain_revision: 1 }).lean().exec() : null,
  ]);
  return {
    case_id: caseId,
    case_state: "resolved",
    case_revision: row.case_revision,
    outcome: row.resolution.outcome === "booking_updated" ? "booking_updated" :
      row.resolution.outcome === "already_satisfied" ? "already_satisfied" : "no_action",
    command_execution_id: String(row.resolution.command_execution_id),
    decision_id: decisionId,
    ...(bookingId && booking ? { booking_ref: { id: bookingId, domain_revision: booking.domain_revision } } : {}),
    ...(linkId && link ? { record_link_ref: { id: linkId, domain_revision: link.domain_revision } } : {}),
    entity_refs: entityRefs.map((entry) => ({ ...entry })),
    replayed,
  };
}

function ownerRefs(
  row: GranotBookingReconciliationCaseDocument,
  bookingId: mongoose.Types.ObjectId,
  leadModel?: LeadModel | null,
  leadId?: mongoose.Types.ObjectId | null,
  linkId?: mongoose.Types.ObjectId,
) {
  return [
    { model: "GranotBookingReconciliationCase", id: String(row._id) },
    { model: "BookedLead", id: String(bookingId) },
    ...(leadModel && leadId ? [{ model: leadModel, id: String(leadId) }] : []),
    ...(linkId ? [{ model: "GranotRecordLink", id: String(linkId) }] : []),
  ];
}

function updateBody(input: UpdateExistingBookingInput): GranotLifecycleUpdateBookingCommandInput {
  return {
    expected_case_revision: input.expected_case_revision,
    expected_booking_revision: input.expected_booking_revision,
    official_booking_details: input.official_booking_details,
  };
}

function noActionBody(input: BookingNoActionInput): GranotLifecycleBookingNoActionCommandInput {
  return {
    expected_case_revision: input.expected_case_revision,
    ...(input.reason_code ? { reason_code: input.reason_code } : {}),
    ...(input.reason_text !== undefined ? { reason_text: input.reason_text } : {}),
  };
}

function assertOwner(owner: DurableActor, requestId?: string) {
  if (owner.actor_type !== "owner" || owner.actor_role !== "owner" || owner.origin !== "vantage_admin") {
    throw lifecycle("Owner authority is required", "OWNER_REQUIRED", 403, requestId);
  }
}

function cents(value: number) { return Math.round(value * 100); }
function failAfter(selected: UpdateFailurePoint | undefined, current: UpdateFailurePoint) {
  if (selected === current) throw new Error(`UNIT25_INJECTED_FAILURE_AFTER_${current.toUpperCase()}`);
}
function lifecycle(message: string, key: keyof typeof GRANOT_LIFECYCLE_ERROR_CODES, status: number, requestId?: string) {
  return new GranotLifecycleError(message, GRANOT_LIFECYCLE_ERROR_CODES[key], status, requestId);
}
