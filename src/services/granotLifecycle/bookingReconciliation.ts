import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import { BookedLead } from "../../models/BookedLead";
import { BookingLeadReconciliationCase } from "../../models/BookingLeadReconciliationCase";
import { CancelledLead } from "../../models/CancelledLead";
import type {
  GranotBookingCaseEvidence,
  GranotBookingReconciliationCaseDocument,
} from "../../models/GranotBookingReconciliationCase";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getGranotRecordLinkModel } from "../../models/GranotRecordLink";
import type {
  SynchronizationDecisionDocument,
  SynchronizationDecisionSourceScope,
} from "../../models/SynchronizationDecision";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { toObjectId } from "../../utils/objectId";
import { recordOperationalEvent } from "../observability";
import { setGranotLifecycleOpenBookingCases } from "./metrics";
import type { EvaluatedGate } from "./sourcePolicy";
import { createMongoSourcePolicyStore, resolveSourcePolicy } from "./sourcePolicy";
import type { LeadIdentityResult, SynchronizationMatchMethod } from "./identity";
import { createMongoLeadIdentityStore, resolveLeadIdentity } from "./identity";
import type {
  ExecutionMode,
  EntityRef,
  GranotDiscrepancyReasonCode,
  LeadModel,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";

export type BookingReconciliationCurrentContext = {
  observation_id: string;
  receipt_id: string;
  captured_at: Date;
  normalized_job_no?: string;
  job_no_snapshot?: string;
  priority: { canonical?: string; valid: boolean };
  booking_action?: "booked" | "release";
  lifecycle_disposition?: "source_scoped_lead" | "referral_booking" | "deferred";
  identity: LeadIdentityResult;
  observed_context?: GranotBookingReconciliationCaseDocument["observed_context"];
  record_link_id?: string;
  booking?: {
    id: string;
    has_lead: boolean;
    officially_cancelled: boolean;
    referral: boolean;
    employee_reconciliation_case_id?: string;
  };
};

export type BookingLeadSuggestion = {
  lead_ref: { model: LeadModel; id: string };
  confidence: "high" | "medium";
  match_method: SynchronizationMatchMethod;
  reason_codes: string[];
};

export type BookingLeadCandidateProjection = BookingLeadSuggestion & {
  suggested: boolean;
};

export type BookingReconciliationNoCaseReason =
  | "missing_job_number"
  | "not_booking_evidence"
  | "opposite_action_kind"
  | "priority_5_existing_booking"
  | "priority_5_ineligible_target"
  | "referral_owned_by_unit_28"
  | "employee_reconciliation_missing";

export type BookingReconciliationClassification =
  | {
      kind: "case";
      mode: "create_missing_booking" | "review_existing_booking";
      evidence_action: "priority_5" | "booked";
      deterministic_booking_id?: string;
    }
  | {
      kind: "employee_booking_lead_reconciliation";
      case_id: string;
    }
  | {
      kind: "booking_discrepancy_required";
      reason_code: GranotDiscrepancyReasonCode;
    }
  | {
      kind: "none";
      reason: BookingReconciliationNoCaseReason;
    };

export type PreparedBookingReconciliationDecision = {
  receipt_id: mongoose.Types.ObjectId;
  observation_id: mongoose.Types.ObjectId;
  attempt: number;
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationMatchMethod;
  source_scope?: SynchronizationDecisionSourceScope;
  candidates: SynchronizationDecisionDocument["candidates"];
  evaluated_gates: EvaluatedGate[];
  effects: SynchronizationDecisionDocument["effects"];
  decided_at: Date;
};

export type CaseEffectResult =
  | {
      kind: "opened" | "refreshed";
      case_ref: { model: "GranotBookingReconciliationCase"; id: string };
      outcome: "linked";
      reason_code: "booking_case_opened" | "booking_case_refreshed";
      mode?: GranotBookingReconciliationCaseDocument["mode"];
      case_revision?: number;
      evidence_revision?: number;
    }
  | { kind: "none"; reason: BookingReconciliationNoCaseReason }
  | { kind: "employee_booking_lead_reconciliation"; case_id: string }
  | { kind: "booking_discrepancy_required"; reason_code: GranotDiscrepancyReasonCode };

export type BookingCaseRefreshInput = {
  case_id: mongoose.Types.ObjectId;
  evidence: GranotBookingCaseEvidence;
  observed_context: GranotBookingReconciliationCaseDocument["observed_context"];
  suggested_lead?: GranotBookingReconciliationCaseDocument["suggested_lead"];
  suggestion_changed: boolean;
};

export interface BookingReconciliationPersistenceStore {
  withTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T>;
  loadCurrentContext(
    observationId: string,
    session: ClientSession,
  ): Promise<BookingReconciliationCurrentContext>;
  findOpenCase(
    normalizedJobNo: string,
    session: ClientSession,
  ): Promise<GranotBookingReconciliationCaseDocument | null>;
  findMaxSequence(normalizedJobNo: string, session: ClientSession): Promise<number>;
  insertCase(
    row: GranotBookingReconciliationCaseDocument,
    session: ClientSession,
  ): Promise<GranotBookingReconciliationCaseDocument>;
  refreshCase(
    input: BookingCaseRefreshInput,
    session: ClientSession,
  ): Promise<GranotBookingReconciliationCaseDocument>;
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
  countOpenCasesByMode(
    session?: ClientSession,
  ): Promise<Array<{ mode: string; count: number }>>;
}

export interface GranotBookingReconciliation {
  reconcileObservation(input: {
    observation_id: string;
    decision_id: string;
  }): Promise<CaseEffectResult>;
}

export function createGranotBookingReconciliation(input: {
  prepared: PreparedBookingReconciliationDecision;
  store?: BookingReconciliationPersistenceStore;
}): GranotBookingReconciliation {
  return {
    reconcileObservation: (ids) =>
      reconcilePreparedObservation(
        ids,
        input.prepared,
        input.store ?? createMongoBookingReconciliationStore(),
      ),
  };
}

async function reconcilePreparedObservation(
  input: { observation_id: string; decision_id: string },
  prepared: PreparedBookingReconciliationDecision,
  store: BookingReconciliationPersistenceStore,
): Promise<CaseEffectResult> {
  assertPreparedInput(input, prepared);
  if (
    prepared.execution_mode !== "live" ||
    !prepared.evaluated_gates.every((gate) => gate.allowed)
  ) {
    throw new Error("Booking reconciliation requires a prepared live Decision with all gates allowed.");
  }

  let result: CaseEffectResult | undefined;
  for (let raceAttempt = 0; raceAttempt < 2; raceAttempt += 1) {
    try {
      result = await reconcileInTransaction(input, prepared, store);
      break;
    } catch (error) {
      if (raceAttempt === 1 || !isRetryableBookingCaseRace(error)) throw error;
    }
  }
  if (!result) throw new Error("Booking reconciliation did not produce a result.");

  if (result.kind === "opened" || result.kind === "refreshed") {
    await recomputeOpenCaseGauge(store);
    await recordOperationalEvent({
      level: "info",
      eventKey: `granot_lifecycle.${result.reason_code}`,
      category: "booking",
      workflow: "granot_booking_reconciliation",
      summary: result.kind === "opened"
        ? "Granot Booking reconciliation case opened"
        : "Granot Booking reconciliation case refreshed",
      details: {
        case_id: maskLifecycleId(result.case_ref.id),
        observation_id: maskLifecycleId(input.observation_id),
        decision_id: maskLifecycleId(input.decision_id),
        mode: result.mode ?? "unknown",
        case_revision: result.case_revision,
        evidence_revision: result.evidence_revision,
      },
      notificationCandidate: false,
      reportable: true,
      piiPolicy: "masked",
    });
  }
  return result;
}

async function recomputeOpenCaseGauge(
  store: BookingReconciliationPersistenceStore,
): Promise<void> {
  try {
    const counts = await store.countOpenCasesByMode();
    for (const mode of ["create_missing_booking", "review_existing_booking"] as const) {
      setGranotLifecycleOpenBookingCases(
        mode,
        counts.find((row) => row.mode === mode)?.count ?? 0,
      );
    }
  } catch {
    // Metrics are best-effort and cannot turn a committed case into a caller-visible failure.
  }
}

async function reconcileInTransaction(
  input: { observation_id: string; decision_id: string },
  prepared: PreparedBookingReconciliationDecision,
  store: BookingReconciliationPersistenceStore,
): Promise<CaseEffectResult> {
  return store.withTransaction(async (session) => {
    const current = await store.loadCurrentContext(input.observation_id, session);
    if (
      current.observation_id !== input.observation_id ||
      current.receipt_id !== String(prepared.receipt_id)
    ) {
      throw new Error("Prepared Booking reconciliation evidence no longer matches current Observation context.");
    }
    const classification = classifyBookingReconciliation(current);
    if (classification.kind === "none") {
      if (classification.reason === "employee_reconciliation_missing") {
        await store.insertDecision(
          decisionDocument(toObjectId(input.decision_id), prepared),
          prepared.receipt_id,
          session,
        );
      }
      return classification;
    }
    if (classification.kind !== "case") {
      await store.insertDecision(
        decisionDocument(toObjectId(input.decision_id), prepared),
        prepared.receipt_id,
        session,
      );
      return classification;
    }

    const evidence: GranotBookingCaseEvidence = {
      observation_id: prepared.observation_id,
      decision_id: toObjectId(input.decision_id),
      captured_at: current.captured_at,
      action: classification.evidence_action,
    };
    const observed_context = observedContext(current);
    const suggestion = toBookingLeadSuggestion(current.identity);
    const suggested_lead = suggestion
      ? {
          lead_ref: {
            model: suggestion.lead_ref.model,
            id: toObjectId(suggestion.lead_ref.id),
          },
          confidence: suggestion.confidence,
          match_method: suggestion.match_method,
          reason_codes: suggestion.reason_codes,
        }
      : undefined;

    const existing = await store.findOpenCase(current.normalized_job_no!, session);
    let row: GranotBookingReconciliationCaseDocument;
    let effect: "booking_case_opened" | "booking_case_refreshed";
    if (existing) {
      if (existing.evidence.some((row) => String(row.observation_id) === input.observation_id)) {
        const priorDecision = await store.findDecision?.(
          prepared.observation_id,
          prepared.attempt,
          session,
        );
        if (priorDecision && String(priorDecision._id) !== input.decision_id) {
          throw new Error("Observation replay supplied a different Decision ID.");
        }
        return {
          kind: "refreshed",
          case_ref: { model: "GranotBookingReconciliationCase", id: String(existing._id) },
          outcome: "linked",
          reason_code: "booking_case_refreshed",
          mode: existing.mode,
          case_revision: existing.case_revision,
          evidence_revision: existing.evidence_revision,
        };
      }
      row = await store.refreshCase(
        {
          case_id: existing._id,
          evidence,
          observed_context,
          suggested_lead,
          suggestion_changed: !suggestionEquals(existing.suggested_lead, suggested_lead),
        },
        session,
      );
      effect = "booking_case_refreshed";
    } else {
      const sequence = (await store.findMaxSequence(current.normalized_job_no!, session)) + 1;
      const caseId = new mongoose.Types.ObjectId();
      row = await store.insertCase(
        {
          _id: caseId,
          normalized_job_no: current.normalized_job_no!,
          job_no_snapshot: current.job_no_snapshot!,
          action_kind: "booked",
          sequence_number: sequence,
          mode: classification.mode,
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
          deterministic_booking_id: classification.deterministic_booking_id
            ? toObjectId(classification.deterministic_booking_id)
            : undefined,
          record_link_id: current.record_link_id
            ? toObjectId(current.record_link_id)
            : undefined,
          evidence: [evidence],
          observed_context,
          suggested_lead,
          opened_at: prepared.decided_at,
          last_evidence_at: current.captured_at,
        },
        session,
      );
      effect = "booking_case_opened";
    }

    const caseRef = {
      model: "GranotBookingReconciliationCase" as const,
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
      kind: effect === "booking_case_opened" ? "opened" : "refreshed",
      case_ref: caseRef,
      outcome: "linked",
      reason_code: effect,
      mode: row.mode,
      case_revision: row.case_revision,
      evidence_revision: row.evidence_revision,
    };
  });
}

export function createMongoBookingReconciliationStore(): BookingReconciliationPersistenceStore {
  return {
    withTransaction,
    async loadCurrentContext(observationId, session) {
      const observation = await getGranotObservationModel()
        .findById(observationId)
        .session(session)
        .lean()
        .exec();
      if (!observation) throw new Error("Granot Observation was not found for Booking reconciliation.");

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
      let booking: BookingReconciliationCurrentContext["booking"];
      if (bookingRow) {
        const row = bookingRow;
        const officialCancellation =
          Boolean(row.cancelled) ||
          Boolean(await CancelledLead.exists({ booked_lead: row._id }).session(session));
        const hasLead = Boolean(row.lead_ref && row.lead_model);
        const employeeCase = !hasLead && row.is_referral_booking !== true
          ? await BookingLeadReconciliationCase.findOne({ booking: row._id })
              .sort({ updatedAt: -1 })
              .session(session)
              .select({ _id: 1 })
              .lean()
              .exec()
          : null;
        booking = {
          id: String(row._id),
          has_lead: hasLead,
          officially_cancelled: officialCancellation,
          referral: row.is_referral_booking === true,
          employee_reconciliation_case_id: employeeCase ? String(employeeCase._id) : undefined,
        };
      }

      return {
        observation_id: String(observation._id),
        receipt_id: String(observation.receipt_id),
        captured_at: new Date(observation.captured_at),
        normalized_job_no: normalizedJobNo,
        job_no_snapshot: observation.identity?.job_no_raw ?? normalizedJobNo,
        priority: observation.priority,
        booking_action: observation.booking_action?.normalized,
        lifecycle_disposition: policySnapshot.lifecycle_disposition,
        identity,
        record_link_id: recordLink ? String(recordLink._id) : undefined,
        booking,
        observed_context: observationToObservedContext(observation),
      };
    },
    async findOpenCase(normalizedJobNo, session) {
      return getGranotBookingReconciliationCaseModel()
        .findOne({ normalized_job_no: normalizedJobNo, action_kind: "booked", state: "open" })
        .session(session)
        .lean()
        .exec();
    },
    async findMaxSequence(normalizedJobNo, session) {
      const row = await getGranotBookingReconciliationCaseModel()
        .findOne({ normalized_job_no: normalizedJobNo, action_kind: "booked" })
        .sort({ sequence_number: -1 })
        .session(session)
        .select({ sequence_number: 1 })
        .lean()
        .exec();
      return row?.sequence_number ?? 0;
    },
    async insertCase(row, session) {
      const [created] = await getGranotBookingReconciliationCaseModel().create([row], { session });
      if (!created) throw new Error("Granot Booking reconciliation case insert returned no row.");
      return created.toObject() as GranotBookingReconciliationCaseDocument;
    },
    async refreshCase(input, session) {
      const increments: Record<string, number> = { evidence_revision: 1 };
      if (input.suggestion_changed) increments.case_revision = 1;
      const set: Record<string, unknown> = {
        observed_context: input.observed_context,
        last_evidence_at: input.evidence.captured_at,
      };
      if (input.suggested_lead) set.suggested_lead = input.suggested_lead;
      const unset = input.suggested_lead ? undefined : { suggested_lead: 1 };
      const updated = await getGranotBookingReconciliationCaseModel()
        .findOneAndUpdate(
          {
            _id: input.case_id,
            state: "open",
            "evidence.observation_id": { $ne: input.evidence.observation_id },
          },
          {
            $push: { evidence: input.evidence },
            $set: set,
            $inc: increments,
            ...(unset ? { $unset: unset } : {}),
          },
          { session, returnDocument: "after", runValidators: true },
        )
        .lean()
        .exec();
      if (updated) return updated;
      const replay = await getGranotBookingReconciliationCaseModel()
        .findOne({ _id: input.case_id, state: "open" })
        .session(session)
        .lean()
        .exec();
      if (!replay) throw new Error("Resolved Booking reconciliation case cannot be refreshed.");
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
    async countOpenCasesByMode(session) {
      const rows = await getGranotBookingReconciliationCaseModel().aggregate<{
        _id: string;
        count: number;
      }>([
        { $match: { state: "open", action_kind: "booked" } },
        { $group: { _id: "$mode", count: { $sum: 1 } } },
      ]).session(session ?? null);
      return rows.map((row) => ({ mode: row._id, count: row.count }));
    },
  };
}

export function isBookingCandidateRefreshEligible(
  openedAt: Date,
  now = new Date(),
): boolean {
  const age = now.getTime() - openedAt.getTime();
  return age >= 0 && age <= 24 * 60 * 60 * 1000;
}

export function projectBookingLeadCandidates(
  identity: LeadIdentityResult,
): BookingLeadCandidateProjection[] {
  const suggested = toBookingLeadSuggestion(identity);
  const rows = identity.candidates.flatMap((candidate) => {
    if (!isLeadEntityRef(candidate.target)) return [];
    if (
      candidate.reason_codes.includes("duplicate_form_lead_ineligible") ||
      candidate.reason_codes.includes("bad_form_lead_priority_only")
    ) {
      return [];
    }
    const matchMethod = canonicalCandidateMatchMethod(candidate.reason_codes);
    if (!matchMethod) return [];
    return [{
      lead_ref: candidate.target,
      confidence: matchMethod === "source_scoped_contact" ? "medium" as const : "high" as const,
      match_method: matchMethod,
      reason_codes: candidate.reason_codes,
      suggested:
        suggested?.lead_ref.model === candidate.target.model &&
        suggested.lead_ref.id === candidate.target.id,
    }];
  });
  if (
    suggested &&
    !rows.some((row) =>
      row.lead_ref.model === suggested.lead_ref.model && row.lead_ref.id === suggested.lead_ref.id)
  ) {
    rows.unshift({ ...suggested, suggested: true });
  }
  return rows.filter(
    (row, index) =>
      rows.findIndex(
        (candidate) =>
          candidate.lead_ref.model === row.lead_ref.model &&
          candidate.lead_ref.id === row.lead_ref.id,
      ) === index,
  );
}

export async function searchBookingLeadCandidates(
  input: { observation_id: string; opened_at: Date; now?: Date },
  store: BookingReconciliationPersistenceStore = createMongoBookingReconciliationStore(),
): Promise<BookingLeadCandidateProjection[]> {
  if (!isBookingCandidateRefreshEligible(input.opened_at, input.now)) return [];
  return store.withTransaction(async (session) => {
    const current = await store.loadCurrentContext(input.observation_id, session);
    return projectBookingLeadCandidates(current.identity);
  });
}

function canonicalCandidateMatchMethod(
  reasonCodes: readonly string[],
): SynchronizationMatchMethod | undefined {
  return reasonCodes.find((reason): reason is SynchronizationMatchMethod =>
    [
      "granot_record_link",
      "form_ref_no_exact",
      "form_mongo_id_compatibility",
      "call_job_no_exact",
      "booking_job_no_exact",
      "source_scoped_contact",
    ].includes(reason),
  );
}

function isRetryableBookingCaseRace(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: number }).code : undefined;
  if (code === 11000 || code === 112) return true;
  return (
    "hasErrorLabel" in error &&
    typeof (error as { hasErrorLabel?: unknown }).hasErrorLabel === "function" &&
    (error as { hasErrorLabel(label: string): boolean }).hasErrorLabel(
      "TransientTransactionError",
    )
  );
}

