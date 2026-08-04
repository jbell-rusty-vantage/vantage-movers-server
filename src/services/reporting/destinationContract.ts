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
