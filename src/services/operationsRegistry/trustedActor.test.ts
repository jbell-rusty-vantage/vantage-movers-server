import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  computeAdminActorSignature,
  verifyAdminActorSignature,
  verifyRegistryActor,
} from "./trustedActor";
import {
  ADMIN_PROXY_HEADER_NAMES,
  buildCanonicalAdminActorPayload,
  normalizeAdminPath,
} from "./trustedActorCanonical";
import { RegistryError } from "./errors";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";

const TEST_SECRET = "test-signing-secret";

const BASE_FIELDS = {
  adminId: "admin_123",
  email: "Owner@Example.test",
  role: "owner",
  timestamp: "1700000000000",
  requestId: "req_abc123",
  method: "GET",
  path: "/api/v1/admin/operations-registry/overview",
};

function signedHeaders(overrides: Partial<typeof BASE_FIELDS & { signature?: string }> = {}) {
  const fields = { ...BASE_FIELDS, ...overrides };
  const signature =
    overrides.signature ??
    computeAdminActorSignature(
      {
        adminId: fields.adminId,
        email: fields.email,
        role: fields.role,
        timestamp: fields.timestamp,
        requestId: fields.requestId,
        method: fields.method,
        path: fields.path,
      },
      TEST_SECRET,
    );

  return {
    adminUserId: fields.adminId,
    adminEmail: fields.email,
    adminRole: fields.role,
    requestId: fields.requestId,
    timestamp: fields.timestamp,
    signature,
  };
}

afterEach(() => {
  delete process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;
  delete process.env.OPERATIONS_REGISTRY_ALLOW_UNSIGNED_PREVIEW;
  delete process.env.NODE_ENV;
  delete process.env.VERCEL_ENV;
  delete process.env.VANTAGE_ADMIN_PROXY_SIGNATURE_MAX_AGE_MS;
});

test("canonical payload normalizes email, role, method, and path", () => {
  const payload = buildCanonicalAdminActorPayload({
    adminId: " admin_123 ",
    email: " Owner@Example.test ",
    role: " Owner ",
    timestamp: "1700000000000",
    requestId: "req_abc123",
    method: "get",
    path: "/api/v1/admin/operations-registry/overview/",
  });

  assert.equal(
    payload,
    [
      "admin_123",
      "owner@example.test",
      "owner",
      "1700000000000",
      "req_abc123",
      "GET",
      "/api/v1/admin/operations-registry/overview",
    ].join("\n"),
  );
});

test("verifyRegistryActor accepts a valid owner signature", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;

  const actor = verifyRegistryActor({
    method: "GET",
    path: BASE_FIELDS.path,
    headers: signedHeaders(),
    now: 1_700_000_000_000,
  });

  assert.equal(actor.actorType, "owner");
  assert.equal(actor.actorId, "admin_123");
  assert.equal(actor.actorLabel, "owner@example.test");
  assert.equal(actor.requestId, "req_abc123");
});

test("verifyRegistryActor rejects admin role for owner-only mutation", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "POST",
        path: "/api/v1/admin/agents",
        headers: signedHeaders({ role: "admin" }),
        requireOwner: true,
        now: 1_700_000_000_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.equal(error.registryCode, REGISTRY_ERROR_CODES.FORBIDDEN);
      return true;
    },
  );
});

test("verifyRegistryActor allows admin read access with valid signature", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;

  const actor = verifyRegistryActor({
    method: "GET",
    path: BASE_FIELDS.path,
    headers: signedHeaders({ role: "admin" }),
    now: 1_700_000_000_000,
  });

  assert.equal(actor.actorRole, "admin");
});

test("verifyRegistryActor rejects missing signature headers", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "GET",
        path: BASE_FIELDS.path,
        headers: {
          adminUserId: BASE_FIELDS.adminId,
          adminEmail: BASE_FIELDS.email,
          adminRole: BASE_FIELDS.role,
        },
        now: 1_700_000_000_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.equal(error.registryCode, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING);
      return true;
    },
  );
});

test("verifyRegistryActor rejects expired signatures outside replay window", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;
  process.env.VANTAGE_ADMIN_PROXY_SIGNATURE_MAX_AGE_MS = "60000";

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "GET",
        path: BASE_FIELDS.path,
        headers: signedHeaders(),
        now: 1_700_000_000_000 + 120_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.equal(error.registryCode, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_EXPIRED);
      assert.ok(error.remediation?.action === "retry");
      return true;
    },
  );
});

test("verifyRegistryActor rejects tampered signatures", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "GET",
        path: BASE_FIELDS.path,
        headers: signedHeaders({ signature: "deadbeef".repeat(8) }),
        now: 1_700_000_000_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.equal(error.registryCode, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_INVALID);
      return true;
    },
  );
});

test("verifyRegistryActor rejects method/path mismatches", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "POST",
        path: "/api/v1/admin/agents",
        headers: signedHeaders(),
        now: 1_700_000_000_000,
      }),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.equal(error.registryCode, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_INVALID);
      return true;
    },
  );
});

