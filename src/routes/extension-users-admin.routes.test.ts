import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { ConflictError } from "../services/errors";
import { createExtensionUsersAdminRouter } from "./extension-users-admin.routes";
import type { AdminExtensionUser } from "../services/extensionUsers";

const SECRET = "synthetic-admin-signing-secret";

const listed: AdminExtensionUser[] = [
  {
    id: "user-1",
    email: "owner@vantage.com",
    role: "owner",
    active: true,
    created_at: "2026-09-03T16:00:00.000Z",
    last_login_at: null,
  },
];

const created: AdminExtensionUser[] = [];

const app = express();
app.use(express.json());
app.use(
  createExtensionUsersAdminRouter({
    connect: async () => undefined,
    list: async () => listed,
    create: async (input) => {
      if (input.email === "taken@vantage.com") {
        throw new ConflictError("An Extension User already uses this email.");
      }
      const user: AdminExtensionUser = {
        id: "user-2",
        email: input.email,
        role: input.role,
        active: true,
        created_at: "2026-09-03T16:05:00.000Z",
        last_login_at: null,
      };
      created.push(user);
      return user;
    },
  }),
);

const server = app.listen(0);
const baseUrl = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

before(() => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
});

afterEach(() => {
  created.length = 0;
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = SECRET;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => (error ? reject(error) : resolve())),
  );
});

function signedHeaders(
  role: "owner" | "admin",
  path: string,
  method: "GET" | "POST" = "GET",
): Record<string, string> {
  const timestamp = `${Date.now()}`;
  const requestId = `req-ext-${timestamp}`;
  const signature = computeAdminActorSignature(
    {
      adminId: "admin_123",
      email: "owner@example.invalid",
      role,
      timestamp,
      requestId,
      method,
      path,
    },
    SECRET,
  );
  return {
    "content-type": "application/json",
    "x-vantage-admin-user-id": "admin_123",
    "x-vantage-admin-email": "owner@example.invalid",
    "x-vantage-admin-role": role,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-timestamp": timestamp,
    "x-vantage-admin-signature": signature,
  };
}

test("Owner can list Extension Users", async () => {
  const path = "/api/v1/admin/extension-users";
  const response = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("owner", path),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: true; data: AdminExtensionUser[] };
  assert.equal(body.ok, true);
  assert.equal(body.data[0]?.email, "owner@vantage.com");
  assert.equal("password_hash" in (body.data[0] ?? {}), false);
});

test("Admin cannot list or create Extension Users", async () => {
  const path = "/api/v1/admin/extension-users";
  const listDenied = await fetch(`${baseUrl()}${path}`, {
    headers: signedHeaders("admin", path),
  });
  assert.equal(listDenied.status, 403);

  const createDenied = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("admin", path, "POST"),
    body: JSON.stringify({
      email: "rep@vantage.com",
      password: "secret-pass",
      role: "employee",
    }),
  });
  assert.equal(createDenied.status, 403);
  assert.equal(created.length, 0);
});

test("Owner can create an Extension User", async () => {
  const path = "/api/v1/admin/extension-users";
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
    body: JSON.stringify({
      email: "rep@vantage.com",
      password: "secret-pass",
      role: "sales",
    }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { ok: true; data: AdminExtensionUser };
  assert.equal(body.data.email, "rep@vantage.com");
  assert.equal(body.data.role, "sales");
  assert.equal("password" in body.data, false);
  assert.equal(created.length, 1);
});

test("Owner cannot create an Extension User with legacy employee role", async () => {
  const path = "/api/v1/admin/extension-users";
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
    body: JSON.stringify({
      email: "legacy@vantage.com",
      password: "secret-pass",
      role: "employee",
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(created.length, 0);
});

test("create rejects an invalid payload and a duplicate email", async () => {
  const path = "/api/v1/admin/extension-users";
  const invalid = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
    body: JSON.stringify({ email: "not-an-email", password: "short", role: "boss" }),
  });
  assert.equal(invalid.status, 400);

  const duplicate = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
    body: JSON.stringify({
      email: "taken@vantage.com",
      password: "secret-pass",
      role: "owner",
    }),
  });
  assert.equal(duplicate.status, 409);
  const body = (await duplicate.json()) as { ok: false; error: string };
  assert.equal(body.error, "An Extension User already uses this email.");
});
