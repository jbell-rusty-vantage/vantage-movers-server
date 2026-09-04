import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  accessTokenMatchesStoredUser,
  getExtensionUserFromAccessToken,
  issueTokens,
  refreshTokenMatchesStoredUser,
  toPublicExtensionUser,
} from "./session";
import { signAccessToken, verifyAccessToken } from "./tokens";

const ACCESS_SECRET = "test-extension-access-secret";
const REFRESH_SECRET = "test-extension-refresh-secret";

before(() => {
  process.env.EXTENSION_ACCESS_TOKEN_SECRET = ACCESS_SECRET;
  process.env.EXTENSION_REFRESH_TOKEN_SECRET = REFRESH_SECRET;
});

after(() => {
  delete process.env.EXTENSION_ACCESS_TOKEN_SECRET;
  delete process.env.EXTENSION_REFRESH_TOKEN_SECRET;
});

const stored = {
  email: "rep@vantage.com",
  active: true,
  token_version: 4,
  roles: ["sales", "customer_service"] as const,
};

const matchingPayload = {
  email: "rep@vantage.com",
  roles: ["customer_service", "sales"] as ["customer_service", "sales"],
  token_version: 4,
};

test("matching roles set authenticates even when order differs", () => {
  assert.equal(accessTokenMatchesStoredUser(matchingPayload, stored), true);
});

test("set mismatch, missing roles, missing version, email drift, inactive, and deleted fail", () => {
  assert.equal(
    accessTokenMatchesStoredUser({ ...matchingPayload, roles: ["sales"] }, stored),
    false,
  );
  assert.equal(
    accessTokenMatchesStoredUser({ ...matchingPayload, roles: [] }, stored),
    false,
  );
  assert.equal(
    accessTokenMatchesStoredUser({ ...matchingPayload, token_version: 3 }, stored),
    false,
  );
  assert.equal(
    accessTokenMatchesStoredUser({ ...matchingPayload, email: "other@vantage.com" }, stored),
    false,
  );
  assert.equal(
    accessTokenMatchesStoredUser(matchingPayload, { ...stored, active: false }),
    false,
  );
  assert.equal(accessTokenMatchesStoredUser(matchingPayload, null), false);
});

test("leftover employee stored role matches Sales plus Customer Service claims", () => {
  assert.equal(
    accessTokenMatchesStoredUser(matchingPayload, {
      email: "rep@vantage.com",
      active: true,
      token_version: 4,
      role: "employee",
    }),
    true,
  );
});

test("refresh rejects a stale token_version", () => {
  assert.equal(refreshTokenMatchesStoredUser({ token_version: 4 }, stored), true);
  assert.equal(refreshTokenMatchesStoredUser({ token_version: 3 }, stored), false);
  assert.equal(refreshTokenMatchesStoredUser({ token_version: 4 }, null), false);
  assert.equal(
    refreshTokenMatchesStoredUser({ token_version: 4 }, { ...stored, active: false }),
    false,
  );
});

test("issueTokens writes roles and token_version onto the access token", () => {
  const tokens = issueTokens(
    {
      _id: { toString: () => "507f1f77bcf86cd799439011" },
      email: "rep@vantage.com",
      token_version: 6,
    },
    ["owner", "sales"],
  );
  const payload = verifyAccessToken(tokens.accessToken);
  assert.deepEqual(payload.roles, ["owner", "sales"]);
  assert.equal(payload.token_version, 6);
});

test("PublicExtensionUser is id, email, and roles", () => {
  const user = toPublicExtensionUser(
    { _id: { toString: () => "user-1" }, email: "owner@vantage.com" },
    ["owner"],
  );
  assert.deepEqual(user, {
    id: "user-1",
    email: "owner@vantage.com",
    roles: ["owner"],
  });
  assert.equal("role" in user, false);
});

test("getExtensionUserFromAccessToken uses the matcher through an injected lookup", async () => {
  const token = signAccessToken({
    sub: "507f1f77bcf86cd799439011",
    email: "rep@vantage.com",
    roles: ["sales", "customer_service"],
    token_version: 4,
  });

  const user = await getExtensionUserFromAccessToken(token, {
    async findActiveById(id) {
      assert.equal(id, "507f1f77bcf86cd799439011");
      return {
        _id: { toString: () => id },
        email: "rep@vantage.com",
        active: true,
        token_version: 4,
        roles: ["customer_service", "sales"],
      };
    },
  });
  assert.deepEqual(user?.roles, ["sales", "customer_service"]);

  const stale = await getExtensionUserFromAccessToken(token, {
    async findActiveById() {
      return {
        _id: { toString: () => "507f1f77bcf86cd799439011" },
        email: "rep@vantage.com",
        active: true,
        token_version: 5,
        roles: ["sales", "customer_service"],
      };
    },
  });
  assert.equal(stale, null);

  const missing = await getExtensionUserFromAccessToken(token, {
    async findActiveById() {
      return null;
    },
  });
  assert.equal(missing, null);
});
