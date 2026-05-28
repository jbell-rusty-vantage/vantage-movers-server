import assert from "node:assert/strict";
import test from "node:test";
import { SHEET_CONTAINER_ENV_VARS } from "./sheets";
import {
  getMasterBookedSheetContainerId,
  getMasterLeadsSheetContainerId,
  getMongoDatabaseName,
  getRequiredEnv,
  getRuntimeSheetContainerEnvVar,
  getSourceLeadSheetContainerId,
  isTestMode,
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

test("isTestMode is true only for the literal string 'true' after trim/lowercasing", () => {
  withEnv("TEST_MODE", "true", () => assert.equal(isTestMode(), true));
  withEnv("TEST_MODE", "TRUE", () => assert.equal(isTestMode(), true));
  withEnv("TEST_MODE", "  true  ", () => assert.equal(isTestMode(), true));
  withEnv("TEST_MODE", "false", () => assert.equal(isTestMode(), false));
  withEnv("TEST_MODE", "1", () => assert.equal(isTestMode(), false));
  withEnv("TEST_MODE", undefined, () => assert.equal(isTestMode(), false));
});

test("getMongoDatabaseName swaps between the prod and test databases on TEST_MODE", () => {
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

test("getRuntimeSheetContainerEnvVar prefixes TEST_ in test mode and is identity otherwise", () => {
  withEnv("TEST_MODE", "true", () => {
    assert.equal(
      getRuntimeSheetContainerEnvVar(SHEET_CONTAINER_ENV_VARS.masterLeads),
      "TEST_MASTER_LEADS_SHEET_ID",
    );
    assert.equal(
      getRuntimeSheetContainerEnvVar(SHEET_CONTAINER_ENV_VARS.masterBooked),
      "TEST_MASTER_BOOKED_SHEET_ID",
    );
    assert.equal(
      getRuntimeSheetContainerEnvVar(
        SHEET_CONTAINER_ENV_VARS.sourceLeads.tbm_leads,
      ),
      "TEST_TBM_LEADS_SHEET_ID",
    );
  });

  withEnv("TEST_MODE", undefined, () => {
    assert.equal(
      getRuntimeSheetContainerEnvVar(SHEET_CONTAINER_ENV_VARS.masterLeads),
      "MASTER_LEADS_SHEET_ID",
    );
    assert.equal(
      getRuntimeSheetContainerEnvVar(
        SHEET_CONTAINER_ENV_VARS.sourceLeads.best_relocation_leads,
      ),
      "BEST_RELOCATION_LEADS_SHEET_ID",
    );
  });
});

test("getRequiredEnv throws when the env var is missing or blank, with the var name in the message", () => {
  withEnv("__VANTAGE_RUNTIME_TEST_VAR__", undefined, () => {
    assert.throws(
      () => getRequiredEnv("__VANTAGE_RUNTIME_TEST_VAR__"),
      /__VANTAGE_RUNTIME_TEST_VAR__ is not set/,
    );
  });
  withEnv("__VANTAGE_RUNTIME_TEST_VAR__", "   ", () => {
    assert.throws(
      () => getRequiredEnv("__VANTAGE_RUNTIME_TEST_VAR__"),
      /__VANTAGE_RUNTIME_TEST_VAR__ is not set/,
    );
  });
  withEnv("__VANTAGE_RUNTIME_TEST_VAR__", "  value  ", () => {
    assert.equal(getRequiredEnv("__VANTAGE_RUNTIME_TEST_VAR__"), "value");
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

test("getSourceLeadSheetContainerId returns undefined for not_provided (no source sheet env var)", () => {
  assert.equal(getSourceLeadSheetContainerId("not_provided"), undefined);
});
