import mongoose from "mongoose";
import {
  buildLiveTestRunTag,
  getReportingLiveTestConfig,
  validateReportingLiveTestPrerequisites,
} from "../../../config/domain/reportingLiveTest";
import { connectMongo } from "../../../db";
import { ReportingRun } from "../../../models/ReportingRun";
import { toObjectId } from "../../../utils/objectId";
import { getGoogleDriveAccessTokenHealth } from "../../googleDriveOAuth/googleDriveOAuth.service";
import type { ReportingDriveAdapter } from "../google/reportingDriveAdapter";
import type { ReportingSheetsAdapter } from "../google/reportingSheetsAdapter";
import {
  buildValidatedDestinationSnapshot,
  createReportingDestination,
} from "../reportingDestination.service";
import { registerReportingStage4Foundation } from "../registerStage4Foundation";
import { runReportingDeliveryWorker } from "../reportingWorker";
import { loadReportingDelivery } from "../reportingDeliveryRepository";
import type { DurableActor } from "../../durableWork";
import {
  buildMaskedLiveTestEvidence,
  sanitizeLiveTestLogDetail,
  type MaskedLiveTestEvidence,
} from "./piiSafeEvidence";
import {
  assertLiveTestOAuthPrincipal,
  assertProductionIdentitySeparation,
  rejectServiceAccountCredentialsForLiveTest,
  validateDedicatedExportRoot,
} from "./liveTestSecurity";
import {
  configureLiveTestTransientWriteFailures,
  resetLiveTestTransientWriteFailures,
} from "./liveTestWorkerHooks";
import { registerSyntheticLiveTestManifestPageAdapter } from "./syntheticManifestPageAdapter";
import {
  LIVE_TEST_HARNESS_LIMITATION,
  registerSyntheticLiveTestSnapshotAdapter,
  seedLiveTestCanonicalFormLeads,
} from "./syntheticLiveTestManifest";
import { liveTestSyntheticRows, seedLiveTestQueuedRun } from "./liveTestRunFactory";
import { runLivePickerServerContractTests } from "./livePickerContractRunner";
import {
  cleanupLiveTestHarnessContainers,
  tagHarnessContainerFolder,
  type LiveTestContainerRegistration,
} from "./liveTestCleanup";
import { proveDenylistBlocksProductionDestination } from "./liveTestDenylistProof";
import { createLiveTestGoogleAdapters } from "./liveTestOAuthAdapters";
import { recordLiveTestHarnessRun } from "./liveTestHarnessRunRegistry";
import {
  applyLiveTestExportFolderEnv,
  restoreExportFolderEnv,
  snapshotExportFolderEnv,
} from "./liveTestEnv";
export type LiveGoogleHarnessStep = {
  name: string;
  outcome: "passed" | "failed" | "skipped";
  detail?: string;
};

export type LiveGoogleHarnessResult = {
  ok: boolean;
  skipped: boolean;
  skipReason?: string;
  runTag: string;
  evidence: MaskedLiveTestEvidence;
  artifactIds: string[];
};

const HARNESS_ACTOR: DurableActor = {
  actor_type: "system",
  actor_id: "reporting-live-google-harness",
  actor_label: "Reporting Live Google Harness",
  actor_role: "system",
  request_id: "reporting-live-google-harness",
  origin: "reporting_projection",
};

const LIVE_TEST_PUBLISHED_TITLE = "Live Test Report";

async function runWorkerToTerminal(input: {
  runId: string;
  sheets: ReportingSheetsAdapter;
  drive: ReportingDriveAdapter;
  maxAttempts?: number;
}): Promise<{ status: string; attempts: number }> {
  const maxAttempts = input.maxAttempts ?? 8;
  let attempts = 0;
  let lastStatus = "queued";
  const runObjectId = toObjectId(input.runId);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    attempts += 1;
    const outcome = await runReportingDeliveryWorker(
      { runHint: input.runId },
      { sheets: input.sheets, drive: input.drive },
    );
    const run = await ReportingRun.collection.findOne({ _id: runObjectId });
    lastStatus = run ? String(run.status) : outcome.status ?? lastStatus;
    if (["completed", "failed", "cancelled"].includes(lastStatus)) {
      return { status: lastStatus, attempts };
    }
    if (!outcome.claimed) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return { status: lastStatus, attempts };
}

