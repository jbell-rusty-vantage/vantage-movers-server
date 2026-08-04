import mongoose, { Schema, type Model } from "mongoose";

const ReportingRunConfirmationSchema = new Schema<Record<string, any>>(
  {
    confirmation_id: { type: String, required: true, unique: true },
    definition_id: { type: Schema.Types.ObjectId, ref: "ReportingDefinition", required: true },
    revision_id: { type: Schema.Types.ObjectId, ref: "ReportingDefinitionRevision", required: true },
    actor_id: { type: String, required: true },
    actor_fingerprint: { type: String, required: true },
    idempotency_key: { type: String, required: true },
    immutable_fingerprint: { type: String, required: true },
    confirmation_snapshot: { type: Schema.Types.Mixed, required: true },
    consumed_at: { type: Date, default: null },
    consumed_run_id: { type: Schema.Types.ObjectId, ref: "ReportingRun", default: null },
    expires_at: { type: Date, required: true },
  },
  {
    collection: "reporting_run_confirmations",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

ReportingRunConfirmationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
ReportingRunConfirmationSchema.index(
  { actor_id: 1, revision_id: 1, idempotency_key: 1 },
  { unique: true, name: "reporting_confirmation_idempotency" },
);

export const ReportingRunConfirmation: Model<any> =
  mongoose.models.ReportingRunConfirmation ??
  mongoose.model("ReportingRunConfirmation", ReportingRunConfirmationSchema);
