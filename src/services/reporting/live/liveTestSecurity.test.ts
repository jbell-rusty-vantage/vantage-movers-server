import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_TEST_JANITOR_ARTIFACT_ROLES,
  LIVE_TEST_RUN_TAG_PREFIX_PATTERN,
  buildLiveTestAppProperties,
  buildLiveTestRunTag,
} from "../../../config/domain/reportingLiveTest";
import {
  assertDirectChildOfExportRoot,
  assertKnownHarnessRunEvidence,
  listConfiguredServiceAccountIndicators,
  validateLiveTestRunTagFormat,
} from "./liveTestSecurity";
import {
  buildStructuredCleanupError,
  sanitizeLiveTestLogDetail,
  sanitizeLiveTestString,
} from "./piiSafeEvidence";
import { isReportingLiveTestEnabled } from "../../../config/domain/reportingLiveTest";
import { runTestArtifactJanitor } from "./testArtifactJanitor";
import {
  consumeLiveTestTransientWriteFailure,
  configureLiveTestTransientWriteFailures,
  resetLiveTestTransientWriteFailures,
} from "./liveTestWorkerHooks";

test("live test run tag format enforces configured prefix pattern", () => {
  const tag = buildLiveTestRunTag({ commitSha: "abc123def456", prefix: "vantage-live-test" });
  assert.doesNotThrow(() => validateLiveTestRunTagFormat(tag, "vantage-live-test"));
  assert.match(tag, LIVE_TEST_RUN_TAG_PREFIX_PATTERN);
  assert.throws(
    () => validateLiveTestRunTagFormat("bad-tag", "vantage-live-test"),
    /must start with prefix/,
  );
});

test("direct-child invariant rejects nested artifacts", () => {
  assert.throws(
    () =>
      assertDirectChildOfExportRoot({
        parentFolderIds: ["nested-folder"],
        exportRootFolderId: "export-root",
      }),
    /direct child/,
  );
});

test("known harness run evidence requires harness_container role and markers", () => {
  const runTag = buildLiveTestRunTag({ prefix: "vantage-live-test" });
  const props = buildLiveTestAppProperties({
    runTag,
    runId: "64b000000000000000000001",
    destinationId: "64b000000000000000000099",
    role: "harness_container",
  });
  assert.doesNotThrow(() =>
    assertKnownHarnessRunEvidence({
      appProperties: props,
      runTag,
      runTagPrefix: "vantage-live-test",
    }),
  );
  assert.ok(LIVE_TEST_JANITOR_ARTIFACT_ROLES.includes("harness_container"));
  assert.throws(
    () =>
      assertKnownHarnessRunEvidence({
        appProperties: { ...props, vantage_reporting_role: "snapshot" },
        runTag,
        runTagPrefix: "vantage-live-test",
        expectedRole: "harness_container",
      }),
    /allowlist/,
  );
});

test("recursive evidence sanitizer redacts nested sensitive values", () => {
  const sanitized = sanitizeLiveTestLogDetail({
    nested: {
      items: [{ lead_email: "secret@example.com", token: "abc" }],
      file_id: "1AbCdEfGhIjKlMnOpQrStUv",
    },
    phones: ["+1 (555) 555-0100"],
  }) as Record<string, unknown>;
  const nested = sanitized.nested as Record<string, unknown>;
  const items = nested.items as Array<Record<string, unknown>>;
  assert.equal(items[0]?.lead_email, undefined);
  assert.equal(items[0]?.token, undefined);
  assert.match(String(nested.file_id), /…/);
  assert.deepEqual(sanitized.phones, ["[redacted]"]);
});

test("sanitizeLiveTestString redacts embedded Drive URLs and bearer tokens", () => {
  const driveUrl =
    "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUv/edit";
  assert.equal(sanitizeLiveTestString(driveUrl), "[redacted_url]");
  assert.equal(
    sanitizeLiveTestString("Authorization: Bearer ya29.abc-def-token"),
    "Authorization: [redacted_token]",
  );
  assert.match(
    sanitizeLiveTestString("failed for file 1AbCdEfGhIjKlMnOpQrStUv"),
    /1AbC…StUv/,
  );
});

test("structured cleanup errors mask file IDs instead of concatenating raw IDs", () => {
  const error = buildStructuredCleanupError({
    code: "container_trash_failed",
    message: "Trash failed for 1AbCdEfGhIjKlMnOpQrStUv",
    fileId: "1AbCdEfGhIjKlMnOpQrStUv",
  });
  assert.equal(error.code, "container_trash_failed");
  assert.match(error.message, /1AbC…StUv/);
  assert.equal(error.artifact_id_masked, "1AbC…StUv");
  assert.doesNotMatch(JSON.stringify(error), /1AbCdEfGhIjKlMnOpQrStUv/);
});

test("service-account indicators include env, local file vars, and credential file names", () => {
  const savedCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const savedLocal = process.env.SERVICE_ACCOUNT_LOCAL_FILE;
  try {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/tmp/fake.json";
    process.env.SERVICE_ACCOUNT_LOCAL_FILE = "/tmp/sa.json";
    const indicators = listConfiguredServiceAccountIndicators();
    assert.ok(indicators.includes("GOOGLE_APPLICATION_CREDENTIALS"));
    assert.ok(indicators.includes("SERVICE_ACCOUNT_LOCAL_FILE"));
  } finally {
    if (savedCreds === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = savedCreds;
    if (savedLocal === undefined) delete process.env.SERVICE_ACCOUNT_LOCAL_FILE;
    else process.env.SERVICE_ACCOUNT_LOCAL_FILE = savedLocal;
  }
});

test("janitor returns no-op when live tests are disabled", async () => {
  const saved = process.env.REPORTING_LIVE_TEST_ENABLED;
  try {
    delete process.env.REPORTING_LIVE_TEST_ENABLED;
    assert.equal(isReportingLiveTestEnabled(), false);
    const result = await runTestArtifactJanitor();
    assert.equal(result.skipped, true);
    assert.equal(result.ok, true);
  } finally {
    if (saved === undefined) delete process.env.REPORTING_LIVE_TEST_ENABLED;
    else process.env.REPORTING_LIVE_TEST_ENABLED = saved;
  }
});

test("worker transient hook consumes only configured run", () => {
  resetLiveTestTransientWriteFailures();
  configureLiveTestTransientWriteFailures({ count: 1, runId: "run-a" });
  assert.equal(consumeLiveTestTransientWriteFailure("run-a"), true);
  assert.equal(consumeLiveTestTransientWriteFailure("run-a"), false);
  assert.equal(consumeLiveTestTransientWriteFailure("run-b"), false);
  resetLiveTestTransientWriteFailures();
});
