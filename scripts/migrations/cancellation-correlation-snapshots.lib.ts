import {
  bookingHasRecoverableJobNumber,
  cancellationCorrelationSnapshotsFromBooking,
  type BookingCorrelationSource,
  type CancellationCorrelationSnapshots,
} from "../../src/services/cancellations/cancellationCorrelationSnapshots.js";

export const CANCELLATION_CORRELATION_SNAPSHOTS_SCRIPT_VERSION =
  "cancellation-correlation-snapshots-v1";

export const CANCELLATION_SNAPSHOT_INDEX_NAME =
  "cancelled_lead_normalized_job_no_snapshot";

export type HistoricalCancellationClass = "already_stamped" | "deterministic" | "remainder";

export type HistoricalCancellationRow = {
  id: string;
  booked_lead?: string | null;
  has_normalized_job_no_snapshot: boolean;
};

export type ClassificationResult = {
  id: string;
  class: HistoricalCancellationClass;
  snapshots?: CancellationCorrelationSnapshots;
};

export function hasDurableJobSnapshot(row: {
  normalized_job_no_snapshot?: unknown;
  job_no_snapshot?: unknown;
}): boolean {
  return typeof row.normalized_job_no_snapshot === "string"
    && Boolean(row.normalized_job_no_snapshot.trim());
}

export function classifyHistoricalCancellation(input: {
  cancellation: HistoricalCancellationRow & {
    normalized_job_no_snapshot?: unknown;
    job_no_snapshot?: unknown;
  };
  booking: BookingCorrelationSource | null;
}): ClassificationResult {
  if (hasDurableJobSnapshot(input.cancellation)) {
    return { id: input.cancellation.id, class: "already_stamped" };
  }
  if (!input.booking || !bookingHasRecoverableJobNumber(input.booking)) {
    return { id: input.cancellation.id, class: "remainder" };
  }
  return {
    id: input.cancellation.id,
    class: "deterministic",
    snapshots: cancellationCorrelationSnapshotsFromBooking(input.booking),
  };
}

export function summarizeCancellationSnapshotInventory(
  rows: ClassificationResult[],
): {
  historical: number;
  already_stamped: number;
  deterministic: number;
  remainder: number;
  remainder_ids: string[];
} {
  const remainder_ids = rows
    .filter((row) => row.class === "remainder")
    .map((row) => row.id)
    .sort();
  return {
    historical: rows.length,
    already_stamped: rows.filter((row) => row.class === "already_stamped").length,
    deterministic: rows.filter((row) => row.class === "deterministic").length,
    remainder: remainder_ids.length,
    remainder_ids,
  };
}

export function cancellationSnapshotBackfillUpdate(
  snapshots: CancellationCorrelationSnapshots,
): CancellationCorrelationSnapshots {
  return {
    job_no_snapshot: snapshots.job_no_snapshot,
    normalized_job_no_snapshot: snapshots.normalized_job_no_snapshot,
    lead_ref_snapshot: snapshots.lead_ref_snapshot,
    booking_created_at_snapshot: snapshots.booking_created_at_snapshot,
  };
}
