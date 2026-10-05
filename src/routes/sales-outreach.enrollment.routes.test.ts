import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { computeAdminActorSignature, signAdminActorPayload } from "../services/operationsRegistry/trustedActor";
import { buildCanonicalRepActorPayload } from "../services/operationsRegistry/trustedActorCanonical";
import { memoryEnrollmentDeps, MemoryEnrollmentStore } from "../services/salesOutreach/enrollment/testing";
import { fixedConfigurationLoader } from "../services/salesOutreach/reads/testing";
import { accepted, deskConfiguration, leadFacts, MemoryDeskSubjectStore } from "../services/salesOutreach/subjects/testing";
import { toFloridaTimestamp } from "../utils/easternTime";
import { createSalesOutreachRouter } from "./sales-outreach.routes";

/**
 * Owner enrollment endpoints: `GET /enrollment/candidates`, `POST /enrollment/report|apply|verify`
 * (IMPLEMENTATION-PLAN §5). Owner only (`migration`); report writes nothing; apply needs an
 * Idempotency-Key (the run key); in-memory stores, no Mongo.
 */
const API_SECRET = "synthetic-sod-enrollment-secret";
const SIGNING_SECRET = "synthetic-sod-enrollment-signing";
const BASE = "/api/v1/admin/sales-outreach";
const REP = "aaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = new Date("2026-10-05T12:00:00.000Z");
const saved = { api: process.env.VANTAGE_API_SECRET, signing: process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET };

const subjects = new MemoryDeskSubjectStore();
const store = new MemoryEnrollmentStore(subjects);
const configuration = deskConfiguration({ transition: { backfill_lookback_days: 90, backfill_include_upcoming_moves: true }, migration: { paused: false } });
const harness = memoryEnrollmentDeps(subjects, store);
harness.setClock(NOW.toISOString());
for (let i = 1; i <= 3; i++)
  subjects.addLead(leadFacts({ id: String(i).padStart(24, "0"), timestamp: toFloridaTimestamp(new Date("2026-10-01T14:00:00Z")), created_at: new Date("2026-10-01T14:00:02Z"), ...accepted("0", "2026-10-01T14:05:00Z") }));

const app = express();
app.use(express.json());
app.use(
  createSalesOutreachRouter({
    connect: async () => undefined,
    loader: fixedConfigurationLoader(configuration),
    enrollment: { subjects, store, run: harness.deps.run, audit: harness.deps.audit, transaction: harness.deps.transaction, sleep: async () => undefined },
    auth: { hasReviewedSalesRepLink: async (agent) => agent === REP },
    now: () => NOW,
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

type Caller = "owner" | "manager" | "admin" | "rep" | "unsigned";

function headers(caller: Caller, method: string, path: string): Record<string, string> {
  const base: Record<string, string> = { "x-api-secret": API_SECRET, "content-type": "application/json" };
  if (caller === "unsigned") return base;
  const timestamp = `${Date.now()}`;
  const requestId = `req-${caller}-${timestamp}-${Math.random()}`;
  const fields = { adminId: `${caller}-1`, email: `${caller}@example.invalid`, role: caller, timestamp, requestId, method, path };
  const signed: Record<string, string> = {
    ...base,
    "x-vantage-admin-user-id": fields.adminId,
    "x-vantage-admin-email": fields.email,
    "x-vantage-admin-role": caller,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
  };
  if (caller === "rep") {
    signed["x-vantage-admin-agent-id"] = REP;
    signed["x-vantage-admin-signature"] = signAdminActorPayload(buildCanonicalRepActorPayload({ ...fields, agentId: REP }), SIGNING_SECRET);
  } else signed["x-vantage-admin-signature"] = computeAdminActorSignature(fields, SIGNING_SECRET);
  return signed;
}

async function call(caller: Caller, method: "GET" | "POST", route: string, body?: unknown, extra: Record<string, string> = {}) {
  const path = `${BASE}${route}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...headers(caller, method, path.split("?")[0]!), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as { ok: boolean; code?: string; data?: Record<string, unknown> } };
}

test("enrollment routes are Owner-only (migration capability); Manager, Rep, generic Admin and unsigned are refused", async () => {
  const routes: Array<["GET" | "POST", string, unknown]> = [
    ["GET", "/enrollment/candidates?partition=older", undefined],
    ["POST", "/enrollment/report", { selection: { mode: "backfill_scope" } }],
    ["POST", "/enrollment/apply", { kind: "expansion", cohort_id: "c", lead_refs: [{ model: "FormLead", id: "0".repeat(24) }], manifest_hash: "a".repeat(64) }],
    ["POST", "/enrollment/verify", { run_key: "nope" }],
  ];
  for (const [method, route, body] of routes)
    for (const caller of ["manager", "rep", "admin", "unsigned"] as const) {
      const { status, body: response } = await call(caller, method, route, body, { "idempotency-key": "k" });
      assert.deepEqual([status, response.code], [403, "FORBIDDEN"], `${caller} ${method} ${route}`);
    }
});

test("report → apply (Idempotency-Key = run key) → verify, through the API", async () => {
  const report = await call("owner", "POST", "/enrollment/report", { selection: { mode: "backfill_scope" } });
  assert.equal(report.status, 200);
  const data = report.body.data as { lead_refs: unknown[]; manifest_hash: string; cohort_id: string; kind: string; writes: number };
  assert.equal(data.lead_refs.length, 3);
  assert.equal(data.writes, 0);
  assert.equal(subjects.subjects.length, 0, "report wrote nothing");
  const body = { kind: data.kind, cohort_id: data.cohort_id, lead_refs: data.lead_refs, manifest_hash: data.manifest_hash };
  const noKey = await call("owner", "POST", "/enrollment/apply", body);
  assert.deepEqual([noKey.status, noKey.body.code], [400, "IDEMPOTENCY_KEY_REQUIRED"]);
  const applied = await call("owner", "POST", "/enrollment/apply", body, { "idempotency-key": "backfill-2026-10-05" });
  assert.equal(applied.status, 200);
  assert.deepEqual([applied.body.data!.status, (applied.body.data!.counts as Record<string, number>).enrolled], ["completed", 3]);
  const verified = await call("owner", "POST", "/enrollment/verify", { run_key: "backfill-2026-10-05" });
  assert.deepEqual([verified.status, verified.body.data!.consistent], [200, true]);
  const missing = await call("owner", "POST", "/enrollment/verify", { run_key: "unknown-run" });
  assert.deepEqual([missing.status, missing.body.code], [404, "NOT_FOUND"]);
});

test("strict inputs: unknown keys, bad partitions and bad hashes are 400", async () => {
  assert.equal((await call("owner", "GET", "/enrollment/candidates?partition=everything")).status, 400);
  assert.equal((await call("owner", "GET", "/enrollment/candidates?partition=older&extra=1")).status, 400);
  assert.equal((await call("owner", "POST", "/enrollment/report", { selection: { mode: "all" } })).status, 400);
  assert.equal(
    (await call("owner", "POST", "/enrollment/apply", { kind: "expansion", cohort_id: "c", lead_refs: [], manifest_hash: "x" }, { "idempotency-key": "k2" })).status,
    400,
  );
  const page = await call("owner", "GET", "/enrollment/candidates?partition=already_enrolled&limit=2");
  assert.equal(page.status, 200);
  assert.equal((page.body.data!.items as unknown[]).length, 2);
});
