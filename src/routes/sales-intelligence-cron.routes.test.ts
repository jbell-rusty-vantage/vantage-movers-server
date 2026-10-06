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

/** The cron entry point declares this ceiling (seconds) in vercel.json instead of inheriting a platform default. */
const CRON_FUNCTION_MAX_DURATION_SECONDS = 800;

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
    quarantined: 0,
    quarantine_retries: 0,
    straggler_reads: 0,
    settled_from_store: 0,
    sync: null,
    throttled_count: 0,
    throttle_retry_after_ms: null,
    throttle_retry_after_observed: false,
    request_id: null,
    cursor_advanced: false,
    known_complete_through: null,
    observed_complete_through: null,
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
    runLeadLinkRecovery: async () => {
      calls.push("lead-link");
      return { scanned: 2, nominated: 1, outcomes: { completed: 1 } };
    },
    retireLegacyJobs: async () => {
      calls.push("retire");
      return { retired: 2, stages: { analysis: 1, outreach_ensure: 1 } };
    },
    refreshCoverage: async () => {
      calls.push("coverage");
    },
    ensureLeadMessageIndex: async () => {
      calls.push("message-index");
    },
    runDirectorySync: async () => {
      calls.push("directory");
      return directoryResult;
    },
    drainCallLogRefresh: async () => {
      calls.push("call-log-refresh");
      return { claimed: 0 };
    },
    drainRepSmsSync: async () => {
      calls.push("rep-sms-sync");
      return { claimed: 0 };
    },
    runWebhookSubscription: async () => {
      calls.push("webhook-subscription");
      return { address: "https://example.test/api/webhooks/ringcentral", plan: "noop", action: "noop", subscription_id: "s", removed_subscription_id: null, expiration_time: null, warnings: [] };
    },
    runRepSmsSubscription: async () => {
      calls.push("rep-sms-subscription");
      return { skipped: true, reason: "capture_disabled" };
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
      assert.deepEqual(calls, ["connect", "retire", "coverage", "message-index", "recovery", "drain:7:1234", "call-log-refresh", "rep-sms-sync"], "retired stages are fenced first; the scan lease being held never blocks job draining; CC-08 refresh drains under CAPTURE_WEBHOOK");
      assert.deepEqual(recoveryHeld.body.retired_jobs, { retired: 2, stages: { analysis: 1, outreach_ensure: 1 } });
      assert.deepEqual(recoveryHeld.body.call_log_refresh, { claimed: 0 });

      // CC-08: daily subscription maintenance under CAPTURE_WEBHOOK.
      calls.length = 0;
      const subscription = await call(CSI_CRON_PATHS.webhookSubscription, auth);
      assert.equal(subscription.body.skipped, false);
      assert.equal((subscription.body.summary as { action: string }).action, "noop");
      assert.deepEqual(subscription.body.rep_sms, { skipped: true, reason: "capture_disabled" });
      assert.deepEqual(calls, ["connect", "webhook-subscription", "rep-sms-subscription"]);
      calls.length = 0;
      flags.CAPTURE_WEBHOOK = false;
      assert.deepEqual((await call(CSI_CRON_PATHS.webhookSubscription, auth)).body, { ok: true, skipped: true, reason: "disabled" });
      assert.deepEqual(calls, []);
      flags.CAPTURE_WEBHOOK = true;
      calls.length = 0;
      await call(CSI_CRON_PATHS.jobRecovery, auth);
      recoveryResult = recoverySummary({ scanned: 3, created: 1, existing: 2, watermark_after: "2026-09-17T13:59:55.000Z" });
      const recovered = await call(CSI_CRON_PATHS.jobRecovery, auth);
      assert.equal((recovered.body.receipt_recovery as RecoverySummary).created, 1);
      assert.equal(recovered.body.lead_link, undefined, "the All Numbers lead-link step is gated by SALES_INTELLIGENCE_ENABLED");

      // All Numbers: the Lead-change scan and lead-link drain run under the master flag, alone or alongside capture.
      calls.length = 0;
      flags.CAPTURE_WEBHOOK = false;
      flags.ENABLED = true;
      const leadLinkOnly = await call(CSI_CRON_PATHS.jobRecovery, auth);
      assert.equal(leadLinkOnly.body.skipped, false);
      assert.equal(leadLinkOnly.body.receipt_recovery, null);
      assert.deepEqual(leadLinkOnly.body.lead_link, { scanned: 2, nominated: 1, outcomes: { completed: 1 } });
      assert.equal("rebuild" in leadLinkOnly.body, false, "the Number rollup rebuild drain is retired");
      assert.deepEqual(calls, ["connect", "retire", "coverage", "message-index", "lead-link"]);

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
    functions: Record<string, { maxDuration?: number; experimentalTriggers?: Array<{ type: string; topic: string }> }>;
  };
  const schedules = new Map(manifest.crons.map((c) => [c.path, c.schedule]));
  // CSI-14 §4: the reconcile window is a watermark with a bounded safety
  // lookback instead of a twelve-hour floor, so a run costs far less and the
  // cadence buys fresher capture at lower total provider cost.
  assert.equal(schedules.get(CSI_CRON_PATHS.callLogReconcile), "3-59/5 * * * *");
  assert.equal(schedules.get(CSI_CRON_PATHS.jobRecovery), "* * * * *");
  // All Numbers phase B: the attachment refresh cron left with the attachments; job recovery runs the lead link.
  assert.equal(schedules.has("/api/cron/sales-intelligence-attachment-refresh"), false);
  assert.equal(
    manifest.functions["api/index.ts"]?.maxDuration,
    CRON_FUNCTION_MAX_DURATION_SECONDS,
    "the cron entry point declares its ceiling instead of inheriting a platform default",
  );
  assert.equal(schedules.get(CSI_CRON_PATHS.directorySync), "20 5 * * *", "CSI-04 directory sync is registered and handled by the same router");
  assert.equal(schedules.get(CSI_CRON_PATHS.retention), "30 4 * * *");
  assert.equal(schedules.get(CSI_CRON_PATHS.nudgeRepair), "*/5 * * * *");
  assert.equal(schedules.get(CSI_CRON_PATHS.webhookSubscription), "15 6 * * *", "CC-08 daily subscription renewal");
  assert.equal(schedules.get("/api/cron/ringcentral-call-log-sync"), "*/30 * * * *", "qualified-call sync schedule unchanged");
  const triggers = manifest.functions["api/queues/sales-intelligence-consumer.ts"]?.experimentalTriggers;
  assert.ok(triggers, "consumer function trigger registered");
  assert.equal(triggers[0]?.type, "queue/v2beta");
  assert.equal(triggers[0]?.topic, "sales-intelligence-events*");
  // Every Sales Intelligence schedule is a retained route of this router; the retired pipeline has none.
  const registered = new Set<string>(Object.values(CSI_CRON_PATHS));
  for (const cron of manifest.crons.filter((c) => c.path.startsWith("/api/cron/sales-intelligence-"))) {
    assert.ok(registered.has(cron.path), `${cron.path} is a retained route`);
  }
  for (const retired of ["extract", "apply", "transcribe", "media-fetch", "attention-publish", "outreach-ensure", "overview-refresh", "backfill-step"]) {
    assert.equal(schedules.has(`/api/cron/sales-intelligence-${retired}`), false, retired);
  }
});

