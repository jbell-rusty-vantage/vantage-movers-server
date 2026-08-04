import type { drive_v3 } from "googleapis";
import {
  isPositivelyMarkedHarnessContainer,
  isReportingLiveTestEnabled,
  REPORTING_LIVE_TEST_TAG_PROPERTY_KEY,
  validateReportingLiveTestPrerequisites,
} from "../../../config/domain/reportingLiveTest";
import {
  buildMaskedLiveTestEvidence,
  maskGoogleFileId,
  sanitizeLiveTestLogDetail,
} from "./piiSafeEvidence";
import { recordReportingLiveTestJanitorOutcome } from "../reportingObservability";
import {
  assertHarnessContainerSafeToTrash,
  assertLiveTestOAuthPrincipal,
  rejectServiceAccountCredentialsForLiveTest,
  validateDedicatedExportRoot,
  type HarnessContainerTrashExpectation,
} from "./liveTestSecurity";
import {
  getLiveTestHarnessRun,
  listJanitorEligibleHarnessRunTags,
  markLiveTestHarnessRunCleanupCompleted,
  markLiveTestHarnessRunNeedsJanitor,
} from "./liveTestHarnessRunRegistry";
import { createLiveTestGoogleAdapters } from "./liveTestOAuthAdapters";
import { trashHarnessContainerWithConfirmation } from "./liveTestCleanup";
import { markJanitorEligibleRunsCompletedWhenFullyCleaned } from "./janitorCompletion";

export type TestArtifactCandidate = {
  fileId: string;
  name: string;
  createdTimeMs: number;
  parentFolderIds: string[];
  appProperties: Record<string, string>;
  trashed: boolean;
  mimeType?: string;
};

export type TestArtifactJanitorResult = {
  ok: boolean;
  skipped: boolean;
  scanned: number;
  eligible: number;
  trashed: number;
  skippedCount: number;
  errors: number;
  evidence: ReturnType<typeof buildMaskedLiveTestEvidence>;
};

/**
 * Janitor only selects positively marked harness_container folders that are
 * direct children of the dedicated export root, aged, and authorized by the
 * persisted harness-run registry (pending or needs_janitor cleanup).
 */
export function selectTestArtifactsForCleanup(input: {
  candidates: readonly TestArtifactCandidate[];
  exportRootFolderId: string;
  artifactMaxAgeMs: number;
  nowMs: number;
  expectedRunTagPrefix: string;
  authorizedRunTags: ReadonlySet<string>;
}): TestArtifactCandidate[] {
  const eligible: TestArtifactCandidate[] = [];
  for (const candidate of input.candidates) {
    if (candidate.trashed) continue;
    if (!candidate.parentFolderIds.includes(input.exportRootFolderId)) continue;
    if (
      !isPositivelyMarkedHarnessContainer({
        appProperties: candidate.appProperties,
        exportRootFolderId: input.exportRootFolderId,
        parentFolderIds: candidate.parentFolderIds,
        createdTimeMs: candidate.createdTimeMs,
        nowMs: input.nowMs,
        artifactMaxAgeMs: input.artifactMaxAgeMs,
        expectedRunTagPrefix: input.expectedRunTagPrefix,
        mimeType: candidate.mimeType,
      })
    ) {
      continue;
    }
    const runTag = candidate.appProperties[REPORTING_LIVE_TEST_TAG_PROPERTY_KEY]?.trim();
    if (!runTag || !input.authorizedRunTags.has(runTag)) continue;
    eligible.push(candidate);
  }
  return eligible;
}

