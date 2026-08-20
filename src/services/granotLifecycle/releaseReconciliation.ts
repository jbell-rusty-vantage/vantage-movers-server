import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import type {
  GranotReleaseCaseEvidence,
  GranotReleaseReconciliationCaseDocument,
} from "../../models/GranotReleaseReconciliationCase";
import { getGranotReleaseReconciliationCaseModel } from "../../models/GranotReleaseReconciliationCase";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import type {
  SynchronizationDecisionDocument,
  SynchronizationDecisionSourceScope,
} from "../../models/SynchronizationDecision";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { toObjectId } from "../../utils/objectId";
import { emitGranotLifecycleEvent } from "./observability";
import {
  createMongoLeadIdentityStore,
  resolveLeadIdentity,
  type LeadIdentityResult,
} from "./identity";
import type { EvaluatedGate } from "./sourcePolicy";
import { createMongoSourcePolicyStore, resolveSourcePolicy } from "./sourcePolicy";
import type {
  ExecutionMode,
  GranotDiscrepancyReasonCode,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";
import * as releaseOwnerCommands from "./releaseOwnerCommands";

export type ReleaseReconciliationCurrentContext = {
  observation_id: string;
  receipt_id: string;
  captured_at: Date;
  normalized_job_no?: string;
  job_no_snapshot?: string;
  booking_action?: "booked" | "release";
  identity: LeadIdentityResult;
  observed_context?: GranotReleaseReconciliationCaseDocument["observed_context"];
  record_link_id?: string;
  booking?: {
    id: string;
    domain_revision: number;
    has_lead: boolean;
    officially_cancelled: boolean;
    cancellation_id?: string;
  };
};

export type ReleaseReconciliationClassification =
  | {
      kind: "case";
      deterministic_booking_id: string;
      booking_revision_at_open: number;
    }
  | {
      kind: "already_current";
      reason_code: "booking_already_cancelled";
      booking_id: string;
      cancellation_id?: string;
    }
  | {
      kind: "release_discrepancy_required";
      reason_code: GranotDiscrepancyReasonCode;
    }
  | {
      kind: "none";
      reason:
        | "missing_job_number"
        | "not_release_evidence"
        | "identity_conflict_unmapped";
    };

export type PreparedReleaseReconciliationDecision = {
  receipt_id: mongoose.Types.ObjectId;
  observation_id: mongoose.Types.ObjectId;
  attempt: number;
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationDecisionDocument["match_method"];
  source_scope?: SynchronizationDecisionSourceScope;
  candidates: SynchronizationDecisionDocument["candidates"];
  evaluated_gates: EvaluatedGate[];
  effects: SynchronizationDecisionDocument["effects"];
  decided_at: Date;
};

export type ReleaseCaseEffectResult =
  | {
      kind: "opened" | "refreshed";
      case_ref: { model: "GranotReleaseReconciliationCase"; id: string };
      outcome: "linked";
      reason_code: "release_case_opened" | "release_case_refreshed";
      case_revision: number;
      evidence_revision: number;
    }
  | {
      kind: "already_current";
      outcome: "already_current";
      reason_code: "booking_already_cancelled";
      target: { model: "BookedLead" | "CancelledLead"; id: string };
    }
  | {
      kind: "release_discrepancy_required";
      reason_code: GranotDiscrepancyReasonCode;
    }
  | {
      kind: "none";
      reason: "missing_job_number" | "not_release_evidence" | "identity_conflict_unmapped";
    };

export type ReleaseCaseRefreshInput = {
  case_id: mongoose.Types.ObjectId;
  evidence: GranotReleaseCaseEvidence;
  observed_context: GranotReleaseReconciliationCaseDocument["observed_context"];
  owner_state_changed: boolean;
};

export interface ReleaseReconciliationPersistenceStore {
  withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T>;
  loadCurrentContext(
    observationId: string,
    session: ClientSession,
  ): Promise<ReleaseReconciliationCurrentContext>;
  findOpenCase(
    normalizedJobNo: string,
    session: ClientSession,
  ): Promise<GranotReleaseReconciliationCaseDocument | null>;
  findMaxSequence(normalizedJobNo: string, session: ClientSession): Promise<number>;
  insertCase(
    row: GranotReleaseReconciliationCaseDocument,
    session: ClientSession,
  ): Promise<GranotReleaseReconciliationCaseDocument>;
  refreshCase(
    input: ReleaseCaseRefreshInput,
    session: ClientSession,
  ): Promise<GranotReleaseReconciliationCaseDocument>;
  insertDecision(
    decision: SynchronizationDecisionDocument,
    receiptId: mongoose.Types.ObjectId,
    session: ClientSession,
  ): Promise<void>;
  findDecision?(
    observationId: mongoose.Types.ObjectId,
    attempt: number,
    session: ClientSession,
  ): Promise<SynchronizationDecisionDocument | null>;
}

export interface GranotReleaseReconciliation {
  reconcileObservation(input: {
    observation_id: string;
    decision_id: string;
  }): Promise<ReleaseCaseEffectResult>;
  confirmCancellation(input: import("./releaseOwnerCommands").ConfirmCancellationInput):
    Promise<import("./releaseOwnerCommands").ReleaseOwnerCommandResult>;
  updateExistingBooking(input: import("./releaseOwnerCommands").UpdateReleaseBookingInput):
    Promise<import("./releaseOwnerCommands").ReleaseOwnerCommandResult>;
  noAction(input: import("./releaseOwnerCommands").ReleaseNoActionInput):
    Promise<import("./releaseOwnerCommands").ReleaseOwnerCommandResult>;
}

export {
  confirmCancellation,
  updateExistingBooking,
  noAction,
} from "./releaseOwnerCommands";
export type {
  ConfirmCancellationInput,
  UpdateReleaseBookingInput,
  ReleaseNoActionInput,
  ReleaseOwnerCommandResult,
} from "./releaseOwnerCommands";

export function createGranotReleaseReconciliation(input: {
  prepared: PreparedReleaseReconciliationDecision;
  store?: ReleaseReconciliationPersistenceStore;
}): GranotReleaseReconciliation {
  return {
    reconcileObservation: (ids) => reconcilePreparedObservation(
      ids,
      input.prepared,
      input.store ?? createMongoReleaseReconciliationStore(),
    ),
    confirmCancellation: releaseOwnerCommands.confirmCancellation,
    updateExistingBooking: releaseOwnerCommands.updateExistingBooking,
    noAction: releaseOwnerCommands.noAction,
  };
}

async function reconcilePreparedObservation(
  input: { observation_id: string; decision_id: string },
  prepared: PreparedReleaseReconciliationDecision,
  store: ReleaseReconciliationPersistenceStore,
): Promise<ReleaseCaseEffectResult> {
  assertPreparedInput(input, prepared);
  if (
    prepared.execution_mode !== "live" ||
    !prepared.evaluated_gates.every((gate) => gate.allowed)
  ) {
    throw new Error("Release reconciliation requires a prepared live Decision with all gates allowed.");
  }

  let result: ReleaseCaseEffectResult | undefined;
  for (let raceAttempt = 0; raceAttempt < 2; raceAttempt += 1) {
    try {
      result = await reconcileInTransaction(input, prepared, store);
      break;
    } catch (error) {
      if (raceAttempt === 1 || !isRetryableReleaseCaseRace(error)) throw error;
    }
  }
  if (!result) throw new Error("Release reconciliation did not produce a result.");
  if (result.kind === "opened" || result.kind === "refreshed") {
    await emitGranotLifecycleEvent({
      eventKey: `granot_lifecycle.${result.reason_code}`,
      category: "booking",
      workflow: "granot_release_reconciliation",
      summary: result.kind === "opened"
        ? "Granot Release reconciliation case opened"
        : "Granot Release reconciliation case refreshed",
      details: {
        case_id: result.case_ref.id,
        observation_id: input.observation_id,
        decision_id: input.decision_id,
        kind: "release",
        mode: "release",
        case_revision: result.case_revision,
        evidence_revision: result.evidence_revision,
      },
      piiPolicy: "masked",
    });
  }
  return result;
}

async function reconcileInTransaction(
  input: { observation_id: string; decision_id: string },
  prepared: PreparedReleaseReconciliationDecision,
  store: ReleaseReconciliationPersistenceStore,
): Promise<ReleaseCaseEffectResult> {
  return store.withTransaction(async (session) => {
    const current = await store.loadCurrentContext(input.observation_id, session);
    if (
      current.observation_id !== input.observation_id ||
      current.receipt_id !== String(prepared.receipt_id)
    ) {
      throw new Error("Prepared Release reconciliation evidence no longer matches current Observation context.");
    }

    const classification = classifyReleaseReconciliation(current);
    if (classification.kind === "none") return classification;
    if (classification.kind === "already_current") {
      const target = classification.cancellation_id
        ? { model: "CancelledLead" as const, id: classification.cancellation_id }
        : { model: "BookedLead" as const, id: classification.booking_id };
      await store.insertDecision(
        decisionDocument(toObjectId(input.decision_id), prepared, {
          outcome: "already_current",
          reason_code: "booking_already_cancelled",
          target,
          effects: [],
        }),
        prepared.receipt_id,
        session,
      );
      return {
        kind: "already_current",
        outcome: "already_current",
        reason_code: "booking_already_cancelled",
        target,
      };
    }
    if (classification.kind === "release_discrepancy_required") {
      return classification;
    }

    const evidence: GranotReleaseCaseEvidence = {
      observation_id: prepared.observation_id,
      decision_id: toObjectId(input.decision_id),
      captured_at: current.captured_at,
      action: "release",
    };
    const existing = await store.findOpenCase(current.normalized_job_no!, session);
    let row: GranotReleaseReconciliationCaseDocument;
    let effect: "release_case_opened" | "release_case_refreshed";
    if (existing) {
      if (String(existing.deterministic_booking_id) !== classification.deterministic_booking_id) {
        throw new Error("Release case cannot silently retarget to a different Booking.");
      }
      if (existing.evidence.some(
        (row) => String(row.observation_id) === input.observation_id,
      )) {
        const priorDecision = await store.findDecision?.(
          prepared.observation_id,
          prepared.attempt,
          session,
        );
        if (priorDecision && String(priorDecision._id) !== input.decision_id) {
          throw new Error("Observation replay supplied a different Release Decision ID.");
        }
        return {
          kind: "refreshed",
          case_ref: {
            model: "GranotReleaseReconciliationCase",
            id: String(existing._id),
          },
          outcome: "linked",
          reason_code: "release_case_refreshed",
          case_revision: existing.case_revision,
          evidence_revision: existing.evidence_revision,
        };
      }
      row = await store.refreshCase(
        {
          case_id: existing._id,
          evidence,
          observed_context: current.observed_context ?? {},
          owner_state_changed:
            existing.booking_revision_at_open !== classification.booking_revision_at_open ||
            String(existing.record_link_id ?? "") !== String(current.record_link_id ?? ""),
        },
        session,
      );
      effect = "release_case_refreshed";
    } else {
      const sequence = (await store.findMaxSequence(current.normalized_job_no!, session)) + 1;
      row = await store.insertCase(
        {
          _id: new mongoose.Types.ObjectId(),
          normalized_job_no: current.normalized_job_no!,
          job_no_snapshot: current.job_no_snapshot!,
          action_kind: "release",
          sequence_number: sequence,
          state: "open",
          case_revision: 1,
          evidence_revision: 1,
          source_scope: prepared.source_scope
            ? {
                granot_crm_source_id: prepared.source_scope.granot_crm_source_id,
                lead_source_company: prepared.source_scope.lead_source_company,
                source_granularity_id: prepared.source_scope.source_granularity_id,
              }
            : undefined,
          record_link_id: current.record_link_id
            ? toObjectId(current.record_link_id)
            : undefined,
          deterministic_booking_id: toObjectId(classification.deterministic_booking_id),
          booking_revision_at_open: classification.booking_revision_at_open,
          evidence: [evidence],
          observed_context: current.observed_context ?? {},
          opened_at: prepared.decided_at,
          last_evidence_at: current.captured_at,
        },
        session,
      );
      effect = "release_case_opened";
    }

    const caseRef = {
      model: "GranotReleaseReconciliationCase" as const,
      id: String(row._id),
    };
    await store.insertDecision(
      decisionDocument(toObjectId(input.decision_id), prepared, {
        outcome: "linked",
        reason_code: effect,
        target: caseRef,
        effects: [{ kind: effect, ref: caseRef }],
      }),
      prepared.receipt_id,
      session,
    );
    return {
      kind: effect === "release_case_opened" ? "opened" : "refreshed",
      case_ref: caseRef,
      outcome: "linked",
      reason_code: effect,
      case_revision: row.case_revision,
      evidence_revision: row.evidence_revision,
    };
  });
}

/** Unit 29 owner commands reuse the production classifier/case store inside their existing transaction. */
export async function reconcileReleaseCaseAfterDiscrepancy(input: {
  observation_id: string;
  decision_id: string;
  opened_at: Date;
  session: ClientSession;
}): Promise<{ model: "GranotReleaseReconciliationCase"; id: string } | undefined> {
  const store = createMongoReleaseReconciliationStore();
  const current = await store.loadCurrentContext(input.observation_id, input.session);
  const classification = classifyReleaseReconciliation(current);
  if (classification.kind !== "case") return undefined;
  const decision = await getSynchronizationDecisionModel().findById(input.decision_id).session(input.session).lean().exec();
  const evidence: GranotReleaseCaseEvidence = { observation_id: toObjectId(input.observation_id), decision_id: toObjectId(input.decision_id), captured_at: current.captured_at, action: "release" };
  const existing = await store.findOpenCase(current.normalized_job_no!, input.session);
  let row: GranotReleaseReconciliationCaseDocument;
  if (existing) {
    if (String(existing.deterministic_booking_id) !== classification.deterministic_booking_id) throw new Error("Release case cannot silently retarget to a different Booking.");
    row = existing.evidence.some((item) => String(item.observation_id) === input.observation_id) ? existing : await store.refreshCase({
      case_id: existing._id, evidence, observed_context: current.observed_context ?? {},
      owner_state_changed: existing.booking_revision_at_open !== classification.booking_revision_at_open || String(existing.record_link_id ?? "") !== String(current.record_link_id ?? ""),
    }, input.session);
  } else {
    const sequence = (await store.findMaxSequence(current.normalized_job_no!, input.session)) + 1;
    row = await store.insertCase({
      _id: new mongoose.Types.ObjectId(), normalized_job_no: current.normalized_job_no!, job_no_snapshot: current.job_no_snapshot!, action_kind: "release", sequence_number: sequence,
      state: "open", case_revision: 1, evidence_revision: 1, source_scope: decision?.source_scope ? { ...decision.source_scope } : undefined,
      record_link_id: current.record_link_id ? toObjectId(current.record_link_id) : undefined,
      deterministic_booking_id: toObjectId(classification.deterministic_booking_id), booking_revision_at_open: classification.booking_revision_at_open,
      evidence: [evidence], observed_context: current.observed_context ?? {}, opened_at: input.opened_at, last_evidence_at: current.captured_at,
    }, input.session);
  }
  return { model: "GranotReleaseReconciliationCase", id: String(row._id) };
}

export function createMongoReleaseReconciliationStore(): ReleaseReconciliationPersistenceStore {
  return {
    withTransaction,
    async loadCurrentContext(observationId, session) {
      const observation = await getGranotObservationModel()
        .findById(observationId)
        .session(session)
        .lean()
        .exec();
      if (!observation) {
        throw new Error("Granot Observation was not found for Release reconciliation.");
      }

      const policy = await resolveSourcePolicy(
        {
          source_label: observation.normalized_source_label ?? observation.source_label_raw ?? "",
          origin_state: observation.move?.origin?.state,
          destination_state: observation.move?.destination?.state,
          provider_type: observation.provider_context?.type_raw,
        },
        createMongoSourcePolicyStore(session),
      );
      const policySnapshot = policy.snapshot ?? {
        granot_crm_source_id: "",
        lifecycle_disposition: "deferred" as const,
        lead_created_policy: "observation_only" as const,
        operational_enabled: false,
        lifecycle_enabled: false,
        source_company_active: false,
        source_granularity_active: false,
      };
      const identity = await resolveLeadIdentity(
        {
          observation: {
            identity: observation.identity,
            contact: {
              normalized_phone: observation.contact?.normalized_phone,
              normalized_email: observation.contact?.normalized_email,
            },
            agent_identity: observation.agent_identity,
            provider_context: observation.provider_context,
          },
          policy: policySnapshot,
          policy_failure: policy.ok
            ? undefined
            : { outcome: policy.outcome, reason: policy.reason },
        },
        createMongoLeadIdentityStore(session),
      );

      const normalizedJobNo = observation.identity?.normalized_job_no;
      const recordLink = normalizedJobNo
        ? await getGranotRecordLinkModel()
            .findOne({ provider: "granot", normalized_job_no: normalizedJobNo, state: "active" })
            .session(session)
            .select({ _id: 1 })
            .lean()
            .exec()
        : null;
      const bookingRef = identity.booking_context?.booking;
      const bookingRow = bookingRef
        ? await BookedLead.findById(bookingRef.id).session(session).lean().exec()
        : null;
      let booking: ReleaseReconciliationCurrentContext["booking"];
      if (bookingRow) {
        const cancellation = await CancelledLead.findOne({ booked_lead: bookingRow._id })
          .session(session)
          .select({ _id: 1 })
          .lean()
          .exec();
        booking = {
          id: String(bookingRow._id),
          domain_revision: bookingRow.domain_revision,
          has_lead: Boolean(bookingRow.lead_ref && bookingRow.lead_model),
          officially_cancelled: Boolean(bookingRow.cancelled) || Boolean(cancellation),
          cancellation_id: cancellation
            ? String(cancellation._id)
            : bookingRow.cancelled
              ? String(bookingRow.cancelled)
              : undefined,
        };
      }

      return {
        observation_id: String(observation._id),
        receipt_id: String(observation.receipt_id),
        captured_at: new Date(observation.captured_at),
        normalized_job_no: normalizedJobNo,
        job_no_snapshot: observation.identity?.job_no_raw ?? normalizedJobNo,
        booking_action: observation.booking_action?.normalized,
        identity,
        record_link_id: recordLink ? String(recordLink._id) : undefined,
        booking,
        observed_context: observationToObservedContext(observation),
      };
    },
    async findOpenCase(normalizedJobNo, session) {
      return getGranotReleaseReconciliationCaseModel()
        .findOne({ normalized_job_no: normalizedJobNo, action_kind: "release", state: "open" })
        .session(session)
        .lean()
        .exec();
    },
    async findMaxSequence(normalizedJobNo, session) {
      const row = await getGranotReleaseReconciliationCaseModel()
        .findOne({ normalized_job_no: normalizedJobNo, action_kind: "release" })
        .sort({ sequence_number: -1 })
        .session(session)
        .select({ sequence_number: 1 })
        .lean()
        .exec();
      return row?.sequence_number ?? 0;
    },
    async insertCase(row, session) {
      const [created] = await getGranotReleaseReconciliationCaseModel().create([row], { session });
      if (!created) throw new Error("Granot Release reconciliation case insert returned no row.");
      return created.toObject() as GranotReleaseReconciliationCaseDocument;
    },
    async refreshCase(input, session) {
      const increments: Record<string, number> = { evidence_revision: 1 };
      if (input.owner_state_changed) increments.case_revision = 1;
      const updated = await getGranotReleaseReconciliationCaseModel()
        .findOneAndUpdate(
          {
            _id: input.case_id,
            state: "open",
            "evidence.observation_id": { $ne: input.evidence.observation_id },
          },
          {
            $push: { evidence: input.evidence },
            $set: {
              observed_context: input.observed_context,
              last_evidence_at: input.evidence.captured_at,
            },
            $inc: increments,
          },
          { session, returnDocument: "after", runValidators: true },
        )
        .lean()
        .exec();
      if (updated) return updated;
      const replay = await getGranotReleaseReconciliationCaseModel()
        .findOne({ _id: input.case_id, state: "open" })
        .session(session)
        .lean()
        .exec();
      if (!replay) throw new Error("Resolved Release reconciliation case cannot be refreshed.");
      return replay;
    },
    async insertDecision(decision, receiptId, session) {
      await getSynchronizationDecisionModel().create([decision], { session });
      await getGranotObservationReceiptModel().collection.updateOne(
        { _id: receiptId },
        { $set: { "processing.latest_decision_id": decision._id } },
        { session },
      );
    },
    async findDecision(observationId, attempt, session) {
      return getSynchronizationDecisionModel()
        .findOne({ observation_id: observationId, attempt })
        .session(session)
        .lean()
        .exec();
    },
  };
}

export function classifyReleaseReconciliation(
  context: ReleaseReconciliationCurrentContext,
): ReleaseReconciliationClassification {
  if (!context.normalized_job_no || !context.job_no_snapshot) {
    return { kind: "none", reason: "missing_job_number" };
  }
  if (context.booking_action !== "release") {
    return { kind: "none", reason: "not_release_evidence" };
  }

  if (context.booking?.officially_cancelled) {
    return {
      kind: "already_current",
      reason_code: "booking_already_cancelled",
      booking_id: context.booking.id,
      cancellation_id: context.booking.cancellation_id,
    };
  }

  if (context.identity.outcome === "conflict") {
    const reason = releaseDiscrepancyReason(context.identity.reason_code);
    return reason
      ? { kind: "release_discrepancy_required", reason_code: reason }
      : { kind: "none", reason: "identity_conflict_unmapped" };
  }

  if (!context.booking) {
    return {
      kind: "release_discrepancy_required",
      reason_code: "release_without_vantage_booking",
    };
  }

  return {
    kind: "case",
    deterministic_booking_id: context.booking.id,
    booking_revision_at_open: context.booking.domain_revision,
  };
}

function releaseDiscrepancyReason(
  reason: string,
): GranotDiscrepancyReasonCode | undefined {
  if (reason === "record_link_conflict") return "release_record_link_conflict";
  if (reason === "job_number_conflict") return "release_job_number_conflict";
  if (reason === "source_scope_conflict") return "release_source_scope_conflict";
  return undefined;
}

function observationToObservedContext(observation: {
  contact?: {
    first_name?: string;
    last_name?: string;
    display_name?: string;
    phone_raw?: string;
    email_raw?: string;
  };
  move?: { move_date?: Date; estimated_cubic_feet?: number };
  display_money?: {
    estimate?: { raw: string };
    payment?: { raw: string };
    balance?: { raw: string };
  };
  priority?: { canonical?: string };
  agent_identity?: { user_raw?: string; rep_raw?: string };
}): GranotReleaseReconciliationCaseDocument["observed_context"] {
  const joinedName = [observation.contact?.first_name, observation.contact?.last_name]
    .filter(Boolean)
    .join(" ");
  const contactName = (observation.contact?.display_name ?? joinedName) || undefined;
  const contact = contactName || observation.contact?.phone_raw || observation.contact?.email_raw
    ? {
        name: contactName,
        phone_number: observation.contact?.phone_raw,
        email: observation.contact?.email_raw,
      }
    : undefined;
  return {
    contact,
    move_date: observation.move?.move_date,
    estimated_cubic_feet: observation.move?.estimated_cubic_feet,
    estimate: observation.display_money?.estimate?.raw,
    payment: observation.display_money?.payment?.raw,
    balance: observation.display_money?.balance?.raw,
    granot_priority: observation.priority?.canonical,
    granot_username: observation.agent_identity?.user_raw ?? observation.agent_identity?.rep_raw,
  };
}

function assertPreparedInput(
  input: { observation_id: string; decision_id: string },
  prepared: PreparedReleaseReconciliationDecision,
): void {
  if (
    !mongoose.isValidObjectId(input.observation_id) ||
    !mongoose.isValidObjectId(input.decision_id)
  ) {
    throw new Error("Release reconciliation requires valid Observation and Decision IDs.");
  }
  if (String(prepared.observation_id) !== input.observation_id) {
    throw new Error("Prepared Release Decision does not belong to the requested Observation.");
  }
}

function decisionDocument(
  id: mongoose.Types.ObjectId,
  prepared: PreparedReleaseReconciliationDecision,
  override: Partial<SynchronizationDecisionDocument> = {},
): SynchronizationDecisionDocument {
  return {
    _id: id,
    observation_id: prepared.observation_id,
    attempt: prepared.attempt,
    execution_mode: prepared.execution_mode,
    outcome: prepared.outcome,
    reason_code: prepared.reason_code,
    match_method: prepared.match_method,
    source_scope: prepared.source_scope,
    candidates: prepared.candidates,
    evaluated_gates: prepared.evaluated_gates,
    effects: prepared.effects,
    decided_at: prepared.decided_at,
    ...override,
  };
}

function isRetryableReleaseCaseRace(error: unknown): boolean {
  if (
    error instanceof mongoose.mongo.MongoServerError &&
    (error.code === 11000 || error.code === 112 || error.code === 251)
  ) {
    return true;
  }
  const labels = error && typeof error === "object" && "errorLabels" in error
    ? (error as { errorLabels?: unknown }).errorLabels
    : undefined;
  return Array.isArray(labels) && labels.some(
    (label) => label === "TransientTransactionError" || label === "UnknownTransactionCommitResult",
  );
}
