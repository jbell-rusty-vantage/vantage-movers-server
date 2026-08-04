import { computeChecksum } from "../durableWork";
import { reportingError } from "./catalog";
import { REPORTING_DESTINATION_MAX_FUTURE_SKEW_MS } from "../../config/domain/reporting";

export interface ValidatedReportingDestinationSnapshotV1 {
  contractVersion: 1;
  destinationId: string;
  provider: "google_sheets";
  driveConnectionId: string;
  ownerIdentitySnapshot: { stableOwnerId: string; maskedEmail: string };
  folder: { id: string; name: string; url: string };
  strategy: "replace_tab" | "snapshot";
  workbook?: { id: string; name: string; url: string };
  managedTab?: { immutableSheetId: number; name: string; managed: true };
  destinationType: string;
  ownershipPolicy: string;
  accessStatus: "verified";
  healthVerifiedAt: string;
  archived: false;
  safety: {
    denylistCheckedAt: string;
    operationalWorkbookMatch: false;
    humanCreatedTabTakeover: false;
  };
  capacity: { providerMaxCells: number; destinationAvailableCells: number };
  snapshotChecksum: string;
}

export interface ReportingDestinationPort {
  getValidatedSnapshot(destinationId: string): Promise<ValidatedReportingDestinationSnapshotV1>;
}

export function destinationSnapshotChecksum(
  snapshot: Omit<ValidatedReportingDestinationSnapshotV1, "snapshotChecksum">,
): string {
  return computeChecksum({
    checksum_version: 1,
    artifact_kind: "reporting_destination_snapshot",
    schema_version: 1,
    payload: snapshot,
  });
}

/**
 * Lineage-stable destination identity for two-step run confirmation.
 * Excludes volatile healthVerifiedAt / denylistCheckedAt so a health refresh
 * between estimate and confirm remains valid when identity/safety/ownership match.
 */
export function destinationStableIdentityPayload(
  snapshot: Omit<ValidatedReportingDestinationSnapshotV1, "snapshotChecksum"> | ValidatedReportingDestinationSnapshotV1,
): Record<string, unknown> {
  return {
    contractVersion: snapshot.contractVersion,
    destinationId: snapshot.destinationId,
    provider: snapshot.provider,
    driveConnectionId: snapshot.driveConnectionId,
    ownerIdentitySnapshot: snapshot.ownerIdentitySnapshot,
    folder: snapshot.folder,
    strategy: snapshot.strategy,
    workbook: snapshot.workbook ?? null,
    managedTab: snapshot.managedTab
      ? {
          immutableSheetId: snapshot.managedTab.immutableSheetId,
          name: snapshot.managedTab.name,
          managed: snapshot.managedTab.managed,
        }
      : null,
    destinationType: snapshot.destinationType,
    ownershipPolicy: snapshot.ownershipPolicy,
    accessStatus: snapshot.accessStatus,
    archived: snapshot.archived,
    safety: {
      operationalWorkbookMatch: snapshot.safety.operationalWorkbookMatch,
      humanCreatedTabTakeover: snapshot.safety.humanCreatedTabTakeover,
    },
    capacity: snapshot.capacity,
  };
}

export function destinationStableIdentityChecksum(
  snapshot: Omit<ValidatedReportingDestinationSnapshotV1, "snapshotChecksum"> | ValidatedReportingDestinationSnapshotV1,
): string {
  return computeChecksum({
    checksum_version: 1,
    artifact_kind: "reporting_destination_stable_identity",
    schema_version: 1,
    payload: destinationStableIdentityPayload(snapshot),
  });
}

/** DB-only checksum for owner-facing destination reads; trusts persisted verification state. */
export function snapshotChecksumFromDestinationRecord(
  destination: Record<string, unknown>,
  destinationId: string,
): string | null {
  if (destination.state !== "active" || destination.access_status !== "verified") {
    return null;
  }
  const healthVerifiedAt = destination.health_verified_at;
  const denylistCheckedAt = destination.denylist_checked_at;
  const driveConnectionId = destination.drive_connection_id;
  const owner = destination.owner_identity_snapshot as
    | { stable_owner_id?: string; masked_email?: string }
    | undefined;
  const folder = destination.folder as { id?: string; name?: string; url?: string } | undefined;
  const capacity = destination.capacity as
    | { provider_max_cells?: number; destination_available_cells?: number }
    | undefined;
  const strategy = destination.strategy;
  if (
    !driveConnectionId ||
    !owner?.stable_owner_id ||
    !owner.masked_email ||
    !folder?.id ||
    !folder.name ||
    !folder.url ||
    (strategy !== "replace_tab" && strategy !== "snapshot") ||
    !capacity?.provider_max_cells ||
    !capacity.destination_available_cells
  ) {
    return null;
  }
  const validatedStrategy = strategy as "replace_tab" | "snapshot";

  const healthVerifiedAtIso =
    healthVerifiedAt instanceof Date
      ? healthVerifiedAt.toISOString()
      : typeof healthVerifiedAt === "string"
        ? healthVerifiedAt
        : null;
  const denylistCheckedAtIso =
    denylistCheckedAt instanceof Date
      ? denylistCheckedAt.toISOString()
      : typeof denylistCheckedAt === "string"
        ? denylistCheckedAt
        : null;
  if (!healthVerifiedAtIso || !denylistCheckedAtIso) {
    return null;
  }

  const payload = {
    contractVersion: 1 as const,
    destinationId,
    provider: "google_sheets" as const,
    driveConnectionId: String(driveConnectionId),
    ownerIdentitySnapshot: {
      stableOwnerId: owner.stable_owner_id,
      maskedEmail: owner.masked_email,
    },
    folder: {
      id: folder.id,
      name: folder.name,
      url: folder.url,
    },
    strategy: validatedStrategy,
    destinationType: String(destination.destination_type ?? "owner_drive"),
    ownershipPolicy: String(destination.ownership_policy ?? "vantage_managed_tab"),
    accessStatus: "verified" as const,
    healthVerifiedAt: healthVerifiedAtIso,
    archived: false as const,
    safety: {
      denylistCheckedAt: denylistCheckedAtIso,
      operationalWorkbookMatch: false as const,
      humanCreatedTabTakeover: false as const,
    },
    capacity: {
      providerMaxCells: capacity.provider_max_cells,
      destinationAvailableCells: capacity.destination_available_cells,
    },
    ...(validatedStrategy === "replace_tab"
      ? {
          workbook: destination.workbook as { id: string; name: string; url: string },
          managedTab: {
            immutableSheetId: (destination.managed_tab as { immutable_sheet_id: number })
              .immutable_sheet_id,
            name: (destination.managed_tab as { name: string }).name,
            managed: true as const,
          },
        }
      : {}),
  };

  if (
    validatedStrategy === "replace_tab" &&
    (!payload.workbook?.id ||
      !payload.managedTab?.immutableSheetId ||
      !payload.managedTab.name)
  ) {
    return null;
  }

  return destinationSnapshotChecksum(payload);
}

