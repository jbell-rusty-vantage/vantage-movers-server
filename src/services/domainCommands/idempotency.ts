import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientSession } from "mongoose";
import { connectMongo } from "../../db";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { recordOperationalEvent } from "../observability";
import {
  DomainCommandContextError,
  DomainCommandIdempotencyConflictError,
  type CanonicalCommandContext,
  type CanonicalCommandResult,
  type CanonicalEntityReference,
} from "./types";

type AppliedCommandEvidence = {
  entity_refs: readonly CanonicalEntityReference[];
  warnings?: readonly string[];
};

export type StoredCanonicalCommandExecution = {
  command_name: string;
  payload_checksum: string;
  entity_refs: readonly CanonicalEntityReference[];
  warnings: readonly string[];
};

export interface CanonicalCommandExecutionStore {
  find(input: {
    origin: CanonicalCommandContext["provenance"]["origin"];
    idempotency_key: string;
  }): Promise<StoredCanonicalCommandExecution | null>;
  persist(input: {
    command_name: string;
    context: CanonicalCommandContext;
    result: CanonicalCommandResult;
    applied_at: Date;
    session: ClientSession;
  }): Promise<void>;
}

type ActiveCommandExecution = {
  command_name: string;
  context: CanonicalCommandContext;
  project: (transactionResult: unknown) => AppliedCommandEvidence;
  store: CanonicalCommandExecutionStore;
  result?: CanonicalCommandResult;
};

const commandExecutionStorage =
  new AsyncLocalStorage<ActiveCommandExecution>();

export function createIdempotentCanonicalCommandExecutor(input: {
  store: CanonicalCommandExecutionStore;
  connect: () => Promise<void>;
}) {
  return async function execute<T>(command: {
    command_name: string;
    context: CanonicalCommandContext;
    operation: () => Promise<T>;
    project: (transactionResult: unknown) => AppliedCommandEvidence;
  }): Promise<CanonicalCommandResult> {
    assertCommandContext(command.context);
    await input.connect();
    const existing = await findExisting(
      input.store,
      command.command_name,
      command.context,
    );
    if (existing) {
      await recordCommandOperationalEvent(
        command.command_name,
        command.context,
        existing,
      );
      return existing;
    }

    const active: ActiveCommandExecution = {
      command_name: command.command_name,
      context: command.context,
      project: command.project,
      store: input.store,
    };
    try {
      await commandExecutionStorage.run(active, command.operation);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await findExisting(
        input.store,
        command.command_name,
        command.context,
      );
      if (raced) {
        await recordCommandOperationalEvent(
          command.command_name,
          command.context,
          raced,
        );
        return raced;
      }
      throw error;
    }
    if (!active.result) {
      throw new DomainCommandContextError(
        "Canonical command did not execute through the transactional domain-write seam.",
      );
    }
    await recordCommandOperationalEvent(
      command.command_name,
      command.context,
      active.result,
    );
    return active.result;
  };
}

const mongooseExecutionStore: CanonicalCommandExecutionStore = {
  async find(input) {
    const existing = await DomainCommandExecution.findOne({
      origin: input.origin,
      idempotency_key: input.idempotency_key,
    })
      .lean()
      .exec();
    return existing
      ? {
          command_name: existing.command_name,
          payload_checksum: existing.payload_checksum,
          entity_refs: existing.entity_refs.map((entry) => ({
            model: entry.model,
            id: entry.id,
          })),
          warnings: [...existing.warnings],
        }
      : null;
  },
  async persist(input) {
    const execution = new DomainCommandExecution({
      origin: input.context.provenance.origin,
      idempotency_key: input.context.idempotency_key,
      command_id: input.context.command_id,
      command_name: input.command_name,
      payload_checksum: input.context.payload_checksum.toLowerCase(),
      actor: input.context.actor,
      initiator: input.context.initiator,
      provenance: input.context.provenance,
      entity_refs: input.result.entity_refs,
      warnings: input.result.warnings,
      applied_at: input.applied_at,
    });
    await execution.save({ session: input.session });
  },
};

export const executeIdempotentCanonicalCommand =
  createIdempotentCanonicalCommandExecutor({
    store: mongooseExecutionStore,
    connect: connectMongo,
  });

export function hasActiveCanonicalCommandExecution(): boolean {
  return commandExecutionStorage.getStore() !== undefined;
}

