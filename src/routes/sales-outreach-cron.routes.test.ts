import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
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
      return { skipped: false, reason: null, pages: 1, checked: 3, nominated: 1, wrapped: true, decision_nominated: 0, decision_deferred: 0, decision_cap: 300 };
    },
    evaluationSweep: async () => {
      calls.push("sweep");
      if (sweepThrows) throw new Error("boom");
      return {
        skipped: sweepSkipped,
        reason: sweepSkipped ? "cadence_disabled" : null,
        due: { pages: 1, nominated: 2 },
        reconcile: { pages: 1, checked: 2, nominated: 0, wrapped: true },
      };
    },
    evaluationDrain: async () => {
      calls.push("evaluate");
      return { outcomes: { completed: 2 } };
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

test("vercel.json registers the desk crons (lead-change tail every minute, revision reconcile every 5 minutes)", () => {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  const schedules = new Map(manifest.crons.map((c) => [c.path, c.schedule]));
  assert.equal(schedules.get(SALES_OUTREACH_CRON_PATHS.leadChanges), "* * * * *");
  assert.equal(schedules.get(SALES_OUTREACH_CRON_PATHS.revisionReconcile), "*/5 * * * *");
  assert.equal(schedules.get(SALES_OUTREACH_CRON_PATHS.evaluate), "* * * * *");
  assert.ok(readFileSync(path.join(process.cwd(), "src/app.ts"), "utf8").includes("app.use(salesOutreachCronRoutes);"), "mounted before the /api/v1 guard");
});

test("cron auth is required", async () => {
  calls.length = 0;
  for (const route of Object.values(SALES_OUTREACH_CRON_PATHS)) assert.equal((await hit(route, "wrong")).status, 401);
  assert.deepEqual(calls, []);
});

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

test("lead changes: the drain runs after the tail loop and the JSON reports the loop's passes (olr B10)", async () => {
  calls.length = 0;
  tailSkipped = false;
  tailThrows = false;
  const { status, body } = await hit(SALES_OUTREACH_CRON_PATHS.leadChanges);
  assert.equal(status, 200);
  assert.deepEqual(calls, ["scan", "drain"], "one tail loop, then the drain");
  const tail = body.tail as { passes: number; caught_up: boolean; stopped_by: string };
  assert.deepEqual([tail.passes, tail.caught_up, tail.stopped_by], [3, true, "caught_up"]);
  assert.deepEqual(body.drain, { outcomes: { completed: 1 } });
});

test("revision reconcile runs one bounded pass", async () => {
  calls.length = 0;
  const { body } = await hit(SALES_OUTREACH_CRON_PATHS.revisionReconcile);
  assert.equal(body.skipped, false);
  assert.deepEqual(calls, ["reconcile"]);
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