async function readPublishedTabSnapshot(input: {
  sheets: ReportingSheetsAdapter;
  workbookId: string;
  publishedTitle: string;
}): Promise<{ sheetId: number | null; title: string; values: string[][] }> {
  const listed = await input.sheets.listSheets(input.workbookId);
  const published = listed.find(
    (sheet) => sheet.title === input.publishedTitle && !sheet.hidden,
  );
  if (!published) {
    return { sheetId: null, title: input.publishedTitle, values: [] };
  }
  const values = await input.sheets.readValues({
    spreadsheetId: input.workbookId,
    sheetTitle: published.title,
    startRow: 1,
    endRow: 10,
    startCol: 1,
    endCol: 5,
  });
  return {
    sheetId: published.sheetId,
    title: published.title,
    values: values.map((row) => row.map((cell) => String(cell ?? ""))),
  };
}

export async function runLiveGoogleOrchestration(): Promise<LiveGoogleHarnessResult> {
  const prereq = validateReportingLiveTestPrerequisites();
  if (!prereq.ok) {
    return skippedResult("skipped", `${prereq.code}: ${prereq.message}`, [
      { name: "prerequisites", outcome: "skipped", detail: prereq.missing.join(",") },
    ]);
  }
  if (!prereq.config.enabled) {
    return skippedResult("skipped", "REPORTING_LIVE_TEST_ENABLED is not true", [
      { name: "prerequisites", outcome: "skipped", detail: "not_enabled" },
    ]);
  }

  const exportFolderSnapshot = snapshotExportFolderEnv();
  rejectServiceAccountCredentialsForLiveTest();
  const config = getReportingLiveTestConfig();
  const runTag = buildLiveTestRunTag();
  const containers: LiveTestContainerRegistration[] = [];
  const nestedArtifactIds: string[] = [];
  const steps: LiveGoogleHarnessStep[] = [];
  let cleanupOutcome: MaskedLiveTestEvidence["cleanup_outcome"] = "pending";

  try {
    assertProductionIdentitySeparation();
    await connectMongo();
    registerReportingStage4Foundation();
    registerSyntheticLiveTestSnapshotAdapter();
    await seedLiveTestCanonicalFormLeads();

    const oauthHealth = await getGoogleDriveAccessTokenHealth();
    if (!oauthHealth.healthy) {
      throw new Error(`OAuth health check failed: ${oauthHealth.reason}`);
    }
    await assertLiveTestOAuthPrincipal();
    await validateDedicatedExportRoot({
      exportRootFolderId: config.exportRootFolderId,
      expectedOwnerEmail: process.env.GOOGLE_OAUTH_OWNER_EMAIL!.trim(),
    });
    steps.push({ name: "oauth_health", outcome: "passed", detail: "owner_oauth" });

    applyLiveTestExportFolderEnv(config.exportRootFolderId);

    const denylistProof = await proveDenylistBlocksProductionDestination({
      denylistWorkbookId: config.denylistWorkbookId,
      runTag,
      actor: HARNESS_ACTOR,
    });
    steps.push({
      name: "denylist_rejection",
      outcome: denylistProof.ok ? "passed" : "failed",
      detail: denylistProof.rejectionCode ?? denylistProof.detail,
    });
    if (!denylistProof.ok) {
      throw new Error(
        denylistProof.detail ?? "Denylist workbook was not rejected by production destination module.",
      );
    }

    const { driveApi, drive, sheets } = await createLiveTestGoogleAdapters();

    const replaceDestination = await createReportingDestination(
      {
        strategy: "replace_tab",
        createFolderName: `${runTag}-replace-folder`,
        createWorkbookName: `${runTag}-replace-workbook`,
        managedTabName: LIVE_TEST_PUBLISHED_TITLE,
      },
      HARNESS_ACTOR,
    );
    const replaceSnapshot = await buildValidatedDestinationSnapshot(
      String(replaceDestination._id),
    );
    containers.push({
      folderId: replaceSnapshot.folder.id,
      runTag,
      runId: "pending",
      destinationId: replaceSnapshot.destinationId,
    });
    if (replaceSnapshot.workbook?.id) {
      nestedArtifactIds.push(replaceSnapshot.workbook.id);
    }

    if (replaceSnapshot.workbook?.id) {
      const picker = await runLivePickerServerContractTests({
        folderId: replaceSnapshot.folder.id,
        spreadsheetId: replaceSnapshot.workbook.id,
        parentFolderId: replaceSnapshot.folder.id,
      });
      steps.push(
        ...picker.steps.map((step) => ({
          ...step,
          outcome: step.outcome as "passed" | "failed",
        })),
      );
      if (!picker.ok) throw new Error("Picker server contract tests failed.");
    }

    registerSyntheticLiveTestManifestPageAdapter({ rows: liveTestSyntheticRows() });
    const replaceSeed = await seedLiveTestQueuedRun({
      destinationSnapshot: replaceSnapshot,
      strategy: "replace_tab",
      estimateRows: liveTestSyntheticRows().length,
      runTag,
      actor: HARNESS_ACTOR,
    });
    containers[0]!.runId = replaceSeed.runId;

    const replaceWorker = await runWorkerToTerminal({
      runId: replaceSeed.runId,
      sheets,
      drive,
    });
    const replaceRun = await ReportingRun.collection.findOne({
      _id: toObjectId(replaceSeed.runId),
    });
    const replaceDelivery = await loadReportingDelivery(replaceSeed.runId);
    steps.push({
      name: "replace_tab_worker_delivery",
      outcome:
        replaceWorker.status === "completed" && replaceDelivery?.status === "completed"
          ? "passed"
          : "failed",
      detail: `${replaceWorker.status}/${replaceDelivery?.status ?? "missing"}`,
    });
    if (replaceWorker.status !== "completed") {
      throw new Error(`Replace-tab worker ended in ${replaceWorker.status}.`);
    }

    const workbookId = replaceSnapshot.workbook!.id;
    const beforeFailure = await readPublishedTabSnapshot({
      sheets,
      workbookId,
      publishedTitle: LIVE_TEST_PUBLISHED_TITLE,
    });
    steps.push({
      name: "replace_tab_promotion_readback",
      outcome: beforeFailure.sheetId != null && beforeFailure.values.length > 1 ? "passed" : "failed",
    });

    registerSyntheticLiveTestManifestPageAdapter({
      rows: liveTestSyntheticRows(),
      emitRowCount: 1,
    });
    const failedReplaceSeed = await seedLiveTestQueuedRun({
      destinationSnapshot: replaceSnapshot,
      strategy: "replace_tab",
      estimateRows: liveTestSyntheticRows().length,
      runTag,
      actor: HARNESS_ACTOR,
    });
    const failedWorker = await runWorkerToTerminal({
      runId: failedReplaceSeed.runId,
      sheets,
      drive,
    });
    const afterFailure = await readPublishedTabSnapshot({
      sheets,
      workbookId,
      publishedTitle: LIVE_TEST_PUBLISHED_TITLE,
    });
    const preserved =
      failedWorker.status === "failed" &&
      beforeFailure.sheetId === afterFailure.sheetId &&
      beforeFailure.title === afterFailure.title &&
      JSON.stringify(beforeFailure.values) === JSON.stringify(afterFailure.values);
    steps.push({
      name: "failed_replacement_preserves_prior_tab",
      outcome: preserved ? "passed" : "failed",
      detail: failedWorker.status,
    });
    if (!preserved) {
      throw new Error("Failed replacement did not preserve prior published tab.");
    }

    if (replaceDelivery?.workbook_id) {
      nestedArtifactIds.push(String(replaceDelivery.workbook_id));
    }
    if (replaceDelivery?.staging_workbook_id) {
      nestedArtifactIds.push(String(replaceDelivery.staging_workbook_id));
    }

    const snapshotDestination = await createReportingDestination(
      {
        strategy: "snapshot",
        createFolderName: `${runTag}-snapshot-folder`,
      },
      HARNESS_ACTOR,
    );
    const snapshotValidated = await buildValidatedDestinationSnapshot(
      String(snapshotDestination._id),
    );
    registerSyntheticLiveTestManifestPageAdapter({ rows: liveTestSyntheticRows() });
    const snapshotSeed = await seedLiveTestQueuedRun({
      destinationSnapshot: snapshotValidated,
      strategy: "snapshot",
      estimateRows: liveTestSyntheticRows().length,
      runTag,
      actor: HARNESS_ACTOR,
    });
    containers.push({
      folderId: snapshotValidated.folder.id,
      runTag,
      runId: snapshotSeed.runId,
      destinationId: snapshotValidated.destinationId,
    });

    if (config.injectTransientFailures > 0) {
      configureLiveTestTransientWriteFailures({
        count: config.injectTransientFailures,
        runId: snapshotSeed.runId,
      });
      const firstAttempt = await runReportingDeliveryWorker(
        { runHint: snapshotSeed.runId },
        { sheets, drive },
      );
      const midRun = await ReportingRun.collection.findOne({
        _id: toObjectId(snapshotSeed.runId),
      });
      const resumed = await runWorkerToTerminal({
        runId: snapshotSeed.runId,
        sheets,
        drive,
        maxAttempts: 6,
      });
      resetLiveTestTransientWriteFailures();
      steps.push({
        name: "transient_retry_resume",
        outcome:
          firstAttempt.claimed &&
          midRun &&
          !["completed", "failed"].includes(String(midRun.status)) &&
          resumed.status === "completed"
            ? "passed"
            : "failed",
        detail: `${firstAttempt.status ?? "none"}->${resumed.status}`,
      });
      const snapshotDelivery = await loadReportingDelivery(snapshotSeed.runId);
      if (snapshotDelivery?.workbook_id) {
        nestedArtifactIds.push(String(snapshotDelivery.workbook_id));
      }
    } else {
      const snapshotWorker = await runWorkerToTerminal({
        runId: snapshotSeed.runId,
        sheets,
        drive,
      });
      steps.push({
        name: "snapshot_worker_delivery",
        outcome: snapshotWorker.status === "completed" ? "passed" : "failed",
        detail: snapshotWorker.status,
      });
      steps.push({
        name: "transient_retry_resume",
        outcome: "skipped",
        detail: "REPORTING_LIVE_TEST_INJECT_TRANSIENT_FAILURES=0",
      });
      const snapshotDelivery = await loadReportingDelivery(snapshotSeed.runId);
      if (snapshotDelivery?.workbook_id) {
        nestedArtifactIds.push(String(snapshotDelivery.workbook_id));
      }
    }

    await recordLiveTestHarnessRun({
      runTag,
      exportRootFolderId: config.exportRootFolderId,
      containerFolderIds: containers.map((container) => container.folderId),
    });

    for (const container of containers) {
      await tagHarnessContainerFolder({
        drive: driveApi,
        folderId: container.folderId,
        runTag: container.runTag,
        runId: container.runId,
        destinationId: container.destinationId,
      });
    }

    const cleanup = await cleanupLiveTestHarnessContainers({
      config,
      containers,
      nestedArtifactIds,
    });
    cleanupOutcome = cleanup.outcome;
    steps.push({
      name: "cleanup",
      outcome: cleanup.outcome === "completed" ? "passed" : "failed",
      detail: JSON.stringify(
        sanitizeLiveTestLogDetail({
          attempted: cleanup.attempted,
          trashed: cleanup.trashed,
          errors: cleanup.errors,
        }),
      ),
    });
    if (cleanup.outcome === "failed") {
      throw new Error("Harness cleanup failed.");
    }

    const containerFolderIds = containers.map((container) => container.folderId);
    const ok = steps.every((step) => step.outcome !== "failed");
    return {
      ok,
      skipped: false,
      runTag,
      artifactIds: containerFolderIds,
      evidence: buildMaskedLiveTestEvidence({
        run_tag: runTag,
        oauth_path: "owner_oauth",
        commit_sha: process.env.GITHUB_SHA,
        workflow_run_id: process.env.GITHUB_RUN_ID,
        artifactIds: containerFolderIds,
        checksum:
          typeof replaceRun?.final_data_checksum === "string"
            ? replaceRun.final_data_checksum
            : undefined,
        cleanup_outcome: cleanupOutcome,
        limitation: LIVE_TEST_HARNESS_LIMITATION,
        steps,
      }),
    };
  } catch (error) {
    steps.push({
      name: "harness_error",
      outcome: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    try {
      if (containers.length > 0) {
        for (const container of containers) {
          await tagHarnessContainerFolder({
            drive: (await createLiveTestGoogleAdapters()).driveApi,
            folderId: container.folderId,
            runTag: container.runTag,
            runId: container.runId,
            destinationId: container.destinationId,
          }).catch(() => undefined);
        }
        const cleanup = await cleanupLiveTestHarnessContainers({
          config,
          containers,
          nestedArtifactIds,
        });
        cleanupOutcome = cleanup.outcome;
        steps.push({
          name: "cleanup",
          outcome: cleanup.outcome === "completed" ? "passed" : "failed",
          detail: JSON.stringify(sanitizeLiveTestLogDetail({ errors: cleanup.errors })),
        });
        if (cleanup.outcome === "failed") {
          return buildFailureResult(
            runTag,
            containers.map((container) => container.folderId),
            cleanupOutcome,
            steps,
          );
        }
      }
    } catch (cleanupError) {
      cleanupOutcome = "failed";
      steps.push({
        name: "cleanup",
        outcome: "failed",
        detail:
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
    return buildFailureResult(
      runTag,
      containers.map((container) => container.folderId),
      cleanupOutcome,
      steps,
    );
  } finally {
    restoreExportFolderEnv(exportFolderSnapshot);
    resetLiveTestTransientWriteFailures();
  }
}

function buildFailureResult(
  runTag: string,
  artifactIds: string[],
  cleanupOutcome: MaskedLiveTestEvidence["cleanup_outcome"],
  steps: LiveGoogleHarnessStep[],
): LiveGoogleHarnessResult {
  return {
    ok: false,
    skipped: false,
    runTag,
    artifactIds,
    evidence: buildMaskedLiveTestEvidence({
      run_tag: runTag,
      oauth_path: "owner_oauth",
      artifactIds,
      cleanup_outcome: cleanupOutcome,
      limitation: LIVE_TEST_HARNESS_LIMITATION,
      steps,
    }),
  };
}

function skippedResult(
  runTag: string,
  reason: string,
  steps: LiveGoogleHarnessStep[],
): LiveGoogleHarnessResult {
  return {
    ok: false,
    skipped: true,
    skipReason: reason,
    runTag,
    artifactIds: [],
    evidence: buildMaskedLiveTestEvidence({
      run_tag: runTag,
      oauth_path: "owner_oauth",
      artifactIds: [],
      cleanup_outcome: "skipped",
      limitation: LIVE_TEST_HARNESS_LIMITATION,
      steps,
    }),
  };
}

export function formatHarnessEvidenceForLog(
  evidence: MaskedLiveTestEvidence,
): string {
  return JSON.stringify(
    sanitizeLiveTestLogDetail(evidence as unknown as Record<string, unknown>),
  );
}
