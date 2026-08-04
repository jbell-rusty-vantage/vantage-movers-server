import { reportingError } from "./catalog";
import {
  validateDestinationSnapshot,
  type ValidatedReportingDestinationSnapshotV1,
} from "./destinationContract";

/**
 * Proven Vantage-managed lineage advancement for replace_tab destinations.
 * Revision immutability is preserved: the revision keeps its original snapshot.
 * New runs bind the freshly validated live managed-tab snapshot when the live
 * sheet ID equals the revision's sheet or the revision sheet appears in the
 * destination's predecessor lineage recorded by successful CAS promotions.
 */
export type ManagedTabLineageEvidence = {
  revisionManagedSheetId: number;
  liveManagedSheetId: number;
  predecessorSheetIds: number[];
  publishedName: string;
  workbookId: string;
};

export function extractPredecessorSheetIds(
  destinationRecord: Record<string, unknown> | null | undefined,
): number[] {
  const managed = destinationRecord?.managed_tab as
    | { predecessor_sheet_ids?: unknown }
    | null
    | undefined;
  const raw = managed?.predecessor_sheet_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is number => Number.isSafeInteger(value));
}

export function isProvenManagedTabAdvancement(input: {
  revisionSheetId: number;
  liveSheetId: number;
  predecessorSheetIds: number[];
}): boolean {
  if (input.revisionSheetId === input.liveSheetId) return true;
  return input.predecessorSheetIds.includes(input.revisionSheetId);
}

/**
 * Validate a live destination for a new or resumed run of an immutable revision.
 * Accepts only same destination/workbook/strategy/published-name identity with
 * either an exact managed-tab match or proven lineage advancement.
 */
export function validateDestinationForImmutableRevision(input: {
  live: ValidatedReportingDestinationSnapshotV1;
  revisionDestination: ValidatedReportingDestinationSnapshotV1;
  predecessorSheetIds?: number[];
  maxAgeMs?: number;
}): ValidatedReportingDestinationSnapshotV1 {
  const { live, revisionDestination } = input;
  // Live must be structurally valid on its own checksum (fresh snapshot).
  validateDestinationSnapshot(live, {
    destinationId: live.destinationId,
    checksum: live.snapshotChecksum,
    strategy: live.strategy,
    maxAgeMs: input.maxAgeMs,
  });

  if (live.destinationId !== revisionDestination.destinationId) {
    throw reportingError(
      "destination_unverified",
      "Destination identity does not match the immutable revision.",
      409,
    );
  }
  if (live.strategy !== revisionDestination.strategy) {
    throw reportingError(
      "destination_strategy_mismatch",
      "Destination strategy mismatch.",
      409,
    );
  }
  if (live.folder.id !== revisionDestination.folder.id) {
    throw reportingError(
      "destination_unverified",
      "Destination folder drifted from the immutable revision.",
      409,
    );
  }

  if (live.strategy === "replace_tab") {
    if (
      !live.workbook?.id ||
      !revisionDestination.workbook?.id ||
      live.workbook.id !== revisionDestination.workbook.id
    ) {
      throw reportingError(
        "destination_unverified",
        "Destination workbook drifted from the immutable revision.",
        409,
      );
    }
    if (
      !live.managedTab?.name ||
      !revisionDestination.managedTab?.name ||
      live.managedTab.name !== revisionDestination.managedTab.name
    ) {
      throw reportingError(
        "destination_unverified",
        "Published managed-tab name drifted from the immutable revision.",
        409,
      );
    }
    const revisionSheetId = revisionDestination.managedTab.immutableSheetId;
    const liveSheetId = live.managedTab.immutableSheetId;
    if (
      !isProvenManagedTabAdvancement({
        revisionSheetId,
        liveSheetId,
        predecessorSheetIds: input.predecessorSheetIds ?? [],
      })
    ) {
      throw reportingError(
        "destination_unverified",
        "Managed-tab sheet ID drifted without proven Vantage lineage advancement.",
        409,
      );
    }
  }

  return live;
}

/**
 * Worker binding: prefer packaged destination when CAS-resume is in flight;
 * otherwise accept live lineage-advanced snapshot for the same revision identity.
 */
export function resolveDestinationForWorker(input: {
  live: ValidatedReportingDestinationSnapshotV1;
  packaged: ValidatedReportingDestinationSnapshotV1;
  predecessorSheetIds?: number[];
  casResumeInFlight: boolean;
}): ValidatedReportingDestinationSnapshotV1 {
  if (input.casResumeInFlight) {
    // Packaged destination carries the pre-CAS sheet IDs needed for resume.
    return input.packaged;
  }
  if (input.live.snapshotChecksum === input.packaged.snapshotChecksum) {
    return validateDestinationSnapshot(input.live, {
      destinationId: input.packaged.destinationId,
      checksum: input.packaged.snapshotChecksum,
      strategy: input.packaged.strategy,
    });
  }
  return validateDestinationForImmutableRevision({
    live: input.live,
    revisionDestination: input.packaged,
    predecessorSheetIds: input.predecessorSheetIds,
  });
}

export function buildDestinationLineageEvidence(input: {
  revisionDestination: ValidatedReportingDestinationSnapshotV1;
  live: ValidatedReportingDestinationSnapshotV1;
  predecessorSheetIds: number[];
}): {
  revisionDestinationSnapshotChecksum: string;
  predecessorSheetId: number | null;
  currentManagedSheetId: number | null;
  acceptedAdvancement: boolean;
} {
  const revisionSheet =
    input.revisionDestination.managedTab?.immutableSheetId ?? null;
  const liveSheet = input.live.managedTab?.immutableSheetId ?? null;
  const advanced =
    revisionSheet != null &&
    liveSheet != null &&
    revisionSheet !== liveSheet &&
    isProvenManagedTabAdvancement({
      revisionSheetId: revisionSheet,
      liveSheetId: liveSheet,
      predecessorSheetIds: input.predecessorSheetIds,
    });
  return {
    revisionDestinationSnapshotChecksum:
      input.revisionDestination.snapshotChecksum,
    predecessorSheetId: advanced ? revisionSheet : null,
    currentManagedSheetId: liveSheet,
    acceptedAdvancement: Boolean(advanced),
  };
}
