import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { getGranotLifecycleFlags, type GranotLifecycleFlags } from "../../config/domain/granotLifecycle";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { Agent } from "../../models/Agent";
import { Merchant } from "../../models/Merchant";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import {
  getGranotReleaseReconciliationCaseModel,
  type GranotReleaseReconciliationCaseDocument,
} from "../../models/GranotReleaseReconciliationCase";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotObservationModel, type GranotObservationDocument } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { officialBookingAgentIds, officialBookingAllocations } from "../agents";
import { canonicalJson } from "../durableWork/checksum";
import { createGranotLifecycleProcessorActor } from "../durableWork/actors";
import type { DurableActor } from "../durableWork/types";
import { executeIdempotentCanonicalCommand } from "../domainCommands/idempotency";
import {
  BOOKED_LEAD_CHANGE_PATHS,
  CALL_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  FORM_LEAD_CHANGE_PATHS,
  persistEntityChangeMutations,
  type AggregateMutationPlan,
} from "../domainCommands/entityChange";
import {
  assertOwnerCommandIdempotencyKey,
  type CanonicalCommandContext,
} from "../domainCommands/types";
import type {
  GranotLifecycleConfirmCancellationCommandInput,
  GranotLifecycleReleaseNoActionCommandInput,
  GranotLifecycleUpdateBookingCommandInput,
} from "../../validation/v1/granotLifecycle.validation";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
} from "./errors";
import type { ObservationChannel } from "./types";
import type { LeadModel } from "./types";
import { newObjectIdHex, toObjectId } from "../../utils/objectId";
import { finalizeSheetSync, persistSheetSyncIntent } from "../sheetSync";
import {
  CREATE_CANCELLATION_COMMAND_NAME,
  applyOfficialCancellationWrite,
  type OfficialCancellationFailAfter,
} from "./officialCancellationWrite";

export { CREATE_CANCELLATION_COMMAND_NAME } from "./officialCancellationWrite";
export const UPDATE_RELEASE_BOOKING_COMMAND_NAME = "updateBooking";
export const RELEASE_NO_ACTION_COMMAND_NAME = "resolveGranotReleaseCaseNoAction";

type ReleaseOwnerEnvelope = {
  case_id: string;
  idempotency_key: string;
  owner: DurableActor;
  request_id?: string;
};

export type ConfirmCancellationInput =
  GranotLifecycleConfirmCancellationCommandInput & ReleaseOwnerEnvelope;
export type UpdateReleaseBookingInput =
  GranotLifecycleUpdateBookingCommandInput & ReleaseOwnerEnvelope;
export type ReleaseNoActionInput =
  GranotLifecycleReleaseNoActionCommandInput & ReleaseOwnerEnvelope;

export type ReleaseOwnerCommandResult = {
  case_id: string;
  case_state: "resolved";
  case_revision: number;
  outcome:
    | "cancellation_created"
    | "booking_updated"
    | "no_action"
    | "already_satisfied";
  command_execution_id: string;
  decision_id: string;
  booking_ref: { id: string; domain_revision: number };
  cancellation_ref?: { id: string; domain_revision: number };
  entity_refs: Array<{ model: string; id: string }>;
  replayed: boolean;
};

type ReleaseOwnerCommandOptions = {
  flags?: GranotLifecycleFlags;
  test_fail_after_case?: boolean;
  test_fail_after?: OfficialCancellationFailAfter;
};

