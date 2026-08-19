import mongoose, { type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import {
  createGranotDiscrepancyModel,
  type GranotDiscrepancyDocument,
  type GranotDiscrepancyEvidence,
} from "./granotDiscrepancyModel";

export const RELEASE_DISCREPANCY_REASON_CODES = [
  "release_without_vantage_booking",
  "release_record_link_conflict",
  "release_job_number_conflict",
  "release_source_scope_conflict",
] as const;

export type GranotReleaseDiscrepancyReasonCode =
  (typeof RELEASE_DISCREPANCY_REASON_CODES)[number];
export type GranotReleaseDiscrepancyDocument = GranotDiscrepancyDocument;
export type GranotReleaseDiscrepancyEvidence = GranotDiscrepancyEvidence;

export const GRANOT_RELEASE_DISCREPANCY_COLLECTION =
  "granot_release_discrepancies";
export const GRANOT_RELEASE_DISCREPANCY_MODEL_NAME =
  "GranotReleaseDiscrepancy";
export const GRANOT_RELEASE_DISCREPANCY_INDEXES = [
  {
    name: "granot_release_discrepancy_open_fingerprint_unique",
    key: { normalized_job_no: 1, discrepancy_kind: 1, reason_fingerprint: 1 },
    unique: true,
    partialFilterExpression: { state: "open" },
  },
  {
    name: "granot_release_discrepancy_state_last_evidence",
    key: { state: 1, last_evidence_at: -1 },
  },
] as const;

const created = createGranotDiscrepancyModel({
  model_name: GRANOT_RELEASE_DISCREPANCY_MODEL_NAME,
  collection: GRANOT_RELEASE_DISCREPANCY_COLLECTION,
  kind: "release",
  reason_codes: RELEASE_DISCREPANCY_REASON_CODES,
  indexes: GRANOT_RELEASE_DISCREPANCY_INDEXES,
});

export const GranotReleaseDiscrepancy = created.model;

export function getGranotReleaseDiscrepancyModel(): Model<GranotReleaseDiscrepancyDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) return GranotReleaseDiscrepancy;
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[GRANOT_RELEASE_DISCREPANCY_MODEL_NAME] as
      | Model<GranotReleaseDiscrepancyDocument>
      | undefined) ??
    db.model<GranotDiscrepancyDocument>(
      GRANOT_RELEASE_DISCREPANCY_MODEL_NAME,
      created.schema,
    ) as Model<GranotReleaseDiscrepancyDocument>
  );
}
