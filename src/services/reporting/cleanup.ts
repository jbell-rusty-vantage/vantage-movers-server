import type { ReportingDriveAdapter } from "./google/reportingDriveAdapter";
import type { ReportingSheetsAdapter } from "./google/reportingSheetsAdapter";
import { runMarkerMatches } from "./google/runMarker";
import { emitReportingCleanupJanitorFailed } from "./reportingObservability";
import {
  listCleanupPendingDeliveries,
  loadReportingDelivery,
  patchReportingDeliveryCleanup,
} from "./reportingDeliveryRepository";

/**
 * Mark incomplete artifacts for janitor cleanup without rewriting delivery
 * terminal status (failed/cancelled/completed stay intact).
 */
export async function enqueueIncompleteArtifactCleanup(input: {
  runId: string;
  artifactIds: string[];
}): Promise<void> {
  const existing = await loadReportingDelivery(input.runId);
  const merged = [
    ...new Set([
      ...(existing?.cleanup?.artifact_ids ?? []),
      ...input.artifactIds,
    ]),
  ];
  await patchReportingDeliveryCleanup({
    runId: input.runId,
    set: {
      "cleanup.state": "pending",
      "cleanup.artifact_ids": merged,
      "cleanup.updated_at": new Date(),
    },
  });
}

export async function runReportingCleanupJanitor(deps: {
  drive: ReportingDriveAdapter;
  sheets: ReportingSheetsAdapter;
  limit?: number;
}): Promise<{ processed: number; cleaned: number; skipped: number }> {
  const pending = await listCleanupPendingDeliveries(deps.limit ?? 25);
  let cleaned = 0;
  let skipped = 0;
  for (const delivery of pending) {
    const result = await cleanupDeliveryArtifacts({
      drive: deps.drive,
      sheets: deps.sheets,
      delivery,
    });
    if (result === "cleaned") cleaned += 1;
    else skipped += 1;
  }
  return { processed: pending.length, cleaned, skipped };
}

export async function cleanupDeliveryArtifacts(input: {
  drive: ReportingDriveAdapter;
  sheets: ReportingSheetsAdapter;
  delivery: Record<string, any>;
}): Promise<"cleaned" | "skipped" | "failed"> {
  const runId = String(input.delivery.run_id);
  const destinationId = String(input.delivery.destination_id);
  const strategy = input.delivery.strategy as "replace_tab" | "snapshot";
  const terminalStatus = String(input.delivery.status);
  // A completed snapshot workbook is the published artifact, never an
  // incomplete artifact. Active deliveries may still be writing or promoting,
  // so the janitor must wait for an explicit failed/cancelled terminal state.
  if (!["failed", "cancelled"].includes(terminalStatus)) {
    return "skipped";
  }

  const artifactIds: string[] = [
    ...(input.delivery.cleanup?.artifact_ids ?? []),
  ];
  if (strategy === "snapshot" && input.delivery.workbook_id) {
    artifactIds.push(String(input.delivery.workbook_id));
  }

  try {
    for (const artifactId of [...new Set(artifactIds)]) {
      if (strategy === "snapshot") {
        const file = await input.drive.getFile({ fileId: artifactId });
        if (file.trashed) continue;
        // Drive-level ownership checks (ownedByMe, MIME, appProperties, identity).
        await input.drive.trashFile({
          fileId: artifactId,
          expectedRunId: runId,
          expectedDestinationId: destinationId,
        });
      } else if (
        input.delivery.staging_sheet_id !== null &&
        input.delivery.staging_sheet_id !== undefined &&
        input.delivery.workbook_id
      ) {
        const workbookId = String(input.delivery.workbook_id);
        const listed = await input.sheets.listSheets(workbookId);
        const staging = listed.find(
          (sheet) => sheet.sheetId === input.delivery.staging_sheet_id,
        );
        if (!staging) continue;
        if (!staging.hidden) {
          // Never delete a visible tab that might be published; never by name.
          await patchReportingDeliveryCleanup({
            runId,
            set: {
              "cleanup.state": "failed",
              "cleanup.last_error_code": "staging_not_hidden",
              "cleanup.attempts":
                Number(input.delivery.cleanup?.attempts ?? 0) + 1,
              "cleanup.updated_at": new Date(),
            },
          });
          await emitReportingCleanupJanitorFailed({
            runId,
            errorCode: "staging_not_hidden",
          });
          return "skipped";
        }
        await input.sheets.verifyOwnershipAndRunMarkers({
          spreadsheetId: workbookId,
          sheetTitle: staging.title,
          destinationId,
          runId,
        });
        await input.sheets.deleteSheet({
          spreadsheetId: workbookId,
          sheetId: staging.sheetId,
        });
      }
    }
    await patchReportingDeliveryCleanup({
      runId,
      set: {
        "cleanup.state": "completed",
        "cleanup.updated_at": new Date(),
        "cleanup.attempts": Number(input.delivery.cleanup?.attempts ?? 0) + 1,
      },
    });
    return "cleaned";
  } catch {
    const latest = await loadReportingDelivery(runId);
    await patchReportingDeliveryCleanup({
      runId,
      set: {
        "cleanup.state": "pending",
        "cleanup.last_error_code": "cleanup_retry",
        "cleanup.attempts": Number(latest?.cleanup?.attempts ?? 0) + 1,
        "cleanup.updated_at": new Date(),
      },
    });
    return "failed";
  }
}

export function positivelyMarkedForCleanup(input: {
  ownershipRaw: unknown;
  runRaw: unknown;
  runId: string;
  destinationId: string;
}): boolean {
  return runMarkerMatches({
    raw: input.runRaw,
    runId: input.runId,
    destinationId: input.destinationId,
  });
}
