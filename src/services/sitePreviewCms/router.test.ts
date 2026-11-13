import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import express from "express";
import { computeAdminActorSignature } from "../operationsRegistry/trustedActor";
import { cmsDependencies, createSitePreviewCmsRouter } from "./router";
import { CmsError } from "./contract";

const base = "/api/v1/site-preview/cms";
const app = express();
app.use(base, createSitePreviewCmsRouter());
let server: ReturnType<typeof app.listen>;
let origin: string;
const previousEnv = { api: process.env.VANTAGE_API_SECRET, signing: process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET };
const fixture = { revision: 2, values: {}, testimonialPolicy: { minimumRating: 4, excludedIds: [] }, catalog: [], updatedAt: "2026-11-12", updatedBy: { id: "owner", email: "owner@example.invalid", requestId: "test" } };
before(async () => {
  process.env.VANTAGE_API_SECRET = "cms-test-secret";
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = "cms-test-signing-secret-at-least-32-characters";
  cmsDependencies.readContent = async () => fixture;
  cmsDependencies.readPublicContent = async () => fixture;
  cmsDependencies.saveContent = async input => {
    if (input.expectedRevision !== fixture.revision) throw new CmsError("Reload before saving", 409, "CMS_REVISION_CONFLICT");
    return { ...fixture, changed: true };
  };
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  for (const [name, value] of [["VANTAGE_API_SECRET", previousEnv.api], ["VANTAGE_ADMIN_PROXY_SIGNING_SECRET", previousEnv.signing]]) {
    if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
  }
});
function headers(method: string, path: string, role = "owner", signedPath = path) {
  const fields = { adminId: "owner-test", email: "owner@example.invalid", role, timestamp: String(Date.now()), requestId: "cms-request", method, path: signedPath };
  return { "content-type": "application/json", "x-api-secret": "cms-test-secret", "x-vantage-admin-user-id": fields.adminId, "x-vantage-admin-email": fields.email, "x-vantage-admin-role": role, "x-vantage-admin-timestamp": fields.timestamp, "x-vantage-admin-request-id": fields.requestId, "x-vantage-admin-signature": computeAdminActorSignature(fields, process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET!) };
}
test("public read requires API auth; every administrative operation requires signed Owner", async () => {
  assert.equal((await fetch(origin + base)).status, 401);
  assert.equal((await fetch(origin + base, { headers: { "x-api-secret": "cms-test-secret" } })).status, 200);
  for (const [method, suffix] of [["GET", "/admin"], ["PUT", "/admin"], ["GET", "/admin/history"], ["GET", "/admin/testimonials"], ["POST", "/admin/restore"], ["POST", "/admin/media"]]) {
    const path = base + suffix;
    assert.equal((await fetch(origin + path, { method, headers: { "x-api-secret": "cms-test-secret" } })).status, 403);
    assert.equal((await fetch(origin + path, { method, headers: headers(method, path, "admin") })).status, 403);
  }
  assert.equal((await fetch(origin + base + "/admin", { headers: headers("GET", base + "/admin") })).status, 200);
  assert.equal((await fetch(origin + base + "/admin", { headers: headers("GET", base + "/admin", "owner", "/different") })).status, 403);
});
test("save validates content and propagates stale revision conflict", async () => {
  const path = base + "/admin";
  const request = (body: unknown) => fetch(origin + path, { method: "PUT", headers: headers("PUT", path), body: JSON.stringify(body) });
  assert.equal((await request({ expectedRevision: 2, values: {} })).status, 200);
  assert.equal((await request({ expectedRevision: 1, values: {} })).status, 409);
  assert.equal((await request({ expectedRevision: 2, testimonialPolicy: { minimumRating: 8, excludedIds: [] } })).status, 400);
});
