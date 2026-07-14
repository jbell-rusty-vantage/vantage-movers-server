import { isTestMode } from "./runtime";

/**
 * Google service-account env-var names and TEST_MODE-aware selector
 * functions used by `services/googleSheets/auth.ts` and the auth
 * diagnostics helper.
 *
 * Behavior preserved from the original `api/config/domain.ts`:
 *   - In test mode (`TEST_MODE=true`), the selectors return the `*_TEST_*`
 *     env-var names so that test runs read a dedicated service account and
 *     never accidentally authenticate against production Google Sheets.
 *   - The selector functions re-evaluate `isTestMode()` on every call;
 *     toggling `TEST_MODE` at runtime takes effect on the next selector
 *     invocation.
 */

export const GOOGLE_SERVICE_ACCOUNT_ENV_VARS = {
  json: "GOOGLE_SERVICE_ACCOUNT_JSON",
  testJson: "GOOGLE_SERVICE_ACCOUNT_TEST_JSON",
  base64Json: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
  testBase64Json: "GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64",
} as const;

export function getGoogleServiceAccountJsonEnvVar():
  | "GOOGLE_SERVICE_ACCOUNT_JSON"
  | "GOOGLE_SERVICE_ACCOUNT_TEST_JSON" {
  return isTestMode()
    ? GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testJson
    : GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json;
}

export function getGoogleServiceAccountJsonBase64EnvVar():
  | "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"
  | "GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64" {
  return isTestMode()
    ? GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testBase64Json
    : GOOGLE_SERVICE_ACCOUNT_ENV_VARS.base64Json;
}
