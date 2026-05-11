import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const MOVE_SIZES = [
  "Studio",
  "2 Bedrooms",
  "3 Bedrooms",
  "4 Bedrooms",
  "5+ Bedrooms",
  "Office",
] as const;

const SHEET_SYNC_STATUSES = ["pending", "synced", "failed"] as const;

const LeadSchema = new Schema(
  {
    leadId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    pickupZip: {
      type: String,
      required: true,
      trim: true,
    },
    destinationZip: {
      type: String,
      required: true,
      trim: true,
    },
    moveSize: {
      type: String,
      required: true,
      enum: MOVE_SIZES,
    },
    moveDate: {
      type: Date,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    refNo: {
      type: String,
      required: true,
      default: "not provided",
      trim: true,
    },
    booked: {
      type: Boolean,
      required: true,
      default: false,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    sourceCompanySite: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    sourceCompanyLabel: {
      type: String,
      required: true,
      trim: true,
    },
    cancelled: {
      type: Boolean,
      required: true,
      default: false,
    },
    sheetSyncStatus: {
      type: String,
      required: true,
      enum: SHEET_SYNC_STATUSES,
      default: "pending",
      index: true,
    },
    sheetSyncedAt: {
      type: Date,
    },
    sheetSyncError: {
      type: String,
    },
    mainSheetRowNumber: {
      type: Number,
    },
    companySheetName: {
      type: String,
    },
    companySheetRowNumber: {
      type: Number,
    },
    updatedSinceLastSheetSync: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export type LeadDocument = InferSchemaType<typeof LeadSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Lead: Model<LeadDocument> =
  mongoose.models.Lead ?? mongoose.model<LeadDocument>("Lead", LeadSchema);
