import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { computeAdminActorSignature, signAdminActorPayload } from "../services/operationsRegistry/trustedActor";
import { buildCanonicalRepActorPayload } from "../services/operationsRegistry/trustedActorCanonical";
import type { ConfigurationInspection } from "../services/salesOutreach/config/load";
import { evaluateAndProject, evaluationAdmissionOf } from "../services/salesOutreach/evaluation/evaluateJob";
import { capturedCoverage, completeConfigurationInput, periodRow, runInFakeTransaction, subjectRow } from "../services/salesOutreach/evaluation/testing";
import { MemoryDeskReadStore } from "../services/salesOutreach/reads/deskTesting";
import { activeInspection, fixedConfigurationLoader, MemoryReadStore } from "../services/salesOutreach/reads/testing";
import {
  salesOutreachDetailSchema,
  salesOutreachErrorEnvelopeSchema,
  salesOutreachLiveFrameSchema,
  salesOutreachQueueSchema,
  salesOutreachReadEnvelope,
  type SalesOutreachQueueDto,
} from "../validation/v1/salesOutreachReads";
import { createSalesOutreachRouter } from "./sales-outreach.routes";

/**
 * SRV-8 route matrix for `GET /queue`, `GET /outreach/:id` and `GET /live`: owner / manager / linked
 * Rep (own + foreign) / generic admin / unsigned / unlinked Rep; foreign-id 404 with no existence leak;
 * cursor round trip and tamper over HTTP; the scoped SSE stream (a Rep receives only its own Agent's
 * hints; version negotiation; revalidation closes the stream).
 */
const API_SECRET = "synthetic-sod-queue-secret";
const SIGNING_SECRET = "synthetic-sod-queue-signing";
const BASE = "/api/v1/admin/sales-outreach";
const REP_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const REP_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const UNLINKED = "dddddddddddddddddddddddd";
const NOW = new Date("2026-10-05T15:00:00.000Z");
const at = (iso: string) => new Date(iso);
const saved = { api: process.env.VANTAGE_API_SECRET, signing: process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET };

let inspection: ConfigurationInspection = activeInspection(completeConfigurationInput({ cadence_enforcement_enabled: true }), "v-routes", 3);
const desk = new MemoryDeskReadStore();
const readStore = new MemoryReadStore();
let linked = new Set([REP_A, REP_B]);

/** Live change source the test drives. */
let emit: ((change: unknown) => void) | null = null;
const pending: unknown[] = [];
const watchScopes: unknown[] = [];

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
    readStore,
    queueStore: desk,
    cursorSecret: "synthetic-cursor-secret",
    auth: { hasReviewedSalesRepLink: async (agent) => linked.has(agent) },
    now: () => NOW,
    live: {
      clockMs: 60,
      lifetimeMs: 5_000,
      watch: (scope) => {
        watchScopes.push(scope);
        return {
          next: () => (pending.length ? Promise.resolve(pending.shift()) : new Promise((resolve) => (emit = resolve))),
          close: async () => undefined,
        };
      },
    },
  }),
);

let baseUrl = "";
let server: ReturnType<typeof app.listen>;
const ids: Record<string, string> = {};

before(async () => {
  process.env.VANTAGE_API_SECRET = API_SECRET;
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SIGNING_SECRET;
  const admission = evaluationAdmissionOf(inspection);
  if (!admission.ok) throw new Error("not admitted");
  for (const [name, agent, received] of [
    ["a1", REP_A, "2026-10-05T13:00:00.000Z"],
    ["a2", REP_A, "2026-10-05T14:00:00.000Z"],
    ["a3", REP_A, "2026-10-05T14:50:00.000Z"],
    ["b1", REP_B, "2026-10-05T13:30:00.000Z"],
  ] as const) {
    const s = subjectRow({
      assigned_agent_id: agent,
      received_at: at(received),
      enrollment: { cohort_id: "c", kind: "intake", enrolled_at: at(received), activation_at: at(received), manifest_hash: null },
    });
    ids[name] = s.id;
    desk.evaluation.subjects.set(s.id, s);
    desk.evaluation.periods.push(periodRow(s.id, { started_at: at(received) }));
    desk.setLead(s.lead, agent);
  }
  desk.evaluation.coverage = capturedCoverage(at("2026-10-05T14:58:00.000Z"));
  for (const id of Object.values(ids))
    await runInFakeTransaction((session) => evaluateAndProject(id, admission.context, at("2026-10-05T14:59:00.000Z"), desk.evaluation, session));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const [key, value] of [["VANTAGE_API_SECRET", saved.api], ["VANTAGE_ADMIN_PROXY_SIGNING_SECRET", saved.signing]] as const)
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

type Caller = "owner" | "manager" | "admin" | "rep-a" | "rep-b" | "rep-unlinked" | "unsigned";

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
    const agentId = caller === "rep-a" ? REP_A : caller === "rep-b" ? REP_B : UNLINKED;
    signed["x-vantage-admin-agent-id"] = agentId;
    signed["x-vantage-admin-signature"] = signAdminActorPayload(buildCanonicalRepActorPayload({ ...fields, agentId }), SIGNING_SECRET);
  } else signed["x-vantage-admin-signature"] = computeAdminActorSignature(fields, SIGNING_SECRET);
  return signed;
}

