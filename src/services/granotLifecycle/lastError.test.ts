import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyTechnicalFailureCode, sanitizeLastError } from "./lastError";

const now = new Date("2026-08-17T16:00:00.000Z");

test("[AC-35] portion last_error strips payload, credentials, and contact text", () => {
  const sanitized = sanitizeLastError(
    Object.assign(new Error("mongodb://user:pass@host/payload phone 555-0100"), {
      code: "transaction_failure",
    }),
    now,
  );
  assert.equal(sanitized.code, "transaction_failure");
  assert.equal(sanitized.message, "Technical processing failure");
  assert.equal(sanitized.failed_at.toISOString(), now.toISOString());
});

test("[AC-35] portion last_error keeps a bounded safe code and short message", () => {
  const sanitized = sanitizeLastError(
    Object.assign(new Error("Replica set write conflict"), {
      code: "dependency_failure",
    }),
    now,
  );
  assert.equal(sanitized.code, "dependency_failure");
  assert.equal(sanitized.message, "Replica set write conflict");
});

test("unknown error codes collapse to a bounded technical class", () => {
  assert.equal(
    classifyTechnicalFailureCode(Object.assign(new Error("boom"), { code: "E11000" })),
    "dependency_failure",
  );
  assert.equal(
    classifyTechnicalFailureCode(new Error("TransientTransactionError")),
    "transaction_failure",
  );
});
