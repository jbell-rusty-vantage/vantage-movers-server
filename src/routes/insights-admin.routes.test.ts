import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { createInsightsAdminRouter } from "./insights-admin.routes";

const calls: string[] = [];
const fake = <T>(name: string, value: T) => async (...args: unknown[]) => {
  calls.push(`${name}:${JSON.stringify(args[0] ?? null)}`);
  return value;
};
const deps = {
  connect: async () => undefined as never,
  analytics: fake("analytics", { ok: "analytics" }) as never,
  reviews: fake("reviews", { ok: "reviews" }) as never,
  allocation: fake("allocation", { ok: "allocation" }) as never,
  dailyLeadSpend: fake("lead-spend", { ok: "lead-spend" }) as never,
  moneySpend: fake("money", { ok: "money" }) as never,
};

// Owner gate: the real signed-actor check (no signature here, so every owner-only read is refused) …
const gated = express().use(createInsightsAdminRouter(deps));
// … and a pass-through for the happy path.
const open = express().use(createInsightsAdminRouter({ ...deps, requireOwner: () => undefined }));
let gatedUrl = "";
let openUrl = "";
const servers: Array<ReturnType<express.Express["listen"]>> = [];

before(async () => {
  for (const [app, set] of [[gated, (u: string) => (gatedUrl = u)], [open, (u: string) => (openUrl = u)]] as const) {
    await new Promise<void>((resolve) => {
      const server = app.listen(0, () => resolve());
      servers.push(server);
      set(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    });
  }
});
after(() => servers.forEach((server) => server.close()));

test("money per rep, live daily spend and the Money tab are Owner-only", async () => {
  for (const path of ["/api/v1/admin/insights/allocation-cost", "/api/v1/admin/daily-operations/lead-spend", "/api/v1/admin/money/spend?range=today"]) {
    const refused = await fetch(`${gatedUrl}${path}`);
    assert.equal(refused.status, 403, path);
    const allowed = await fetch(`${openUrl}${path}`);
    assert.equal(allowed.status, 200, path);
    assert.equal((await allowed.json()).ok, true);
  }
});
