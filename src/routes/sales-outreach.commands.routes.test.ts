import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import express from "express";
import { buildCommandDtoExamples, COMMAND_DTO_EXAMPLES_DIR } from "../../ops/sales-outreach/write-command-dto-examples";
import { computeAdminActorSignature, signAdminActorPayload } from "../services/operationsRegistry/trustedActor";
import { buildCanonicalRepActorPayload } from "../services/operationsRegistry/trustedActorCanonical";
import { csiOperatorActor } from "../services/salesIntelligence/auth";
import { MemoryCommandLedger, MemoryDeskCommandStore } from "../services/salesOutreach/commands/testing";
import { patchSalesOutreachConfiguration } from "../services/salesOutreach/config/commands";
import { createConfigurationLoader } from "../services/salesOutreach/config/load";
import { MemoryConfigurationDb } from "../services/salesOutreach/config/testing";
import { localInstant } from "../services/salesOutreach/engine";
import { completeConfigurationInput, periodRow, subjectRow, TEST_AGENT_A, TEST_AGENT_B } from "../services/salesOutreach/evaluation/testing";
import { deskLeadKey } from "../services/salesOutreach/subjects/leadFacts";
import {
  salesOutreachAssignmentResponseSchema,
  salesOutreachDayOverrideResponseSchema,
  salesOutreachPlanCommandResponseSchema,
  salesOutreachRestrictionCommandResponseSchema,
  salesOutreachRestrictionsResponseSchema,
} from "../validation/v1/salesOutreachCommands";
import { salesOutreachErrorEnvelopeSchema, salesOutreachReadEnvelope } from "../validation/v1/salesOutreachReads";
import { createSalesOutreachRouter } from "./sales-outreach.routes";

/**
 * SRV-7 route matrix: every desk command over HTTP with signed owner / manager / rep (assigned and
 * foreign) / generic admin / unsigned callers, the Idempotency-Key requirement, strict bodies, and
 * every 200 body parsed with the exported command DTO schemas.
 */
const API_SECRET = "synthetic-sod-commands-secret";
const SIGNING_SECRET = "synthetic-sod-commands-signing";
const BASE = "/api/v1/admin/sales-outreach";
const NUMBER = "9".repeat(24);
const saved = { api: process.env.VANTAGE_API_SECRET, signing: process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET };

let store: MemoryDeskCommandStore;
let ledger: MemoryCommandLedger;
let db: MemoryConfigurationDb;
let subjectId = "";
let periodId = "";
let restrictionId = "";

const app = express();
app.use(express.json());
app.use((req, res, next) =>
  createSalesOutreachRouter({
    connect: async () => undefined,
    loader: createConfigurationLoader(db.store),
    auth: { hasReviewedSalesRepLink: async (agent) => agent === TEST_AGENT_A || agent === TEST_AGENT_B },
    commands: { store, run: ledger.run, audit: ledger.audit, publish: async () => undefined, configStore: db.store, writer: db.writer },
    now: () => ledger.now,
  })(req, res, next),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
before(async () => {
  process.env.VANTAGE_API_SECRET = API_SECRET;
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SIGNING_SECRET;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [key, value] of [["VANTAGE_API_SECRET", saved.api], ["VANTAGE_ADMIN_PROXY_SIGNING_SECRET", saved.signing]] as const)
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});
beforeEach(async () => {
  store = new MemoryDeskCommandStore();
  ledger = new MemoryCommandLedger([store]);
  ledger.now = new Date(localInstant("2026-10-05", 720, "America/New_York"));
  db = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration({ actor: csiOperatorActor("install"), idempotency_key: "install", expected_revision: 0, value: completeConfigurationInput() }, db.deps());
  const subject = subjectRow({ assigned_agent_id: TEST_AGENT_A, assignment_revision: 1, contact_number_ids: [NUMBER] });
  subjectId = subject.id;
  store.subjects.set(subject.id, subject);
  const period = periodRow(subject.id, { workflow: "quoted", start_kind: "transition", priority: "1" });
  periodId = period.id;
  store.periods.push(period);
  store.leads.set(deskLeadKey(subject.lead), { receiver_agent_id: TEST_AGENT_A, receiver_agent_source: "granot_username_match", domain_revision: 3, name: "Alice Rep", source_value: null, set_at: null });
  store.repNames = new Map([
    [TEST_AGENT_A, "Alice Rep"],
    [TEST_AGENT_B, "Bob Rep"],
  ]);
  store.numbers.add(NUMBER);
  restrictionId = await store.insertRestriction({ contact_number_id: NUMBER, channels: ["text"], until: null, reason: "seed", actor: csiOperatorActor("seed") });
});

