import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ClientSession } from "mongoose";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import {
  createBestRelocationIngestionActor,
  createGranotLifecycleProcessorActor,
  createGranotWebhookInitiator,
  createRingCentralCallIngestActor,
} from "../durableWork/actors";
import {
  createIdempotentCanonicalCommandExecutor,
  executeIdempotentCanonicalCommand,
  type CanonicalCommandExecutionStore,
  type StoredCanonicalCommandExecution,
} from "./idempotency";
import {
  createVantageApiSecretActor,
  createVantageScopedApiKeyActor,
} from "./existingWriteContext";
import { createCallLead } from "./leads";
import {
  VANTAGE_API_SECRET_ACTOR_ID,
} from "./types";
import {
  assertOwnerCommandIdempotencyKey,
  DomainCommandContextError,
  DomainCommandIdempotencyConflictError,
  toCompatibilityCanonicalCommandResult,
  type CanonicalCommandContext,
} from "./types";

test("[AC-21] command execution model has durable origin/idempotency uniqueness", () => {
  const uniqueIndex = DomainCommandExecution.schema
    .indexes()
    .find((entry: unknown) => {
      const [fields, options] = entry as [
        Record<string, unknown>,
        { unique?: boolean },
      ];
      return (
        fields.origin === 1 &&
        fields.idempotency_key === 1 &&
        options.unique === true
      );
    });
  assert.ok(uniqueIndex);
});

test("invalid command context fails before database access", async () => {
  await assert.rejects(
    executeIdempotentCanonicalCommand({
      command_name: "test",
      context: {
        command_id: "",
        idempotency_key: "",
        payload_checksum: "not-a-checksum",
        actor: createBestRelocationIngestionActor("request-1"),
        initiator: trustedOwner("request-1"),
        provenance: {
          origin: "external_sheet_ingestion",
          run_id: "run-1",
          source_receipt_id: "receipt-1",
          source_connection_key: "best-relocation",
        },
      },
      operation: async () => ({ entity_refs: [] }),
    }),
    DomainCommandContextError,
  );
});

test("external ingestion rejects human executors and incomplete provenance", async () => {
  const context = commandContext("d".repeat(64));
  context.actor = context.initiator;
  context.provenance.source_receipt_id = null;
  const execute = createIdempotentCanonicalCommandExecutor({
    store: memoryExecutionStore(new Map()),
    connect: async () => undefined,
    withTransaction: async (fn) => fn({} as ClientSession),
  });
  await assert.rejects(
    execute({
      command_name: "createCallLead",
      context,
      operation: async () => ({ entity_refs: [] }),
    }),
    DomainCommandContextError,
  );
});

test("[AC-21] four origins validate exactly; Granot and RingCentral identities cannot be client-forged", async () => {
  const execute = createIdempotentCanonicalCommandExecutor({
    store: memoryExecutionStore(new Map()),
    connect: async () => undefined,
    withTransaction: async (fn) => fn({} as ClientSession),
    contextVerifier: {
      verifyRingCentralTelephony: async () => false,
    },
  });
  await assert.rejects(
    execute({
      command_name: "synchronizeLeadFromGranot",
      context: {
        ...granotContext("a".repeat(64)),
        actor: trustedOwner("receipt-1"),
      },
      operation: async () => ({ entity_refs: [] }),
    }),
    DomainCommandContextError,
  );
  await assert.rejects(
    execute({
      command_name: "adoptRingCentralCall",
      context: ringcentralContext("b".repeat(64)),
      operation: async () => ({ entity_refs: [] }),
    }),
    /server-verified telephony provenance/,
  );
  const adminExecute = createIdempotentCanonicalCommandExecutor({
    store: memoryExecutionStore(new Map()),
    connect: async () => undefined,
    withTransaction: async (fn) => fn({} as ClientSession),
  });
  const applied = await adminExecute({
    command_name: "adminPatch",
    context: adminContext("c".repeat(64)),
    operation: async () => ({
      entity_refs: [{ model: "FormLead", id: "lead-admin" }],
    }),
  });
  assert.equal(applied.result.status, "applied");
  assert.equal(applied.replayed, false);
});

