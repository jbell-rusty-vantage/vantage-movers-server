import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  assertGoogleDriveSecretsRedacted,
  sanitizeGoogleDriveConnectionStatus,
} from "./googleDriveOAuth.service";
import { getGoogleDriveOAuthPublicConfig } from "../../config/domain/googleDriveOAuth";
import {
  assertPickerBootstrapAllowlist,
  type PickerBootstrapResponse,
} from "./picker.service";
import {
  ownershipMarkerMatchesDestination,
  parseReportingOwnershipMarker,
  serializeReportingOwnershipMarker,
} from "../reporting/ownershipMarker";

const ENCRYPTION_KEY = randomBytes(32).toString("base64");

function withOAuthEnv(run: () => void): void {
  const previous = {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    tokenKey: process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY,
    pickerKey: process.env.GOOGLE_PICKER_API_KEY,
    pickerApp: process.env.GOOGLE_PICKER_APP_ID,
    trustedAdminOrigin: process.env.GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN,
    ownerEmail: process.env.GOOGLE_OAUTH_OWNER_EMAIL,
  };
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "super-secret-client-secret";
  process.env.GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.GOOGLE_PICKER_API_KEY = "picker-api-key";
  process.env.GOOGLE_PICKER_APP_ID = "picker-app-id";
  process.env.GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN = "https://admin.example.com";
  process.env.GOOGLE_OAUTH_OWNER_EMAIL = "owner@example.com";
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries({
      GOOGLE_OAUTH_CLIENT_ID: previous.clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: previous.clientSecret,
      GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: previous.tokenKey,
      GOOGLE_PICKER_API_KEY: previous.pickerKey,
      GOOGLE_PICKER_APP_ID: previous.pickerApp,
      GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN: previous.trustedAdminOrigin,
      GOOGLE_OAUTH_OWNER_EMAIL: previous.ownerEmail,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("public Google OAuth config excludes server secrets", () => {
  withOAuthEnv(() => {
    const config = getGoogleDriveOAuthPublicConfig();
    assert.equal(config.clientId, "client-id.apps.googleusercontent.com");
    assert.equal(config.pickerConfigured, true);
    assertGoogleDriveSecretsRedacted(config);
  });
});

test("sanitized Google Drive connection status excludes configured owner email", () => {
  const sanitized = sanitizeGoogleDriveConnectionStatus({
    connected: false,
    owner_email: "configured-owner@example.com",
  });
  assert.equal(sanitized.connected, false);
  assert.equal("owner_email" in sanitized, false);
});

test("sanitized Google Drive connection status excludes refresh credentials", () => {
  const sanitized = sanitizeGoogleDriveConnectionStatus({
    connected: true,
    owner_email: "owner@example.com",
    google_email: "owner@example.com",
    scopes: ["https://www.googleapis.com/auth/drive.file"],
    connected_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-02T00:00:00.000Z"),
  });
  assertGoogleDriveSecretsRedacted(sanitized);
  assert.equal(sanitized.connected, true);
});

test("Picker bootstrap allowlist rejects unexpected response fields", () => {
  const allowed: PickerBootstrapResponse = {
    picker_api_key: "picker-api-key",
    picker_app_id: "picker-app-id",
    access_token: "short-lived-access-token",
    access_token_expires_at: new Date().toISOString(),
    flow: "folder",
    views: [{ mime_type: "application/vnd.google-apps.folder", mode: "folder" }],
    selection_nonce: "nonce-value",
    connection_health: {
      connected: true,
      token_healthy: true,
      google_email: "owner@example.com",
    },
  };
  assert.doesNotThrow(() =>
    assertPickerBootstrapAllowlist(allowed as unknown as Record<string, unknown>),
  );
  assert.throws(
    () =>
      assertPickerBootstrapAllowlist({
        ...allowed,
        refresh_token: "must-not-leak",
      } as unknown as Record<string, unknown>),
    /Unexpected Picker bootstrap field: refresh_token/,
  );
});

test("reporting ownership marker round-trips and matches destination ID", () => {
  const serialized = serializeReportingOwnershipMarker("64b000000000000000000099");
  const parsed = parseReportingOwnershipMarker(serialized);
  assert.ok(parsed);
  assert.equal(
    ownershipMarkerMatchesDestination(serialized, "64b000000000000000000099"),
    true,
  );
  assert.equal(
    ownershipMarkerMatchesDestination(serialized, "64b000000000000000000001"),
    false,
  );
});