type Caller = "owner" | "manager" | "admin" | "rep-a" | "rep-b" | "unsigned";

function headers(caller: Caller, method: string, routePath: string, key: string | null): Record<string, string> {
  const base: Record<string, string> = { "x-api-secret": API_SECRET, "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) };
  if (caller === "unsigned") return base;
  const role = caller.startsWith("rep") ? "rep" : caller;
  const timestamp = `${Date.now()}`;
  const requestId = `req-${caller}-${timestamp}-${Math.random()}`;
  const fields = { adminId: `${caller}-1`, email: `${caller}@example.invalid`, role, timestamp, requestId, method, path: routePath.split("?")[0]! };
  const signed: Record<string, string> = {
    ...base,
    "x-vantage-admin-user-id": fields.adminId,
    "x-vantage-admin-email": fields.email,
    "x-vantage-admin-role": role,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
  };
  if (role === "rep") {
    const agentId = caller === "rep-a" ? TEST_AGENT_A : TEST_AGENT_B;
    signed["x-vantage-admin-agent-id"] = agentId;
    signed["x-vantage-admin-signature"] = signAdminActorPayload(buildCanonicalRepActorPayload({ ...fields, agentId }), SIGNING_SECRET);
  } else signed["x-vantage-admin-signature"] = computeAdminActorSignature(fields, SIGNING_SECRET);
  return signed;
}

async function call(caller: Caller, method: "GET" | "PATCH" | "POST", route: string, body?: unknown, key: string | null = `k-${Math.random()}`) {
  const full = `${BASE}${route}`;
  const response = await fetch(`${baseUrl}${full}`, { method, headers: headers(caller, method, full, method === "GET" ? null : key), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: (await response.json()) as { ok: boolean; code?: string; data?: unknown; issues?: Array<{ path: string; code: string }> } };
}

const quotedBody = () => ({ expected_revision: 0, period_id: periodId, selected_date: "2026-10-07" });
const callbackBody = () => ({ operation: "set", expected_revision: 0, appointment_at: "2026-10-06T19:00:00.000Z" });

test("route matrix: who may send each desk command", async () => {
  const routes: Array<{ name: string; method: "PATCH" | "POST" | "GET"; route: () => string; body: () => unknown; outcomes: Record<Caller, number | string> }> = [
    { name: "quoted-followup", method: "PATCH", route: () => `/outreach/${subjectId}/quoted-followup`, body: quotedBody, outcomes: { owner: 200, manager: 200, "rep-a": 200, "rep-b": "NOT_FOUND", admin: "FORBIDDEN", unsigned: "FORBIDDEN" } },
    { name: "callback", method: "PATCH", route: () => `/outreach/${subjectId}/callback`, body: callbackBody, outcomes: { owner: 200, manager: 200, "rep-a": 200, "rep-b": "NOT_FOUND", admin: "FORBIDDEN", unsigned: "FORBIDDEN" } },
    { name: "assignment", method: "PATCH", route: () => `/outreach/${subjectId}/assignment`, body: () => ({ expected_revision: 1, agent_id: TEST_AGENT_B }), outcomes: { owner: 200, manager: 200, "rep-a": "FORBIDDEN", "rep-b": "FORBIDDEN", admin: "FORBIDDEN", unsigned: "FORBIDDEN" } },
    { name: "day-override", method: "PATCH", route: () => `/goals/${TEST_AGENT_B}/day-override`, body: () => ({ expected_revision: 1, business_date: "2026-10-06", goal: 0, reason: "absence" }), outcomes: { owner: 200, manager: 200, "rep-a": "FORBIDDEN", "rep-b": "FORBIDDEN", admin: "FORBIDDEN", unsigned: "FORBIDDEN" } },
    { name: "restrictions list", method: "GET", route: () => "/restrictions", body: () => undefined, outcomes: { owner: 200, manager: "FORBIDDEN", "rep-a": "FORBIDDEN", "rep-b": "FORBIDDEN", admin: "FORBIDDEN", unsigned: "FORBIDDEN" } },
    { name: "restriction add", method: "POST", route: () => "/restrictions", body: () => ({ contact_number_id: NUMBER, channels: ["sms"], reason: "No texts" }), outcomes: { owner: 200, manager: "FORBIDDEN", "rep-a": "FORBIDDEN", "rep-b": "FORBIDDEN", admin: "FORBIDDEN", unsigned: "FORBIDDEN" } },
    { name: "restriction confirm", method: "POST", route: () => `/restrictions/${restrictionId}/confirm`, body: () => ({ expected_revision: 1 }), outcomes: { owner: 200, manager: "FORBIDDEN", "rep-a": "FORBIDDEN", "rep-b": "FORBIDDEN", admin: "FORBIDDEN", unsigned: "FORBIDDEN" } },
    { name: "restriction lift", method: "POST", route: () => `/restrictions/${restrictionId}/lift`, body: () => ({ expected_revision: 1, reason: "Reviewed" }), outcomes: { owner: 200, manager: "FORBIDDEN", "rep-a": "FORBIDDEN", "rep-b": "FORBIDDEN", admin: "FORBIDDEN", unsigned: "FORBIDDEN" } },
  ];
  for (const r of routes) {
    for (const [caller, outcome] of Object.entries(r.outcomes) as Array<[Caller, number | string]>) {
      const { status, body } = await call(caller, r.method, r.route(), r.body());
      if (outcome === 200) assert.equal(status, 200, `${caller} ${r.name}: ${JSON.stringify(body)}`);
      else assert.deepEqual([status, body.code], [outcome === "NOT_FOUND" ? 404 : 403, outcome], `${caller} ${r.name}`);
      // Every caller starts from the seeded state, so a 200 never depends on the order.
      if (status === 200) await resetSeed();
    }
  }
});

async function resetSeed() {
  store.plans = [];
  const subject = store.subjects.get(subjectId)!;
  store.subjects.set(subjectId, { ...subject, assigned_agent_id: TEST_AGENT_A, assignment_revision: 1, revision: 1 });
  store.leads.set(deskLeadKey(subject.lead), { receiver_agent_id: TEST_AGENT_A, receiver_agent_source: "granot_username_match", domain_revision: 3, name: "Alice Rep", source_value: null, set_at: null });
  store.restrictions = store.restrictions.filter((r) => r.id === restrictionId).map((r) => ({ ...r, state: "active", revision: 1, confirmed_at: null, confirmed_by: null, resolved_at: null, resolved_by: null, resolution_reason: null }));
  db = new MemoryConfigurationDb();
  await patchSalesOutreachConfiguration({ actor: csiOperatorActor("install"), idempotency_key: "install", expected_revision: 0, value: completeConfigurationInput() }, db.deps());
}

test("every command needs an Idempotency-Key; bodies are strict; responses parse with the exported DTOs; replay returns the committed result", async () => {
  const route = `/outreach/${subjectId}/quoted-followup`;
  const missing = await call("owner", "PATCH", route, quotedBody(), null);
  assert.deepEqual([missing.status, missing.body.code], [400, "IDEMPOTENCY_KEY_REQUIRED"]);
  const strict = await call("owner", "PATCH", route, { ...quotedBody(), extra: true });
  assert.deepEqual([strict.status, strict.body.code], [400, "INVALID_INPUT"]);
  salesOutreachErrorEnvelopeSchema.parse(strict.body);
  const first = await call("rep-a", "PATCH", route, quotedBody(), "same");
  const plan = salesOutreachReadEnvelope(salesOutreachPlanCommandResponseSchema).parse(first.body).data;
  assert.deepEqual([plan.replayed, plan.plan_revision, plan.plan?.selected_date], [false, 1, "2026-10-07"]);
  const replay = salesOutreachPlanCommandResponseSchema.parse((await call("rep-a", "PATCH", route, quotedBody(), "same")).body.data);
  assert.deepEqual({ ...replay, replayed: false }, plan);
  assert.equal(replay.replayed, true);
  const conflict = await call("rep-a", "PATCH", route, { ...quotedBody(), selected_date: "2026-10-08" }, "same");
  assert.deepEqual([conflict.status, conflict.body.code], [409, "IDEMPOTENCY_CONFLICT"]);
  const stale = await call("rep-a", "PATCH", route, { ...quotedBody(), selected_date: "2026-10-08" });
  assert.deepEqual([stale.status, stale.body.code], [409, "REVISION_CONFLICT"]);
  const badCallback = await call("owner", "PATCH", `/outreach/${subjectId}/callback`, { operation: "cancel", expected_revision: 1, appointment_at: "2026-10-06T19:00:00Z" });
  assert.deepEqual([badCallback.status, badCallback.body.code], [400, "INVALID_INPUT"], "cancel takes no appointment");
  const localTime = await call("owner", "PATCH", `/outreach/${subjectId}/callback`, { operation: "set", expected_revision: 1, appointment_at: "2026-10-06T15:00:00", replace_active_plan: true });
  assert.deepEqual([localTime.status, localTime.body.code], [400, "INVALID_INPUT"], "a bare local time is refused");

  const assignment = salesOutreachAssignmentResponseSchema.parse((await call("manager", "PATCH", `/outreach/${subjectId}/assignment`, { expected_revision: 1, agent_id: TEST_AGENT_B })).body.data);
  assert.equal(assignment.assigned_agent_id, TEST_AGENT_B);
  const override = salesOutreachDayOverrideResponseSchema.parse(
    (await call("manager", "PATCH", `/goals/${TEST_AGENT_B.toUpperCase()}/day-override`, { expected_revision: 1, business_date: "2026-10-06", goal: 30, reason: "partial_day" })).body.data,
  );
  assert.deepEqual([override.agent_id, override.revision], [TEST_AGENT_B, 2]);
  const absenceWithGoal = await call("owner", "PATCH", `/goals/${TEST_AGENT_B}/day-override`, { expected_revision: 2, business_date: "2026-10-06", goal: 5, reason: "absence" });
  assert.deepEqual([absenceWithGoal.status, absenceWithGoal.body.code], [400, "INVALID_INPUT"]);
  const past = await call("manager", "PATCH", `/goals/${TEST_AGENT_B}/day-override`, { expected_revision: 2, business_date: "2026-10-01", goal: 0, reason: "absence" });
  assert.deepEqual([past.status, past.body.code, past.body.issues?.[0]?.code], [403, "FORBIDDEN", "historical_edit_owner_only"]);

  const list = salesOutreachRestrictionsResponseSchema.parse((await call("owner", "GET", "/restrictions?state=all&limit=5")).body.data);
  assert.equal(list.restrictions.length, 1);
  const lifted = salesOutreachRestrictionCommandResponseSchema.parse((await call("owner", "POST", `/restrictions/${restrictionId}/lift`, { expected_revision: 1, reason: "Reviewed" })).body.data);
  assert.equal(lifted.restriction.state, "resolved");
  const absent = await call("owner", "POST", `/restrictions/${"e".repeat(24)}/confirm`, { expected_revision: 1 });
  assert.deepEqual([absent.status, absent.body.code], [404, "NOT_FOUND"]);
  const foreignSubject = await call("owner", "PATCH", `/outreach/${"e".repeat(24)}/assignment`, { expected_revision: 1, agent_id: null });
  assert.deepEqual([foreignSubject.status, foreignSubject.body.code], [404, "NOT_FOUND"]);
});

test("command DTO examples for the admin team parse with the exported schemas and match the command services", async () => {
  const built = await buildCommandDtoExamples();
  const files = readdirSync(COMMAND_DTO_EXAMPLES_DIR).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(files, Object.keys(built).sort(), "regenerate with ops/sales-outreach/write-dto-examples.ts");
  const schemaFor = (name: string) =>
    name.startsWith("error.")
      ? salesOutreachErrorEnvelopeSchema
      : name.startsWith("quoted-followup.") || name.startsWith("callback.")
        ? salesOutreachReadEnvelope(salesOutreachPlanCommandResponseSchema)
        : name.startsWith("assignment.")
          ? salesOutreachReadEnvelope(salesOutreachAssignmentResponseSchema)
          : name.startsWith("day-override.")
            ? salesOutreachReadEnvelope(salesOutreachDayOverrideResponseSchema)
            : name.startsWith("restrictions.list")
              ? salesOutreachReadEnvelope(salesOutreachRestrictionsResponseSchema)
              : salesOutreachReadEnvelope(salesOutreachRestrictionCommandResponseSchema);
  for (const name of files) {
    const onDisk = JSON.parse(readFileSync(path.join(COMMAND_DTO_EXAMPLES_DIR, name), "utf8")) as { request?: unknown; response: unknown };
    schemaFor(name).parse(onDisk.response);
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(built[name])), `${name} drifted; regenerate it`);
  }
});
