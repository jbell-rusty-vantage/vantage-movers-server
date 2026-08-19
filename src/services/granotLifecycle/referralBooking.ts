import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { getGranotLifecycleFlags, type GranotLifecycleFlags } from "../../config/domain/granotLifecycle";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { Merchant } from "../../models/Merchant";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotCrmSourceModel } from "../../models/GranotCrmSource";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel, type GranotRecordLinkDocument } from "../../models/GranotRecordLink";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { toObjectId } from "../../utils/objectId";
import type { GranotLifecycleCreateReferralBookingCommandInput } from "../../validation/v1/granotLifecycle.validation";
import { canonicalJson } from "../durableWork/checksum";
import { createGranotLifecycleProcessorActor } from "../durableWork/actors";
import type { DurableActor } from "../durableWork/types";
import {
  BOOKED_LEAD_CHANGE_PATHS,
  collectDocumentFieldChanges,
  persistEntityChangeMutations,
  RECORD_LINK_CHANGE_PATHS,
} from "../domainCommands/entityChange";
import { executeIdempotentCanonicalCommand } from "../domainCommands/idempotency";
import {
  assertOwnerCommandIdempotencyKey,
  type CanonicalCommandContext,
  type CanonicalCommandResult,
} from "../domainCommands/types";
import { finalizeSheetSync, persistSheetSyncIntent } from "../sheetSync";
import { GRANOT_LIFECYCLE_ERROR_CODES, GranotLifecycleError } from "./errors";
import type { BookingOwnerCommandResult } from "./bookingConfirmation";
import type { ObservationChannel } from "./types";

export const CREATE_REFERRAL_BOOKING_COMMAND_NAME = "createReferralBooking";

export type ReferralBookingInput = GranotLifecycleCreateReferralBookingCommandInput & {
  case_id: string;
  idempotency_key: string;
  owner: DurableActor;
  request_id?: string;
};

type FailurePoint = "booking" | "link" | "changes" | "case" | "outbox";

export async function createReferralBookingCanonical(input: {
  normalized_job_no: string;
  accepted_observation_id: string;
  official_booking_details: ReferralBookingInput["official_booking_details"];
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult> {
  assertOwner(input.context.initiator);
  const caseId = input.context.provenance.case_id;
  if (!caseId || !input.context.provenance.source_receipt_id ||
      !input.context.provenance.decision_id || !input.context.provenance.observation_channel) {
    throw lifecycle("Referral Booking command requires complete case provenance", "IDENTITY_CONFLICT", 409);
  }
  const caseRow = await getGranotBookingReconciliationCaseModel().findById(caseId).lean().exec();
  if (!caseRow || caseRow.normalized_job_no !== input.normalized_job_no ||
      String(caseRow.evidence[0]?.observation_id ?? "") !== input.accepted_observation_id) {
    throw lifecycle("Referral Booking command identity is incompatible with the case", "IDENTITY_CONFLICT", 409);
  }
  const ownerInput: ReferralBookingInput = {
    case_id: caseId,
    expected_case_revision: caseRow.case_revision,
    official_booking_details: input.official_booking_details,
    idempotency_key: input.context.idempotency_key,
    owner: input.context.initiator,
  };
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: CREATE_REFERRAL_BOOKING_COMMAND_NAME,
    context: input.context,
    operation: ({ session, now, command_execution_id }) => applyReferralBooking({
      input: ownerInput,
      flags: getGranotLifecycleFlags(),
      session,
      now,
      command_execution_id,
      context: input.context,
      causal: {
        receipt_id: input.context.provenance.source_receipt_id!,
        observation_id: input.accepted_observation_id,
        decision_id: input.context.provenance.decision_id!,
        channel: input.context.provenance.observation_channel!,
      },
      change_ids: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
    }),
  });
  return outcome.result;
}

