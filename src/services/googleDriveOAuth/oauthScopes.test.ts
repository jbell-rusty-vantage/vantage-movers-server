import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAllowedOAuthScopes,
  normalizeOAuthScopes,
  scopesMatchAllowedSet,
  OAuthScopeViolationError,
} from "./oauthScopes";

test("allowed OAuth scopes reject overgrant and extra scopes", () => {
  assert.equal(
    scopesMatchAllowedSet([
      "openid",
      "email",
      "https://www.googleapis.com/auth/drive.file",
    ]),
    true,
  );
  assert.equal(
    scopesMatchAllowedSet([
      "openid",
      "email",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive",
    ]),
    false,
  );
  assert.throws(
    () =>
      assertAllowedOAuthScopes(
        [
          "openid",
          "email",
          "https://www.googleapis.com/auth/drive",
        ],
        "test",
      ),
    OAuthScopeViolationError,
  );
});

test("OAuth scope normalization is order-insensitive", () => {
  assert.deepEqual(
    normalizeOAuthScopes(
      "email openid https://www.googleapis.com/auth/drive.file",
    ),
    normalizeOAuthScopes([
      "https://www.googleapis.com/auth/drive.file",
      "openid",
      "email",
    ]),
  );
});

test("Google userinfo.email URI is treated as the email scope", () => {
  assert.deepEqual(
    normalizeOAuthScopes([
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/drive.file",
    ]),
    normalizeOAuthScopes([
      "openid",
      "email",
      "https://www.googleapis.com/auth/drive.file",
    ]),
  );
  assert.equal(
    scopesMatchAllowedSet([
      "https://www.googleapis.com/auth/drive.file",
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
    ]),
    true,
  );
});
