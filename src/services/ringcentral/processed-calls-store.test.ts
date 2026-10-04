import assert from "node:assert/strict";
import test from "node:test";
import {
  processedCallIdentityKey,
  reconcileProcessedCallIndexes,
  RINGCENTRAL_PROCESSED_CALL_INDEXES,
  RINGCENTRAL_PROCESSED_CALL_LOG_ID_UNIQUE_INDEX,
  RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES,
} from "./processed-calls-store";

test("[AC-14] telephony session wins over call-log identity", () => {
  assert.deepEqual(
    processedCallIdentityKey({
      telephonySessionId: "synthetic-session",
      callLogId: "synthetic-log",
    }),
    { telephonySessionId: "synthetic-session" },
  );
  assert.deepEqual(
    processedCallIdentityKey({
      telephonySessionId: null,
      callLogId: "synthetic-log",
    }),
    { callLogId: "synthetic-log" },
  );
  assert.equal(
    processedCallIdentityKey({
      telephonySessionId: null,
      callLogId: null,
    }),
    null,
  );
});

test("[AC-14] adoption statuses are terminal replay outcomes", () => {
  assert.ok(
    RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES.includes("lead_adopted"),
  );
  assert.ok(
    RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES.includes(
      "lead_adopted_duplicate",
    ),
  );
});

test("[AC-14] call-log race fence is declared unique and sparse", () => {
  assert.deepEqual(RINGCENTRAL_PROCESSED_CALL_LOG_ID_UNIQUE_INDEX, {
    name: "ringcentral_processed_call_log_id_unique",
    key: { callLogId: 1 },
    unique: true,
    sparse: true,
  });
});

function namespaceNotFound(): Error {
  return Object.assign(new Error("ns does not exist"), {
    code: 26,
    codeName: "NamespaceNotFound",
  });
}

function fakeIndexCollection(
  indexes: () => Promise<
    Array<{ name?: string; key: Record<string, unknown>; unique?: boolean; sparse?: boolean }>
  >,
) {
  const created: Array<{ key: Record<string, 1 | -1>; options: { name: string; unique?: boolean; sparse?: boolean } }> = [];
  const dropped: string[] = [];
  return {
    created,
    dropped,
    collection: {
      indexes,
      dropIndex: async (name: string) => {
        dropped.push(name);
      },
      createIndex: async (
        key: Record<string, 1 | -1>,
        options: { name: string; unique?: boolean; sparse?: boolean },
      ) => {
        created.push({ key, options });
        return options.name;
      },
    },
  };
}

test("test runner builds every processed-call index when the collection does not exist yet", async () => {
  const fake = fakeIndexCollection(async () => {
    throw namespaceNotFound();
  });
  await reconcileProcessedCallIndexes(fake.collection, { testRunner: true });
  assert.deepEqual(
    fake.created.map((row) => row.options.name),
    RINGCENTRAL_PROCESSED_CALL_INDEXES.map((index) => index.name),
  );
  assert.deepEqual(fake.dropped, []);
});

test("outside the test runner a missing collection reports the indexes as not predeployed", async () => {
  const fake = fakeIndexCollection(async () => {
    throw namespaceNotFound();
  });
  await assert.rejects(
    reconcileProcessedCallIndexes(fake.collection, { testRunner: false }),
    /RingCentral processed-call indexes are not predeployed\./,
  );
  assert.deepEqual(fake.created, []);
});

test("outside the test runner predeployed indexes pass and other listing errors propagate", async () => {
  const ready = fakeIndexCollection(async () => [
    { name: "_id_", key: { _id: 1 } },
    ...RINGCENTRAL_PROCESSED_CALL_INDEXES.map((index) => ({
      name: index.name,
      key: index.key,
      unique: "unique" in index ? index.unique : undefined,
      sparse: "sparse" in index ? index.sparse : undefined,
    })),
  ]);
  await reconcileProcessedCallIndexes(ready.collection, { testRunner: false });
  assert.deepEqual(ready.created, []);

  const denied = fakeIndexCollection(async () => {
    throw Object.assign(new Error("not authorized"), { code: 13, codeName: "Unauthorized" });
  });
  await assert.rejects(
    reconcileProcessedCallIndexes(denied.collection, { testRunner: false }),
    /not authorized/,
  );
});
