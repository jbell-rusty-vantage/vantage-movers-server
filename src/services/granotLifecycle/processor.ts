import mongoose, { type ClientSession } from "mongoose";
import {
  classifyExecutionMode,
  getGranotLifecycleFlags,
  type GranotLifecycleFlags,
} from "../../config/domain/granotLifecycle";
import { withTransaction as defaultWithTransaction } from "../../db";
import { logger } from "../../logger";
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
import { DecisionIntegrityError, ProcessingDisabledError } from "./errors";
import {
  incrementGranotLifecycleDecisionsTotal,
  recordGranotLifecycleCaptureToDecisionMs,
} from "./metrics";
import { upsertGranotObservation } from "./normalization";
import {
  createMongoSourcePolicyStore,
  evaluateEffectGates,
  resolveSourcePolicy,
  type EffectGateEvaluation,
  type EvaluatedGate,
  type SourcePolicyResolution,
  type SourcePolicySnapshot,
  type SourcePolicyStore,
} from "./sourcePolicy";
import type {
  EntityRef,
  ExecutionMode,
  GranotObservationProcessor,
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
  withTransaction?: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
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
  void input.initiator;
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

  const prepared = await prepareDecision({
    observation,
    attempt,
    execution_mode,
    flags,
    decided_at: now(),
    sourcePolicyStore: deps.sourcePolicyStore,
  });

  if (existing) {
    if (!decisionMeaningEquals(existing, prepared)) {
      throw new DecisionIntegrityError(String(observation._id), attempt);
    }
    return toProcessorResult(existing, receipt.observation_channel, started);
  }

  const decisionId = new mongoose.Types.ObjectId();
  const linkProposal = prepared.link;
  const runTransaction = deps.withTransaction ?? defaultWithTransaction;

  const persisted = await runTransaction(async (session) => {
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

  logProcessingCompletion({
    receipt_id: String(receipt._id),
    observation_id: String(observation._id),
    decision_id: String(persisted._id),
    attempt,
    execution_mode,
    outcome: persisted.outcome,
    reason_code: persisted.reason_code,
    duration_ms: Date.now() - started,
  });
  return toProcessorResult(persisted, receipt.observation_channel, started);
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
}): Promise<{ decision: PreparedDecision; link?: LinkProposal }> {
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

  if (!policy.ok) {
    return {
      decision: {
        ...base,
        outcome: policy.outcome,
        reason_code: policy.reason,
        source_scope: decisionSourceScope(policy.snapshot),
      },
    };
  }

  const gates = snapshotEligibleGates(policy.snapshot, input.execution_mode, input.flags);
  const source_scope = decisionSourceScope(policy.snapshot);
  const job = jobProposal(input.observation, policy);

  if (input.execution_mode === "historical_shadow" && job) {
    return {
      decision: {
        ...base,
        outcome: "linked",
        reason_code: "record_link_established",
        match_method: "granot_record_link",
        source_scope,
        evaluated_gates: gates.evaluated_gates,
      },
      link: job,
    };
  }

  return {
    decision: {
      ...base,
      outcome: nonEffectingOutcome(input.execution_mode).outcome,
      reason_code: nonEffectingOutcome(input.execution_mode).reason,
      source_scope,
      evaluated_gates: gates.evaluated_gates,
    },
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
): EffectGateEvaluation {
  return evaluateEffectGates({
    global_effect_flag: flags.lead_writes_enabled,
    receipt_post_activation: mode !== "historical_shadow",
    processor_mode: mode,
    operational_enabled: true,
    lifecycle_enabled: true,
    disposition: snapshot.lifecycle_disposition,
    source_company_active: Boolean(snapshot.lead_source_company_id),
    source_granularity_active: Boolean(snapshot.source_granularity_id),
    lead_created_policy: snapshot.lead_created_policy,
    requested_effect: "lead_link",
  });
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
    granot_crm_source_id: new mongoose.Types.ObjectId(snapshot.granot_crm_source_id),
    lead_source_company: new mongoose.Types.ObjectId(snapshot.lead_source_company_id),
    source_granularity_id: new mongoose.Types.ObjectId(snapshot.source_granularity_id),
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
          lead_source_company: new mongoose.Types.ObjectId(
            policy.snapshot.lead_source_company_id,
          ),
          source_granularity_id: new mongoose.Types.ObjectId(
            policy.snapshot.source_granularity_id,
          ),
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
  return (
    existing.outcome === next.outcome &&
    existing.reason_code === next.reason_code
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
  await getGranotObservationReceiptModel().updateOne(
    { _id: receiptId },
    { $set: { "processing.latest_decision_id": decision._id } },
    { session },
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
  await getGranotObservationReceiptModel().updateOne(
    { _id: input.receiptId },
    { $set: { "processing.latest_decision_id": input.decision._id } },
    { session: input.session },
  );
}

export const granotObservationProcessor = createGranotObservationProcessor();