export async function createReferralBooking(
  input: ReferralBookingInput,
  options: { flags?: GranotLifecycleFlags; test_fail_after?: FailurePoint } = {},
): Promise<BookingOwnerCommandResult> {
  assertOwnerCommandIdempotencyKey(input.idempotency_key);
  assertOwner(input.owner, input.request_id);
  const causal = await loadCausalContext(input.case_id, input.request_id);
  const context: CanonicalCommandContext = {
    command_id: new mongoose.Types.ObjectId().toHexString(),
    idempotency_key: input.idempotency_key,
    payload_checksum: createHash("sha256").update(canonicalJson({
      command_name: CREATE_REFERRAL_BOOKING_COMMAND_NAME,
      case_id: input.case_id,
      validated_body: commandBody(input),
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
  const changeIds = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
  let outcome;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      outcome = await executeIdempotentCanonicalCommand({
        command_name: CREATE_REFERRAL_BOOKING_COMMAND_NAME,
        context,
        operation: ({ session, now, command_execution_id }) => applyReferralBooking({
          input,
          flags: options.flags ?? getGranotLifecycleFlags(),
          session,
          now,
          command_execution_id,
          context,
          causal,
          change_ids: changeIds,
          test_fail_after: options.test_fail_after,
        }),
      });
      break;
    } catch (error) {
      if (attempt === 1 || !isDuplicateKey(error)) throw error;
    }
  }
  if (!outcome) throw new Error("Referral Booking command did not produce an outcome.");

  const execution = await DomainCommandExecution.findOne({
    origin: "granot_lifecycle",
    command_name: CREATE_REFERRAL_BOOKING_COMMAND_NAME,
    idempotency_key: input.idempotency_key,
  }).select({ _id: 1 }).lean().exec();
  const resolvedCase = await getGranotBookingReconciliationCaseModel().findById(input.case_id).lean().exec();
  const bookingId = entityId(outcome.result.entity_refs, "BookedLead");
  const linkId = entityId(outcome.result.entity_refs, "GranotRecordLink");
  const [booking, link] = await Promise.all([
    BookedLead.findById(bookingId).select({ domain_revision: 1 }).lean().exec(),
    getGranotRecordLinkModel().findById(linkId).select({ domain_revision: 1 }).lean().exec(),
  ]);
  if (!execution || !resolvedCase?.resolution || !booking || !link) {
    throw new Error("Committed Referral Booking evidence could not be reloaded.");
  }
  if (!outcome.replayed && resolvedCase.resolution.outcome === "referral_booking_created") {
    await finalizeSheetSync({
      resource: "booked_lead",
      operation: "referral_booking.create",
      bookingId,
    });
  }
  return {
    case_id: input.case_id,
    case_state: "resolved",
    case_revision: resolvedCase.case_revision,
    outcome: resolvedCase.resolution.outcome === "already_satisfied"
      ? "already_satisfied"
      : "referral_booking_created",
    command_execution_id: String(execution._id),
    decision_id: causal.decision_id,
    booking_ref: { id: bookingId, domain_revision: booking.domain_revision },
    record_link_ref: { id: linkId, domain_revision: link.domain_revision },
    entity_refs: outcome.result.entity_refs.map((row) => ({ ...row })),
    replayed: outcome.replayed,
  };
}

async function applyReferralBooking(input: {
  input: ReferralBookingInput;
  flags: GranotLifecycleFlags;
  session: ClientSession;
  now: Date;
  command_execution_id: mongoose.Types.ObjectId;
  context: CanonicalCommandContext;
  causal: Awaited<ReturnType<typeof loadCausalContext>>;
  change_ids: mongoose.Types.ObjectId[];
  test_fail_after?: FailurePoint;
}) {
  if (!input.flags.booking_commands_enabled || !input.flags.referral_booking_enabled) {
    throw lifecycle("Granot Referral Booking commands are disabled", "POLICY_BLOCKED", 422, input.input.request_id);
  }
  const Case = getGranotBookingReconciliationCaseModel();
  const caseRow = await Case.findById(input.input.case_id).session(input.session).lean().exec();
  if (!caseRow) throw lifecycle("Granot reconciliation case not found", "CASE_NOT_FOUND", 404, input.input.request_id);
  if (
    caseRow.action_kind !== "booked" || caseRow.mode !== "create_referral_booking" ||
    caseRow.state !== "open" || caseRow.case_revision !== input.input.expected_case_revision ||
    caseRow.source_scope || caseRow.suggested_lead
  ) {
    throw lifecycle("Granot reconciliation case revision changed", "CASE_REVISION_CONFLICT", 409, input.input.request_id);
  }
  assertStableEvidence(caseRow, input.causal, input.input.request_id);
  const observation = await getGranotObservationModel().findById(input.causal.observation_id)
    .session(input.session).lean().exec();
  const decision = await getSynchronizationDecisionModel().findById(input.causal.decision_id)
    .session(input.session).lean().exec();
  const activation = await getGranotLifecycleActivationModel().findOne({ key: "granot_lifecycle" })
    .session(input.session).lean().exec();
  if (
    !observation || !decision || String(decision.observation_id) !== String(observation._id) ||
    decision.execution_mode !== "live" || !activation || observation.captured_at < activation.activated_at ||
    observation.booking_action?.normalized !== "booked" ||
    observation.identity?.normalized_job_no !== caseRow.normalized_job_no ||
    !observation.identity?.job_no_raw
  ) {
    throw lifecycle("Accepted Referral Observation is incompatible with the case", "IDENTITY_CONFLICT", 409, input.input.request_id);
  }
  const sourcePolicy = decision.source_policy;
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
      }).session(input.session).lean().exec()
    : null;
  if (!source || !source.lifecycle_policy_version) {
    throw lifecycle("Reviewed Referral source policy is no longer active", "POLICY_BLOCKED", 422, input.input.request_id);
  }
  const catalogs = await loadActiveCatalog(input.input, input.session, input.input.request_id);
  const activeLink = await getGranotRecordLinkModel().findOne({
    provider: "granot",
    normalized_job_no: caseRow.normalized_job_no,
    state: "active",
  }).session(input.session).lean().exec();
  const existing = await BookedLead.findOne({ normalized_job_no: caseRow.normalized_job_no })
    .session(input.session).lean().exec();
  if (existing) {
    if (
      existing.is_referral_booking !== true || existing.is_leadless_booking === true ||
      existing.lead_ref || existing.lead_model || existing.source !== "referral" ||
      !activeLink || String(activeLink.booking_ref ?? "") !== String(existing._id) ||
      activeLink.lead_ref || activeLink.source_scope || activeLink.disputed ||
      !sameOfficialBooking(existing, input.input.official_booking_details, catalogs)
    ) {
      throw lifecycle("A conflicting Booking or Record Link already exists", "IDENTITY_CONFLICT", 409, input.input.request_id);
    }
    await resolveCase(caseRow._id, caseRow.case_revision, "already_satisfied", existing._id,
      activeLink._id, input.command_execution_id, input.input.owner, input.now, input.session);
    return { entity_refs: refs(caseRow._id, existing._id, activeLink._id), warnings: [] };
  }
  assertCompatibleLink(activeLink, caseRow.normalized_job_no, input.input.request_id);

  const customerName = observation.contact?.display_name ||
    [observation.contact?.first_name, observation.contact?.last_name].filter(Boolean).join(" ") || undefined;
  const booking = new BookedLead({
    _id: new mongoose.Types.ObjectId(),
    timestamp: input.now,
    book_date: new Date(`${input.input.official_booking_details.book_date}T00:00:00.000Z`),
    job_no: observation.identity.job_no_raw,
    customer_name: customerName,
    agent_allocations: input.input.official_booking_details.agent_allocations.map((row) => ({
      agent: toObjectId(row.agent_id),
      agent_name_snapshot: catalogs.agent_names.get(row.agent_id)!,
      binder_amount: cents(row.binder_amount) / 100,
    })),
    total_binder_amount: cents(input.input.official_booking_details.total_binder_amount) / 100,
    deposit_amount: cents(input.input.official_booking_details.deposit_amount) / 100,
    merchant: catalogs.merchant_name,
    source: "referral",
    is_referral_booking: true,
    is_leadless_booking: false,
    over_2000: input.input.official_booking_details.deposit_amount > 2000,
    over_4000: input.input.official_booking_details.deposit_amount > 4000,
    domain_revision: 0,
  });
  await booking.save({ session: input.session });
  failAfter(input.test_fail_after, "booking");

  const link = await persistReferralLink(activeLink, {
    normalized_job_no: caseRow.normalized_job_no,
    job_no_snapshot: observation.identity.job_no_raw,
    booking_id: booking._id,
    observation_id: observation._id,
    decision_id: toObjectId(input.causal.decision_id),
    captured_at: observation.captured_at,
    now: input.now,
    session: input.session,
    request_id: input.input.request_id,
  });
  failAfter(input.test_fail_after, "link");
  await persistEntityChangeMutations({
    session: input.session,
    now: input.now,
    command_name: CREATE_REFERRAL_BOOKING_COMMAND_NAME,
    command_execution_id: input.command_execution_id,
    context: input.context,
    mutations: [
      {
        change_id: input.change_ids[0]!,
        entity: { model: "BookedLead", id: String(booking._id) },
        revision_before: 0,
        fields: collectDocumentFieldChanges(null, booking.toObject() as Record<string, unknown>, BOOKED_LEAD_CHANGE_PATHS),
      },
      {
        change_id: input.change_ids[1]!,
        entity: { model: "GranotRecordLink", id: String(link.after._id) },
        revision_before: Number(link.before?.domain_revision ?? 0),
        fields: collectDocumentFieldChanges(link.before as unknown as Record<string, unknown> | null,
          link.after as unknown as Record<string, unknown>, RECORD_LINK_CHANGE_PATHS),
      },
    ],
  });
  failAfter(input.test_fail_after, "changes");
  await resolveCase(caseRow._id, caseRow.case_revision, "referral_booking_created", booking._id,
    link.after._id, input.command_execution_id, input.input.owner, input.now, input.session);
  failAfter(input.test_fail_after, "case");
  await persistSheetSyncIntent({
    resource: "booked_lead",
    operation: "referral_booking.create",
    bookingId: String(booking._id),
  }, input.session);
  failAfter(input.test_fail_after, "outbox");
  return { entity_refs: refs(caseRow._id, booking._id, link.after._id), warnings: [] };
}

