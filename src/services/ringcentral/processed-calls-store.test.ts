import assert from "node:assert/strict";
import test from "node:test";
import {
  processedCallIdentityKey,
  reconcileProcessedCallIndexes,
  RINGCENTRAL_PROCESSED_CALL_LOG_ID_UNIQUE_INDEX,
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
