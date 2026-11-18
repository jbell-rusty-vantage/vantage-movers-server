import { Schema } from "mongoose";
import { at, count, date, defineCsiModel, enumeration, index, oid, str, text, unique } from "../salesIntelligence/common";

export const SALES_OUTREACH_REFRESH_REQUEST_INDEXES = [
  unique("sod_refresh_subject_unique", { subject_id: 1 }),
  index("sod_refresh_pending_due", { pending: 1, next_due_at: 1, _id: 1 }),
];
export const SalesOutreachRefreshRequestSchema = new Schema({
  subject_id: oid, requested_generation: count, consumed_generation: count, pending: { type: Boolean, required: true },
  request_version: enumeration(["w2-v1"] as const), requested_mode: enumeration(["shadow", "active"] as const),
  // Highest active nomination distinguishes pending active work from later shadow-only work.
  active_generation: count,
  requires_projection: { type: Boolean, required: true },
  request_fingerprint: str, configuration_version: str, configuration_revision: count,
  accepted_observation_id: text, accepted_at: date, next_due_at: at, cause: str,
  lease_owner: text, lease_epoch: count, lease_until: date, claimed_generation: count,
  last_input_fingerprint: text, last_output_fingerprint: text, last_requirement_fingerprint: text,
  last_parity: { type: String, enum: ["match", "different", "not_observed"], default: null },
  last_completed_at: date, last_failure_at: date,
}, { collection: "sales_outreach_refresh_requests" });
export const getSalesOutreachRefreshRequestModel = defineCsiModel("SalesOutreachRefreshRequest", SalesOutreachRefreshRequestSchema, SALES_OUTREACH_REFRESH_REQUEST_INDEXES);
