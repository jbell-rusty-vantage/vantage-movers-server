import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const GoogleOAuthStateSchema = new Schema(
  {
    nonce_hash: { type: String, required: true },
    owner_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    expires_at: { type: Date, required: true },
  },
  {
    collection: "google_oauth_states",
    timestamps: { createdAt: "created_at", updatedAt: false },
    versionKey: false,
  },
);

GoogleOAuthStateSchema.index({ nonce_hash: 1 }, { unique: true });
GoogleOAuthStateSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export type GoogleOAuthStateDocument =
  InferSchemaType<typeof GoogleOAuthStateSchema> & {
    _id: mongoose.Types.ObjectId;
  };

export const GoogleOAuthState: Model<GoogleOAuthStateDocument> =
  mongoose.models.GoogleOAuthState ??
  mongoose.model<GoogleOAuthStateDocument>(
    "GoogleOAuthState",
    GoogleOAuthStateSchema,
  );
