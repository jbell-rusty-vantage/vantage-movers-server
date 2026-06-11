import mongoose, { Schema, type Model } from "mongoose";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type IncidentSeverity,
  type IncidentStatus,
} from "../config/domain/observability";
import { getObservabilityModel } from "./observabilityModelFactory";

/**
 * Stateful issue records built from one or more events. This is what the owner
 * sees as "needs attention". Incidents are deduped by `fingerprint` so a
 * repeated failure increments `count` on one open incident instead of creating
 * a flood of records.
 */
export type IncidentNotificationState = {
  immediate_sent_at: Date | null;
  digest_sent_at: Date | null;
  next_notify_at: Date | null;
  suppressed_count: number;
};

export type OperationalIncidentDocument = {
  _id: mongoose.Types.ObjectId;
  status: IncidentStatus;
  severity: IncidentSeverity;
  fingerprint: string;
  dedupe_key: string;
  event_key: string;
  category: string;
  workflow: string;
  title: string;
  summary: string;
  environment: string;
  service: string;
  source_company: string | null;
  route: string | null;
  entity_type: string | null;
  entity_id: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
  run_id: string | null;
  first_event_id: mongoose.Types.ObjectId | null;
  latest_event_id: mongoose.Types.ObjectId | null;
  first_seen_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  ignored_at: Date | null;
  ignored_by: string | null;
  count: number;
  last_details: Record<string, unknown>;
  owner_visible: boolean;
  notification_state: IncidentNotificationState;
  createdAt: Date;
  updatedAt: Date;
};

const OperationalIncidentSchema = new Schema<OperationalIncidentDocument>(
  {
    status: {
      type: String,
      required: true,
      enum: INCIDENT_STATUSES,
      default: "open",
    },
    severity: { type: String, required: true, enum: INCIDENT_SEVERITIES },
    fingerprint: { type: String, required: true, trim: true },
    dedupe_key: { type: String, required: true, trim: true },
    event_key: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    workflow: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    summary: { type: String, required: true, trim: true },
    environment: { type: String, required: true, trim: true },
    service: { type: String, required: true, default: "vantage-main-server" },
    source_company: { type: String, default: null },
    route: { type: String, default: null },
    entity_type: { type: String, default: null },
    entity_id: { type: String, default: null },
    lead_name: { type: String, default: null },
    lead_phone: { type: String, default: null },
    lead_email: { type: String, default: null },
    run_id: { type: String, default: null },
    first_event_id: { type: Schema.Types.ObjectId, default: null },
    latest_event_id: { type: Schema.Types.ObjectId, default: null },
    first_seen_at: { type: Date, required: true, default: Date.now },
    last_seen_at: { type: Date, required: true, default: Date.now },
    resolved_at: { type: Date, default: null },
    acknowledged_at: { type: Date, default: null },
    acknowledged_by: { type: String, default: null },
    ignored_at: { type: Date, default: null },
    ignored_by: { type: String, default: null },
    count: { type: Number, required: true, default: 1 },
    last_details: { type: Schema.Types.Mixed, default: {} },
    owner_visible: { type: Boolean, default: false },
    notification_state: {
      immediate_sent_at: { type: Date, default: null },
      digest_sent_at: { type: Date, default: null },
      next_notify_at: { type: Date, default: null },
      suppressed_count: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

OperationalIncidentSchema.index({ status: 1, severity: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ severity: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ category: 1, workflow: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ event_key: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ source_company: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ lead_phone: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ lead_email: 1, last_seen_at: -1 });
OperationalIncidentSchema.index({ owner_visible: 1, status: 1, last_seen_at: -1 });
// Only one open/acknowledged incident may exist per fingerprint.
OperationalIncidentSchema.index(
  { fingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["open", "acknowledged"] } },
  },
);

export function getOperationalIncidentModel(): Model<OperationalIncidentDocument> {
  return getObservabilityModel<OperationalIncidentDocument>(
    "OperationalIncident",
    "incidents",
    OperationalIncidentSchema,
  );
}
