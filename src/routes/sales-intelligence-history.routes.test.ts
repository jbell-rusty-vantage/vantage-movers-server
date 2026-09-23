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
const coverage = { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false };
const subject = { contact_number_id: numberId, e164: "+15551234567", lead_refs: [{ model: "FormLead", id: leadId }], outreach_record_ids: [], conversation_ids: [], as_of: new Date("2026-09-23T12:00:00.000Z") };

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
    resolveSubject: async (input: { phone?: string }) => { calls.push(`resolve:${JSON.stringify(input)}`); return input.phone === "+10000000000" ? null : subject as never; },
    assembleStory: async (s: { contact_number_id: string | null; as_of: Date }, options?: unknown) => { calls.push(`story:${s.contact_number_id}:${JSON.stringify(options)}`); return { as_of: s.as_of.toISOString(), prose: "Story.", events: [], candidates: [], granot: [] } as never; },
    candidates: async (s: { contact_number_id: string | null }, deps: unknown) => { calls.push(`candidates:${s.contact_number_id}:${JSON.stringify(deps)}`); return []; },
    contactNumber: async (id) => { calls.push(`number:${id}`); return { contact_number: { id, e164: "+15551234567" }, attachments: [], outreach: [] } as never; },
    listAnalyses: async (id, args) => { calls.push(`analyses:${id}:${JSON.stringify(args)}`); return { items: [{ run_id: runId }], cursor: "next" } as never; },
    readAnalysis: async (id) => { calls.push(`analysis:${id}`); return id === runId ? ({ run: { id }, output: null, raw_output: null, raw_output_retained: false, step_artifacts: null, findings: [], summaries: [] }) : null; },
    readConversation: async (id) => { calls.push(`conversation:${id}`); return id === conversationId ? ({ conversation: { id }, latest_completed_run_id: null, canonical_summary: null, legacy_summary: null, findings: [] } as never) : null; },
    readMoveAssessment: async (input) => { calls.push(`assessment:${JSON.stringify(input)}`); return input.subject_key ? ({ id: oid(), subject_key: input.subject_key } as never) : null; },
    readLeadHistory: async (lead) => { calls.push(`lead:${lead.model}:${lead.id}`); return lead.id === leadId ? ({ lead: { model: lead.model, id: lead.id, name: "Ada" }, attachments: [], changes: [], granot_observations: [], bookings: [], cancellations: [], messages: [], conversations: [], outreach: [] } as never) : null; },
    prior: async (input, cov) => { calls.push(`prior:${JSON.stringify({ ...input, as_of: input.as_of instanceof Date })}:${JSON.stringify(cov)}`); return { page: { records: [], complete: true, next_cursor: null, missing_ranges: [] }, coverage: cov, allowed_followup_ids: [], instructions: [], speaker_refs: [] } as never; },
    coverage: async () => coverage as never,
  }));
  app.use(createSalesIntelligenceBoundaryRouter({ connect: async () => {} }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CSI_HISTORY_PREFIX}`;
  const get = async (path: string, headers: Record<string, string> = { "x-api-secret": "synthetic-global" }) => {
    const response = await fetch(base + path, { headers, signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: (await response.json()) as { ok: boolean; code?: string; data?: unknown; issues?: { path: string }[] } };
  };
  try {
    // Credential boundary: missing and wrong secrets never reach a reader; the CSI scoped key is fenced even when configured for the route.
    assert.equal((await get(`/analyses?contact_number_id=${numberId}`, {})).status, 401);
    assert.equal((await get(`/analyses?contact_number_id=${numberId}`, { "x-api-secret": "wrong" })).status, 401);
    const scoped = await get(`/lead?model=FormLead&id=${leadId}`, { "x-api-secret": "synthetic-scoped" });
    assert.equal(scoped.status, 403);
    assert.equal(scoped.body.code, "RUN_SCOPE_DENIED");
    assert.equal(calls.length, 0);

    enabled = false;
    const off = await get(`/analyses?contact_number_id=${numberId}`);
    assert.equal(off.status, 404);
    assert.equal(off.body.code, "FEATURE_DISABLED");
    enabled = true;
    assert.equal(calls.length, 0);

    // Validation happens before connect; issues carry paths only.
    const invalid = await get("/analyses");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "INVALID_INPUT");
    assert.ok(invalid.body.issues?.some((issue) => issue.path === "contact_number_id"));
    assert.equal((await get(`/analyses?contact_number_id=${numberId}&extra=1`)).status, 400);
    assert.equal((await get(`/lead?model=Customer&id=${leadId}`)).status, 400);
    assert.equal((await get("/move-assessment")).status, 400);
    assert.equal((await get(`/move-assessment?outreach_record_id=${oid()}&subject_key=number:${numberId}`)).status, 400);
    assert.equal((await get(`/story?phone=%2B15551234567&contact_number_id=${numberId}`)).status, 400);
    assert.equal((await get(`/story?lead_model=FormLead`)).status, 400);
    assert.equal((await get(`/analyses/not-an-id`)).status, 400);
    assert.equal(calls.filter((call) => call === "connect").length, 0);

    const list = await get(`/analyses?contact_number_id=${numberId}`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, { ok: true, data: { items: [{ run_id: runId }], cursor: "next" } });
    assert.ok(calls.includes(`analyses:${numberId}:${JSON.stringify({ limit: 25, cursor: null })}`));
    await get(`/analyses?contact_number_id=${numberId}&limit=5&cursor=abc`);
    assert.ok(calls.includes(`analyses:${numberId}:${JSON.stringify({ limit: 5, cursor: "abc" })}`));

    const detail = await get(`/analyses/${runId}`);
    assert.equal(detail.status, 200);
    assert.equal((detail.body.data as { raw_output_retained: boolean }).raw_output_retained, false);
    const missing = await get(`/analyses/${oid()}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");
    assert.equal((await get(`/conversations/${conversationId}`)).status, 200);
    assert.equal((await get(`/conversations/${oid()}`)).status, 404);

    const number = await get(`/contact-number?phone=%2B15551234567`);
    assert.equal(number.status, 200);
    assert.ok(calls.includes(`number:${numberId}`));
    assert.equal((await get(`/contact-number?phone=%2B10000000000`)).status, 404);
    await get(`/contact-number?id=${numberId}`);
    assert.equal(calls.filter((call) => call === `number:${numberId}`).length, 2);

    const story = await get(`/story?lead_model=FormLead&lead_id=${leadId}&as_of=2026-09-20T00:00:00.000Z&model_events=10`);
    assert.equal(story.status, 200);
    assert.equal((story.body.data as { prose: string }).prose, "Story.");
    assert.ok(calls.includes(`resolve:${JSON.stringify({ lead: { model: "FormLead", id: leadId }, as_of: "2026-09-20T00:00:00.000Z" })}`));
    assert.ok(calls.includes(`story:${numberId}:${JSON.stringify({ model_events: 10 })}`));

    const candidates = await get(`/lead-candidates?contact_number_id=${numberId}&stated_name=Maria&reference=form&reference=P123`);
    assert.equal(candidates.status, 200);
    assert.deepEqual((candidates.body.data as { candidates: unknown[] }).candidates, []);
    assert.ok(calls.includes(`candidates:${numberId}:${JSON.stringify({ stated_name: "Maria", reference_mentions: ["form", "P123"] })}`));

    const assessment = await get(`/move-assessment?subject_key=lead:FormLead:${leadId}&include_model_output=true`);
    assert.equal(assessment.status, 200);
    assert.ok(calls.includes(`assessment:${JSON.stringify({ subject_key: `lead:FormLead:${leadId}`, include_model_output: true })}`));
    assert.equal((await get(`/move-assessment?outreach_record_id=${oid()}`)).status, 404);

    const lead = await get(`/lead?model=FormLead&id=${leadId}`);
    assert.equal(lead.status, 200);
    assert.equal((lead.body.data as { lead: { name: string } }).lead.name, "Ada");
    assert.equal((await get(`/lead?model=CallLead&id=${oid()}`)).status, 404);

    const prior = await get(`/prior?contact_number_id=${numberId}&subject_key=number:${numberId}&exclude_conversation_id=${conversationId}`);
    assert.equal(prior.status, 200);
    assert.ok(calls.includes(`prior:${JSON.stringify({ contact_number_id: numberId, subject_key: `number:${numberId}`, outreach_record_id: null, exclude_conversation_id: conversationId, as_of: true })}:${JSON.stringify(coverage)}`));

    // Every admitted request connected first, and the boundary router never saw a history path.
    assert.ok(calls.filter((call) => call === "connect").length >= 12);
    const denied = await fetch(`${base.replace("/history", "")}/runs/${runId}/context`, { headers: { "x-api-secret": "synthetic-global" } });
    assert.equal(denied.status, 403);
  } finally {
    server.close();
    process.env = saved;
  }
});

