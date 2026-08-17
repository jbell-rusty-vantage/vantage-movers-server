import assert from "node:assert/strict";
import { after, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { connectMongo, withTransaction } from "../../db";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import { getFormLeadModel } from "../../models/FormLead";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import {
  compareAndSwapDomainRevision,
  DOMAIN_REVISION_CONFLICT,
} from "../granotLifecycle/aggregateRevision";
import {
  createGranotLifecycleProcessorActor,
  createGranotWebhookInitiator,
} from "../durableWork/actors";
import {
  createIdempotentCanonicalCommandExecutor,
  executeCanonicalCommandWithPostCommit,
} from "./idempotency";
import {
  DomainCommandIdempotencyConflictError,
  DomainRevisionConflictError,
  type CanonicalCommandContext,
} from "./types";

const DECISION_COLLECTION = "synchronization_decisions";
const COMMAND_COLLECTION = "domain_command_executions";
const CHANGE_COLLECTION = "entity_changes";

async function replicaReady(t: { skip: (reason: string) => void }): Promise<boolean> {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    t.skip("Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.");
    return false;
  }
  if (getMongoDatabaseName() !== "testvantagemovers") {
    t.skip("Replica-set proof requires TEST_MODE=true before process start.");
    return false;
  }
  await connectMongo();
  if (mongoose.connection.db?.databaseName !== "testvantagemovers") {
    t.skip("Refusing replica-set proof against a non-test database.");
    return false;
  }
  const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
  if (!hello || hello.setName == null) {
    t.skip("Connected Mongo is not a replica set.");
    return false;
  }
  return true;
}

after(async () => {
  await mongoose.disconnect().catch(() => undefined);
});

test("[AC-21] replica executor: exact stored-result replay, checksum conflict, and no second mutation", async (t) => {
  if (!(await replicaReady(t))) return;
  const prefix = `u10-replay-${Date.now()}`;
  const execute = productionExecutor();
  const context = granotContext(prefix, "a".repeat(64));
  let mutations = 0;
  const run = () =>
    execute({
      command_name: "synchronizeLeadFromGranot",
      context,
      operation: async ({ session, now }) => {
        mutations += 1;
        const lead = await insertLead(prefix, session, now);
        return { entity_refs: [{ model: "FormLead", id: String(lead._id) }] };
      },
    });
  const first = await run();
  const replay = await run();
  assert.equal(first.result.status, "applied");
  assert.equal(replay.result.status, "applied");
  assert.deepEqual(replay.result.entity_refs, first.result.entity_refs);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(mutations, 1);
  await assert.rejects(
    execute({
      command_name: "synchronizeLeadFromGranot",
      context: granotContext(prefix, "b".repeat(64)),
      operation: async () => ({ entity_refs: [] }),
    }),
    DomainCommandIdempotencyConflictError,
  );
  const stored = await DomainCommandExecution.find({
    idempotency_key: context.idempotency_key,
  }).lean();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.result?.status, "applied");
  await cleanup(prefix);
});

test("[AC-21] replica executor: same-key commit race has one winner and exact replay of the stored result", async (t) => {
  if (!(await replicaReady(t))) return;
  const prefix = `u10-race-${Date.now()}`;
  const execute = productionExecutor();
  const context = granotContext(prefix, "c".repeat(64));
  const raced = await Promise.all(
    [1, 2].map((index) =>
      execute({
        command_name: "synchronizeLeadFromGranot",
        context,
        operation: async ({ session, now }) => {
          const lead = await insertLead(`${prefix}-${index}`, session, now);
          return { entity_refs: [{ model: "FormLead", id: String(lead._id) }] };
        },
      }),
    ),
  );
  assert.equal(raced.filter((entry) => !entry.replayed).length, 1);
  assert.equal(raced.filter((entry) => entry.replayed).length, 1);
  assert.deepEqual(raced[0]?.result.entity_refs, raced[1]?.result.entity_refs);
  const stored = await DomainCommandExecution.find({
    idempotency_key: context.idempotency_key,
  }).lean();
  assert.equal(stored.length, 1);
  await cleanup(prefix);
});

