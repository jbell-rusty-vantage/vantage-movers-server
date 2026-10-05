import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { CSI_ADMIN_PREFIX, createSalesIntelligenceAdminRouter } from "./sales-intelligence-admin.routes";

const numberId = randomBytes(12).toString("hex");
const coverage = { known_through: null, gaps: [], capabilities: { call_log: "unknown", webhook: "unknown" } };
const asOf = "2026-09-17T14:00:00.000Z";

test("Numbers admin routes: Owner guard (a rep is refused), flag-off 404, scope, validation, error mapping; retired routes are gone", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  process.env.VANTAGE_API_SECRET = "synthetic-global";
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = "synthetic-owner-signature";
  process.env.SALES_INTELLIGENCE_ENABLED = "true";
  process.env.SALES_INTELLIGENCE_REP_ACCESS = "true";
  process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "route-test";
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_csiadminroute";
  const calls: string[] = [];
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter());
  app.use(
    createSalesIntelligenceAdminRouter({
      connect: async () => {
        calls.push("connect");
      },
      allNumbers: async (query) => {
        calls.push(`list:${JSON.stringify(query)}`);
        return { as_of: asOf, data: { items: [], cursor: null, counts: { all: 0, waiting: 0 } } };
      },
      numberDetail: async (id) => {
        calls.push(`detail:${id}`);
        return id === numberId ? ({ as_of: asOf, data: { number: { id } } } as never) : null;
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerHeaders = (method: string, routePath: string, role = "owner", extra: Record<string, string> = {}) => {
    const fields = { adminId: "owner", email: "owner@example.test", role, timestamp: String(Date.now()), requestId: "req-1", method, path: routePath };
    return {
      "x-api-secret": "synthetic-global",
      "x-vantage-admin-user-id": fields.adminId,
      "x-vantage-admin-email": fields.email,
      "x-vantage-admin-role": role,
      "x-vantage-admin-timestamp": fields.timestamp,
      "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!),
      ...extra,
    };
  };
  const call = async (method: string, routePath: string, init: { headers?: Record<string, string>; body?: unknown } = {}) => {
    const response = await fetch(base + routePath, {
      method,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const statusOf = async (method: string, routePath: string) =>
    (await fetch(base + routePath, { method, headers: { "content-type": "application/json", ...ownerHeaders(method, routePath, "owner", { "idempotency-key": "k-retired" }) },
      body: method === "GET" ? undefined : "{}", signal: AbortSignal.timeout(5000) })).status;
  const numbers = `${CSI_ADMIN_PREFIX}/numbers`;
  const detailPath = `${numbers}/${numberId}`;

  try {
    // Authority: broad secret alone, admin role and scoped keys are denied by the boundary; nothing reaches a service.
    assert.equal((await call("GET", numbers, { headers: { "x-api-secret": "synthetic-global" } })).status, 403);
    assert.equal((await call("GET", numbers, { headers: ownerHeaders("GET", numbers, "admin") })).status, 403);
    assert.equal((await call("GET", `${numbers}?scope=historical`, { headers: ownerHeaders("GET", numbers) })).status, 403);
    // A rep (even with REP_ACCESS on) is never an unscoped Numbers or Accounts reader: an unsigned rep stops at the boundary,
    // a signed one at the route, both with 403 before any service runs.
    for (const target of [numbers, detailPath, `${CSI_ADMIN_PREFIX}/accounts`, `${CSI_ADMIN_PREFIX}/nudges`, `${CSI_ADMIN_PREFIX}/coverage`]) {
      const rep = await call("GET", target, { headers: ownerHeaders("GET", target, "rep") });
      assert.equal(rep.status, 403, target);
    }
    assert.deepEqual(calls, []);

    // List: strict query; the interim filters are gone (400).
    const listed = await call("GET", `${numbers}?q=0200&limit=5&scope=production`, { headers: ownerHeaders("GET", numbers) });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.as_of, asOf);
    assert.equal(calls.at(-1), `list:${JSON.stringify({ scope: "production", view: "all", q: "0200", limit: 5 })}`);
    for (const query of ["attachment=unlinked", "sort=last_activity", "classification=customer", "has_outreach=true", "limit=999", "nope=1"]) {
      const refused = await call("GET", `${numbers}?${query}`, { headers: ownerHeaders("GET", numbers) });
      assert.equal(refused.status, 400, query);
      assert.equal(refused.body.code, "INVALID_INPUT");
    }

    // Detail: 404 for a missing row, 400 for a malformed id.
    const detail = await call("GET", detailPath, { headers: ownerHeaders("GET", detailPath) });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.data, { number: { id: numberId } });
    const missing = `${numbers}/${"f".repeat(24)}`;
    assert.equal((await call("GET", missing, { headers: ownerHeaders("GET", missing) })).status, 404);
    const malformed = `${numbers}/not-an-id`;
    assert.equal((await call("GET", malformed, { headers: ownerHeaders("GET", malformed) })).status, 400);

    // Retired routes are not registered: the interim timeline/rebuild, attachments and reps (All Numbers phase B),
    // and the earlier Outreach, Attention, Overview, analysis, assessment and conversation routes.
    for (const [method, target] of [["GET", `${detailPath}/timeline`], ["POST", `${detailPath}/rebuild`], ["GET", `${CSI_ADMIN_PREFIX}/attachments`],
      ["POST", `${CSI_ADMIN_PREFIX}/attachments/attach`], ["POST", `${CSI_ADMIN_PREFIX}/attachments/${numberId}/reject`],
      ["POST", `${CSI_ADMIN_PREFIX}/attachments/${numberId}/detach`], ["GET", `${CSI_ADMIN_PREFIX}/reps`], ["GET", `${CSI_ADMIN_PREFIX}/reps/${numberId}`],
      ["POST", `${CSI_ADMIN_PREFIX}/reps`], ["POST", `${CSI_ADMIN_PREFIX}/reps/propose`], ["POST", `${CSI_ADMIN_PREFIX}/reps/${numberId}/review`],
      ["GET", `${CSI_ADMIN_PREFIX}/attention`], ["GET", `${CSI_ADMIN_PREFIX}/outreach/${numberId}`],
      ["POST", `${CSI_ADMIN_PREFIX}/outreach/${numberId}/commands`], ["GET", `${CSI_ADMIN_PREFIX}/outreach/closed-history`], ["GET", `${CSI_ADMIN_PREFIX}/overview`],
      ["GET", `${CSI_ADMIN_PREFIX}/roster`], ["GET", `${CSI_ADMIN_PREFIX}/review-items`], ["POST", `${CSI_ADMIN_PREFIX}/restrictions/${numberId}/resolve`],
      ["POST", `${CSI_ADMIN_PREFIX}/interactions/${numberId}/contact-type`], ["GET", `${CSI_ADMIN_PREFIX}/analysis-runs`],
      ["GET", `${CSI_ADMIN_PREFIX}/assessments/${numberId}`], ["GET", `${detailPath}/conversations`], ["POST", `${detailPath}/reanalyze`],
      ["GET", `${CSI_ADMIN_PREFIX}/conversations/${numberId}/media`], ["POST", `${CSI_ADMIN_PREFIX}/backfill`],
      ["GET", `${CSI_ADMIN_PREFIX}/followups`], ["POST", `${CSI_ADMIN_PREFIX}/overview/presets`]] as const) {
      assert.equal(await statusOf(method, target), 404, `${method} ${target}`);
    }
    assert.ok(!(calls as string[]).some((c) => !c.startsWith("connect") && !/^(list|detail):/.test(c)), "no retired route reached a service");

    // Master flag off: 404 feature_disabled before any service call.
    calls.length = 0;
    process.env.SALES_INTELLIGENCE_ENABLED = "false";
    const disabled = await call("GET", numbers, { headers: ownerHeaders("GET", numbers) });
    assert.equal(disabled.status, 404);
    assert.equal(disabled.body.code, "FEATURE_DISABLED");
    assert.deepEqual(calls, []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = saved;
  }
});

test("admin router is mounted in v1.routes.ts after the CSI boundary router", () => {
  const source = readFileSync(path.join(process.cwd(), "src", "routes", "v1.routes.ts"), "utf8");
  const guard = source.indexOf('router.use("/api/v1", requireApiSecret)');
  const boundary = source.indexOf("router.use(createSalesIntelligenceBoundaryRouter())");
  const admin = source.indexOf("router.use(createSalesIntelligenceAdminRouter())");
  assert.ok(guard > -1 && boundary > guard && admin > boundary, "guard, then boundary, then CSI-04 admin routes");
});

test("coverage and settings: production scope, CAS, no flag patch, GET never writes", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  process.env.VANTAGE_API_SECRET = "synthetic-global";
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = "synthetic-owner-signature";
  process.env.SALES_INTELLIGENCE_ENABLED = "true";
  process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "route-test";
  process.env.TEST_MODE = "true";
  let settingsReads = 0;
  let settingsWrites = 0;
  const coverage = {
    known_through: null,
    gaps: [],
    capabilities: { call_log: "unknown", webhook: "unavailable" },
    mapping_hygiene: { unmapped_inbound_numbers: 0, unmapped_directory_users: null, last_directory_sync_at: null, directory_status: "missing" },
  };
  const settings = { persisted: false, revision: 1, source: "accepted_defaults", policy: { version: "csi-policy-v1" }, flags: { NUDGE_ENABLED: false }, updated_at: null, updated_by: null };
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter());
  app.use(createSalesIntelligenceAdminRouter({
    connect: async () => {},
    coverage: async () => coverage as never,
    settings: async () => { settingsReads += 1; return settings as never; },
    updateSettings: async () => { settingsWrites += 1; return { response: { version: "csi-policy-r2", revision: 2 }, replayed: false } as never; },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerHeaders = (method: string, routePath: string, extra: Record<string, string> = {}) => {
    const fields = { adminId: "owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "req-09", method, path: routePath };
    return {
      "x-api-secret": "synthetic-global",
      "x-vantage-admin-user-id": fields.adminId,
      "x-vantage-admin-email": fields.email,
      "x-vantage-admin-role": "owner",
      "x-vantage-admin-timestamp": fields.timestamp,
      "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!),
      ...extra,
    };
  };
  const call = async (method: string, routePath: string, init: { headers?: Record<string, string>; body?: unknown } = {}) => {
    const response = await fetch(base + routePath, {
      method,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  try {
    const coveragePath = `${CSI_ADMIN_PREFIX}/coverage`;
    const settingsPath = `${CSI_ADMIN_PREFIX}/settings`;
    assert.equal((await call("GET", `${coveragePath}?scope=historical`, { headers: ownerHeaders("GET", coveragePath) })).status, 403);
    assert.equal((await call("GET", `${settingsPath}?scope=combined`, { headers: ownerHeaders("GET", settingsPath) })).status, 403);
    const read = await call("GET", coveragePath, { headers: ownerHeaders("GET", coveragePath) });
    assert.equal(read.status, 200);
    const data = (read.body.data as { coverage: typeof coverage }).coverage;
    assert.equal(data.capabilities.webhook, "unavailable");
    assert.equal(data.mapping_hygiene.unmapped_directory_users, null);
    assert.equal(settingsWrites, 0);
    const settingsRead = await call("GET", settingsPath, { headers: ownerHeaders("GET", settingsPath) });
    assert.equal(settingsRead.status, 200);
    assert.equal(settingsReads, 1);
    assert.equal(settingsWrites, 0);
    assert.equal("coverage" in settingsRead.body, false);
    const noKey = await call("PATCH", settingsPath, { headers: ownerHeaders("PATCH", settingsPath), body: { command: "update_settings", expected_revision: 1, policy: { version: "x" }, reason: "Owner" } });
    assert.equal(noKey.status, 400);
    const flagged = await call("PATCH", settingsPath, {
      headers: ownerHeaders("PATCH", settingsPath, { "idempotency-key": "k-flags" }),
      body: { command: "update_settings", expected_revision: 1, policy: { version: "x" }, reason: "Owner", flags: { NUDGE_ENABLED: true } },
    });
    assert.equal(flagged.status, 400);
    assert.equal(settingsWrites, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = saved;
  }
});
