import type { ClientSession } from "mongoose";
import { connectMongo, withTransaction } from "../../db";
import {
  DomainCommandExecution,
  readStoredCanonicalCommandResult,
} from "../../models/DomainCommandExecution";
import { recordOperationalEvent } from "../observability";
import { assertCommandContext, type CommandContextVerifier } from "./commandContext";
import {
  DomainCommandIdempotencyConflictError,
  toCompatibilityCanonicalCommandResult,
  type CanonicalCommandContext,
  type CanonicalCommandExecutionOutcome,
  type CanonicalCommandOperationEvidence,
  type CanonicalCommandOperationInput,
  type CompatibilityCanonicalCommandResult,
  type StoredCanonicalCommandResult,
} from "./types";

export type StoredCanonicalCommandExecution = {
  command_name: string;
  payload_checksum: string;
  result: StoredCanonicalCommandResult;
};

export interface CanonicalCommandExecutionStore {
  find(input: {
    origin: CanonicalCommandContext["provenance"]["origin"];
    idempotency_key: string;
    session?: ClientSession;
  }): Promise<StoredCanonicalCommandExecution | null>;
  persist(input: {
    command_name: string;
    context: CanonicalCommandContext;
    result: StoredCanonicalCommandResult;
    applied_at: Date;
    session: ClientSession;
  }): Promise<void>;
}

export type CanonicalCommandTransactionRunner = <T>(
  fn: (session: ClientSession) => Promise<T>,
) => Promise<T>;

export function createIdempotentCanonicalCommandExecutor(input: {
  store: CanonicalCommandExecutionStore;
  connect: () => Promise<void>;
  withTransaction?: CanonicalCommandTransactionRunner;
  now?: () => Date;
  contextVerifier?: CommandContextVerifier;
}) {
  const runTransaction = input.withTransaction ?? withTransaction;
  const clock = input.now ?? (() => new Date());

  return async function execute(command: {
    command_name: string;
    context: CanonicalCommandContext;
    operation: (
      input: CanonicalCommandOperationInput,
    ) => Promise<CanonicalCommandOperationEvidence>;
  }): Promise<CanonicalCommandExecutionOutcome> {
    await assertCommandContext(command.context, input.contextVerifier);
    const context = normalizeCommandContext(command.context);
    await input.connect();
    const now = clock();

    let outcome: CanonicalCommandExecutionOutcome;
    try {
      outcome = await runTransaction(async (session) => {
        const existing = await findExisting(
          input.store,
          command.command_name,
          context,
          session,
        );
        if (existing) {
          return { result: existing, replayed: true };
        }

        const evidence = await command.operation({ session, now });
        const result = toStoredResult(evidence);
        await input.store.persist({
          command_name: command.command_name,
          context,
          result,
          applied_at: now,
          session,
        });
        return { result, replayed: false };
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await findExisting(
        input.store,
        command.command_name,
        context,
      );
      if (!raced) throw error;
      outcome = { result: raced, replayed: true };
    }

    await recordCommandOperationalEvent(
      command.command_name,
      context,
      outcome,
    );
    return outcome;
  };
}

const mongooseExecutionStore: CanonicalCommandExecutionStore = {
  async find(input) {
    const query = DomainCommandExecution.findOne({
      origin: input.origin,
      idempotency_key: input.idempotency_key,
    });
    if (input.session) {
      query.session(input.session);
    }
    const existing = await query.lean().exec();
    if (!existing) return null;
    return {
      command_name: existing.command_name,
      payload_checksum: existing.payload_checksum,
      result: readStoredCanonicalCommandResult(existing),
    };
  },
  async persist(input) {
    const execution = new DomainCommandExecution({
      origin: input.context.provenance.origin,
      idempotency_key: input.context.idempotency_key,
      command_id: input.context.command_id,
      command_name: input.command_name,
      payload_checksum: input.context.payload_checksum,
      actor: input.context.actor,
      initiator: input.context.initiator,
      provenance: input.context.provenance,
      result: input.result,
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

export async function executeCanonicalCommandWithPostCommit<TPending>(input: {
  command_name: string;
  context: CanonicalCommandContext;
  operation: (
    tx: CanonicalCommandOperationInput,
  ) => Promise<CanonicalCommandOperationEvidence & { pending?: TPending }>;
  finalize?: (pending: TPending) => Promise<unknown>;
}): Promise<CompatibilityCanonicalCommandResult> {
  let pending: TPending | undefined;
  const outcome = await executeIdempotentCanonicalCommand({
    command_name: input.command_name,
    context: input.context,
    operation: async (tx) => {
      const evidence = await input.operation(tx);
      pending = evidence.pending;
      return {
        entity_refs: evidence.entity_refs,
        warnings: evidence.warnings,
      };
    },
  });
  if (!outcome.replayed && pending !== undefined && input.finalize) {
    await input.finalize(pending);
  }
  return toCompatibilityCanonicalCommandResult(outcome);
}

function normalizeCommandContext(
  context: CanonicalCommandContext,
): CanonicalCommandContext {
  return {
    ...context,
    payload_checksum: context.payload_checksum.toLowerCase(),
  };
}

function toStoredResult(
  evidence: CanonicalCommandOperationEvidence,
): StoredCanonicalCommandResult {
  return {
    status: "applied",
    entity_refs: evidence.entity_refs.map((entry) => ({ ...entry })),
    warnings: [...(evidence.warnings ?? [])],
  };
}

async function findExisting(
  store: CanonicalCommandExecutionStore,
  commandName: string,
  context: CanonicalCommandContext,
  session?: ClientSession,
): Promise<StoredCanonicalCommandResult | null> {
  const existing = await store.find({
    origin: context.provenance.origin,
    idempotency_key: context.idempotency_key,
    session,
  });
  if (!existing) return null;
  if (
    existing.command_name !== commandName ||
    existing.payload_checksum !== context.payload_checksum
  ) {
    throw new DomainCommandIdempotencyConflictError();
  }
  return {
    status: "applied",
    entity_refs: existing.result.entity_refs.map((entry) => ({ ...entry })),
    warnings: [...existing.result.warnings],
  };
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
  outcome: CanonicalCommandExecutionOutcome,
): Promise<void> {
  const firstEntity = outcome.result.entity_refs[0];
  await recordOperationalEvent({
    level: "info",
    eventKey: outcome.replayed
      ? "domain_command.replayed"
      : "domain_command.applied",
    category: "admin",
    workflow: "canonical_domain_command",
    summary: outcome.replayed
      ? "Canonical domain command replay returned its durable outcome."
      : "Canonical domain command applied.",
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
      command_status: outcome.result.status,
      replayed: outcome.replayed,
      actor_type: context.actor.actor_type,
      actor_id: context.actor.actor_id,
      initiator_type: context.initiator.actor_type,
      initiator_id: context.initiator.actor_id,
      origin: context.provenance.origin,
      source_receipt_id: context.provenance.source_receipt_id,
      source_connection_key: context.provenance.source_connection_key,
      observation_id: context.provenance.observation_id ?? null,
      decision_id: context.provenance.decision_id ?? null,
      entity_ref_count: outcome.result.entity_refs.length,
      warning_count: outcome.result.warnings.length,
    },
    notificationCandidate: false,
    reportable: false,
  });
}
