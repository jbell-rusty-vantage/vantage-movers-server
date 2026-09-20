import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import type { ReconcileSummary } from "../services/numberActivity/reconcileCallLog";
import type { RecoverySummary } from "../services/numberActivity/webhookRecovery";
import type { DirectorySyncSummary } from "../services/numberActivity/directorySync";
import { createSalesIntelligenceCronRouter, CSI_CRON_PATHS } from "./sales-intelligence-cron.routes";

function reconcileSummary(partial: Partial<ReconcileSummary>): ReconcileSummary {
  return {
    ran_at: "2026-09-17T14:00:00.000Z",
    skipped: false,
    skip_reason: null,
    lease_owner_hash: null,
    window_from: null,
    window_to: null,
    windows: [],
    pages: 0,
    records: 0,
    upserts: 0,
    noops: 0,
    failures: 0,
    throttled_count: 0,
    throttle_retry_after_ms: null,
    throttle_retry_after_observed: false,
    request_id: null,
    cursor_advanced: false,
    known_complete_through: null,
    gaps_after: 0,
    error_code: null,
    runtime_ms: 0,
    ...partial,
  };
}

function recoverySummary(partial: Partial<RecoverySummary>): RecoverySummary {
  return {
    ran_at: "2026-09-17T14:00:00.000Z",
    skipped: false,
    skip_reason: null,
    lease_owner_hash: null,
    scan_from: null,
    scan_to: null,
    pages: 0,
    scanned: 0,
    created: 0,
    existing: 0,
    quarantined: [],
    failed: 0,
    published: 0,
    watermark_before: null,
    watermark_after: null,
    budget_exhausted: false,
    error_code: null,
    runtime_ms: 0,
    ...partial,
  };
}

