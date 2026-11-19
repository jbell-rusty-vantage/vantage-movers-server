import assert from "node:assert/strict";
import test from "node:test";
import {
  getMasterBookedSheetContainerId,
  getMasterLeadsSheetContainerId,
  getMongoDatabaseName,
  getSourceLeadSheetContainerId,
} from "./runtime";

/**
 * Snapshots/restores a single env var around the supplied callback so that
 * TEST_MODE toggles in one test never bleed into other tests in the suite.
 */
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

test("getMongoDatabaseName swaps between the prod and test databases on TEST_MODE", () => {
  withEnv("TEST_MONGO_DATABASE_NAME", undefined, () => {
    withEnv("TEST_MODE", "true", () =>
      assert.equal(getMongoDatabaseName(), "testvantagemovers"),
    );
    withEnv("TEST_MODE", "false", () =>
      assert.equal(getMongoDatabaseName(), "vantagemovers"),
    );
    withEnv("TEST_MODE", undefined, () =>
      assert.equal(getMongoDatabaseName(), "vantagemovers"),
    );
  });
});

test("an isolated test database override cannot change the production database", () => {
  withEnv("TEST_MONGO_DATABASE_NAME", "testvantagemovers_agent", () => {
    withEnv("TEST_MODE", "true", () =>
      assert.equal(getMongoDatabaseName(), "testvantagemovers_agent"),
    );
    withEnv("TEST_MODE", "false", () =>
      assert.equal(getMongoDatabaseName(), "vantagemovers"),
    );
  });
});

test("sheet container id helpers route through the TEST_-prefixed env var in test mode", () => {
  withEnv("TEST_MODE", "true", () => {
    withEnv("TEST_MASTER_LEADS_SHEET_ID", "sheet-leads-test", () => {
      assert.equal(getMasterLeadsSheetContainerId(), "sheet-leads-test");
    });
    withEnv("TEST_MASTER_BOOKED_SHEET_ID", "sheet-booked-test", () => {
      assert.equal(getMasterBookedSheetContainerId(), "sheet-booked-test");
    });
    withEnv("TEST_TBM_LEADS_SHEET_ID", "sheet-tbm-test", () => {
      assert.equal(getSourceLeadSheetContainerId("tbm_leads"), "sheet-tbm-test");
    });
  });
});

test("getSourceLeadSheetContainerId returns undefined for paid_overflow (Master Sheets only)", () => {
  assert.equal(getSourceLeadSheetContainerId("paid_overflow"), undefined);
});
