import type { ClientSession } from "mongoose";
import { withTransaction as defaultWithTransaction } from "../../db";
import { OperationsRegistryChange } from "../../models/OperationsRegistryChange";
import { invalidateRegistryCaches } from "./cacheInvalidation";
import { sanitizeRegistryMetadata, sanitizeRegistrySnapshot } from "./snapshotSanitizer";
import type { RegistryMutationInput, TransactionRunner } from "./types";
import { RegistryError } from "./errors";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";

export type RegistryAuditDeps = {
  withTransaction?: TransactionRunner;
  insertAudit?: typeof insertRegistryChangeAudit;
};

async function insertRegistryChangeAudit(
  session: ClientSession,
  input: RegistryMutationInput<unknown>["audit"] & {
    actor: RegistryMutationInput<unknown>["actor"];
  },
): Promise<void> {
  await OperationsRegistryChange.create(
    [
      {
        entity_type: input.entityType,
        entity_id: input.entityId,
        action: input.action,
        actor_type: input.actor.actorType,
        actor_id: input.actor.actorId,
        actor_label: input.actor.actorLabel,
        actor_role: input.actor.actorRole,
        request_id: input.actor.requestId,
        reason: input.reason?.trim() || undefined,
        before: sanitizeRegistrySnapshot(input.before ?? null),
        after: sanitizeRegistrySnapshot(input.after ?? null),
        metadata: sanitizeRegistryMetadata(input.metadata),
        created_at: new Date(),
      },
    ],
    { session },
  );
}

/**
 * Runs a registry mutation and its audit insert in one Mongo transaction,
 * then invalidates registry caches only after commit succeeds.
 */
export async function withRegistryMutation<T>(
  input: RegistryMutationInput<T>,
  deps: RegistryAuditDeps = {},
): Promise<T> {
  const runTransaction = deps.withTransaction ?? defaultWithTransaction;
  const writeAudit = deps.insertAudit ?? insertRegistryChangeAudit;

  let result: T;
  try {
    result = await runTransaction(async (session) => {
      const mutationResult = await input.mutate(session);
      await writeAudit(session, {
        ...input.audit,
        actor: input.actor,
      });
      return mutationResult;
    });
  } catch (error) {
    if (isDuplicateRequestIdError(error)) {
      throw new RegistryError(
        "This registry request was already processed.",
        {
          registryCode: REGISTRY_ERROR_CODES.DUPLICATE_IDENTIFIER,
          remediation: {
            summary: "Generate a new request ID before retrying a different mutation.",
          },
        },
      );
    }
    throw error;
  }

  if (input.invalidateKeys?.length) {
    invalidateRegistryCaches(input.invalidateKeys);
  }

  return result;
}

function isDuplicateRequestIdError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const mongoError = error as {
    code?: unknown;
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
  };
  return (
    mongoError.code === 11000 &&
    (mongoError.keyPattern?.request_id === 1 ||
      typeof mongoError.keyValue?.request_id === "string")
  );
}

export { insertRegistryChangeAudit };
