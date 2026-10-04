import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { CsiError } from "../services/salesIntelligence/auth";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { CSI_HISTORY_PREFIX, createSalesIntelligenceHistoryRouter, historyQuerySchemas } from "./sales-intelligence-history.routes";

const oid = () => randomBytes(12).toString("hex");
const numberId = oid(), leadId = oid(), runId = oid(), conversationId = oid();
const subject = { contact_number_id: numberId, e164: "+15551234567", as_of: new Date("2026-09-23T12:00:00.000Z") };

test("history routes: secret guard, flag-off 404, validation, not-found, shapes and dependency wiring (no database)", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  process.env.VANTAGE_API_SECRET = "synthetic-global";
  process.env.SALES_INTELLIGENCE_ENABLED = "true";
  process.env.SALES_INTELLIGENCE_SCOPED_KEY_NAME = "csi";
  process.env.VANTAGE_SCOPED_API_KEYS = JSON.stringify([{ name: "csi", secret: "synthetic-scoped", routes: [{ method: "GET", path: `${CSI_HISTORY_PREFIX}/lead` }] }]);
  const calls: string[] = [];
  let enabled = true;
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceHistoryRouter({
    connect: async () => { calls.push("connect"); },
    flag: () => enabled,
    resolveSubject: async (input) => { calls.push(`resolve:${JSON.stringify(input)}`); return input.phone === "+10000000000" ? null : subject; },
    candidates: async (s, options) => { calls.push(`candidates:${s.contact_number_id}:${JSON.stringify(options)}`); return []; },
    contactNumber: async (id) => { calls.push(`number:${id}`); return { contact_number: { id, e164: "+15551234567" }, attachments: [] }; },
    readLeadHistory: async (lead) => { calls.push(`lead:${lead.model}:${lead.id}`); return lead.id === leadId ? { lead: { model: lead.model, id: lead.id, name: "Ada" }, attachments: [], changes: [], granot_observations: [], bookings: [], cancellations: [], messages: [] } : null; },
  }));
  app.use(createSalesIntelligenceBoundaryRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CSI_HISTORY_PREFIX}`;
  const get = async (path: string, headers: Record<string, string> = { "x-api-secret": "synthetic-global" }) => {
    const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    let body: { ok?: boolean; code?: string; data?: unknown; issues?: { path: string }[] } = {};
    try { body = JSON.parse(text) as typeof body; } catch { /* Express's default 404 page */ }
    return { status: response.status, body };
  };
  try {
    // Credential boundary: missing and wrong secrets never reach a reader; the scoped key is fenced even when configured for the route.
    assert.equal((await get(`/lead?model=FormLead&id=${leadId}`, {})).status, 401);
    assert.equal((await get(`/lead?model=FormLead&id=${leadId}`, { "x-api-secret": "wrong" })).status, 401);
    const scoped = await get(`/lead?model=FormLead&id=${leadId}`, { "x-api-secret": "synthetic-scoped" });
    assert.equal(scoped.status, 403);
    assert.equal(scoped.body.code, "RUN_SCOPE_DENIED");
    const rep = await get(`/lead?model=FormLead&id=${leadId}`, { "x-api-secret": "synthetic-global", "x-vantage-admin-role": "rep" });
    assert.equal(rep.status, 403);
    assert.equal(calls.length, 0);

    enabled = false;
    const off = await get(`/lead?model=FormLead&id=${leadId}`);
    assert.equal(off.status, 404);
    assert.equal(off.body.code, "FEATURE_DISABLED");
    enabled = true;
    assert.equal(calls.length, 0);

    // Validation happens before connect; issues carry paths only.
    const invalid = await get("/lead?model=FormLead");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "INVALID_INPUT");
    assert.ok(invalid.body.issues?.some((issue) => issue.path === "id"));
    assert.equal((await get(`/lead?model=Customer&id=${leadId}`)).status, 400);
    assert.equal((await get(`/lead?model=FormLead&id=${leadId}&extra=1`)).status, 400);
    assert.equal((await get(`/contact-number?phone=%2B15551234567&id=${numberId}`)).status, 400);
    assert.equal((await get(`/lead-candidates?stated_name=Maria`)).status, 400);
    assert.equal(calls.filter((call) => call === "connect").length, 0);

    const number = await get(`/contact-number?phone=%2B15551234567`);
    assert.equal(number.status, 200);
    assert.ok(calls.includes(`number:${numberId}`));
    assert.equal((await get(`/contact-number?phone=%2B10000000000`)).status, 404);
    await get(`/contact-number?id=${numberId}`);
    assert.equal(calls.filter((call) => call === `number:${numberId}`).length, 2);

    const candidates = await get(`/lead-candidates?contact_number_id=${numberId}&stated_name=Maria&reference=form&reference=P123`);
    assert.equal(candidates.status, 200);
    assert.deepEqual(candidates.body.data, { subject: { ...subject, as_of: subject.as_of.toISOString() }, candidates: [] });
    assert.ok(calls.includes(`resolve:${JSON.stringify({ contact_number_id: numberId })}`));
    assert.ok(calls.includes(`candidates:${numberId}:${JSON.stringify({ stated_name: "Maria", reference_mentions: ["form", "P123"] })}`));

    const lead = await get(`/lead?model=FormLead&id=${leadId}`);
    assert.equal(lead.status, 200);
    assert.equal((lead.body.data as { lead: { name: string } }).lead.name, "Ada");
    const missing = await get(`/lead?model=CallLead&id=${oid()}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");

    // Retired analysis, conversation, assessment, prior and story reads and the scoped run endpoints are gone.
    const before = calls.length;
    for (const path of [`/analyses?contact_number_id=${numberId}`, `/analyses/${runId}`, `/conversations/${conversationId}`,
      `/move-assessment?subject_key=number:${numberId}`, `/prior?contact_number_id=${numberId}&subject_key=number:${numberId}`,
      `/story?contact_number_id=${numberId}`]) {
      assert.equal((await get(path)).status, 404, path);
    }
    const run = await fetch(`${base.replace("/history", "")}/runs/${runId}/context`, { headers: { "x-api-secret": "synthetic-global" } });
    assert.equal(run.status, 404);
    const submit = await fetch(`${base.replace("/history", "")}/runs/${runId}/submit`, { method: "POST", headers: { "x-api-secret": "synthetic-global" } });
    assert.equal(submit.status, 404);
    assert.equal(calls.length, before);
  } finally {
    server.close();
    process.env = saved;
  }
});

