import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  deleteGranotWebhookBodySecret,
  evaluateGranotWebhookAuthentication,
  getGranotWebhookAuth,
  requireGranotWebhookSecret,
} from "./requireGranotWebhookSecret";

const SYNTHETIC_SECRET = "synthetic-expected-secret";
const originalSecret = process.env.GRANOT_WEBHOOK_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.GRANOT_WEBHOOK_SECRET;
  } else {
    process.env.GRANOT_WEBHOOK_SECRET = originalSecret;
  }
});

test("[AC-01] both valid secrets store header_secret and still validate the body", () => {
  const evaluated = evaluateGranotWebhookAuthentication(
    SYNTHETIC_SECRET,
    { kind: "present", value: SYNTHETIC_SECRET },
    { kind: "present", value: SYNTHETIC_SECRET },
  );
  assert.deepEqual(evaluated, {
    ok: true,
    authentication_method: "header_secret",
    validated_header: true,
    validated_body: true,
  });
});

test("[AC-01] one valid form authenticates; missing, wrong, nonscalar, and mismatched dual secrets do not", () => {
  assert.equal(
    evaluateGranotWebhookAuthentication(
      SYNTHETIC_SECRET,
      { kind: "present", value: SYNTHETIC_SECRET },
      { kind: "absent" },
    ).ok,
    true,
  );
  assert.deepEqual(
    evaluateGranotWebhookAuthentication(
      SYNTHETIC_SECRET,
      { kind: "absent" },
      { kind: "present", value: SYNTHETIC_SECRET },
    ),
    {
      ok: true,
      authentication_method: "body_secret",
      validated_header: false,
      validated_body: true,
    },
  );
  assert.equal(
    evaluateGranotWebhookAuthentication(
      SYNTHETIC_SECRET,
      { kind: "absent" },
      { kind: "absent" },
    ).ok,
    false,
  );
  assert.equal(
    evaluateGranotWebhookAuthentication(
      SYNTHETIC_SECRET,
      { kind: "present", value: "synthetic-wrong-secret" },
      { kind: "absent" },
    ).ok,
    false,
  );
  assert.equal(
    evaluateGranotWebhookAuthentication(
      SYNTHETIC_SECRET,
      { kind: "invalid" },
      { kind: "present", value: SYNTHETIC_SECRET },
    ).ok,
    false,
  );
  assert.equal(
    evaluateGranotWebhookAuthentication(
      SYNTHETIC_SECRET,
      { kind: "present", value: SYNTHETIC_SECRET },
      { kind: "present", value: "synthetic-wrong-secret" },
    ).ok,
    false,
  );
});

test("[AC-01][AC-35] middleware deletes the body credential before 500, 401, and success", async () => {
  const missingConfig = await invokeMiddleware({
    secret: undefined,
    headers: { "x-api-secret": SYNTHETIC_SECRET },
    body: { "x-api-secret": SYNTHETIC_SECRET, job_no: "567632" },
  });
  assert.equal(missingConfig.status, 500);
  assert.deepEqual(missingConfig.body, {
    ok: false,
    error: "Granot webhook authentication is not configured",
  });
  assert.equal(missingConfig.nextCalled, false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(missingConfig.req.body, "x-api-secret"),
    false,
  );
  assert.equal(missingConfig.req.headers["x-api-secret"], undefined);
  assertSensitiveOutputAbsent(missingConfig.body);

  const unauthorized = await invokeMiddleware({
    secret: SYNTHETIC_SECRET,
    body: { "x-api-secret": "synthetic-wrong-secret", job_no: "567632" },
  });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(unauthorized.body, {
    ok: false,
    code: "GRANOT_WEBHOOK_UNAUTHORIZED",
    error: "Unauthorized",
  });
  assert.equal(unauthorized.nextCalled, false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(unauthorized.req.body, "x-api-secret"),
    false,
  );
  assertSensitiveOutputAbsent(unauthorized.body);

  const authorized = await invokeMiddleware({
    secret: SYNTHETIC_SECRET,
    headers: { "x-api-secret": SYNTHETIC_SECRET },
    body: { "x-api-secret": SYNTHETIC_SECRET, job_no: "567632" },
  });
  assert.equal(authorized.status, undefined);
  assert.equal(authorized.nextCalled, true);
  assert.deepEqual(getGranotWebhookAuth(authorized.req), {
    authentication_method: "header_secret",
  });
  assert.deepEqual(authorized.req.body, { job_no: "567632" });
  assert.equal(authorized.req.headers["x-api-secret"], undefined);
});

test("[AC-01] nonscalar header or body forms are unauthorized and still strip the body key", async () => {
  const headerArray = await invokeMiddleware({
    secret: SYNTHETIC_SECRET,
    headers: { "x-api-secret": [SYNTHETIC_SECRET, SYNTHETIC_SECRET] },
    body: { job_no: "567632" },
  });
  assert.equal(headerArray.status, 401);
  assert.deepEqual(headerArray.body, {
    ok: false,
    code: "GRANOT_WEBHOOK_UNAUTHORIZED",
    error: "Unauthorized",
  });
  assert.equal(headerArray.nextCalled, false);

  const bodyArray = await invokeMiddleware({
    secret: SYNTHETIC_SECRET,
    body: { "x-api-secret": [SYNTHETIC_SECRET], job_no: "567632" },
  });
  assert.equal(bodyArray.status, 401);
  assert.equal(
    Object.prototype.hasOwnProperty.call(bodyArray.req.body, "x-api-secret"),
    false,
  );
});

test("[AC-01][AC-35] delete helper removes the body credential without exposing it", () => {
  const body = { "x-api-secret": SYNTHETIC_SECRET, event_type: "lead_created" };
  deleteGranotWebhookBodySecret(body);
  assert.deepEqual(body, { event_type: "lead_created" });
  assert.equal(JSON.stringify(body).includes(SYNTHETIC_SECRET), false);
});

async function invokeMiddleware(input: {
  secret: string | undefined;
  headers?: Record<string, string | string[]>;
  body?: Record<string, unknown>;
}) {
  if (input.secret === undefined) {
    delete process.env.GRANOT_WEBHOOK_SECRET;
  } else {
    process.env.GRANOT_WEBHOOK_SECRET = input.secret;
  }

  const req = {
    headers: input.headers ?? {},
    body: input.body ?? {},
  } as Request;
  let status: number | undefined;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as Response;
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };

  requireGranotWebhookSecret(req, res, next);
  return { req, status, body, nextCalled };
}

function assertSensitiveOutputAbsent(payload: unknown) {
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(SYNTHETIC_SECRET), false);
  assert.equal(serialized.includes("synthetic-wrong-secret"), false);
  assert.doesNotMatch(serialized, /[a-f0-9]{64}/);
}
