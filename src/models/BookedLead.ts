import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  leadModelField,
  optionalLocalField,
  sheetSyncSchema,
  type SheetSyncEntry,
} from "./schemaHelpers";

const AgentAllocationSchema = new Schema(
  {
    agent: { type: Schema.Types.ObjectId, ref: "Agent", required: true, index: true },
    agent_name_snapshot: { type: String, required: true, trim: true },
    binder_amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const BookedLeadSchema = new Schema(
  {
    timestamp: { type: Date, required: true, default: Date.now },
    book_date: { type: Date, required: true },
    job_no: { type: String, trim: true },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      index: true,
    },
    lead_ref: {
      type: Schema.Types.ObjectId,
      refPath: "lead_model",
      index: true,
    },
    lead_model: { ...leadModelField, required: false },
    customer_name: { type: String, trim: true },
    agent_allocations: {
      type: [AgentAllocationSchema],
      required: true,
      validate: {
        validator(value: unknown[]) {
          return Array.isArray(value) && value.length > 0;
        },
        message: "At least one agent allocation is required",
      },
    },
    total_binder_amount: { type: Number, required: true, min: 0 },
    deposit_amount: { type: Number, required: true },
    merchant: { type: String, required: true, trim: true },
    source: { type: String, required: true, trim: true },
    is_referral_booking: { type: Boolean, required: true, default: false, index: true },
    is_leadless_booking: { type: Boolean, required: true, default: false, index: true },
    submission_id: { type: String, trim: true, index: true },
    local: optionalLocalField,
    over_2000: { type: Boolean, required: true, default: false },
    over_4000: { type: Boolean, required: true, default: false },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
  },
  {
    collection: "booked_leads",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

BookedLeadSchema.index({ lead_ref: 1, lead_model: 1 });
BookedLeadSchema.index({ job_no: 1 });

BookedLeadSchema.pre("validate", function () {
  if (this.is_referral_booking !== true && this.is_leadless_booking !== true) {
    if (!this.lead_ref) {
      this.invalidate(
        "lead_ref",
        "lead_ref is required unless this is a referral or leadless booking",
      );
    }
    if (!this.lead_model) {
      this.invalidate(
        "lead_model",
        "lead_model is required unless this is a referral or leadless booking",
      );
    }
  }
});

BookedLeadSchema.virtual("agent").get(function () {
  return this.agent_allocations?.[0]?.agent_name_snapshot ?? "";
});

BookedLeadSchema.virtual("binder_amount").get(function () {
  return this.total_binder_amount;
});

BookedLeadSchema.virtual("customer_name_snapshot").get(function () {
  return this.customer_name ?? "";
});

export type BookedLeadDocument = InferSchemaType<typeof BookedLeadSchema> & {
  _id: mongoose.Types.ObjectId;
  sheet_sync: SheetSyncEntry[];
};

export const BookedLead: Model<BookedLeadDocument> =
  mongoose.models.BookedLead ??
  mongoose.model<BookedLeadDocument>("BookedLead", BookedLeadSchema);
