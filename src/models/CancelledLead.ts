import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  aggregateRevisionSchemaFields,
  applyAggregateRevisionGuards,
} from "./granotLifecycleSchemas";
import { leadModelField, sheetSyncSchema, type SheetSyncEntry } from "./schemaHelpers";

const CANCELLATION_CORRELATION_SNAPSHOT_PATHS = [
  "job_no_snapshot",
  "normalized_job_no_snapshot",
  "lead_ref_snapshot",
  "booking_created_at_snapshot",
] as const;

const cancellationLeadRefSnapshotSchema = new Schema(
  {
    model: { type: String, enum: ["FormLead", "CallLead"], required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const CancelledLeadSchema = new Schema(
  {
    timestamp: { type: Date, required: true, default: Date.now },
    booked_lead: { type: Schema.Types.ObjectId, ref: "BookedLead", required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
    lead_ref: { type: Schema.Types.ObjectId, refPath: "lead_model", index: true },
    lead_model: { ...leadModelField, required: false },
    reason: { type: String, trim: true },
    notes: { type: String, trim: true },
    cancelled_by: { type: String, trim: true },
    cancel_date: { type: Date, required: true },
    agent: { type: String, trim: true },
    book_date: { type: Date },
    job_no: { type: String, trim: true },
    job_no_snapshot: { type: String, trim: true, default: null },
    normalized_job_no_snapshot: { type: String, trim: true, default: null },
    lead_ref_snapshot: { type: cancellationLeadRefSnapshotSchema, default: null },
    booking_created_at_snapshot: { type: Date, default: null },
    customer_name: { type: String, trim: true },
    refund_amount: { type: Number, required: true },
    merchant: { type: String, trim: true },
    source: { type: String, trim: true },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
    ...aggregateRevisionSchemaFields,
  },
  {
    collection: "cancelled_leads",
    autoIndex: false,
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export const CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX = {
  name: "cancelled_lead_normalized_job_no_snapshot",
  key: { normalized_job_no_snapshot: 1 },
  unique: false as const,
  partialFilterExpression: {
    normalized_job_no_snapshot: { $type: "string" },
  },
} as const;

CancelledLeadSchema.index(CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX.key, {
  name: CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX.name,
  unique: false,
  partialFilterExpression: CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX.partialFilterExpression,
});

applyAggregateRevisionGuards(CancelledLeadSchema);

CancelledLeadSchema.pre("validate", function rejectImmutableCorrelationSnapshots() {
  if (this.isNew) return;
  for (const path of CANCELLATION_CORRELATION_SNAPSHOT_PATHS) {
    if (this.isModified(path)) {
      this.invalidate(path, `${path} is immutable after insert`);
    }
  }
});

export type CancelledLeadDocument = InferSchemaType<typeof CancelledLeadSchema> & {
  _id: mongoose.Types.ObjectId;
  sheet_sync: SheetSyncEntry[];
};

export const CancelledLead: Model<CancelledLeadDocument> =
  mongoose.models.CancelledLead ??
  mongoose.model<CancelledLeadDocument>("CancelledLead", CancelledLeadSchema);
