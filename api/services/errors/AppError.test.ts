import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./AppError";
import { ERROR_CODES } from "./errorCodes";

test("AppError defaults to INTERNAL code and 500 status when no options are given", () => {
  const err = new AppError("boom");

  assert.equal(err.message, "boom");
  assert.equal(err.code, ERROR_CODES.INTERNAL);
  assert.equal(err.statusCode, 500);
  assert.equal(err.name, "AppError");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof AppError);
});

test("AppError preserves code, statusCode, internalMessage, cause, and metadata from options", () => {
  const cause = new Error("upstream failure");
  const err = new AppError("Lead not found", {
    code: ERROR_CODES.NOT_FOUND,
    statusCode: 404,
    internalMessage: "FormLead.findById returned null for id=abc",
    cause,
    metadata: { resource: "form_lead", id: "abc" },
  });

  assert.equal(err.message, "Lead not found");
  assert.equal(err.code, ERROR_CODES.NOT_FOUND);
  assert.equal(err.statusCode, 404);
  assert.equal(err.internalMessage, "FormLead.findById returned null for id=abc");
  assert.deepEqual(err.metadata, { resource: "form_lead", id: "abc" });
  assert.equal((err as unknown as { cause?: unknown }).cause, cause);
});

test("AppError.toLog returns a safe, structured summary of public fields plus log-only context", () => {
  const cause = new Error("read ECONNRESET");
  const err = new AppError("Sheets sync failed", {
    code: ERROR_CODES.INTEGRATION,
    statusCode: 502,
    internalMessage: "sheets.spreadsheets.values.batchUpdate rejected",
    cause,
    metadata: { spreadsheetId: "abc", attempt: 3 },
  });

  const logged = err.toLog();
  assert.equal(logged.errorName, "AppError");
  assert.equal(logged.errorCode, ERROR_CODES.INTEGRATION);
  assert.equal(logged.statusCode, 502);
  assert.equal(logged.message, "Sheets sync failed");
  assert.equal(logged.internalMessage, "sheets.spreadsheets.values.batchUpdate rejected");
  assert.equal(logged.causeMessage, "read ECONNRESET");
  assert.deepEqual(logged.metadata, { spreadsheetId: "abc", attempt: 3 });
});

test("AppError.toLog omits cause/internalMessage/metadata when they are not provided", () => {
  const err = new AppError("boom", { statusCode: 500 });
  const logged = err.toLog();
  assert.equal(logged.errorName, "AppError");
  assert.equal(logged.errorCode, ERROR_CODES.INTERNAL);
  assert.equal(logged.statusCode, 500);
  assert.equal(logged.message, "boom");
  assert.ok(!("internalMessage" in logged));
  assert.ok(!("metadata" in logged));
  assert.ok(!("causeMessage" in logged));
});

test("AppError.toLog handles string causes and unserializable causes without throwing", () => {
  const stringCauseErr = new AppError("x", { cause: "io error" });
  assert.equal(stringCauseErr.toLog().causeMessage, "io error");

  const circular: { self?: unknown } = {};
  circular.self = circular;
  const circularCauseErr = new AppError("y", { cause: circular });
  // JSON.stringify throws on circular refs, so toLog should fall back to a
  // safe placeholder rather than re-throwing.
  assert.equal(
    circularCauseErr.toLog().causeMessage,
    "[unserializable cause]",
  );
});

test("AppError does NOT expose internalMessage or cause via its public message field", () => {
  const cause = new Error("secret upstream details");
  const err = new AppError("Public-safe message", {
    code: ERROR_CODES.INTERNAL,
    internalMessage: "Stack-y internal context with secrets",
    cause,
  });

  assert.equal(err.message, "Public-safe message");
  assert.ok(!/Stack-y/.test(err.message));
  assert.ok(!/secret upstream/.test(err.message));
});
