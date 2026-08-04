import type { drive_v3 } from "googleapis";
import {
  buildLiveTestAppProperties,
  type ReportingLiveTestConfig,
} from "../../../config/domain/reportingLiveTest";
import {
  buildStructuredCleanupError,
  type LiveTestCleanupError,
} from "./piiSafeEvidence";
import {
  assertHarnessContainerSafeToTrash,
  assertLiveTestOAuthPrincipal,
  refetchDriveFileMetadata,
  type HarnessContainerTrashExpectation,
} from "./liveTestSecurity";
import {
  markLiveTestHarnessRunCleanupCompleted,
  markLiveTestHarnessRunNeedsJanitor,
  recordLiveTestHarnessRun,
} from "./liveTestHarnessRunRegistry";
import { createLiveTestGoogleAdapters } from "./liveTestOAuthAdapters";
import { evaluateRegisteredContainersCleanup } from "./janitorCompletion";

export type LiveTestContainerRegistration = {
  folderId: string;
  runTag: string;
  runId: string;
  destinationId: string;
};

export type LiveTestCleanupResult = {
  outcome: "completed" | "failed";
  attempted: number;
  trashed: number;
  errors: LiveTestCleanupError[];
};

export async function trashHarnessContainerWithConfirmation(input: {
  drive: drive_v3.Drive;
  folderId: string;
}): Promise<void> {
  await input.drive.files.update({
    fileId: input.folderId,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });
  const metadata = await refetchDriveFileMetadata(input.drive, input.folderId);
  if (!metadata.trashed) {
    throw new Error("Container trash was not confirmed by Drive metadata refetch.");
  }
}

export async function tagHarnessContainerFolder(input: {
  drive: drive_v3.Drive;
  folderId: string;
  runTag: string;
  runId: string;
  destinationId: string;
}): Promise<void> {
  await assertLiveTestOAuthPrincipal();
  const metadata = await refetchDriveFileMetadata(input.drive, input.folderId);
  if (metadata.trashed) {
    throw new Error("Harness container folder is already trashed.");
  }
  await input.drive.files.update({
    fileId: input.folderId,
    requestBody: {
      appProperties: {
        ...metadata.appProperties,
        ...buildLiveTestAppProperties({
          runTag: input.runTag,
          runId: input.runId,
          destinationId: input.destinationId,
          role: "harness_container",
        }),
      },
    },
    supportsAllDrives: true,
  });
}

export async function assertNestedArtifactsWithinContainers(input: {
  drive: drive_v3.Drive;
  containerFolderIds: readonly string[];
  nestedArtifactIds: readonly string[];
}): Promise<void> {
  const containerSet = new Set(input.containerFolderIds);
  for (const artifactId of input.nestedArtifactIds) {
    if (containerSet.has(artifactId)) continue;
    const metadata = await refetchDriveFileMetadata(input.drive, artifactId);
    const parentId = metadata.parentFolderIds[0];
    if (!parentId || !containerSet.has(parentId)) {
      throw new Error(
        "Tracked nested artifact is outside a marked harness container folder.",
      );
    }
  }
}

export async function cleanupLiveTestHarnessContainers(input: {
  config: ReportingLiveTestConfig;
  containers: readonly LiveTestContainerRegistration[];
  nestedArtifactIds?: readonly string[];
}): Promise<LiveTestCleanupResult> {
  await assertLiveTestOAuthPrincipal();
  const { driveApi } = await createLiveTestGoogleAdapters();
  const uniqueContainers = [...new Map(
    input.containers.map((container) => [container.folderId, container]),
  ).values()];

  if (uniqueContainers.length === 0) {
    return { outcome: "completed", attempted: 0, trashed: 0, errors: [] };
  }

  await recordLiveTestHarnessRun({
    runTag: uniqueContainers[0]!.runTag,
    exportRootFolderId: input.config.exportRootFolderId,
    containerFolderIds: uniqueContainers.map((container) => container.folderId),
  });

  if (input.nestedArtifactIds?.length) {
    try {
      await assertNestedArtifactsWithinContainers({
        drive: driveApi,
        containerFolderIds: uniqueContainers.map((container) => container.folderId),
        nestedArtifactIds: input.nestedArtifactIds,
      });
    } catch (error) {
      await markLiveTestHarnessRunNeedsJanitor({
        runTag: uniqueContainers[0]!.runTag,
      });
      return {
        outcome: "failed",
        attempted: uniqueContainers.length,
        trashed: 0,
        errors: [
          buildStructuredCleanupError({
            code: "nested_artifact_outside_container",
            message: error instanceof Error ? error.message : String(error),
          }),
        ],
      };
    }
  }

  const errors: LiveTestCleanupError[] = [];
  let trashed = 0;

  for (const container of uniqueContainers) {
    try {
      const expectation: HarnessContainerTrashExpectation = {
        runTag: container.runTag,
        runId: container.runId,
        destinationId: container.destinationId,
        exportRootFolderId: input.config.exportRootFolderId,
        runTagPrefix: input.config.runTagPrefix,
      };
      await assertHarnessContainerSafeToTrash({
        drive: driveApi,
        fileId: container.folderId,
        exportRootFolderId: input.config.exportRootFolderId,
        runTagPrefix: input.config.runTagPrefix,
        expectation,
      });
      await trashHarnessContainerWithConfirmation({
        drive: driveApi,
        folderId: container.folderId,
      });
      trashed += 1;
    } catch (error) {
      errors.push(
        buildStructuredCleanupError({
          code: "container_trash_failed",
          message: error instanceof Error ? error.message : String(error),
          fileId: container.folderId,
        }),
      );
      break;
    }
  }

  const outcome = errors.length === 0 && trashed === uniqueContainers.length
    ? "completed"
    : "failed";

  const runTag = uniqueContainers[0]!.runTag;
  const evaluation = await evaluateRegisteredContainersCleanup({
    drive: driveApi,
    containerFolderIds: uniqueContainers.map((container) => container.folderId),
  });
  if (evaluation.allCleaned) {
    await markLiveTestHarnessRunCleanupCompleted({ runTag });
  } else if (outcome === "failed") {
    await markLiveTestHarnessRunNeedsJanitor({ runTag });
  }

  return {
    outcome,
    attempted: uniqueContainers.length,
    trashed,
    errors,
  };
}

/** @deprecated Use cleanupLiveTestHarnessContainers */
export const cleanupLiveTestArtifacts = cleanupLiveTestHarnessContainers;

/** @deprecated Use tagHarnessContainerFolder */
export const tagLiveTestArtifactForCleanup = tagHarnessContainerFolder;
