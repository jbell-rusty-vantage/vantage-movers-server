import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";
import { verifyAccessToken } from "./tokens";

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