export async function confirmCancellation(
  input: ConfirmCancellationInput,
  options: ReleaseOwnerCommandOptions = {},
): Promise<ReleaseOwnerCommandResult> {
  const causal = await prepareOwnerCommand(input, CREATE_CANCELLATION_COMMAND_NAME, cancellationBody(input));
  const cancellationId = new mongoose.Types.ObjectId();
  const changeIds = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
  ];
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: CREATE_CANCELLATION_COMMAND_NAME,
    context: causal.context,
    operation: async ({ session, now, command_execution_id }) => {
      const caseRow = await loadOpenCase(input, session);
      assertCommandEnabled(options.flags ?? getGranotLifecycleFlags(), input.request_id);
      const policy = await assertReleasePolicy(caseRow, causal.observation, session, input.request_id);
      const bookingBefore = await BookedLead.findById(caseRow.deterministic_booking_id)
        .session(session).lean().exec();
      if (!bookingBefore) {
        throw lifecycle("Deterministic Booking no longer exists", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
      }
      assertBookingIdentity(caseRow, bookingBefore, policy, input.request_id);
      const leadBefore = bookingBefore.lead_ref && bookingBefore.lead_model
        ? await loadLead(bookingBefore.lead_model, bookingBefore.lead_ref, session)
        : null;
      assertLeadIdentity(caseRow, bookingBefore, leadBefore, input.request_id);
      await loadAndAssertLink(caseRow, bookingBefore, session, input.request_id);

      return applyOfficialCancellationWrite({
        bookingBefore: bookingBefore as unknown as Parameters<typeof applyOfficialCancellationWrite>[0]["bookingBefore"],
        normalized_job_no: caseRow.normalized_job_no,
        expected_booking_revision: input.expected_booking_revision,
        official_cancellation_details: input.official_cancellation_details,
        command_execution_id,
        context: causal.context,
        session,
        now,
        cancellationId,
        changeIds,
        request_id: input.request_id,
        test_fail_after: options.test_fail_after,
        resolveCase: ({ outcome, entity_id }) => resolveCase({
          case_row: caseRow,
          command_execution_id,
          actor: input.owner,
          outcome,
          now,
          session,
          entity_model: "CancelledLead",
          entity_id,
        }),
        base_refs: releaseRefs(caseRow, bookingBefore),
      });
    },
  });
  const result = await reloadResult(input.case_id, outcome.result.entity_refs, causal.decision_id, outcome.replayed);
  if (!outcome.replayed && result.outcome === "cancellation_created" && result.cancellation_ref) {
    await finalizeSheetSync({
      resource: "cancellation_chain",
      operation: "cancelled_lead.create",
      cancellationId: result.cancellation_ref.id,
    });
  }
  return result;
}