async function withServer(
  router: express.Router,
  run: (call: (routePath: string, headers?: Record<string, string>) => Promise<{ status: number; body: Record<string, unknown> }>) => Promise<void>,
) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run(async (routePath, headers = {}) => {
      const response = await fetch(base + routePath, { method: "POST", headers, signal: AbortSignal.timeout(5000) });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("CSI cron routes: cron auth, flag-off and lease_held skips, never a provider body", async () => {
  const saved = { ...process.env };
  process.env.CRON_SECRET = "synthetic-cron";
  process.env.SALES_INTELLIGENCE_BACKFILL_DAYS = "0";
  const flags: Record<string, boolean> = { CAPTURE_CALL_LOG: false, CAPTURE_WEBHOOK: false, ENABLED: false, DIRECTORY_SYNC: false };
  const calls: string[] = [];
  let reconcileResult = reconcileSummary({ skipped: true, skip_reason: "lease_held" });
  let recoveryResult = recoverySummary({ skipped: true, skip_reason: "lease_held" });
  const router = createSalesIntelligenceCronRouter({
    connect: async () => {
      calls.push("connect");
    },
    flag: ((name: string) => flags[name] ?? false) as never,
    runCallLogReconcile: async () => {
      calls.push("reconcile");
      return reconcileResult;
    },
    runReceiptRecovery: async () => {
      calls.push("recovery");
      return recoveryResult;
    },
    drainCaptureProjection: async (max, deadlineMs) => {
      calls.push(`drain:${max}:${deadlineMs}`);
      return { claimed: 2, completed: 1, failed: 1, lease_lost: 0, deadline_reached: false, outcomes: [] };
    },
    captureDrainMax: 7,
    captureDrainDeadlineMs: 1234,
    drainRebuild: async (max, deadlineMs) => {
      calls.push(`rebuild:${max}:${deadlineMs}`);
      return { claimed: 1, completed: 1, failed: 0, lease_lost: 0, deadline_reached: false };
    },
    rebuildDrainMax: 3,
    drainRepIdentity: async () => ({ outcomes: [] }),
    runDirectorySync: async () => {
      calls.push("directory");
      return directoryResult;
    },
  });
  let directoryResult: DirectorySyncSummary = {
    ran_at: "2026-09-17T14:00:00.000Z",
    skipped: true,
    skip_reason: "lease_held",
    lease_owner_hash: null,
    changed: false,
    snapshot_id: null,
    digest: null,
    counts: null,
    pruned: 0,
    truncated: false,
    requests: 0,
    error_code: null,
    runtime_ms: 0,
  };
  try {
    await withServer(router, async (call) => {
      assert.equal((await call(CSI_CRON_PATHS.callLogReconcile)).status, 401, "no secret");
      assert.equal((await call(CSI_CRON_PATHS.callLogReconcile, { authorization: "Bearer wrong" })).status, 401);
      assert.equal((await call(CSI_CRON_PATHS.jobRecovery, { "x-cron-secret": "wrong" })).status, 401);
      assert.deepEqual(calls, [], "unauthorized calls never touch services");

      const auth = { authorization: "Bearer synthetic-cron" };
      const headerAuth = { "x-cron-secret": "synthetic-cron" };
      assert.deepEqual((await call(CSI_CRON_PATHS.callLogReconcile, auth)).body, { ok: true, skipped: true, reason: "disabled" });
      assert.deepEqual((await call(CSI_CRON_PATHS.jobRecovery, headerAuth)).body, { ok: true, skipped: true, reason: "disabled" });
      assert.deepEqual(calls, [], "disabled routes never connect or claim a lease");

      flags.CAPTURE_CALL_LOG = true;
      const held = await call(CSI_CRON_PATHS.callLogReconcile, auth);
      assert.equal(held.status, 200);
      assert.equal(held.body.skipped, true);
      assert.equal(held.body.reason, "lease_held");
      reconcileResult = reconcileSummary({ cursor_advanced: true, pages: 2, records: 5, upserts: 3 });
      const ran = await call(CSI_CRON_PATHS.callLogReconcile, headerAuth);
      assert.equal(ran.body.skipped, false);
      assert.equal((ran.body.summary as ReconcileSummary).upserts, 3);
      assert.deepEqual(calls, ["connect", "reconcile", "connect", "reconcile"]);

      calls.length = 0;
      flags.CAPTURE_WEBHOOK = true;
      const recoveryHeld = await call(CSI_CRON_PATHS.jobRecovery, auth);
      assert.equal(recoveryHeld.status, 200);
      assert.equal((recoveryHeld.body.receipt_recovery as RecoverySummary).skip_reason, "lease_held");
      assert.deepEqual(recoveryHeld.body.capture_projection, { claimed: 2, completed: 1, failed: 1, lease_lost: 0, deadline_reached: false });
      assert.deepEqual(calls, ["connect", "recovery", "drain:7:1234"], "the scan lease being held never blocks job draining");
      recoveryResult = recoverySummary({ scanned: 3, created: 1, existing: 2, watermark_after: "2026-09-17T13:59:55.000Z" });
      const recovered = await call(CSI_CRON_PATHS.jobRecovery, auth);
      assert.equal((recovered.body.receipt_recovery as RecoverySummary).created, 1);
      assert.equal(recovered.body.rebuild, null, "rebuild drain is gated by SALES_INTELLIGENCE_ENABLED");

      // CSI-04: rebuild drain under the master flag, alone or alongside capture.
      calls.length = 0;
      flags.CAPTURE_WEBHOOK = false;
      flags.ENABLED = true;
      const rebuildOnly = await call(CSI_CRON_PATHS.jobRecovery, auth);
      assert.equal(rebuildOnly.body.skipped, false);
      assert.equal(rebuildOnly.body.receipt_recovery, null);
      assert.deepEqual(rebuildOnly.body.rebuild, { claimed: 1, completed: 1, failed: 0, lease_lost: 0, deadline_reached: false });
      assert.deepEqual(calls, ["connect", "rebuild:3:1234"]);

      // CSI-04: directory sync cron — flag-off, lease_held, then a run.
      calls.length = 0;
      assert.deepEqual((await call(CSI_CRON_PATHS.directorySync, auth)).body, { ok: true, skipped: true, reason: "disabled" });
      flags.DIRECTORY_SYNC = true;
      const directoryHeld = await call(CSI_CRON_PATHS.directorySync, headerAuth);
      assert.equal(directoryHeld.body.skipped, true);
      assert.equal(directoryHeld.body.reason, "lease_held");
      directoryResult = { ...directoryResult, skipped: false, skip_reason: null, changed: true, snapshot_id: "abc", counts: { extensions: 3, users: 2, departments: 1, company_numbers: 2, queues: 1 } };
      const synced = await call(CSI_CRON_PATHS.directorySync, auth);
      assert.equal(synced.body.skipped, false);
      assert.equal((synced.body.summary as { changed: boolean }).changed, true);
      assert.deepEqual(calls, ["connect", "directory", "connect", "directory"]);
    });
  } finally {
    process.env = saved;
  }
});

test("CSI cron routes: a throwing service maps to a bounded 500 without provider content", async () => {
  const saved = { ...process.env };
  process.env.CRON_SECRET = "synthetic-cron";
  const router = createSalesIntelligenceCronRouter({
    connect: async () => {},
    flag: (() => true) as never,
    runCallLogReconcile: async () => {
      throw new Error('{"errorCode":"CMN-301","message":"provider body must not leak"}');
    },
  });
  try {
    await withServer(router, async (call) => {
      const response = await call(CSI_CRON_PATHS.callLogReconcile, { authorization: "Bearer synthetic-cron" });
      assert.equal(response.status, 500);
      assert.deepEqual(response.body, { ok: false, error: "Call Log reconcile failed" });
    });
    delete process.env.CRON_SECRET;
    await withServer(router, async (call) => {
      assert.equal((await call(CSI_CRON_PATHS.callLogReconcile, { authorization: "Bearer synthetic-cron" })).status, 500);
    });
  } finally {
    process.env = saved;
  }
});

test("vercel.json registers the CSI-03 crons and the queue consumer trigger (a handler file alone is not registration)", () => {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
    functions: Record<string, { experimentalTriggers?: Array<{ type: string; topic: string }> }>;
  };
  const schedules = new Map(manifest.crons.map((c) => [c.path, c.schedule]));
  assert.equal(schedules.get(CSI_CRON_PATHS.callLogReconcile), "3-59/10 * * * *");
  assert.equal(schedules.get(CSI_CRON_PATHS.jobRecovery), "* * * * *");
  assert.equal(schedules.get(CSI_CRON_PATHS.directorySync), "20 5 * * *", "CSI-04 directory sync is registered and handled by the same router");
  assert.equal(schedules.get(CSI_CRON_PATHS.backfillStep), "*/15 * * * *");
  assert.equal(schedules.get(CSI_CRON_PATHS.retention), "30 4 * * *");
  assert.equal(schedules.get("/api/cron/ringcentral-call-log-sync"), "*/30 * * * *", "qualified-call sync schedule unchanged");
  const triggers = manifest.functions["api/queues/sales-intelligence-consumer.ts"]?.experimentalTriggers;
  assert.ok(triggers, "consumer function trigger registered");
  assert.equal(triggers[0]?.type, "queue/v2beta");
  assert.equal(triggers[0]?.topic, "sales-intelligence-events*");
});

test("app.ts mounts the CSI cron router before the v1 guard like the other cron routers", () => {
  const source = readFileSync(path.join(process.cwd(), "src", "app.ts"), "utf8");
  const mount = source.indexOf("app.use(salesIntelligenceCronRoutes)");
  const v1 = source.indexOf("app.use(v1Routes)");
  assert.ok(mount > -1, "router is mounted");
  assert.ok(v1 > mount, "cron router precedes v1 routes");
});