function maskLifecycleId(value: string): string {
  return value.length <= 10 ? "***" : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function observationToObservedContext(observation: {
  contact?: { first_name?: string; last_name?: string; display_name?: string; phone_raw?: string; email_raw?: string };
  move?: { move_date?: Date; estimated_cubic_feet?: number };
  display_money?: { estimate?: { raw: string }; payment?: { raw: string }; balance?: { raw: string } };
  priority?: { canonical?: string };
  agent_identity?: { user_raw?: string; rep_raw?: string };
}): GranotBookingReconciliationCaseDocument["observed_context"] {
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

function suggestionEquals(
  left: GranotBookingReconciliationCaseDocument["suggested_lead"] | undefined,
  right: GranotBookingReconciliationCaseDocument["suggested_lead"] | undefined,
): boolean {
  if (!left || !right) return left == null && right == null;
  return (
    left.lead_ref.model === right.lead_ref.model &&
    String(left.lead_ref.id) === String(right.lead_ref.id) &&
    left.confidence === right.confidence &&
    left.match_method === right.match_method &&
    JSON.stringify(left.reason_codes) === JSON.stringify(right.reason_codes)
  );
}

function assertPreparedInput(
  input: { observation_id: string; decision_id: string },
  prepared: PreparedBookingReconciliationDecision,
): void {
  if (!mongoose.isValidObjectId(input.observation_id) || !mongoose.isValidObjectId(input.decision_id)) {
    throw new Error("Booking reconciliation requires valid Observation and Decision IDs.");
  }
  if (String(prepared.observation_id) !== input.observation_id) {
    throw new Error("Prepared Decision does not belong to the requested Observation.");
  }
}

function decisionDocument(
  id: mongoose.Types.ObjectId,
  prepared: PreparedBookingReconciliationDecision,
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

function observedContext(
  current: BookingReconciliationCurrentContext,
): GranotBookingReconciliationCaseDocument["observed_context"] {
  return current.observed_context ?? {};
}

export function classifyBookingReconciliation(
  context: BookingReconciliationCurrentContext,
): BookingReconciliationClassification {
  if (!context.normalized_job_no || !context.job_no_snapshot) {
    return { kind: "none", reason: "missing_job_number" };
  }

  const actualBooked = context.booking_action === "booked";
  const priorityFive = context.priority.valid && context.priority.canonical === "5";

  if (context.booking_action === "release") {
    return { kind: "none", reason: "opposite_action_kind" };
  }
  if (!actualBooked && !priorityFive) {
    return { kind: "none", reason: "not_booking_evidence" };
  }

  const booking = context.booking;
  if (context.lifecycle_disposition === "referral_booking" || booking?.referral) {
    return { kind: "none", reason: "referral_owned_by_unit_28" };
  }
  if (actualBooked && booking?.officially_cancelled) {
    return {
      kind: "booking_discrepancy_required",
      reason_code: "booked_after_official_cancellation",
    };
  }
  if (booking && !booking.has_lead) {
    return booking.employee_reconciliation_case_id
      ? {
          kind: "employee_booking_lead_reconciliation",
          case_id: booking.employee_reconciliation_case_id,
        }
      : { kind: "none", reason: "employee_reconciliation_missing" };
  }
  if (context.identity.outcome === "conflict") {
    return {
      kind: "booking_discrepancy_required",
      reason_code: discrepancyReason(context.identity.reason_code),
    };
  }

  if (actualBooked) {
    return booking
      ? {
          kind: "case",
          mode: "review_existing_booking",
          evidence_action: "booked",
          deterministic_booking_id: booking.id,
        }
      : {
          kind: "case",
          mode: "create_missing_booking",
          evidence_action: "booked",
        };
  }

  if (booking) {
    return { kind: "none", reason: "priority_5_existing_booking" };
  }
  if (
    !context.identity.target ||
    context.identity.target_eligibility !== "full" ||
    context.identity.outcome === "ambiguous"
  ) {
    return { kind: "none", reason: "priority_5_ineligible_target" };
  }
  return {
    kind: "case",
    mode: "create_missing_booking",
    evidence_action: "priority_5",
  };
}

export function toBookingLeadSuggestion(
  identity: LeadIdentityResult,
): BookingLeadSuggestion | undefined {
  const target = identity.target;
  if (
    !target ||
    !isLeadEntityRef(target) ||
    identity.target_eligibility !== "full" ||
    identity.outcome === "ambiguous" ||
    identity.outcome === "conflict" ||
    !identity.match_method
  ) {
    return undefined;
  }
  return {
    lead_ref: target,
    confidence: identity.match_method === "source_scoped_contact" ? "medium" : "high",
    match_method: identity.match_method,
    reason_codes: identity.candidates.find(
      (candidate) =>
        candidate.target.model === target.model &&
        candidate.target.id === target.id,
    )?.reason_codes ?? [identity.reason_code],
  };
}

function isLeadEntityRef(target: EntityRef): target is EntityRef & { model: LeadModel } {
  return target.model === "FormLead" || target.model === "CallLead";
}

function discrepancyReason(reason: string): GranotDiscrepancyReasonCode {
  if (reason === "job_number_conflict") return "booked_job_number_conflict";
  if (reason === "source_scope_conflict") return "booked_source_scope_conflict";
  if (reason === "record_link_conflict") return "booked_record_link_conflict";
  return "booked_booking_lead_conflict";
}
