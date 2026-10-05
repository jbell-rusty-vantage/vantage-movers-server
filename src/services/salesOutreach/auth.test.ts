import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express, { type Request, type Response } from "express";
import { requireApiSecret } from "../../middleware/requireApiSecret";
import { computeAdminActorSignature, signAdminActorPayload } from "../operationsRegistry/trustedActor";
import { buildCanonicalRepActorPayload } from "../operationsRegistry/trustedActorCanonical";
import { outreachActorOf, requireOutreachActor } from "./auth";
import { sendOutreachError } from "./errors";
import { rolesWithCapability } from "./permissions";

/**
 * SRV-1 route matrix (IMPLEMENTATION-PLAN §7): owner / manager / rep / admin / foreign-rep /
 * unsigned against probes guarded exactly as desk routes are (by capability).
 */
const API_SECRET = "synthetic-sod-api-secret";
const SIGNING_SECRET = "synthetic-sod-signing-secret";
const LINKED_AGENT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const FOREIGN_AGENT = "bbbbbbbbbbbbbbbbbbbbbbbb";
const saved = { api: process.env.VANTAGE_API_SECRET, signing: process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET };
const linkChecks: Array<{ agent: string; at: Date }> = [];

const fail = (req: Request, res: Response, error: unknown) => sendOutreachError(res, error, "req", req.path);
const deps = {
  hasReviewedSalesRepLink: async (agent: string, at: Date) => {
    linkChecks.push({ agent, at });
    return agent === LINKED_AGENT;
  },
};
const app = express();
app.use(express.json());
app.use("/probe", requireApiSecret);
const echo = (_req: Request, res: Response) => {
  const actor = outreachActorOf(res);
  res.json({ role: actor.role, agent_id: actor.agent_id, kind: actor.actor.kind });
};
app.get("/probe/configuration", requireOutreachActor(rolesWithCapability("configuration_read"), fail, deps), echo);
app.get("/probe/team", requireOutreachActor(rolesWithCapability("team_reads"), fail, deps), echo);
app.get("/probe/assigned", requireOutreachActor(rolesWithCapability("own_assigned_reads"), fail, deps), echo);
app.patch("/probe/quoted", requireOutreachActor(rolesWithCapability("quoted_date_commands"), fail, deps), echo);

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

type Caller = "owner" | "manager" | "rep" | "admin" | "foreign-rep" | "unsigned" | "tampered-rep";

function headers(caller: Caller, path: string, method = "GET"): Record<string, string> {
  const base = { "x-api-secret": API_SECRET };
  if (caller === "unsigned") return base;
  const timestamp = `${Date.now()}`;
  const requestId = `req-${caller}-${timestamp}`;
  const adminId = `${caller}-user`;
  const email = `${caller}@example.invalid`;
  const role = caller === "foreign-rep" || caller === "tampered-rep" ? "rep" : caller;
  const signed: Record<string, string> = {
    ...base,
    "x-vantage-admin-user-id": adminId,
    "x-vantage-admin-email": email,
    "x-vantage-admin-role": role,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
  };
  if (role !== "rep") {
    signed["x-vantage-admin-signature"] = computeAdminActorSignature(
      { adminId, email, role, timestamp, requestId, method, path },
      SIGNING_SECRET,
    );
    return signed;
  }
  const agentId = caller === "foreign-rep" ? FOREIGN_AGENT : LINKED_AGENT;
  signed["x-vantage-admin-signature"] = signAdminActorPayload(
    buildCanonicalRepActorPayload({ adminId, email, role, timestamp, requestId, method, path, agentId }),
    SIGNING_SECRET,
  );
  // A tampered rep presents a different Agent than the one it signed.
  signed["x-vantage-admin-agent-id"] = caller === "tampered-rep" ? FOREIGN_AGENT : agentId;
  return signed;
}

async function call(caller: Caller, path: string, method = "GET") {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: headers(caller, path, method) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("route matrix: who reaches which desk capability", async () => {
  const expected: Record<string, Record<Caller, number>> = {
    "/probe/configuration": { owner: 200, manager: 403, rep: 403, admin: 403, "foreign-rep": 403, unsigned: 403, "tampered-rep": 403 },
    "/probe/team": { owner: 200, manager: 200, rep: 403, admin: 403, "foreign-rep": 403, unsigned: 403, "tampered-rep": 403 },
    "/probe/assigned": { owner: 200, manager: 200, rep: 200, admin: 403, "foreign-rep": 403, unsigned: 403, "tampered-rep": 403 },
  };
  for (const [path, byCaller] of Object.entries(expected))
    for (const [caller, status] of Object.entries(byCaller) as Array<[Caller, number]>)
      assert.equal((await call(caller, path)).status, status, `${caller} ${path}`);
  assert.equal((await call("rep", "/probe/quoted", "PATCH")).status, 200);
  assert.equal((await call("manager", "/probe/quoted", "PATCH")).status, 200);
  assert.equal((await call("admin", "/probe/quoted", "PATCH")).status, 403);
});

test("refusal codes: generic admin and unsigned are FORBIDDEN; an unlinked rep is REP_NOT_LINKED", async () => {
  assert.equal((await call("admin", "/probe/assigned")).body.code, "FORBIDDEN");
  assert.equal((await call("unsigned", "/probe/assigned")).body.code, "FORBIDDEN");
  assert.equal((await call("tampered-rep", "/probe/assigned")).body.code, "FORBIDDEN");
  const foreign = await call("foreign-rep", "/probe/assigned");
  assert.deepEqual([foreign.status, foreign.body.code], [403, "REP_NOT_LINKED"]);
  assert.equal(JSON.stringify(foreign.body).includes(FOREIGN_AGENT), false);
});

test("resolved actors carry the signed identity only; the rep link is checked at the request instant", async () => {
  linkChecks.length = 0;
  const before = Date.now();
  assert.deepEqual((await call("owner", "/probe/assigned")).body, { role: "owner", agent_id: null, kind: "owner" });
  assert.deepEqual((await call("manager", "/probe/assigned")).body, { role: "manager", agent_id: null, kind: "manager" });
  assert.deepEqual((await call("rep", "/probe/assigned")).body, { role: "rep", agent_id: LINKED_AGENT, kind: "rep" });
  assert.equal(linkChecks.length, 1);
  assert.equal(linkChecks[0]!.agent, LINKED_AGENT);
  assert.ok(+linkChecks[0]!.at >= before && +linkChecks[0]!.at <= Date.now());
});

test("signatures are bound to the method, path, role and freshness", async () => {
  const path = "/probe/team";
  const replayed = headers("manager", "/probe/assigned");
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: replayed })).status, 403);
  const relabelled = { ...headers("admin", path), "x-vantage-admin-role": "manager" };
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: relabelled })).status, 403);
  const stale = headers("manager", path);
  stale["x-vantage-admin-timestamp"] = `${Date.now() - 24 * 3_600_000}`;
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: stale })).status, 403);
  const missingSecret = { ...headers("owner", path) };
  delete missingSecret["x-api-secret"];
  assert.equal((await fetch(`${baseUrl}${path}`, { headers: missingSecret })).status, 401);
});