export async function persistActiveCanonicalCommandExecution(
  transactionResult: unknown,
  session: ClientSession,
): Promise<void> {
  const active = commandExecutionStorage.getStore();
  if (!active) return;
  const evidence = active.project(transactionResult);
  const result: CanonicalCommandResult = {
    status: "applied",
    entity_refs: evidence.entity_refs.map((entry) => ({ ...entry })),
    warnings: [...(evidence.warnings ?? [])],
  };
  await active.store.persist({
    command_name: active.command_name,
    context: active.context,
    result,
    applied_at: new Date(),
    session,
  });
  active.result = result;
}

async function findExisting(
  store: CanonicalCommandExecutionStore,
  commandName: string,
  context: CanonicalCommandContext,
): Promise<CanonicalCommandResult | null> {
  const existing = await store.find({
    origin: context.provenance.origin,
    idempotency_key: context.idempotency_key,
  });
  if (!existing) return null;
  if (
    existing.command_name !== commandName ||
    existing.payload_checksum !== context.payload_checksum.toLowerCase()
  ) {
    throw new DomainCommandIdempotencyConflictError();
  }
  return {
    status: "already_applied",
    entity_refs: existing.entity_refs.map((entry) => ({
      model: entry.model,
      id: entry.id,
    })),
    warnings: [...existing.warnings],
  };
}

function assertCommandContext(context: CanonicalCommandContext): void {
  if (
    !context.command_id.trim() ||
    !context.idempotency_key.trim() ||
    !/^[a-f0-9]{64}$/i.test(context.payload_checksum)
  ) {
    throw new DomainCommandContextError(
      "Command id, idempotency key, and SHA-256 payload checksum are required.",
    );
  }
  if (context.provenance.origin === "external_sheet_ingestion") {
    if (
      context.actor.actor_type !== "system" ||
      context.actor.actor_id !== "best-relocation-ingestion" ||
      context.actor.actor_role !== "system" ||
      context.actor.origin !== "external_sheet_ingestion" ||
      !isTrustedHumanActor(context.initiator) ||
      !context.provenance.run_id ||
      !context.provenance.source_receipt_id ||
      !context.provenance.source_connection_key
    ) {
      throw new DomainCommandContextError(
        "External ingestion commands require the dedicated ingestion actor, a trusted human initiator, and complete source provenance.",
      );
    }
    return;
  }
  if (
    !isTrustedHumanActor(context.actor) ||
    !isTrustedHumanActor(context.initiator)
  ) {
    throw new DomainCommandContextError(
      "Admin commands require trusted owner/admin actor and initiator snapshots.",
    );
  }
}

function isTrustedHumanActor(
  actor: CanonicalCommandContext["actor"],
): boolean {
  return (
    (actor.actor_type === "owner" ||
      actor.actor_type === "admin") &&
    actor.actor_role === actor.actor_type &&
    actor.origin === "vantage_admin" &&
    Boolean(actor.actor_id.trim()) &&
    Boolean(actor.request_id.trim())
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

async function recordCommandOperationalEvent(
  commandName: string,
  context: CanonicalCommandContext,
  result: CanonicalCommandResult,
): Promise<void> {
  const firstEntity = result.entity_refs[0];
  await recordOperationalEvent({
    level: "info",
    eventKey:
      result.status === "applied"
        ? "domain_command.applied"
        : "domain_command.replayed",
    category: "admin",
    workflow: "canonical_domain_command",
    summary:
      result.status === "applied"
        ? "Canonical domain command applied."
        : "Canonical domain command replay returned its durable outcome.",
    requestId: context.actor.request_id,
    runId: context.provenance.run_id,
    ...(firstEntity
      ? {
          entity: {
            type: firstEntity.model,
            id: firstEntity.id,
          },
        }
      : {}),
    details: {
      command_name: commandName,
      command_id: context.command_id,
      command_status: result.status,
      actor_type: context.actor.actor_type,
      actor_id: context.actor.actor_id,
      initiator_type: context.initiator.actor_type,
      initiator_id: context.initiator.actor_id,
      origin: context.provenance.origin,
      source_receipt_id: context.provenance.source_receipt_id,
      source_connection_key:
        context.provenance.source_connection_key,
      entity_ref_count: result.entity_refs.length,
      warning_count: result.warnings.length,
    },
    notificationCandidate: false,
    reportable: false,
  });
}
