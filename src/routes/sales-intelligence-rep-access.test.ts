import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { type Router } from "express";
import { requireApiSecret } from "../middleware/requireApiSecret";
import { computeAdminActorSignature, signAdminActorPayload } from "../services/operationsRegistry/trustedActor";
import { buildCanonicalRepActorPayload } from "../services/operationsRegistry/trustedActorCanonical";
import { CsiError, requireCsiReader, isCsiRepActor, type CsiActor } from "../services/salesIntelligence/auth";
import { streamCsiInvalidations, REP_LIVE_TOPICS } from "../services/salesIntelligence/live";
import { createSalesIntelligenceBoundaryRouter } from "./sales-intelligence-boundary.routes";
import { createSalesIntelligenceHistoryRouter } from "./sales-intelligence-history.routes";
import { createSalesIntelligenceInternalRouter } from "./sales-intelligence-internal.routes";
import { createSalesIntelligenceCronRouter } from "./sales-intelligence-cron.routes";
import { createAdminInviteEmailRouter } from "./admin-invite-email-internal.routes";
import { CSI_ADMIN_PREFIX, CSI_REP_COMMAND_ROUTES, CSI_REP_READ_ROUTES, createSalesIntelligenceAdminRouter, type SalesIntelligenceAdminRouteDeps } from "./sales-intelligence-admin.routes";

/**
 * S8-REP (assignment addendum §4.2, C6): the access matrix over every registered Sales Intelligence route,
 * the rep's forced scopes, 404 (never 403) outside the E11 scope, the E9 command allowlist with a required
 * note, signed-scope integrity, and flag-off identity. No database: every service is a stub, and `connect`
 * throws a marker (`INDEX_REQUIRED`, 500) so "the request passed the role guard" is observable per route.
 */
const API = "synthetic-global", SIGNING = "synthetic-owner-signature";
const AGENT_A = "65f0000000000000000000a1", AGENT_B = "65f0000000000000000000b2";
const IN = "65f00000000000000000c0c0", OUT = "65f00000000000000000d0d0", MISSING = "65f00000000000000000e0e0";
type Role = "owner" | "admin" | "rep";

