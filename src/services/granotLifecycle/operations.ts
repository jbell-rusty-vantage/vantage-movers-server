import mongoose, { type ClientSession } from "mongoose";
import { toObjectId } from "../../utils/objectId";
import { logger } from "../../logger";
import { withTransaction as defaultWithTransaction } from "../../db";
import {
  getGranotLifecycleActivationModel,
  type GranotLifecycleActivationDocument,
} from "../../models/GranotLifecycleActivation";
import { getOperationalEventModel } from "../../models/OperationalEvent";
import type { DurableActor } from "../durableWork/types";
import type { RegistryActorContext } from "../operationsRegistry/types";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
} from "./errors";
import { incrementGranotLifecycleActivationsTotal } from "./metrics";
import type { ReceiptWorkState } from "./types";
import { maskLifecycleId } from "./observability";

export const PROCESSOR_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export type ActivateGranotLifecycleInput = {
  reason: string;
  processor_version: string;
};

export type GranotLifecycleActivationProjection = {
  id: string;
  key: "granot_lifecycle";
  activated_at: string;
  processor_version: string;
};

export type RequeueDeadLetterInput = {
  id: string;
  reason: string;
};

export type RequeueDeadLetterProjection = {
  receipt_id: string;
  state: "pending";
  next_attempt_at: string;
  manual_requeue_count: number;
  match_attempt: number;
  payload_sha256: string;
  channel_operation_id?: string;
};

export type RequeueCommandDeps = {
  now?: () => Date;
  findReceipt?: (
    id: mongoose.Types.ObjectId,
    session?: ClientSession,
  ) => Promise<{
    _id: mongoose.Types.ObjectId;
    processing: {
      state: ReceiptWorkState;
      match_attempt: number;
      latest_decision_id?: mongoose.Types.ObjectId;
      manual_requeue_count: number;
    };
    payload_sha256: string;
    channel_operation_id?: string;
  } | null>;
  transitionDeadLetter?: (
    id: mongoose.Types.ObjectId,
    now: Date,
    session?: ClientSession,
  ) => Promise<{
    _id: mongoose.Types.ObjectId;
    processing: {
      state: ReceiptWorkState;
      match_attempt: number;
      next_attempt_at: Date;
      manual_requeue_count: number;
    };
    payload_sha256: string;
    channel_operation_id?: string;
  } | null>;
  persistRequeueAudit?: (
    input: {
      receiptId: mongoose.Types.ObjectId;
      reason: string;
      priorState: "dead_letter";
      newState: "pending";
      manual_requeue_count: number;
      actor: DurableActor;
      occurredAt: Date;
    },
    session?: ClientSession,
  ) => Promise<void>;
  withTransaction?: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
};

export type ActivationCommandDeps = {
  now?: () => Date;
  findActivation?: (
    session?: ClientSession,
  ) => Promise<GranotLifecycleActivationDocument | null>;
  persistActivation?: (
    document: GranotLifecycleActivationDocument,
    session?: ClientSession,
  ) => Promise<void>;
  persistAudit?: (
    document: GranotLifecycleActivationDocument,
    session?: ClientSession,
  ) => Promise<void>;
  withTransaction?: <T>(fn: (session: ClientSession) => Promise<T>) => Promise<T>;
  afterCommit?: (activation: GranotLifecycleActivationDocument) => void;
};

export function durableActorFromOwnerActor(
  actor: RegistryActorContext,
): DurableActor {
  if (actor.actorRole !== "owner") {
    throw new GranotLifecycleError(
      "Owner authority is required",
      GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED,
      403,
      actor.requestId,
    );
  }
  return {
    actor_type: "owner",
    actor_id: actor.actorId,
    actor_label: actor.actorLabel,
    actor_role: "owner",
    request_id: actor.requestId,
    origin: "vantage_admin",
  };
}

export function projectActivation(
  document: GranotLifecycleActivationDocument,
): GranotLifecycleActivationProjection {
  return {
    id: String(document._id),
    key: "granot_lifecycle",
    activated_at: new Date(document.activated_at).toISOString(),
    processor_version: document.processor_version,
  };
}

