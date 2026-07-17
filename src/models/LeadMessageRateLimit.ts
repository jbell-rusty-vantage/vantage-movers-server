import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain";

export type LeadMessageRateLimitDocument = {
  _id: string;
  kind: "destination" | "hourly";
  count: number;
  last_reserved_at: Date | null;
  last_decision_token: string | null;
  expires_at: Date;
  createdAt: Date;
  updatedAt: Date;
};

const LeadMessageRateLimitSchema =
  new Schema<LeadMessageRateLimitDocument>(
    {
      _id: { type: String, required: true },
      kind: {
        type: String,
        enum: ["destination", "hourly"],
        required: true,
      },
      count: { type: Number, required: true, default: 0 },
      last_reserved_at: { type: Date, default: null },
      last_decision_token: { type: String, default: null },
      expires_at: { type: Date, required: true },
    },
    {
      collection: "lead_message_rate_limits",
      timestamps: true,
    },
  );

LeadMessageRateLimitSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export const LeadMessageRateLimit: Model<LeadMessageRateLimitDocument> =
  (mongoose.models.LeadMessageRateLimit as
    | Model<LeadMessageRateLimitDocument>
    | undefined) ??
  mongoose.model<LeadMessageRateLimitDocument>(
    "LeadMessageRateLimit",
    LeadMessageRateLimitSchema,
  );

export function getLeadMessageRateLimitModel(): Model<LeadMessageRateLimitDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) return LeadMessageRateLimit;
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.LeadMessageRateLimit as
      | Model<LeadMessageRateLimitDocument>
      | undefined) ??
    db.model<LeadMessageRateLimitDocument>(
      "LeadMessageRateLimit",
      LeadMessageRateLimitSchema,
    )
  );
}
