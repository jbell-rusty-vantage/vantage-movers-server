import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { createSalesIntelligenceCronRouter, CSI_CRON_PATHS } from "../../../routes/sales-intelligence-cron.routes";
import { defaultStageHandlers } from "../../numberActivity/jobDispatch";

test("CSI-12 five-minute cron, authentication, flag-off and default recovery/queue wiring", async () => {
  const env = { ...process.env }; process.env.CRON_SECRET = "synthetic-cron";
  let enabled = false, calls = 0, connects = 0;
  assert.equal(typeof defaultStageHandlers().transcription, "function");
  assert.equal(typeof defaultStageHandlers().analysis, "function"); // CSI-13 now consumes the existing handoff.
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.ok(vercel.crons.some((cron: { path: string; schedule: string }) => cron.path === CSI_CRON_PATHS.transcribe && cron.schedule === "*/5 * * * *"));
  const app = express();
  app.use(createSalesIntelligenceCronRouter({ connect: async () => { connects++; }, flag: name => enabled && name === "STT_ENABLED",
    runTranscription: async () => { calls++; return { status: "not_claimable" }; },
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(url + CSI_CRON_PATHS.transcribe)).status, 401);
    const headers = { authorization: "Bearer synthetic-cron" };
    assert.equal((await (await fetch(url + CSI_CRON_PATHS.transcribe, { headers })).json()).reason, "disabled");
    assert.equal(calls, 0); assert.equal(connects, 0);
    enabled = true;
    assert.equal((await (await fetch(url + CSI_CRON_PATHS.transcribe, { headers })).json()).skipped, true); assert.equal(calls, 1);
    const recovery = await (await fetch(url + CSI_CRON_PATHS.jobRecovery, { headers })).json();
    assert.equal(calls, 2); assert.deepEqual(recovery.transcription, { status: "not_claimable" });
    enabled = false; await fetch(url + CSI_CRON_PATHS.jobRecovery, { headers }); assert.equal(calls, 2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); process.env = env; }
});
