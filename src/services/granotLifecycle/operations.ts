import mongoose, { type ClientSession } from "mongoose";
import { logger } from "../../logger";
import { withTransaction as defaultWithTransaction } from "../../db";
import {
  getGranotLifecycleActivationModel,
  type GranotLifecycleActivationDocument,
} from "../../models/GranotLifecycleActivation";
import { getOperationalEventModel } from "../../models/OperationalEvent";
import type { DurableActor } from "../durableWork/types";
import type { RegistryActorContext } from "../operationsRegistry/types";
import {
  GRANOT_LIFECYCLE_ERROR_CODES,
  GranotLifecycleError,
} from "./errors";
import { incrementGranotLifecycleActivationsTotal } from "./metrics";

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
      await (deps.persistAudit ?? defaultPersistActivationAudit)(document, session);
    });
  } catch (error) {
    if (isGranotAlreadyActivated(error) || isDuplicateKeyError(error)) {
      throw alreadyActivated(actor.requestId);
    }
    throw error;
  }

  incrementGranotLifecycleActivationsTotal();
  logger.info({
    msg: "granot_lifecycle.activation.committed",
    activation_id: String(document._id),
    activated_at: document.activated_at.toISOString(),
    processor_version: document.processor_version,
    request_id: actor.requestId,
  });
  deps.afterCommit?.(document);
  return projectActivation(document);
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

async function defaultPersistActivationAudit(
  document: GranotLifecycleActivationDocument,
  session?: ClientSession,
): Promise<void> {
  const occurredAt = document.activated_at;
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
          activation_id: String(document._id),
          activated_at: occurredAt.toISOString(),
          processor_version: document.processor_version,
          request_id: document.activated_by.request_id,
        },
        fingerprint: `granot_lifecycle.activation.${String(document._id)}`,
        dedupe_key: `granot_lifecycle.activation.${String(document._id)}`,
        environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
        service: "vantage-main-server",
        region: null,
        request_id: document.activated_by.request_id,
        route: "/api/v1/admin/granot-lifecycle/activation",
        method: "POST",
        status_code: 201,
        duration_ms: null,
        entity_type: "GranotLifecycleActivation",
        entity_id: String(document._id),
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
