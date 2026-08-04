import mongoose, { Schema, type Model } from "mongoose";
import { durableRunControlFields } from "../services/durableWork";

const { failure: _durableFailure, ...reportingRunControlFields } =
  durableRunControlFields();

const ReportingRunSchema = new Schema<Record<string, any>>(
  {
    definition_id: { type: Schema.Types.ObjectId, ref: "ReportingDefinition", required: true },
    definition_revision_id: { type: Schema.Types.ObjectId, ref: "ReportingDefinitionRevision", required: true },
    revision_snapshot: { type: Schema.Types.Mixed, required: true },
    revision_snapshot_checksum: { type: String, required: true },
    query_input: { type: Schema.Types.Mixed, required: true },
    query_input_checksum: { type: String, required: true },
    query_plan_checksum: { type: String, default: null },
    trigger: { type: String, required: true, enum: ["manual"], default: "manual" },
    actor: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      required: true,
      enum: ["queued", "querying", "writing", "verifying", "promoting", "completed", "failed", "cancelled"],
      default: "queued",
    },
    source_read_through: { type: Date, default: null },
    estimate: { type: Schema.Types.Mixed, required: true },
    actual: { type: Schema.Types.Mixed, default: null },
    counters: { type: Schema.Types.Mixed, default: {} },
    checksum_accumulator: { type: String, default: null },
    final_data_checksum: { type: String, default: null },
    confirmation: { type: Schema.Types.Mixed, required: true },
    execution_package: { type: Schema.Types.Mixed, required: true },
    idempotency_key: { type: String, required: true },
    confirmation_id: { type: String, required: true, unique: true },
    immutable_fingerprint: { type: String, required: true },
    failure: { type: Schema.Types.Mixed, default: null },
    ...reportingRunControlFields,
  },
  {
    collection: "reporting_runs",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);
ReportingRunSchema.index({ definition_revision_id: 1, created_at: -1 });
ReportingRunSchema.index({ status: 1, created_at: 1 });
ReportingRunSchema.index({ leased_until: 1, status: 1 });
ReportingRunSchema.index({ created_at: -1, _id: 1 });
ReportingRunSchema.index(
  { "actor.actor_id": 1, definition_revision_id: 1, idempotency_key: 1 },
  { unique: true, name: "reporting_manual_run_idempotency" },
);
for (const operation of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  ReportingRunSchema.pre(operation, function immutableReportingRun() {
    throw new Error(
      "ReportingRun mutations require the narrow Stage 4 repository.",
    );
  });
}
ReportingRunSchema.pre("save", function immutableSavedReportingRun() {
  if (!this.isNew) {
    throw new Error(
      "ReportingRun mutations require the narrow Stage 4 repository.",
    );
  }
});
(ReportingRunSchema as any).pre(
  "bulkWrite",
  function immutableReportingRunBulkWrite(next: (error?: Error) => void) {
    next(
      new Error(
        "ReportingRun bulk mutations are forbidden; use the narrow Stage 4 repository.",
      ),
    );
  },
);

export type ReportingRunDocument = mongoose.Document & Record<string, any>;
export const ReportingRun: Model<any> =
  mongoose.models.ReportingRun ??
  mongoose.model("ReportingRun", ReportingRunSchema);