export async function runTestArtifactJanitor(input?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<TestArtifactJanitorResult> {
  if (!isReportingLiveTestEnabled()) {
    return {
      ok: true,
      skipped: true,
      scanned: 0,
      eligible: 0,
      trashed: 0,
      skippedCount: 0,
      errors: 0,
      evidence: buildMaskedLiveTestEvidence({
        run_tag: "janitor-noop",
        oauth_path: "owner_oauth",
        artifactIds: [],
        cleanup_outcome: "skipped",
        janitor_status: "not_run",
        steps: [
          {
            name: "live_test_disabled",
            outcome: "skipped",
            detail: "REPORTING_LIVE_TEST_ENABLED!=true",
          },
        ],
      }),
    };
  }

  const prereq = validateReportingLiveTestPrerequisites();
  if (!prereq.ok) {
    return {
      ok: false,
      skipped: false,
      scanned: 0,
      eligible: 0,
      trashed: 0,
      skippedCount: 0,
      errors: 1,
      evidence: buildMaskedLiveTestEvidence({
        run_tag: "janitor-skipped",
        oauth_path: "owner_oauth",
        artifactIds: [],
        cleanup_outcome: "skipped",
        janitor_status: "failed",
        steps: [{ name: "prerequisites", outcome: "failed", detail: prereq.code }],
      }),
    };
  }

  rejectServiceAccountCredentialsForLiveTest();
  await assertLiveTestOAuthPrincipal();
  const config = prereq.config;
  await validateDedicatedExportRoot({
    exportRootFolderId: config.exportRootFolderId,
    expectedOwnerEmail: process.env.GOOGLE_OAUTH_OWNER_EMAIL!.trim(),
  });

  const { driveApi: drive } = await createLiveTestGoogleAdapters();
  const nowMs = Date.now();
  const limit = input?.limit ?? 50;

  const authorizedRunTags = new Set(
    await listJanitorEligibleHarnessRunTags({
      exportRootFolderId: config.exportRootFolderId,
    }),
  );

  const listed = await drive.files.list({
    q: `'${config.exportRootFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: "files(id,name,createdTime,parents,appProperties,trashed,mimeType)",
    pageSize: Math.min(limit, 100),
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const candidates: TestArtifactCandidate[] = (listed.data.files ?? [])
    .filter((file) => file.id && file.createdTime)
    .map((file) => ({
      fileId: file.id!,
      name: file.name ?? "",
      createdTimeMs: Date.parse(file.createdTime!),
      parentFolderIds: file.parents ?? [],
      appProperties: (file.appProperties ?? {}) as Record<string, string>,
      trashed: Boolean(file.trashed),
      mimeType: file.mimeType ?? undefined,
    }));

  const eligible = selectTestArtifactsForCleanup({
    candidates,
    exportRootFolderId: config.exportRootFolderId,
    artifactMaxAgeMs: config.artifactMaxAgeMs,
    nowMs,
    expectedRunTagPrefix: config.runTagPrefix,
    authorizedRunTags,
  });

  let trashed = 0;
  let skippedCount = 0;
  let errors = 0;
  const touchedRunTags = new Set<string>();

  for (const artifact of eligible) {
    try {
      if (input?.dryRun) {
        skippedCount += 1;
        continue;
      }
      const runTag = artifact.appProperties[REPORTING_LIVE_TEST_TAG_PROPERTY_KEY]!.trim();
      const registry = await getLiveTestHarnessRun(runTag);
      if (!registry) {
        errors += 1;
        continue;
      }
      const expectation: HarnessContainerTrashExpectation = {
        runTag,
        runId: artifact.appProperties.vantage_reporting_run_id!.trim(),
        destinationId: artifact.appProperties.vantage_reporting_destination_id!.trim(),
        exportRootFolderId: config.exportRootFolderId,
        runTagPrefix: config.runTagPrefix,
      };
      await assertHarnessContainerSafeToTrash({
        drive,
        fileId: artifact.fileId,
        exportRootFolderId: config.exportRootFolderId,
        runTagPrefix: config.runTagPrefix,
        expectation,
      });
      await trashHarnessContainerWithConfirmation({
        drive,
        folderId: artifact.fileId,
      });
      trashed += 1;
      touchedRunTags.add(runTag);
    } catch {
      errors += 1;
      const failedRunTag =
        artifact.appProperties[REPORTING_LIVE_TEST_TAG_PROPERTY_KEY]?.trim();
      if (failedRunTag) {
        touchedRunTags.add(failedRunTag);
        await markLiveTestHarnessRunNeedsJanitor({ runTag: failedRunTag }).catch(
          () => undefined,
        );
      }
    }
  }

  const runTagsToEvaluate = [...new Set([...authorizedRunTags, ...touchedRunTags])];
  await markJanitorEligibleRunsCompletedWhenFullyCleaned({
    drive,
    runTags: runTagsToEvaluate,
    getHarnessRun: getLiveTestHarnessRun,
    markCompleted: (runTag) => markLiveTestHarnessRunCleanupCompleted({ runTag }),
  });

  const evidence = buildMaskedLiveTestEvidence({
    run_tag: "janitor-run",
    oauth_path: "owner_oauth",
    artifactIds: eligible.map((item) => item.fileId),
    cleanup_outcome: errors > 0 ? "failed" : "completed",
    janitor_status: errors > 0 ? "failed" : "completed",
    steps: [
      {
        name: "scan_export_root_direct_children",
        outcome: "passed",
        detail: JSON.stringify(
          sanitizeLiveTestLogDetail({
            scanned: candidates.length,
            authorized_run_tags: authorizedRunTags.size,
            export_root_masked: maskGoogleFileId(config.exportRootFolderId),
            run_tag_prefix: config.runTagPrefix,
          }),
        ),
      },
      {
        name: "select_eligible_containers",
        outcome: "passed",
        detail: String(eligible.length),
      },
      {
        name: input?.dryRun ? "dry_run_trash" : "trash_eligible_containers",
        outcome: errors > 0 ? "failed" : "passed",
        detail: JSON.stringify({ trashed, skipped: skippedCount, errors }),
      },
    ],
  });

  await recordReportingLiveTestJanitorOutcome({
    ok: errors === 0,
    scanned: candidates.length,
    eligible: eligible.length,
    trashed,
    errors,
    dryRun: Boolean(input?.dryRun),
  });

  return {
    ok: errors === 0,
    skipped: false,
    scanned: candidates.length,
    eligible: eligible.length,
    trashed,
    skippedCount,
    errors,
    evidence,
  };
}