export async function updateExistingBooking(
  input: UpdateReleaseBookingInput,
  options: ReleaseOwnerCommandOptions = {},
): Promise<ReleaseOwnerCommandResult> {
  const causal = await prepareOwnerCommand(input, UPDATE_RELEASE_BOOKING_COMMAND_NAME, updateBody(input));
  const changeIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: UPDATE_RELEASE_BOOKING_COMMAND_NAME,
    context: causal.context,
    operation: async ({ session, now, command_execution_id }) => {
      const caseRow = await loadOpenCase(input, session);
      assertCommandEnabled(options.flags ?? getGranotLifecycleFlags(), input.request_id);
      const policy = await assertReleasePolicy(caseRow, causal.observation, session, input.request_id);
      const bookingBefore = await BookedLead.findById(caseRow.deterministic_booking_id)
        .session(session).lean().exec();
      if (
        !bookingBefore || bookingBefore.cancelled ||
        bookingBefore.domain_revision !== input.expected_booking_revision
      ) {
        throw lifecycle("Booking revision changed or Booking is no longer active", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
      }
      assertBookingIdentity(caseRow, bookingBefore, policy, input.request_id);
      const leadBefore = bookingBefore.lead_ref && bookingBefore.lead_model
        ? await loadLead(bookingBefore.lead_model, bookingBefore.lead_ref, session)
        : null;
      assertLeadIdentity(caseRow, bookingBefore, leadBefore, input.request_id);
      await loadAndAssertLink(caseRow, bookingBefore, session, input.request_id);
      const catalogs = await loadActiveCatalog(input.official_booking_details, session, input.request_id);
      const desired = desiredBooking(input.official_booking_details, catalogs);
      const bookingSatisfied = sameOfficialBooking(
        bookingBefore as unknown as Record<string, unknown>,
        desired,
      );
      const leadSatisfied = !leadBefore || (
        Boolean(leadBefore.over_2000) === desired.over_2000 &&
        Boolean(leadBefore.over_4000) === desired.over_4000
      );
      if (bookingSatisfied && leadSatisfied) {
        await resolveCase({
          case_row: caseRow,
          command_execution_id,
          actor: input.owner,
          outcome: "already_satisfied",
          now,
          session,
        });
        return { entity_refs: releaseRefs(caseRow, bookingBefore), warnings: [] };
      }

      const bookingWrite = await BookedLead.collection.updateOne(
        {
          _id: bookingBefore._id,
          domain_revision: input.expected_booking_revision,
          normalized_job_no: caseRow.normalized_job_no,
          $or: [{ cancelled: null }, { cancelled: { $exists: false } }],
        },
        { $set: desired },
        { session },
      );
      if (bookingWrite.matchedCount !== 1) {
        throw lifecycle("Booking revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
      }
      failAfter(options.test_fail_after, "booking");
      const bookingAfter = await BookedLead.findById(bookingBefore._id).session(session).lean().exec();
      if (!bookingAfter) throw new Error("Updated Release Booking could not be reloaded.");

      let leadAfter = leadBefore;
      if (leadBefore && !leadSatisfied && bookingBefore.lead_ref && bookingBefore.lead_model) {
        const Lead = bookingBefore.lead_model === "FormLead" ? getFormLeadModel() : getCallLeadModel();
        const leadWrite = await Lead.collection.updateOne(
          {
            _id: bookingBefore.lead_ref,
            domain_revision: Number(leadBefore.domain_revision ?? 0),
            booked: bookingBefore._id,
          },
          { $set: { over_2000: desired.over_2000, over_4000: desired.over_4000 } },
          { session },
        );
        if (leadWrite.matchedCount !== 1) {
          throw lifecycle("Booking Lead revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
        }
        failAfter(options.test_fail_after, "lead");
        leadAfter = await loadLead(bookingBefore.lead_model, bookingBefore.lead_ref, session);
        if (!leadAfter) throw new Error("Updated Release Booking Lead could not be reloaded.");
      }

      const mutations: AggregateMutationPlan[] = [{
        change_id: changeIds[0]!,
        entity: { model: "BookedLead", id: String(bookingBefore._id) },
        revision_before: bookingBefore.domain_revision,
        fields: collectDocumentFieldChanges(
          bookingBefore as unknown as Record<string, unknown>,
          bookingAfter as unknown as Record<string, unknown>,
          BOOKED_LEAD_CHANGE_PATHS,
        ),
      }];
      if (leadBefore && leadAfter && !leadSatisfied && bookingBefore.lead_ref && bookingBefore.lead_model) {
        mutations.push({
          change_id: changeIds[1]!,
          entity: { model: bookingBefore.lead_model, id: String(bookingBefore.lead_ref) },
          revision_before: Number(leadBefore.domain_revision ?? 0),
          fields: collectDocumentFieldChanges(
            leadBefore,
            leadAfter,
            bookingBefore.lead_model === "FormLead" ? FORM_LEAD_CHANGE_PATHS : CALL_LEAD_CHANGE_PATHS,
          ),
        });
      }
      await persistEntityChangeMutations({
        session,
        now,
        command_name: UPDATE_RELEASE_BOOKING_COMMAND_NAME,
        command_execution_id,
        context: causal.context,
        mutations,
      });
      failAfter(options.test_fail_after, "changes");
      await resolveCase({
        case_row: caseRow,
        command_execution_id,
        actor: input.owner,
        outcome: "booking_updated",
        now,
        session,
      });
      failAfter(options.test_fail_after, "case");
      await persistSheetSyncIntent({
        resource: "booking_chain",
        operation: "booked_lead.update",
        bookingId: String(bookingBefore._id),
      }, session);
      failAfter(options.test_fail_after, "outbox");
      return { entity_refs: releaseRefs(caseRow, bookingBefore), warnings: [] };
    },
  });
  const result = await reloadResult(input.case_id, outcome.result.entity_refs, causal.decision_id, outcome.replayed);
  if (!outcome.replayed && result.outcome === "booking_updated") {
    await finalizeSheetSync({
      resource: "booking_chain",
      operation: "booked_lead.update",
      bookingId: result.booking_ref.id,
    });
  }
  return result;
}

export async function noAction(
  input: ReleaseNoActionInput,
  options: ReleaseOwnerCommandOptions = {},
): Promise<ReleaseOwnerCommandResult> {
  const causal = await prepareOwnerCommand(input, RELEASE_NO_ACTION_COMMAND_NAME, noActionBody(input));
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: RELEASE_NO_ACTION_COMMAND_NAME,
    context: causal.context,
    operation: async ({ session, now, command_execution_id }) => {
      const caseRow = await loadOpenCase(input, session);
      assertCommandEnabled(options.flags ?? getGranotLifecycleFlags(), input.request_id);
      await assertReleasePolicy(caseRow, causal.observation, session, input.request_id);
      await resolveCase({
        case_row: caseRow,
        command_execution_id,
        actor: input.owner,
        outcome: "no_action",
        now,
        session,
        reason_code: input.reason_code,
        reason_text: input.reason_text,
      });
      if (options.test_fail_after_case) {
        throw new Error("UNIT27_INJECTED_NO_ACTION_FAILURE_AFTER_CASE");
      }
      return {
        entity_refs: [
          { model: "GranotReleaseReconciliationCase", id: String(caseRow._id) },
          { model: "BookedLead", id: String(caseRow.deterministic_booking_id) },
        ],
        warnings: [],
      };
    },
  });
  return reloadResult(input.case_id, outcome.result.entity_refs, causal.decision_id, outcome.replayed);
}