test("app.ts mounts the CSI cron router before the v1 guard like the other cron routers", () => {
  const source = readFileSync(path.join(process.cwd(), "src", "app.ts"), "utf8");
  const mount = source.indexOf("app.use(salesIntelligenceCronRoutes)");
  const v1 = source.indexOf("app.use(v1Routes)");
  assert.ok(mount > -1, "router is mounted");
  assert.ok(v1 > mount, "cron router precedes v1 routes");
});

test("CC-06 Call Log sweep route: cron auth, CAPTURE_CALL_LOG gate, lease_held skip, bounded 500, nightly registration", async () => {
  const saved = { ...process.env };
  process.env.CRON_SECRET = "synthetic-cron";
  let enabled = false;
  let outcome: "held" | "ran" | "throw" = "held";
  const calls: string[] = [];
  const router = createSalesIntelligenceCronRouter({
    connect: async () => {
      calls.push("connect");
    },
    flag: ((name: string) => name === "CAPTURE_CALL_LOG" && enabled) as never,
    runCallLogSweep: async () => {
      calls.push("sweep");
      if (outcome === "throw") throw new Error('{"errorCode":"CMN-301","message":"provider body must not leak"}');
      return { skipped: outcome === "held", skip_reason: outcome === "held" ? "lease_held" : null, missing_before: 1 } as never;
    },
  });
  try {
    await withServer(router, async (call) => {
      const auth = { authorization: "Bearer synthetic-cron" };
      assert.equal((await call(CSI_CRON_PATHS.callLogSweep)).status, 401);
      assert.deepEqual((await call(CSI_CRON_PATHS.callLogSweep, auth)).body, { ok: true, skipped: true, reason: "disabled" });
      assert.deepEqual(calls, [], "a disabled sweep never connects or claims the reconcile lease");
      enabled = true;
      const held = await call(CSI_CRON_PATHS.callLogSweep, auth);
      assert.equal(held.body.reason, "lease_held");
      outcome = "ran";
      const ran = await call(CSI_CRON_PATHS.callLogSweep, { "x-cron-secret": "synthetic-cron" });
      assert.equal(ran.body.skipped, false);
      assert.equal((ran.body.summary as { missing_before: number }).missing_before, 1);
      outcome = "throw";
      const failed = await call(CSI_CRON_PATHS.callLogSweep, auth);
      assert.equal(failed.status, 500);
      assert.deepEqual(failed.body, { ok: false, error: "Call Log sweep failed" });
    });
  } finally {
    process.env = saved;
  }
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.equal(
    manifest.crons.find((c) => c.path === CSI_CRON_PATHS.callLogSweep)?.schedule,
    "40 7 * * *",
    "about 3:40 ET, after the business day",
  );
});