async function loadCausalContext(caseId: string, requestId?: string) {
  const row = await getGranotBookingReconciliationCaseModel().findById(caseId).lean().exec();
  if (!row) throw lifecycle("Granot reconciliation case not found", "CASE_NOT_FOUND", 404, requestId);
  const first = row.evidence[0];
  if (!first) throw lifecycle("Booking case has no causal evidence", "IDENTITY_CONFLICT", 409, requestId);
  const observation = await getGranotObservationModel().findById(first.observation_id).lean().exec();
  const receipt = observation
    ? await getGranotObservationReceiptModel().findById(observation.receipt_id).lean().exec()
    : null;
  if (!observation || !receipt) {
    throw lifecycle("Booking case causal evidence is unavailable", "IDENTITY_CONFLICT", 409, requestId);
  }
  return {
    receipt_id: String(receipt._id),
    observation_id: String(first.observation_id),
    decision_id: String(first.decision_id),
    channel: receipt.observation_channel as ObservationChannel,
  };
}

async function loadActiveCatalog(input: ReferralBookingInput, session: ClientSession, requestId?: string) {
  const ids = input.official_booking_details.agent_allocations.map((row) => toObjectId(row.agent_id));
  const [agents, merchant] = await Promise.all([
    Agent.find({ _id: { $in: ids }, active: true }).session(session).lean().exec(),
    Merchant.findOne({ _id: toObjectId(input.official_booking_details.merchant_id), active: true })
      .session(session).lean().exec(),
  ]);
  if (agents.length !== ids.length || !merchant) {
    throw lifecycle("Submitted Agent or Merchant is unknown or inactive", "VALIDATION_FAILED", 400, requestId);
  }
  return {
    agent_names: new Map(agents.map((row) => [String(row._id), row.name])),
    merchant_name: merchant.name,
  };
}

