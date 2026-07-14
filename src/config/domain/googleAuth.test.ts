import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_SERVICE_ACCOUNT_ENV_VARS,
  getGoogleServiceAccountJsonBase64EnvVar,
  getGoogleServiceAccountJsonEnvVar,
} from "./googleAuth";

function withEnv(
  name: string,
  value: string | undefined,
  callback: () => void,
): void {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

test("Google service account env var name constants match the production / test names", () => {
  assert.equal(GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json, "GOOGLE_SERVICE_ACCOUNT_JSON");
  assert.equal(GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testJson, "GOOGLE_SERVICE_ACCOUNT_TEST_JSON");
  assert.equal(
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.base64Json,
    "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
  );
  assert.equal(
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testBase64Json,
    "GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64",
  );
});

test("Google service account env var selectors swap to the *_TEST_* names in test mode", () => {
  withEnv("TEST_MODE", "true", () => {
    assert.equal(
      getGoogleServiceAccountJsonEnvVar(),
      "GOOGLE_SERVICE_ACCOUNT_TEST_JSON",
    );
    assert.equal(
      getGoogleServiceAccountJsonBase64EnvVar(),
      "GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64",
    );
  });

  withEnv("TEST_MODE", undefined, () => {
    assert.equal(
      getGoogleServiceAccountJsonEnvVar(),
      "GOOGLE_SERVICE_ACCOUNT_JSON",
    );
    assert.equal(
      getGoogleServiceAccountJsonBase64EnvVar(),
      "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
    );
  });
});