test("history routes: a reader failure maps through the status table", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  process.env.VANTAGE_API_SECRET = "synthetic-global";
  process.env.SALES_INTELLIGENCE_ENABLED = "true";
  const app = express();
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceHistoryRouter({
    connect: async () => {},
    readLeadHistory: async (lead) => { throw lead.model === "CallLead" ? new CsiError("INVALID_INPUT") : new Error("boom"); },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CSI_HISTORY_PREFIX}`;
  try {
    const bad = await fetch(`${base}/lead?model=CallLead&id=${leadId}`, { headers: { "x-api-secret": "synthetic-global" } });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { code: string }).code, "INVALID_INPUT");
    const boom = await fetch(`${base}/lead?model=FormLead&id=${leadId}`, { headers: { "x-api-secret": "synthetic-global" } });
    assert.equal(boom.status, 500);
    const body = (await boom.json()) as { code: string; error: string };
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(body.error.includes("boom"), false);
  } finally {
    server.close();
    process.env = saved;
  }
});

test("history query schemas: exactly-one subject rules", () => {
  assert.equal(historyQuerySchemas.contactNumber.safeParse({}).success, false);
  assert.equal(historyQuerySchemas.contactNumber.safeParse({ phone: "+15551234567", id: numberId }).success, false);
  assert.equal(historyQuerySchemas.candidates.safeParse({ phone: "+15551234567", reference: ["a", "b"] }).success, true);
  assert.equal(historyQuerySchemas.candidates.safeParse({ phone: "+15551234567", contact_number_id: numberId }).success, false);
  assert.equal(historyQuerySchemas.lead.safeParse({ model: "CallLead", id: leadId }).success, true);
  assert.deepEqual(Object.keys(historyQuerySchemas).sort(), ["candidates", "contactNumber", "empty", "lead"]);
});
