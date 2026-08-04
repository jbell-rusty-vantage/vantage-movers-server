import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveTestAppProperties,
  buildLiveTestRunTag,
  isPositivelyMarkedLiveTestArtifact,
  listConfiguredServiceAccountEnvVars,
  rejectServiceAccountCredentialsForLiveTest,
  validateReportingLiveTestPrerequisites,
} from "../../../config/domain/reportingLiveTest";
import { GOOGLE_SERVICE_ACCOUNT_ENV_VARS } from "../../../config/domain/googleAuth";
import {
  formatHarnessEvidenceForLog,
  runLiveGoogleHarness,
} from "./liveGoogleHarness";
import {
  maskGoogleFileId,
  maskRunTag,
  sanitizeLiveTestLogDetail,
} from "./piiSafeEvidence";
import { remainingTransientFailures } from "./transientRetryWrapper";

test("live harness prerequisites fail closed when OAuth export root is absent", () => {
  const keys = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "REPORTING_LIVE_TEST_EXPORT_ROOT_FOLDER_ID",
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json,
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testJson,
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.base64Json,
    GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testBase64Json,
  ] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    const result = validateReportingLiveTestPrerequisites();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "MISSING_CONFIG");
      assert.ok(result.missing.includes("GOOGLE_OAUTH_CLIENT_ID"));
    }
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("live harness rejects service-account credentials including local file env vars", () => {
  const savedJson = process.env[GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json];
  const savedLocal = process.env.SERVICE_ACCOUNT_LOCAL_FILE_JSON;
  try {
    process.env[GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json] = '{"type":"service_account"}';
    assert.throws(
      () => rejectServiceAccountCredentialsForLiveTest(),
      /reject service-account/i,
    );
    delete process.env[GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json];
    process.env.SERVICE_ACCOUNT_LOCAL_FILE_JSON = '{"type":"service_account"}';
    assert.throws(
      () => rejectServiceAccountCredentialsForLiveTest(),
      /reject service-account/i,
    );
    assert.ok(listConfiguredServiceAccountEnvVars().length > 0);
  } finally {
    if (savedJson === undefined) {
      delete process.env[GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json];
    } else {
      process.env[GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json] = savedJson;
    }
    if (savedLocal === undefined) delete process.env.SERVICE_ACCOUNT_LOCAL_FILE_JSON;
    else process.env.SERVICE_ACCOUNT_LOCAL_FILE_JSON = savedLocal;
  }
});

test("live harness skips without calling Google when prerequisites are absent", async () => {
  const key = "REPORTING_LIVE_TEST_EXPORT_ROOT_FOLDER_ID";
  const saved = process.env[key];
  try {
    delete process.env[key];
    const result = await runLiveGoogleHarness();
    assert.equal(result.skipped, true);
    assert.equal(result.ok, false);
    assert.match(result.skipReason ?? "", /MISSING_CONFIG|prerequisite/i);
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

test("PII-safe evidence masks file IDs and omits sensitive detail keys", () => {
  assert.equal(maskGoogleFileId("1AbCdEfGhIjKlMnOpQrStUv"), "1AbC…StUv");
  assert.match(maskRunTag("vantage-live-test-abcdef1234567890"), /…/);
  const sanitized = sanitizeLiveTestLogDetail({
    file_id: "1AbCdEfGhIjKlMnOpQrStUv",
    customer_name: "Ada Lovelace",
    lead_email: "ada@example.com",
    nested: [{ phone: "+1 555 555 0100" }],
  }) as Record<string, unknown>;
  assert.equal(sanitized.customer_name, undefined);
  assert.equal(sanitized.lead_email, undefined);
  assert.match(String(sanitized.file_id), /…/);
  const nested = sanitized.nested as Array<Record<string, unknown>>;
  assert.equal(nested[0]?.phone, undefined);
});

test("live harness evidence log contains no raw PII field names", () => {
  const log = formatHarnessEvidenceForLog({
    run_tag: "vantage-live-test-local",
    oauth_path: "owner_oauth",
    artifact_ids_masked: ["1AbC…StUv"],
    cleanup_outcome: "completed",
    steps: [{ name: "oauth_health", outcome: "passed" }],
  });
  assert.doesNotMatch(log, /customer_name|lead_email|phone/i);
});

test("buildLiveTestRunTag produces unique synthetic tags", () => {
  const a = buildLiveTestRunTag({ commitSha: "abc123", prefix: "test" });
  const b = buildLiveTestRunTag({ commitSha: "abc123", prefix: "test" });
  assert.match(a, /^test-abc123-/);
  assert.notEqual(a, b);
});

test("buildLiveTestAppProperties marks harness_container artifacts for janitor selection", () => {
  const props = buildLiveTestAppProperties({
    runTag: "tag-1",
    runId: "run",
    destinationId: "dest",
    role: "harness_container",
  });
  assert.equal(props.vantage_live_test, "1");
  assert.equal(props.vantage_live_test_run_tag, "tag-1");
  assert.equal(props.vantage_reporting_role, "harness_container");
});

test("transient failure wrapper exhausts injected failures", () => {
  assert.equal(remainingTransientFailures(2, 1), 1);
  assert.equal(remainingTransientFailures(2, 2), 0);
});

test("positively marked live test artifact requires export root, age, and marker", () => {
  const nowMs = Date.now();
  const props = buildLiveTestAppProperties({
    runTag: "vantage-live-test-abc123-2026-01-01T00-00-00-000Z-a1b2c3",
    runId: "run",
    destinationId: "dest",
    role: "snapshot",
  });
  assert.equal(
    isPositivelyMarkedLiveTestArtifact({
      appProperties: props,
      exportRootFolderId: "root",
      parentFolderIds: ["root"],
      createdTimeMs: nowMs - 120_000,
      nowMs,
      artifactMaxAgeMs: 60_000,
      expectedRunTagPrefix: "vantage-live-test",
    }),
    true,
  );
  assert.equal(
    isPositivelyMarkedLiveTestArtifact({
      appProperties: props,
      exportRootFolderId: "root",
      parentFolderIds: ["other"],
      createdTimeMs: nowMs - 120_000,
      nowMs,
      artifactMaxAgeMs: 60_000,
      expectedRunTagPrefix: "vantage-live-test",
    }),
    false,
  );
});
