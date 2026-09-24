import { createHash } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { z } from "zod";
import { withTransaction } from "../../db";
import { canonicalJson } from "../durableWork/checksum";
import {
  getSalesIntelligenceCommandExecutionModel,
  SALES_INTELLIGENCE_COMMAND_EXECUTION_INDEXES,
} from "../../models/SalesIntelligenceCommandExecution";
import { getSalesIntelligenceAuditEventModel } from "../../models/SalesIntelligenceAuditEvent";
import { CsiError, assertTrustedActor, type CsiActor } from "./auth";
import type { CsiIndex } from "../../models/salesIntelligence/common";
export const payloadHash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
export function duplicateKey(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000,
  );
}
type IndexedCollection = {
  dbName?: string;
  collectionName?: string;
  indexes(): Promise<
    Array<{
      name?: string;
      key: object;
      unique?: boolean;
      partialFilterExpression?: object;
      sparse?: boolean;
    }>
  >;
};

/**
 * A satisfied unique fence for one collection cannot become unsatisfied inside
 * a process lifetime: dropping an index is an operator action that restarts
 * the worker. Without this memo a single 250-Lead attachment page issues 250
 * `listIndexes` server commands, and every enqueue and claim issues one more
 * (14 §10). Only successes are cached, so a genuinely missing index keeps
 * failing closed on every call until it is created.
 */
const verifiedIndexFences = new Set<string>();

/** Test seam; production never needs to forget a verified fence. */
export function resetVerifiedIndexFences(): void {
  verifiedIndexFences.clear();
}

export async function assertIndexes(
  collection: IndexedCollection,
  expected: readonly CsiIndex[],
) {
  const required = expected.filter((v) => v.unique);
  if (!required.length) return;
  const namespace = `${collection.dbName ?? "?"}.${collection.collectionName ?? "?"}`;
  const memoKey = `${namespace}:${canonicalJson(required.map((v) => v.name))}`;
  if (namespace.includes("?")) {
    // An unidentifiable collection (a test double) is never memoized.
    await verifyIndexFences(collection, required);
    return;
  }
  if (verifiedIndexFences.has(memoKey)) return;
  await verifyIndexFences(collection, required);
  verifiedIndexFences.add(memoKey);
}

async function verifyIndexFences(
  collection: IndexedCollection,
  required: readonly CsiIndex[],
) {
  let actual;
  try {
    actual = await collection.indexes();
  } catch {
    throw new CsiError("INDEX_REQUIRED");
  }
  for (const e of required) {
    if (
      !actual.some(
        (a) =>
          a.name === e.name &&
          a.unique === true &&
          canonicalJson(a.key) === canonicalJson(e.key) &&
          canonicalJson(a.partialFilterExpression ?? null) ===
            canonicalJson(e.partialFilterExpression ?? null) &&
          Boolean(a.sparse) === Boolean(e.sparse),
      )
    )
      throw new CsiError("INDEX_REQUIRED");
  }
}
export async function csiCas<T extends { revision: number }>(
  model: mongoose.Model<T>,
  id: string,
  expectedRevision: number,
  changes: Partial<T>,
  session: ClientSession,
) {
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 ||
    Object.keys(changes).some(
      (k) => k.startsWith("$") || k === "revision" || k === "_id",
    )
  )
    throw new CsiError("INVALID_INPUT");
  const result = await model.updateOne(
    { _id: id, revision: expectedRevision },
    { $set: changes, $inc: { revision: 1 } } as mongoose.UpdateQuery<T>,
    { session, runValidators: true },
  );
  if (result.modifiedCount !== 1) throw new CsiError("REVISION_CONFLICT");
}
export type CsiTransactionContext = {
  session: ClientSession;
  command_id: mongoose.Types.ObjectId;
  now: Date;
  actor: CsiActor;
};
export async function executeCsiCommand<
  T extends z.infer<ReturnType<typeof z.json>>,
>(input: {
  actor: CsiActor;
  command: string;
  idempotency_key: string;
  payload: unknown;
  operation: (context: CsiTransactionContext) => Promise<T>;
}): Promise<{ response: T; replayed: boolean }> {
  // S8-REP: a signed rep runs its allowlisted follow-up commands through the same ledger, in its own
  // idempotency scope (`rep:<id>`). The Owner's scope and checks are unchanged.
  const rep = input.actor.kind === "rep";
  assertTrustedActor(input.actor, rep ? "rep" : "owner");
  if (!input.idempotency_key.trim() || input.idempotency_key.length > 200)
    throw new CsiError("INVALID_INPUT");
  const Model = getSalesIntelligenceCommandExecutionModel();
  const indexes = SALES_INTELLIGENCE_COMMAND_EXECUTION_INDEXES;
  await assertIndexes(Model.collection, indexes);
  const key = {
    actor_scope: `${rep ? "rep" : "owner"}:${input.actor.id}`,
    idempotency_key: input.idempotency_key,
  };
  const hash = payloadHash({ command: input.command, payload: input.payload });
  const replay = (row: { payload_hash: string; response: unknown }) => {
    if (row.payload_hash !== hash) throw new CsiError("IDEMPOTENCY_CONFLICT");
    // Stored response is the operation's JSON result, checked before insertion.
    return { response: row.response as T, replayed: true };
  };
  const command_id = new mongoose.Types.ObjectId();
  const now = new Date();
  try {
    return await withTransaction(async (session) => {
      const prior = await Model.findOne(key).session(session).lean();
      if (prior) return replay(prior);
      const response = await input.operation({
        session,
        command_id,
        now,
        actor: input.actor,
      });
      z.json().parse(response);
      await Model.create(
        [
          {
            ...key,
            _id: command_id,
            command: input.command,
            payload_hash: hash,
            response,
            request_id: input.actor.request_id,
            actor: input.actor,
            target_revisions: [],
            executed_at: now,
          },
        ],
        { session },
      );
      return { response, replayed: false };
    });
  } catch (error) {
    if (duplicateKey(error)) {
      const prior = await Model.findOne(key).lean();
      if (prior) return replay(prior);
    }
    throw error;
  }
}
export async function appendCsiAudit(
  context: CsiTransactionContext,
  input: {
    subject_key: string;
    event_kind: string;
    prior: z.infer<ReturnType<typeof z.json>>;
    current: z.infer<ReturnType<typeof z.json>>;
    target_id: string;
    revision: number;
    happened_at?: Date;
    kind:
      | "number"
      | "outreach"
      | "followup"
      | "review"
      | "policy"
      | "analysis"
      | "restriction"
      | "rep"
      | "nudge"
      | "interaction"
      | "job";
  },
) {
  if (!context.session.inTransaction()) throw new CsiError("INVALID_INPUT");
  assertTrustedActor(context.actor);
  await getSalesIntelligenceAuditEventModel().create(
    [
      {
        semantic_key: `${context.command_id}:${input.kind}:${input.target_id}:${input.revision}`,
        subject_key: input.subject_key,
        event_kind: input.event_kind,
        command_id: context.command_id,
        actor: context.actor,
        happened_at: input.happened_at ?? context.now,
        recorded_at: context.now,
        prior: input.prior,
        current: input.current,
        invalidation: {
          kind: input.kind,
          target_id: input.target_id,
          subject_key: input.subject_key,
          revision: input.revision,
        },
      },
    ],
    { session: context.session },
  );
}
