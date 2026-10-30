import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSitePreviewEnvironment, isSitePreviewRequestAllowed } from "./sitePreview";

test("website preview rejects production database and enabled side effects", () => {
  const env = {
    TEST_MODE: "true", TEST_MONGO_DATABASE_NAME: "testvantagemovers_sitepreview",
    CRM_FORM_LEAD_POSTING_ENABLED: "false", SHEET_SYNC_MODE: "disabled",
    LEAD_MESSAGING_MODE: "disabled", LEAD_MESSAGING_ALLOW_TEST_MODE: "false",
    SALES_INTELLIGENCE_ENABLED: "false", MONGO_URI: "mongodb://localhost", VANTAGE_API_SECRET: "test",
  };
  assert.doesNotThrow(() => assertSitePreviewEnvironment(env));
  for (const key of Object.keys(env)) {
    assert.throws(() => assertSitePreviewEnvironment({ ...env, [key]: "" }));
  }
  assert.throws(() => assertSitePreviewEnvironment({ ...env, TEST_MODE: "false" }));
  assert.throws(() => assertSitePreviewEnvironment({ ...env, TEST_MONGO_DATABASE_NAME: "vantagemovers" }));
});
test("website preview only exposes content reads, form creation, and single form readback", () => {
  assert.equal(isSitePreviewRequestAllowed("POST", "/api/v1/form-leads"), true);
  assert.equal(isSitePreviewRequestAllowed("GET", "/api/v1/form-leads/123456789012345678901234"), true);
  for (const path of ["/api/cron/sheet-sync", "/api/v1/form-leads", "/api/v1/analytics", "/api/v1/booked-leads", "/api/v1/extension/auth/login"]) {
    assert.equal(isSitePreviewRequestAllowed("GET", path), false);
  }
  assert.equal(isSitePreviewRequestAllowed("PATCH", "/api/v1/form-leads/123456789012345678901234"), false);
});
