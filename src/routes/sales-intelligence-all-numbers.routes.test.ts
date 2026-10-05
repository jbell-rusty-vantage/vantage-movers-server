import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { CsiError } from "../services/salesIntelligence/auth";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { CSI_ADMIN_PREFIX, createSalesIntelligenceAdminRouter } from "./sales-intelligence-admin.routes";

const numberId = randomBytes(12).toString("hex");
const asOf = "2026-10-05T14:00:00.000Z";


test("All Numbers + Accounts routes (CONTRACT §4): Owner only, strict queries and bodies, envelopes, error mapping", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  process.env.VANTAGE_API_SECRET = "synthetic-global";
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = "synthetic-owner-signature";
  process.env.SALES_INTELLIGENCE_ENABLED = "true";
  process.env.SALES_INTELLIGENCE_REP_ACCESS = "true";
  process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "route-test";
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_allnumbersroute";
  const calls: Array<[string, unknown]> = [];
  let leadError: CsiError | null = null;
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter());
  app.use(createSalesIntelligenceAdminRouter({
    connect: async () => undefined,
    allNumbers: async (query) => { calls.push(["list", query]); return { as_of: asOf, data: { items: [], cursor: null, counts: { all: 0, waiting: 0 } } }; },
    numberDetail: async (id) => (id === numberId ? ({ as_of: asOf, data: { number: { id }, other_leads: [], excluded_leads: [], calls: [], more_calls: false } } as never) : null),
    leadSearch: async (q) => { calls.push(["search", q]); return { as_of: asOf, data: { items: [] } }; },
    numberLead: async (input) => {
      calls.push(["lead", { body: input.body, key: input.idempotency_key, kind: input.actor.kind }]);
      if (leadError) throw leadError;
      return input.number_id === numberId ? { number_id: numberId, revision: 2, changed: true } : null;
    },
    accounts: async () => ({ directory_at: null, accounts: [], agents: [] }),
    accountAgent: async (input) => { calls.push(["agent", { ext: input.extension_id, body: input.body }]); return input.extension_id === "101" ? ({ extension_id: "101" } as never) : null; },
    suggestAccounts: async () => { calls.push(["suggest", null]); return { directory_at: null, accounts: [], agents: [] }; },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = (method: string, routePath: string, role = "owner", extra: Record<string, string> = {}) => {
    const fields = { adminId: "owner", email: "owner@example.test", role, timestamp: String(Date.now()), requestId: "req-1", method, path: routePath };
    return {
      "x-api-secret": "synthetic-global", "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email,
      "x-vantage-admin-role": role, "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!), ...extra,
    };
  };
  const call = async (method: string, target: string, init: { role?: string; body?: unknown; extra?: Record<string, string> } = {}) => {
    const routePath = target.split("?")[0]!;
    const response = await fetch(base + target, { method, headers: { "content-type": "application/json", ...headers(method, routePath, init.role, init.extra) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const numbers = `${CSI_ADMIN_PREFIX}/numbers`;
  try {
    // Owner only: a signed rep and the Admin role are refused before any service.
    for (const [method, target] of [["GET", numbers], ["GET", `${numbers}/lead-search?q=ann`], ["POST", `${numbers}/${numberId}/lead`],
      ["GET", `${CSI_ADMIN_PREFIX}/accounts`], ["POST", `${CSI_ADMIN_PREFIX}/accounts/101/agent`], ["POST", `${CSI_ADMIN_PREFIX}/accounts/suggest`]] as const) {
      for (const role of ["rep", "admin"]) assert.equal((await call(method, target, { role, body: method === "POST" ? {} : undefined })).status, 403, `${role} ${target}`);
    }
    assert.deepEqual(calls, []);

    // §4.1: defaults, strict query; the interim list's keys are refused (phase B removed it).
    const listed = await call("GET", numbers);
    assert.equal(listed.status, 200);
    assert.deepEqual(Object.keys(listed.body).sort(), ["as_of", "data", "ok"]);
    assert.deepEqual(calls.at(-1), ["list", { view: "all", limit: 50 }]);
    await call("GET", `${numbers}?view=waiting&q=Ann&limit=10`);
    assert.deepEqual(calls.at(-1), ["list", { view: "waiting", q: "Ann", limit: 10 }]);
    for (const query of ["view=closed", "limit=0", "limit=101", "nope=1", "view=all&sort=last_activity"]) {
      const refused = await call("GET", `${numbers}?${query}`);
      assert.equal(refused.status, 400, query);
      assert.equal(refused.body.code, "INVALID_INPUT");
      assert.equal(typeof refused.body.message, "string");
    }
    // The Admin proxy adds `scope=production` to every call (query and command alike).
    assert.equal((await call("GET", `${numbers}?scope=production&limit=25`)).status, 200);
    assert.equal((await call("GET", `${numbers}/${numberId}?scope=production`)).status, 200);
    assert.equal((await call("POST", `${CSI_ADMIN_PREFIX}/accounts/suggest?scope=production`, { body: {} })).status, 200);
    assert.equal((await call("GET", `${numbers}?scope=historical`)).status, 403);
    assert.equal((await call("GET", `${numbers}?sort=last_activity&direction=desc&limit=50`)).status, 400);

    // §4.4 is matched before `/numbers/:id`.
    const searched = await call("GET", `${numbers}/lead-search?q=J-100`);
    assert.equal(searched.status, 200);
    assert.deepEqual(calls.at(-1), ["search", "J-100"]);
    assert.equal((await call("GET", `${numbers}/lead-search`)).status, 400);
    assert.equal((await call("GET", `${numbers}/lead-search?q=a&x=1`)).status, 400);

    // §4.2.
    const detail = await call("GET", `${numbers}/${numberId}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.data, { number: { id: numberId }, other_leads: [], excluded_leads: [], calls: [], more_calls: false });
    assert.equal((await call("GET", `${numbers}/${"f".repeat(24)}`)).status, 404);
    assert.equal((await call("GET", `${numbers}/${numberId}?x=1`)).status, 400);

    // §4.3: exactly one of a non-null lead or unlink.
    const lead = `${numbers}/${numberId}/lead`;
    const leadRef = { model: "FormLead", id: "a".repeat(24) };
    for (const body of [{ revision: 1, lead: null }, { revision: 1, lead: leadRef, unlink: leadRef }, { revision: 0, lead: leadRef },
      { revision: 1, lead: { model: "Booking", id: "a".repeat(24) } }, { revision: 1, lead: leadRef, extra: true }]) {
      assert.equal((await call("POST", lead, { body })).status, 400, JSON.stringify(body));
    }
    const pinned = await call("POST", lead, { body: { revision: 1, lead: leadRef }, extra: { "idempotency-key": "pin-1" } });
    assert.equal(pinned.status, 200);
    assert.deepEqual(pinned.body.data, { number: { id: numberId }, other_leads: [], excluded_leads: [], calls: [], more_calls: false }, "returns the §4.2 data");
    assert.deepEqual(calls.at(-1), ["lead", { body: { revision: 1, lead: leadRef }, key: "pin-1", kind: "owner" }]);
    await call("POST", lead, { body: { revision: 1, unlink: leadRef } });
    assert.deepEqual(calls.at(-1), ["lead", { body: { revision: 1, lead: null, unlink: leadRef }, key: undefined, kind: "owner" }]);
    leadError = new CsiError("REVISION_CONFLICT");
    const stale = await call("POST", lead, { body: { revision: 1, lead: leadRef } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "REVISION_CONFLICT");
    assert.equal(typeof stale.body.message, "string");
    leadError = null;
    assert.equal((await call("POST", `${numbers}/${"f".repeat(24)}/lead`, { body: { revision: 1, lead: leadRef } })).status, 404);

    // §4.5–§4.7.
    const accounts = await call("GET", `${CSI_ADMIN_PREFIX}/accounts`);
    assert.equal(accounts.status, 200);
    assert.deepEqual(accounts.body.data, { directory_at: null, accounts: [], agents: [] });
    assert.equal((await call("GET", `${CSI_ADMIN_PREFIX}/accounts?x=1`)).status, 400);
    const agent = `${CSI_ADMIN_PREFIX}/accounts/101/agent`;
    const connected = await call("POST", agent, { body: { agent_id: "b".repeat(24), role: "service" } });
    assert.equal(connected.status, 200);
    assert.deepEqual(connected.body.data, { account: { extension_id: "101" } });
    assert.deepEqual(calls.at(-1), ["agent", { ext: "101", body: { agent_id: "b".repeat(24), role: "service" } }]);
    assert.equal((await call("POST", agent, { body: { agent_id: null } })).status, 200);
    for (const body of [{}, { agent_id: "x" }, { agent_id: null, role: "boss" }, { agent_id: null, link_revision: 0 }])
      assert.equal((await call("POST", agent, { body })).status, 400, JSON.stringify(body));
    assert.equal((await call("POST", `${CSI_ADMIN_PREFIX}/accounts/999/agent`, { body: { agent_id: null } })).status, 404);
    const suggested = await call("POST", `${CSI_ADMIN_PREFIX}/accounts/suggest`, { body: {} });
    assert.equal(suggested.status, 200);
    assert.deepEqual(calls.at(-1), ["suggest", null]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = saved;
  }
});
