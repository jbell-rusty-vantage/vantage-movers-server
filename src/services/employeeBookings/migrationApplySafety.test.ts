import assert from "node:assert/strict";
import { test } from "node:test";
import { assertMigrationApplyAuthorized } from "./migrationApplySafety";

test("test mode cannot apply to the production database without production confirmation", () => {
  assert.throws(
    () =>
      assertMigrationApplyAuthorized({
        args: ["--apply"],
        testMode: true,
        selectedDatabase: "vantagemovers",
      }),
    /--production-apply --confirm-production-db=vantagemovers/,
  );
});

test("production migration apply rejects an unexpected connected database", () => {
  assert.throws(
    () =>
      assertMigrationApplyAuthorized({
        args: [
          "--apply",
          "--production-apply",
          "--confirm-production-db=vantagemovers",
        ],
        testMode: false,
        selectedDatabase: "testvantagemovers",
      }),
    /connected database is testvantagemovers/,
  );
});
