import mongoose, { Schema, type Model } from "mongoose";

const ArtifactSchema = new Schema(
  {
    id: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const ManagedTabSchema = new Schema(
  {
    immutable_sheet_id: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    ownership_marker_version: { type: Number, required: true, default: 1 },
    /** Sheet IDs previously published via verified Vantage replace_tab CAS. */
    predecessor_sheet_ids: { type: [Number], default: [] },
  },
  { _id: false },
);

const OwnerIdentitySchema = new Schema(
  {
    stable_owner_id: { type: String, required: true, trim: true },
    masked_email: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const CapacitySchema = new Schema(
  {
    provider_max_cells: { type: Number, required: true },
    destination_available_cells: { type: Number, required: true },
  },
  { _id: false },
);

const ReportingDestinationSchema = new Schema<Record<string, unknown>>(
  {
    provider: {
      type: String,
      required: true,
      enum: ["google_sheets"],
      default: "google_sheets",
    },
    drive_connection_id: {
      type: Schema.Types.ObjectId,
      ref: "GoogleDriveConnection",
      required: true,
    },
    owner_identity_snapshot: {
      type: OwnerIdentitySchema,
      required: true,
    },
    folder: { type: ArtifactSchema, required: true },
    strategy: {
      type: String,
      required: true,
      enum: ["replace_tab", "snapshot"],
    },
    workbook: { type: ArtifactSchema, default: null },
    managed_tab: { type: ManagedTabSchema, default: null },
    destination_type: {
      type: String,
      required: true,
      default: "owner_drive",
    },
    ownership_policy: {
      type: String,
      required: true,
      default: "vantage_managed_tab",
    },
    access_status: {
      type: String,
      required: true,
      enum: ["verified", "unverified", "unhealthy"],
      default: "unverified",
    },
    health_verified_at: { type: Date, default: null },
    denylist_checked_at: { type: Date, default: null },
    capacity: { type: CapacitySchema, required: true },
    state: {
      type: String,
      required: true,
      enum: ["active", "archived"],
      default: "active",
    },
    version: { type: Number, required: true, default: 1, min: 1 },
    mutation_pending: { type: Schema.Types.Mixed, default: null },
    created_by: { type: Schema.Types.Mixed, required: true },
    updated_by: { type: Schema.Types.Mixed, required: true },
  },
  {
    collection: "reporting_destinations",
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

ReportingDestinationSchema.index({ state: 1, updated_at: -1, _id: 1 });
ReportingDestinationSchema.index({ "workbook.id": 1, state: 1 });

export type ReportingDestinationDocument = mongoose.Document &
  Record<string, unknown>;

export const ReportingDestination: Model<ReportingDestinationDocument> =
  mongoose.models.ReportingDestination ??
  mongoose.model("ReportingDestination", ReportingDestinationSchema);
