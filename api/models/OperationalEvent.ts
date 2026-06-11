import mongoose, { Schema, type Model } from "mongoose";
import {
  OBSERVABILITY_LEVELS,
  OPERATIONAL_EVENT_CATEGORIES,
  PII_POLICIES,
  type ObservabilityLevel,
  type OperationalEventCategory,
  type PiiPolicy,
} from "../config/domain/observability";
import { getObservabilityModel } from "./observabilityModelFactory";

/**
 * Durable, append-mostly event stream for important workflow facts and
 * failures. This collection powers the Observational event table, event detail
 * drawer, grouping widgets, and report inputs.
 *
 * The collection name and database are resolved at runtime via
 * `getOperationalEventModel()`; do not import the bare schema for writes.
 */
export type OperationalEventDocument = {
  _id: mongoose.Types.ObjectId;
  occurred_at: Date;
  received_at: Date;
  level: ObservabilityLevel;
  event_key: string;
  category: OperationalEventCategory;
  workflow: string;
  summary: string;
  details: Record<string, unknown>;
  fingerprint: string;
  dedupe_key: string | null;
  environment: string;
  service: string;
  region: string | null;
  request_id: string | null;
  route: string | null;
  method: string | null;
  status_code: number | null;
  duration_ms: number | null;
  entity_type: string | null;
  entity_id: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  source_company: string | null;
  job_no: string | null;
  run_id: string | null;
  trace: Record<string, unknown> | null;
  pii_policy: PiiPolicy;
  incident_id: mongoose.Types.ObjectId | null;
  notification_candidate: boolean;
  reportable: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const OperationalEventSchema = new Schema<OperationalEventDocument>(
  {
    occurred_at: { type: Date, required: true, default: Date.now },
    received_at: { type: Date, required: true, default: Date.now },
    level: { type: String, required: true, enum: OBSERVABILITY_LEVELS },
    event_key: { type: String, required: true, trim: true },
    category: { type: String, required: true, enum: OPERATIONAL_EVENT_CATEGORIES },
    workflow: { type: String, required: true, trim: true },
    summary: { type: String, required: true, trim: true },
    details: { type: Schema.Types.Mixed, default: {} },
    fingerprint: { type: String, required: true, trim: true },
    dedupe_key: { type: String, default: null, trim: true },
    environment: { type: String, required: true, trim: true },
    service: { type: String, required: true, default: "vantage-main-server" },
    region: { type: String, default: null },
    request_id: { type: String, default: null },
    route: { type: String, default: null },
    method: { type: String, default: null },
    status_code: { type: Number, default: null },
    duration_ms: { type: Number, default: null },
    entity_type: { type: String, default: null },
    entity_id: { type: String, default: null },
    lead_name: { type: String, default: null },
    lead_phone: { type: String, default: null },
    lead_email: { type: String, default: null },
    source_company: { type: String, default: null },
    job_no: { type: String, default: null },
    run_id: { type: String, default: null },
    trace: { type: Schema.Types.Mixed, default: null },
    pii_policy: { type: String, enum: PII_POLICIES, default: "none" },
    incident_id: { type: Schema.Types.ObjectId, default: null },
    notification_candidate: { type: Boolean, default: false },
    reportable: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

OperationalEventSchema.index({ occurred_at: -1 });
OperationalEventSchema.index({ level: 1, occurred_at: -1 });
OperationalEventSchema.index({ category: 1, workflow: 1, occurred_at: -1 });
OperationalEventSchema.index({ event_key: 1, occurred_at: -1 });
OperationalEventSchema.index({ source_company: 1, occurred_at: -1 });
OperationalEventSchema.index({ lead_phone: 1, occurred_at: -1 });
OperationalEventSchema.index({ lead_email: 1, occurred_at: -1 });
OperationalEventSchema.index({ entity_type: 1, entity_id: 1, occurred_at: -1 });
OperationalEventSchema.index({ request_id: 1, occurred_at: -1 });
OperationalEventSchema.index({ run_id: 1, occurred_at: -1 });
OperationalEventSchema.index({ incident_id: 1, occurred_at: -1 });
OperationalEventSchema.index({ reportable: 1, occurred_at: -1 });
OperationalEventSchema.index({ fingerprint: 1, occurred_at: -1 });
OperationalEventSchema.index({
  event_key: "text",
  workflow: "text",
  summary: "text",
  source_company: "text",
  lead_name: "text",
  lead_phone: "text",
  lead_email: "text",
  job_no: "text",
  entity_id: "text",
});

export function getOperationalEventModel(): Model<OperationalEventDocument> {
  return getObservabilityModel<OperationalEventDocument>(
    "OperationalEvent",
    "events",
    OperationalEventSchema,
  );
}
