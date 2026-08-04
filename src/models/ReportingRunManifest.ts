import mongoose, { Schema, type Model } from "mongoose";

/**
 * Persisted candidate-manifest metadata for a reporting run.
 * Never stores row payloads — only IDs, versions, fingerprints, and page maps.
 */
const ReportingRunManifestSchema = new Schema<Record<string, any>>(
  {
    run_id: {
      type: Schema.Types.ObjectId,
      ref: "ReportingRun",
      required: true,
      unique: true,
    },
    version: { type: Number, required: true, enum: [1], default: 1 },
    source_read_through: { type: Date, required: true },
    manifest_captured_at: { type: Date, required: true },
    snapshot_token: { type: Schema.Types.Mixed, required: true },
    entries: {
      type: [
        {
          model: { type: String, required: true },
          id: { type: String, required: true },
          version: { type: String, required: true },
          fingerprint: { type: String, required: true },
        },
      ],
      required: true,
      default: [],
    },
    output_pages: {
      type: [
        {
          pageNumber: { type: Number, required: true },
          afterCursor: { type: String, default: null },
          nextCursor: { type: String, default: null },
          dependencyKeys: { type: [String], required: true, default: [] },
        },
      ],
      required: true,
      default: [],
    },
    checksum: { type: String, required: true },
    expires_at: { type: Date, required: true },
  },
  {
    collection: "reporting_run_manifests",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

ReportingRunManifestSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
ReportingRunManifestSchema.index({ run_id: 1 }, { unique: true });
ReportingRunManifestSchema.index({ checksum: 1 });

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
  ReportingRunManifestSchema.pre(operation, function forbidManifestMutation() {
    throw new Error(
      "ReportingRunManifest mutations require the narrow Stage 4 repository.",
    );
  });
}
ReportingRunManifestSchema.pre("save", function forbidSavedManifestMutation() {
  if (!this.isNew) {
    throw new Error(
      "ReportingRunManifest mutations require the narrow Stage 4 repository.",
    );
  }
});

export type ReportingRunManifestDocument = mongoose.Document &
  Record<string, any>;
export const ReportingRunManifest: Model<any> =
  mongoose.models.ReportingRunManifest ??
  mongoose.model("ReportingRunManifest", ReportingRunManifestSchema);