function env(flags: { rep: boolean }) {
  Object.assign(process.env, {
    VANTAGE_API_SECRET: API, VANTAGE_ADMIN_PROXY_SIGNING_SECRET: SIGNING, CRON_SECRET: "synthetic-cron-secret",
    SALES_INTELLIGENCE_ENABLED: "true", SALES_INTELLIGENCE_OUTREACH_ENSURE: "true", SALES_INTELLIGENCE_TIMELINE_V2: "true", SALES_INTELLIGENCE_OVERVIEW: "true",
    SALES_INTELLIGENCE_ATTACHMENT_REFRESH: "true", SALES_INTELLIGENCE_NUDGE_ENABLED: "true", SALES_INTELLIGENCE_REP_ACCESS: flags.rep ? "true" : "false",
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
const concrete = (path: string) => path.replace(":model", "FormLead").replace(/:[A-Za-z]+/g, IN);
const future = () => new Date(Date.now() + 86_400_000).toISOString();
/** A body that parses for each Outreach command route (its own command), so the matrix sees the rep allowlist, not a schema error. */
function commandBody(method: string, path: string): unknown {
  const byRoute: Record<string, unknown> = {
    "POST /outreach/:id/commands": { command: "close", expected_revision: 1, reason: "lost" },
    "POST /followups": { command: "create_followup", expected_revision: 1, outreach_record_id: IN, action: { kind: "call", description: "Call back", due_at: null } },
    "PATCH /followups/:id": { command: "patch_followup", expected_revision: 1, changes: { due_at: future() }, reason: "Customer asked for Friday" },
    "POST /followups/:id/complete": { command: "complete_followup", expected_revision: 1, disposition: "spoke_with_customer", note: "Spoke, quoting tomorrow" },
    "POST /followups/:id/snooze": { command: "snooze_followup", expected_revision: 1, until: future(), reason: "Customer at work" },
    "POST /followups/:id/cancel": { command: "cancel_followup", expected_revision: 1, reason: "Duplicate" },
  };
  return byRoute[`${method} ${path}`] ?? { command: path.split("/").filter(Boolean).at(-1) };
}
const OUTREACH_COMMAND_ROUTES = new Set(["POST /outreach/:id/commands", "POST /followups", "PATCH /followups/:id", "POST /followups/:id/complete", "POST /followups/:id/snooze",
  "POST /followups/:id/cancel", "POST /restrictions/:id/resolve", "POST /review-items/:id/resolve", "POST /interactions/:id/contact-type", "POST /numbers/:id/open-review"]);

type Outcome = "reached" | "401" | "403 OWNER_REQUIRED" | "403 FORBIDDEN" | "403 RUN_SCOPE_DENIED" | "403 forbidden" | "404 FEATURE_DISABLED" | "404" | string;
async function call(base: string, method: string, url: string, role: Role | null, repFlag = true, options: Parameters<typeof signed>[3] = {}, body?: unknown) {
  void repFlag;
  const headers: Record<string, string> = role ? signed(method, url, role, options) : { "x-api-secret": API };
  if (method !== "GET") { headers["content-type"] = "application/json"; headers["idempotency-key"] = "rep-access-key"; }
  const response = await fetch(`${base}${url}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const text = await response.text();
  let json: { code?: string; error?: string; issues?: Array<{ path: string; code: string }> } | null = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, text };
}
function classify(result: { status: number; json: { code?: string } | null }): Outcome {
  if (result.status === 401) return "401";
  // The marker thrown by the stubbed `connect` (the history router maps it to 403): the request passed its guard.
  if (result.json?.code === "INDEX_REQUIRED") return "reached";
  if (result.status === 403) return `403 ${result.json?.code ?? ""}`.trim();
  if (result.status === 404) return result.json?.code === "FEATURE_DISABLED" ? "404 FEATURE_DISABLED" : "404";
  return "reached";
}

test("S8-REP access matrix: every registered Sales Intelligence route × Owner / Admin / rep (flag on) / rep (flag off)", { timeout: 120_000 }, async () => {
  const saved = { ...process.env };
  const admin = createSalesIntelligenceAdminRouter({ connect: marker });
  const history = createSalesIntelligenceHistoryRouter({ connect: marker });
  const internal = createSalesIntelligenceInternalRouter();
  const cron = createSalesIntelligenceCronRouter();
  const invite = createAdminInviteEmailRouter({ send: async () => ({ status: "not_configured" }) as never });
  const boundary = createSalesIntelligenceBoundaryRouter({ connect: async () => {}, run: async () => { throw new CsiError("RUN_SCOPE_DENIED"); } });
  const { base, close } = await serve([history, boundary, internal, admin, invite, cron]);
  const repReads = new Set<string>(CSI_REP_READ_ROUTES), repCommands = new Set<string>(CSI_REP_COMMAND_ROUTES);
  const rows: string[] = [];
  const matrix: Array<{ router: string; method: string; path: string; key: string; rep_route: "read" | "command" | null; owner: string; admin: string; rep: string; rep_flag_off: string }> = [];
  try {
    const adminRoutes = routesOf(admin, CSI_ADMIN_PREFIX);
    // Every route the rep may call is registered (a renamed route can't silently drop out of the matrix).
    for (const key of [...repReads, ...repCommands]) assert.ok(adminRoutes.some(route => `${route.method} ${route.path}` === key), `unregistered rep route ${key}`);
    const groups: Array<{ name: string; routes: Array<{ method: string; path: string; url: string }> }> = [
      { name: "admin", routes: adminRoutes.map(route => ({ ...route, url: `${CSI_ADMIN_PREFIX}${concrete(route.path)}?scope=production` })) },
      { name: "history", routes: routesOf(history).map(route => ({ ...route, url: concrete(route.path) })) },
      { name: "internal", routes: routesOf(internal).map(route => ({ ...route, url: concrete(route.path) })) },
      { name: "invite", routes: routesOf(invite).map(route => ({ ...route, url: route.path })) },
      { name: "cron", routes: routesOf(cron).map(route => ({ ...route, url: route.path })) },
    ];
    let total = 0;
    for (const group of groups) for (const route of group.routes) {
      total++;
      const key = `${route.method} ${route.path}`;
      const body = OUTREACH_COMMAND_ROUTES.has(key) ? commandBody(route.method, route.path) : {};
      const result: Record<string, Outcome> = {};
      for (const [label, role, repFlag] of [["owner", "owner", true], ["admin", "admin", true], ["rep", "rep", true], ["rep_off", "rep", false]] as const) {
        env({ rep: repFlag });
        result[label] = classify(await call(base, route.method, route.url, role, repFlag, {}, body));
      }
      // Expectations (addendum §4.2): Admin never reaches Sales Intelligence; a rep reaches exactly its routes; flag off = today.
      if (group.name === "admin") {
        assert.equal(result.owner, "reached", `owner ${key}`);
        assert.equal(result.admin, "403 OWNER_REQUIRED", `admin ${key}`);
        const repExpected = repReads.has(key) || repCommands.has(key) ? "reached" : OUTREACH_COMMAND_ROUTES.has(key) ? "403 FORBIDDEN" : "403 OWNER_REQUIRED";
        assert.equal(result.rep, repExpected, `rep ${key}`);
        assert.equal(result.rep_off, "403 OWNER_REQUIRED", `rep flag off ${key}`);
      } else if (group.name === "history") {
        assert.equal(result.rep, "403 RUN_SCOPE_DENIED", `rep ${key}`);
        assert.equal(result.rep_off, "403 RUN_SCOPE_DENIED", `rep flag off ${key}`);
      } else if (group.name === "internal") {
        for (const label of ["owner", "admin", "rep", "rep_off"]) assert.equal(result[label], "403 RUN_SCOPE_DENIED", `${label} ${key}`);
      } else if (group.name === "invite") {
        assert.equal(result.owner, "reached"); assert.equal(result.admin, "403 forbidden"); assert.equal(result.rep, "403 forbidden"); assert.equal(result.rep_off, "403 forbidden");
      } else {
        for (const label of ["owner", "admin", "rep", "rep_off"]) assert.equal(result[label], "401", `${label} ${key}`);
      }
      rows.push(`| ${group.name} | \`${key}\` | ${result.owner} | ${result.admin} | ${result.rep} | ${result.rep_off} |`);
      matrix.push({ router: group.name, method: route.method, path: group.name === "admin" ? `${CSI_ADMIN_PREFIX}${route.path}` : route.path, key,
        rep_route: repReads.has(key) ? "read" : repCommands.has(key) ? "command" : null, owner: result.owner!, admin: result.admin!, rep: result.rep!, rep_flag_off: result.rep_off! });
    }
    // Guards the enumeration itself (Express internals): the admin router alone registers 60+ method/path pairs.
    assert.ok(adminRoutes.length >= 60 && total >= 70, `enumerated ${adminRoutes.length} admin routes, ${total} in all`);
    // CF8: `S8_MATRIX_OUT=<file>.md` writes the Markdown table there and the same rows as `<file>.json`.
    if (process.env.S8_MATRIX_OUT) {
      writeFileSync(process.env.S8_MATRIX_OUT, `| router | route | Owner | Admin | rep (REP_ACCESS on) | rep (REP_ACCESS off) |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n`);
      writeFileSync(process.env.S8_MATRIX_OUT.replace(/\.md$/, "") + ".json", `${JSON.stringify({
        generated_by: "src/routes/sales-intelligence-rep-access.test.ts (router enumeration; every service stubbed, `connect` throws a marker so \"reached\" = passed the role guard)",
        outcomes: { reached: "passed the route's role guard (stub marker)", "403 OWNER_REQUIRED": "Owner-only route", "403 FORBIDDEN": "rep on an Outreach command route outside the E9 allowlist",
          "403 RUN_SCOPE_DENIED": "history/internal routers: needs a run-scoped token", "403 forbidden": "invite email route: Owner only", "401": "cron: needs CRON_SECRET" },
        totals: { routes: matrix.length, rep_reached: matrix.filter(row => row.rep === "reached").length, admin_reached: matrix.filter(row => row.admin === "reached").length },
        routes: matrix }, null, 2)}\n`);
    }
  } finally {
    await close();
    process.env = saved;
  }
});

