import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import express from "express";
import { createSalesOutreachContactCronRouter, SALES_OUTREACH_CONTACT_CRON_PATH } from "./sales-outreach-contact-cron.routes";

const CRON_SECRET = "synthetic-sod-contact-cron-secret";
const saved = process.env.CRON_SECRET;
const calls: string[] = [];
let smsThrows = false;

const app = express();
app.use(
  createSalesOutreachContactCronRouter({
    connect: async () => undefined,
    sweepCalls: async () => {
      calls.push("calls");
      return { skipped: false, pages: 1 };
    },
    sweepSms: async () => {
      calls.push("sms");
      if (smsThrows) throw new TypeError("boom");
      return { skipped: false, pages: 0 };
    },
    refreshSmsPending: async () => {
      calls.push("sms_pending");
      return { skipped: true, reason: "capture_disabled" };
    },
    drainContactChanges: async () => {
      calls.push("contact_changes");
      return { outcomes: {} };
    },
    drainRepDays: async () => {
      calls.push("rep_days");
      return { outcomes: {} };
    },
    refreshRepDays: async () => {
      calls.push("refresh");
      return { recounted: 0 };
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

const hit = async (secret = CRON_SECRET) => {
  const response = await fetch(`${baseUrl}${SALES_OUTREACH_CONTACT_CRON_PATH}`, { headers: { authorization: `Bearer ${secret}` } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

test("vercel.json runs the contact-events cron every minute and app.ts mounts it", () => {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
  assert.equal(new Map(manifest.crons.map((c) => [c.path, c.schedule])).get(SALES_OUTREACH_CONTACT_CRON_PATH), "* * * * *");
  assert.ok(readFileSync(path.join(process.cwd(), "src/app.ts"), "utf8").includes("app.use(salesOutreachContactCronRoutes);"));
});

test("cron auth is required", async () => {
  calls.length = 0;
  assert.equal((await hit("wrong")).status, 401);
  assert.deepEqual(calls, []);
});

test("runs every step in order; a failed step is reported and never blocks the next", async () => {
  calls.length = 0;
  smsThrows = true;
  const { status, body } = await hit();
  smsThrows = false;
  assert.equal(status, 200);
  assert.deepEqual(calls, ["calls", "sms", "sms_pending", "contact_changes", "rep_days", "refresh"]);
  assert.deepEqual(body.sms, { ok: false, error: "TypeError" });
  assert.deepEqual(body.calls, { skipped: false, pages: 1 });
  assert.deepEqual(body.sms_pending, { skipped: true, reason: "capture_disabled" }, "olr C7: step 2b runs after the SMS sweep, even when it failed");
});
