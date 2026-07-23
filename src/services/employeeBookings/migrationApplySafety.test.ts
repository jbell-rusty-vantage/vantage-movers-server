import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertMigrationApplyAuthorized,
  isMigrationApplyRequested,
} from "./migrationApplySafety";

test("test-mode migration apply remains available with --apply", () => {
  assert.equal(isMigrationApplyRequested(["--apply"]), true);
  assert.doesNotThrow(() =>
    assertMigrationApplyAuthorized({
      args: ["--apply"],
      testMode: true,
      selectedDatabase: "testvantagemovers",
    }),
  );
});

test("production migration apply requires explicit confirmation", () => {
  assert.throws(
    () =>
      assertMigrationApplyAuthorized({
        args: ["--apply"],
        testMode: false,
        selectedDatabase: "vantagemovers",
      }),
    /--production-apply --confirm-production-db=vantagemovers/,
  );
});

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

test("production migration apply accepts explicit confirmation on the production database", () => {
  assert.doesNotThrow(() =>
    assertMigrationApplyAuthorized({
      args: [
        "--apply",
        "--production-apply",
        "--confirm-production-db=vantagemovers",
      ],
      testMode: false,
      selectedDatabase: "vantagemovers",
    }),
  );
});