async function persistReferralLink(
  current: GranotRecordLinkDocument | null,
  input: {
    normalized_job_no: string;
    job_no_snapshot: string;
    booking_id: mongoose.Types.ObjectId;
    observation_id: mongoose.Types.ObjectId;
    decision_id: mongoose.Types.ObjectId;
    captured_at: Date;
    now: Date;
    session: ClientSession;
    request_id?: string;
  },
) {
  const Link = getGranotRecordLinkModel();
  if (!current) {
    const [created] = await Link.create([{
      provider: "granot",
      normalized_job_no: input.normalized_job_no,
      job_no_snapshot: input.job_no_snapshot,
      state: "active",
      booking_ref: input.booking_id,
      disputed: false,
      established_by_decision_id: input.decision_id,
      established_at: input.now,
      last_observation_id: input.observation_id,
      last_observed_at: input.captured_at,
      domain_revision: 0,
    }], { session: input.session });
    if (!created) throw new Error("Referral Record Link creation returned no row.");
    return { before: null, after: created.toObject() };
  }
  const updated = await Link.collection.updateOne(
    { _id: current._id, state: "active", domain_revision: current.domain_revision },
    { $set: {
      booking_ref: input.booking_id,
      disputed: false,
      dispute_reason: undefined,
      last_observation_id: input.observation_id,
      last_observed_at: input.captured_at,
    } },
    { session: input.session },
  );
  if (updated.matchedCount !== 1) {
    throw lifecycle("Record Link revision changed", "DOMAIN_REVISION_CONFLICT", 409, input.request_id);
  }
  const after = await Link.findById(current._id).session(input.session).lean().exec();
  if (!after) throw new Error("Referral Record Link could not be reloaded.");
  return { before: current, after };
}

