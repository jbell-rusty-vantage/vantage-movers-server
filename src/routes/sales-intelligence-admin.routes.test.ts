import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { CsiError } from "../services/salesIntelligence/auth";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { CSI_ADMIN_PREFIX, createSalesIntelligenceAdminRouter } from "./sales-intelligence-admin.routes";

const numberId = randomBytes(12).toString("hex");
const coverage = { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false };
const asOf = "2026-09-17T14:00:00.000Z";

test("CSI-04 admin routes: Owner guard, flag-off 404, scope, validation, idempotency, error mapping; reads never call a writer", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  process.env.VANTAGE_API_SECRET = "synthetic-global";
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = "synthetic-owner-signature";
  process.env.SALES_INTELLIGENCE_ENABLED = "true";
  process.env.SALES_INTELLIGENCE_OUTREACH_ENSURE = "true";
  process.env.SALES_INTELLIGENCE_DEPLOYMENT_ID = "route-test";
  process.env.TEST_MODE = "true";
  process.env.TEST_MONGO_DATABASE_NAME = "testvantagemovers_csiadminroute";
  const calls: string[] = [];
  const rebuildCalls: unknown[] = [];
  let rebuildError: CsiError | null = null;
  let outreachError = new CsiError("IDENTITY_BLOCKED");
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter({ connect: async () => {} }));
  app.use(
    createSalesIntelligenceAdminRouter({
      connect: async () => {
        calls.push("connect");
      },
      search: async (query) => {
        calls.push(`search:${JSON.stringify(query)}`);
        return { as_of: asOf, coverage, data: { items: [], cursor: null } } as never;
      },
      detail: async (id) => {
        calls.push(`detail:${id}`);
        return id === numberId ? ({ as_of: asOf, coverage, data: { id } } as never) : null;
      },
      timeline: async (id, opts) => {
        calls.push(`timeline:${id}:${JSON.stringify(opts)}`);
        return id === numberId ? ({ as_of: asOf, coverage, data: { number_id: id, items: [], cursor: null } } as never) : null;
      },
      enqueueRebuild: async (input) => {
        rebuildCalls.push(input);
        if (rebuildError) throw rebuildError;
        return { job_id: "c".repeat(24), dedupe_key: "k", number_id: input.number_id, replayed: false };
      },
      outreachCommand: async () => { throw outreachError; },
      planBackfill: async input => ({ replayed: false, response: { available: false, days: 0, windows_planned: 0,
        from: (input.command as { from: string }).from, to: (input.command as { to: string }).to, window_from: null, window_to: null } }),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ownerHeaders = (method: string, routePath: string, role = "owner", extra: Record<string, string> = {}) => {
    const fields = {
      adminId: "owner",
      email: "owner@example.test",
      role,
      timestamp: String(Date.now()),
      requestId: "req-1",
      method,
      path: routePath,
    };
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
  const numbers = `${CSI_ADMIN_PREFIX}/numbers`;
  const detailPath = `${numbers}/${numberId}`;
  const timelinePath = `${detailPath}/timeline`;
  const rebuildPath = `${detailPath}/rebuild`;

  try {
    // Authority: broad secret alone, admin role and scoped keys are denied by the boundary; nothing reaches a service.
    assert.equal((await call("GET", numbers, { headers: { "x-api-secret": "synthetic-global" } })).status, 403);
    assert.equal((await call("GET", numbers, { headers: ownerHeaders("GET", numbers, "admin") })).status, 403);
    assert.equal((await call("GET", `${numbers}?scope=historical`, { headers: ownerHeaders("GET", numbers) })).status, 403);
    assert.deepEqual(calls, []);

    const backfill = `${CSI_ADMIN_PREFIX}/backfill`;
    const plan = { expected_revision: 1, from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z", reason: "Synthetic history" };
    assert.equal((await call("POST", backfill, { headers: ownerHeaders("POST", backfill, "admin"), body: plan })).status, 403);
    assert.equal((await call("POST", `${backfill}?scope=historical`, { headers: ownerHeaders("POST", backfill), body: plan })).status, 403);
    assert.equal((await call("POST", backfill, { headers: ownerHeaders("POST", backfill), body: plan })).status, 400);
    const planned = await call("POST", backfill, { headers: ownerHeaders("POST", backfill, "owner", { "Idempotency-Key": "synthetic-plan" }), body: plan });
    assert.equal(planned.status, 202);
    assert.equal((planned.body.data as { response: { windows_planned: number } }).response.windows_planned, 0);
    calls.length = 0;

    // Search: query parsed strictly; defaults applied; full customer numbers are an Owner-only concern handled by the service.
    const searched = await call("GET", `${numbers}?q=0200&attachment=unlinked&limit=5`, { headers: ownerHeaders("GET", numbers) });
    assert.equal(searched.status, 200);
    assert.equal(searched.body.ok, true);
    assert.equal(searched.body.as_of, asOf);
    const lastCall: string = calls[calls.length - 1] ?? "";
    const searchCall = JSON.parse(lastCall.slice("search:".length)) as Record<string, unknown>;
    assert.deepEqual(searchCall, { q: "0200", attachment: "unlinked", limit: 5, hygiene: false });
    const badQuery = await call("GET", `${numbers}?limit=999`, { headers: ownerHeaders("GET", numbers) });
    assert.equal(badQuery.status, 400);
    assert.equal(badQuery.body.code, "INVALID_INPUT");
    const unknownParam = await call("GET", `${numbers}?nope=1`, { headers: ownerHeaders("GET", numbers) });
    assert.equal(unknownParam.status, 400);

    // Detail and timeline: 404 for a missing row, 400 for a malformed id.
    assert.equal((await call("GET", detailPath, { headers: ownerHeaders("GET", detailPath) })).status, 200);
    const missing = `${numbers}/${"f".repeat(24)}`;
    assert.equal((await call("GET", missing, { headers: ownerHeaders("GET", missing) })).status, 404);
    const malformed = `${numbers}/not-an-id`;
    assert.equal((await call("GET", malformed, { headers: ownerHeaders("GET", malformed) })).status, 400);
    const timeline = await call("GET", `${timelinePath}?limit=10`, { headers: ownerHeaders("GET", timelinePath) });
    assert.equal(timeline.status, 200);
    assert.equal(calls.at(-1), `timeline:${numberId}:${JSON.stringify({ cursor: undefined, limit: 10 })}`);
    assert.equal(rebuildCalls.length, 0, "no read invoked the command path");

    // Rebuild: Idempotency-Key required; body is the closed command union; only rebuild_number is accepted here.
    const body = { command: "rebuild_number", expected_revision: 3, reason: "Owner requested recount" };
    const noKey = await call("POST", rebuildPath, { headers: ownerHeaders("POST", rebuildPath), body });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.body.code, "INVALID_INPUT");
    const wrongCommand = await call("POST", rebuildPath, {
      headers: ownerHeaders("POST", rebuildPath, "owner", { "idempotency-key": "k1" }),
      body: { command: "mark_worked", expected_revision: 3 },
    });
    assert.equal(wrongCommand.status, 400);
    assert.equal(rebuildCalls.length, 0);
    const accepted = await call("POST", rebuildPath, { headers: ownerHeaders("POST", rebuildPath, "owner", { "idempotency-key": "k1" }), body });
    assert.equal(accepted.status, 202);
    assert.deepEqual(accepted.body.data, { job_id: "c".repeat(24), dedupe_key: "k", number_id: numberId, replayed: false });
    const passed = rebuildCalls[0] as { actor: { kind: string }; idempotency_key: string; expected_revision: number; reason: string };
    assert.equal(passed.actor.kind, "owner", "the trusted Owner actor, never a header-selected one");
    assert.equal(passed.idempotency_key, "k1");
    assert.equal(passed.expected_revision, 3);
    rebuildError = new CsiError("REVISION_CONFLICT");
    const conflict = await call("POST", rebuildPath, { headers: ownerHeaders("POST", rebuildPath, "owner", { "idempotency-key": "k2" }), body });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "REVISION_CONFLICT");
    rebuildError = new CsiError("IDEMPOTENCY_CONFLICT");
    const replayConflict = await call("POST", rebuildPath, { headers: ownerHeaders("POST", rebuildPath, "owner", { "idempotency-key": "k1" }), body: { ...body, reason: "changed payload" } });
    assert.equal(replayConflict.status, 409);
    assert.equal(replayConflict.body.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(replayConflict.body.request_id, "req-1");

    const outreachPath = `${CSI_ADMIN_PREFIX}/outreach/${numberId}/commands`;
    for (const [code, status] of [["IDENTITY_BLOCKED", 409], ["CONTACT_RESTRICTED", 409], ["OFFICIAL_STATE_BLOCKS_REOPEN", 409], ["EVIDENCE_SCOPE_INVALID", 400], ["SUBMISSION_CONFLICT", 409]] as const) {
      outreachError = new CsiError(code);
      const rejected = await call("POST", outreachPath, { headers: ownerHeaders("POST", outreachPath, "owner", { "idempotency-key": `reject-${code}` }), body: { command: "mark_worked", expected_revision: 1 } });
      assert.equal(rejected.status, status); assert.equal(rejected.body.code, code);
    }

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

test("CSI-09 coverage and settings: production scope, CAS, no flag patch, GET never writes", { timeout: 20000 }, async () => {
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
    capabilities: { call_log: "unknown", recording_content: "denied", webhook: "unavailable" },
    ai_paused: false,
    recordings: { pending_discovery: 0, media_pending: 0, media_stored: 0, no_recording: 0, unavailable: 0, failed: 0, eligibility_undetermined: 0 },
    stages: {
      recording: { pending: 0, leased: 0, retry: 0, paused: 0, dead_letter: 0, oldest_queued_at: null },
      transcription: { pending: 0, leased: 0, retry: 0, paused: 0, dead_letter: 0, oldest_queued_at: null },
      analysis: { pending: 0, leased: 0, retry: 0, paused: 0, dead_letter: 0, oldest_queued_at: null },
      application: { pending: 0, leased: 0, retry: 0, paused: 0, dead_letter: 0, oldest_queued_at: null },
    },
    budget: { status: "unknown", month: null, ceiling_cents: 8000, actual_cents: null, reserved_cents: null, remaining_cents: null },
    mapping_hygiene: { unmapped_inbound_numbers: 0, unmapped_directory_users: null, last_directory_sync_at: null, directory_status: "missing" },
    flags: { ENABLED: true, STT_ENABLED: false },
    models: { extraction: { name: "openai/gpt-5-mini", enabled: false }, transcription: { name: "openai/gpt-4o-mini-transcribe", enabled: false } },
    settings: { persisted: false, revision: 1, version: "csi-policy-v1", source: "accepted_defaults", timezone: "America/New_York", first_action_due_staffed_minutes: 30, missed_callback_due_staffed_minutes: 15, going_cold_staffed_minutes: 1440, monthly_ceiling_cents: 8000 },
    backfill: {
      available: false,
      owner_triggered: true,
      days: 0,
      planned: null,
      partial: null,
      complete: null,
      failed: null,
      known_complete_through: null,
      gaps: [],
      note: "not yet available",
    },
  };
  const settings = { persisted: false, revision: 1, source: "accepted_defaults", policy: { version: "csi-policy-v1" }, flags: { STT_ENABLED: false }, models: coverage.models, updated_at: null, updated_by: null };
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceBoundaryRouter({ connect: async () => {} }));
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
    assert.equal(data.capabilities.recording_content, "denied");
    assert.equal(data.budget.status, "unknown");
    assert.equal(data.budget.actual_cents, null);
    assert.equal(data.mapping_hygiene.unmapped_directory_users, null);
    assert.equal(data.backfill.available, false);
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
      body: { command: "update_settings", expected_revision: 1, policy: { version: "x" }, reason: "Owner", flags: { STT_ENABLED: true } },
    });
    assert.equal(flagged.status, 400);
    assert.equal(settingsWrites, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = saved;
  }
});