export async function activateGranotLifecycle(
  input: ActivateGranotLifecycleInput,
  actor: RegistryActorContext,
  deps: ActivationCommandDeps = {},
): Promise<GranotLifecycleActivationProjection> {
  const reason = input.reason.trim();
  const processor_version = input.processor_version.trim();
  if (reason.length < 10 || reason.length > 1000) {
    throw new GranotLifecycleError(
      "Activation reason is invalid",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      actor.requestId,
      [{ path: "reason", message: "reason must be 10-1000 trimmed characters" }],
    );
  }
  if (!PROCESSOR_VERSION_PATTERN.test(processor_version)) {
    throw new GranotLifecycleError(
      "Activation processor_version is invalid",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      actor.requestId,
      [{ path: "processor_version", message: "processor_version must be a bounded safe identifier" }],
    );
  }

  const activated_by = durableActorFromOwnerActor(actor);
  const now = deps.now ?? (() => new Date());
  const runTransaction = deps.withTransaction ?? defaultWithTransaction;
  const existing = await (deps.findActivation ?? defaultFindActivation)();
  if (existing) {
    throw alreadyActivated(actor.requestId);
  }

  const document: GranotLifecycleActivationDocument = {
    _id: new mongoose.Types.ObjectId(),
    key: "granot_lifecycle",
    activated_at: now(),
    activated_by,
    reason,
    processor_version,
    createdAt: now(),
  };

  try {
    await runTransaction(async (session) => {
      const raced = await (deps.findActivation ?? defaultFindActivation)(session);
      if (raced) {
        throw alreadyActivated(actor.requestId);
      }
      await (deps.persistActivation ?? defaultPersistActivation)(document, session);
    });
  } catch (error) {
    if (isGranotAlreadyActivated(error) || isDuplicateKeyError(error)) {
      throw alreadyActivated(actor.requestId);
    }
    throw error;
  }

  try {
    await (deps.persistAudit ?? defaultPersistActivationAudit)(document);
  } catch {
    // Observability is after-commit and best-effort.
  }

  incrementGranotLifecycleActivationsTotal();
  logger.info({
    msg: "granot_lifecycle.activation.committed",
    activation_id: maskLifecycleId(String(document._id)),
    activated_at: document.activated_at.toISOString(),
    processor_version: document.processor_version,
    request_id: actor.requestId,
  });
  deps.afterCommit?.(document);
  return projectActivation(document);
}

export async function requeueDeadLetterReceipt(
  input: RequeueDeadLetterInput,
  actor: RegistryActorContext,
  deps: RequeueCommandDeps = {},
): Promise<RequeueDeadLetterProjection> {
  if (!mongoose.isValidObjectId(input.id)) {
    throw new GranotLifecycleError(
      "Receipt id is invalid",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      actor.requestId,
      [{ path: "id", message: "id must be a Mongo ObjectId" }],
    );
  }
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw new GranotLifecycleError(
      "Requeue reason is invalid",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      actor.requestId,
      [{ path: "reason", message: "reason must be 10-500 trimmed characters" }],
    );
  }
  const owner = durableActorFromOwnerActor(actor);
  const now = deps.now ?? (() => new Date());
  const runTransaction = deps.withTransaction ?? defaultWithTransaction;
  const receiptId = toObjectId(input.id);

  const occurredAt = now();
  const updated = await runTransaction(async (session) => {
    const transitioned = await (deps.transitionDeadLetter ?? defaultTransitionDeadLetter)(
      receiptId,
      occurredAt,
      session,
    );
    if (!transitioned) {
      const existing = await (deps.findReceipt ?? defaultFindReceipt)(receiptId, session);
      if (!existing) {
        throw new GranotLifecycleError(
          "Granot observation receipt was not found",
          GRANOT_LIFECYCLE_ERROR_CODES.RECEIPT_NOT_FOUND,
          404,
          actor.requestId,
        );
      }
      throw new GranotLifecycleError(
        "Receipt is not eligible for requeue",
        GRANOT_LIFECYCLE_ERROR_CODES.REQUEUE_STATE_CONFLICT,
        409,
        actor.requestId,
      );
    }
    return transitioned;
  });

  try {
    await (deps.persistRequeueAudit ?? defaultPersistRequeueAudit)({
      receiptId,
      reason,
      priorState: "dead_letter",
      newState: "pending",
      manual_requeue_count: updated.processing.manual_requeue_count,
      actor: owner,
      occurredAt,
    });
  } catch {
    // Observability is after-commit and best-effort.
  }

  logger.info({
    msg: "granot_lifecycle.manual_requeue.committed",
    receipt_id: maskLifecycleId(String(updated._id)),
    prior_state: "dead_letter",
    new_state: "pending",
    manual_requeue_count: updated.processing.manual_requeue_count,
    request_id: actor.requestId,
  });
  return {
    receipt_id: String(updated._id),
    state: "pending",
    next_attempt_at: new Date(updated.processing.next_attempt_at).toISOString(),
    manual_requeue_count: updated.processing.manual_requeue_count,
    match_attempt: updated.processing.match_attempt,
    payload_sha256: updated.payload_sha256,
    channel_operation_id: updated.channel_operation_id,
  };
}

function alreadyActivated(requestId: string): GranotLifecycleError {
  return new GranotLifecycleError(
    "Granot lifecycle activation already exists",
    GRANOT_LIFECYCLE_ERROR_CODES.ALREADY_ACTIVATED,
    409,
    requestId,
  );
}

function isGranotAlreadyActivated(error: unknown): boolean {
  return (
    error instanceof GranotLifecycleError &&
    error.code === GRANOT_LIFECYCLE_ERROR_CODES.ALREADY_ACTIVATED
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 11000,
  );
}

async function defaultFindActivation(
  session?: ClientSession,
): Promise<GranotLifecycleActivationDocument | null> {
  return getGranotLifecycleActivationModel()
    .findOne({ key: "granot_lifecycle" })
    .session(session ?? null)
    .lean();
}