test("C6: a rep's record, Number and conversation reads answer 404 outside its scope, identical to a missing record, and never call the read", { timeout: 60_000 }, async () => {
  const saved = { ...process.env };
  env({ rep: true });
  const reads: string[] = [];
  const found = (name: string) => async (id: string) => { reads.push(`${name}:${id}`); return id === MISSING ? null : ({ as_of: "2026-09-24T12:00:00.000Z", data: { id } } as never); };
  const scopeCalls: string[] = [];
  const inScope = (kind: string) => async (id: string, agent: string) => { scopeCalls.push(`${kind}:${id}:${agent}`); return id === IN && agent === AGENT_A; };
  let mediaActor: CsiActor | null = null;
  const admin = createSalesIntelligenceAdminRouter({
    connect: async () => {},
    repScope: { record: inScope("record"), number: inScope("number"), conversation: inScope("conversation") },
    outreach: async (id: string) => { reads.push(`outreach:${id}`); return id === MISSING ? null : ({ as_of: "x", coverage: {}, data: { outreach: { id }, owner_instructions: [], nudges: { items: [{ id: "n1" }], next_cursor: "c" } } } as never); },
    outreachTimeline: found("timeline") as never, outreachAssessment: found("assessment") as never, currentFindings: found("findings") as never,
    conversations: found("conversations") as never, transcript: found("transcript") as never,
    conversationMedia: async (input) => {
      mediaActor = input.actor; reads.push(`media:${input.conversation_id}`);
      return input.conversation_id === MISSING ? { kind: "not_found" } : { kind: "stream", status: 200, headers: { "Content-Type": "audio/mpeg" }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }) } as never;
    },
  });
  const boundary = createSalesIntelligenceBoundaryRouter({ connect: async () => {} });
  const { base, close } = await serve([boundary, admin]);
  try {
    for (const [path, name] of [["/outreach/:id", "outreach"], ["/outreach/:id/timeline", "timeline"], ["/outreach/:id/assessment", "assessment"], ["/outreach/:id/findings", "findings"],
      ["/numbers/:id/conversations", "conversations"], ["/conversations/:id/transcript", "transcript"], ["/conversations/:id/media", "media"]] as const) {
      const url = (id: string) => `${CSI_ADMIN_PREFIX}${path.replace(":id", id)}`;
      reads.length = 0;
      const missingForOwner = await call(base, "GET", url(MISSING), "owner");
      const outForRep = await call(base, "GET", url(OUT), "rep");
      const missingForRep = await call(base, "GET", url(MISSING), "rep");
      assert.equal(missingForOwner.status, 404, path);
      assert.equal(outForRep.status, 404, path);
      // The same body a missing record gets (the request id differs by caller only).
      assert.equal(outForRep.json?.error, missingForOwner.json?.error, path);
      assert.equal(outForRep.json?.code, missingForOwner.json?.code, path);
      assert.equal(missingForRep.status, 404, path);
      assert.deepEqual(reads, [`${name}:${MISSING}`], `${path}: the read never runs for an out-of-scope id`);
      const inForRep = await call(base, "GET", url(IN), "rep");
      assert.equal(inForRep.status, 200, path);
      // Another rep's scope doesn't open A's record.
      assert.equal((await call(base, "GET", url(IN), "rep", true, { agent: AGENT_B })).status, 404, path);
    }
    assert.ok(scopeCalls.every(entry => entry.endsWith(AGENT_A) || entry.endsWith(AGENT_B)));
    assert.equal((mediaActor as CsiActor | null)?.kind, "rep");
    assert.equal((mediaActor as CsiActor | null)?.agent_id, AGENT_A);
    // The detail hides Owner→rep nudges from a rep; the Owner's detail is unchanged.
    const repDetail = await call(base, "GET", `${CSI_ADMIN_PREFIX}/outreach/${IN}`, "rep");
    assert.deepEqual(JSON.parse(repDetail.text).data.nudges, { items: [], next_cursor: null });
    const ownerDetail = await call(base, "GET", `${CSI_ADMIN_PREFIX}/outreach/${IN}`, "owner");
    assert.deepEqual(JSON.parse(ownerDetail.text).data.nudges, { items: [{ id: "n1" }], next_cursor: "c" });
    // The Owner never pays a scope check.
    scopeCalls.length = 0;
    await call(base, "GET", `${CSI_ADMIN_PREFIX}/outreach/${OUT}`, "owner");
    assert.deepEqual(scopeCalls, []);
  } finally { await close(); process.env = saved; }
});

