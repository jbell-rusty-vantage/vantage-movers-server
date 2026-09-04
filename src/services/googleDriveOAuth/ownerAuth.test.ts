import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Request } from "express";
import { UnauthorizedError } from "../errors";
import {
  computeAdminActorSignature,
} from "../operationsRegistry/trustedActor";
import {
  GoogleDriveOwnerAccessRequiredError,
  requireGoogleDriveOwnerActor,
} from "./ownerAuth";
import {
  sanitizeGoogleDriveApiError,
  sanitizeGoogleDriveCallbackLog,
} from "./oauthSecurity";

const TEST_SECRET = "test-signing-secret";
const OWNER_EMAIL = "owner@example.com";
const BASE_PATH = "/api/v1/admin/google-drive/status";

afterEach(() => {
  delete process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY;
  delete process.env.GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN;
});

function configureOAuthEnv(): void {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
  process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY =
    Buffer.alloc(32, 1).toString("base64");
  process.env.GOOGLE_OAUTH_OWNER_EMAIL = OWNER_EMAIL;
  process.env.GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN = "https://admin.example.com";
  process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET = TEST_SECRET;
}

function signedOwnerRequest(): Request {
  const timestamp = `${Date.now()}`;
  const signature = computeAdminActorSignature(
    {
      adminId: "admin_123",
      email: OWNER_EMAIL,
      role: "owner",
      timestamp,
      requestId: "req_abc123",
      method: "GET",
      path: BASE_PATH,
    },
    TEST_SECRET,
  );
  return {
    method: "GET",
    originalUrl: BASE_PATH,
    url: BASE_PATH,
    header(name: string) {
      const headers: Record<string, string> = {
        "x-vantage-admin-user-id": "admin_123",
        "x-vantage-admin-email": OWNER_EMAIL,
        "x-vantage-admin-role": "owner",
        "x-vantage-admin-request-id": "req_abc123",
        "x-vantage-admin-timestamp": timestamp,
        "x-vantage-admin-signature": signature,
      };
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

test("google drive owner auth accepts the signed owner admin proxy", () => {
  configureOAuthEnv();
  const req = signedOwnerRequest();
  const actor = requireGoogleDriveOwnerActor({
    ...req,
    vantageAuth: { kind: "secret" },
  } as unknown as Request);
  assert.equal(actor.actorLabel, OWNER_EMAIL);
});

test("google drive owner auth rejects scoped API keys", () => {
  configureOAuthEnv();
  assert.throws(
    () =>
      requireGoogleDriveOwnerActor({
        ...signedOwnerRequest(),
        vantageAuth: { kind: "scoped_key", scopedKeyName: "integration" },
      } as unknown as Request),
    GoogleDriveOwnerAccessRequiredError,
  );
});

test("google drive owner auth requires signed owner matching configured identity", () => {
  configureOAuthEnv();
  const actor = requireGoogleDriveOwnerActor({
    ...signedOwnerRequest(),
    vantageAuth: {
      kind: "user",
      userId: "admin_123",
      email: OWNER_EMAIL,
      roles: ["owner"],
    },
  } as unknown as Request);
  assert.equal(actor.actorLabel, OWNER_EMAIL);
});

test("sanitized google drive API errors do not expose configured owner email", () => {
  const serialized = sanitizeGoogleDriveApiError(
    new UnauthorizedError("The connected Google account is not authorized for reporting.", {
      statusCode: 403,
    }),
  );
  assert.equal(serialized.body.code, "oauth_identity_rejected");
  assert.doesNotMatch(String(serialized.body.error), /owner@example.com/);
  assert.doesNotMatch(String(serialized.body.error), /jbell@/);
});

test("callback failure logs use stable categories without provider text", () => {
  const log = sanitizeGoogleDriveCallbackLog(
    new UnauthorizedError("The connected Google account is not authorized for reporting.", {
      statusCode: 403,
    }),
  );
  assert.equal(log.category, "oauth_identity_rejected");
  assert.equal(log.errorName, "UnauthorizedError");
});
