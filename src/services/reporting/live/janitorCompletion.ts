import type { drive_v3 } from "googleapis";
import {
  isDriveMetadataConfirmedNotFoundError,
  isDriveMetadataRefetchBlockedError,
  fetchDriveFileMetadata,
} from "../../googleDriveOAuth/driveMetadata.service";

export type RegisteredContainerCleanupState =
  | "cleaned_trashed"
  | "cleaned_not_found"
  | "present"
  | "refetch_blocked";

export function isRegisteredContainerCleaned(
  state: RegisteredContainerCleanupState,
): boolean {
  return state === "cleaned_trashed" || state === "cleaned_not_found";
}

export function areAllRegisteredContainersCleaned(input: {
  registeredContainerFolderIds: readonly string[];
  statesByFolderId: ReadonlyMap<string, RegisteredContainerCleanupState>;
}): boolean {
  return input.registeredContainerFolderIds.every((folderId) =>
    isRegisteredContainerCleaned(
      input.statesByFolderId.get(folderId) ?? "present",
    ),
  );
}

export function classifyRegisteredContainerRefetch(input: {
  metadata?: { trashed: boolean };
  confirmedNotFound?: boolean;
  refetchBlocked?: boolean;
}): RegisteredContainerCleanupState {
  if (input.confirmedNotFound) return "cleaned_not_found";
  if (input.refetchBlocked) return "refetch_blocked";
  if (!input.metadata) return "present";
  return input.metadata.trashed ? "cleaned_trashed" : "present";
}

export function mapDriveMetadataErrorToCleanupState(
  error: unknown,
): RegisteredContainerCleanupState | "throw" {
  if (isDriveMetadataConfirmedNotFoundError(error)) {
    return "cleaned_not_found";
  }
  if (isDriveMetadataRefetchBlockedError(error)) {
    return "refetch_blocked";
  }
  return "throw";
}

export async function refetchRegisteredContainerCleanupState(input: {
  drive: drive_v3.Drive;
  folderId: string;
}): Promise<RegisteredContainerCleanupState> {
  try {
    const metadata = await fetchDriveFileMetadata(input.drive, input.folderId);
    return classifyRegisteredContainerRefetch({ metadata });
  } catch (error) {
    const mapped = mapDriveMetadataErrorToCleanupState(error);
    if (mapped === "throw") throw error;
    return mapped;
  }
}

export async function evaluateRegisteredContainersCleanup(input: {
  drive: drive_v3.Drive;
  containerFolderIds: readonly string[];
}): Promise<{
  statesByFolderId: Map<string, RegisteredContainerCleanupState>;
  allCleaned: boolean;
}> {
  const statesByFolderId = new Map<string, RegisteredContainerCleanupState>();
  for (const folderId of input.containerFolderIds) {
    statesByFolderId.set(
      folderId,
      await refetchRegisteredContainerCleanupState({
        drive: input.drive,
        folderId,
      }),
    );
  }
  return {
    statesByFolderId,
    allCleaned: areAllRegisteredContainersCleaned({
      registeredContainerFolderIds: input.containerFolderIds,
      statesByFolderId,
    }),
  };
}

export async function markJanitorEligibleRunsCompletedWhenFullyCleaned(input: {
  drive: drive_v3.Drive;
  runTags: readonly string[];
  getHarnessRun: (
    runTag: string,
  ) => Promise<{
    cleanup_status: string;
    container_folder_ids: string[];
  } | null>;
  markCompleted: (runTag: string) => Promise<void>;
}): Promise<string[]> {
  const completed: string[] = [];
  for (const runTag of input.runTags) {
    const registry = await input.getHarnessRun(runTag);
    if (!registry) continue;
    if (
      registry.cleanup_status !== "pending" &&
      registry.cleanup_status !== "needs_janitor"
    ) {
      continue;
    }
    const evaluation = await evaluateRegisteredContainersCleanup({
      drive: input.drive,
      containerFolderIds: registry.container_folder_ids,
    });
    if (evaluation.allCleaned) {
      await input.markCompleted(runTag);
      completed.push(runTag);
    }
  }
  return completed;
}
