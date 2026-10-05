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

const app = express();
app.use(
  createSalesOutreachCronRouter({
    connect: async () => undefined,
    scan: async () => {
      calls.push("scan");
      if (tailThrows) throw new Error("boom");
      return { skipped: tailSkipped, reason: tailSkipped ? "configuration_uninitialized" : null, scanned: 2, nominated: 1, conflicts: 0, cursor: null };
    },
    drain: async () => {
      calls.push("drain");
      return { outcomes: { completed: 1 } };
    },
    reconcile: async () => {
      calls.push("reconcile");
      return { skipped: false, reason: null, pages: 1, checked: 3, nominated: 1, wrapped: true };
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

test("revision reconcile runs one bounded pass", async () => {
  calls.length = 0;
  const { body } = await hit(SALES_OUTREACH_CRON_PATHS.revisionReconcile);
  assert.equal(body.skipped, false);
  assert.deepEqual(calls, ["reconcile"]);
});
