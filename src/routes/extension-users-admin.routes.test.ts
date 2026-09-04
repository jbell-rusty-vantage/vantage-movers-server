import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, afterEach, before, test } from "node:test";
import express from "express";
import { computeAdminActorSignature } from "../services/operationsRegistry/trustedActor";
import { ConflictError, NotFoundError } from "../services/errors";
import { createExtensionUsersAdminRouter } from "./extension-users-admin.routes";
import type { AdminExtensionUser } from "../services/extensionUsers";

const SECRET = "synthetic-admin-signing-secret";
const EXISTING_ID = "507f1f77bcf86cd799439011";
const UNKNOWN_ID = "507f1f77bcf86cd799439099";

const listed: AdminExtensionUser[] = [
  {
    id: "user-1",
    email: "owner@vantage.com",
    roles: ["owner"],
    active: true,
    created_at: "2026-09-03T16:00:00.000Z",
    last_login_at: null,
  },
];

const created: AdminExtensionUser[] = [];
const updated: AdminExtensionUser[] = [];
const deleted: string[] = [];

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
        roles: input.roles,
        active: true,
        created_at: "2026-09-03T16:05:00.000Z",
        last_login_at: null,
      };
      created.push(user);
      return user;
    },
    update: async (id, input) => {
      if (id === UNKNOWN_ID) {
        throw new NotFoundError("Extension User not found.");
      }
      if (input.email === "taken@vantage.com") {
        throw new ConflictError("An Extension User already uses this email.");
      }
      const user: AdminExtensionUser = {
        id,
        email: input.email ?? "rep@vantage.com",
        roles: input.roles ?? ["sales"],
        active: true,
        created_at: "2026-09-03T16:05:00.000Z",
        last_login_at: null,
      };
      updated.push(user);
      return user;
    },
    delete: async (id) => {
      if (id === UNKNOWN_ID) {
        throw new NotFoundError("Extension User not found.");
      }
      deleted.push(id);
      return { id };
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
  updated.length = 0;
  deleted.length = 0;
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
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
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
  assert.deepEqual(body.data[0]?.roles, ["owner"]);
  assert.equal("role" in (body.data[0] ?? {}), false);
  assert.equal("password_hash" in (body.data[0] ?? {}), false);
});

test("Admin cannot list, create, PATCH, or DELETE Extension Users", async () => {
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
      roles: ["sales"],
    }),
  });
  assert.equal(createDenied.status, 403);
  assert.equal(created.length, 0);

  const itemPath = `${path}/${EXISTING_ID}`;
  const patchDenied = await fetch(`${baseUrl()}${itemPath}`, {
    method: "PATCH",
    headers: signedHeaders("admin", itemPath, "PATCH"),
    body: JSON.stringify({ roles: ["owner"] }),
  });
  assert.equal(patchDenied.status, 403);
  assert.equal(updated.length, 0);

  const deleteDenied = await fetch(`${baseUrl()}${itemPath}`, {
    method: "DELETE",
    headers: signedHeaders("admin", itemPath, "DELETE"),
  });
  assert.equal(deleteDenied.status, 403);
  assert.equal(deleted.length, 0);
});

test("Owner can create an Extension User with roles", async () => {
  const path = "/api/v1/admin/extension-users";
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
    body: JSON.stringify({
      email: "rep@vantage.com",
      password: "secret-pass",
      roles: ["sales", "customer_service"],
    }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { ok: true; data: AdminExtensionUser };
  assert.equal(body.data.email, "rep@vantage.com");
  assert.deepEqual(body.data.roles, ["sales", "customer_service"]);
  assert.equal("role" in body.data, false);
  assert.equal("password" in body.data, false);
  assert.equal(created.length, 1);
});

test("Owner cannot create an Extension User with empty roles or leftover employee", async () => {
  const path = "/api/v1/admin/extension-users";
  const empty = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
    body: JSON.stringify({
      email: "empty@vantage.com",
      password: "secret-pass",
      roles: [],
    }),
  });
  assert.equal(empty.status, 400);
  const emptyBody = (await empty.json()) as { ok: false; error: string };
  assert.equal(emptyBody.error, "Invalid request payload");

  const employee = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
    body: JSON.stringify({
      email: "legacy@vantage.com",
      password: "secret-pass",
      roles: ["employee"],
    }),
  });
  assert.equal(employee.status, 400);
  assert.equal(created.length, 0);
});

