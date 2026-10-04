import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import routerModule from "./v1.routes";

const SECRET = "synthetic-v1-scope-secret";
const router = (routerModule as { default?: unknown }).default ?? routerModule;

const app = express();
app.use(express.json());
app.use(router as express.Router);

let baseUrl = "";
let server: ReturnType<typeof app.listen> | undefined;
const savedEnv = {
  secret: process.env.VANTAGE_API_SECRET,
  mongo: process.env.MONGO_URI,
};

before(async () => {
  process.env.VANTAGE_API_SECRET = SECRET;
  // No database is reachable from this suite: a request that passed validation fails
  // in connectMongo instead of reading any real collection.
  delete process.env.MONGO_URI;
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  restoreEnv("VANTAGE_API_SECRET", savedEnv.secret);
  restoreEnv("MONGO_URI", savedEnv.mongo);
});

const SCOPED_READS = [
  "/api/v1/admin/form-leads",
  "/api/v1/admin/booked-leads/507f1f77bcf86cd799439011",
  "/api/v1/admin/search?q=Jane",
  "/api/v1/admin/facets",
  "/api/v1/admin/exports/call-leads.csv",
  "/api/v1/admin/analytics/summary",
  "/api/v1/admin/analytics/overview",
  "/api/v1/admin/exports/analytics/summary.csv",
  // Former Agent browse/detail paths, now the Agent catalog: the retired scope still gets a 400.
  "/api/v1/admin/agents?include_inactive=true",
  "/api/v1/admin/agents/507f1f77bcf86cd799439011",
];

test("admin reads reject the retired historical and combined scopes with a 400", async () => {
  for (const path of SCOPED_READS) {
    for (const scope of ["historical", "combined"]) {
      const response = await get(withScope(path, scope));
      const body = (await response.json()) as { ok: boolean; issues?: Array<{ message: string }> };
      assert.equal(response.status, 400, `${path} ${scope}`);
      assert.equal(body.ok, false);
      assert.ok(
        body.issues?.some((issue) => /historical database was retired/.test(issue.message)),
        `${path} ${scope} explains the retirement`,
      );
    }
  }
});

test("admin reads pass validation for an omitted or production scope", async () => {
  for (const path of SCOPED_READS) {
    for (const scope of [undefined, "production"]) {
      const response = await get(scope ? withScope(path, scope) : path);
      assert.notEqual(response.status, 400, `${path} ${scope ?? "omitted"}`);
    }
  }
});

test("retired Customer, Agent browse and Agent Sales Report routes are gone", async () => {
  for (const path of [
    "/api/v1/admin/customers",
    "/api/v1/admin/customers/507f1f77bcf86cd799439011",
    "/api/v1/admin/exports/customers.csv",
    "/api/v1/admin/exports/agents.csv",
    "/api/v1/admin/reports/agent-sales?from=2026-01-01&to=2026-01-31",
    "/api/v1/admin/exports/reports/agent-sales.csv?from=2026-01-01&to=2026-01-31",
  ]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
  }
});

function get(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { "x-api-secret": SECRET } });
}

function withScope(path: string, scope: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}database_scope=${scope}`;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
