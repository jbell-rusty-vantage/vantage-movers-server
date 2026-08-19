import mongoose, { type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import {
  createGranotDiscrepancyModel,
  type GranotDiscrepancyDocument,
  type GranotDiscrepancyEvidence,
} from "./granotDiscrepancyModel";

export const BOOKING_DISCREPANCY_REASON_CODES = [
  "booked_record_link_conflict",
  "booked_booking_lead_conflict",
  "booked_job_number_conflict",
  "booked_source_scope_conflict",
  "booked_after_official_cancellation",
] as const;

export type GranotBookingDiscrepancyReasonCode =
  (typeof BOOKING_DISCREPANCY_REASON_CODES)[number];
export type GranotBookingDiscrepancyDocument = GranotDiscrepancyDocument;
export type GranotBookingDiscrepancyEvidence = GranotDiscrepancyEvidence;

export const GRANOT_BOOKING_DISCREPANCY_COLLECTION =
  "granot_booking_discrepancies";
export const GRANOT_BOOKING_DISCREPANCY_MODEL_NAME =
  "GranotBookingDiscrepancy";
export const GRANOT_BOOKING_DISCREPANCY_INDEXES = [
  {
    name: "granot_booking_discrepancy_open_fingerprint_unique",
    key: { normalized_job_no: 1, discrepancy_kind: 1, reason_fingerprint: 1 },
    unique: true,
    partialFilterExpression: { state: "open" },
  },
  {
    name: "granot_booking_discrepancy_state_last_evidence",
    key: { state: 1, last_evidence_at: -1 },
  },
] as const;

const created = createGranotDiscrepancyModel({
  model_name: GRANOT_BOOKING_DISCREPANCY_MODEL_NAME,
  collection: GRANOT_BOOKING_DISCREPANCY_COLLECTION,
  kind: "booking",
  reason_codes: BOOKING_DISCREPANCY_REASON_CODES,
  indexes: GRANOT_BOOKING_DISCREPANCY_INDEXES,
});

export const GranotBookingDiscrepancy = created.model;

export function getGranotBookingDiscrepancyModel(): Model<GranotBookingDiscrepancyDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) return GranotBookingDiscrepancy;
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[GRANOT_BOOKING_DISCREPANCY_MODEL_NAME] as
      | Model<GranotBookingDiscrepancyDocument>
      | undefined) ??
    db.model<GranotDiscrepancyDocument>(
      GRANOT_BOOKING_DISCREPANCY_MODEL_NAME,
      created.schema,
    ) as Model<GranotBookingDiscrepancyDocument>
  );
}
