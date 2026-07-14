import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  buildGranotCrmCsvObjectKeys,
  buildRegistryKey,
} from "./keys";

afterEach(() => {
  delete process.env.GRANOT_CRM_CSV_PREFIX;
  delete process.env.TEST_MODE;
});

test("buildGranotCrmCsvObjectKeys creates latest/meta/history paths", () => {
  process.env.GRANOT_CRM_CSV_PREFIX = "prod/crm";
  const keys = buildGranotCrmCsvObjectKeys({
    crmOrigin: "https://eagle.hellomoving.com",
    workspaceSlug: "TBM Prime Inbounds",
    csvKind: "follow_up",
    fetchedAt: new Date("2026-06-09T15:30:12Z"),
    contentSha256: "a1b2c3d4e5f6",
  });

  assert.equal(
    keys.latestKey,
    "prod/crm/eagle.hellomoving.com/workspaces/tbm-prime-inbounds/follow_up/latest.csv",
  );
  assert.equal(
    keys.metaKey,
    "prod/crm/eagle.hellomoving.com/workspaces/tbm-prime-inbounds/follow_up/latest.meta.json",
  );
  assert.equal(
    keys.historyKey,
    "prod/crm/eagle.hellomoving.com/workspaces/tbm-prime-inbounds/follow_up/history/2026/06/09/20260609T153012Z_a1b2c3d4.csv",
  );
});

test("buildRegistryKey follows CRM origin host", () => {
  assert.equal(
    buildRegistryKey("https://eagle.hellomoving.com"),
    "prod/crm/eagle.hellomoving.com/registry.json",
  );
});