async function defaultPersistActivation(
  document: GranotLifecycleActivationDocument,
  session?: ClientSession,
): Promise<void> {
  await getGranotLifecycleActivationModel().create([document], { session });
}

async function defaultFindReceipt(
  id: mongoose.Types.ObjectId,
  session?: ClientSession,
): Promise<{
  _id: mongoose.Types.ObjectId;
  processing: {
    state: ReceiptWorkState;
    match_attempt: number;
    latest_decision_id?: mongoose.Types.ObjectId;
    manual_requeue_count: number;
  };
  payload_sha256: string;
  channel_operation_id?: string;
} | null> {
  return getGranotObservationReceiptModel()
    .findById(id)
    .session(session ?? null)
    .lean();
}

async function defaultTransitionDeadLetter(
  id: mongoose.Types.ObjectId,
  now: Date,
  session?: ClientSession,
): Promise<{
  _id: mongoose.Types.ObjectId;
  processing: {
    state: ReceiptWorkState;
    match_attempt: number;
    next_attempt_at: Date;
    manual_requeue_count: number;
  };
  payload_sha256: string;
  channel_operation_id?: string;
} | null> {
  return getGranotObservationReceiptModel()
    .findOneAndUpdate(
      { _id: id, "processing.state": "dead_letter" },
      {
        $set: {
          "processing.state": "pending",
          "processing.next_attempt_at": now,
          "processing.technical_attempts": 0,
        },
        $unset: {
          "processing.lease_owner": "",
          "processing.leased_until": "",
          "processing.last_error": "",
          "processing.completed_at": "",
        },
        $inc: { "processing.manual_requeue_count": 1 },
      },
      { new: true, session: session ?? null },
    )
    .lean();
}

async function defaultPersistRequeueAudit(
  input: {
    receiptId: mongoose.Types.ObjectId;
    reason: string;
    priorState: "dead_letter";
    newState: "pending";
    manual_requeue_count: number;
    actor: DurableActor;
    occurredAt: Date;
  },
  session?: ClientSession,
): Promise<void> {
  const maskedReceiptId = maskLifecycleId(String(input.receiptId)) ?? "***";
  await getOperationalEventModel().create(
    [
      {
        occurred_at: input.occurredAt,
        received_at: input.occurredAt,
        level: "info",
        event_key: "granot_lifecycle.manual_requeue",
        category: "admin",
        workflow: "granot_lifecycle",
        summary: "Owner requeued a dead-lettered Granot lifecycle receipt",
        details: {
          receipt_id: maskedReceiptId,
          prior_state: input.priorState,
          new_state: input.newState,
          manual_requeue_count: input.manual_requeue_count,
          actor_role: input.actor.actor_role,
          request_id: input.actor.request_id,
        },
        fingerprint: `granot_lifecycle.requeue.${maskedReceiptId}.${input.manual_requeue_count}`,
        dedupe_key: `granot_lifecycle.requeue.${maskedReceiptId}.${input.manual_requeue_count}`,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
        service: "vantage-main-server",
        region: null,
        request_id: input.actor.request_id,
        route: "/api/v1/admin/granot-lifecycle/receipts/:id/requeue",
        method: "POST",
        status_code: 200,
        duration_ms: null,
        entity_type: "GranotObservationReceipt",
        entity_id: maskedReceiptId,
        lead_name: null,
        lead_phone: null,
        lead_email: null,
        source_company: null,
        job_no: null,
        run_id: null,
        trace: null,
        pii_policy: "none",
        incident_id: null,
        notification_candidate: false,
        reportable: true,
      },
    ],
    { session },
  );
}

async function defaultPersistActivationAudit(
  document: GranotLifecycleActivationDocument,
  session?: ClientSession,
): Promise<void> {
  const occurredAt = document.activated_at;
  const maskedActivationId = maskLifecycleId(String(document._id)) ?? "***";
  await getOperationalEventModel().create(
    [
      {
        occurred_at: occurredAt,
        received_at: occurredAt,
        level: "info",
        event_key: "granot_lifecycle.activation.committed",
        category: "admin",
        workflow: "granot_lifecycle",
        summary: "Granot lifecycle activation committed",
        details: {
          activation_id: maskedActivationId,
          activated_at: occurredAt.toISOString(),
          processor_version: document.processor_version,
          request_id: document.activated_by.request_id,
        },
        fingerprint: `granot_lifecycle.activation.${maskedActivationId}`,
        dedupe_key: `granot_lifecycle.activation.${maskedActivationId}`,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
        service: "vantage-main-server",
        region: null,
        request_id: document.activated_by.request_id,
        route: "/api/v1/admin/granot-lifecycle/activation",
        method: "POST",
        status_code: 201,
        duration_ms: null,
        entity_type: "GranotLifecycleActivation",
        entity_id: maskedActivationId,
        lead_name: null,
        lead_phone: null,
        lead_email: null,
        source_company: null,
        job_no: null,
        run_id: null,
        trace: null,
        pii_policy: "none",
        incident_id: null,
        notification_candidate: false,
        reportable: true,
      },
    ],
    { session },
  );
}
