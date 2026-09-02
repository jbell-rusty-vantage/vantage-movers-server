import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_API_BASE_URL,
  assertProductionWriteAllowed,
  buildVantageApiUrl,
  isProductionApiBase,
  loadVantageApiConfig,
} from "./vantageApi";

test("loadVantageApiConfig requires VANTAGE_API_SECRET", () => {
  assert.throws(
    () => loadVantageApiConfig({}),
    /VANTAGE_API_SECRET is not set/,
  );
});

test("loadVantageApiConfig defaults to production and never echoes the secret", () => {
  const config = loadVantageApiConfig({
    VANTAGE_API_SECRET: "test-secret",
  });
  assert.equal(config.baseUrl, PRODUCTION_API_BASE_URL);
  assert.equal(config.apiSecret, "test-secret");
  assert.equal(config.admin, undefined);
});

test("production write guard", () => {
  assert.doesNotThrow(() =>
    assertProductionWriteAllowed({
      method: "GET",
      baseUrl: PRODUCTION_API_BASE_URL,
      confirmed: false,
    }),
  );
  assert.throws(
    () =>
      assertProductionWriteAllowed({
        method: "POST",
        baseUrl: PRODUCTION_API_BASE_URL,
        confirmed: false,
      }),
    /Refusing a production write/,
  );
  assert.doesNotThrow(() =>
    assertProductionWriteAllowed({
      method: "POST",
      baseUrl: PRODUCTION_API_BASE_URL,
      confirmed: true,
    }),
  );
  assert.doesNotThrow(() =>
    assertProductionWriteAllowed({
      method: "POST",
      baseUrl: "http://localhost:3000",
      confirmed: false,
    }),
  );
});

test("buildVantageApiUrl joins path and query", () => {
  assert.equal(
    buildVantageApiUrl(PRODUCTION_API_BASE_URL, "/api/v1/form-leads", {
      limit: 5,
      unused: undefined,
    }),
    `${PRODUCTION_API_BASE_URL}/api/v1/form-leads?limit=5`,
  );
  assert.equal(isProductionApiBase("http://localhost:3000"), false);
});