test("[AC-21] replay returns stored applied result; checksum reuse conflicts; compatibility adapter is one-way", async () => {
  const records = new Map<string, StoredCanonicalCommandExecution>();
  const store = memoryExecutionStore(records);
  const execute = createIdempotentCanonicalCommandExecutor({
    store,
    connect: async () => undefined,
    withTransaction: async (fn) => fn({} as ClientSession),
  });
  const context = commandContext("a".repeat(64));
  let mutations = 0;
  const run = () =>
    execute({
      command_name: "createCallLead",
      context,
      operation: async ({ session, now }) => {
        assert.ok(session);
        assert.ok(now instanceof Date);
        mutations += 1;
        return {
          entity_refs: [{ model: "CallLead", id: "lead-1" }],
        };
      },
    });

  const first = await run();
  assert.deepEqual(first.result, {
    status: "applied",
    entity_refs: [{ model: "CallLead", id: "lead-1" }],
    warnings: [],
  });
  assert.equal(first.replayed, false);
  const replay = await run();
  assert.deepEqual(replay.result, first.result);
  assert.equal(replay.replayed, true);
  assert.equal(mutations, 1);
  assert.deepEqual(toCompatibilityCanonicalCommandResult(replay), {
    status: "already_applied",
    entity_refs: [{ model: "CallLead", id: "lead-1" }],
    warnings: [],
  });

  await assert.rejects(
    execute({
      command_name: "createCallLead",
      context: commandContext("b".repeat(64)),
      operation: async () => ({ entity_refs: [] }),
    }),
    DomainCommandIdempotencyConflictError,
  );
});

test("[AC-21] failed command leaves no successful execution outcome", async () => {
  const records = new Map<string, StoredCanonicalCommandExecution>();
  const execute = createIdempotentCanonicalCommandExecutor({
    store: memoryExecutionStore(records),
    connect: async () => undefined,
    withTransaction: async (fn) => fn({} as ClientSession),
  });
  await assert.rejects(
    execute({
      command_name: "createFormLead",
      context: commandContext("c".repeat(64)),
      operation: async () => {
        throw new Error("transaction aborted");
      },
    }),
    /transaction aborted/,
  );
  assert.equal(records.size, 0);
});

test("[AC-21] stable now and preallocated IDs survive a transaction callback retry", async () => {
  const seen: Array<{ now: Date; commandId: string; decisionId?: string | null }> =
    [];
  const execute = createIdempotentCanonicalCommandExecutor({
    store: {
      async find() {
        return null;
      },
      async persist() {
        return undefined;
      },
    },
    connect: async () => undefined,
    now: () => new Date("2026-08-17T21:00:00.000Z"),
    withTransaction: async (fn) => {
      const session = { id: "retry-session" } as unknown as ClientSession;
      await fn(session);
      return fn(session);
    },
    contextVerifier: {
      verifyRingCentralTelephony: async () => true,
    },
  });
  const context = granotContext("e".repeat(64));
  await execute({
    command_name: "synchronizeLeadFromGranot",
    context,
    operation: async ({ now }) => {
      seen.push({
        now,
        commandId: context.command_id,
        decisionId: context.provenance.decision_id,
      });
      if (seen.length === 1) {
        return { entity_refs: [{ model: "FormLead", id: "lead-retry" }] };
      }
      return { entity_refs: [{ model: "FormLead", id: "lead-retry" }] };
    },
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0]?.now.toISOString(), seen[1]?.now.toISOString());
  assert.equal(seen[0]?.commandId, "command-granot-1");
  assert.equal(seen[0]?.decisionId, "decision-1");
});

test("[AC-32] observation_channel must agree with the initiator path", async () => {
  const execute = createIdempotentCanonicalCommandExecutor({
    store: memoryExecutionStore(new Map()),
    connect: async () => undefined,
    withTransaction: async (fn) => fn({} as ClientSession),
  });
  const context = granotContext("f".repeat(64));
  context.provenance.observation_channel = "browser_extension";
  await assert.rejects(
    execute({
      command_name: "synchronizeLeadFromGranot",
      context,
      operation: async () => ({ entity_refs: [] }),
    }),
    /observation_channel granot_webhook/,
  );
});

