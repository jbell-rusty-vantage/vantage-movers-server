import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { CSI_ADMIN_PREFIX, createSalesIntelligenceAdminRouter } from "./sales-intelligence-admin.routes";

/**
 * S4-TIMELINE routes: `SALES_INTELLIGENCE_TIMELINE_V2` off keeps `GET /numbers/:id/timeline` on the v1
 * read with its strict query and answers `GET /outreach/:id/timeline` with 404 FEATURE_DISABLED; on,
 * both serve the v2 read with `kinds[]`.
 */
const numberId = randomBytes(12).toString("hex");
const outreachId = randomBytes(12).toString("hex");
const coverage = { known_through: null, gaps: [], capabilities: {}, ai_paused: false };
const asOf = "2026-09-23T12:00:00.000Z";

test("S4-TIMELINE admin routes: flag off = v1 and 404; flag on = v2 with kinds[]", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature", SALES_INTELLIGENCE_ENABLED: "true",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "route-test", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_csitimelineroute" });
  let v2On = false;
  const calls: string[] = [];
  const page = (data: Record<string, unknown>) => ({ as_of: asOf, coverage, data }) as never;
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter({ connect: async () => {} }));
  app.use(createSalesIntelligenceAdminRouter({
    connect: async () => {},
    flag: flag => flag === "ENABLED" || (flag === "TIMELINE_V2" && v2On),
    timeline: async (id, opts) => { calls.push(`v1:${id}:${JSON.stringify(opts)}`); return page({ number_id: id, items: [], cursor: null }); },
    timelineV2: async (id, opts) => { calls.push(`v2:number:${id}:${JSON.stringify(opts)}`); return id === numberId ? page({ scope: "number", number_id: id, items: [], cursor: null }) : null; },
    outreachTimeline: async (id, opts) => { calls.push(`v2:outreach:${id}:${JSON.stringify(opts)}`); return id === outreachId ? page({ scope: "outreach", outreach_id: id, items: [], cursor: null }) : null; },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = (routePath: string) => {
    const fields = { adminId: "owner", email: "owner@example.test", role: "owner", timestamp: String(Date.now()), requestId: "req-1", method: "GET", path: routePath };
    return { "x-api-secret": "synthetic-global", "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": fields.role,
      "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
  };
  const get = async (routePath: string, query = "") => {
    const response = await fetch(`${base}${routePath}${query}`, { headers: headers(routePath), signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const numberTimeline = `${CSI_ADMIN_PREFIX}/numbers/${numberId}/timeline`;
  const outreachTimeline = `${CSI_ADMIN_PREFIX}/outreach/${outreachId}/timeline`;
  try {
    // Flag off: the v1 read, its strict query, and no Outreach timeline.
    assert.equal((await get(numberTimeline, "?limit=10")).status, 200);
    assert.equal(calls.at(-1), `v1:${numberId}:${JSON.stringify({ cursor: undefined, limit: 10 })}`);
    assert.equal((await get(numberTimeline, "?kinds[]=call")).status, 400, "v1 rejects kinds[]");
    const disabled = await get(outreachTimeline);
    assert.equal(disabled.status, 404);
    assert.equal(disabled.body.code, "FEATURE_DISABLED");
    assert.ok(!calls.some(c => c.startsWith("v2:")));

    // Flag on: v2 for both scopes, kinds[] parsed, unknown kinds and bad limits rejected.
    v2On = true;
    const calls1 = await get(numberTimeline, "?limit=7&kinds[]=call");
    assert.equal(calls1.status, 200);
    assert.equal(calls.at(-1), `v2:number:${numberId}:${JSON.stringify({ limit: 7, kinds: ["call"] })}`);
    assert.equal((await get(numberTimeline, "?kinds=call,lead_received")).status, 200);
    assert.equal(calls.at(-1), `v2:number:${numberId}:${JSON.stringify({ limit: 50, kinds: ["call", "lead_received"] })}`);
    assert.equal((await get(numberTimeline, "?kinds[]=interaction")).status, 400, "unknown kind");
    assert.equal((await get(numberTimeline, "?limit=201")).status, 400);
    assert.equal((await get(`${CSI_ADMIN_PREFIX}/numbers/${"f".repeat(24)}/timeline`)).status, 404);
    const scoped = await get(outreachTimeline, "?limit=5");
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.ok, true);
    assert.equal(calls.at(-1), `v2:outreach:${outreachId}:${JSON.stringify({ limit: 5, kinds: null })}`);
    assert.equal((await get(`${CSI_ADMIN_PREFIX}/outreach/${"e".repeat(24)}/timeline`)).status, 404);
    assert.equal((await get(`${CSI_ADMIN_PREFIX}/outreach/not-an-id/timeline`)).status, 400);
  } finally {
    server.close();
    process.env = saved;
  }
});
