import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type Router } from "express";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { computeAdminActorSignature, signAdminActorPayload } from "../services/operationsRegistry/trustedActor";
import { buildCanonicalRepActorPayload } from "../services/operationsRegistry/trustedActorCanonical";
import { CsiError, requireCsiReader, isCsiRepActor, type CsiActor } from "../services/salesIntelligence/auth";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { createSalesIntelligenceCronRouter } from "./sales-intelligence-cron.routes";
import { createAdminInviteEmailRouter } from "./admin-invite-email-internal.routes";
import { CSI_ADMIN_PREFIX, createSalesIntelligenceAdminRouter } from "./sales-intelligence-admin.routes";

/**
 * Interim Sales Intelligence access (Numbers + RingCentral Accounts): every admin route is Owner-only.
 * Admin is refused, and a validly signed rep is refused too, with REP_ACCESS on or off: Numbers carry full
 * customer numbers and there is no rep scope for them. No database: every service is a stub, and `connect`
 * throws a marker (`INDEX_REQUIRED`, 500) so "the request passed the role guard" is observable per route.
 */
const API = "synthetic-global", SIGNING = "synthetic-owner-signature";
const AGENT_A = "65f0000000000000000000a1", AGENT_B = "65f0000000000000000000b2";
const IN = "65f00000000000000000c0c0";
type Role = "owner" | "admin" | "rep";

function env(flags: { rep: boolean }) {
  Object.assign(process.env, {
    VANTAGE_API_SECRET: API, VANTAGE_ADMIN_PROXY_SIGNING_SECRET: SIGNING, CRON_SECRET: "synthetic-cron-secret",
    SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true", SALES_INTELLIGENCE_NUDGE_ENABLED: "true",
    SALES_INTELLIGENCE_REP_ACCESS: flags.rep ? "true" : "false",
    SALES_INTELLIGENCE_DEPLOYMENT_ID: "rep-access-test", TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_t3brepunit",
  });
}

/** Headers exactly as the admin proxy signs them (7 lines; 8 with the Agent for a rep). */
function signed(method: string, url: string, role: Role, options: { agent?: string | null; signAgent?: string; timestamp?: number; noAgentLine?: boolean } = {}) {
  const path = url.split("?")[0]!;
  const fields = { adminId: `${role}-user`, email: `${role}@example.test`, role, timestamp: String(options.timestamp ?? Date.now()), requestId: `req-${role}`, method, path };
  const agent = options.agent === undefined ? (role === "rep" ? AGENT_A : null) : options.agent;
  const signature = role === "rep" && !options.noAgentLine
    ? signAdminActorPayload(buildCanonicalRepActorPayload({ ...fields, agentId: options.signAgent ?? agent ?? "" }), SIGNING)
    : computeAdminActorSignature(fields, SIGNING);
  return { "x-api-secret": API, "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": role,
    "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": signature,
    ...(agent ? { "x-vantage-admin-agent-id": agent } : {}) };
}

const marker = async () => { throw new CsiError("INDEX_REQUIRED"); };

async function serve(routers: Router[]) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", requireApiSecret);
  for (const router of routers) app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
function routesOf(router: Router, prefix = ""): Array<{ method: string; path: string }> {
  return (router.stack as unknown as Array<{ route?: { path: string; methods: Record<string, boolean> } }>).filter(layer => layer.route).flatMap(layer =>
    // `router.all` (the cron routes) registers `_all`; it is called with GET, as Vercel cron does.
    Object.keys(layer.route!.methods).map(method => ({ method: method === "_all" ? "GET" : method.toUpperCase(), path: layer.route!.path.slice(prefix.length) })));
}
const concrete = (path: string) => path.replace(/:[A-Za-z]+/g, IN);

type Outcome = "reached" | "401" | "403 OWNER_REQUIRED" | "403 forbidden" | "404 FEATURE_DISABLED" | "404" | string;
async function call(base: string, method: string, url: string, role: Role | null, options: Parameters<typeof signed>[3] = {}) {
  const headers: Record<string, string> = role ? signed(method, url, role, options) : { "x-api-secret": API };
  if (method !== "GET") { headers["content-type"] = "application/json"; headers["idempotency-key"] = "rep-access-key"; }
  const response = await fetch(`${base}${url}`, { method, headers, body: method === "GET" ? undefined : "{}" });
  const text = await response.text();
  let json: { code?: string } | null = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json };
}
function classify(result: { status: number; json: { code?: string } | null }): Outcome {
  if (result.status === 401) return "401";
  if (result.json?.code === "INDEX_REQUIRED") return "reached";
  if (result.status === 403) return `403 ${result.json?.code ?? ""}`.trim();
  if (result.status === 404) return result.json?.code === "FEATURE_DISABLED" ? "404 FEATURE_DISABLED" : "404";
  return "reached";
}

/** The interim contract (`docs/server-admin-slimming/evidence/S-NUM-CONTRACT.md`): no other admin route may exist. */
const INTERIM_ADMIN_ROUTES = [
  "GET /live", "GET /coverage", "GET /settings", "PATCH /settings",
  "GET /numbers", "GET /numbers/:id", "GET /numbers/:id/timeline", "POST /numbers/:id/rebuild",
  "GET /attachments", "POST /attachments/attach", "POST /attachments/:id/reject", "POST /attachments/:id/detach",
  "GET /reps", "GET /reps/:id", "POST /reps", "POST /reps/propose", "POST /reps/:id/review",
  "GET /nudges", "POST /nudges/preview", "POST /nudges",
];

