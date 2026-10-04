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
 * `GET /numbers/:id/timeline` serves the retained deterministic read (calls and Lead Messages)
 * whatever `SALES_INTELLIGENCE_TIMELINE_V2` says; the story-catalog `kinds[]` query and the
 * Outreach-scoped timeline are retired.
 */
const numberId = randomBytes(12).toString("hex");
const outreachId = randomBytes(12).toString("hex");
const coverage = { known_through: null, gaps: [], capabilities: { call_log: "unknown", webhook: "unknown" } };
const asOf = "2026-09-23T12:00:00.000Z";

test("Number timeline route: the retained read with its strict query, flag-independent; no Outreach timeline", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { VANTAGE_API_SECRET: "synthetic-global", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-owner-signature", SALES_INTELLIGENCE_ENABLED: "true",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "route-test", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_csitimelineroute" });
  const calls: string[] = [];
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter({ connect: async () => {} }));
  app.use(createSalesIntelligenceAdminRouter({
    connect: async () => {},
    flag: flag => flag === "ENABLED" || flag === "TIMELINE_V2",
    timeline: async (id, opts) => {
      calls.push(`${id}:${JSON.stringify(opts)}`);
      return id === numberId ? { as_of: asOf, coverage, data: { number_id: id, items: [], cursor: null } } as never : null;
    },
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
    return { status: response.status };
  };
  const numberTimeline = `${CSI_ADMIN_PREFIX}/numbers/${numberId}/timeline`;
  try {
    assert.equal((await get(numberTimeline, "?limit=10")).status, 200);
    assert.equal(calls.at(-1), `${numberId}:${JSON.stringify({ cursor: undefined, limit: 10 })}`);
    assert.equal((await get(numberTimeline, "?kinds[]=call")).status, 400, "the story-catalog kinds filter is retired");
    assert.equal((await get(numberTimeline, "?limit=201")).status, 400);
    assert.equal((await get(`${CSI_ADMIN_PREFIX}/numbers/${"f".repeat(24)}/timeline`)).status, 404);
    assert.equal((await get(`${CSI_ADMIN_PREFIX}/outreach/${outreachId}/timeline`)).status, 404, "no Outreach timeline route");
  } finally {
    server.close();
    process.env = saved;
  }
});
