import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import express from "express";
import { createSalesIntelligenceCronRouter, CSI_CRON_PATHS } from "../../../routes/sales-intelligence-cron.routes";
import { defaultStageHandlers } from "../../numberActivity/jobDispatch";

test("CSI-13 registered stages and authenticated cron share disabled gates before I/O", async () => {
  const saved = process.env.CRON_SECRET; process.env.CRON_SECRET = "synthetic-cron";
  let enabled = false, connects = 0, analyses = 0, applications = 0;
  for (const stage of ["analysis", "application", "number_refresh"] as const) assert.equal(typeof defaultStageHandlers()[stage], "function");
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  for (const path of [CSI_CRON_PATHS.extract, CSI_CRON_PATHS.apply]) assert(config.crons.some((c: { path: string; schedule: string }) => c.path === path && c.schedule === "*/5 * * * *"));
  const app = express(); app.use(createSalesIntelligenceCronRouter({ connect: async () => { connects++; },
    flag: name => enabled && ["ENABLED", "EXTRACTION_ENABLED"].includes(name),
    runIntelligence: async () => { analyses++; return { status: "not_claimable" }; },
    runApplication: async () => { applications++; return { outcomes: [] }; }, extraRecovery: [] }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address !== "string"); const url = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of [CSI_CRON_PATHS.extract, CSI_CRON_PATHS.apply]) {
      assert.equal((await fetch(url + path)).status, 401);
      assert.equal((await (await fetch(url + path, { headers: { authorization: "Bearer synthetic-cron" } })).json()).reason, "disabled");
    }
    assert.equal(connects, 0); enabled = true;
    for (const path of [CSI_CRON_PATHS.extract, CSI_CRON_PATHS.apply]) assert.equal((await fetch(url + path, { headers: { authorization: "Bearer synthetic-cron" } })).status, 200);
    assert.equal(analyses, 1); assert.equal(applications, 1);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
  }
});
