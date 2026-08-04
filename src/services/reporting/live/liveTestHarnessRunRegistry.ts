import mongoose from "mongoose";
import { connectMongo } from "../../../db";

export type LiveTestHarnessCleanupStatus =
  | "pending"
  | "needs_janitor"
  | "completed";

export type LiveTestHarnessRunRecord = {
  run_tag: string;
  export_root_folder_id: string;
  container_folder_ids: string[];
  cleanup_status: LiveTestHarnessCleanupStatus;
  harness_outcome?: "passed" | "failed" | "skipped";
  created_at: Date;
  updated_at: Date;
};

const COLLECTION = "reporting_live_test_harness_runs";

export function isJanitorEligibleCleanupStatus(
  status: LiveTestHarnessCleanupStatus,
): boolean {
  return status === "pending" || status === "needs_janitor";
}

export function assertRegistryContainerBinding(input: {
  record: LiveTestHarnessRunRecord;
  exportRootFolderId: string;
  containerFolderId: string;
}): void {
  if (input.record.export_root_folder_id !== input.exportRootFolderId) {
    throw new Error("Harness run registry export root does not match janitor scope.");
  }
  if (!isJanitorEligibleCleanupStatus(input.record.cleanup_status)) {
    throw new Error("Harness run registry cleanup status is not janitor-eligible.");
  }
  if (!input.record.container_folder_ids.includes(input.containerFolderId)) {
    throw new Error(
      "Candidate container folder ID is not registered for this harness run.",
    );
  }
}

export async function recordLiveTestHarnessRun(input: {
  runTag: string;
  exportRootFolderId: string;
  containerFolderIds: readonly string[];
  harnessOutcome?: "passed" | "failed" | "skipped";
}): Promise<void> {
  await connectMongo();
  const now = new Date();
  await mongoose.connection.collection(COLLECTION).updateOne(
    { run_tag: input.runTag },
    {
      $set: {
        run_tag: input.runTag,
        export_root_folder_id: input.exportRootFolderId,
        container_folder_ids: [...new Set(input.containerFolderIds)],
        cleanup_status: "pending" as const,
        ...(input.harnessOutcome ? { harness_outcome: input.harnessOutcome } : {}),
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true },
  );
}

export async function listJanitorEligibleHarnessRunTags(input?: {
  exportRootFolderId?: string;
}): Promise<string[]> {
  await connectMongo();
  const filter: Record<string, unknown> = {
    cleanup_status: { $in: ["pending", "needs_janitor"] },
  };
  if (input?.exportRootFolderId) {
    filter.export_root_folder_id = input.exportRootFolderId;
  }
  const rows = await mongoose.connection
    .collection(COLLECTION)
    .find(filter, { projection: { run_tag: 1 } })
    .toArray();
  return rows
    .map((row) => String(row.run_tag ?? "").trim())
    .filter(Boolean);
}

/** @deprecated Use listJanitorEligibleHarnessRunTags */
export const listPendingLiveTestHarnessRunTags = listJanitorEligibleHarnessRunTags;

export async function getLiveTestHarnessRun(
  runTag: string,
): Promise<LiveTestHarnessRunRecord | null> {
  await connectMongo();
  const row = await mongoose.connection.collection(COLLECTION).findOne({ run_tag: runTag });
  if (!row) return null;
  return {
    run_tag: String(row.run_tag),
    export_root_folder_id: String(row.export_root_folder_id),
    container_folder_ids: (row.container_folder_ids ?? []).map(String),
    cleanup_status: row.cleanup_status as LiveTestHarnessCleanupStatus,
    harness_outcome: row.harness_outcome as LiveTestHarnessRunRecord["harness_outcome"],
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export async function markLiveTestHarnessRunNeedsJanitor(input: {
  runTag: string;
}): Promise<void> {
  await connectMongo();
  await mongoose.connection.collection(COLLECTION).updateOne(
    { run_tag: input.runTag },
    {
      $set: {
        cleanup_status: "needs_janitor" as const,
        updated_at: new Date(),
      },
    },
  );
}

export async function markLiveTestHarnessRunCleanupCompleted(input: {
  runTag: string;
}): Promise<void> {
  await connectMongo();
  await mongoose.connection.collection(COLLECTION).updateOne(
    { run_tag: input.runTag },
    {
      $set: {
        cleanup_status: "completed" as const,
        updated_at: new Date(),
      },
    },
  );
}

export async function isJanitorContainerAuthorized(input: {
  runTag: string;
  exportRootFolderId: string;
  containerFolderId: string;
}): Promise<boolean> {
  const record = await getLiveTestHarnessRun(input.runTag);
  if (!record) return false;
  try {
    assertRegistryContainerBinding({
      record,
      exportRootFolderId: input.exportRootFolderId,
      containerFolderId: input.containerFolderId,
    });
    return true;
  } catch {
    return false;
  }
}

/** @deprecated Use isJanitorContainerAuthorized */
export async function isRunTagAuthorizedForJanitor(input: {
  runTag: string;
  exportRootFolderId: string;
}): Promise<boolean> {
  const record = await getLiveTestHarnessRun(input.runTag);
  if (!record) return false;
  if (record.export_root_folder_id !== input.exportRootFolderId) return false;
  return isJanitorEligibleCleanupStatus(record.cleanup_status);
}
