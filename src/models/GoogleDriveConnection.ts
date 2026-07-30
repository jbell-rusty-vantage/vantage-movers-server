import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const GoogleDriveConnectionSchema = new Schema(
  {
    owner_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    google_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    encrypted_refresh_token: { type: String, required: true },
    refresh_token_iv: { type: String, required: true },
    refresh_token_auth_tag: { type: String, required: true },
    encryption_version: { type: Number, required: true, default: 1 },
    scopes: { type: [String], required: true, default: [] },
    connected_at: { type: Date, required: true, default: Date.now },
    last_used_at: { type: Date },
  },
  {
    collection: "google_drive_connections",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    versionKey: false,
  },
);

GoogleDriveConnectionSchema.index({ owner_email: 1 }, { unique: true });

export type GoogleDriveConnectionDocument =
  InferSchemaType<typeof GoogleDriveConnectionSchema> & {
    _id: mongoose.Types.ObjectId;
  };

export const GoogleDriveConnection: Model<GoogleDriveConnectionDocument> =
  mongoose.models.GoogleDriveConnection ??
  mongoose.model<GoogleDriveConnectionDocument>(
    "GoogleDriveConnection",
    GoogleDriveConnectionSchema,
  );