test("C6: query parameters can't widen a rep's scope (desk, Closed history, Overview); the Owner's calls are unchanged", { timeout: 60_000 }, async () => {
  const saved = { ...process.env };
  env({ rep: true });
  const seen: Array<{ route: string; query: unknown; scope: unknown }> = [];
  const liveCalls: unknown[] = [];
  const admin = createSalesIntelligenceAdminRouter({
    connect: async () => {},
    attention: (async (query: unknown, deps: { scope?: unknown } = {}) => { seen.push({ route: "attention", query, scope: "scope" in deps ? deps.scope : "absent" }); return { as_of: "x", coverage: {}, data: {} }; }) as never,
    closedHistory: (async (query: unknown, options: { scope?: unknown }) => { seen.push({ route: "closed", query, scope: options.scope }); return { as_of: "x", coverage: {}, data: {} }; }) as never,
    overview: (async (query: unknown, options: { scope?: unknown }) => { seen.push({ route: "overview", query, scope: options.scope }); return {}; }) as never,
    live: ((_req, res, options) => { liveCalls.push(options ?? null); res.status(200).end(); return () => {}; }) as SalesIntelligenceAdminRouteDeps["live"],
  });
  const { base, close } = await serve([createSalesIntelligenceBoundaryRouter({ connect: async () => {} }), admin]);
  try {
    for (const role of ["rep", "owner"] as const) {
      seen.length = 0;
      assert.equal((await call(base, "GET", `${CSI_ADMIN_PREFIX}/attention?agent_id=${AGENT_B}&unassigned=true`, role)).status, 200);
      assert.equal((await call(base, "GET", `${CSI_ADMIN_PREFIX}/outreach/closed-history?agent_id=${AGENT_B}`, role)).status, 200);
      assert.equal((await call(base, "GET", `${CSI_ADMIN_PREFIX}/overview?agent_id=${AGENT_B}`, role)).status, 200);
      const expected = role === "rep" ? { agent_id: AGENT_A } : null;
      assert.deepEqual(seen.map(entry => entry.scope), [role === "rep" ? expected : "absent", expected, expected], role);
    }
    // The live stream: the Owner's call is unchanged (no options); a rep's carries the rep topic filter.
    liveCalls.length = 0;
    assert.equal((await call(base, "GET", `${CSI_ADMIN_PREFIX}/live`, "owner")).status, 200);
    assert.equal((await call(base, "GET", `${CSI_ADMIN_PREFIX}/live`, "rep")).status, 200);
    assert.deepEqual(liveCalls, [null, { topics: REP_LIVE_TOPICS }]);
  } finally { await close(); process.env = saved; }
});

