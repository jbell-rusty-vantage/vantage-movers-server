import mongoose, { Schema, type Model } from "mongoose";

const ReportingDeliverySchema = new Schema<Record<string, any>>(
  {
    run_id: {
      type: Schema.Types.ObjectId,
      ref: "ReportingRun",
      required: true,
      unique: true,
    },
    definition_id: {
      type: Schema.Types.ObjectId,
      ref: "ReportingDefinition",
      required: true,
    },
    definition_revision_id: {
      type: Schema.Types.ObjectId,
      ref: "ReportingDefinitionRevision",
      required: true,
    },
    destination_id: { type: String, required: true },
    strategy: {
      type: String,
      required: true,
      enum: ["replace_tab", "snapshot"],
    },
    status: {
      type: String,
      required: true,
      enum: [
        "pending",
        "writing",
        "verifying",
        "promoting",
        "completed",
        "failed",
        "cancelled",
      ],
      default: "pending",
    },
    workbook_id: { type: String, default: null },
    workbook_url: { type: String, default: null },
    staging_sheet_id: { type: Number, default: null },
    staging_sheet_title: { type: String, default: null },
    published_sheet_id: { type: Number, default: null },
    published_sheet_title: { type: String, default: null },
    old_sheet_id: { type: Number, default: null },
    old_sheet_recovery_title: { type: String, default: null },
    expected: {
      rows: { type: Number, default: null },
      columns: { type: Number, default: null },
      cells_including_header: { type: Number, default: null },
      header_labels: { type: [String], default: [] },
      data_checksum: { type: String, default: null },
    },
    actual: {
      rows: { type: Number, default: null },
      columns: { type: Number, default: null },
      cells_including_header: { type: Number, default: null },
      header_labels: { type: [String], default: [] },
      data_checksum: { type: String, default: null },
    },
    verification: {
      matched: { type: Boolean, default: null },
      checked_at: { type: Date, default: null },
      reasons: { type: [String], default: [] },
    },
    progress: {
      next_write_row: { type: Number, default: 1 },
      completed_batch_number: { type: Number, default: 0 },
      rows_written: { type: Number, default: 0 },
      cells_written: { type: Number, default: 0 },
      provider_requests: { type: Number, default: 0 },
      provider_retries: { type: Number, default: 0 },
      last_acknowledged_range: { type: String, default: null },
      last_stream_checkpoint: { type: Schema.Types.Mixed, default: null },
      promotion_step: {
        type: String,
        enum: [
          "not_started",
          "rename_batch_submitted",
          "verified_published",
          "destination_updated",
          "old_tab_retained",
          "ambiguous",
        ],
        default: "not_started",
      },
    },
    cleanup: {
      state: {
        type: String,
        enum: ["not_needed", "pending", "completed", "failed"],
        default: "not_needed",
      },
      artifact_ids: { type: [String], default: [] },
      attempts: { type: Number, default: 0 },
      last_error_code: { type: String, default: null },
      updated_at: { type: Date, default: null },
    },
    failure: { type: Schema.Types.Mixed, default: null },
    /** Bound on worker claim/takeover; every delivery update is fenced by this. */
    fence_owner: { type: String, default: null },
    fence_epoch: { type: Number, default: null },
    /** Matches ReportingRun.delivery_fence_generation from atomic bind TX. */
    fence_generation: { type: Number, default: null },
    completed_at: { type: Date, default: null },
  },
  {
    collection: "reporting_deliveries",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

ReportingDeliverySchema.index({ run_id: 1 }, { unique: true });
ReportingDeliverySchema.index({ status: 1, updated_at: 1 });
ReportingDeliverySchema.index({ "cleanup.state": 1, updated_at: 1 });
ReportingDeliverySchema.index({ destination_id: 1, created_at: -1 });
ReportingDeliverySchema.index({ workbook_id: 1 }, { sparse: true });

export type ReportingDeliveryDocument = mongoose.Document & Record<string, any>;
export const ReportingDelivery: Model<any> =
  mongoose.models.ReportingDelivery ??
  mongoose.model("ReportingDelivery", ReportingDeliverySchema);