async function prepareOwnerCommand(
  input: ReleaseOwnerEnvelope,
  commandName: string,
  validatedBody: Record<string, unknown>,
) {
  assertOwnerCommandIdempotencyKey(input.idempotency_key);
  assertOwner(input.owner, input.request_id);
  const row = await getGranotReleaseReconciliationCaseModel().findById(input.case_id).lean().exec();
  if (!row) throw lifecycle("Granot Release reconciliation case not found", "CASE_NOT_FOUND", 404, input.request_id);
  const first = row.evidence[0];
  if (!first) throw lifecycle("Release case has no causal evidence", "IDENTITY_CONFLICT", 409, input.request_id);
  const observation = await getGranotObservationModel().findById(first.observation_id).lean().exec();
  const receipt = observation
    ? await getGranotObservationReceiptModel().findById(observation.receipt_id).lean().exec()
    : null;
  if (!observation || !receipt) {
    throw lifecycle("Release case causal evidence is unavailable", "IDENTITY_CONFLICT", 409, input.request_id);
  }
  const receiptId = String(receipt._id);
  const observationId = String(first.observation_id);
  const decisionId = String(first.decision_id);
  const context: CanonicalCommandContext = {
    command_id: newObjectIdHex(),
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
  return { context, observation, decision_id: decisionId };
}

async function loadOpenCase(
  input: ReleaseOwnerEnvelope & { expected_case_revision: number },
  session: ClientSession,
) {
  const row = await getGranotReleaseReconciliationCaseModel().findById(input.case_id)
    .session(session).lean().exec();
  if (!row) throw lifecycle("Granot Release reconciliation case not found", "CASE_NOT_FOUND", 404, input.request_id);
  if (
    row.action_kind !== "release" || row.state !== "open" ||
    row.case_revision !== input.expected_case_revision
  ) {
    throw lifecycle("Granot Release reconciliation case revision changed", "CASE_REVISION_CONFLICT", 409, input.request_id);
  }
  return row;
}

function assertCommandEnabled(flags: GranotLifecycleFlags, requestId?: string) {
  if (!flags.release_commands_enabled) {
    throw lifecycle("Granot Release commands are disabled", "POLICY_BLOCKED", 422, requestId);
  }
}

async function assertReleasePolicy(
  row: GranotReleaseReconciliationCaseDocument,
  observation: GranotObservationDocument,
  session: ClientSession,
  requestId?: string,
) {
  const sourceId = row.source_scope?.granot_crm_source_id ?? observation.granot_crm_source_id;
  const source = sourceId
    ? await getGranotCrmSourceModel().findOne({ _id: sourceId, enabled: true, lifecycle_enabled: true })
      .session(session).lean().exec()
    : null;
  if (!source || source.lifecycle_disposition === "deferred") {
    throw lifecycle("Reviewed Release source policy is no longer active", "POLICY_BLOCKED", 422, requestId);
  }
  if (source.lifecycle_disposition === "referral_booking") {
    return { disposition: "referral_booking" as const, source };
  }
  if (source.lifecycle_disposition !== "source_scoped_lead" || !row.source_scope) {
    throw lifecycle("Release case source policy does not permit this command", "POLICY_BLOCKED", 422, requestId);
  }
  const [company, granularity] = await Promise.all([
    getLeadSourceCompanyModel().findOne({
      _id: row.source_scope.lead_source_company,
      active: true,
    }).session(session).lean().exec(),
    getLeadSourceGranularityModel().findOne({
      _id: row.source_scope.source_granularity_id,
      source_company: row.source_scope.lead_source_company,
      active: true,
    }).session(session).lean().exec(),
  ]);
  if (
    !company || !granularity ||
    String(source.lead_source_company ?? "") !== String(row.source_scope.lead_source_company)
  ) {
    throw lifecycle("Reviewed Release source policy is no longer active", "POLICY_BLOCKED", 422, requestId);
  }
  return { disposition: "source_scoped_lead" as const, source, company_slug: company.company_slug };
}

function assertBookingIdentity(
  row: GranotReleaseReconciliationCaseDocument,
  booking: {
    normalized_job_no?: string | null;
    source: string;
    is_referral_booking: boolean;
  },
  policy: Awaited<ReturnType<typeof assertReleasePolicy>>,
  requestId?: string,
) {
  if (booking.normalized_job_no !== row.normalized_job_no) {
    throw lifecycle("Deterministic Booking Job identity is incompatible with the Release case", "IDENTITY_CONFLICT", 409, requestId);
  }
  if (policy.disposition === "referral_booking") {
    if (!booking.is_referral_booking) {
      throw lifecycle("Deterministic Booking disposition is incompatible with the Release case", "IDENTITY_CONFLICT", 409, requestId);
    }
    return;
  }
  if (booking.is_referral_booking || booking.source !== policy.company_slug) {
    throw lifecycle("Deterministic Booking source is incompatible with the Release case", "IDENTITY_CONFLICT", 409, requestId);
  }
}

function assertLeadIdentity(
  row: GranotReleaseReconciliationCaseDocument,
  booking: {
    _id: mongoose.Types.ObjectId;
    lead_ref?: mongoose.Types.ObjectId | null;
    lead_model?: LeadModel | null;
  },
  lead: Record<string, unknown> | null,
  requestId?: string,
) {
  if (!booking.lead_ref && !booking.lead_model) return;
  if (!booking.lead_ref || !booking.lead_model || !lead || String(lead.booked ?? "") !== String(booking._id)) {
    throw lifecycle("Booking Lead identity is incompatible with the Release case", "IDENTITY_CONFLICT", 409, requestId);
  }
  if (row.source_scope && (
    String(lead.lead_source_company ?? "") !== String(row.source_scope.lead_source_company) ||
    String(lead.source_granularity_id ?? "") !== String(row.source_scope.source_granularity_id)
  )) {
    throw lifecycle("Booking Lead source identity is incompatible with the Release case", "IDENTITY_CONFLICT", 409, requestId);
  }
}

async function loadAndAssertLink(
  row: GranotReleaseReconciliationCaseDocument,
  booking: {
    _id: mongoose.Types.ObjectId;
    lead_ref?: mongoose.Types.ObjectId | null;
    lead_model?: LeadModel | null;
  },
  session: ClientSession,
  requestId?: string,
) {
  const Link = getGranotRecordLinkModel();
  const link = row.record_link_id
    ? await Link.findById(row.record_link_id).session(session).lean().exec()
    : await Link.findOne({ provider: "granot", normalized_job_no: row.normalized_job_no, state: "active" })
      .session(session).lean().exec();
  if (row.record_link_id && !link) {
    throw lifecycle("Release case Record Link is no longer active", "IDENTITY_CONFLICT", 409, requestId);
  }
  if (!link) return null;
  const scope = link.source_scope;
  if (
    link.state !== "active" || link.normalized_job_no !== row.normalized_job_no ||
    String(link.booking_ref ?? "") !== String(booking._id) ||
    (link.lead_ref && (
      link.lead_ref.model !== booking.lead_model || String(link.lead_ref.id) !== String(booking.lead_ref)
    )) ||
    (scope && row.source_scope && (
      String(scope.lead_source_company) !== String(row.source_scope.lead_source_company) ||
      String(scope.source_granularity_id) !== String(row.source_scope.source_granularity_id)
    ))
  ) {
    throw lifecycle("Record Link identity is incompatible with the Release case", "IDENTITY_CONFLICT", 409, requestId);
  }
  return link;
}

async function loadActiveCatalog(
  details: GranotLifecycleUpdateBookingCommandInput["official_booking_details"],
  session: ClientSession,
  requestId?: string,
) {
  const ids = officialBookingAgentIds(details).map((id) => toObjectId(id));
  const [agents, merchant] = await Promise.all([
    Agent.find({ _id: { $in: ids }, active: true }).session(session).lean().exec(),
    Merchant.findOne({ _id: toObjectId(details.merchant_id), active: true }).session(session).lean().exec(),
  ]);
  if (agents.length !== ids.length || !merchant) {
    throw lifecycle("Submitted Agent or Merchant is unknown or inactive", "VALIDATION_FAILED", 400, requestId);
  }
  return {
    agent_names: new Map(agents.map((agent) => [String(agent._id), agent.name])),
    merchant_name: merchant.name,
  };
}

function desiredBooking(
  details: GranotLifecycleUpdateBookingCommandInput["official_booking_details"],
  catalogs: Awaited<ReturnType<typeof loadActiveCatalog>>,
) {
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
  const allocations = (row.agent_allocations ?? []) as Array<{
    agent: unknown;
    agent_name_snapshot: string;
    binder_amount: number;
  }>;
  return currentDate === desired.book_date.toISOString().slice(0, 10) &&
    cents(Number(row.total_binder_amount)) === cents(desired.total_binder_amount) &&
    cents(Number(row.deposit_amount)) === cents(desired.deposit_amount) &&
    row.merchant === desired.merchant &&
    Boolean(row.over_2000) === desired.over_2000 &&
    Boolean(row.over_4000) === desired.over_4000 &&
    allocations.length === desired.agent_allocations.length &&
    allocations.every((allocation, index) => {
      const next = desired.agent_allocations[index];
      return Boolean(next) && String(allocation.agent) === String(next!.agent) &&
        allocation.agent_name_snapshot === next!.agent_name_snapshot &&
        cents(allocation.binder_amount) === cents(next!.binder_amount);
    });
}

async function loadLead(
  model: LeadModel,
  id: mongoose.Types.ObjectId,
  session: ClientSession,
): Promise<Record<string, unknown> | null> {
  const query = model === "FormLead" ? getFormLeadModel().findById(id) : getCallLeadModel().findById(id);
  return query.session(session).lean().exec() as Promise<Record<string, unknown> | null>;
}

function releaseRefs(
  row: GranotReleaseReconciliationCaseDocument,
  booking: {
    _id: mongoose.Types.ObjectId;
    lead_ref?: mongoose.Types.ObjectId | null;
    lead_model?: LeadModel | null;
  },
) {
  return [
    { model: "GranotReleaseReconciliationCase", id: String(row._id) },
    { model: "BookedLead", id: String(booking._id) },
    ...(booking.lead_ref && booking.lead_model
      ? [{ model: booking.lead_model, id: String(booking.lead_ref) }]
      : []),
    ...(row.record_link_id ? [{ model: "GranotRecordLink", id: String(row.record_link_id) }] : []),
  ];
}

async function resolveCase(input: {
  case_row: GranotReleaseReconciliationCaseDocument;
  command_execution_id: mongoose.Types.ObjectId;
  actor: DurableActor;
  outcome: "no_action" | "booking_updated" | "cancellation_created" | "already_satisfied";
  now: Date;
  session: ClientSession;
  entity_model?: "BookedLead" | "CancelledLead";
  entity_id?: mongoose.Types.ObjectId;
  reason_code?: ReleaseNoActionInput["reason_code"];
  reason_text?: string;
}) {
  const entityId = input.entity_id ?? input.case_row.deterministic_booking_id;
  const result = await getGranotReleaseReconciliationCaseModel().updateOne(
    { _id: input.case_row._id, state: "open", case_revision: input.case_row.case_revision },
    {
      $set: {
        state: "resolved",
        resolved_at: input.now,
        resolution: {
          outcome: input.outcome,
          command_execution_id: input.command_execution_id,
          actor: input.actor,
          ...(input.reason_code ? { reason_code: input.reason_code } : {}),
          ...(input.reason_text !== undefined ? { reason_text: input.reason_text } : {}),
          resolved_at: input.now,
          entity_ref: { model: input.entity_model ?? "BookedLead", id: String(entityId) },
        },
      },
      $inc: { case_revision: 1 },
    },
    { session: input.session },
  );
  if (result.matchedCount !== 1) {
    throw lifecycle("Granot Release reconciliation case revision changed", "CASE_REVISION_CONFLICT", 409);
  }
}

async function reloadResult(
  caseId: string,
  entityRefs: readonly { model: string; id: string }[],
  decisionId: string,
  replayed: boolean,
): Promise<ReleaseOwnerCommandResult> {
  const row = await getGranotReleaseReconciliationCaseModel().findById(caseId).lean().exec();
  if (!row?.resolution) throw new Error("Committed Release owner-command evidence could not be reloaded.");
  const bookingId = entityRefs.find((entry) => entry.model === "BookedLead")?.id ??
    String(row.deterministic_booking_id);
  const cancellationId = entityRefs.find((entry) => entry.model === "CancelledLead")?.id;
  const [booking, cancellation] = await Promise.all([
    BookedLead.findById(bookingId).select({ domain_revision: 1 }).lean().exec(),
    cancellationId
      ? CancelledLead.findById(cancellationId).select({ domain_revision: 1 }).lean().exec()
      : null,
  ]);
  if (!booking) throw new Error("Committed Release Booking evidence could not be reloaded.");
  const outcome = row.resolution.outcome;
  if (
    outcome !== "cancellation_created" && outcome !== "booking_updated" &&
    outcome !== "no_action" && outcome !== "already_satisfied"
  ) {
    throw new Error("Committed Release owner-command outcome is unsupported.");
  }
  return {
    case_id: caseId,
    case_state: "resolved",
    case_revision: row.case_revision,
    outcome,
    command_execution_id: String(row.resolution.command_execution_id),
    decision_id: decisionId,
    booking_ref: { id: bookingId, domain_revision: booking.domain_revision },
    ...(cancellationId && cancellation
      ? { cancellation_ref: { id: cancellationId, domain_revision: cancellation.domain_revision } }
      : {}),
    entity_refs: entityRefs.map((entry) => ({ ...entry })),
    replayed,
  };
}

function noActionBody(input: ReleaseNoActionInput): GranotLifecycleReleaseNoActionCommandInput {
  return {
    expected_case_revision: input.expected_case_revision,
    ...(input.reason_code ? { reason_code: input.reason_code } : {}),
    ...(input.reason_text !== undefined ? { reason_text: input.reason_text } : {}),
  };
}

function updateBody(input: UpdateReleaseBookingInput): GranotLifecycleUpdateBookingCommandInput {
  return {
    expected_case_revision: input.expected_case_revision,
    expected_booking_revision: input.expected_booking_revision,
    official_booking_details: input.official_booking_details,
  };
}

function cancellationBody(
  input: ConfirmCancellationInput,
): GranotLifecycleConfirmCancellationCommandInput {
  return {
    expected_case_revision: input.expected_case_revision,
    expected_booking_revision: input.expected_booking_revision,
    official_cancellation_details: input.official_cancellation_details,
  };
}

function assertOwner(owner: DurableActor, requestId?: string) {
  if (owner.actor_type !== "owner" || owner.actor_role !== "owner" || owner.origin !== "vantage_admin") {
    throw lifecycle("Owner authority is required", "OWNER_REQUIRED", 403, requestId);
  }
}

function lifecycle(
  message: string,
  key: keyof typeof GRANOT_LIFECYCLE_ERROR_CODES,
  status: number,
  requestId?: string,
) {
  return new GranotLifecycleError(message, GRANOT_LIFECYCLE_ERROR_CODES[key], status, requestId);
}

function cents(value: number) {
  return Math.round(value * 100);
}

function failAfter(
  selected: ReleaseOwnerCommandOptions["test_fail_after"],
  current: NonNullable<ReleaseOwnerCommandOptions["test_fail_after"]>,
) {
  if (selected === current) {
    throw new Error(`UNIT27_INJECTED_FAILURE_AFTER_${current.toUpperCase()}`);
  }
}