test("C6: a rep runs only complete / snooze / re-date, each with a note; everything else is FORBIDDEN before any write", { timeout: 60_000 }, async () => {
  const saved = { ...process.env };
  env({ rep: true });
  const sent: Array<{ actor: CsiActor; command: { command: string } }> = [];
  const admin = createSalesIntelligenceAdminRouter({ connect: async () => {}, outreachCommand: (async (input: { actor: CsiActor; command: { command: string } }) => { sent.push(input); return { response: {}, replayed: false }; }) as never });
  const { base, close } = await serve([createSalesIntelligenceBoundaryRouter({ connect: async () => {} }), admin]);
  const post = (method: string, path: string, body: unknown, role: Role = "rep") => call(base, method, `${CSI_ADMIN_PREFIX}${path}`, role, true, {}, body);
  try {
    // Allowed, with a note.
    for (const [method, path] of [["POST", `/followups/${IN}/complete`], ["POST", `/followups/${IN}/snooze`], ["PATCH", `/followups/${IN}`]] as const) {
      const key = `${method} ${path.replace(IN, ":id")}`;
      const result = await post(method, path, commandBody(method, key.slice(method.length + 1)));
      assert.equal(result.status, 200, key);
    }
    assert.deepEqual(sent.map(entry => [entry.command.command, entry.actor.kind, entry.actor.agent_id]), [
      ["complete_followup", "rep", AGENT_A], ["snooze_followup", "rep", AGENT_A], ["patch_followup", "rep", AGENT_A]]);
    sent.length = 0;
    // A note is required.
    const noNote = await post("POST", `/followups/${IN}/complete`, { command: "complete_followup", expected_revision: 1, disposition: "completed" });
    assert.equal(noNote.status, 400); assert.equal(noNote.json?.code, "INVALID_INPUT"); assert.deepEqual(noNote.json?.issues, [{ path: "note", code: "required" }]);
    const blankNote = await post("POST", `/followups/${IN}/complete`, { command: "complete_followup", expected_revision: 1, disposition: "completed", note: "   " });
    assert.equal(blankNote.status, 400);
    // Re-date only: any other field, or no date, is refused.
    for (const changes of [{ description: "x" }, { responsible_agent_id: AGENT_A }, { kind: "call" }, { due_at: future(), description: "x" }]) {
      const result = await post("PATCH", `/followups/${IN}`, { command: "patch_followup", expected_revision: 1, changes, reason: "Because" });
      assert.equal(result.status, 403, JSON.stringify(changes)); assert.equal(result.json?.code, "FORBIDDEN");
    }
    const noDate = await post("PATCH", `/followups/${IN}`, { command: "patch_followup", expected_revision: 1, changes: { date_note: "Friday" }, reason: "Because" });
    assert.equal(noDate.status, 400);
    // Completing can't create the next follow-up.
    const withNext = await post("POST", `/followups/${IN}/complete`, { command: "complete_followup", expected_revision: 1, disposition: "completed", note: "ok",
      next: { kind: "call", description: "again", due_at: null } });
    assert.equal(withNext.status, 403); assert.equal(withNext.json?.code, "FORBIDDEN");
    // Every other command, on every command route, is FORBIDDEN (even a valid Owner command).
    for (const [method, path, body] of [
      ["POST", `/outreach/${IN}/commands`, { command: "close", expected_revision: 1, reason: "lost" }],
      ["POST", `/outreach/${IN}/commands`, { command: "assign", expected_revision: 1, responsible_agent_id: AGENT_A }],
      ["POST", `/outreach/${IN}/commands`, { command: "add_note", expected_revision: 1, text: "hi" }],
      ["POST", `/outreach/${IN}/commands`, { command: "mark_worked", expected_revision: 1 }],
      ["POST", "/followups", commandBody("POST", "/followups")],
      ["POST", `/followups/${IN}/cancel`, { command: "cancel_followup", expected_revision: 1, reason: "x" }],
      ["POST", `/restrictions/${IN}/resolve`, { command: "resolve_restriction" }],
      ["POST", `/review-items/${IN}/resolve`, { command: "resolve_review" }],
      ["POST", `/interactions/${IN}/contact-type`, { command: "set_contact_type" }],
      ["POST", `/numbers/${IN}/open-review`, { command: "open_number_review" }],
    ] as const) {
      const result = await post(method, path, body);
      assert.equal(result.status, 403, `${path} ${JSON.stringify(body)}`); assert.equal(result.json?.code, "FORBIDDEN");
    }
    // Owner-only command routes outside the Outreach set stay OWNER_REQUIRED for a rep.
    for (const path of [`/analysis-runs/${IN}/reanalyze`, `/findings/${IN}/retract`, "/nudges", "/reps", "/backfill", `/numbers/${IN}/rebuild`, "/overview/rebuild-day", "/attachments/attach"]) {
      const result = await post("POST", path, {});
      assert.equal(result.status, 403, path); assert.equal(result.json?.code, "OWNER_REQUIRED");
    }
    assert.equal((await post("PATCH", "/settings", {})).json?.code, "OWNER_REQUIRED");
    assert.deepEqual(sent, [], "no refused command reached the command service");
    // The Owner still sends every command (the route passes it through unchanged).
    assert.equal((await post("POST", `/outreach/${IN}/commands`, { command: "close", expected_revision: 1, reason: "lost" }, "owner")).status, 200);
    assert.equal((sent as Array<{ actor: CsiActor }>)[0]?.actor.kind, "owner");
  } finally { await close(); process.env = saved; }
});

