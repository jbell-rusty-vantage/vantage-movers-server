import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";
import { hasExtensionRole } from "./roles";
import {
  isAccessTokenPayload,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "./tokens";

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

test("access token includes roles and token_version", () => {
  const token = signAccessToken({
    sub: "507f1f77bcf86cd799439011",
    email: "rep@vantage.com",
    roles: ["sales", "customer_service"],
    token_version: 3,
  });
  const payload = verifyAccessToken(token);
  assert.equal(payload.sub, "507f1f77bcf86cd799439011");
  assert.equal(payload.email, "rep@vantage.com");
  assert.deepEqual(payload.roles, ["sales", "customer_service"]);
  assert.equal(payload.token_version, 3);
});

test("singular role tokens and missing claims fail access verify", () => {
  const legacy = jwt.sign(
    { sub: "507f1f77bcf86cd799439011", email: "rep@vantage.com", role: "sales" },
    ACCESS_SECRET,
    { expiresIn: 60 },
  );
  assert.throws(() => verifyAccessToken(legacy), /Invalid access token payload/);

  const missingVersion = jwt.sign(
    { sub: "507f1f77bcf86cd799439011", email: "rep@vantage.com", roles: ["sales"] },
    ACCESS_SECRET,
    { expiresIn: 60 },
  );
  assert.throws(() => verifyAccessToken(missingVersion), /Invalid access token payload/);

  const emptyRoles = jwt.sign(
    {
      sub: "507f1f77bcf86cd799439011",
      email: "rep@vantage.com",
      roles: [],
      token_version: 0,
    },
    ACCESS_SECRET,
    { expiresIn: 60 },
  );
  assert.throws(() => verifyAccessToken(emptyRoles), /Invalid access token payload/);

  const employee = jwt.sign(
    {
      sub: "507f1f77bcf86cd799439011",
      email: "rep@vantage.com",
      roles: ["employee"],
      token_version: 0,
    },
    ACCESS_SECRET,
    { expiresIn: 60 },
  );
  assert.throws(() => verifyAccessToken(employee), /Invalid access token payload/);
});

test("isAccessTokenPayload requires current roles and numeric token_version", () => {
  assert.equal(
    isAccessTokenPayload({
      sub: "1",
      email: "a@b.com",
      roles: ["owner"],
      token_version: 0,
    }),
    true,
  );
  assert.equal(
    isAccessTokenPayload({
      sub: "1",
      email: "a@b.com",
      role: "owner",
    }),
    false,
  );
});

test("refresh token still signs and verifies sub plus token_version", () => {
  const token = signRefreshToken({
    sub: "507f1f77bcf86cd799439011",
    token_version: 8,
  });
  const payload = verifyRefreshToken(token);
  assert.equal(payload.sub, "507f1f77bcf86cd799439011");
  assert.equal(payload.token_version, 8);
});

test("hasExtensionRole Owner checks pass for Owner unions and fail for Sales plus Customer Service", () => {
  assert.equal(hasExtensionRole(["owner"], "owner"), true);
  assert.equal(hasExtensionRole(["owner", "sales"], "owner"), true);
  assert.equal(hasExtensionRole(["sales", "customer_service"], "owner"), false);
});