test("[AC-21] replica executor: expected-revision loser is DOMAIN_REVISION_CONFLICT with no Decision/Command", async (t) => {
  if (!(await replicaReady(t))) return;
  const prefix = `u10-cas-${Date.now()}`;
  const FormLead = getFormLeadModel();
  const lead = await FormLead.create({
    name: "U10 CAS",
    phone_number: "5550000010",
    pickup_zip: "10001",
    destination_zip: "94105",
    move_size: "1 Bedroom",
    local: "long_distance",
    source_company: "main_site",
    domain_revision: 0,
  });
  t.after(async () => {
    await FormLead.deleteOne({ _id: lead._id });
    await cleanup(prefix);
  });
  const execute = productionExecutor();
  const winnerContext = granotContext(`${prefix}-win`, "d".repeat(64));
  const loserContext = granotContext(`${prefix}-lose`, "e".repeat(64));
  const Decision = getSynchronizationDecisionModel();
  const winner = await execute({
    command_name: "synchronizeLeadFromGranot",
    context: winnerContext,
    operation: async ({ session, now }) => {
      await insertDecision(winnerContext, session, now);
      const cas = await compareAndSwapDomainRevision(
        FormLead.collection,
        { _id: lead._id, domain_revision: 0 },
        session,
      );
      if (!cas.ok) throw new DomainRevisionConflictError();
      return { entity_refs: [{ model: "FormLead", id: String(lead._id) }] };
    },
  });
  assert.equal(winner.replayed, false);
  await assert.rejects(
    execute({
      command_name: "synchronizeLeadFromGranot",
      context: loserContext,
      operation: async ({ session, now }) => {
        await insertDecision(loserContext, session, now);
        const cas = await compareAndSwapDomainRevision(
          FormLead.collection,
          { _id: lead._id, domain_revision: 0 },
          session,
        );
        if (!cas.ok) {
          assert.equal(cas.code, DOMAIN_REVISION_CONFLICT);
          throw new DomainRevisionConflictError();
        }
        return { entity_refs: [{ model: "FormLead", id: String(lead._id) }] };
      },
    }),
    DomainRevisionConflictError,
  );
  const loserCommand = await DomainCommandExecution.findOne({
    command_id: loserContext.command_id,
  }).lean();
  const loserDecision = await Decision.findOne({
    observation_id: loserContext.provenance.observation_id,
  }).lean();
  assert.equal(loserCommand, null);
  assert.equal(loserDecision, null);
  const storedLead = await FormLead.findById(lead._id).lean();
  assert.equal(storedLead?.domain_revision, 1);
});

test("[AC-32] replica executor: Receipt/Observation/Decision causal IDs persist; rollback leaves zero partial rows", async (t) => {
  if (!(await replicaReady(t))) return;
  const prefix = `u10-rollback-${Date.now()}`;
  const execute = productionExecutor();
  const context = granotContext(prefix, "f".repeat(64));
  const Decision = getSynchronizationDecisionModel();
  await assert.rejects(
    execute({
      command_name: "synchronizeLeadFromGranot",
      context,
      operation: async ({ session, now }) => {
        await insertDecision(context, session, now);
        await insertLead(prefix, session, now);
        throw new Error("injected after operation writes");
      },
    }),
    /injected after operation writes/,
  );
  const decisions = await Decision.find({
    observation_id: context.provenance.observation_id,
  }).lean();
  const commands = await DomainCommandExecution.find({
    command_id: context.command_id,
  }).lean();
  const leads = await getFormLeadModel().find({ name: `U10 ${prefix}` }).lean();
  const changes = await mongoose.connection.db
    ?.collection(CHANGE_COLLECTION)
    .countDocuments({ "provenance.decision_id": context.provenance.decision_id });
  assert.equal(decisions.length, 0);
  assert.equal(commands.length, 0);
  assert.equal(leads.length, 0);
  assert.equal(changes ?? 0, 0);
  await cleanup(prefix);
});