test("signed scope: a tampered, unsigned, expired or 7-line rep request is refused; an Owner request with an agent header stays the Owner's", { timeout: 60_000 }, async () => {
  const saved = { ...process.env };
  env({ rep: true });
  const scopes: unknown[] = [];
  const admin = createSalesIntelligenceAdminRouter({ connect: async () => {}, attention: (async (_q: unknown, deps: { scope?: unknown } = {}) => { scopes.push(deps.scope ?? null); return { as_of: "x", coverage: {}, data: {} }; }) as never });
  const { base, close } = await serve([createSalesIntelligenceBoundaryRouter({ connect: async () => {} }), admin]);
  const url = `${CSI_ADMIN_PREFIX}/attention`;
  try {
    assert.equal((await call(base, "GET", url, "rep")).status, 200);
    // Agent header swapped after signing.
    assert.equal((await call(base, "GET", url, "rep", true, { agent: AGENT_B, signAgent: AGENT_A })).status, 403);
    // No agent header at all.
    assert.equal((await call(base, "GET", url, "rep", true, { agent: null, signAgent: AGENT_A })).status, 403);
    // Signed with the Owner's 7-line payload.
    assert.equal((await call(base, "GET", url, "rep", true, { noAgentLine: true })).status, 403);
    // Expired.
    assert.equal((await call(base, "GET", url, "rep", true, { timestamp: Date.now() - 60 * 60_000 })).status, 403);
    // An Owner request carrying an agent header is still an unscoped Owner request.
    scopes.length = 0;
    assert.equal((await call(base, "GET", url, "owner", true, { agent: AGENT_B })).status, 200);
    assert.deepEqual(scopes, [null]);
    // A signed rep, REP_ACCESS off: refused exactly like today.
    env({ rep: false });
    const off = await call(base, "GET", url, "rep");
    assert.equal(off.status, 403); assert.equal(off.json?.code, "OWNER_REQUIRED");
  } finally { await close(); process.env = saved; }
});