test("history routes: a reader failure maps through the CSI status table", { timeout: 20000 }, async () => {
  const saved = { ...process.env };
  process.env.VANTAGE_API_SECRET = "synthetic-global";
  process.env.SALES_INTELLIGENCE_ENABLED = "true";
  const app = express();
  app.use("/api/v1", requireApiSecret);
  app.use(createSalesIntelligenceHistoryRouter({
    connect: async () => {},
    listAnalyses: async (_id, args) => { throw args.cursor === "bad" ? new CsiError("INVALID_INPUT") : new Error("boom"); },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${CSI_HISTORY_PREFIX}`;
  try {
    const bad = await fetch(`${base}/analyses?contact_number_id=${numberId}&cursor=bad`, { headers: { "x-api-secret": "synthetic-global" } });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { code: string }).code, "INVALID_INPUT");
    const boom = await fetch(`${base}/analyses?contact_number_id=${numberId}`, { headers: { "x-api-secret": "synthetic-global" } });
    assert.equal(boom.status, 500);
    const body = (await boom.json()) as { code: string; error: string };
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(body.error.includes("boom"), false);
  } finally {
    server.close();
    process.env = saved;
  }
});

test("history query schemas: exactly-one subject rules and defaults", () => {
  assert.equal(historyQuerySchemas.contactNumber.safeParse({}).success, false);
  assert.equal(historyQuerySchemas.contactNumber.safeParse({ phone: "+15551234567", id: numberId }).success, false);
  assert.equal(historyQuerySchemas.analyses.parse({ contact_number_id: numberId }).limit, 25);
  assert.equal(historyQuerySchemas.analyses.safeParse({ contact_number_id: numberId, limit: "500" }).success, false);
  assert.equal(historyQuerySchemas.prior.safeParse({ contact_number_id: numberId, subject_key: "customer:1" }).success, false);
  assert.equal(historyQuerySchemas.story.safeParse({ lead_model: "CallLead", lead_id: leadId }).success, true);
  assert.equal(historyQuerySchemas.candidates.safeParse({ phone: "+15551234567", reference: ["a", "b"] }).success, true);
});
