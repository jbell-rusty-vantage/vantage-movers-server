import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const GooglePickerNonceSchema = new Schema(
  {
    nonce_hash: { type: String, required: true },
    owner_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    flow: {
      type: String,
      required: true,
      enum: ["folder", "spreadsheet"],
    },
    expires_at: { type: Date, required: true },
    consumed_at: { type: Date, default: null },
  },
  {
    collection: "google_picker_nonces",
    timestamps: { createdAt: "created_at", updatedAt: false },
    versionKey: false,
  },
);

GooglePickerNonceSchema.index({ nonce_hash: 1 }, { unique: true });
GooglePickerNonceSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export type GooglePickerNonceDocument =
  InferSchemaType<typeof GooglePickerNonceSchema> & {
    _id: mongoose.Types.ObjectId;
  };

export const GooglePickerNonce: Model<GooglePickerNonceDocument> =
  mongoose.models.GooglePickerNonce ??
  mongoose.model<GooglePickerNonceDocument>(
    "GooglePickerNonce",
    GooglePickerNonceSchema,
  );
