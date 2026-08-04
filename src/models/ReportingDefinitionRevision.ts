import mongoose, { Schema, type Model } from "mongoose";

const ReportingDefinitionRevisionSchema = new Schema<Record<string, any>>(
  {
    definition_id: { type: Schema.Types.ObjectId, ref: "ReportingDefinition", required: true },
    revision_number: { type: Number, required: true, min: 1 },
    dataset_key: { type: String, required: true },
    dataset_schema_version: { type: Number, required: true, enum: [1] },
    date_window_spec: { type: Schema.Types.Mixed, required: true },
    resolved_window: { type: Schema.Types.Mixed, required: true },
    registry_snapshot: { type: Schema.Types.Mixed, required: true },
    filters: { type: Schema.Types.Mixed, required: true },
    selected_columns: { type: [Schema.Types.Mixed], required: true },
    effective_sort: { type: [Schema.Types.Mixed], required: true },
    timezone: { type: String, required: true },
    destination_id: { type: String, required: true },
    destination_snapshot: { type: Schema.Types.Mixed, required: true },
    destination_snapshot_checksum: { type: String, required: true },
    strategy: { type: String, required: true, enum: ["replace_tab", "snapshot"] },
    preview_id: { type: Schema.Types.ObjectId, ref: "ReportingPreview", required: true },
    preview_checksum: { type: String, required: true },
    sample_count: { type: Number, required: true, min: 0, max: 50 },
    sample_evidence: { type: String, required: true },
    draft_checksum: { type: String, required: true },
    warnings: { type: [Schema.Types.Mixed], default: [] },
    estimate: { type: Schema.Types.Mixed, required: true },
    revision_snapshot_checksum: { type: String, required: true },
    created_by: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: "reporting_definition_revisions",
    timestamps: { createdAt: "created_at", updatedAt: false },
  },
);

ReportingDefinitionRevisionSchema.index({ definition_id: 1, revision_number: 1 }, { unique: true });
ReportingDefinitionRevisionSchema.index({ definition_id: 1, created_at: -1 });
ReportingDefinitionRevisionSchema.index({ dataset_key: 1, dataset_schema_version: 1 });
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
  ReportingDefinitionRevisionSchema.pre(operation, function immutableRevision() {
    throw new Error("ReportingDefinitionRevision is immutable.");
  });
}
ReportingDefinitionRevisionSchema.pre("save", function immutableSavedRevision() {
  if (!this.isNew) throw new Error("ReportingDefinitionRevision is immutable.");
});
(ReportingDefinitionRevisionSchema as any).pre(
  "bulkWrite",
  function immutableRevisionBulkWrite(
    next: (error?: Error) => void,
    operations: Array<Record<string, unknown>>,
  ) {
    try {
      assertRevisionBulkWriteIsInsertOnly(operations);
      next();
    } catch (error) {
      next(error as Error);
    }
  },
);

export function assertRevisionBulkWriteIsInsertOnly(
  operations: Array<Record<string, unknown>>,
): void {
  if (
    operations.some(
      (operation) =>
        !("insertOne" in operation),
    )
  ) {
    throw new Error("ReportingDefinitionRevision is immutable.");
  }
}

export type ReportingDefinitionRevisionDocument = mongoose.Document & Record<string, any>;
export const ReportingDefinitionRevision: Model<any> =
  mongoose.models.ReportingDefinitionRevision ??
  mongoose.model("ReportingDefinitionRevision", ReportingDefinitionRevisionSchema);