test("interim access matrix: every Sales Intelligence admin route × Owner / Admin / rep (REP_ACCESS on) / rep (off)", { timeout: 120_000 }, async () => {
  const saved = { ...process.env };
  const admin = createSalesIntelligenceAdminRouter({ connect: marker, live: marker as never });
  const cron = createSalesIntelligenceCronRouter();
  const invite = createAdminInviteEmailRouter({ send: async () => ({ status: "not_configured" }) as never });
  const boundary = createSalesIntelligenceBoundaryRouter();
  const { base, close } = await serve([boundary, admin, invite, cron]);
  const rows: string[] = [];
  try {
    const adminRoutes = routesOf(admin, CSI_ADMIN_PREFIX);
    assert.deepEqual(adminRoutes.map(route => `${route.method} ${route.path}`).sort(), [...INTERIM_ADMIN_ROUTES].sort(),
      "the admin router registers exactly the Numbers and Accounts contract");
    const groups = [
      { name: "admin", routes: adminRoutes.map(route => ({ ...route, url: `${CSI_ADMIN_PREFIX}${concrete(route.path)}?scope=production` })) },
      { name: "invite", routes: routesOf(invite).map(route => ({ ...route, url: route.path })) },
      { name: "cron", routes: routesOf(cron).map(route => ({ ...route, url: route.path })) },
    ];
    for (const group of groups) for (const route of group.routes) {
      const key = `${route.method} ${route.path}`;
      const result: Record<string, Outcome> = {};
      for (const [label, role, repFlag] of [["owner", "owner", true], ["admin", "admin", true], ["rep", "rep", true], ["rep_off", "rep", false]] as const) {
        env({ rep: repFlag });
        result[label] = classify(await call(base, route.method, route.url, role));
      }
      if (group.name === "admin") {
        assert.equal(result.owner, "reached", `owner ${key}`);
        for (const label of ["admin", "rep", "rep_off"]) assert.equal(result[label], "403 OWNER_REQUIRED", `${label} ${key}`);
      } else if (group.name === "invite") {
        assert.equal(result.owner, "reached"); assert.equal(result.admin, "403 forbidden"); assert.equal(result.rep, "403 forbidden"); assert.equal(result.rep_off, "403 forbidden");
      } else {
        for (const label of ["owner", "admin", "rep", "rep_off"]) assert.equal(result[label], "401", `${label} ${key}`);
      }
      rows.push(`| ${group.name} | \`${key}\` | ${result.owner} | ${result.admin} | ${result.rep} | ${result.rep_off} |`);
    }
    // `S8_MATRIX_OUT=<file>.md` writes the Markdown table there.
    if (process.env.S8_MATRIX_OUT) {
      writeFileSync(process.env.S8_MATRIX_OUT, `| router | route | Owner | Admin | rep (REP_ACCESS on) | rep (REP_ACCESS off) |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`);
    }
  } finally {
    await close();
    process.env = saved;
  }
});

test("a validly signed rep reaches the route and is refused there; tampered, unsigned, expired or 7-line rep requests stop at the boundary", { timeout: 60_000 }, async () => {
  const saved = { ...process.env };
  env({ rep: true });
  let searches = 0;
  const admin = createSalesIntelligenceAdminRouter({ connect: async () => {}, search: (async () => { searches++; return { as_of: "x", coverage: {}, data: {} }; }) as never });
  const { base, close } = await serve([createSalesIntelligenceBoundaryRouter(), admin]);
  const url = `${CSI_ADMIN_PREFIX}/numbers`;
  try {
    const rep = await call(base, "GET", url, "rep");
    assert.equal(rep.status, 403); assert.equal(rep.json?.code, "OWNER_REQUIRED");
    for (const options of [{ agent: AGENT_B, signAgent: AGENT_A }, { agent: null, signAgent: AGENT_A }, { noAgentLine: true }, { timestamp: Date.now() - 60 * 60_000 }]) {
      assert.equal((await call(base, "GET", url, "rep", options)).status, 403, JSON.stringify(options));
    }
    assert.equal(searches, 0, "no rep request reached the Numbers read");
    // An Owner request carrying an agent header is still an unscoped Owner request.
    assert.equal((await call(base, "GET", url, "owner", { agent: AGENT_B })).status, 200);
    assert.equal(searches, 1);
    env({ rep: false });
    const off = await call(base, "GET", url, "rep");
    assert.equal(off.status, 403); assert.equal(off.json?.code, "OWNER_REQUIRED");
  } finally { await close(); process.env = saved; }
});

test("a trusted rep actor persists only { kind, id, request_id, run_id }; role and agent_id are non-enumerable", () => {
  const saved = { ...process.env };
  env({ rep: true });
  try {
    const url = `${CSI_ADMIN_PREFIX}/numbers`;
    const headers = signed("GET", url, "rep") as Record<string, string>;
    const req = { method: "GET", originalUrl: `${url}?scope=production`, url, header: (name: string) => headers[name.toLowerCase()], vantageAuth: { kind: "secret" } } as never;
    const actor = requireCsiReader(req);
    assert.ok(isCsiRepActor(actor));
    assert.equal(actor.kind, "rep"); assert.equal(actor.role, "rep"); assert.equal(actor.agent_id, AGENT_A);
    assert.deepEqual(Object.keys({ ...actor }).sort(), ["id", "kind", "request_id", "run_id"]);
    assert.deepEqual(JSON.parse(JSON.stringify(actor)), { kind: "rep", id: "rep-user", request_id: "req-rep", run_id: null });
    // A copy is not trusted (the scope can't be forged by spreading an actor).
    assert.equal(isCsiRepActor({ ...actor, role: "rep", agent_id: AGENT_B } as CsiActor), false);
  } finally { process.env = saved; }
});
