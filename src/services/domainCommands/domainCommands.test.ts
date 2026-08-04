import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ClientSession } from "mongoose";
import { DomainCommandExecution } from "../../models/DomainCommandExecution";
import {
  createIdempotentCanonicalCommandExecutor,
  executeIdempotentCanonicalCommand,
  persistActiveCanonicalCommandExecution,
  type CanonicalCommandExecutionStore,
  type StoredCanonicalCommandExecution,
} from "./idempotency";
import { createCallLead } from "./leads";
import {
  DomainCommandContextError,
  DomainCommandIdempotencyConflictError,
  type CanonicalCommandContext,
} from "./types";

test("command execution model has durable origin/idempotency uniqueness", () => {
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
        actor: {
          actor_type: "system",
          actor_id: "best-relocation-ingestion",
          actor_label: "Best Relocation ingestion",
          actor_role: "system",
          request_id: "request-1",
          origin: "external_sheet_ingestion",
        },
        initiator: {
          actor_type: "owner",
          actor_id: "owner-1",
          actor_label: "owner@example.com",
          actor_role: "owner",
          request_id: "request-1",
          origin: "vantage_admin",
        },
        provenance: {
          origin: "external_sheet_ingestion",
          run_id: "run-1",
          source_receipt_id: "receipt-1",
          source_connection_key: "best-relocation",
        },
      },
      operation: async () => null,
      project: () => ({ entity_refs: [] }),
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
  });
  await assert.rejects(
    execute({
      command_name: "createCallLead",
      context,
      operation: async () => undefined,
      project: () => ({ entity_refs: [] }),
    }),
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

test("command replay returns original outcome and checksum reuse conflicts", async () => {
  const records = new Map<string, StoredCanonicalCommandExecution>();
  const store = memoryExecutionStore(records);
  const execute = createIdempotentCanonicalCommandExecutor({
    store,
    connect: async () => undefined,
  });
  const context = commandContext("a".repeat(64));
  let mutations = 0;
  const run = () =>
    execute({
      command_name: "createCallLead",
      context,
      operation: async () => {
        mutations += 1;
        await persistActiveCanonicalCommandExecution(
          { id: "lead-1" },
          {} as ClientSession,
        );
      },
      project: () => ({
        entity_refs: [{ model: "CallLead", id: "lead-1" }],
      }),
    });

  assert.deepEqual(await run(), {
    status: "applied",
    entity_refs: [{ model: "CallLead", id: "lead-1" }],
    warnings: [],
  });
  assert.deepEqual(await run(), {
    status: "already_applied",
    entity_refs: [{ model: "CallLead", id: "lead-1" }],
    warnings: [],
  });
  assert.equal(mutations, 1);

  await assert.rejects(
    execute({
      command_name: "createCallLead",
      context: commandContext("b".repeat(64)),
      operation: async () => undefined,
      project: () => ({ entity_refs: [] }),
    }),
    DomainCommandIdempotencyConflictError,
  );
});

test("failed command leaves no successful execution outcome", async () => {
  const records = new Map<string, StoredCanonicalCommandExecution>();
  const execute = createIdempotentCanonicalCommandExecutor({
    store: memoryExecutionStore(records),
    connect: async () => undefined,
  });
  await assert.rejects(
    execute({
      command_name: "createFormLead",
      context: commandContext("c".repeat(64)),
      operation: async () => {
        throw new Error("transaction aborted");
      },
      project: () => ({ entity_refs: [] }),
    }),
    /transaction aborted/,
  );
  assert.equal(records.size, 0);
});

test("canonical command modules do not depend on transport or Google adapters", async () => {
  for (const file of [
    "leads.ts",
    "bookings.ts",
    "cancellations.ts",
    "idempotency.ts",
  ]) {
    const source = await readFile(
      path.join(__dirname, file),
      "utf8",
    );
    assert.doesNotMatch(source, /from\s+["']express["']/);
    assert.doesNotMatch(source, /googleapis|google-spreadsheet|reporting/i);
    assert.doesNotMatch(
      source,
      /bestRelocationSheetIngest|ingestion\/(parser|planner)/i,
    );
  }
});

function commandContext(
  payloadChecksum: string,
): CanonicalCommandContext {
  return {
    command_id: "command-1",
    idempotency_key: "source-row-1:create-call",
    payload_checksum: payloadChecksum,
    actor: {
      actor_type: "system",
      actor_id: "best-relocation-ingestion",
      actor_label: "Best Relocation ingestion",
      actor_role: "system",
      request_id: "request-1",
      origin: "external_sheet_ingestion",
    },
    initiator: {
      actor_type: "owner",
      actor_id: "owner-1",
      actor_label: "owner@example.com",
      actor_role: "owner",
      request_id: "request-1",
      origin: "vantage_admin",
    },
    provenance: {
      origin: "external_sheet_ingestion",
      run_id: "run-1",
      source_receipt_id: "receipt-1",
      source_connection_key: "best-relocation",
    },
  };
}

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
          entity_refs: input.result.entity_refs,
          warnings: input.result.warnings,
        },
      );
    },
  };
}
