import assert from "node:assert/strict";
import { test } from "node:test";
import { acknowledgeWhenCredentialsRejected, isMongoCredentialRejection } from "./queueConsumerFailure";
import { ServiceUnavailableError } from "./services/errors";

/** The driver's SCRAM failure, as `connectMongo` wraps it (seen in production on November 20, 2026). */
function wrappedAuthFailure(): ServiceUnavailableError {
  const driverError = Object.assign(new Error("Authentication failed."), {
    name: "MongoServerError",
    code: 18,
    codeName: "AuthenticationFailed",
  });
  return new ServiceUnavailableError("Database temporarily unavailable. Please retry shortly.", {
    internalMessage: driverError.message,
    cause: driverError,
    metadata: { dependency: "mongodb" },
  });
}

test("a credential rejection wrapped by connectMongo is recognized and acknowledged", () => {
  const error = wrappedAuthFailure();
  assert.equal(isMongoCredentialRejection(error), true);
  assert.equal(acknowledgeWhenCredentialsRejected("sales_intelligence", error), true);
});

test("transient and unrelated failures still rethrow so the queue retries them", () => {
  const serverSelection = Object.assign(new Error("Server selection timed out"), { name: "MongoServerSelectionError" });
  const wrappedTransient = new ServiceUnavailableError("Database temporarily unavailable. Please retry shortly.", {
    cause: serverSelection,
    metadata: { dependency: "mongodb" },
  });
  for (const error of [
    wrappedTransient,
    serverSelection,
    new Error("Granot automation continuation could not be queued"),
    Object.assign(new Error("not authorized on vantagemovers"), { code: 13, codeName: "Unauthorized" }),
    null,
    "Authentication failed.",
  ]) {
    assert.equal(acknowledgeWhenCredentialsRejected("sheet_sync", error), false, String(error));
  }
});

test("a self-referencing cause chain terminates", () => {
  const error = new Error("loop") as Error & { cause?: unknown };
  error.cause = error;
  assert.equal(isMongoCredentialRejection(error), false);
});
