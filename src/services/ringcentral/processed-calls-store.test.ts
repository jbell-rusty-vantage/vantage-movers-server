import assert from "node:assert/strict";
import test from "node:test";
import {
  processedCallIdentityKey,
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
