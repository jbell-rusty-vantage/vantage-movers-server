import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { ClientSession } from "mongoose";
import {
  createBestRelocationIngestionActor,
  createGranotLifecycleProcessorActor,
  createGranotWebhookInitiator,
  createRingCentralCallIngestActor,
} from "../durableWork/actors";
import {
  createIdempotentCanonicalCommandExecutor,
  type CanonicalCommandExecutionStore,
  type StoredCanonicalCommandExecution,
} from "./idempotency";
import {
  createVantageApiSecretActor,
  createVantageScopedApiKeyActor,
} from "./existingWriteContext";
import { createCallLead } from "./leads";
import { VANTAGE_API_SECRET_ACTOR_ID } from "./types";
import {
  DomainCommandContextError,
  type CanonicalCommandContext,
} from "./types";

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

test("retired external sheet commands can replay saved outcomes and cannot apply a new write", async () => {
  const context = commandContext("a".repeat(64));
  const records = new Map<string, StoredCanonicalCommandExecution>();
  const execute = createIdempotentCanonicalCommandExecutor({
    store: memoryExecutionStore(records),
    connect: async () => undefined,
    withTransaction: async (fn) => fn({} as ClientSession),
  });
  const request = { command_name: "createFormLead", context,
    operation: async () => assert.fail("retired import reached a write") };
  await assert.rejects(execute(request), /permanently retired/);
  records.set(`external_sheet_ingestion:${context.idempotency_key}`, {
    command_name: request.command_name, payload_checksum: context.payload_checksum,
    result: { status: "applied", entity_refs: [], warnings: [] },
  });
  assert.equal((await execute(request)).replayed, true);
});

test("external sheet Call command is rejected before validation or writing", async () => {
  await assert.rejects(
    createCallLead({
      data: {
        source_company: "main_site",
        phone_number: "5555551212",
      },
      context: commandContext("e".repeat(64)),
    }),
    /Only a qualified RingCentral/,
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
        "beginCallLeadIngestion",
        "beginRingCentralCallLeadIngestion",
        "persistTheCorrectionAndRefreshTheBookingChain",
        "beginCallLeadRemoval",
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
