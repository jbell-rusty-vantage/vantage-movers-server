import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLiveTestAppProperties,
  isPositivelyMarkedHarnessContainer,
  isPositivelyMarkedLiveTestArtifact,
} from "../../../config/domain/reportingLiveTest";
import {
  selectTestArtifactsForCleanup,
  type TestArtifactCandidate,
} from "./testArtifactJanitor";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const RUN_TAG = "vantage-live-test-abc123-2026-01-01T00-00-00-000Z-a1b2c3";

function candidate(input: Partial<TestArtifactCandidate>): TestArtifactCandidate {
  const props = buildLiveTestAppProperties({
    runTag: RUN_TAG,
    runId: "64b000000000000000000001",
    destinationId: "64b000000000000000000099",
    role: "harness_container",
  });
  return {
    fileId: "1AbCdEfGhIjKlMnOpQrStUv",
    name: "Harness Container",
    createdTimeMs: Date.now() - 120_000,
    parentFolderIds: ["export-root"],
    appProperties: props,
    trashed: false,
    mimeType: FOLDER_MIME,
    ...input,
  };
}

test("janitor selects only positively marked harness_container folders under export root", () => {
  const nowMs = Date.now();
  const exportRoot = "export-root";
  const authorizedRunTags = new Set([RUN_TAG]);
  const eligible = selectTestArtifactsForCleanup({
    candidates: [
      candidate({}),
      candidate({ parentFolderIds: ["other-root"] }),
      candidate({ createdTimeMs: nowMs - 30_000 }),
      candidate({ appProperties: { unrelated: "1" } }),
      candidate({ trashed: true }),
      candidate({
        mimeType: "application/vnd.google-apps.spreadsheet",
        appProperties: buildLiveTestAppProperties({
          runTag: RUN_TAG,
          runId: "64b000000000000000000002",
          destinationId: "64b000000000000000000098",
          role: "staging_workbook",
        }),
      }),
    ],
    exportRootFolderId: exportRoot,
    artifactMaxAgeMs: 60_000,
    nowMs,
    expectedRunTagPrefix: "vantage-live-test",
    authorizedRunTags,
  });
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0]?.fileId, "1AbCdEfGhIjKlMnOpQrStUv");
});

test("janitor requires persisted harness-run registry authorization", () => {
  const nowMs = Date.now();
  const exportRoot = "export-root";
  const tagged = candidate({});
  const unauthorized = candidate({
    appProperties: buildLiveTestAppProperties({
      runTag: "vantage-live-test-other-2026-01-01T00-00-00-000Z-deadbe",
      runId: "64b000000000000000000002",
      destinationId: "64b000000000000000000098",
      role: "harness_container",
    }),
  });
  const eligible = selectTestArtifactsForCleanup({
    candidates: [tagged, unauthorized],
    exportRootFolderId: exportRoot,
    artifactMaxAgeMs: 60_000,
    nowMs,
    expectedRunTagPrefix: "vantage-live-test",
    authorizedRunTags: new Set([RUN_TAG]),
  });
  assert.equal(eligible.length, 1);
  assert.equal(
    eligible[0]?.appProperties.vantage_live_test_run_tag,
    RUN_TAG,
  );
});

test("janitor honors optional run-tag prefix filter", () => {
  const nowMs = Date.now();
  const exportRoot = "export-root";
  const tagged = candidate({});
  const otherTag = candidate({
    appProperties: buildLiveTestAppProperties({
      runTag: "other-prefix-run-abc123-2026-01-01T00-00-00-000Z-a1b2c3",
      runId: "64b000000000000000000002",
      destinationId: "64b000000000000000000098",
      role: "harness_container",
    }),
  });
  const eligible = selectTestArtifactsForCleanup({
    candidates: [tagged, otherTag],
    exportRootFolderId: exportRoot,
    artifactMaxAgeMs: 60_000,
    nowMs,
    expectedRunTagPrefix: "vantage-live-test",
    authorizedRunTags: new Set([RUN_TAG, "other-prefix-run-abc123-2026-01-01T00-00-00-000Z-a1b2c3"]),
  });
  assert.equal(eligible.length, 1);
});

test("isPositivelyMarkedHarnessContainer rejects non-folder roles and young artifacts", () => {
  const nowMs = Date.now();
  const containerProps = buildLiveTestAppProperties({
    runTag: "tag",
    runId: "run",
    destinationId: "dest",
    role: "harness_container",
  });
  assert.equal(
    isPositivelyMarkedHarnessContainer({
      appProperties: containerProps,
      exportRootFolderId: "root",
      parentFolderIds: ["root"],
      createdTimeMs: nowMs - 10_000,
      nowMs,
      artifactMaxAgeMs: 60_000,
      expectedRunTagPrefix: "vantage-live-test",
      mimeType: FOLDER_MIME,
    }),
    false,
  );
  const workbookProps = buildLiveTestAppProperties({
    runTag: "tag",
    runId: "run",
    destinationId: "dest",
    role: "snapshot",
  });
  assert.equal(
    isPositivelyMarkedHarnessContainer({
      appProperties: workbookProps,
      exportRootFolderId: "root",
      parentFolderIds: ["root"],
      createdTimeMs: nowMs - 120_000,
      nowMs,
      artifactMaxAgeMs: 60_000,
      expectedRunTagPrefix: "vantage-live-test",
      mimeType: "application/vnd.google-apps.spreadsheet",
    }),
    false,
  );
});

test("isPositivelyMarkedLiveTestArtifact rejects young artifacts", () => {
  const nowMs = Date.now();
  const props = buildLiveTestAppProperties({
    runTag: "tag",
    runId: "run",
    destinationId: "dest",
    role: "harness_container",
  });
  assert.equal(
    isPositivelyMarkedLiveTestArtifact({
      appProperties: props,
      exportRootFolderId: "root",
      parentFolderIds: ["root"],
      createdTimeMs: nowMs - 10_000,
      nowMs,
      artifactMaxAgeMs: 60_000,
      expectedRunTagPrefix: "vantage-live-test",
    }),
    false,
  );
});
