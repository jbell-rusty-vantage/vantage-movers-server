import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { createSalesIntelligenceAdminRouter, CSI_ADMIN_PREFIX } from "../../../routes/sales-intelligence-admin.routes";
import { createSalesIntelligenceCronRouter, CSI_CRON_PATHS } from "../../../routes/sales-intelligence-cron.routes";
import { requireApiSecret } from "../../../middleware/requireApiSecret";
import { computeAdminActorSignature } from "../../operationsRegistry/trustedActor";
import { defaultStageHandlers } from "../../numberActivity/jobDispatch";
import { runAttachmentRefreshJob } from "./refresh";
import { CsiError } from "../auth";

test("actual attachment queue and five-minute cron registrations, disabled worker skips without Mongo", async () => {
  const before = process.env.SALES_INTELLIGENCE_ATTACHMENT_REFRESH;
  process.env.SALES_INTELLIGENCE_ATTACHMENT_REFRESH = "false";
  try {
    assert.equal((await runAttachmentRefreshJob()).status, "disabled");
    assert.ok(defaultStageHandlers().attachment_refresh);
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    assert.ok(config.crons.some((r: { path: string; schedule: string }) => r.path === CSI_CRON_PATHS.attachmentRefresh && r.schedule === "*/5 * * * *"));
  } finally { if (before === undefined) delete process.env.SALES_INTELLIGENCE_ATTACHMENT_REFRESH; else process.env.SALES_INTELLIGENCE_ATTACHMENT_REFRESH = before; }
});
test("Owner attachment routes and cron recovery: authority, scope, flag, strict payload, CAS mapping and read-only GET", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { VANTAGE_API_SECRET: "synthetic", VANTAGE_ADMIN_PROXY_SIGNING_SECRET: "synthetic-signing", CRON_SECRET: "synthetic-cron" });
  let enabled = true, connects = 0, writes = 0, scans = 0, drains = 0;
  const app = express(); app.use(express.json());
  app.use(createSalesIntelligenceCronRouter({ flag: f => f === "ATTACHMENT_REFRESH" && enabled,
    connect: async () => { connects++; }, runAttachmentRefresh: async () => { scans++; return { skipped: false, scanned: 0, outcomes: [] }; },
    drainAttachmentRefresh: async () => { drains++; return { outcomes: [] }; } }));
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceAdminRouter({ flag: f => f === "ENABLED" || (f === "ATTACHMENT_REFRESH" && enabled),
    connect: async () => { connects++; }, attachments: async () => ({ items: [], next_cursor: null }),
    attachmentCommand: async () => { writes++; throw new CsiError("REVISION_CONFLICT"); } }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = (method: string, path: string, role = "owner") => {
    const fields = { adminId: "synthetic-owner", email: "owner@example.test", role, timestamp: String(Date.now()), requestId: "csi05", method, path };
    return { "x-api-secret": "synthetic", "content-type": "application/json", "idempotency-key": "csi05",
      "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": role,
      "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId,
      "x-vantage-admin-signature": computeAdminActorSignature(fields, "synthetic-signing") };
  };
  const number = "a".repeat(24), lead = "b".repeat(24), path = `${CSI_ADMIN_PREFIX}/attachments`, post = `${path}/attach`;
  const body = { command: "attach_lead", contact_number_id: number, lead_ref: { model: "FormLead", id: lead }, expected_revision: 1, reason: "Synthetic evidence" };
  try {
    assert.equal((await fetch(`${base}${path}?contact_number_id=${number}`, { headers: headers("GET", path, "admin") })).status, 403);
    assert.equal((await fetch(`${base}${path}?contact_number_id=${number}&scope=historical`, { headers: headers("GET", path) })).status, 403);
    assert.equal(connects, 0);
    assert.equal((await fetch(`${base}${path}?contact_number_id=${number}`, { headers: headers("GET", path) })).status, 200);
    assert.equal(writes, 0);
    assert.equal((await fetch(`${base}${post}`, { method: "POST", headers: headers("POST", post), body: JSON.stringify({ ...body, arbitrary_lead_effect: true }) })).status, 400);
    assert.equal((await fetch(`${base}${post}`, { method: "POST", headers: headers("POST", post), body: JSON.stringify(body) })).status, 409);
    assert.equal(writes, 1);
    assert.equal((await fetch(`${base}${CSI_CRON_PATHS.attachmentRefresh}`)).status, 401);
    await fetch(`${base}${CSI_CRON_PATHS.attachmentRefresh}`, { headers: { "x-cron-secret": "synthetic-cron" } }); assert.equal(scans, 1);
    await fetch(`${base}${CSI_CRON_PATHS.jobRecovery}`, { headers: { "x-cron-secret": "synthetic-cron" } }); assert.equal(drains, 1);
    enabled = false; const before = connects;
    assert.equal((await fetch(`${base}${post}`, { method: "POST", headers: headers("POST", post), body: JSON.stringify(body) })).status, 404);
    await fetch(`${base}${CSI_CRON_PATHS.attachmentRefresh}`, { headers: { "x-cron-secret": "synthetic-cron" } });
    await fetch(`${base}${CSI_CRON_PATHS.jobRecovery}`, { headers: { "x-cron-secret": "synthetic-cron" } });
    assert.equal(connects, before); assert.equal(scans, 1); assert.equal(drains, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); process.env = saved; }
});
