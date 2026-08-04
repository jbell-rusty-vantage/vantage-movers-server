import assert from "node:assert/strict";
import test from "node:test";
import type { drive_v3 } from "googleapis";
import type { Auth, sheets_v4 } from "googleapis";
import { GOOGLE_SERVICE_ACCOUNT_ENV_VARS } from "../../../config/domain/googleAuth";
import {
  buildLiveTestGoogleAdaptersFromOAuthClient,
  getLiveTestGoogleApiFactoryForTests,
  setLiveTestGoogleApiFactoryForTests,
} from "./liveTestOAuthAdapters";

test("live test google api factory receives explicit OAuth2Client", () => {
  const fakeAuth = { credentials: { access_token: "test" } } as Auth.OAuth2Client;
  let receivedAuth: Auth.OAuth2Client | undefined;
  const fakeDrive = { files: {} } as unknown as drive_v3.Drive;
  const fakeSheets = {} as sheets_v4.Sheets;
  setLiveTestGoogleApiFactoryForTests((auth) => {
    receivedAuth = auth;
    return { driveApi: fakeDrive, sheetsApi: fakeSheets };
  });
  try {
    const clients = getLiveTestGoogleApiFactoryForTests()(fakeAuth);
    assert.equal(receivedAuth, fakeAuth);
    assert.equal(clients.driveApi, fakeDrive);
    assert.equal(clients.sheetsApi, fakeSheets);
  } finally {
    setLiveTestGoogleApiFactoryForTests(null);
  }
});

test("live test google api factory rejects service-account env indicators", () => {
  const key = GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json;
  const saved = process.env[key];
  try {
    process.env[key] = '{"type":"service_account"}';
    assert.throws(
      () =>
        buildLiveTestGoogleAdaptersFromOAuthClient({
          credentials: {},
        } as Auth.OAuth2Client),
      /reject service-account/i,
    );
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});
