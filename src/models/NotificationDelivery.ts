import mongoose, { Schema, type Model } from "mongoose";
import {
  NOTIFICATION_PURPOSES,
  NOTIFICATION_RECIPIENT_TYPES,
  NOTIFICATION_STATUSES,
  type NotificationPurpose,
  type NotificationRecipientType,
  type NotificationStatus,
} from "../config/domain/observability";
import { getObservabilityModel } from "./observabilityModelFactory";

/**
 * Durable record of every owner/developer email attempt and its provider
 * outcome. Enables retries, auditability, and visibility when notification
 * sending fails. The `body_text_preview` is enough for audit, not a full copy
 * of every email; `body_text` is retained only so failed sends can be retried
 * without truncating the payload.
 */
export type NotificationDeliveryDocument = {
  _id: mongoose.Types.ObjectId;
  channel: "email";
  provider: string;
  purpose: NotificationPurpose;
  status: NotificationStatus;
  recipient_type: NotificationRecipientType;
  to: string[];
  from: string;
  reply_to: string | null;
  subject: string;
  body_text: string | null;
  body_text_preview: string;
  event_id: mongoose.Types.ObjectId | null;
  incident_id: mongoose.Types.ObjectId | null;
  report_run_id: mongoose.Types.ObjectId | null;
  dedupe_key: string | null;
  provider_message_id: string | null;
  provider_response: Record<string, unknown> | null;
  error_message: string | null;
  attempt_count: number;
  last_attempt_at: Date | null;
  next_attempt_at: Date | null;
  sent_at: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const NotificationDeliverySchema = new Schema<NotificationDeliveryDocument>(
  {
    channel: { type: String, required: true, default: "email" },
    provider: { type: String, required: true },
    purpose: { type: String, required: true, enum: NOTIFICATION_PURPOSES },
    status: {
      type: String,
      required: true,
      enum: NOTIFICATION_STATUSES,
      default: "queued",
    },
    recipient_type: {
      type: String,
      required: true,
      enum: NOTIFICATION_RECIPIENT_TYPES,
    },
    to: { type: [String], default: [] },
    from: { type: String, required: true },
    reply_to: { type: String, default: null },
    subject: { type: String, required: true },
    body_text: { type: String, default: null },
    body_text_preview: { type: String, default: "" },
    event_id: { type: Schema.Types.ObjectId, default: null },
    incident_id: { type: Schema.Types.ObjectId, default: null },
    report_run_id: { type: Schema.Types.ObjectId, default: null },
    dedupe_key: { type: String, default: null },
    provider_message_id: { type: String, default: null },
    provider_response: { type: Schema.Types.Mixed, default: null },
    error_message: { type: String, default: null },
    attempt_count: { type: Number, default: 0 },
    last_attempt_at: { type: Date, default: null },
    next_attempt_at: { type: Date, default: null },
    sent_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

NotificationDeliverySchema.index({ status: 1, next_attempt_at: 1 });
NotificationDeliverySchema.index({ purpose: 1, createdAt: -1 });
NotificationDeliverySchema.index({ incident_id: 1, createdAt: -1 });
NotificationDeliverySchema.index({ event_id: 1, createdAt: -1 });
NotificationDeliverySchema.index({ report_run_id: 1, createdAt: -1 });
NotificationDeliverySchema.index({ dedupe_key: 1, createdAt: -1 });

export function getNotificationDeliveryModel(): Model<NotificationDeliveryDocument> {
  return getObservabilityModel<NotificationDeliveryDocument>(
    "NotificationDelivery",
    "notifications",
    NotificationDeliverySchema,
  );
}