async function get(caller: Caller, pathWithQuery: string) {
  const response = await fetch(`${baseUrl}${BASE}${pathWithQuery}`, { headers: headers(caller, `${BASE}${pathWithQuery}`) });
  return { status: response.status, body: (await response.json()) as { ok: boolean; code?: string; data?: Record<string, unknown>; issues?: Array<{ code: string }> } };
}

test("route matrix: queue and outreach view for owner, manager, linked rep, generic admin, unsigned and unlinked rep", async () => {
  const expected: Record<string, Partial<Record<Caller, number | string>>> = {
    "/queue": { owner: 200, manager: 200, "rep-a": 200, admin: "FORBIDDEN", unsigned: "FORBIDDEN", "rep-unlinked": "REP_NOT_LINKED" },
    [`/outreach/${ids.a1}`]: { owner: 200, manager: 200, "rep-a": 200, "rep-b": 404, admin: "FORBIDDEN", unsigned: "FORBIDDEN", "rep-unlinked": "REP_NOT_LINKED" },
  };
  for (const [route, byCaller] of Object.entries(expected))
    for (const [caller, outcome] of Object.entries(byCaller) as Array<[Caller, number | string]>) {
      const { status, body } = await get(caller, route);
      if (outcome === 200) assert.equal(status, 200, `${caller} ${route}`);
      else if (outcome === 404) assert.deepEqual([status, body.code], [404, "NOT_FOUND"], `${caller} ${route}`);
      else assert.deepEqual([status, body.code], [403, outcome], `${caller} ${route}`);
    }
  // Foreign and absent ids answer identically (no existence leak); malformed ids too.
  const foreign = await get("rep-b", `/outreach/${ids.a1}`);
  const absent = await get("rep-b", `/outreach/${"0".repeat(24)}`);
  const malformed = await get("owner", "/outreach/not-an-id");
  for (const r of [foreign, absent, malformed]) salesOutreachErrorEnvelopeSchema.parse(r.body);
  assert.deepEqual([foreign.status, foreign.body.code, absent.status, absent.body.code, malformed.status], [404, "NOT_FOUND", 404, "NOT_FOUND", 404]);
  const detail = salesOutreachReadEnvelope(salesOutreachDetailSchema).parse((await get("rep-a", `/outreach/${ids.a2}`)).body).data;
  assert.equal(detail.assignment.assignment_revision, 0);
  assert.equal(typeof detail.plan.plan_revision, "number");
});