test("job recovery settles provisional rows from the store only when webhook capture runs without Call Log capture", async () => {
  const saved = { ...process.env };
  process.env.CRON_SECRET = "synthetic-cron";
  const flags: Record<string, boolean> = { CAPTURE_WEBHOOK: true, CAPTURE_CALL_LOG: false };
  let settles = 0;
  const router = createSalesIntelligenceCronRouter({
    connect: async () => {},
    flag: ((name: string) => flags[name] ?? false) as never,
    runReceiptRecovery: async () => recoverySummary({}),
    drainCaptureProjection: async () => ({ claimed: 0, completed: 0, failed: 0, lease_lost: 0, deadline_reached: false, outcomes: [] }),
    refreshCoverage: async () => {},
    ensureLeadMessageIndex: async () => {},
    retireLegacyJobs: async () => ({ retired: 0, stages: {} }),
    extraRecovery: [],
    settleProvisional: async () => {
      settles += 1;
      return { settled: 2 };
    },
  });
  try {
    await withServer(router, async (call) => {
      const auth = { authorization: "Bearer synthetic-cron" };
      const first = await call(CSI_CRON_PATHS.jobRecovery, auth);
      assert.deepEqual(first.body.provisional_settle, { settled: 2 });
      flags.CAPTURE_CALL_LOG = true;
      const second = await call(CSI_CRON_PATHS.jobRecovery, auth);
      assert.equal(second.body.provisional_settle, null, "the reconcile owns settling while Call Log capture runs");
    });
  } finally {
    process.env = saved;
  }
  assert.equal(settles, 1);
});

test("job recovery fences retired stages first and keeps recovering when the sweep fails", async () => {
  const saved = { ...process.env };
  process.env.CRON_SECRET = "synthetic-cron";
  const order: string[] = [];
  let failSweep = false;
  const router = createSalesIntelligenceCronRouter({
    connect: async () => {},
    flag: ((name: string) => name === "ENABLED") as never,
    refreshCoverage: async () => {},
    ensureLeadMessageIndex: async () => {},
    recordDeployment: async () => {},
    retireLegacyJobs: async () => {
      order.push("retire");
      if (failSweep) throw new Error("mongo down");
      return { retired: 1, stages: { transcription: 1 } };
    },
    runLeadLinkRecovery: async () => { order.push("lead-link"); return { scanned: 0, nominated: 0, outcomes: {} }; },
  });
  try {
    await withServer(router, async (call) => {
      const auth = { authorization: "Bearer synthetic-cron" };
      const first = await call(CSI_CRON_PATHS.jobRecovery, auth);
      assert.equal(first.status, 200);
      assert.deepEqual(first.body.retired_jobs, { retired: 1, stages: { transcription: 1 } });
      failSweep = true;
      const second = await call(CSI_CRON_PATHS.jobRecovery, auth);
      assert.equal(second.status, 200);
      assert.equal(second.body.retired_jobs, null);
      assert.deepEqual(order, ["retire", "lead-link", "retire", "lead-link"]);
    });
  } finally {
    process.env = saved;
  }
});

test("RINGCENTRAL-CAPTURE §4 minute ISync route: cron auth, CAPTURE_CALL_LOG gate, service skip reasons, bounded 500, every-minute registration", async () => {
  const saved = { ...process.env };
  process.env.CRON_SECRET = "synthetic-cron";
  let enabled = false;
  let outcome: "outside" | "ran" | "throw" = "outside";
  const calls: string[] = [];
  const router = createSalesIntelligenceCronRouter({
    connect: async () => {
      calls.push("connect");
    },
    flag: ((name: string) => name === "CAPTURE_CALL_LOG" && enabled) as never,
    runCallLogIsyncLane: async () => {
      calls.push("isync");
      if (outcome === "throw") throw new Error('{"errorCode":"CMN-301","message":"provider body must not leak"}');
      return { skipped: outcome === "outside", skip_reason: outcome === "outside" ? "outside_staffed_hours" : null, records: 2 } as never;
    },
  });
  try {
    await withServer(router, async (call) => {
      const auth = { authorization: "Bearer synthetic-cron" };
      assert.equal((await call(CSI_CRON_PATHS.callLogIsync)).status, 401);
      assert.deepEqual((await call(CSI_CRON_PATHS.callLogIsync, auth)).body, { ok: true, skipped: true, reason: "disabled" });
      assert.deepEqual(calls, [], "a disabled route never connects");
      enabled = true;
      const outside = await call(CSI_CRON_PATHS.callLogIsync, auth);
      assert.equal(outside.body.reason, "outside_staffed_hours");
      outcome = "ran";
      const ran = await call(CSI_CRON_PATHS.callLogIsync, auth);
      assert.equal(ran.body.skipped, false);
      outcome = "throw";
      const failed = await call(CSI_CRON_PATHS.callLogIsync, auth);
      assert.equal(failed.status, 500);
      assert.deepEqual(failed.body, { ok: false, error: "Call Log ISync failed" });
    });
  } finally {
    process.env = saved;
  }
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.equal(manifest.crons.find((c) => c.path === CSI_CRON_PATHS.callLogIsync)?.schedule, "* * * * *");
});

