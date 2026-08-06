import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import type { GranotWebhookEventType } from "../config/domain/granotWebhook";

export type GranotWebhookProcessingStatus =
  | "received"
  | "processed"
  | "ignored"
  | "failed";

export type GranotWebhookReceiptDocument = {
  _id: mongoose.Types.ObjectId;
  provider: "granot";
  event_type: GranotWebhookEventType;
  received_at: Date;
  schema_version: number;
  payload_kind: "object" | "array" | "null" | "primitive";
  headers: Record<string, string | string[]>;
  payload: unknown;
  processing_status: GranotWebhookProcessingStatus;
  processing_attempts: number;
  processed_at?: Date;
  processing_error?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const GranotWebhookReceiptSchema = new Schema<GranotWebhookReceiptDocument>(
  {
    provider: { type: String, required: true, enum: ["granot"] },
    event_type: {
      type: String,
      required: true,
      enum: ["lead_created", "priority_updated", "booking_status_changed"],
    },
    received_at: { type: Date, required: true },
    schema_version: { type: Number, required: true, default: 1 },
    payload_kind: {
      type: String,
      required: true,
      enum: ["object", "array", "null", "primitive"],
    },
    headers: { type: Schema.Types.Mixed, required: true, default: {} },
    // Granot has not defined its payload contracts yet. Mixed preserves each
    // authenticated JSON delivery exactly while normalized processing is added later.
    payload: { type: Schema.Types.Mixed, default: null },
    processing_status: {
      type: String,
      required: true,
      enum: ["received", "processed", "ignored", "failed"],
      default: "received",
    },
    processing_attempts: { type: Number, required: true, default: 0 },
    processed_at: { type: Date },
    processing_error: { type: Schema.Types.Mixed },
  },
  {
    collection: "granot_webhook_receipts",
    timestamps: true,
    strict: true,
  },
);

GranotWebhookReceiptSchema.index({ event_type: 1, received_at: -1 });
GranotWebhookReceiptSchema.index({ processing_status: 1, received_at: 1 });

export const GranotWebhookReceipt: Model<GranotWebhookReceiptDocument> =
  (mongoose.models.GranotWebhookReceipt as
    | Model<GranotWebhookReceiptDocument>
    | undefined) ??
  mongoose.model<GranotWebhookReceiptDocument>(
    "GranotWebhookReceipt",
    GranotWebhookReceiptSchema,
  );

export function getGranotWebhookReceiptModel(): Model<GranotWebhookReceiptDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotWebhookReceipt;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.GranotWebhookReceipt as
      | Model<GranotWebhookReceiptDocument>
      | undefined) ??
    db.model<GranotWebhookReceiptDocument>(
      "GranotWebhookReceipt",
      GranotWebhookReceiptSchema,
    )
  );
}