test("queue over HTTP: filters validated, Rep forced to self, multi-page cursor round trip, tamper → 409 CURSOR_EXPIRED", async () => {
  for (const query of ["?limit=101", "?limit=0", "?sort=urgency&direction=desc", "?state=everything", `?agent_id=${REP_A}&unassigned=true`, "?debug=1", "?scope=historical"]) {
    const { status, body } = await get("owner", `/queue${query}`);
    assert.deepEqual([status, body.code], [400, "INVALID_INPUT"], query);
  }
  const foreign = await get("rep-a", `/queue?agent_id=${REP_B}`);
  assert.deepEqual([foreign.status, foreign.body.code, foreign.body.issues?.[0]?.code], [403, "FORBIDDEN", "foreign_agent"]);
  const unassigned = await get("rep-a", "/queue?unassigned=true");
  assert.deepEqual([unassigned.status, unassigned.body.code], [403, "FORBIDDEN"]);

  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page: SalesOutreachQueueDto = salesOutreachReadEnvelope(salesOutreachQueueSchema).parse(
      (await get("rep-a", `/queue?state=all_active&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)).body,
    ).data;
    seen.push(...page.rows.map((r) => r.subject_id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.deepEqual(seen.sort(), [ids.a1, ids.a2, ids.a3].sort());
  const first = salesOutreachQueueSchema.parse((await get("owner", "/queue?state=all_active&limit=1")).body.data);
  const tampered = `${first.next_cursor!.slice(0, -4)}AAAA`;
  const refused = await get("owner", `/queue?state=all_active&limit=1&cursor=${encodeURIComponent(tampered)}`);
  assert.deepEqual([refused.status, refused.body.code], [409, "CURSOR_EXPIRED"]);
  const reused = await get("rep-a", `/queue?state=all_active&limit=1&cursor=${encodeURIComponent(first.next_cursor!)}`);
  assert.deepEqual([reused.status, reused.body.code, reused.body.issues?.[0]?.code], [409, "CURSOR_EXPIRED", "scope_changed"]);
});

type Frame = ReturnType<typeof salesOutreachLiveFrameSchema.parse>;

async function openStream(caller: Caller, query = "") {
  const abort = new AbortController();
  const response = await fetch(`${baseUrl}${BASE}/live${query}`, { headers: headers(caller, `${BASE}/live`), signal: abort.signal });
  const reader = response.body?.getReader();
  let text = "";
  const frames = () => text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => salesOutreachLiveFrameSchema.parse(JSON.parse(l.slice(6))));
  const until = async (match: (f: Frame) => boolean) => {
    for (;;) {
      const found = frames().find(match);
      if (found) return found;
      const chunk = await reader!.read();
      if (chunk.done) return null;
      text += new TextDecoder().decode(chunk.value);
    }
  };
  return { response, until, close: async () => { abort.abort(); await reader?.cancel().catch(() => undefined); } };
}

const liveRow = (doc: Record<string, unknown>) => ({ operationType: "insert", fullDocument: doc });
function push(change: unknown) {
  if (emit) {
    const resolve = emit;
    emit = null;
    resolve(change);
  } else pending.push(change);
}

test("live: role gate and version negotiation before streaming; a Rep receives only its own Agent's hints", async () => {
  assert.equal((await get("admin", "/live")).status, 403);
  assert.equal((await get("unsigned", "/live")).status, 403);
  const badVersion = await get("owner", "/live?version=2");
  assert.deepEqual([badVersion.status, badVersion.body.code, badVersion.body.issues?.[0]?.code], [400, "INVALID_INPUT", "unsupported_live_version"]);

  const stream = await openStream("rep-a");
  assert.equal(stream.response.status, 200);
  assert.equal(stream.response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal((await stream.until((f) => f.reason === "connect"))?.refetch, "all");
  assert.deepEqual(watchScopes.at(-1), { role: "rep", agent_id: REP_A }, "the change stream itself is opened with the Rep's scope");
  push(liveRow({ topic: "outreach_desk", subject_ids: [ids.b1], agent_ids: [REP_B], revision: 4 }));
  push(liveRow({ topic: "outreach_desk", subject_ids: [ids.a1], agent_ids: [REP_A, REP_B], revision: 5 }));
  const frame = await stream.until((f) => f.reason === "change");
  assert.deepEqual(frame?.changes, [{ topic: "outreach_desk", subject_ids: [ids.a1], agent_ids: [REP_A], business_day: null, revision: 5 }]);
  await stream.close();
});

test("live: revalidation on each clock tick closes a Rep whose reviewed link ended and every stream once the desk is muted", async () => {
  const stream = await openStream("rep-a");
  await stream.until((f) => f.reason === "clock");
  linked = new Set([REP_B]);
  assert.equal(await stream.until(() => false), null, "the stream ended");
  linked = new Set([REP_A, REP_B]);
  const owner = await openStream("owner");
  await owner.until((f) => f.reason === "connect");
  const saved = inspection;
  inspection = activeInspection(completeConfigurationInput({ desk_enabled: false, cadence_enforcement_enabled: true }), "v-off", 4);
  assert.equal(await owner.until(() => false), null);
  const refused = await get("owner", "/live");
  assert.deepEqual([refused.status, refused.body.code], [503, "CONFIGURATION_UNAVAILABLE"]);
  inspection = saved;
});
