import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { computeAdminActorSignature, signAdminActorPayload } from "../services/operationsRegistry/trustedActor";
import { buildCanonicalRepActorPayload } from "../services/operationsRegistry/trustedActorCanonical";
import { createConfigurationLoader } from "../services/salesOutreach/config/load";
import { patchSalesOutreachConfiguration } from "../services/salesOutreach/config/commands";
import { MemoryConfigurationDb } from "../services/salesOutreach/config/testing";
import { createSalesOutreachRouter } from "./sales-outreach.routes";

const API_SECRET = "synthetic-sod-routes-secret";
const SIGNING_SECRET = "synthetic-sod-routes-signing";
const PATH = "/api/v1/admin/sales-outreach/configuration";
const AGENT = "cccccccccccccccccccccccc";
const saved = { api: process.env.VANTAGE_API_SECRET, signing: process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET };

const db = new MemoryConfigurationDb();
const patchActors: string[] = [];
const app = express();
app.use(express.json());
app.use(
  createSalesOutreachRouter({
    connect: async () => undefined,
    loader: createConfigurationLoader(db.store),
    patchConfiguration: (input) => {
      patchActors.push(`${input.actor.kind}:${input.actor.id}`);
      return patchSalesOutreachConfiguration(input, db.deps());
    },
    auth: { hasReviewedSalesRepLink: async (agent) => agent === AGENT },
    now: () => new Date("2026-10-04T13:00:00.000Z"),
  }),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  process.env.VANTAGE_API_SECRET = API_SECRET;
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SIGNING_SECRET;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [key, value] of [["VANTAGE_API_SECRET", saved.api], ["VANTAGE_ADMIN_PROXY_SIGNING_SECRET", saved.signing]] as const)
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

function signed(role: "owner" | "manager" | "admin" | "rep", method: "GET" | "PATCH", path = PATH): Record<string, string> {
  const timestamp = `${Date.now()}`;
  const requestId = `req-${role}-${timestamp}`;
  const fields = { adminId: `${role}-1`, email: `${role}@example.invalid`, role, timestamp, requestId, method, path };
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-secret": API_SECRET,
    "x-vantage-admin-user-id": fields.adminId,
    "x-vantage-admin-email": fields.email,
    "x-vantage-admin-role": role,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
  };
  if (role === "rep") {
    headers["x-vantage-admin-agent-id"] = AGENT;
    headers["x-vantage-admin-signature"] = signAdminActorPayload(buildCanonicalRepActorPayload({ ...fields, agentId: AGENT }), SIGNING_SECRET);
  } else headers["x-vantage-admin-signature"] = computeAdminActorSignature(fields, SIGNING_SECRET);
  return headers;
}

async function patch(role: "owner" | "manager" | "admin" | "rep", body: unknown, key: string | null = `key-${Math.random()}`) {
  const headers = signed(role, "PATCH");
  if (key !== null) headers["idempotency-key"] = key;
  const response = await fetch(`${baseUrl}${PATH}`, { method: "PATCH", headers, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as { ok: boolean; code?: string; data?: Record<string, unknown>; issues?: Array<{ path: string }> } };
}

test("GET /configuration is Owner-only, never writes, and reports the uninitialized bootstrap", async () => {
  for (const role of ["manager", "admin", "rep"] as const) {
    const response = await fetch(`${baseUrl}${PATH}`, { headers: signed(role, "GET") });
    assert.equal(response.status, 403, role);
  }
  const response = await fetch(`${baseUrl}${PATH}`, { headers: signed("owner", "GET") });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; data: { configuration_state: string; revision: number; as_of: string; value: { controls: Record<string, boolean> } } };
  assert.equal(body.ok, true);
  assert.equal(body.data.configuration_state, "uninitialized");
  assert.equal(body.data.revision, 0);
  assert.equal(body.data.as_of, "2026-10-04T13:00:00.000Z");
  assert.equal(Object.values(body.data.value.controls).some(Boolean), false);
  assert.equal(db.pointer, null);
});

test("PATCH /configuration: Owner only, Idempotency-Key required, strict body, CAS and replay", async () => {
  for (const role of ["manager", "admin", "rep"] as const) assert.equal((await patch(role, { expected_revision: 0, value: {} })).status, 403, role);
  assert.equal(patchActors.length, 0);
  const missingKey = await patch("owner", { expected_revision: 0, value: {} }, null);
  assert.deepEqual([missingKey.status, missingKey.body.code], [400, "IDEMPOTENCY_KEY_REQUIRED"]);
  const extra = await patch("owner", { expected_revision: 0, value: {}, actor: "owner" });
  assert.deepEqual([extra.status, extra.body.code], [400, "INVALID_INPUT"]);
  const invalid = await patch("owner", { expected_revision: 0, value: { controls: { goal_metrics_enabled: true } } });
  assert.deepEqual([invalid.status, invalid.body.code], [400, "INVALID_INPUT"]);
  assert.ok(invalid.body.issues?.some((i) => i.path === "goals.roster_version"));

  const created = await patch("owner", { expected_revision: 0, value: { controls: { desk_enabled: true } } }, "init");
  assert.equal(created.status, 200);
  assert.deepEqual([created.body.data?.revision, created.body.data?.changed, created.body.data?.replayed], [1, true, false]);
  const replay = await patch("owner", { expected_revision: 0, value: { controls: { desk_enabled: true } } }, "init");
  assert.deepEqual([replay.status, replay.body.data?.revision, replay.body.data?.replayed], [200, 1, true]);
  const conflict = await patch("owner", { expected_revision: 0, value: {} }, "init");
  assert.deepEqual([conflict.status, conflict.body.code], [409, "IDEMPOTENCY_CONFLICT"]);
  const stale = await patch("owner", { expected_revision: 0, value: {} });
  assert.deepEqual([stale.status, stale.body.code], [409, "REVISION_CONFLICT"]);
  assert.ok(patchActors.every((actor) => actor === "owner:owner-1"));

  const read = await fetch(`${baseUrl}${PATH}`, { headers: signed("owner", "GET") });
  const data = ((await read.json()) as { data: { configuration_state: string; revision: number; value: { controls: { desk_enabled: boolean } } } }).data;
  assert.deepEqual([data.configuration_state, data.revision, data.value.controls.desk_enabled], ["active", 1, true]);
});

test("scope other than production is refused before any service runs", async () => {
  const response = await fetch(`${baseUrl}${PATH}?scope=historical`, { headers: signed("owner", "GET") });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { code: string }).code, "INVALID_INPUT");
  const unknown = await fetch(`${baseUrl}${PATH}?debug=1`, { headers: signed("owner", "GET") });
  assert.equal(unknown.status, 400);
  const noSecret = await fetch(`${baseUrl}${PATH}`, { headers: { ...signed("owner", "GET"), "x-api-secret": "wrong" } });
  assert.equal(noSecret.status, 401);
});
