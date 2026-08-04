import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTrustedCompletionRedirectUrl,
  isProductionGoogleDriveEnvironment,
} from "../../config/domain/googleDriveOAuth";

test("completion redirect must match configured trusted admin origin", () => {
  assert.doesNotThrow(() =>
    assertTrustedCompletionRedirectUrl(
      "https://admin.example.com/settings/google-drive",
      "https://admin.example.com",
      false,
    ),
  );
  assert.throws(
    () =>
      assertTrustedCompletionRedirectUrl(
        "https://evil.example.com/settings/google-drive",
        "https://admin.example.com",
        false,
      ),
    /must match GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN/,
  );
});

test("localhost completion redirect is rejected in production", () => {
  assert.throws(
    () =>
      assertTrustedCompletionRedirectUrl(
        "http://localhost:3000/settings/google-drive",
        "http://localhost:3000",
        true,
      ),
    /cannot target localhost in production/,
  );
  assert.doesNotThrow(() =>
    assertTrustedCompletionRedirectUrl(
      "http://localhost:3000/settings/google-drive",
      "http://localhost:3000",
      false,
    ),
  );
});

test("production detection follows NODE_ENV and VERCEL_ENV", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  process.env.NODE_ENV = "production";
  delete process.env.VERCEL_ENV;
  assert.equal(isProductionGoogleDriveEnvironment(), true);
  process.env.NODE_ENV = "test";
  process.env.VERCEL_ENV = "production";
  assert.equal(isProductionGoogleDriveEnvironment(), true);
  process.env.NODE_ENV = "test";
  delete process.env.VERCEL_ENV;
  assert.equal(isProductionGoogleDriveEnvironment(), false);
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previousVercelEnv;
});