test("[AC-21] replica executor: stable now and preallocated IDs survive callback retry", async (t) => {
  if (!(await replicaReady(t))) return;
  const prefix = `u10-retry-${Date.now()}`;
  const clock = new Date("2026-08-17T21:10:00.000Z");
  const seen: Date[] = [];
  const execute = createIdempotentCanonicalCommandExecutor({
    store: replicaStore(),
    connect: connectMongo,
    now: () => clock,
    withTransaction: async (fn) => {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        await fn(session);
        await session.abortTransaction();
        session.startTransaction();
        const result = await fn(session);
        await session.commitTransaction();
        return result;
      } finally {
        await session.endSession();
      }
    },
  });
  const context = granotContext(prefix, "2".repeat(64));
  const outcome = await execute({
    command_name: "synchronizeLeadFromGranot",
    context,
    operation: async ({ session, now }) => {
      seen.push(now);
      await insertDecision(context, session, now);
      const lead = await insertLead(prefix, session, now);
      return { entity_refs: [{ model: "FormLead", id: String(lead._id) }] };
    },
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0]?.toISOString(), clock.toISOString());
  assert.equal(seen[1]?.toISOString(), clock.toISOString());
  assert.equal(outcome.replayed, false);
  assert.equal(outcome.result.status, "applied");
  const Decision = getSynchronizationDecisionModel();
  const decisions = await Decision.find({
    observation_id: context.provenance.observation_id,
  }).lean();
  const commands = await DomainCommandExecution.find({
    command_id: context.command_id,
  }).lean();
  const leads = await getFormLeadModel().find({ name: `U10 ${prefix}` }).lean();
  assert.equal(decisions.length, 1);
  assert.equal(String(decisions[0]?._id), context.provenance.decision_id);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.provenance?.decision_id, context.provenance.decision_id);
  assert.equal(leads.length, 1);
  assert.equal(leads[0]?.timestamp?.toISOString(), clock.toISOString());
  await cleanup(prefix);
});

test("[AC-32] replica executor: persist failure rolls back Decision, aggregate, and Command", async (t) => {
  if (!(await replicaReady(t))) return;
  const prefix = `u10-persist-${Date.now()}`;
  const execute = createIdempotentCanonicalCommandExecutor({
    store: {
      ...replicaStore(),
      async persist() {
        throw new Error("injected persist failure");
      },
    },
    connect: connectMongo,
    withTransaction,
  });
  const context = granotContext(prefix, "3".repeat(64));
  await assert.rejects(
    execute({
      command_name: "synchronizeLeadFromGranot",
      context,
      operation: async ({ session, now }) => {
        await insertDecision(context, session, now);
        const lead = await insertLead(prefix, session, now);
        return { entity_refs: [{ model: "FormLead", id: String(lead._id) }] };
      },
    }),
    /injected persist failure/,
  );
  const Decision = getSynchronizationDecisionModel();
  const decisions = await Decision.find({
    observation_id: context.provenance.observation_id,
  }).lean();
  const commands = await DomainCommandExecution.find({
    command_id: context.command_id,
  }).lean();
  const leads = await getFormLeadModel().find({ name: `U10 ${prefix}` }).lean();
  assert.equal(decisions.length, 0);
  assert.equal(commands.length, 0);
  assert.equal(leads.length, 0);
  await cleanup(prefix);
});

test("[AC-32] replica executor: post-commit finalize never runs on rollback", async (t) => {
  if (!(await replicaReady(t))) return;
  const prefix = `u10-finalize-${Date.now()}`;
  const context = granotContext(prefix, "4".repeat(64));
  let finalized = 0;
  await assert.rejects(
    executeCanonicalCommandWithPostCommit({
      command_name: "synchronizeLeadFromGranot",
      context,
      operation: async ({ session, now }) => {
        await insertDecision(context, session, now);
        const lead = await insertLead(prefix, session, now);
        throw new Error("rollback before finalize");
      },
      finalize: async () => {
        finalized += 1;
      },
    }),
    /rollback before finalize/,
  );
  assert.equal(finalized, 0);
  const Decision = getSynchronizationDecisionModel();
  const decisions = await Decision.find({
    observation_id: context.provenance.observation_id,
  }).lean();
  const commands = await DomainCommandExecution.find({
    command_id: context.command_id,
  }).lean();
  const leads = await getFormLeadModel().find({ name: `U10 ${prefix}` }).lean();
  assert.equal(decisions.length, 0);
  assert.equal(commands.length, 0);
  assert.equal(leads.length, 0);
  await cleanup(prefix);
});

