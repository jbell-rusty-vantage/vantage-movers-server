import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { createSalesIntelligenceCronRouter, CSI_CRON_PATHS } from "../../../routes/sales-intelligence-cron.routes";
import { defaultStageHandlers } from "../../numberActivity/jobDispatch";
test("CSI-11 queue stages, cron schedule, auth, flag-off and lease-held wiring", async () => {
  const env = { ...process.env }; process.env.CRON_SECRET = "synthetic-cron";
  let enabled = false, calls = 0;
  const handlers = defaultStageHandlers();
  assert.equal(typeof handlers.recording_discovery, "function"); assert.equal(typeof handlers.media_fetch, "function");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.ok(vercel.crons.some((cron: { path: string; schedule: string }) => cron.path === CSI_CRON_PATHS.mediaFetch && cron.schedule === "*/5 * * * *"));
  const app = express();
  app.use(createSalesIntelligenceCronRouter({ connect: async () => undefined, flag: name => enabled && name === "MEDIA_ENABLED",
    runMediaFetch: async () => { calls++; return { status: "not_claimable" }; },
    drainRecordingDiscovery: async () => { calls++; return { processed: 1 }; },
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(url + CSI_CRON_PATHS.mediaFetch)).status, 401);
    const headers = { authorization: "Bearer synthetic-cron" };
    assert.equal((await (await fetch(url + CSI_CRON_PATHS.mediaFetch, { headers })).json()).reason, "disabled"); assert.equal(calls, 0);
    enabled = true;
    assert.equal((await (await fetch(url + CSI_CRON_PATHS.mediaFetch, { headers })).json()).reason, "lease_held"); assert.equal(calls, 1);
    const recovery = await (await fetch(url + CSI_CRON_PATHS.jobRecovery, { headers })).json(); assert.equal(calls, 3);
    assert.deepEqual(recovery.recording_discovery, { processed: 1 }); assert.deepEqual(recovery.media_fetch, { status: "not_claimable" });
    enabled = false; await fetch(url + CSI_CRON_PATHS.jobRecovery, { headers }); assert.equal(calls, 3);
  } finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); process.env = env; }
});
test("CSI-11 modules never import qualification, Lead writers, budgets, STT or LLMs", () => {
  for (const file of ["discover.ts", "eligibility.ts", "media.ts", "mediaPolicy.ts", "workerSupport.ts"]) {
    const source = readFileSync(`src/services/salesIntelligence/conversations/${file}`, "utf8");
    for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
      assert.doesNotMatch(match[1]!, /ringcentral-call-lead-ingest|call-log-vetting|call-candidate-|call-session-|callLeadConvergence|leads\/|aiBudget|ai-sdk|transcribe|redaction/);
    }
  }
  const adapter = readFileSync("src/services/conversations/streamingMedia.ts", "utf8");
  assert.match(adapter, /allowOverwrite: false/); assert.match(adapter, /access: "private"/);
});
