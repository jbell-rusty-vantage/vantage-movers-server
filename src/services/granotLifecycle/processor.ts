import mongoose, { type ClientSession } from "mongoose";
import {
  classifyExecutionMode,
  getGranotLifecycleFlags,
  type GranotLifecycleFlags,
} from "../../config/domain/granotLifecycle";
import { withTransaction as defaultWithTransaction } from "../../db";
import { logger } from "../../logger";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import { toObjectId } from "../../utils/objectId";
import { getGranotLifecycleActivationModel } from "../../models/GranotLifecycleActivation";
import { type GranotObservationDocument } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import {
  getGranotRecordLinkModel,
  type GranotRecordLinkDocument,
} from "../../models/GranotRecordLink";
import {
  getSynchronizationDecisionModel,
  type SynchronizationDecisionDocument,
  type SynchronizationDecisionEffect,
  type SynchronizationDecisionSourceScope,
} from "../../models/SynchronizationDecision";
import { normalizeJobNo } from "../bookings/bookingIdentity";
import type { DurableActor } from "../durableWork/types";
import {
  DomainRevisionConflictError,
} from "../domainCommands/types";
import { createGranotWebhookInitiator } from "../durableWork/actors";
import { DecisionIntegrityError, ProcessingDisabledError } from "./errors";
import {
  createLeadFromGranot,
  createLeadFromGranotIdempotencyKey,
  createLeadFromGranotPayloadChecksum,
  CreateLeadFromGranotRaceError,
  type CreateLeadFromGranotInput,
} from "./createLeadFromGranot";
import {
  assertAuthorizedLeadDesiredState,
  synchronizeLeadIdempotencyKey,
  synchronizeLeadPayloadChecksum,
  toAuthorizedLeadDesiredState,
} from "./authorizedDesiredState";
import {
  synchronizeLeadFromGranot,
  SynchronizeLeadRaceError,
} from "./synchronizeLeadFromGranot";
import type { SynchronizeLeadExecution } from "./synchronizeLeadTypes";
import {
  compareGranotTemporal,
  olderTemporalWinnerFilter,
  type GranotTemporalTuple,
} from "./granotTemporal";
import {
  resolveLeadIdentity,
  type LeadIdentityInput,
  type LeadIdentityResult,
  type LeadIdentityStore,
} from "./identity";
import {
  createGranotBookingReconciliation,
  type BookingReconciliationPersistenceStore,
  type CaseEffectResult,
  type PreparedBookingReconciliationDecision,
} from "./bookingReconciliation";
import {
  createGranotReleaseReconciliation,
  type PreparedReleaseReconciliationDecision,
  type ReleaseCaseEffectResult,
  type ReleaseReconciliationPersistenceStore,
} from "./releaseReconciliation";
import {
  createGranotDiscrepancies,
  type DiscrepancyEffectResult,
  type DiscrepancyPersistenceStore,
  type PreparedDiscrepancyDecision,
} from "./discrepancies";
import {
  planLeadDesiredState,
  type LeadDesiredStatePlan,
  type LeadDesiredStateProjection,
} from "./leadDesiredState";
import {
  incrementGranotLifecycleDecisionsTotal,
  recordGranotLifecycleCaptureToDecisionMs,
  recordGranotLifecycleDecisionToEffectMs,
} from "./metrics";
import { emitGranotLifecycleEvent } from "./observability";
import { upsertGranotObservation } from "./normalization";
import {
  createMongoSourcePolicyStore,
  evaluateEffectGates,
  resolveSourcePolicy,
  type EffectGateEvaluation,
  type EvaluatedGate,
  type RequestedLifecycleEffect,
  type SourcePolicyResolution,
  type SourcePolicySnapshot,
  type SourcePolicyStore,
} from "./sourcePolicy";
import type {
  EntityRef,
  ExecutionMode,
  GranotObservationProcessor,
  LeadModel,
  ObservationChannel,
  SynchronizationEffectSummary,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "./types";

export type { GranotObservationProcessor } from "./types";

type ProcessorReceipt = {
  _id: mongoose.Types.ObjectId;
  observation_channel: ObservationChannel;
  captured_at: Date;
  processing: { match_attempt: number };
  initiator?: DurableActor;
};

type PreparedDecision = {
  observation_id: mongoose.Types.ObjectId;
  attempt: number;
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationDecisionDocument["match_method"];
  target?: EntityRef;
  source_scope?: SynchronizationDecisionSourceScope;
  source_policy?: SynchronizationDecisionDocument["source_policy"];
  candidates: SynchronizationDecisionDocument["candidates"];
  evaluated_gates: EvaluatedGate[];
  effects: SynchronizationDecisionEffect[];
  next_match_attempt_at?: Date;
  decided_at: Date;
};

type LinkProposal = {
  normalized_job_no: string;
  job_no_snapshot: string;
  source_scope?: {
    lead_source_company: mongoose.Types.ObjectId;
    source_granularity_id: mongoose.Types.ObjectId;
  };
};

export type GranotLifecycleProcessorDeps = {
  now?: () => Date;
  flags?: GranotLifecycleFlags;
  sourcePolicyStore?: SourcePolicyStore;
  loadReceipt?: (receiptId: string) => Promise<ProcessorReceipt | null>;
  upsertObservation?: (receiptId: string) => Promise<GranotObservationDocument>;
  loadActivation?: () => Promise<{ activated_at: Date } | null>;
  findDecision?: (
    observationId: mongoose.Types.ObjectId,
    attempt: number,
  ) => Promise<SynchronizationDecisionDocument | null>;
  findActiveLink?: (
    normalizedJobNo: string,
    session?: ClientSession,
  ) => Promise<GranotRecordLinkDocument | null>;
  persistDecisionOnly?: (
    decision: SynchronizationDecisionDocument,
    receiptId: mongoose.Types.ObjectId,
    session?: ClientSession,
  ) => Promise<void>;
  persistDecisionAndLink?: (input: {
    decision: SynchronizationDecisionDocument;
    link?: GranotRecordLinkDocument;
    refresh?: {
      link_id: mongoose.Types.ObjectId;
      last_observation_id: mongoose.Types.ObjectId;
      last_observed_at: Date;
    };
    receiptId: mongoose.Types.ObjectId;
    session?: ClientSession;
  }) => Promise<void>;
  resolveIdentity?: (
    input: LeadIdentityInput,
    store?: LeadIdentityStore,
  ) => Promise<LeadIdentityResult>;
  identityStore?: LeadIdentityStore;
  loadLeadProjection?: (target: EntityRef) => Promise<LeadDesiredStateProjection | null>;
  advanceTemporalWinner?: (input: {
    target: EntityRef;
    incoming: GranotTemporalTuple;
    session?: ClientSession;
  }) => Promise<boolean>;
  createLead?: (
    input: CreateLeadFromGranotInput,
  ) => ReturnType<typeof createLeadFromGranot>;
  synchronizeLead?: typeof synchronizeLeadFromGranot;
  withTransaction?: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  bookingReconciliationStore?: BookingReconciliationPersistenceStore;
  reconcileBooking?: (
    ids: { observation_id: string; decision_id: string },
    prepared: PreparedBookingReconciliationDecision,
  ) => Promise<CaseEffectResult>;
  releaseReconciliationStore?: ReleaseReconciliationPersistenceStore;
  reconcileRelease?: (
    ids: { observation_id: string; decision_id: string },
    prepared: PreparedReleaseReconciliationDecision,
  ) => Promise<ReleaseCaseEffectResult>;
  discrepancyStore?: DiscrepancyPersistenceStore;
  reconcileDiscrepancy?: (
    input: {
      discrepancy_kind: "booking" | "release";
      reason_code: import("./types").GranotDiscrepancyReasonCode;
      observation_id: string;
      decision_id: string;
    },
    prepared: PreparedDiscrepancyDecision,
  ) => Promise<DiscrepancyEffectResult>;
};

export function createGranotObservationProcessor(
  deps: GranotLifecycleProcessorDeps = {},
): GranotObservationProcessor {
  return {
    async process(input) {
      return processGranotObservation(input, deps);
    },
  };
}

export async function processGranotObservation(
  input: { receipt_id: string; initiator?: DurableActor },
  deps: GranotLifecycleProcessorDeps = {},
): Promise<{
  observation_id: string;
  decision_id: string;
  outcome: SynchronizationOutcome;
  effects: SynchronizationEffectSummary[];
  target?: EntityRef;
}> {
  const flags = deps.flags ?? getGranotLifecycleFlags();
  if (!flags.processing_enabled) {
    throw new ProcessingDisabledError();
  }

  const started = Date.now();
  const now = deps.now ?? (() => new Date());
  const receipt = await (deps.loadReceipt ?? defaultLoadReceipt)(input.receipt_id);
  if (!receipt) {
    throw new Error("GranotObservationReceipt was not found");
  }

  const moduleContext = {
    initiator: input.initiator ?? receipt.initiator,
    processor_actor: granotLifecycleProcessorActor(String(receipt._id)),
  };

  const observation = await (deps.upsertObservation ?? defaultUpsertObservation)(
    String(receipt._id),
  );
  const attempt = receipt.processing.match_attempt + 1;
  const activation = await (deps.loadActivation ?? defaultLoadActivation)();
  const execution_mode = classifyExecutionMode({
    captured_at: new Date(receipt.captured_at),
    activated_at: activation?.activated_at ?? null,
    shadow_mode: flags.shadow_mode,
  });

  const existing = await (deps.findDecision ?? defaultFindDecision)(
    observation._id,
    attempt,
  );

  let prepared = await prepareDecision({
    observation,
    attempt,
    execution_mode,
    flags,
    decided_at: now(),
    sourcePolicyStore: deps.sourcePolicyStore,
    resolveIdentity: deps.resolveIdentity,
    identityStore: deps.identityStore,
    loadLeadProjection: deps.loadLeadProjection,
  });

  if (existing) {
    if (!decisionMeaningEquals(existing, prepared)) {
      throw new DecisionIntegrityError(String(observation._id), attempt);
    }
    return toProcessorResult(existing, receipt.observation_channel, started);
  }

  const releaseResult = await maybeReconcileRelease({
    prepared,
    observation,
    receipt,
    flags,
    execution_mode,
    deps,
    started,
    attempt,
    sourcePolicy: prepared.policy,
  });
  if (releaseResult) return releaseResult;

  const bookingResult = await maybeReconcileBooking({
    prepared,
    observation,
    receipt,
    flags,
    execution_mode,
    deps,
    started,
    attempt,
    sourcePolicy: prepared.policy,
  });
  if (bookingResult) return bookingResult;

  const creation = await maybeCreateLead({
    prepared,
    observation,
    receipt,
    flags,
    execution_mode,
    moduleContext,
    deps,
    now,
    started,
    attempt,
  });
  prepared = creation.prepared;
  if (creation.result) {
    return creation.result;
  }

  const synchronized = await maybeSynchronizeMatchedLead({
    prepared,
    observation,
    receipt,
    flags,
    execution_mode,
    moduleContext,
    deps,
    now,
    started,
    attempt,
  });
  if (synchronized) {
    return synchronized;
  }

  const decisionId = new mongoose.Types.ObjectId();
  const linkProposal = prepared.link;
  const runTransaction = deps.withTransaction ?? defaultWithTransaction;
  const cas = temporalCasClaim(
    prepared,
    flags,
    execution_mode,
    observation.captured_at,
  );

  const persisted = await runTransaction(async (session) => {
    if (cas) {
      const won = await (deps.advanceTemporalWinner ?? defaultAdvanceTemporalWinner)({
        target: cas.target,
        incoming: cas.incoming,
        session,
      });
      if (!won) {
        return null;
      }
    }
    if (!linkProposal) {
      const decision = toDecisionDocument(decisionId, prepared.decision);
      await (deps.persistDecisionOnly ?? defaultPersistDecisionOnly)(
        decision,
        receipt._id,
        session,
      );
      return decision;
    }

    const existingLink = await (deps.findActiveLink ?? defaultFindActiveLink)(
      linkProposal.normalized_job_no,
      session,
    );
    if (existingLink) {
      return persistLinkFollowUp({
        existingLink,
        proposal: linkProposal,
        prepared: prepared.decision,
        decisionId,
        observation,
        receiptId: receipt._id,
        decidedAt: prepared.decision.decided_at,
        deps,
        session,
      });
    }

    const linkId = new mongoose.Types.ObjectId();
    const established = withLinkEffect(
      prepared.decision,
      "linked",
      "record_link_established",
      linkId,
    );
    try {
      await (deps.persistDecisionAndLink ?? defaultPersistDecisionAndLink)(
        {
          decision: toDecisionDocument(decisionId, established),
          link: {
            _id: linkId,
            provider: "granot",
            normalized_job_no: linkProposal.normalized_job_no,
            job_no_snapshot: linkProposal.job_no_snapshot,
            state: "active",
            source_scope: linkProposal.source_scope,
            disputed: false,
            established_by_decision_id: decisionId,
            established_at: prepared.decision.decided_at,
            last_observation_id: observation._id,
            last_observed_at: prepared.decision.decided_at,
            domain_revision: 0,
          },
          receiptId: receipt._id,
          session,
        },
      );
      return toDecisionDocument(decisionId, established);
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const raced = await (deps.findActiveLink ?? defaultFindActiveLink)(
        linkProposal.normalized_job_no,
        session,
      );
      if (!raced) {
        throw error;
      }
      return persistLinkFollowUp({
        existingLink: raced,
        proposal: linkProposal,
        prepared: prepared.decision,
        decisionId,
        observation,
        receiptId: receipt._id,
        decidedAt: prepared.decision.decided_at,
        deps,
        session,
      });
    }
  });

  if (!persisted) {
    const lead = cas
      ? await (deps.loadLeadProjection ?? defaultLoadLeadProjection)(cas.target)
      : null;
    prepared = await prepareDecision({
      observation,
      attempt,
      execution_mode,
      flags,
      decided_at: now(),
      sourcePolicyStore: deps.sourcePolicyStore,
      resolveIdentity: deps.resolveIdentity,
      identityStore: deps.identityStore,
      loadLeadProjection: deps.loadLeadProjection,
      leadOverride: lead,
    });
    const staleDecision = toDecisionDocument(new mongoose.Types.ObjectId(), prepared.decision);
    await runTransaction(async (session) => {
      await (deps.persistDecisionOnly ?? defaultPersistDecisionOnly)(
        staleDecision,
        receipt._id,
        session,
      );
    });
    logProcessingCompletion({
      receipt_id: String(receipt._id),
      observation_id: String(observation._id),
      decision_id: String(staleDecision._id),
      attempt,
      execution_mode,
      outcome: staleDecision.outcome,
      reason_code: staleDecision.reason_code,
      initiator_actor_id: moduleContext.initiator?.actor_id,
      processor_actor_id: moduleContext.processor_actor.actor_id,
      duration_ms: Date.now() - started,
    });
    return toProcessorResult(staleDecision, receipt.observation_channel, started);
  }

  logProcessingCompletion({
    receipt_id: String(receipt._id),
    observation_id: String(observation._id),
    decision_id: String(persisted._id),
    attempt,
    execution_mode,
    outcome: persisted.outcome,
    reason_code: persisted.reason_code,
    initiator_actor_id: moduleContext.initiator?.actor_id,
    processor_actor_id: moduleContext.processor_actor.actor_id,
    duration_ms: Date.now() - started,
  });
  return toProcessorResult(persisted, receipt.observation_channel, started);
}

async function maybeReconcileRelease(input: {
  prepared: Awaited<ReturnType<typeof prepareDecision>>;
  observation: GranotObservationDocument;
  receipt: ProcessorReceipt;
  flags: GranotLifecycleFlags;
  execution_mode: ExecutionMode;
  deps: GranotLifecycleProcessorDeps;
  started: number;
  attempt: number;
  sourcePolicy?: SourcePolicySnapshot;
}): Promise<ReturnType<typeof toProcessorResult> | undefined> {
  if (
    input.observation.booking_action?.normalized !== "release" ||
    !input.observation.identity?.normalized_job_no ||
    input.observation.normalization_result === "invalid" ||
    input.observation.normalization_result === "unsupported"
  ) {
    return undefined;
  }

  const gates = input.sourcePolicy
    ? snapshotEligibleGates(
        input.sourcePolicy,
        input.execution_mode,
        input.flags,
        "release_reconciliation",
      )
    : releaseGatesFromPrepared(input.prepared.decision.evaluated_gates, input.flags);
  if (!gates.allowed) return undefined;

  const decisionId = new mongoose.Types.ObjectId();
  const prepared: PreparedReleaseReconciliationDecision = {
    receipt_id: input.receipt._id,
    observation_id: input.observation._id,
    attempt: input.attempt,
    execution_mode: input.execution_mode,
    outcome: input.prepared.decision.outcome,
    reason_code: input.prepared.decision.reason_code,
    match_method: input.prepared.decision.match_method,
    source_scope: input.prepared.decision.source_scope,
    candidates: input.prepared.decision.candidates,
    evaluated_gates: gates.evaluated_gates,
    effects: [],
    decided_at: input.prepared.decision.decided_at,
  };
  const result = await (input.deps.reconcileRelease
    ? input.deps.reconcileRelease(
        {
          observation_id: String(input.observation._id),
          decision_id: String(decisionId),
        },
        prepared,
      )
    : createGranotReleaseReconciliation({
        prepared,
        store: input.deps.releaseReconciliationStore,
      }).reconcileObservation({
        observation_id: String(input.observation._id),
        decision_id: String(decisionId),
      }));
  if (result.kind === "none") return undefined;

  if (result.kind === "release_discrepancy_required") {
    return persistProcessorDiscrepancy({
      discrepancy_kind: "release",
      reason_code: result.reason_code,
      decision_id: decisionId,
      prepared,
      observation: input.observation,
      receipt: input.receipt,
      deps: input.deps,
      started: input.started,
    });
  }

  const opened = result.kind === "opened" || result.kind === "refreshed";
  const alreadyCurrent = result.kind === "already_current";
  const decision = toDecisionDocument(decisionId, {
    ...input.prepared.decision,
    evaluated_gates: gates.evaluated_gates,
    outcome: opened
      ? "linked"
      : alreadyCurrent
        ? "already_current"
        : input.prepared.decision.outcome,
    reason_code: opened || alreadyCurrent
      ? result.reason_code
      : input.prepared.decision.reason_code,
    target: opened
      ? result.case_ref
      : alreadyCurrent
        ? result.target
        : input.prepared.decision.target,
    effects: opened ? [{ kind: result.reason_code, ref: result.case_ref }] : [],
  });
  logProcessingCompletion({
    receipt_id: String(input.receipt._id),
    observation_id: String(input.observation._id),
    decision_id: String(decisionId),
    attempt: input.attempt,
    execution_mode: input.execution_mode,
    outcome: decision.outcome,
    reason_code: decision.reason_code,
    duration_ms: Date.now() - input.started,
  });
  return toProcessorResult(decision, input.receipt.observation_channel, input.started);
}

async function maybeReconcileBooking(input: {
  prepared: Awaited<ReturnType<typeof prepareDecision>>;
  observation: GranotObservationDocument;
  receipt: ProcessorReceipt;
  flags: GranotLifecycleFlags;
  execution_mode: ExecutionMode;
  deps: GranotLifecycleProcessorDeps;
  started: number;
  attempt: number;
  sourcePolicy?: SourcePolicySnapshot;
}): Promise<ReturnType<typeof toProcessorResult> | undefined> {
  const actualBooked = input.observation.booking_action?.normalized === "booked";
  const priorityFive =
    input.observation.priority?.valid === true &&
    input.observation.priority?.canonical === "5";
  if (
    (!actualBooked && !priorityFive) ||
    input.observation.booking_action?.normalized === "release" ||
    !input.observation.identity?.normalized_job_no ||
    input.observation.normalization_result === "invalid" ||
    input.observation.normalization_result === "unsupported"
  ) {
    return undefined;
  }

  const gates = input.sourcePolicy
    ? snapshotEligibleGates(
        input.sourcePolicy,
        input.execution_mode,
        input.flags,
        "booking_reconciliation",
      )
    : bookingGatesFromPrepared(input.prepared.decision.evaluated_gates, input.flags);
  if (!gates.allowed) return undefined;

  const decisionId = new mongoose.Types.ObjectId();
  const prepared: PreparedBookingReconciliationDecision = {
    receipt_id: input.receipt._id,
    observation_id: input.observation._id,
    attempt: input.attempt,
    execution_mode: input.execution_mode,
    outcome: input.prepared.decision.outcome,
    reason_code: input.prepared.decision.reason_code,
    match_method: input.prepared.decision.match_method,
    source_scope: input.prepared.decision.source_scope,
    source_policy: input.prepared.decision.source_policy,
    candidates: input.prepared.decision.candidates,
    evaluated_gates: gates.evaluated_gates,
    effects: [],
    decided_at: input.prepared.decision.decided_at,
  };
  const result = await (input.deps.reconcileBooking
    ? input.deps.reconcileBooking(
        {
          observation_id: String(input.observation._id),
          decision_id: String(decisionId),
        },
        prepared,
      )
    : createGranotBookingReconciliation({
        prepared,
        store: input.deps.bookingReconciliationStore,
      }).reconcileObservation({
        observation_id: String(input.observation._id),
        decision_id: String(decisionId),
      }));
  if (result.kind === "booking_discrepancy_required") {
    return persistProcessorDiscrepancy({
      discrepancy_kind: "booking",
      reason_code: result.reason_code,
      decision_id: decisionId,
      prepared,
      observation: input.observation,
      receipt: input.receipt,
      deps: input.deps,
      started: input.started,
    });
  }
  if (result.kind === "none" && result.reason !== "employee_reconciliation_missing") {
    return undefined;
  }

  const decision = toDecisionDocument(decisionId, {
    ...input.prepared.decision,
    evaluated_gates: gates.evaluated_gates,
    outcome: result.kind === "opened" || result.kind === "refreshed"
      ? "linked"
      : input.prepared.decision.outcome,
    reason_code: result.kind === "opened" || result.kind === "refreshed"
      ? result.reason_code
      : input.prepared.decision.reason_code,
    target: result.kind === "opened" || result.kind === "refreshed"
      ? result.case_ref
      : input.prepared.decision.target,
    effects: result.kind === "opened" || result.kind === "refreshed"
      ? [{ kind: result.reason_code, ref: result.case_ref }]
      : [],
  });
  logProcessingCompletion({
    receipt_id: String(input.receipt._id),
    observation_id: String(input.observation._id),
    decision_id: String(decisionId),
    attempt: input.attempt,
    execution_mode: input.execution_mode,
    outcome: decision.outcome,
    reason_code: decision.reason_code,
    duration_ms: Date.now() - input.started,
  });
  return toProcessorResult(decision, input.receipt.observation_channel, input.started);
}

async function persistProcessorDiscrepancy(input: {
  discrepancy_kind: "booking" | "release";
  reason_code: import("./types").GranotDiscrepancyReasonCode;
  decision_id: mongoose.Types.ObjectId;
  prepared: PreparedBookingReconciliationDecision | PreparedReleaseReconciliationDecision;
  observation: GranotObservationDocument;
  receipt: ProcessorReceipt;
  deps: GranotLifecycleProcessorDeps;
  started: number;
}): Promise<ReturnType<typeof toProcessorResult>> {
  const prepared: PreparedDiscrepancyDecision = {
    receipt_id: input.prepared.receipt_id,
    observation_id: input.prepared.observation_id,
    attempt: input.prepared.attempt,
    execution_mode: input.prepared.execution_mode,
    outcome: input.prepared.outcome,
    reason_code: input.prepared.reason_code,
    match_method: input.prepared.match_method,
    source_scope: input.prepared.source_scope,
    candidates: input.prepared.candidates,
    evaluated_gates: input.prepared.evaluated_gates,
    effects: input.prepared.effects,
    decided_at: input.prepared.decided_at,
  };
  const request = {
    discrepancy_kind: input.discrepancy_kind,
    reason_code: input.reason_code,
    observation_id: String(input.observation._id),
    decision_id: String(input.decision_id),
  };
  const result = input.deps.reconcileDiscrepancy
    ? await input.deps.reconcileDiscrepancy(request, prepared)
    : await createGranotDiscrepancies({
        prepared,
        store: input.deps.discrepancyStore,
      }).reconcileObservation(request);
  const decision = toDecisionDocument(input.decision_id, {
    ...input.prepared,
    outcome: "conflict",
    reason_code: result.reason_code,
    target: result.discrepancy_ref,
    effects: [{
      kind: result.kind === "opened" ? "discrepancy_opened" : "discrepancy_refreshed",
      ref: result.discrepancy_ref,
    }],
  });
  logProcessingCompletion({
    receipt_id: String(input.receipt._id),
    observation_id: String(input.observation._id),
    decision_id: String(input.decision_id),
    attempt: input.prepared.attempt,
    execution_mode: input.prepared.execution_mode,
    outcome: decision.outcome,
    reason_code: decision.reason_code,
    duration_ms: Date.now() - input.started,
  });
  return toProcessorResult(
    decision,
    input.receipt.observation_channel,
    input.started,
  );
}

function bookingGatesFromPrepared(
  evaluated: EvaluatedGate[],
  flags: GranotLifecycleFlags,
): EffectGateEvaluation {
  const evaluated_gates = evaluated.map((gate) => {
    if (gate.gate === "global_effect_flag") {
      return { ...gate, allowed: flags.booking_cases_enabled };
    }
    if (gate.gate === "policy_permits_effect") {
      return { ...gate, allowed: true };
    }
    return gate;
  });
  const allowed = evaluated_gates.length === 8 && evaluated_gates.every((gate) => gate.allowed);
  return {
    evaluated_gates,
    allowed,
    outcome: allowed ? "already_current" : "policy_blocked",
    reason: allowed ? "desired_state_already_current" : "global_effect_disabled",
  };
}

function releaseGatesFromPrepared(
  evaluated: EvaluatedGate[],
  flags: GranotLifecycleFlags,
): EffectGateEvaluation {
  const evaluated_gates = evaluated.map((gate) => {
    if (gate.gate === "global_effect_flag") {
      return { ...gate, allowed: flags.release_cases_enabled };
    }
    if (gate.gate === "policy_permits_effect") {
      return { ...gate, allowed: true };
    }
    return gate;
  });
  const allowed = evaluated_gates.length === 8 && evaluated_gates.every((gate) => gate.allowed);
  return {
    evaluated_gates,
    allowed,
    outcome: allowed ? "already_current" : "policy_blocked",
    reason: allowed ? "desired_state_already_current" : "global_effect_disabled",
  };
}

async function maybeCreateLead(input: {
  prepared: {
    decision: PreparedDecision;
    link?: LinkProposal;
    job?: LinkProposal;
    plan?: LeadDesiredStatePlan;
    identity?: LeadIdentityResult;
  };
  observation: GranotObservationDocument;
  receipt: ProcessorReceipt;
  flags: GranotLifecycleFlags;
  execution_mode: ExecutionMode;
  moduleContext: { initiator?: DurableActor; processor_actor: DurableActor };
  deps: GranotLifecycleProcessorDeps;
  now: () => Date;
  started: number;
  attempt: number;
}): Promise<{
  prepared: {
    decision: PreparedDecision;
    link?: LinkProposal;
    job?: LinkProposal;
    plan?: LeadDesiredStatePlan;
    identity?: LeadIdentityResult;
  };
  result?: {
    observation_id: string;
    decision_id: string;
    outcome: SynchronizationOutcome;
    effects: SynchronizationEffectSummary[];
    target?: EntityRef;
  };
}> {
  let prepared = input.prepared;
  for (let commandAttempt = 0; commandAttempt < 3; commandAttempt++) {
    const model = prepared.plan?.creation_model;
    const sourceScope = prepared.decision.source_scope;
    const gatesAllowed = prepared.decision.evaluated_gates.every((gate) => gate.allowed);
    if (
      prepared.plan?.creation_eligibility !== "eligible" ||
      !model ||
      !sourceScope ||
      input.execution_mode !== "live" ||
      !input.flags.lead_creation_enabled ||
      !gatesAllowed
    ) {
      return { prepared };
    }
    const normalizedJob = input.observation.identity?.normalized_job_no;
    if (!normalizedJob) {
      return { prepared };
    }
    const receiptId = String(input.receipt._id);
    const initiator =
      input.moduleContext.initiator ??
      (input.receipt.observation_channel === "granot_webhook"
        ? createGranotWebhookInitiator(receiptId)
        : undefined);
    if (!initiator) {
      throw new Error("Granot lifecycle commands require a receipt initiator.");
    }
    const decisionId = new mongoose.Types.ObjectId();
    const commandInput: CreateLeadFromGranotInput = {
      observation_id: String(input.observation._id),
      lead_model: model,
      source_scope: {
        lead_source_company: String(sourceScope.lead_source_company),
        source_granularity_id: String(sourceScope.source_granularity_id),
      },
      context: {
        command_id: String(new mongoose.Types.ObjectId()),
        idempotency_key: createLeadFromGranotIdempotencyKey(
          String(input.observation._id),
        ),
        payload_checksum: createLeadFromGranotPayloadChecksum({
          observation: input.observation,
          source_scope: sourceScope,
          lead_model: model,
        }),
        actor: input.moduleContext.processor_actor,
        initiator,
        provenance: {
          origin: "granot_lifecycle",
          run_id: null,
          source_receipt_id: receiptId,
          source_connection_key: null,
          observation_id: String(input.observation._id),
          decision_id: String(decisionId),
          observation_channel: input.receipt.observation_channel,
        },
      },
    };
    try {
      const command = input.deps.createLead
        ? await input.deps.createLead(commandInput)
        : await createLeadFromGranot(commandInput, { flags: input.flags });
      const leadRef = command.entity_refs.find(
        (ref) => ref.model === "FormLead" || ref.model === "CallLead",
      ) as EntityRef | undefined;
      const persisted =
        (await (input.deps.findDecision ?? defaultFindDecision)(
          input.observation._id,
          input.attempt,
        )) ??
        toDecisionDocument(decisionId, {
          ...prepared.decision,
          outcome: "created",
          reason_code: "lead_created_authorized",
          target: leadRef,
          effects: [
            ...(leadRef ? [{ kind: "lead_created" as const, ref: leadRef }] : []),
            { kind: "record_link_established" as const },
            { kind: "sheet_sync_requested" as const },
          ],
        });
      logProcessingCompletion({
        receipt_id: receiptId,
        observation_id: String(input.observation._id),
        decision_id: String(persisted._id),
        attempt: input.attempt,
        execution_mode: input.execution_mode,
        outcome: persisted.outcome,
        reason_code: persisted.reason_code,
        initiator_actor_id: input.moduleContext.initiator?.actor_id,
        processor_actor_id: input.moduleContext.processor_actor.actor_id,
        duration_ms: Date.now() - input.started,
      });
      return {
        prepared,
        result: toProcessorResult(
          persisted,
          input.receipt.observation_channel,
          input.started,
        ),
      };
    } catch (error) {
      if (
        error instanceof CreateLeadFromGranotRaceError &&
        error.kind === "route_assignment"
      ) {
        const classified: PreparedDecision = {
          ...prepared.decision,
          outcome: "insufficient_creation_data",
          reason_code: "missing_creation_route_data",
          effects: [],
          target: undefined,
        };
        return {
          prepared: { ...prepared, decision: classified },
          result: await persistRaceReplan({
            prepared: classified,
            receipt: input.receipt,
            observation: input.observation,
            execution_mode: input.execution_mode,
            attempt: input.attempt,
            started: input.started,
            moduleContext: input.moduleContext,
            deps: input.deps,
          }),
        };
      }
      if (!isCreateLeadRace(error)) {
        throw error;
      }
      prepared = await prepareDecision({
        observation: input.observation,
        attempt: input.attempt,
        execution_mode: input.execution_mode,
        flags: input.flags,
        decided_at: input.now(),
        sourcePolicyStore: input.deps.sourcePolicyStore,
        resolveIdentity: input.deps.resolveIdentity,
        identityStore: input.deps.identityStore,
        loadLeadProjection: input.deps.loadLeadProjection,
      });
      if (
        error instanceof CreateLeadFromGranotRaceError &&
        error.kind === "link_duplicate" &&
        prepared.plan?.creation_eligibility === "eligible" &&
        prepared.plan.creation_model
      ) {
        const classified: PreparedDecision = {
          ...prepared.decision,
          outcome: "conflict",
          reason_code: "record_link_conflict",
          effects: [],
          target: undefined,
        };
        return {
          prepared: { ...prepared, decision: classified },
          result: await persistRaceReplan({
            prepared: classified,
            receipt: input.receipt,
            observation: input.observation,
            execution_mode: input.execution_mode,
            attempt: input.attempt,
            started: input.started,
            moduleContext: input.moduleContext,
            deps: input.deps,
          }),
        };
      }
    }
  }
  throw new Error("createLeadFromGranot exhausted identity/link race retries.");
}

function isCreateLeadRace(error: unknown): boolean {
  return error instanceof CreateLeadFromGranotRaceError;
}

async function maybeSynchronizeMatchedLead(input: {
  prepared: {
    decision: PreparedDecision;
    link?: LinkProposal;
    job?: LinkProposal;
    plan?: LeadDesiredStatePlan;
    identity?: LeadIdentityResult;
  };
  observation: GranotObservationDocument;
  receipt: ProcessorReceipt;
  flags: GranotLifecycleFlags;
  execution_mode: ExecutionMode;
  moduleContext: { initiator?: DurableActor; processor_actor: DurableActor };
  deps: GranotLifecycleProcessorDeps;
  now: () => Date;
  started: number;
  attempt: number;
}): Promise<{
  observation_id: string;
  decision_id: string;
  outcome: SynchronizationOutcome;
  effects: SynchronizationEffectSummary[];
  target?: EntityRef;
} | null> {
  const { observation, receipt, flags, execution_mode, deps } = input;
  const receiptId = String(receipt._id);

  let prepared = input.prepared;
  const maxCommandAttempts = 3;
  for (let commandAttempt = 0; commandAttempt < maxCommandAttempts; commandAttempt++) {
    const target = prepared.plan?.target ?? prepared.decision.target;
    const gatesAllowed = prepared.decision.evaluated_gates.every((gate) => gate.allowed);
    if (
      execution_mode !== "live" ||
      !flags.lead_writes_enabled ||
      !gatesAllowed ||
      !target ||
      !isLeadRef(target) ||
      !prepared.plan
    ) {
      if (commandAttempt === 0) {
        return null;
      }
      return persistRaceReplan({
        prepared: prepared.decision,
        receipt,
        observation,
        execution_mode,
        attempt: input.attempt,
        started: input.started,
        moduleContext: input.moduleContext,
        deps,
      });
    }

    const job = prepared.job ?? prepared.link;
    const existingLink = job
      ? await (deps.findActiveLink ?? defaultFindActiveLink)(job.normalized_job_no)
      : null;
    const associationNeeded = liveAssociationNeeded(existingLink, job, target);
    const mayApplyLead = prepared.plan.outcome === "applied";
    const mayAssociate =
      associationNeeded &&
      (prepared.plan.outcome === "applied" || prepared.plan.outcome === "already_current");
    if (!mayApplyLead && !mayAssociate) {
      if (commandAttempt === 0) {
        return null;
      }
      return persistRaceReplan({
        prepared: prepared.decision,
        receipt,
        observation,
        execution_mode,
        attempt: input.attempt,
        started: input.started,
        moduleContext: input.moduleContext,
        deps,
      });
    }

    const initiator =
      input.moduleContext.initiator ??
      (receipt.observation_channel === "granot_webhook"
        ? createGranotWebhookInitiator(receiptId)
        : undefined);
    if (!initiator) {
      throw new Error("Granot lifecycle commands require a receipt initiator.");
    }

    const desired = toAuthorizedLeadDesiredState({
      plan: prepared.plan,
      lead_model: target.model,
      temporal_winner: {
        observation_id: String(observation._id),
        captured_at: observation.captured_at,
      },
    });
    assertAuthorizedLeadDesiredState(desired, target.model);
    const expectedRevision = Number(
      (await (deps.loadLeadProjection ?? defaultLoadLeadProjection)(target))?.domain_revision ?? 0,
    );
    const decisionId = new mongoose.Types.ObjectId();
    const execution: SynchronizeLeadExecution = {
      observation,
      identity: prepared.identity ?? {
        outcome: prepared.decision.outcome,
        reason_code: prepared.decision.reason_code,
        match_method: prepared.decision.match_method,
        target,
        candidates: prepared.decision.candidates,
      },
      receipt_id: receipt._id,
      attempt: input.attempt,
      execution_mode,
      flags,
      evaluated_gates: prepared.decision.evaluated_gates,
      match_method: prepared.decision.match_method,
      candidates: prepared.decision.candidates,
      source_scope: prepared.decision.source_scope,
      job,
      decided_at: prepared.decision.decided_at,
      target,
      findActiveLink: deps.findActiveLink,
    };

    try {
      await (deps.synchronizeLead ?? synchronizeLeadFromGranot)({
        lead_ref: { model: target.model, id: target.id },
        expected_domain_revision: expectedRevision,
        desired_state: desired,
        context: {
          command_id: String(new mongoose.Types.ObjectId()),
          idempotency_key: synchronizeLeadIdempotencyKey(String(observation._id)),
          payload_checksum: synchronizeLeadPayloadChecksum({
            lead_ref: { model: target.model, id: target.id },
            expected_domain_revision: expectedRevision,
            desired_state: desired,
          }),
          actor: input.moduleContext.processor_actor,
          initiator,
          provenance: {
            origin: "granot_lifecycle",
            run_id: null,
            source_receipt_id: receiptId,
            source_connection_key: null,
            observation_id: String(observation._id),
            decision_id: String(decisionId),
            observation_channel: receipt.observation_channel,
          },
        },
        execution,
      });
    } catch (error) {
      if (!isSynchronizeRace(error)) {
        throw error;
      }
      const lead = await (deps.loadLeadProjection ?? defaultLoadLeadProjection)(target);
      prepared = await prepareDecision({
        observation,
        attempt: input.attempt,
        execution_mode,
        flags,
        decided_at: input.now(),
        sourcePolicyStore: deps.sourcePolicyStore,
        resolveIdentity: deps.resolveIdentity,
        identityStore: deps.identityStore,
        loadLeadProjection: deps.loadLeadProjection,
        leadOverride: lead,
      });
      continue;
    }

    const persisted =
      (await (deps.findDecision ?? defaultFindDecision)(observation._id, input.attempt)) ??
      toDecisionDocument(decisionId, {
        ...prepared.decision,
        outcome: prepared.plan.outcome === "applied" ? "applied" : "linked",
        reason_code:
          prepared.plan.outcome === "applied" ? "lead_state_changed" : "record_link_established",
      });
    logProcessingCompletion({
      receipt_id: receiptId,
      observation_id: String(observation._id),
      decision_id: String(persisted._id),
      attempt: input.attempt,
      execution_mode,
      outcome: persisted.outcome,
      reason_code: persisted.reason_code,
      initiator_actor_id: input.moduleContext.initiator?.actor_id,
      processor_actor_id: input.moduleContext.processor_actor.actor_id,
      duration_ms: Date.now() - input.started,
    });
    return toProcessorResult(persisted, receipt.observation_channel, input.started);
  }

  throw new Error("synchronizeLeadFromGranot exhausted revision/link race retries.");
}

async function persistRaceReplan(input: {
  prepared: PreparedDecision;
  receipt: ProcessorReceipt;
  observation: GranotObservationDocument;
  execution_mode: ExecutionMode;
  attempt: number;
  started: number;
  moduleContext: { initiator?: DurableActor; processor_actor: DurableActor };
  deps: GranotLifecycleProcessorDeps;
}): Promise<{
  observation_id: string;
  decision_id: string;
  outcome: SynchronizationOutcome;
  effects: SynchronizationEffectSummary[];
  target?: EntityRef;
}> {
  if (input.prepared.outcome === "applied" || input.prepared.outcome === "linked") {
    throw new Error("Race replan still requires synchronizeLeadFromGranot.");
  }
  const decision = toDecisionDocument(new mongoose.Types.ObjectId(), input.prepared);
  const runTransaction = input.deps.withTransaction ?? defaultWithTransaction;
  await runTransaction(async (session) => {
    await (input.deps.persistDecisionOnly ?? defaultPersistDecisionOnly)(
      decision,
      input.receipt._id,
      session,
    );
  });
  logProcessingCompletion({
    receipt_id: String(input.receipt._id),
    observation_id: String(input.observation._id),
    decision_id: String(decision._id),
    attempt: input.attempt,
    execution_mode: input.execution_mode,
    outcome: decision.outcome,
    reason_code: decision.reason_code,
    initiator_actor_id: input.moduleContext.initiator?.actor_id,
    processor_actor_id: input.moduleContext.processor_actor.actor_id,
    duration_ms: Date.now() - input.started,
  });
  return toProcessorResult(decision, input.receipt.observation_channel, input.started);
}

function liveAssociationNeeded(
  existing: GranotRecordLinkDocument | null,
  job: LinkProposal | undefined,
  target: EntityRef & { model: "FormLead" | "CallLead" },
): boolean {
  if (!job) return false;
  if (!existing) return true;
  if (!existing.lead_ref) return true;
  return String(existing.lead_ref.id) !== target.id;
}

function isSynchronizeRace(error: unknown): boolean {
  if (error instanceof DomainRevisionConflictError || error instanceof SynchronizeLeadRaceError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : undefined;
  return (
    code === 11000 ||
    code === "DOMAIN_REVISION_CONFLICT" ||
    message === "DOMAIN_REVISION_CONFLICT"
  );
}

async function persistLinkFollowUp(input: {
  existingLink: GranotRecordLinkDocument;
  proposal: LinkProposal;
  prepared: PreparedDecision;
  decisionId: mongoose.Types.ObjectId;
  observation: GranotObservationDocument;
  receiptId: mongoose.Types.ObjectId;
  decidedAt: Date;
  deps: GranotLifecycleProcessorDeps;
  session?: ClientSession;
}): Promise<SynchronizationDecisionDocument> {
  if (recordLinkCompatible(input.existingLink, input.proposal)) {
    const confirmed = withLinkEffect(
      input.prepared,
      "linked",
      "record_link_confirmed",
      input.existingLink._id,
    );
    await (input.deps.persistDecisionAndLink ?? defaultPersistDecisionAndLink)({
      decision: toDecisionDocument(input.decisionId, confirmed),
      refresh: {
        link_id: input.existingLink._id,
        last_observation_id: input.observation._id,
        last_observed_at: input.decidedAt,
      },
      receiptId: input.receiptId,
      session: input.session,
    });
    return toDecisionDocument(input.decisionId, confirmed);
  }

  const conflicted: PreparedDecision = {
    ...input.prepared,
    outcome: "conflict",
    reason_code: "record_link_conflict",
    effects: [],
    match_method: undefined,
    target: undefined,
  };
  await (input.deps.persistDecisionAndLink ?? defaultPersistDecisionAndLink)({
    decision: toDecisionDocument(input.decisionId, conflicted),
    receiptId: input.receiptId,
    session: input.session,
  });
  return toDecisionDocument(input.decisionId, conflicted);
}

async function prepareDecision(input: {
  observation: GranotObservationDocument;
  attempt: number;
  execution_mode: ExecutionMode;
  flags: GranotLifecycleFlags;
  decided_at: Date;
  sourcePolicyStore?: SourcePolicyStore;
  resolveIdentity?: GranotLifecycleProcessorDeps["resolveIdentity"];
  identityStore?: LeadIdentityStore;
  loadLeadProjection?: GranotLifecycleProcessorDeps["loadLeadProjection"];
  leadOverride?: LeadDesiredStateProjection | null;
}): Promise<{
  decision: PreparedDecision;
  link?: LinkProposal;
  job?: LinkProposal;
  plan?: LeadDesiredStatePlan;
  identity?: LeadIdentityResult;
  policy?: SourcePolicySnapshot;
}> {
  const base: PreparedDecision = {
    observation_id: input.observation._id,
    attempt: input.attempt,
    execution_mode: input.execution_mode,
    outcome: "policy_blocked",
    reason_code: "historical_shadow",
    candidates: [],
    evaluated_gates: [],
    effects: [],
    decided_at: input.decided_at,
  };

  const terminal = mapTerminalNormalization(input.observation);
  if (terminal) {
    return { decision: { ...base, ...terminal } };
  }

  const policy = await resolveSourcePolicy(
    {
      source_label:
        input.observation.normalized_source_label ??
        input.observation.source_label_raw ??
        "",
      origin_state: input.observation.move?.origin?.state,
      destination_state: input.observation.move?.destination?.state,
      provider_type: input.observation.provider_context?.type_raw,
    },
    input.sourcePolicyStore ?? createMongoSourcePolicyStore(),
  );

  const policySnapshot = policy.snapshot ?? emptyPolicySnapshot();
  const identity = await (input.resolveIdentity ?? resolveLeadIdentity)(
    {
      observation: toIdentityObservation(input.observation),
      policy: policySnapshot,
      policy_failure: policy.ok
        ? undefined
        : { outcome: policy.outcome, reason: policy.reason },
    },
    input.identityStore,
  );

  if (!policy.ok) {
    return {
      decision: {
        ...base,
        outcome: policy.outcome,
        reason_code: policy.reason,
        match_method: identity.match_method,
        target: identity.target,
        candidates: identity.candidates,
        source_scope: decisionSourceScope(policy.snapshot),
        source_policy: decisionSourcePolicy(policy.snapshot),
        evaluated_gates: policy.snapshot
          ? snapshotEligibleGates(policy.snapshot, input.execution_mode, input.flags, "lead_link")
              .evaluated_gates
          : [],
      },
    };
  }

  const lead =
    input.leadOverride !== undefined
      ? input.leadOverride
      : identity.target && isLeadRef(identity.target)
        ? await (input.loadLeadProjection ?? defaultLoadLeadProjection)(identity.target)
        : null;
  const temporal_order = compareGranotTemporal(
    {
      captured_at: input.observation.captured_at,
      observation_id: String(input.observation._id),
    },
    lead?.last_accepted_granot_observation,
  );
  const plan = planLeadDesiredState({
    observation: input.observation,
    identity,
    lead,
    policy: policy.snapshot,
    temporal_order,
    now: input.decided_at,
    attempt: input.attempt,
  });
  const requested = requestedEffect(plan);
  const gates = snapshotEligibleGates(
    policy.snapshot,
    input.execution_mode,
    input.flags,
    requested,
  );
  const source_scope = decisionSourceScope(policy.snapshot);
  const source_policy = decisionSourcePolicy(policy.snapshot);
  const job = jobProposal(input.observation, policy);
  const decided = decidePreparedOutcome({
    plan,
    identity,
    execution_mode: input.execution_mode,
    flags: input.flags,
    gates,
    job,
  });

  return {
    decision: {
      ...base,
      outcome: decided.outcome,
      reason_code: decided.reason_code,
      match_method: decided.match_method,
      target: decided.target,
      source_scope,
      source_policy,
      candidates: identity.candidates,
      evaluated_gates: gates.evaluated_gates,
      next_match_attempt_at: plan.next_match_attempt_at,
    },
    link: decided.link,
    job,
    plan,
    identity,
    policy: policy.snapshot,
  };
}

function mapTerminalNormalization(
  observation: GranotObservationDocument,
): Pick<PreparedDecision, "outcome" | "reason_code"> | null {
  if (observation.normalization_result === "unsupported") {
    return { outcome: "unsupported", reason_code: "unsupported_booking_action" };
  }
  if (observation.normalization_result !== "invalid") {
    return null;
  }
  const invalidPriority = observation.issues.some(
    (issue) => issue.code === "invalid_priority",
  );
  if (observation.route_event_class === "priority_updated" && invalidPriority) {
    return { outcome: "invalid", reason_code: "invalid_priority_update" };
  }
  return { outcome: "invalid", reason_code: "invalid_payload" };
}

function snapshotEligibleGates(
  snapshot: SourcePolicySnapshot,
  mode: ExecutionMode,
  flags: GranotLifecycleFlags,
  requested_effect: RequestedLifecycleEffect,
): EffectGateEvaluation {
  const globalFlag =
    requested_effect === "lead_created"
      ? flags.lead_creation_enabled
      : requested_effect === "lead_enrichment" || requested_effect === "lead_link"
        ? flags.lead_writes_enabled
        : requested_effect === "booking_reconciliation"
          ? flags.booking_cases_enabled &&
            (snapshot.lifecycle_disposition !== "referral_booking" || flags.referral_booking_enabled)
          : requested_effect === "release_reconciliation"
            ? flags.release_cases_enabled
            : false;
  return evaluateEffectGates({
    global_effect_flag: globalFlag,
    receipt_post_activation: mode !== "historical_shadow",
    processor_mode: mode,
    operational_enabled: snapshot.operational_enabled === true,
    lifecycle_enabled: snapshot.lifecycle_enabled === true,
    disposition: snapshot.lifecycle_disposition,
    source_company_active: snapshot.source_company_active === true,
    source_granularity_active: snapshot.source_granularity_active === true,
    lead_created_policy: snapshot.lead_created_policy,
    requested_effect,
  });
}

function requestedEffect(plan: LeadDesiredStatePlan): RequestedLifecycleEffect {
  if (plan.creation_eligibility === "eligible") {
    return "lead_created";
  }
  if (plan.outcome === "applied" || plan.changed_paths.length > 0) {
    return "lead_enrichment";
  }
  return "lead_link";
}

function decidePreparedOutcome(input: {
  plan: LeadDesiredStatePlan;
  identity: LeadIdentityResult;
  execution_mode: ExecutionMode;
  flags: GranotLifecycleFlags;
  gates: EffectGateEvaluation;
  job?: LinkProposal;
}): {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationDecisionDocument["match_method"];
  target?: EntityRef;
  link?: LinkProposal;
} {
  if (
    input.execution_mode === "historical_shadow" &&
    input.job &&
    allowsHistoricalJobLink(input.plan)
  ) {
    return {
      outcome: "linked",
      reason_code: "record_link_established",
      match_method: "granot_record_link",
      link: input.job,
    };
  }

  if (isClassificationOutcome(input.plan.outcome)) {
    return {
      outcome: input.plan.outcome,
      reason_code: input.plan.reason_code,
      match_method: input.identity.match_method,
      target: input.plan.target ?? input.identity.target,
    };
  }

  if (input.execution_mode === "live") {
    if (!input.gates.allowed) {
      return {
        outcome: input.gates.outcome,
        reason_code: input.gates.reason,
        match_method: input.identity.match_method,
        target: input.plan.target ?? input.identity.target,
      };
    }
    return {
      outcome: input.plan.outcome,
      reason_code: input.plan.reason_code,
      match_method: input.identity.match_method,
      target: input.plan.target ?? input.identity.target,
    };
  }

  const suppressed = nonEffectingOutcome(input.execution_mode);
  return {
    outcome: suppressed.outcome,
    reason_code: suppressed.reason,
    match_method: input.identity.match_method,
    target: input.plan.target ?? input.identity.target,
  };
}

function allowsHistoricalJobLink(plan: LeadDesiredStatePlan): boolean {
  if (
    plan.outcome === "invalid" ||
    plan.outcome === "unsupported" ||
    plan.outcome === "conflict" ||
    plan.outcome === "ambiguous" ||
    plan.outcome === "deferred"
  ) {
    return false;
  }
  if (
    plan.outcome === "policy_blocked" &&
    (plan.reason_code === "source_unclassified" ||
      plan.reason_code === "source_disabled" ||
      plan.reason_code === "target_source_company_inactive" ||
      plan.reason_code === "target_source_granularity_inactive")
  ) {
    return false;
  }
  return true;
}

function isClassificationOutcome(outcome: SynchronizationOutcome): boolean {
  return (
    outcome === "stale" ||
    outcome === "already_current" ||
    outcome === "pending_match" ||
    outcome === "unmatched" ||
    outcome === "insufficient_creation_data" ||
    outcome === "invalid" ||
    outcome === "unsupported" ||
    outcome === "ambiguous" ||
    outcome === "conflict" ||
    outcome === "deferred" ||
    outcome === "policy_blocked"
  );
}

function temporalCasClaim(
  prepared: { decision: PreparedDecision; plan?: LeadDesiredStatePlan },
  flags: GranotLifecycleFlags,
  mode: ExecutionMode,
  capturedAt: Date,
): { target: EntityRef; incoming: GranotTemporalTuple } | undefined {
  const plan = prepared.plan;
  const target = plan?.target;
  if (
    mode !== "live" ||
    !flags.lead_writes_enabled ||
    plan?.outcome !== "already_current" ||
    plan.temporal_winner_should_advance !== true ||
    !target ||
    !isLeadRef(target)
  ) {
    return undefined;
  }
  return {
    target,
    incoming: {
      captured_at: capturedAt,
      observation_id: String(prepared.decision.observation_id),
    },
  };
}

function nonEffectingOutcome(
  mode: ExecutionMode,
): { outcome: SynchronizationOutcome; reason: SynchronizationReasonCode } {
  if (mode === "historical_shadow") {
    return { outcome: "policy_blocked", reason: "historical_shadow" };
  }
  if (mode === "live_shadow") {
    return { outcome: "policy_blocked", reason: "shadow_effect_suppressed" };
  }
  return { outcome: "policy_blocked", reason: "global_effect_disabled" };
}

function decisionSourceScope(
  snapshot?: SourcePolicySnapshot,
): SynchronizationDecisionSourceScope | undefined {
  if (
    !snapshot?.granot_crm_source_id ||
    !snapshot.lead_source_company_id ||
    !snapshot.source_granularity_id ||
    !snapshot.lifecycle_policy_version
  ) {
    return undefined;
  }
  return {
    granot_crm_source_id: toObjectId(snapshot.granot_crm_source_id),
    lead_source_company: toObjectId(snapshot.lead_source_company_id),
    source_granularity_id: toObjectId(snapshot.source_granularity_id),
    disposition: snapshot.lifecycle_disposition,
    policy_version: snapshot.lifecycle_policy_version,
  };
}

function decisionSourcePolicy(
  snapshot?: SourcePolicySnapshot,
): SynchronizationDecisionDocument["source_policy"] | undefined {
  if (
    !snapshot?.granot_crm_source_id ||
    !snapshot.lifecycle_policy_version
  ) {
    return undefined;
  }
  return {
    granot_crm_source_id: toObjectId(snapshot.granot_crm_source_id),
    disposition: snapshot.lifecycle_disposition,
    policy_version: snapshot.lifecycle_policy_version,
  };
}

function jobProposal(
  observation: GranotObservationDocument,
  policy: SourcePolicyResolution,
): LinkProposal | undefined {
  if (!policy.ok) {
    return undefined;
  }
  const normalized = observation.identity?.normalized_job_no;
  if (!normalized) {
    return undefined;
  }
  const snapshot = observation.identity.job_no_raw ?? normalized;
  if (normalizeJobNo(snapshot) !== normalized) {
    return undefined;
  }
  const source_scope =
    policy.snapshot.lead_source_company_id && policy.snapshot.source_granularity_id
      ? {
          lead_source_company: toObjectId(policy.snapshot.lead_source_company_id),
          source_granularity_id: toObjectId(policy.snapshot.source_granularity_id),
        }
      : undefined;
  return {
    normalized_job_no: normalized,
    job_no_snapshot: snapshot,
    source_scope,
  };
}

function recordLinkCompatible(
  existing: GranotRecordLinkDocument,
  proposal: LinkProposal,
): boolean {
  if (existing.normalized_job_no !== proposal.normalized_job_no) {
    return false;
  }
  const existingScope = existing.source_scope
    ? {
        company: String(existing.source_scope.lead_source_company),
        granularity: String(existing.source_scope.source_granularity_id),
      }
    : null;
  const proposedScope = proposal.source_scope
    ? {
        company: String(proposal.source_scope.lead_source_company),
        granularity: String(proposal.source_scope.source_granularity_id),
      }
    : null;
  return JSON.stringify(existingScope) === JSON.stringify(proposedScope);
}

function withLinkEffect(
  decision: PreparedDecision,
  outcome: SynchronizationOutcome,
  reason: SynchronizationReasonCode,
  linkId: mongoose.Types.ObjectId,
): PreparedDecision {
  const ref: EntityRef = { model: "GranotRecordLink", id: String(linkId) };
  return {
    ...decision,
    outcome,
    reason_code: reason,
    match_method: "granot_record_link",
    target: ref,
    effects: [{ kind: reason === "record_link_confirmed" ? "record_link_confirmed" : "record_link_established", ref }],
  };
}

function toDecisionDocument(
  id: mongoose.Types.ObjectId,
  prepared: PreparedDecision,
): SynchronizationDecisionDocument {
  return {
    _id: id,
    observation_id: prepared.observation_id,
    attempt: prepared.attempt,
    execution_mode: prepared.execution_mode,
    outcome: prepared.outcome,
    reason_code: prepared.reason_code,
    match_method: prepared.match_method,
    target: prepared.target,
    source_scope: prepared.source_scope,
    source_policy: prepared.source_policy,
    candidates: prepared.candidates,
    evaluated_gates: prepared.evaluated_gates,
    effects: prepared.effects,
    next_match_attempt_at: prepared.next_match_attempt_at,
    decided_at: prepared.decided_at,
  };
}

function decisionMeaningEquals(
  existing: SynchronizationDecisionDocument,
  prepared: { decision: PreparedDecision; link?: LinkProposal },
): boolean {
  const next = prepared.decision;
  if (
    String(existing.observation_id) !== String(next.observation_id) ||
    existing.attempt !== next.attempt ||
    existing.execution_mode !== next.execution_mode
  ) {
    return false;
  }
  if (prepared.link) {
    const established = existing.reason_code === "record_link_established";
    const confirmed = existing.reason_code === "record_link_confirmed";
    const conflicted = existing.reason_code === "record_link_conflict";
    return (
      (established || confirmed || conflicted) &&
      (existing.outcome === "linked" || existing.outcome === "conflict")
    );
  }
  if (
    existing.outcome === next.outcome &&
    existing.reason_code === next.reason_code
  ) {
    return true;
  }
  // After a committed live mutation the same Observation+attempt re-plans as
  // already_current (or stale if a later winner landed). The stored Decision
  // remains the causal replay result.
  return (
    existing.execution_mode === "live" &&
    (existing.outcome === "created" ||
      existing.outcome === "applied" ||
      existing.outcome === "linked") &&
    (existing.reason_code === "lead_created_authorized" ||
      existing.reason_code === "lead_state_changed" ||
      existing.reason_code === "record_link_established" ||
      existing.reason_code === "record_link_confirmed") &&
    (next.outcome === "already_current" || next.outcome === "stale")
  );
}

function toProcessorResult(
  decision: SynchronizationDecisionDocument,
  channel: ObservationChannel,
  started: number,
): {
  observation_id: string;
  decision_id: string;
  outcome: SynchronizationOutcome;
  effects: SynchronizationEffectSummary[];
  target?: EntityRef;
} {
  incrementGranotLifecycleDecisionsTotal({
    outcome: decision.outcome,
    reason_code: decision.reason_code,
    channel,
  });
  recordGranotLifecycleCaptureToDecisionMs(Date.now() - started);
  if (decision.effects.length > 0) {
    recordGranotLifecycleDecisionToEffectMs(
      Math.max(0, Date.now() - new Date(decision.decided_at).getTime()),
    );
  }
  return {
    observation_id: String(decision.observation_id),
    decision_id: String(decision._id),
    outcome: decision.outcome,
    effects: decision.effects.map((effect) => ({
      kind: effect.kind,
      ref: effect.ref,
      changed_paths: effect.changed_paths,
    })),
    target: decision.target,
  };
}

function logProcessingCompletion(input: {
  receipt_id: string;
  observation_id: string;
  decision_id: string;
  attempt: number;
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  initiator_actor_id?: string;
  processor_actor_id?: string;
  duration_ms: number;
}): void {
  logger.info({
    msg: "granot_lifecycle.processing.completed",
    receipt_id: input.receipt_id,
    observation_id: input.observation_id,
    decision_id: input.decision_id,
    attempt: input.attempt,
    execution_mode: input.execution_mode,
    outcome: input.outcome,
    reason_code: input.reason_code,
    duration_ms: input.duration_ms,
  });
  void emitGranotLifecycleEvent({
    eventKey: "granot_lifecycle.processing.completed",
    category: "mongo",
    summary: "Granot lifecycle receipt processing completed.",
    details: {
      receipt_id: input.receipt_id,
      observation_id: input.observation_id,
      decision_id: input.decision_id,
      attempt: input.attempt,
      execution_mode: input.execution_mode,
      outcome: input.outcome,
      reason_code: input.reason_code,
      duration_ms: input.duration_ms,
    },
    durationMs: input.duration_ms,
    piiPolicy: "masked",
  });
}

function granotLifecycleProcessorActor(receiptId: string): DurableActor {
  return {
    actor_type: "system",
    actor_id: "granot-lifecycle-processor",
    actor_label: "Granot Lifecycle Processor",
    actor_role: "system",
    origin: "granot_lifecycle",
    request_id: receiptId,
  };
}

function toIdentityObservation(
  observation: GranotObservationDocument,
): LeadIdentityInput["observation"] {
  return {
    identity: {
      normalized_job_no: observation.identity?.normalized_job_no,
      normalized_form_ref: observation.identity?.normalized_form_ref,
    },
    contact: {
      normalized_phone: observation.contact?.normalized_phone,
      normalized_email: observation.contact?.normalized_email,
    },
    agent_identity: {
      user_raw: observation.agent_identity?.user_raw,
      rep_raw: observation.agent_identity?.rep_raw,
    },
    provider_context: observation.provider_context,
  };
}

function emptyPolicySnapshot(): SourcePolicySnapshot {
  return {
    granot_crm_source_id: "",
    lifecycle_disposition: "deferred",
    lead_created_policy: "observation_only",
    operational_enabled: false,
    lifecycle_enabled: false,
    source_company_active: false,
    source_granularity_active: false,
  };
}

function isLeadRef(target: EntityRef): target is EntityRef & { model: LeadModel } {
  return target.model === "FormLead" || target.model === "CallLead";
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 11000,
  );
}

async function defaultLoadReceipt(receiptId: string): Promise<ProcessorReceipt | null> {
  const row = await getGranotObservationReceiptModel().findById(receiptId).lean();
  if (!row) {
    return null;
  }
  return {
    _id: row._id,
    observation_channel: row.observation_channel,
    captured_at: new Date(row.captured_at),
    processing: { match_attempt: row.processing.match_attempt },
    initiator: row.initiator,
  };
}

async function defaultUpsertObservation(
  receiptId: string,
): Promise<GranotObservationDocument> {
  const result = await upsertGranotObservation({ receipt_id: receiptId });
  return result.observation as GranotObservationDocument;
}

async function defaultLoadActivation(): Promise<{ activated_at: Date } | null> {
  const row = await getGranotLifecycleActivationModel()
    .findOne({ key: "granot_lifecycle" })
    .lean();
  return row ? { activated_at: new Date(row.activated_at) } : null;
}

async function defaultFindDecision(
  observationId: mongoose.Types.ObjectId,
  attempt: number,
): Promise<SynchronizationDecisionDocument | null> {
  return getSynchronizationDecisionModel()
    .findOne({ observation_id: observationId, attempt })
    .lean();
}

async function defaultFindActiveLink(
  normalizedJobNo: string,
  session?: ClientSession,
): Promise<GranotRecordLinkDocument | null> {
  return getGranotRecordLinkModel()
    .findOne({ provider: "granot", normalized_job_no: normalizedJobNo, state: "active" })
    .session(session ?? null)
    .lean();
}

async function defaultPersistDecisionOnly(
  decision: SynchronizationDecisionDocument,
  receiptId: mongoose.Types.ObjectId,
  session?: ClientSession,
): Promise<void> {
  await getSynchronizationDecisionModel().create([decision], { session });
  await getGranotObservationReceiptModel().collection.updateOne(
    { _id: receiptId },
    { $set: { "processing.latest_decision_id": decision._id } },
    session ? { session } : {},
  );
}

async function defaultPersistDecisionAndLink(input: {
  decision: SynchronizationDecisionDocument;
  link?: GranotRecordLinkDocument;
  refresh?: {
    link_id: mongoose.Types.ObjectId;
    last_observation_id: mongoose.Types.ObjectId;
    last_observed_at: Date;
  };
  receiptId: mongoose.Types.ObjectId;
  session?: ClientSession;
}): Promise<void> {
  await getSynchronizationDecisionModel().create([input.decision], {
    session: input.session,
  });
  if (input.link) {
    await getGranotRecordLinkModel().create([input.link], { session: input.session });
  }
  if (input.refresh) {
    await getGranotRecordLinkModel().updateOne(
      { _id: input.refresh.link_id, state: "active" },
      {
        $set: {
          last_observation_id: input.refresh.last_observation_id,
          last_observed_at: input.refresh.last_observed_at,
        },
        $inc: { domain_revision: 1 },
      },
      { session: input.session },
    );
  }
  await getGranotObservationReceiptModel().collection.updateOne(
    { _id: input.receiptId },
    { $set: { "processing.latest_decision_id": input.decision._id } },
    input.session ? { session: input.session } : {},
  );
}

function absent<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

async function defaultLoadLeadProjection(
  target: EntityRef,
): Promise<LeadDesiredStateProjection | null> {
  if (target.model === "FormLead") {
    const row = await getFormLeadModel().findById(target.id).lean().exec();
    if (!row) return null;
    return {
      model: "FormLead",
      id: String(row._id),
      ingestion_origin: absent(row.ingestion_origin),
      job_no: absent(row.job_no),
      normalized_job_no: absent(row.normalized_job_no),
      granot_priority: absent(row.granot_priority),
      quoted: absent(row.quoted),
      receiver_agent: row.receiver_agent ? String(row.receiver_agent) : undefined,
      name: absent(row.name),
      first_name: absent(row.first_name),
      last_name: absent(row.last_name),
      phone_number: absent(row.phone_number),
      normalized_phone_number: absent(row.normalized_phone_number),
      email: absent(row.email),
      pickup_city: absent(row.pickup_city),
      pickup_zip: absent(row.pickup_zip),
      pickup_state: absent(row.pickup_state),
      delivery_city: absent(row.delivery_city),
      destination_zip: absent(row.destination_zip),
      delivery_state: absent(row.delivery_state),
      move_date: row.move_date ? new Date(row.move_date) : undefined,
      cubic_feet: absent(row.cubic_feet),
      local: absent(row.local),
      move_size: absent(row.move_size),
      granot_move_size: absent(row.granot_move_size),
      granot_service_type: absent(row.granot_service_type),
      granot_contact_snapshot: snapshotContact(row.granot_contact_snapshot),
      ingested_contact_snapshot: snapshotContact(row.ingested_contact_snapshot),
      last_accepted_granot_observation: row.last_accepted_granot_observation
        ? {
            observation_id: String(row.last_accepted_granot_observation.observation_id),
            captured_at: new Date(row.last_accepted_granot_observation.captured_at),
          }
        : undefined,
      last_granot_contact_change: row.last_granot_contact_change
        ? { changed_paths: row.last_granot_contact_change.changed_paths ?? [] }
        : undefined,
      domain_revision: row.domain_revision,
    };
  }
  if (target.model === "CallLead") {
    const row = await getCallLeadModel().findById(target.id).lean().exec();
    if (!row) return null;
    return {
      model: "CallLead",
      id: String(row._id),
      ingestion_origin: absent(row.ingestion_origin),
      job_no: absent(row.job_no),
      normalized_job_no: absent(row.normalized_job_no),
      granot_priority: absent(row.granot_priority),
      quoted: absent(row.quoted),
      receiver_agent: row.receiver_agent ? String(row.receiver_agent) : undefined,
      name: absent(row.name),
      first_name: absent(row.first_name),
      last_name: absent(row.last_name),
      phone_number: absent(row.phone_number),
      normalized_phone_number: absent(row.normalized_phone_number),
      email: absent(row.email),
      pickup_city: absent(row.pickup_city),
      pickup_zip: absent(row.pickup_zip),
      pickup_state: absent(row.pickup_state),
      delivery_city: absent(row.delivery_city),
      delivery_zip: absent(row.delivery_zip),
      delivery_state: absent(row.delivery_state),
      cubic_feet: absent(row.cubic_feet),
      local: absent(row.local),
      granot_move_size: absent(row.granot_move_size),
      granot_service_type: absent(row.granot_service_type),
      granot_contact_snapshot: snapshotContact(row.granot_contact_snapshot),
      ingested_contact_snapshot: snapshotContact(row.ingested_contact_snapshot),
      last_accepted_granot_observation: row.last_accepted_granot_observation
        ? {
            observation_id: String(row.last_accepted_granot_observation.observation_id),
            captured_at: new Date(row.last_accepted_granot_observation.captured_at),
          }
        : undefined,
      last_granot_contact_change: row.last_granot_contact_change
        ? { changed_paths: row.last_granot_contact_change.changed_paths ?? [] }
        : undefined,
      domain_revision: row.domain_revision,
    };
  }
  return null;
}

function snapshotContact(
  value:
    | {
        first_name?: string | null;
        last_name?: string | null;
        name?: string | null;
        phone_number?: string | null;
        normalized_phone_number?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
): LeadDesiredStateProjection["granot_contact_snapshot"] {
  if (!value) return undefined;
  return {
    first_name: absent(value.first_name),
    last_name: absent(value.last_name),
    name: absent(value.name),
    phone_number: absent(value.phone_number),
    normalized_phone_number: absent(value.normalized_phone_number),
    email: absent(value.email),
  };
}

async function defaultAdvanceTemporalWinner(input: {
  target: EntityRef;
  incoming: GranotTemporalTuple;
  session?: ClientSession;
}): Promise<boolean> {
  const filter = {
    _id: input.target.id,
    ...olderTemporalWinnerFilter(input.incoming),
  };
  const update = {
    $set: {
      last_accepted_granot_observation: {
        observation_id: toObjectId(input.incoming.observation_id),
        captured_at: input.incoming.captured_at,
      },
    },
  };
  const options = { session: input.session };
  const result =
    input.target.model === "FormLead"
      ? await getFormLeadModel().updateOne(filter, update, options)
      : input.target.model === "CallLead"
        ? await getCallLeadModel().updateOne(filter, update, options)
        : { matchedCount: 0 };
  return result.matchedCount === 1;
}

export const granotObservationProcessor = createGranotObservationProcessor();