async function resolveCase(
  caseId: mongoose.Types.ObjectId,
  expectedRevision: number,
  outcome: "referral_booking_created" | "already_satisfied",
  bookingId: mongoose.Types.ObjectId,
  linkId: mongoose.Types.ObjectId,
  commandExecutionId: mongoose.Types.ObjectId,
  actor: DurableActor,
  now: Date,
  session: ClientSession,
) {
  const result = await getGranotBookingReconciliationCaseModel().updateOne(
    { _id: caseId, state: "open", case_revision: expectedRevision },
    { $set: {
      state: "resolved",
      resolved_at: now,
      deterministic_booking_id: bookingId,
      record_link_id: linkId,
      resolution: {
        outcome,
        command_execution_id: commandExecutionId,
        actor,
        resolved_at: now,
        entity_ref: { model: "BookedLead", id: String(bookingId) },
      },
    }, $inc: { case_revision: 1 } },
    { session },
  );
  if (result.matchedCount !== 1) {
    throw lifecycle("Granot reconciliation case revision changed", "CASE_REVISION_CONFLICT", 409);
  }
}

function assertCompatibleLink(link: GranotRecordLinkDocument | null, normalizedJobNo: string, requestId?: string) {
  if (!link) return;
  if (
    link.provider !== "granot" || link.normalized_job_no !== normalizedJobNo ||
    link.booking_ref || link.lead_ref || link.source_scope || link.disputed
  ) {
    throw lifecycle("Record Link has an incompatible identity claim", "IDENTITY_CONFLICT", 409, requestId);
  }
}

function assertStableEvidence(
  row: { evidence: Array<{ observation_id: mongoose.Types.ObjectId; decision_id: mongoose.Types.ObjectId }> },
  causal: Awaited<ReturnType<typeof loadCausalContext>>,
  requestId?: string,
) {
  const first = row.evidence[0];
  if (!first || String(first.observation_id) !== causal.observation_id || String(first.decision_id) !== causal.decision_id) {
    throw lifecycle("Booking case causal evidence changed", "IDENTITY_CONFLICT", 409, requestId);
  }
}

function commandBody(input: ReferralBookingInput): GranotLifecycleCreateReferralBookingCommandInput {
  return {
    expected_case_revision: input.expected_case_revision,
    official_booking_details: input.official_booking_details,
  };
}

function refs(caseId: mongoose.Types.ObjectId, bookingId: mongoose.Types.ObjectId, linkId: mongoose.Types.ObjectId) {
  return [
    { model: "GranotBookingReconciliationCase", id: String(caseId) },
    { model: "BookedLead", id: String(bookingId) },
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

function cents(value: number) { return Math.round(value * 100); }
function sameOfficialBooking(
  booking: Record<string, unknown>,
  details: ReferralBookingInput["official_booking_details"],
  catalogs: Awaited<ReturnType<typeof loadActiveCatalog>>,
) {
  const bookDate = booking.book_date instanceof Date
    ? booking.book_date.toISOString().slice(0, 10)
    : new Date(String(booking.book_date)).toISOString().slice(0, 10);
  const allocations = booking.agent_allocations as Array<{
    agent: unknown;
    agent_name_snapshot: string;
    binder_amount: number;
  }> | undefined;
  return bookDate === details.book_date &&
    cents(Number(booking.total_binder_amount)) === cents(details.total_binder_amount) &&
    cents(Number(booking.deposit_amount)) === cents(details.deposit_amount) &&
    booking.merchant === catalogs.merchant_name &&
    allocations?.length === details.agent_allocations.length &&
    details.agent_allocations.every((allocation, index) => {
      const current = allocations[index];
      return current && String(current.agent) === allocation.agent_id &&
        current.agent_name_snapshot === catalogs.agent_names.get(allocation.agent_id) &&
        cents(current.binder_amount) === cents(allocation.binder_amount);
    });
}
function isDuplicateKey(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 11000);
}
function failAfter(selected: FailurePoint | undefined, current: FailurePoint) {
  if (selected === current) throw new Error(`UNIT28_INJECTED_FAILURE_AFTER_${current.toUpperCase()}`);
}
function lifecycle(message: string, key: keyof typeof GRANOT_LIFECYCLE_ERROR_CODES, status: number, requestId?: string) {
  return new GranotLifecycleError(message, GRANOT_LIFECYCLE_ERROR_CODES[key], status, requestId);
}