test("[AC-32] replica executor: no Sheet/queue/email/CRM call occurs before commit", async (t) => {
  if (!(await replicaReady(t))) return;
  const prefix = `u10-boundary-${Date.now()}`;
  const execute = productionExecutor();
  const context = granotContext(prefix, "1".repeat(64));
  const effects: string[] = [];
  await assert.rejects(
    execute({
      command_name: "synchronizeLeadFromGranot",
      context,
      operation: async ({ session }) => {
        assert.equal(session.inTransaction(), true);
        effects.push("inside");
        throw new Error("rollback before finalize");
      },
    }),
    /rollback before finalize/,
  );
  assert.deepEqual(effects, ["inside"]);
  const commands = await DomainCommandExecution.find({
    command_id: context.command_id,
  }).lean();
  assert.equal(commands.length, 0);
  await cleanup(prefix);
});

function replicaStore() {
  return {
    async find(input: {
      origin: CanonicalCommandContext["provenance"]["origin"];
      idempotency_key: string;
      session?: mongoose.ClientSession;
    }) {
      const existing = await DomainCommandExecution.findOne({
        origin: input.origin,
        idempotency_key: input.idempotency_key,
      })
        .session(input.session ?? null)
        .lean()
        .exec();
      if (!existing) return null;
      return {
        command_name: existing.command_name,
        payload_checksum: existing.payload_checksum,
        result: {
          status: "applied" as const,
          entity_refs: (existing.result?.entity_refs ?? existing.entity_refs).map(
            (entry) => ({ model: entry.model, id: entry.id }),
          ),
          warnings: [...(existing.result?.warnings ?? existing.warnings ?? [])],
        },
      };
    },
    async persist(input: {
      command_name: string;
      context: CanonicalCommandContext;
      result: {
        status: "applied";
        entity_refs: Array<{ model: string; id: string }>;
        warnings: string[];
      };
      applied_at: Date;
      session: mongoose.ClientSession;
    }) {
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
}

function productionExecutor() {
  return createIdempotentCanonicalCommandExecutor({
    store: replicaStore(),
    connect: connectMongo,
    withTransaction,
  });
}

function granotContext(
  prefix: string,
  checksum: string,
): CanonicalCommandContext {
  const receiptId = `${prefix}-receipt`;
  return {
    command_id: `${prefix}-command`,
    idempotency_key: `${prefix}-key`,
    payload_checksum: checksum,
    actor: createGranotLifecycleProcessorActor(receiptId),
    initiator: createGranotWebhookInitiator(receiptId),
    provenance: {
      origin: "granot_lifecycle",
      run_id: `${prefix}-run`,
      source_receipt_id: receiptId,
      source_connection_key: "granot-source-1",
      observation_id: new mongoose.Types.ObjectId().toHexString(),
      decision_id: new mongoose.Types.ObjectId().toHexString(),
      observation_channel: "granot_webhook",
    },
  };
}

async function insertLead(
  prefix: string,
  session: mongoose.ClientSession,
  now: Date,
) {
  const FormLead = getFormLeadModel();
  const lead = new FormLead({
    name: `U10 ${prefix}`,
    phone_number: "5550000011",
    pickup_zip: "10001",
    destination_zip: "94105",
    move_size: "1 Bedroom",
    local: "long_distance",
    source_company: "main_site",
    timestamp: now,
    domain_revision: 0,
  });
  await lead.save({ session });
  return lead;
}

async function insertDecision(
  context: CanonicalCommandContext,
  session: mongoose.ClientSession,
  now: Date,
) {
  const Decision = getSynchronizationDecisionModel();
  await Decision.create(
    [
      {
        _id: new mongoose.Types.ObjectId(context.provenance.decision_id ?? undefined),
        observation_id: new mongoose.Types.ObjectId(
          context.provenance.observation_id ?? undefined,
        ),
        attempt: 1,
        execution_mode: "live_shadow",
        outcome: "applied",
        reason_code: "lead_state_changed",
        candidates: [],
        evaluated_gates: [],
        effects: [{ kind: "lead_updated" }],
        decided_at: now,
      },
    ],
    { session },
  );
}

async function cleanup(prefix: string): Promise<void> {
  await DomainCommandExecution.deleteMany({
    command_id: new RegExp(`^${prefix}`),
  });
  await getFormLeadModel().deleteMany({ name: new RegExp(`^U10 ${prefix}`) });
  void DECISION_COLLECTION;
  void COMMAND_COLLECTION;
}
