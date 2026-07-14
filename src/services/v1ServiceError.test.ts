import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./errors/AppError";
import { ERROR_CODES } from "./errors/errorCodes";
import { V1ServiceError } from "./v1ServiceError";

test("V1ServiceError preserves the original (message, statusCode = 400) constructor signature", () => {
  const defaultErr = new V1ServiceError("default status");
  assert.equal(defaultErr.message, "default status");
  assert.equal(defaultErr.statusCode, 400);

  const explicitErr = new V1ServiceError("explicit 404", 404);
  assert.equal(explicitErr.message, "explicit 404");
  assert.equal(explicitErr.statusCode, 404);
});

test("V1ServiceError is an AppError (single instanceof handles both legacy and typed throws)", () => {
  const err = new V1ServiceError("x", 409);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof AppError);
  assert.ok(err instanceof V1ServiceError);
});

test("V1ServiceError keeps its historical `name` so existing log filters match", () => {
  const err = new V1ServiceError("x", 400);
  assert.equal(err.name, "V1ServiceError");
});

test("V1ServiceError maps its statusCode onto a stable error code for logs", () => {
  assert.equal(new V1ServiceError("x").code, ERROR_CODES.BAD_REQUEST);
  assert.equal(new V1ServiceError("x", 400).code, ERROR_CODES.BAD_REQUEST);
  assert.equal(new V1ServiceError("x", 401).code, ERROR_CODES.UNAUTHORIZED);
  assert.equal(new V1ServiceError("x", 404).code, ERROR_CODES.NOT_FOUND);
  assert.equal(new V1ServiceError("x", 409).code, ERROR_CODES.CONFLICT);
  assert.equal(new V1ServiceError("x", 500).code, ERROR_CODES.INTERNAL);
  assert.equal(new V1ServiceError("x", 503).code, ERROR_CODES.INTERNAL);
});
