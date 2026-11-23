import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { createSalesOutreachCronRouter, SALES_OUTREACH_CRON_PATHS } from "./sales-outreach-cron.routes";

const CRON_SECRET = "synthetic-sod-cron-secret";
const saved = process.env.CRON_SECRET;
const calls: string[] = [];
let tailSkipped = false;
let tailThrows = false;
let sweepSkipped = false;
let sweepThrows = false;
const drainOptions: unknown[] = [];

const app = express();
app.use(
  createSalesOutreachCronRouter({
    connect: async () => undefined,
    scan: async () => {
      calls.push("scan");
      if (tailThrows) throw new Error("boom");
      return {
        skipped: tailSkipped,
        reason: tailSkipped ? "configuration_uninitialized" : null,
        passes: tailSkipped ? 0 : 3,
        scanned: 250,
        nominated: 250,
        conflicts: 0,
        cursor: null,
        caught_up: !tailSkipped,
        stopped_by: tailSkipped ? null : ("caught_up" as const),
        max_passes: 10,
        budget_seconds: 15,
      };
    },
    drain: async () => {
      calls.push("drain");
      return { outcomes: { completed: 1 } };
    },
    reconcile: async () => {
      calls.push("reconcile");
      return { skipped: false, reason: null, pages: 1, checked: 3, nominated: 1, wrapped: true, decision_nominated: 0, decision_deferred: 0, decision_cap: 300, hold_nominated: 0 };
    },
    evaluationSweep: async () => {
      calls.push("sweep");
      if (sweepThrows) throw new Error("boom");
      return {
        skipped: sweepSkipped,
        reason: sweepSkipped ? "cadence_disabled" : null,
        due: { pages: 1, nominated: 2 },
        coverage: { pages: 0, nominated: 0, coalesced: 0, call_through: null, sms_through: null },
        reconcile: { pages: 1, checked: 2, nominated: 0, wrapped: true },
        drain_options: sweepSkipped ? null : { max: 300, deadlineMs: 50_000, concurrency: 2 },
      };
    },
    evaluationDrain: async (options) => {
      calls.push("evaluate");
      drainOptions.push(options);
      return { outcomes: { completed: 2 }, jobs: 2, ms_total: 10, ms_p95: 5, options: options ?? { max: 100, deadlineMs: 40_000, concurrency: 1 } };
    },
  }),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  process.env.CRON_SECRET = CRON_SECRET;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

const hit = async (route: string, secret = CRON_SECRET) => {
  const response = await fetch(`${baseUrl}${route}`, { headers: { authorization: `Bearer ${secret}` } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

test("lead changes: tail pass then drain; a failed tail never blocks the drain; an inactive configuration skips both", async () => {
  calls.length = 0;
  tailSkipped = false;
  tailThrows = false;
  assert.equal((await hit(SALES_OUTREACH_CRON_PATHS.leadChanges)).body.skipped, false);
  tailThrows = true;
  assert.equal((await hit(SALES_OUTREACH_CRON_PATHS.leadChanges)).status, 200);
  tailThrows = false;
  tailSkipped = true;
  assert.deepEqual((await hit(SALES_OUTREACH_CRON_PATHS.leadChanges)).body, { ok: true, skipped: true, reason: "configuration_uninitialized" });
  assert.deepEqual(calls, ["scan", "drain", "scan", "drain", "scan"]);
});

test("evaluate: sweep then drain; a failed sweep never blocks the drain; cadence off skips both", async () => {
  calls.length = 0;
  sweepSkipped = false;
  sweepThrows = false;
  assert.equal((await hit(SALES_OUTREACH_CRON_PATHS.evaluate)).body.skipped, false);
  sweepThrows = true;
  assert.equal((await hit(SALES_OUTREACH_CRON_PATHS.evaluate)).status, 200);
  sweepThrows = false;
  sweepSkipped = true;
  assert.deepEqual((await hit(SALES_OUTREACH_CRON_PATHS.evaluate)).body, { ok: true, skipped: true, reason: "cadence_disabled" });
  assert.deepEqual(calls, ["sweep", "evaluate", "sweep", "evaluate", "sweep"]);
});