test("a trusted rep actor persists only { kind, id, request_id, run_id }; role and agent_id are non-enumerable", () => {
  const saved = { ...process.env };
  env({ rep: true });
  try {
    const url = `${CSI_ADMIN_PREFIX}/attention`;
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

test("a rep's live stream forwards only the rep topics; the Owner's is unchanged", { timeout: 30_000 }, async () => {
  let release: ((change: unknown) => void) | null = null; const queue: unknown[] = [];
  const emit = (change: unknown) => { if (release) { const resolve = release; release = null; resolve(change); } else queue.push(change); };
  const app = express();
  app.get("/live", (req, res) => streamCsiInvalidations(req, res, { clockMs: 60_000, enabled: () => true, topics: REP_LIVE_TOPICS,
    watch: () => ({ next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { release = resolve; }), close: async () => {} }) }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const abort = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/live`, { signal: abort.signal });
    const reader = response.body!.getReader(); let text = "";
    const frames = () => text.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)) as { reason: string; topics: string[] });
    const until = async (match: (frame: { reason: string; topics: string[] }) => boolean) => { for (;;) { const hit = frames().find(match); if (hit) return hit; text += new TextDecoder().decode((await reader.read()).value); } };
    await until(frame => frame.reason === "connect");
    // Owner-only surfaces (attachments, reviews, rep links, nudges, unmapped) are dropped; outreach passes.
    for (const coll of ["number_lead_attachments", "sales_intelligence_review_items", "rep_identity_links", "owner_rep_nudges", "sales_intelligence_policy_pointers"]) emit({ ns: { coll } });
    await new Promise(resolve => setTimeout(resolve, 400));
    emit({ ns: { coll: "outreach_followups" } });
    const change = await until(frame => frame.reason === "change");
    assert.deepEqual(change.topics, ["outreach"]);
    assert.equal(frames().filter(frame => frame.reason === "change").length, 1);
    abort.abort(); await reader.cancel().catch(() => {});
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
