import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import { buildDtoExamples, DTO_EXAMPLES_DIR } from "../../ops/sales-outreach/write-dto-examples";
import { computeAdminActorSignature, signAdminActorPayload } from "../services/operationsRegistry/trustedActor";
import { buildCanonicalRepActorPayload } from "../services/operationsRegistry/trustedActorCanonical";
import type { ConfigurationInspection } from "../services/salesOutreach/config/load";
import { MemoryDeskReadStore } from "../services/salesOutreach/reads/deskTesting";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore, repDayRow } from "../services/salesOutreach/reads/testing";
import type { SalesOutreachConfigurationInput } from "../validation/v1/salesOutreach";
import { salesOutreachAdmissionsSchema } from "../validation/v1/salesOutreachEnrollment";
import { salesOutreachPerformanceSchema } from "../validation/v1/salesOutreachPerformance";
import type { PerformanceEvidence } from "../services/salesOutreach/performance/read";
import {
  salesOutreachCapabilitiesSchema,
  salesOutreachDetailSchema,
  salesOutreachErrorEnvelopeSchema,
  salesOutreachLiveFrameSchema,
  salesOutreachQueueSchema,
  salesOutreachReadEnvelope,
  salesOutreachRepDaysSchema,
  salesOutreachRepMetricsDtoSchema,
  salesOutreachTeamSchema,
} from "../validation/v1/salesOutreachReads";
import { createSalesOutreachRouter } from "./sales-outreach.routes";

/**
 * SRV-8 (M1 part) route matrix for `GET /capabilities`, `/rep-days` and `/team`:
 * owner / manager / linked rep (self) / linked rep (foreign agent) / generic admin / unsigned /
 * unlinked rep, configuration gating, and every 200 body parsed with the exported DTO schemas.
 */
const API_SECRET = "synthetic-sod-reads-secret";
const SIGNING_SECRET = "synthetic-sod-reads-signing";
const BASE = "/api/v1/admin/sales-outreach";
const REP_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const REP_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const UNLINKED = "dddddddddddddddddddddddd";
// Monday 2026-10-05, 11:00 New York (EDT).
const NOW = new Date("2026-10-05T15:00:00.000Z");
const saved = { api: process.env.VANTAGE_API_SECRET, signing: process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET };
const errorEnvelope = salesOutreachErrorEnvelopeSchema;

const desk: SalesOutreachConfigurationInput = {
  controls: { desk_enabled: true, goal_metrics_enabled: true },
  cadence: { working_days: [{ iso_weekday: 1, open_minute: 480, close_minute: 1200 }] },
  goals: {
    roster_version: "roster-1",
    default_scheduled_goal: 100,
    zero_goal_rule: "no_goal_today_excluded_from_denominator",
    rep_work_schedules: [
      { agent_id: REP_A, working_days: [1, 2, 3, 4, 5, 6, 7] },
      { agent_id: REP_B, working_days: [1, 2, 3, 4, 5, 6, 7] },
    ],
    effective_day_overrides: [{ agent_id: REP_B, business_date: "2026-10-05", goal: 50, reason: "partial_day" }],
  },
};