test("create rejects an invalid payload and a duplicate email", async () => {
  const path = "/api/v1/admin/extension-users";
  const invalid = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
    body: JSON.stringify({ email: "not-an-email", password: "short", roles: ["boss"] }),
  });
  assert.equal(invalid.status, 400);

  const duplicate = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: signedHeaders("owner", path, "POST"),
    body: JSON.stringify({
      email: "taken@vantage.com",
      password: "secret-pass",
      roles: ["owner"],
    }),
  });
  assert.equal(duplicate.status, 409);
  const body = (await duplicate.json()) as { ok: false; error: string };
  assert.equal(body.error, "An Extension User already uses this email.");
});

test("Owner can PATCH and DELETE an Extension User", async () => {
  const path = `/api/v1/admin/extension-users/${EXISTING_ID}`;
  const patched = await fetch(`${baseUrl()}${path}`, {
    method: "PATCH",
    headers: signedHeaders("owner", path, "PATCH"),
    body: JSON.stringify({ email: "updated@vantage.com", roles: ["owner"] }),
  });
  assert.equal(patched.status, 200);
  const patchBody = (await patched.json()) as { ok: true; data: AdminExtensionUser };
  assert.equal(patchBody.ok, true);
  assert.equal(patchBody.data.email, "updated@vantage.com");
  assert.deepEqual(patchBody.data.roles, ["owner"]);
  assert.equal(updated.length, 1);

  const removed = await fetch(`${baseUrl()}${path}`, {
    method: "DELETE",
    headers: signedHeaders("owner", path, "DELETE"),
  });
  assert.equal(removed.status, 200);
  const deleteBody = (await removed.json()) as { ok: true; data: { id: string } };
  assert.deepEqual(deleteBody.data, { id: EXISTING_ID });
  assert.deepEqual(deleted, [EXISTING_ID]);
});

test("PATCH treats an empty password as omitted and requires another field", async () => {
  const path = `/api/v1/admin/extension-users/${EXISTING_ID}`;
  const emptyOnly = await fetch(`${baseUrl()}${path}`, {
    method: "PATCH",
    headers: signedHeaders("owner", path, "PATCH"),
    body: JSON.stringify({ password: "" }),
  });
  assert.equal(emptyOnly.status, 400);
  assert.equal(updated.length, 0);

  const omittedWithEmail = await fetch(`${baseUrl()}${path}`, {
    method: "PATCH",
    headers: signedHeaders("owner", path, "PATCH"),
    body: JSON.stringify({ email: "kept@vantage.com", password: "" }),
  });
  assert.equal(omittedWithEmail.status, 200);
  assert.equal(updated.length, 1);
});

test("unknown Extension User id is 404 and invalid ObjectId is 400", async () => {
  const unknownPath = `/api/v1/admin/extension-users/${UNKNOWN_ID}`;
  const missingPatch = await fetch(`${baseUrl()}${unknownPath}`, {
    method: "PATCH",
    headers: signedHeaders("owner", unknownPath, "PATCH"),
    body: JSON.stringify({ email: "new@vantage.com" }),
  });
  assert.equal(missingPatch.status, 404);
  const missingPatchBody = (await missingPatch.json()) as { ok: false; error: string };
  assert.equal(missingPatchBody.error, "Extension User not found.");

  const missingDelete = await fetch(`${baseUrl()}${unknownPath}`, {
    method: "DELETE",
    headers: signedHeaders("owner", unknownPath, "DELETE"),
  });
  assert.equal(missingDelete.status, 404);
  const missingDeleteBody = (await missingDelete.json()) as { ok: false; error: string };
  assert.equal(missingDeleteBody.error, "Extension User not found.");

  const invalidPath = "/api/v1/admin/extension-users/not-an-id";
  const invalidPatch = await fetch(`${baseUrl()}${invalidPath}`, {
    method: "PATCH",
    headers: signedHeaders("owner", invalidPath, "PATCH"),
    body: JSON.stringify({ email: "new@vantage.com" }),
  });
  assert.equal(invalidPatch.status, 400);
  const invalidBody = (await invalidPatch.json()) as { ok: false; error: string };
  assert.equal(invalidBody.error, "Invalid request payload");

  const invalidDelete = await fetch(`${baseUrl()}${invalidPath}`, {
    method: "DELETE",
    headers: signedHeaders("owner", invalidPath, "DELETE"),
  });
  assert.equal(invalidDelete.status, 400);
});