test("[AC-21] compatibility API-secret and scoped-key system actors validate for vantage_admin", async () => {
  const execute = createIdempotentCanonicalCommandExecutor({
    store: memoryExecutionStore(new Map()),
    connect: async () => undefined,
    withTransaction: async (fn) => fn({} as ClientSession),
  });
  const secretActor = createVantageApiSecretActor("req-secret");
  const secretApplied = await execute({
    command_name: "createFormLead",
    context: {
      command_id: "cmd-secret",
      idempotency_key: "key-secret",
      payload_checksum: "d".repeat(64),
      actor: secretActor,
      initiator: secretActor,
      provenance: {
        origin: "vantage_admin",
        run_id: null,
        source_receipt_id: null,
        source_connection_key: null,
      },
    },
    operation: async () => ({
      entity_refs: [{ model: "FormLead", id: "lead-secret" }],
    }),
  });
  assert.equal(secretApplied.result.status, "applied");
  assert.equal(secretActor.actor_id, VANTAGE_API_SECRET_ACTOR_ID);
  const scopedActor = createVantageScopedApiKeyActor({
    requestId: "req-scoped",
    fingerprint: "ab".repeat(16),
  });
  const scopedApplied = await execute({
    command_name: "createFormLead",
    context: {
      command_id: "cmd-scoped",
      idempotency_key: "key-scoped",
      payload_checksum: "e".repeat(64),
      actor: scopedActor,
      initiator: scopedActor,
      provenance: {
        origin: "vantage_admin",
        run_id: null,
        source_receipt_id: null,
        source_connection_key: null,
      },
    },
    operation: async () => ({
      entity_refs: [{ model: "FormLead", id: "lead-scoped" }],
    }),
  });
  assert.equal(scopedApplied.result.status, "applied");
  await assert.rejects(
    execute({
      command_name: "createFormLead",
      context: {
        command_id: "cmd-forged",
        idempotency_key: "key-forged",
        payload_checksum: "f".repeat(64),
        actor: {
          actor_type: "system",
          actor_id: "forged-system",
          actor_label: "Forged",
          actor_role: "system",
          request_id: "req-forged",
          origin: "vantage_admin",
        },
        initiator: {
          actor_type: "system",
          actor_id: "forged-system",
          actor_label: "Forged",
          actor_role: "system",
          request_id: "req-forged",
          origin: "vantage_admin",
        },
        provenance: {
          origin: "vantage_admin",
          run_id: null,
          source_receipt_id: null,
          source_connection_key: null,
        },
      },
      operation: async () => ({ entity_refs: [] }),
    }),
    DomainCommandContextError,
  );
});

test("owner idempotency key helper preserves the 8-200 printable envelope", () => {
  assertOwnerCommandIdempotencyKey("case-key-1");
  assert.throws(
    () => assertOwnerCommandIdempotencyKey(" short"),
    DomainCommandContextError,
  );
  assert.throws(
    () => assertOwnerCommandIdempotencyKey("abc"),
    DomainCommandContextError,
  );
});

test("call-lead command validates DTO without an unsupported ingestion field", async () => {
  await assert.rejects(
    createCallLead({
      data: {
        source_company: "main_site",
        phone_number: "5555551212",
      },
      context: commandContext("e".repeat(64)),
    }),
    /restricted to best_relocation_leads/,
  );
});

