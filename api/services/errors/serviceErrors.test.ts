import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "./AppError";
import { ERROR_CODES } from "./errorCodes";
import {
  BadRequestError,
  ConflictError,
  IntegrationError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./serviceErrors";

test("BadRequestError defaults to 400 and BAD_REQUEST code", () => {
  const err = new BadRequestError("bad input");
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, ERROR_CODES.BAD_REQUEST);
  assert.equal(err.message, "bad input");
});

test("ValidationError defaults to 400 and VALIDATION code", () => {
  const err = new ValidationError("invalid source_company", {
    metadata: { field: "source_company" },
  });
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, ERROR_CODES.VALIDATION);
  assert.deepEqual(err.metadata, { field: "source_company" });
});

test("UnauthorizedError defaults to 401 and UNAUTHORIZED code", () => {
  const err = new UnauthorizedError("nope");
  assert.equal(err.statusCode, 401);
  assert.equal(err.code, ERROR_CODES.UNAUTHORIZED);
});

test("NotFoundError defaults to 404 and NOT_FOUND code", () => {
  const err = new NotFoundError("lead not found");
  assert.equal(err.statusCode, 404);
  assert.equal(err.code, ERROR_CODES.NOT_FOUND);
});

test("ConflictError defaults to 409 and CONFLICT code", () => {
  const err = new ConflictError("has a booking");
  assert.equal(err.statusCode, 409);
  assert.equal(err.code, ERROR_CODES.CONFLICT);
});

test("IntegrationError defaults to 502 and INTEGRATION code", () => {
  const err = new IntegrationError("CRM down");
  assert.equal(err.statusCode, 502);
  assert.equal(err.code, ERROR_CODES.INTEGRATION);
});

test("subclasses allow callers to override the default statusCode without losing the code", () => {
  const err = new ConflictError("custom conflict", { statusCode: 422 });
  assert.equal(err.statusCode, 422);
  assert.equal(err.code, ERROR_CODES.CONFLICT);
});

test("subclasses carry their constructor name (useful for log filters)", () => {
  assert.equal(new NotFoundError("x").name, "NotFoundError");
  assert.equal(new ConflictError("x").name, "ConflictError");
  assert.equal(new ValidationError("x").name, "ValidationError");
  assert.equal(new UnauthorizedError("x").name, "UnauthorizedError");
  assert.equal(new BadRequestError("x").name, "BadRequestError");
  assert.equal(new IntegrationError("x").name, "IntegrationError");
});

test("subclasses are all instanceof AppError and Error", () => {
  for (const err of [
    new BadRequestError("a"),
    new ValidationError("b"),
    new UnauthorizedError("c"),
    new NotFoundError("d"),
    new ConflictError("e"),
    new IntegrationError("f"),
  ]) {
    assert.ok(err instanceof Error);
    assert.ok(err instanceof AppError);
  }
});