test("RINGCENTRAL-CAPTURE §5 rep SMS safety poll route: cron auth, service skip reasons, bounded 500, every-minute registration", async () => {
  const saved = { ...process.env };
  process.env.CRON_SECRET = "synthetic-cron";
  let outcome: "disabled" | "ran" | "throw" = "disabled";
  const router = createSalesIntelligenceCronRouter({
    connect: async () => undefined,
    flag: (() => false) as never,
    runRepSmsPoll: async () => {
      if (outcome === "throw") throw new Error('{"errorCode":"CMN-301","message":"provider body must not leak"}');
      return { skipped: outcome === "disabled", skip_reason: outcome === "disabled" ? "capture_disabled" : null, mailboxes: 3, polled: 1, results: [], deadline_reached: false };
    },
  });
  try {
    await withServer(router, async (call) => {
      const auth = { authorization: "Bearer synthetic-cron" };
      assert.equal((await call(CSI_CRON_PATHS.repSmsPoll)).status, 401);
      assert.equal((await call(CSI_CRON_PATHS.repSmsPoll, auth)).body.reason, "capture_disabled");
      outcome = "ran";
      assert.equal((await call(CSI_CRON_PATHS.repSmsPoll, auth)).body.skipped, false);
      outcome = "throw";
      assert.deepEqual((await call(CSI_CRON_PATHS.repSmsPoll, auth)).body, { ok: false, error: "Rep SMS poll failed" });
    });
  } finally {
    process.env = saved;
  }
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.equal(manifest.crons.find((c) => c.path === CSI_CRON_PATHS.repSmsPoll)?.schedule, "* * * * *");
});

test("RINGCENTRAL-CAPTURE §3 subscription health route: cron auth, CAPTURE_WEBHOOK gate, summary, bounded 500, 5-minute registration", async () => {
  const saved = { ...process.env };
  process.env.CRON_SECRET = "synthetic-cron";
  let captureOn = false;
  let outcome: "ran" | "throw" = "ran";
  let connects = 0;
  const summary = {
    started_at: "2026-10-05T12:00:00.000Z",
    calls: { health: "ok" as const, error_name: null, subscription_id: "calls-1", expires_at: null, warnings: 0 },
    rep_sms: { health: "filter_drift" as const, error_name: null, subscription_id: "sms-1", expires_at: null, mailboxes: 3, warnings: 0 },
  };
  const router = createSalesIntelligenceCronRouter({
    connect: async () => {
      connects += 1;
    },
    flag: ((name: string) => name === "CAPTURE_WEBHOOK" && captureOn) as never,
    runSubscriptionHealth: async () => {
      if (outcome === "throw") throw new Error('{"errorCode":"CMN-301","message":"provider body must not leak"}');
      return summary;
    },
  });
  try {
    await withServer(router, async (call) => {
      const auth = { authorization: "Bearer synthetic-cron" };
      assert.equal((await call(CSI_CRON_PATHS.subscriptionHealth)).status, 401);
      assert.deepEqual((await call(CSI_CRON_PATHS.subscriptionHealth, auth)).body, { ok: true, skipped: true, reason: "disabled" });
      assert.equal(connects, 0, "a disabled route never connects");
      captureOn = true;
      assert.deepEqual((await call(CSI_CRON_PATHS.subscriptionHealth, { "x-cron-secret": "synthetic-cron" })).body, { ok: true, summary });
      assert.equal(connects, 1);
      outcome = "throw";
      const failed = await call(CSI_CRON_PATHS.subscriptionHealth, auth);
      assert.equal(failed.status, 500);
      assert.deepEqual(failed.body, { ok: false, error: "Subscription health check failed" });
    });
  } finally {
    process.env = saved;
  }
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.equal(manifest.crons.find((c) => c.path === CSI_CRON_PATHS.subscriptionHealth)?.schedule, "*/5 * * * *");
});