export function validateDestinationSnapshot(
  snapshot: ValidatedReportingDestinationSnapshotV1,
  expected: {
    destinationId: string;
    checksum: string;
    strategy: "replace_tab" | "snapshot";
    maxAgeMs?: number;
  },
): ValidatedReportingDestinationSnapshotV1 {
  const { snapshotChecksum, ...payload } = snapshot;
  if (snapshotChecksum !== expected.checksum || destinationSnapshotChecksum(payload) !== snapshotChecksum) {
    throw reportingError("destination_unverified", "Destination snapshot checksum mismatch.", 409);
  }
  if (snapshot.destinationId !== expected.destinationId) {
    throw reportingError(
      "destination_unverified",
      "Destination snapshot identity mismatch.",
      409,
    );
  }
  if (snapshot.strategy !== expected.strategy) {
    throw reportingError("destination_strategy_mismatch", "Destination strategy mismatch.", 409);
  }
  if (snapshot.archived !== false || snapshot.accessStatus !== "verified") {
    throw reportingError("destination_unverified", "Destination is unavailable.", 409);
  }
  if (
    snapshot.safety.operationalWorkbookMatch !== false ||
    snapshot.safety.humanCreatedTabTakeover !== false ||
    (snapshot.strategy === "replace_tab" &&
      (!snapshot.workbook ||
        snapshot.managedTab?.managed !== true ||
        !Number.isSafeInteger(snapshot.managedTab.immutableSheetId))) ||
    (snapshot.strategy === "snapshot" &&
      (snapshot.workbook !== undefined || snapshot.managedTab !== undefined))
  ) throw reportingError("destination_unsafe", "Destination safety validation failed.", 409);
  const maxAge = expected.maxAgeMs ?? 24 * 60 * 60 * 1000;
  const now = Date.now();
  const healthVerifiedAt = Date.parse(snapshot.healthVerifiedAt);
  const denylistCheckedAt = Date.parse(snapshot.safety.denylistCheckedAt);
  if (
    !Number.isFinite(healthVerifiedAt) ||
    !Number.isFinite(denylistCheckedAt) ||
    healthVerifiedAt > now + REPORTING_DESTINATION_MAX_FUTURE_SKEW_MS ||
    denylistCheckedAt > now + REPORTING_DESTINATION_MAX_FUTURE_SKEW_MS ||
    now - healthVerifiedAt > maxAge ||
    now - denylistCheckedAt > maxAge
  ) {
    throw reportingError("destination_unverified", "Destination health verification is stale.", 409);
  }
  if (
    !Number.isSafeInteger(snapshot.capacity.providerMaxCells) ||
    !Number.isSafeInteger(snapshot.capacity.destinationAvailableCells) ||
    snapshot.capacity.providerMaxCells <= 0 ||
    snapshot.capacity.destinationAvailableCells <= 0
  ) {
    throw reportingError("destination_unverified", "Destination capacity is invalid.", 409);
  }
  return snapshot;
}

export class FakeReportingDestinationPort implements ReportingDestinationPort {
  private readonly snapshots = new Map<string, ValidatedReportingDestinationSnapshotV1>();
  add(snapshot: ValidatedReportingDestinationSnapshotV1): void {
    this.snapshots.set(snapshot.destinationId, structuredClone(snapshot));
  }
  async getValidatedSnapshot(destinationId: string): Promise<ValidatedReportingDestinationSnapshotV1> {
    const snapshot = this.snapshots.get(destinationId);
    if (!snapshot) throw reportingError("destination_unverified", "Destination was not found.", 409);
    return structuredClone(snapshot);
  }
}

let destinationPort: ReportingDestinationPort = new FakeReportingDestinationPort();
export function setReportingDestinationPort(port: ReportingDestinationPort): void {
  destinationPort = port;
}
export function getReportingDestinationPort(): ReportingDestinationPort {
  return destinationPort;
}