let inspection: ConfigurationInspection = activeInspection(desk);
const store = new MemoryReadStore();
let performanceEvidence: PerformanceEvidence = { requirements: [], volumes: [], state: null };
const app = express();
app.use(express.json());
app.use(
  createSalesOutreachRouter({
    connect: async () => undefined,
    loader: {
      inspect: () => fixedConfigurationLoader(inspection).inspect(),
      load: () => fixedConfigurationLoader(inspection).load(),
      requireActive: () => fixedConfigurationLoader(inspection).requireActive(),
    },
    readStore: store,
    metricsStore: { ownBookings: async () => [], assignedLeads: async () => [], attachedBookings: async () => [] },
    performanceStore: { readWeek: async () => performanceEvidence },
    queueStore: new MemoryDeskReadStore(),
    auth: { hasReviewedSalesRepLink: async (agent) => agent === REP_A || agent === REP_B },
    now: () => NOW,
  }),
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
beforeEach(() => {
  inspection = activeInspection(desk);
  performanceEvidence = { requirements: [], volumes: [], state: null };
  store.rows = [
    repDayRow({ agent_id: REP_A, business_day: "2026-10-05", actual_confirmed: 108, actual_awaiting_confirmation: 3, publication_revision: 7 }),
    repDayRow({ agent_id: REP_B, business_day: "2026-10-05", actual_confirmed: 20, publication_revision: 4 }),
  ];
  store.names = new Map([
    [REP_A, "Alice Rep"],
    [REP_B, "Bob Rep"],
  ]);
  store.calls = {
    scope: "call_log_all_directions",
    known_complete_through: new Date("2026-10-05T14:57:00Z"),
    last_finished_at: new Date("2026-10-05T14:58:00Z"),
    last_error_code: null,
    confirmation_success_at: new Date("2026-10-05T14:59:20Z"),
  };
  // 11:00 New York is in the staffed window: a recent call webhook keeps calls freshness green.
  store.callWebhookAt = new Date("2026-10-05T14:58:30Z");
  store.mailboxes = [];
  store.granot = new Date("2026-10-05T14:56:00Z");
  // S3's contact-event sweep has covered capture since the 1st (a missing row may then read as 0).
  store.derivation = { known_complete_through: new Date("2026-10-05T14:58:00Z"), coverage_from: new Date("2026-10-01T04:00:00Z") };
  store.queries = [];
});

type Caller = "owner" | "manager" | "admin" | "rep-a" | "rep-unlinked" | "unsigned";

function headers(caller: Caller, pathWithQuery: string): Record<string, string> {
  const base = { "x-api-secret": API_SECRET };
  if (caller === "unsigned") return base;
  const path = pathWithQuery.split("?")[0]!;
  const role = caller.startsWith("rep") ? "rep" : caller;
  const timestamp = `${Date.now()}`;
  const requestId = `req-${caller}-${timestamp}-${Math.random()}`;
  const fields = { adminId: `${caller}-1`, email: `${caller}@example.invalid`, role, timestamp, requestId, method: "GET", path };
  const signed: Record<string, string> = {
    ...base,
    "x-vantage-admin-user-id": fields.adminId,
    "x-vantage-admin-email": fields.email,
    "x-vantage-admin-role": role,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
  };
  if (role === "rep") {
    const agentId = caller === "rep-a" ? REP_A : UNLINKED;
    signed["x-vantage-admin-agent-id"] = agentId;
    signed["x-vantage-admin-signature"] = signAdminActorPayload(buildCanonicalRepActorPayload({ ...fields, agentId }), SIGNING_SECRET);
  } else signed["x-vantage-admin-signature"] = computeAdminActorSignature(fields, SIGNING_SECRET);
  return signed;
}

async function get(caller: Caller, pathWithQuery: string) {
  const response = await fetch(`${baseUrl}${BASE}${pathWithQuery}`, { headers: headers(caller, `${BASE}${pathWithQuery}`) });
  return { status: response.status, body: (await response.json()) as { ok: boolean; code?: string; data?: unknown; issues?: Array<{ path: string; code: string }> } };
}

test("route matrix: who may read capabilities, rep-days and team", async () => {
  const expected: Record<string, Record<Caller, number | string>> = {
    "/capabilities": { owner: 200, manager: 200, "rep-a": 200, admin: "FORBIDDEN", unsigned: "FORBIDDEN", "rep-unlinked": "REP_NOT_LINKED" },
    "/rep-days": { owner: 200, manager: 200, "rep-a": 200, admin: "FORBIDDEN", unsigned: "FORBIDDEN", "rep-unlinked": "REP_NOT_LINKED" },
    "/team": { owner: 200, manager: 200, "rep-a": "FORBIDDEN", admin: "FORBIDDEN", unsigned: "FORBIDDEN", "rep-unlinked": "REP_NOT_LINKED" },
    "/performance": { owner: 200, manager: 200, "rep-a": "FORBIDDEN", admin: "FORBIDDEN", unsigned: "FORBIDDEN", "rep-unlinked": "REP_NOT_LINKED" },
  };
  for (const [route, byCaller] of Object.entries(expected)) {
    for (const [caller, outcome] of Object.entries(byCaller) as Array<[Caller, number | string]>) {
      const { status, body } = await get(caller, route);
      if (outcome === 200) assert.equal(status, 200, `${caller} ${route}`);
      else assert.deepEqual([status, body.code], [403, outcome], `${caller} ${route}`);
    }
  }
  const noSecret = await fetch(`${baseUrl}${BASE}/team`, { headers: { ...headers("owner", `${BASE}/team`), "x-api-secret": "wrong" } });
  assert.equal(noSecret.status, 401);
});

test("performance keeps frozen historical goals after current goal metrics are disabled", async () => {
  inspection = activeInspection({ ...desk, controls: { desk_enabled: true, goal_metrics_enabled: false } });
  store.rows = [repDayRow({ agent_id: REP_A, business_day: "2026-09-28", actual_confirmed: 110,
    goal_snapshot: { roster_version: "past-roster", configuration_version: "past-config", goal: 100, scheduled: true, override: null },
    coverage: { state: "complete" },
  })];
  const result = await get("owner", "/performance?week_start=2026-09-28");
  assert.equal(result.status, 200);
  const data = salesOutreachPerformanceSchema.parse(result.body.data);
  const row = data.rows.find((r) => r.agent_id === REP_A)!;
  assert.equal(row.days[0]!.calls.goal, 100);
  assert.equal(row.days[0]!.calls.state, "met");
  assert.equal(row.calls.completion_rate, 1);
  assert.equal(row.calls.eligible_days, 1);
});

test("past text misses and verified zero volume survive disabling present-day SMS capture", async () => {
  inspection = activeInspection({ ...desk, controls: { desk_enabled: true, goal_metrics_enabled: true, rep_sms_capture_enabled: false } });
  performanceEvidence = {
    state: { volume_reliable_from: "2026-09-28", requirements_reliable_from: "2026-09-28", full_inventory_completed: true,
      volume_certified_through: new Date("2026-10-05T14:00:00Z") },
    volumes: [],
    requirements: [{ business_date: "2026-09-28", input_complete: true, coverage_through: "2026-09-29T04:00:00Z", obligations: [{
      obligation_id: "sms-1", period_id: "p1", channel: "sms", kind: "ordinary", business_date: "2026-09-28", slot_index: 0,
      opens_at: "2026-09-28T12:00:00Z", due_at: "2026-09-29T00:00:00Z", closes_at: "2026-09-29T00:00:00Z",
      outcome: "missed", fulfilled_by_event_id: null, fulfilled_at: null, deadline_missed: true,
      responsible_agent_id: REP_A, inherited: false, plan_id: null,
    }] }],
  };
  const data = salesOutreachPerformanceSchema.parse((await get("owner", "/performance?week_start=2026-09-28")).body.data);
  const row = data.rows.find((r) => r.agent_id === REP_A)!;
  assert.equal(row.texts.resolved_due_required, 1);
  assert.equal(row.texts.completion_rate, 0);
  assert.equal(row.texts.weekly_volume, 0);
  assert.equal(row.days[0]!.texts.state, "not_met");
});

test("rep-days: Owner/Manager see the roster; Rep sees itself; a foreign agent_id is refused, never broadened", async () => {
  const owner = salesOutreachRepDaysSchema.parse((await get("owner", "/rep-days")).body.data);
  assert.equal(owner.business_day, "2026-10-05");
  assert.equal(owner.is_today, true);
  assert.deepEqual(owner.reps?.map((r) => r.agent_id), [REP_A, REP_B]);
  const a = owner.reps![0]!;
  assert.deepEqual([a.actual_confirmed, a.goal, a.progress, a.remaining, a.goal_reached, a.agent_name], [108, 100, 1, 0, true, "Alice Rep"]);
  assert.equal(a.actual_awaiting_confirmation, 3);
  assert.equal(a.count_scope_label, "Outbound calls");
  const b = owner.reps![1]!;
  assert.deepEqual([b.goal, b.goal_provenance.basis, b.goal_provenance.override?.reason], [50, "override", "partial_day"]);
  assert.equal(owner.projection_revision, 7);
  assert.equal(owner.contract_version, "sod-v1");
  assert.equal(owner.timezone, "America/New_York");
  assert.equal(owner.as_of, NOW.toISOString());
  assert.equal(owner.freshness.calls.state, "fresh");
  // olr A3-fresh: "Calls updated" = min(confirmation, webhook) in the staffed window; diagnostics served.
  assert.deepEqual(
    [owner.freshness.calls.last_updated_at, owner.freshness.calls.age_seconds, owner.freshness.calls.last_confirmation_at, owner.freshness.calls.last_webhook_at],
    ["2026-10-05T14:58:30.000Z", 90, "2026-10-05T14:59:20.000Z", "2026-10-05T14:58:30.000Z"],
  );
  assert.equal(owner.freshness.sms.state, "not_connected");
  assert.equal(owner.freshness.granot.state, "observed");

  const filtered = salesOutreachRepDaysSchema.parse((await get("manager", `/rep-days?agent_id=${REP_B}`)).body.data);
  assert.deepEqual(filtered.reps?.map((r) => r.agent_id), [REP_B]);
  assert.deepEqual(filtered.scope, { role: "manager", agent_id: REP_B });

  const self = salesOutreachRepDaysSchema.parse((await get("rep-a", "/rep-days")).body.data);
  assert.deepEqual(self.reps?.map((r) => r.agent_id), [REP_A]);
  assert.deepEqual(self.scope, { role: "rep", agent_id: REP_A });
  const off = { value: null, unknown_reason: "cadence_disabled" };
  assert.deepEqual([self.reps![0]!.overdue_leads, self.reps![0]!.calls_due_today, self.reps![0]!.sms_due_today], [off, off, off]);
  const selfExplicit = await get("rep-a", `/rep-days?agent_id=${REP_A}`);
  assert.equal(selfExplicit.status, 200);

  store.queries = [];
  const foreign = await get("rep-a", `/rep-days?agent_id=${REP_B}`);
  assert.deepEqual([foreign.status, foreign.body.code, foreign.body.issues?.[0]?.code], [403, "FORBIDDEN", "foreign_agent"]);
  salesOutreachErrorEnvelopeSchema.parse(foreign.body);
  assert.equal(store.queries.length, 0, "a refused read touches no rows");
});

test("DTO examples for the admin team parse with the exported schemas and match the read services", async () => {
  const schemaFor = (name: string) =>
    name.startsWith("error.")
      ? errorEnvelope
      : name.startsWith("capabilities.")
        ? salesOutreachReadEnvelope(salesOutreachCapabilitiesSchema)
        : name.startsWith("rep-days.")
          ? salesOutreachReadEnvelope(salesOutreachRepDaysSchema)
          : name.startsWith("rep-metrics.")
            ? salesOutreachReadEnvelope(salesOutreachRepMetricsDtoSchema)
            : name.startsWith("queue.")
            ? salesOutreachReadEnvelope(salesOutreachQueueSchema)
            : name.startsWith("outreach.")
              ? salesOutreachReadEnvelope(salesOutreachDetailSchema)
              : name.startsWith("live.")
                ? salesOutreachLiveFrameSchema
                : name.startsWith("enrollment-admissions.")
                  ? salesOutreachReadEnvelope(salesOutreachAdmissionsSchema)
                  : salesOutreachReadEnvelope(salesOutreachTeamSchema);
  const built = await buildDtoExamples();
  const files = readdirSync(DTO_EXAMPLES_DIR).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(files, Object.keys(built).sort(), "regenerate with ops/sales-outreach/write-dto-examples.ts");
  for (const name of files) {
    const onDisk = JSON.parse(readFileSync(path.join(DTO_EXAMPLES_DIR, name), "utf8")) as unknown;
    schemaFor(name).parse(onDisk);
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(built[name])), `${name} drifted; regenerate it`);
  }
});

