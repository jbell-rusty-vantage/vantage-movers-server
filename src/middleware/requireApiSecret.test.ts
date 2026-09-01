import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import type { NextFunction, Request, Response } from "express";
import type { PublicExtensionUser } from "../auth/extension";
import { requireApiSecret, vantageAuthLookups } from "./requireApiSecret";

const originalApiSecret = process.env.VANTAGE_API_SECRET;
const originalScopedApiKeys = process.env.VANTAGE_SCOPED_API_KEYS;
const originalObservabilityEnabled = process.env.OBSERVABILITY_ENABLED;

beforeEach(() => {
  // Auth decisions still flow; disabling observability keeps these unit tests
  // free of Mongo connection attempts and event persistence.
  process.env.OBSERVABILITY_ENABLED = "false";
});

const originalLookup = vantageAuthLookups.getExtensionUserFromAccessToken;

afterEach(() => {
  vantageAuthLookups.getExtensionUserFromAccessToken = originalLookup;
  process.env.VANTAGE_API_SECRET = originalApiSecret;
  process.env.VANTAGE_SCOPED_API_KEYS = originalScopedApiKeys;
  if (originalObservabilityEnabled === undefined) {
    delete process.env.OBSERVABILITY_ENABLED;
  } else {
    process.env.OBSERVABILITY_ENABLED = originalObservabilityEnabled;
  }
});

test("requireApiSecret accepts the global API secret on any v1 route", async () => {
  process.env.VANTAGE_API_SECRET = "global-secret";
  delete process.env.VANTAGE_SCOPED_API_KEYS;

  const ctx = await invokeMiddleware({
    secret: "global-secret",
    method: "PATCH",
    path: "/api/v1/form-leads/507f1f77bcf86cd799439011",
    body: { source_company: "main_site" },
  });

  assert.equal(ctx.nextCalled, true);
  assert.equal(ctx.statusCode, undefined);
});

test("requireApiSecret accepts a source-scoped key for its configured route", async () => {
  delete process.env.VANTAGE_API_SECRET;
  process.env.VANTAGE_SCOPED_API_KEYS = JSON.stringify([
    {
      name: "best-relocation-forms",
      secret: "best-relocation-secret",
      routes: [{ method: "POST", path: "/api/v1/form-leads" }],
      source_companies: ["best_relocation_leads"],
    },
  ]);

  const ctx = await invokeMiddleware({
    secret: "best-relocation-secret",
    method: "POST",
    path: "/api/v1/form-leads",
    body: { source_company: "Best Relocation Forms" },
  });

  assert.equal(ctx.nextCalled, true);
  assert.equal(ctx.statusCode, undefined);
});

test("requireApiSecret accepts a source-scoped key for configured call lead route", async () => {
  delete process.env.VANTAGE_API_SECRET;
  process.env.VANTAGE_SCOPED_API_KEYS = JSON.stringify([
    {
      name: "best-relocation-forms",
      secret: "best-relocation-secret",
      routes: [
        { method: "POST", path: "/api/v1/form-leads" },
        { method: "POST", path: "/api/v1/call-leads" },
      ],
      source_companies: ["best_relocation_leads"],
    },
  ]);

  const ctx = await invokeMiddleware({
    secret: "best-relocation-secret",
    method: "POST",
    path: "/api/v1/call-leads",
    body: { source_company: "Best Relocation Inbounds" },
  });

  assert.equal(ctx.nextCalled, true);
  assert.equal(ctx.statusCode, undefined);
});

test("requireApiSecret rejects a scoped key on a different route", async () => {
  delete process.env.VANTAGE_API_SECRET;
  process.env.VANTAGE_SCOPED_API_KEYS = JSON.stringify([
    {
      name: "best-relocation-forms",
      secret: "best-relocation-secret",
      routes: [
        { method: "POST", path: "/api/v1/form-leads" },
        { method: "POST", path: "/api/v1/call-leads" },
      ],
      source_companies: ["best_relocation_leads"],
    },
  ]);

  const ctx = await invokeMiddleware({
    secret: "best-relocation-secret",
    method: "POST",
    path: "/api/v1/booked-leads",
    body: { source_company: "Best Relocation Inbounds" },
  });

  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.statusCode, 403);
  assert.deepEqual(ctx.jsonBody, { ok: false, error: "Forbidden" });
});

