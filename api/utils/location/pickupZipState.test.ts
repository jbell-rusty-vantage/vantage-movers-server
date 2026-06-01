import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getStateCodeForZip } from "./pickupZipState";

const originalFetch = globalThis.fetch;
const originalEnv = {
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
  GOOGLE_SERVICE_ACCOUNT_TEST_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_TEST_JSON,
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
  GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64:
    process.env.GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64,
  SERVICE_ACCOUNT_LOCAL_FILE: process.env.SERVICE_ACCOUNT_LOCAL_FILE,
  GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv();
});

test("getStateCodeForZip falls back to Zippopotamus when Google auth is unavailable", async () => {
  clearGoogleAuthEnv();
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        places: [
          {
            state: "Florida",
            "state abbreviation": "FL",
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  const stateCode = await getStateCodeForZip("33101");

  assert.equal(stateCode, "FL");
});

function clearGoogleAuthEnv(): void {
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_TEST_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64;
  delete process.env.SERVICE_ACCOUNT_LOCAL_FILE;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GCLOUD_PROJECT;
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