test("verifyAdminActorSignature uses constant-time comparison semantics", () => {
  const signature = computeAdminActorSignature(BASE_FIELDS, TEST_SECRET);
  assert.equal(verifyAdminActorSignature(signature, signature), true);
  assert.equal(verifyAdminActorSignature(`${signature}x`, signature), false);
});

test("preview unsigned compatibility is disabled in production", () => {
  process.env.NODE_ENV = "production";
  process.env.OPERATIONS_REGISTRY_ALLOW_UNSIGNED_PREVIEW = "true";

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "POST",
        path: "/api/v1/admin/agents",
        headers: {
          adminUserId: BASE_FIELDS.adminId,
          adminEmail: BASE_FIELDS.email,
          adminRole: "owner",
        },
        requireOwner: true,
        now: Date.now(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.equal(error.registryCode, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING);
      return true;
    },
  );
});

test("preview unsigned compatibility never authorizes mutations", () => {
  process.env.NODE_ENV = "test";
  process.env.OPERATIONS_REGISTRY_ALLOW_UNSIGNED_PREVIEW = "true";

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "POST",
        path: "/api/v1/admin/agents",
        headers: {
          adminUserId: BASE_FIELDS.adminId,
          adminEmail: BASE_FIELDS.email,
          adminRole: "owner",
          requestId: BASE_FIELDS.requestId,
        },
        requireOwner: true,
        now: Date.now(),
      }),
    (error: unknown) =>
      error instanceof RegistryError &&
      error.registryCode === REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING,
  );
});

test("unsigned preview reads require a unique request ID", () => {
  process.env.NODE_ENV = "test";
  process.env.OPERATIONS_REGISTRY_ALLOW_UNSIGNED_PREVIEW = "true";

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "GET",
        path: "/api/v1/admin/operations-registry/overview",
        headers: {
          adminUserId: BASE_FIELDS.adminId,
          adminEmail: BASE_FIELDS.email,
          adminRole: "owner",
        },
        now: Date.now(),
      }),
    (error: unknown) =>
      error instanceof RegistryError &&
      error.registryCode === REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING,
  );
});

test("exported header names match dashboard proxy contract", () => {
  assert.equal(ADMIN_PROXY_HEADER_NAMES.userId, "x-vantage-admin-user-id");
  assert.equal(ADMIN_PROXY_HEADER_NAMES.signature, "x-vantage-admin-signature");
  assert.equal(normalizeAdminPath("/api/v1/admin/operations-registry/health/"), "/api/v1/admin/operations-registry/health");
});

test("extension owner Bearer auth can read agent catalog without signed proxy headers", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "production";

  const actor = verifyRegistryActor({
    method: "GET",
    path: "/api/v1/admin/catalog/agents",
    headers: {},
    auth: {
      kind: "user",
      userId: "ext_owner_1",
      email: "Owner@Example.test",
      roles: ["owner"],
    },
    now: Date.now(),
  });

  assert.equal(actor.actorType, "owner");
  assert.equal(actor.actorId, "ext_owner_1");
  assert.equal(actor.actorLabel, "owner@example.test");
  assert.equal(actor.requestId, "extension:ext_owner_1");
});

test("extension owner Bearer auth can create agents without signed proxy headers", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "production";

  const actor = verifyRegistryActor({
    method: "POST",
    path: "/api/v1/admin/agents",
    headers: {},
    auth: {
      kind: "user",
      userId: "ext_owner_1",
      email: "owner@example.test",
      roles: ["owner", "sales"],
    },
    requireOwner: true,
    now: Date.now(),
  });

  assert.equal(actor.actorRole, "owner");
  assert.equal(actor.actorId, "ext_owner_1");
});

test("extension owner Bearer auth cannot mutate non-catalog registry routes", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "production";

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "POST",
        path: "/api/v1/admin/source-companies",
        headers: {},
        auth: {
          kind: "user",
          userId: "ext_owner_1",
          email: "owner@example.test",
          roles: ["owner"],
        },
        requireOwner: true,
        now: Date.now(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.equal(error.registryCode, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING);
      return true;
    },
  );
});

test("extension sales Bearer auth is not a registry actor", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "production";

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "GET",
        path: "/api/v1/admin/catalog/agents",
        headers: {},
        auth: {
          kind: "user",
          userId: "ext_sales_1",
          email: "sales@example.test",
          roles: ["sales"],
        },
        now: Date.now(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.equal(error.registryCode, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING);
      return true;
    },
  );
});

test("extension Sales plus Customer Service Bearer auth is not a registry actor", () => {
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;
  process.env.NODE_ENV = "production";

  assert.throws(
    () =>
      verifyRegistryActor({
        method: "GET",
        path: "/api/v1/admin/catalog/agents",
        headers: {},
        auth: {
          kind: "user",
          userId: "ext_employee_1",
          email: "employee@example.test",
          roles: ["sales", "customer_service"],
        },
        now: Date.now(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof RegistryError);
      assert.equal(error.registryCode, REGISTRY_ERROR_CODES.ACTOR_SIGNATURE_MISSING);
      return true;
    },
  );
});