test("derivation watermark: before S3's contact-event sweep covers a day, a rep without a row is pending, never 0", async () => {
  store.derivation = null;
  const none = salesOutreachTeamSchema.parse((await get("owner", "/team?business_day=2026-10-04")).body.data);
  assert.deepEqual(none.daily_call_goals?.map((r) => [r.actual_confirmed, r.actual_basis]), [[null, "pending"], [null, "pending"]]);
  // The sweep started on the 5th: the 4th is outside its coverage (unknown), the 5th is covered.
  store.derivation = { known_complete_through: new Date("2026-10-05T14:58:00Z"), coverage_from: new Date("2026-10-05T04:00:00Z") };
  const before = salesOutreachTeamSchema.parse((await get("owner", "/team?business_day=2026-10-04")).body.data);
  assert.deepEqual(before.daily_call_goals?.map((r) => [r.actual_confirmed, r.coverage.state]), [[null, "unknown"], [null, "unknown"]]);
  // Derivation lags capture: coverage is the smaller watermark.
  store.rows = [];
  store.derivation = { known_complete_through: new Date("2026-10-05T14:00:00Z"), coverage_from: new Date("2026-10-01T04:00:00Z") };
  const lagging = salesOutreachTeamSchema.parse((await get("owner", "/team")).body.data);
  assert.deepEqual(lagging.daily_call_goals?.map((r) => r.actual_basis), ["pending", "pending"]);
});


test("rep-metrics signed route: self and selected Owner/Manager; foreign, unsigned and unlinked denial", async () => {
  const self = await get("rep-a", "/rep-metrics");
  assert.equal(self.status, 200);
  assert.equal(salesOutreachRepMetricsDtoSchema.parse(self.body.data).agent_id, REP_A);
  const foreign = await get("rep-a", `/rep-metrics?agent_id=${REP_B}`);
  assert.deepEqual([foreign.status, foreign.body.code], [403, "FORBIDDEN"]);
  for (const caller of ["owner", "manager"] as const) {
    const selected = await get(caller, `/rep-metrics?agent_id=${REP_B}`);
    assert.equal(selected.status, 200);
    assert.equal(salesOutreachRepMetricsDtoSchema.parse(selected.body.data).agent_id, REP_B);
    assert.equal((await get(caller, "/rep-metrics")).status, 400);
  }
  for (const caller of ["unsigned", "rep-unlinked", "admin"] as const) assert.equal((await get(caller, "/rep-metrics")).status, 403);
});
