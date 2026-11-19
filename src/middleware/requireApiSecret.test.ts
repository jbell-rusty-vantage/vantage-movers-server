import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type { NextFunction, Request, Response } from "express";
import type { PublicExtensionUser } from "../auth/extension";
import { requireApiSecret, vantageAuthLookups } from "./requireApiSecret";

const originalApiSecret = process.env.VANTAGE_API_SECRET;
const originalScopedApiKeys = process.env.VANTAGE_SCOPED_API_KEYS;

const originalLookup = vantageAuthLookups.getExtensionUserFromAccessToken;

afterEach(() => {
  vantageAuthLookups.getExtensionUserFromAccessToken = originalLookup;
  if (originalApiSecret === undefined) delete process.env.VANTAGE_API_SECRET;
  else process.env.VANTAGE_API_SECRET = originalApiSecret;
  if (originalScopedApiKeys === undefined) delete process.env.VANTAGE_SCOPED_API_KEYS;
  else process.env.VANTAGE_SCOPED_API_KEYS = originalScopedApiKeys;
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

test("a source key admits Forms only for its configured company and route", async () => {
  delete process.env.VANTAGE_API_SECRET;
  process.env.VANTAGE_SCOPED_API_KEYS = JSON.stringify([{
    name: "forms",
    secret: "source-test-key",
    routes: [{ method: "POST", path: "/api/v1/form-leads" }],
    source_companies: ["best_relocation_leads"],
  }]);

  const forms = "/api/v1/form-leads";
  for (const [path, source, allowed] of [
    [forms, "Best Relocation Forms", true],
    [forms, "main_site", false],
    ["/api/v1/booked-leads", "Best Relocation Forms", false],
  ] as const) {
    const result = await invokeMiddleware({
      secret: "source-test-key", method: "POST", path, body: { source_company: source },
    });
    assert.equal(result.nextCalled, allowed, path + " " + source);
    assert.equal(result.statusCode, allowed ? undefined : 403);
  }
});

test("Customer Service can submit a Tariff Adjustment while Lead intake stays restricted", async () => {
  process.env.VANTAGE_API_SECRET = "global-test-key";
  const rolesToCheck: PublicExtensionUser["roles"][] = [
    ["customer_service"], ["sales", "customer_service"], ["sales"],
  ];
  for (const roles of rolesToCheck) {
    vantageAuthLookups.getExtensionUserFromAccessToken = async () => ({
      id: "rep", email: "rep@example.invalid", roles,
    });
    const request = { authorization: "Bearer test-user", method: "POST" };
    const tariff = await invokeMiddleware({ ...request, path: "/api/v1/tariff-adjustments", body: { rows: [] } });
    assert.equal(tariff.nextCalled, roles.includes("customer_service"), roles.join("+"));
    const lead = await invokeMiddleware({ ...request, path: "/api/v1/form-leads", body: { source_company: "main_site" } });
    assert.equal(lead.nextCalled, false, roles.join("+"));
    assert.equal(lead.statusCode, 403);
  }
});

test("requireApiSecret rejects Sales-only Bearer on tariff, form-lead, and Enrichment apply routes", async () => {
  process.env.VANTAGE_API_SECRET = "global-secret";
  delete process.env.VANTAGE_SCOPED_API_KEYS;
  stubExtensionUser({
    id: "sales-1",
    email: "sales@example.invalid",
    roles: ["sales"],
  });

  const tariff = await invokeMiddleware({
    authorization: "Bearer sales-token",
    method: "POST",
    path: "/api/v1/tariff-adjustments",
    body: { rows: [] },
  });
  const formLead = await invokeMiddleware({
    authorization: "Bearer sales-token",
    method: "POST",
    path: "/api/v1/form-leads",
    body: { source_company: "main_site" },
  });
  const apply = await invokeMiddleware({
    authorization: "Bearer sales-token",
    method: "PATCH",
    path: "/api/v1/form-leads/507f1f77bcf86cd799439011/granot-sync",
    body: {},
  });
  const enrichment = await invokeMiddleware({
    authorization: "Bearer sales-token",
    method: "POST",
    path: "/api/v1/call-leads/enrichment/sync",
    body: {},
  });

  assert.equal(tariff.nextCalled, false);
  assert.equal(tariff.statusCode, 403);
  assert.deepEqual(tariff.jsonBody, { ok: false, error: "Forbidden" });
  assert.equal(formLead.nextCalled, false);
  assert.equal(formLead.statusCode, 403);
  assert.deepEqual(formLead.jsonBody, { ok: false, error: "Forbidden" });
  assert.equal(apply.nextCalled, false);
  assert.equal(apply.statusCode, 403);
  assert.equal(enrichment.nextCalled, false);
  assert.equal(enrichment.statusCode, 403);
});

test("requireApiSecret allows Owner Bearer on Tariff Adjustment Submit", async () => {
  process.env.VANTAGE_API_SECRET = "global-secret";
  delete process.env.VANTAGE_SCOPED_API_KEYS;
  stubExtensionUser({
    id: "owner-1",
    email: "owner@example.invalid",
    roles: ["owner"],
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