test("[AC-21] transaction-bound internals do not open nested transactions or finalize Sheets", async () => {
  const files: Array<{ file: string; names: string[] }> = [
    {
      file: path.join(__dirname, "../leads/formLead.service.ts"),
      names: [
        "beginFormLeadIngestion",
        "persistTheCorrectionAndRefreshTheBookingChain",
        "beginFormLeadRemoval",
        "createFormLeadInTransaction",
        "persistFormLeadUpdateInTransaction",
        "updateFormLeadInTransaction",
        "deleteFormLeadInTransaction",
      ],
    },
    {
      file: path.join(__dirname, "../leads/callLead.service.ts"),
      names: [
        "createCallLeadInTransaction",
        "createRingCentralCallLeadInTransaction",
        "persistCallLeadUpdateInTransaction",
        "updateCallLeadInTransaction",
        "deleteCallLeadInTransaction",
      ],
    },
    {
      file: path.join(__dirname, "../bookings/bookedLead.service.ts"),
      names: [
        "createBookedLeadInTransaction",
        "persistBookedLeadCreateInTransaction",
        "updateBookedLeadInTransaction",
        "deleteBookedLeadInTransaction",
      ],
    },
    {
      file: path.join(__dirname, "../bookings/leadlessBooking.service.ts"),
      names: [
        "createLeadlessBookingInTransaction",
        "persistLeadlessBookingCreateInTransaction",
      ],
    },
    {
      file: path.join(__dirname, "../cancellations/cancelledLead.service.ts"),
      names: [
        "createCancelledLeadInTransaction",
        "persistCancelledLeadCreateInTransaction",
        "updateCancelledLeadInTransaction",
        "deleteCancelledLeadInTransaction",
      ],
    },
    {
      file: path.join(__dirname, "../bookings/referralBooking.service.ts"),
      names: ["createReferralBookingInTransaction"],
    },
    {
      file: path.join(__dirname, "../bookings/bookedLeadFromSource.service.ts"),
      names: ["createBookedLeadFromSourceInTransaction"],
    },
    {
      file: path.join(
        __dirname,
        "../employeeBookings/bookingLeadReconciliation.service.ts",
      ),
      names: [
        "resolveBookingLeadReconciliationInTransaction",
        "persistBookingLeadReconciliationResolveInTransaction",
      ],
    },
  ];
  for (const entry of files) {
    const source = await readFile(entry.file, "utf8");
    for (const name of entry.names) {
      const body = extractExportedFunction(source, name);
      const transactionBody = body.split(/finalize:\s*async/)[0] ?? body;
      assert.doesNotMatch(transactionBody, /withTransaction\s*\(/);
      assert.doesNotMatch(transactionBody, /runSheetSyncWrite\s*\(/);
      assert.doesNotMatch(transactionBody, /finalizeSheetSync(?:Delete)?\s*\(/);
    }
  }
});

test("canonical command modules do not depend on transport or Google adapters", async () => {
  for (const file of [
    "leads.ts",
    "bookings.ts",
    "cancellations.ts",
    "idempotency.ts",
  ]) {
    const source = await readFile(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(source, /from\s+["']express["']/);
    assert.doesNotMatch(source, /googleapis|google-spreadsheet|reporting/i);
    assert.doesNotMatch(
      source,
      /bestRelocationSheetIngest|ingestion\/(parser|planner)/i,
    );
  }
});

test("durable actor factories mint the fixed Granot and RingCentral identities", () => {
  const processor = createGranotLifecycleProcessorActor("receipt-1");
  assert.equal(processor.actor_id, "granot-lifecycle-processor");
  assert.equal(processor.origin, "granot_lifecycle");
  const webhook = createGranotWebhookInitiator("receipt-1");
  assert.equal(webhook.actor_id, "granot-webhook");
  const rc = createRingCentralCallIngestActor("session-1");
  assert.equal(rc.actor_id, "ringcentral-call-ingest");
  assert.equal(rc.origin, "ringcentral");
});

function trustedOwner(requestId: string) {
  return {
    actor_type: "owner" as const,
    actor_id: "owner-1",
    actor_label: "owner@example.com",
    actor_role: "owner" as const,
    request_id: requestId,
    origin: "vantage_admin" as const,
  };
}

function commandContext(payloadChecksum: string): CanonicalCommandContext {
  return {
    command_id: "command-1",
    idempotency_key: "source-row-1:create-call",
    payload_checksum: payloadChecksum,
    actor: createBestRelocationIngestionActor("request-1"),
    initiator: trustedOwner("request-1"),
    provenance: {
      origin: "external_sheet_ingestion",
      run_id: "run-1",
      source_receipt_id: "receipt-1",
      source_connection_key: "best-relocation",
    },
  };
}

function adminContext(payloadChecksum: string): CanonicalCommandContext {
  return {
    command_id: "command-admin-1",
    idempotency_key: "admin-key-1",
    payload_checksum: payloadChecksum,
    actor: trustedOwner("admin-request"),
    initiator: trustedOwner("admin-request"),
    provenance: {
      origin: "vantage_admin",
      run_id: null,
      source_receipt_id: null,
      source_connection_key: null,
    },
  };
}

function granotContext(payloadChecksum: string): CanonicalCommandContext {
  return {
    command_id: "command-granot-1",
    idempotency_key: "granot-key-1",
    payload_checksum: payloadChecksum,
    actor: createGranotLifecycleProcessorActor("receipt-1"),
    initiator: createGranotWebhookInitiator("receipt-1"),
    provenance: {
      origin: "granot_lifecycle",
      run_id: "run-1",
      source_receipt_id: "receipt-1",
      source_connection_key: "granot-source-1",
      observation_id: "observation-1",
      decision_id: "decision-1",
      observation_channel: "granot_webhook",
    },
  };
}

function ringcentralContext(payloadChecksum: string): CanonicalCommandContext {
  return {
    command_id: "command-rc-1",
    idempotency_key: "rc-key-1",
    payload_checksum: payloadChecksum,
    actor: createRingCentralCallIngestActor("session-1"),
    initiator: createRingCentralCallIngestActor("session-1"),
    provenance: {
      origin: "ringcentral",
      run_id: "rc-run-1",
      source_receipt_id: "session-1",
      source_connection_key: "ringcentral",
    },
  };
}

function extractExportedFunction(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `missing ${name}`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

test("[AC-32] existing write context factory hashes payload and never stores credentials", () => {
  const secretActor = createVantageApiSecretActor("req-1");
  assert.equal(secretActor.actor_id, VANTAGE_API_SECRET_ACTOR_ID);
  assert.equal(secretActor.origin, "vantage_admin");
  const scoped = createVantageScopedApiKeyActor({
    requestId: "req-2",
    fingerprint: "ab".repeat(16),
  });
  assert.match(scoped.actor_id, /^vantage-scoped-api-key:[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(scoped).includes("super-secret-key"), false);
});

test("[AC-32] v1 write routes enter existing adapters and do not patch models", async () => {
  const source = await readFile(
    path.join(__dirname, "../../routes/v1.routes.ts"),
    "utf8",
  );
  for (const name of [
    "runExistingCreateFormLead",
    "runExistingCreateCallLead",
    "runExistingUpdateSourceOwnedLead",
    "runExistingCreateBookingFromLead",
    "runExistingCreateBookedLeadFromSource",
    "runExistingCreateReferralBooking",
    "runExistingCreateLeadlessBooking",
    "runExistingUpdateBookedLead",
    "runExistingCreateCancellation",
    "runExistingUpdateCancelledLead",
    "runExistingDeleteFormLead",
    "runExistingDeleteCallLead",
    "runExistingDeleteBookedLead",
    "runExistingDeleteCancelledLead",
    "existingWriteContextFromRequest",
  ]) {
    assert.match(source, new RegExp(name));
  }
  assert.doesNotMatch(source, /FormLead\.findByIdAndUpdate|BookedLead\.create\(/);
  assert.doesNotMatch(
    source,
    /synchronizeLeadFromGranot|createLeadFromGranot|establishGranotRecordLink|correctGranotRecordLink/,
  );
});

test("[AC-32] existing write adapters persist Changes inside the executor and keep later commands disabled", async () => {
  const source = await readFile(path.join(__dirname, "existingWrites.ts"), "utf8");
  assert.match(source, /persistEntityChangeMutations|persistPlannedMutations/);
  assert.match(source, /executeCanonicalCommandWithPostCommit/);
  assert.doesNotMatch(source, /withTransaction\s*\(/);
  assert.doesNotMatch(source, /runSheetSyncWrite\s*\(/);
  assert.doesNotMatch(
    source,
    /synchronizeLeadFromGranot|createLeadFromGranot|updateBooking\b|establishGranotRecordLink/,
  );
});

function memoryExecutionStore(
  records: Map<string, StoredCanonicalCommandExecution>,
): CanonicalCommandExecutionStore {
  return {
    async find(input) {
      return records.get(`${input.origin}:${input.idempotency_key}`) ?? null;
    },
    async persist(input) {
      records.set(
        `${input.context.provenance.origin}:${input.context.idempotency_key}`,
        {
          command_name: input.command_name,
          payload_checksum: input.context.payload_checksum,
          result: input.result,
        },
      );
    },
  };
}