test("requireApiSecret rejects a scoped key for a different source company", async () => {
  delete process.env.VANTAGE_API_SECRET;
  process.env.VANTAGE_SCOPED_API_KEYS = JSON.stringify([
    {
      name: "best-relocation-forms",
      secret: "best-relocation-secret",
      routes: [{ method: "POST", path: "/api/v1/form-leads" }],
      source_companies: ["best_relocation_leads"],
    },
  ]);

  const ctx = await invokeMiddleware({
    secret: "best-relocation-secret",
    method: "POST",
    path: "/api/v1/form-leads",
    body: { source_company: "main_site" },
  });

  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.statusCode, 403);
  assert.deepEqual(ctx.jsonBody, { ok: false, error: "Forbidden" });
});

test("requireApiSecret rejects Employee Bearer on form-lead data routes", async () => {
  process.env.VANTAGE_API_SECRET = "global-secret";
  delete process.env.VANTAGE_SCOPED_API_KEYS;
  stubExtensionUser({
    id: "emp-1",
    email: "employee@example.invalid",
    role: "employee",
  });

  const post = await invokeMiddleware({
    authorization: "Bearer employee-token",
    method: "POST",
    path: "/api/v1/form-leads",
    body: { source_company: "main_site" },
  });
  const get = await invokeMiddleware({
    authorization: "Bearer employee-token",
    method: "GET",
    path: "/api/v1/form-leads",
  });

  assert.equal(post.nextCalled, false);
  assert.equal(post.statusCode, 403);
  assert.deepEqual(post.jsonBody, { ok: false, error: "Forbidden" });
  assert.equal(get.nextCalled, false);
  assert.equal(get.statusCode, 403);
});

test("requireApiSecret allows Employee Bearer on Tariff Adjustment Submit", async () => {
  process.env.VANTAGE_API_SECRET = "global-secret";
  delete process.env.VANTAGE_SCOPED_API_KEYS;
  stubExtensionUser({
    id: "emp-1",
    email: "employee@example.invalid",
    role: "employee",
  });

  const ctx = await invokeMiddleware({
    authorization: "Bearer employee-token",
    method: "POST",
    path: "/api/v1/tariff-adjustments",
    body: { rows: [] },
  });

  assert.equal(ctx.nextCalled, true);
  assert.equal(ctx.statusCode, undefined);
});

test("requireApiSecret allows Owner Bearer on Tariff Adjustment Submit", async () => {
  process.env.VANTAGE_API_SECRET = "global-secret";
  delete process.env.VANTAGE_SCOPED_API_KEYS;
  stubExtensionUser({
    id: "owner-1",
    email: "owner@example.invalid",
    role: "owner",
  });

  const ctx = await invokeMiddleware({
    authorization: "Bearer owner-token",
    method: "POST",
    path: "/api/v1/tariff-adjustments",
    body: { rows: [] },
  });

  assert.equal(ctx.nextCalled, true);
  assert.equal(ctx.statusCode, undefined);
});

test("requireApiSecret rejects unknown secrets", async () => {
  process.env.VANTAGE_API_SECRET = "global-secret";
  process.env.VANTAGE_SCOPED_API_KEYS = JSON.stringify([
    {
      name: "best-relocation-forms",
      secret: "best-relocation-secret",
      routes: [{ method: "POST", path: "/api/v1/form-leads" }],
      source_companies: ["best_relocation_leads"],
    },
  ]);

  const ctx = await invokeMiddleware({
    secret: "wrong-secret",
    method: "POST",
    path: "/api/v1/form-leads",
    body: { source_company: "Best Relocation Forms" },
  });

  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.statusCode, 401);
  assert.deepEqual(ctx.jsonBody, { ok: false, error: "Unauthorized" });
});

function stubExtensionUser(user: PublicExtensionUser): void {
  vantageAuthLookups.getExtensionUserFromAccessToken = async () => user;
}

async function invokeMiddleware(input: {
  secret?: string;
  authorization?: string;
  method: string;
  path: string;
  body?: unknown;
}) {
  const ctx: {
    statusCode?: number;
    jsonBody?: unknown;
    nextCalled: boolean;
  } = { nextCalled: false };

  const req = {
    method: input.method,
    originalUrl: input.path,
    url: input.path,
    body: input.body,
    headers: {},
    header(name: string) {
      const key = name.toLowerCase();
      if (key === "x-api-secret") {
        return input.secret;
      }
      if (key === "authorization") {
        return input.authorization;
      }
      return undefined;
    },
  } as unknown as Request;

  const res = {
    status(code: number) {
      ctx.statusCode = code;
      return res;
    },
    json(body: unknown) {
      ctx.jsonBody = body;
      return res;
    },
  } as unknown as Response;

  const next: NextFunction = () => {
    ctx.nextCalled = true;
  };

  await requireApiSecret(req, res, next);
  return ctx;
}
