import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { CSI_ADMIN_PREFIX, createSalesIntelligenceAdminRouter } from "./sales-intelligence-admin.routes";
import { createSalesIntelligenceCronRouter, CSI_CRON_PATHS } from "./sales-intelligence-cron.routes";

/** S7-CLOSED + S9-READS routes: Owner guard, flag-off 404 / no-op, strict params, route order, the S8 scope hook, cron registration. */
test("S7-CLOSED / S9-READS routes", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature", SALES_INTELLIGENCE_ENABLED: "true",
    SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_DEPLOYMENT_ID: "route-test", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_t3croute",
    CRON_SECRET: "synthetic-cron" });
  delete process.env.SALES_INTELLIGENCE_OVERVIEW;
  const calls: Array<[string, unknown, unknown]> = [];
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter({ connect: async () => {} }));
  app.use(createSalesIntelligenceAdminRouter({
    connect: async () => {},
    closedHistory: async (query, options) => { calls.push(["closed", query, options]); return { as_of: "x", coverage: {}, data: { items: [], cursor: null, retention: { days: 730, basis: "activity" } } } as never; },
    overview: async (query, options) => { calls.push(["overview", query, options]); return { as_of: "x" } as never; },
    rebuildOverviewDay: async (input) => { calls.push(["rebuild", input.command, input.idempotency_key]); return { day: "2026-09-24", documents: 0, calls: 0, unmapped_calls: 0, replayed: false }; },
  }));
  let refreshes = 0;
  app.use(createSalesIntelligenceCronRouter({ connect: async () => {}, runOverviewRefresh: async () => { refreshes++; return { skipped: false as const, days: [] }; } }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const owner = (method: string, routePath: string, role = "owner", extra: Record<string, string> = {}) => {
    const fields = { adminId: "owner", email: "owner@example.test", role, timestamp: String(Date.now()), requestId: "req-1", method, path: routePath };
    return { "x-api-secret": "synthetic-global", "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": role,
      "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!), ...extra };
  };
  const call = async (method: string, routePath: string, headers: Record<string, string>, body?: unknown) => {
    const response = await fetch(base + routePath, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const closed = `${CSI_ADMIN_PREFIX}/outreach/closed-history`, overview = `${CSI_ADMIN_PREFIX}/overview`, rebuild = `${CSI_ADMIN_PREFIX}/overview/rebuild-day`;
  try {
    // Owner only.
    assert.equal((await call("GET", closed, owner("GET", closed, "admin"))).status, 403);
    assert.equal((await call("GET", overview, owner("GET", overview, "admin"))).status, 403);
    // Closed history is served before `/outreach/:id` (which would 400 on a non-id), with strict params.
    const page = await call("GET", `${closed}?outcome=crm_dead,booked&limit=10`, owner("GET", closed));
    assert.equal(page.status, 200);
    assert.deepEqual(calls.at(-1), ["closed", { outcome: ["booked", "crm_dead"], limit: 10 }, { scope: null }], "the Owner reads unscoped (S8-REP passes a forced scope)");
    assert.equal((await call("GET", `${closed}?limit=51`, owner("GET", closed))).status, 400);
    assert.equal((await call("GET", `${closed}?view=closed`, owner("GET", closed))).status, 400);
    // Overview and its command: 404 FEATURE_DISABLED until SALES_INTELLIGENCE_OVERVIEW is on; nothing reaches a service.
    const before = calls.length;
    const off = await call("GET", overview, owner("GET", overview));
    assert.deepEqual([off.status, off.body.code], [404, "FEATURE_DISABLED"]);
    assert.equal((await call("POST", rebuild, owner("POST", rebuild, "owner", { "Idempotency-Key": "k1" }), { command: "rebuild_overview_day", day: "2026-09-23", reason: "x" })).status, 404);
    assert.equal(calls.length, before);
    const cronAuth = { authorization: "Bearer synthetic-cron" };
    const cronOff = await call("GET", CSI_CRON_PATHS.overviewRefresh, cronAuth);
    assert.deepEqual([cronOff.status, cronOff.body.skipped, cronOff.body.reason, refreshes], [200, true, "disabled", 0], "the cron is a no-op with the flag off");
    process.env.SALES_INTELLIGENCE_OVERVIEW = "true";
    const on = await call("GET", `${overview}?period=last_7_days&priority=0,not_set`, owner("GET", overview));
    assert.equal(on.status, 200);
    assert.deepEqual(calls.at(-1), ["overview", { period: "last_7_days", priority: ["0", "not_set"] }, { scope: null }]);
    assert.equal((await call("GET", `${overview}?period=custom`, owner("GET", overview))).status, 400, "custom needs from/to");
    assert.equal((await call("GET", `${overview}?from=2026-09-01`, owner("GET", overview))).status, 400, "from/to only with custom");
    assert.equal((await call("POST", rebuild, owner("POST", rebuild), { command: "rebuild_overview_day", day: "2026-09-23", reason: "x" })).status, 400, "Idempotency-Key required");
    const rebuilt = await call("POST", rebuild, owner("POST", rebuild, "owner", { "Idempotency-Key": "k1" }), { command: "rebuild_overview_day", day: "2026-09-23", reason: "x" });
    assert.equal(rebuilt.status, 200);
    assert.deepEqual(calls.at(-1), ["rebuild", { command: "rebuild_overview_day", day: "2026-09-23", reason: "x" }, "k1"]);
    assert.equal((await call("GET", CSI_CRON_PATHS.overviewRefresh, { authorization: "Bearer wrong" })).status, 401);
    const cronOn = await call("GET", CSI_CRON_PATHS.overviewRefresh, cronAuth);
    assert.deepEqual([cronOn.status, cronOn.body.skipped, refreshes], [200, false, 1]);
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    assert.equal(manifest.crons.find(c => c.path === CSI_CRON_PATHS.overviewRefresh)?.schedule, "*/5 * * * *");
  } finally {
    server.close();
    process.env = saved;
  }
});
