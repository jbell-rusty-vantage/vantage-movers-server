import mongoose from "mongoose";
import { normalizeJobNo } from "../bookings/bookingIdentity";

export type CancellationLeadRefSnapshot = {
  model: "FormLead" | "CallLead";
  id: string;
};

export type CancellationCorrelationSnapshots = {
  job_no_snapshot: string | null;
  normalized_job_no_snapshot: string | null;
  lead_ref_snapshot: CancellationLeadRefSnapshot | null;
  booking_created_at_snapshot: Date | null;
};

export type BookingCorrelationSource = {
  job_no?: unknown;
  normalized_job_no?: unknown;
  lead_ref?: unknown;
  lead_model?: unknown;
  createdAt?: unknown;
};

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

function asLeadRefSnapshot(
  leadRef: unknown,
  leadModel: unknown,
): CancellationLeadRefSnapshot | null {
  if (leadModel !== "FormLead" && leadModel !== "CallLead") return null;
  if (leadRef == null) return null;
  const id = typeof leadRef === "string"
    ? leadRef
    : typeof leadRef === "object" && "toHexString" in leadRef
      ? String((leadRef as { toHexString: () => string }).toHexString())
      : String(leadRef);
  return id ? { model: leadModel, id } : null;
}

export function cancellationCorrelationSnapshotsFromBooking(
  booking: BookingCorrelationSource,
): CancellationCorrelationSnapshots {
  const job_no_snapshot = asTrimmedString(booking.job_no);
  const storedNormalized = asTrimmedString(booking.normalized_job_no);
  const normalized_job_no_snapshot = storedNormalized
    ?? (job_no_snapshot ? normalizeJobNo(job_no_snapshot) ?? null : null);
  return {
    job_no_snapshot,
    normalized_job_no_snapshot,
    lead_ref_snapshot: asLeadRefSnapshot(booking.lead_ref, booking.lead_model),
    booking_created_at_snapshot: asDate(booking.createdAt),
  };
}

export function bookingHasRecoverableJobNumber(booking: BookingCorrelationSource): boolean {
  const snapshots = cancellationCorrelationSnapshotsFromBooking(booking);
  return Boolean(snapshots.normalized_job_no_snapshot);
}

export function snapshotsForCancelledLeadCreate(
  booking: BookingCorrelationSource,
): {
  job_no_snapshot: string | null;
  normalized_job_no_snapshot: string | null;
  lead_ref_snapshot: { model: "FormLead" | "CallLead"; id: mongoose.Types.ObjectId } | null;
  booking_created_at_snapshot: Date | null;
} {
  const snapshots = cancellationCorrelationSnapshotsFromBooking(booking);
  return {
    job_no_snapshot: snapshots.job_no_snapshot,
    normalized_job_no_snapshot: snapshots.normalized_job_no_snapshot,
    lead_ref_snapshot: snapshots.lead_ref_snapshot
      ? {
          model: snapshots.lead_ref_snapshot.model,
          id: new mongoose.Types.ObjectId(snapshots.lead_ref_snapshot.id),
        }
      : null,
    booking_created_at_snapshot: snapshots.booking_created_at_snapshot,
  };
}
