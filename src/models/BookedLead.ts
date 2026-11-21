import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import {
  aggregateRevisionSchemaFields,
  applyAggregateRevisionGuards,
} from "./granotLifecycleSchemas";
import {
  leadModelField,
  optionalLocalField,
  sheetSyncSchema,
  type SheetSyncEntry,
} from "./schemaHelpers";
import { normalizeJobNo } from "../services/bookings/bookingIdentity";
import {
  bookingJobNumberWriteOrigin,
  checkBookingJobNumber,
  type BookingJobNumberWritePath,
} from "../services/bookings/bookingJobNumberGuard";

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
    normalized_job_no: { type: String, trim: true },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      index: true,
    },
    // lead_ref_1 retired 2026-11-20: { lead_ref, lead_model } serves lead_ref reads.
    lead_ref: {
      type: Schema.Types.ObjectId,
      refPath: "lead_model",
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
    booking_origin: {
      type: String,
      enum: ["employee_booking", "owner_booking"],
      index: true,
    },
    is_referral_booking: { type: Boolean, required: true, default: false, index: true },
    is_leadless_booking: { type: Boolean, required: true, default: false, index: true },
    submission_id: { type: String, trim: true },
    employee_source_snapshot: {
      lead_source_company: { type: Schema.Types.ObjectId, ref: "LeadSourceCompany" },
      source_granularity_id: { type: Schema.Types.ObjectId },
      source_granularity_key: { type: String, trim: true, lowercase: true },
      source_company: { type: String, trim: true },
      source_company_label_snapshot: { type: String, trim: true },
      source_granularity_label_snapshot: { type: String, trim: true },
      crm_source_label_snapshot: { type: String, trim: true },
      channel: { type: String, enum: ["form", "call"] },
    },
    auto_match: {
      rule: {
        type: String,
        enum: [
          "call_job_no_exact",
          "form_job_no_exact",
          "form_lid_exact",
          "form_contact_triple_exact",
          "form_email_phone_exact",
          "channel_phone_exact",
        ],
      },
      policy_version: { type: String, trim: true },
      enabled_rules_snapshot: { type: [String], default: [] },
      attached_at: { type: Date },
    },
    local: optionalLocalField,
    over_2000: { type: Boolean, required: true, default: false },
    over_4000: { type: Boolean, required: true, default: false },
    cancelled: { type: Schema.Types.ObjectId, ref: "CancelledLead" },
    sheet_sync: { type: [sheetSyncSchema], default: [] },
    ...aggregateRevisionSchemaFields,
  },
  {
    collection: "booked_leads",
    autoIndex: false,
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

BookedLeadSchema.index({ lead_ref: 1, lead_model: 1 });
BookedLeadSchema.index({ job_no: 1 });
BookedLeadSchema.index(
  { submission_id: 1 },
  {
    unique: true,
    name: "employee_submission_id_unique",
    partialFilterExpression: {
      booking_origin: "employee_booking",
      submission_id: { $type: "string" },
    },
  },
);
export const BOOKED_LEAD_NORMALIZED_JOB_INDEX = {
  name: "booked_lead_normalized_job_no_unique",
  key: { normalized_job_no: 1 },
  unique: true as const,
  partialFilterExpression: {
    normalized_job_no: { $type: "string" },
  },
  accepted_names: ["booked_lead_normalized_job_no_unique", "normalized_job_no_1"],
} as const;

BookedLeadSchema.index(BOOKED_LEAD_NORMALIZED_JOB_INDEX.key, {
  unique: true,
  name: BOOKED_LEAD_NORMALIZED_JOB_INDEX.name,
  partialFilterExpression: BOOKED_LEAD_NORMALIZED_JOB_INDEX.partialFilterExpression,
});

applyAggregateRevisionGuards(BookedLeadSchema);

BookedLeadSchema.pre("validate", function () {
  this.normalized_job_no = normalizeJobNo(this.job_no);
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

/**
 * Job Number rule on every Mongoose Booking write (all create, update and reconciliation paths save
 * a document). A new Booking or a changed `job_no` is checked; an untouched legacy value is not, so
 * unrelated edits, cancellation and deletion of an old record keep working. The write origin comes
 * from the document's `$locals` (`markGranotLifecycleBookingWrite`), never from its field values.
 */
BookedLeadSchema.pre("validate", async function checkJobNumber() {
  if (!this.isNew && !this.isModified("job_no")) return;
  const writePath: BookingJobNumberWritePath = !this.isNew
    ? "update_booking"
    : this.get("booking_origin") === "employee_booking"
      ? "create_employee_booking"
      : this.is_referral_booking === true
        ? "create_referral_booking"
        : this.is_leadless_booking === true
          ? "create_leadless_booking"
          : "create_lead_booking";
  await checkBookingJobNumber({
    connection: this.db,
    session: this.$session(),
    booking_id: this._id,
    job_no: this.job_no,
    write_path: writePath,
    write_origin: bookingJobNumberWriteOrigin(this.$locals),
  });
});

/** The Booking a query targets, for the would-reject record: only a single ObjectId or 24-hex `_id`. */
function queryBookingId(filter: unknown): string | null {
  const id = (filter as { _id?: unknown } | null)?._id;
  if (id instanceof mongoose.Types.ObjectId) return id.toHexString();
  return typeof id === "string" && /^[0-9a-f]{24}$/i.test(id) ? id.toLowerCase() : null;
}

/**
 * Query writes get the same check. An update that sets `job_no` (`$set`, `$setOnInsert` or a
 * top-level key) or unsets it is checked and its `normalized_job_no` rewritten in step; a
 * replacement is checked as a whole document. `$rename` of `job_no` and aggregation-pipeline
 * updates cannot be checked reliably, so they are refused outright (no code path uses them).
 * Query writes are always the `standard` origin: no Granot lifecycle path writes `job_no` by query
 * (its raw `collection.updateOne` writes never set it; `bookingJobNumberWriters.test.ts` proves it).
 */
BookedLeadSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], async function checkJobNumberUpdate() {
  const update = this.getUpdate() as Record<string, unknown> | unknown[] | null;
  if (!update) return;
  if (Array.isArray(update)) {
    throw new Error("BookedLead pipeline updates are not supported: they bypass the Job Number rule.");
  }
  const rename = update.$rename as Record<string, unknown> | undefined;
  if (rename && (Object.hasOwn(rename, "job_no") || Object.values(rename).includes("job_no"))) {
    throw new Error("BookedLead $rename of job_no is not supported: it bypasses the Job Number rule.");
  }
  const operators = ["$set", "$setOnInsert"]
    .map((op) => update[op] as Record<string, unknown> | undefined)
    .filter((target): target is Record<string, unknown> => Boolean(target) && Object.hasOwn(target!, "job_no"));
  const unset = update.$unset as Record<string, unknown> | undefined;
  const unsetsJob = Boolean(unset && Object.hasOwn(unset, "job_no"));
  const top = Object.hasOwn(update, "job_no");
  if (!operators.length && !unsetsJob && !top) return;
  const written = [...operators.map((target) => target.job_no), ...(top ? [update.job_no] : []), ...(unsetsJob ? [undefined] : [])];
  for (const jobNo of written) {
    await checkBookingJobNumber({
      connection: this.model.db,
      session: this.getOptions().session ?? null,
      booking_id: queryBookingId(this.getFilter()),
      job_no: jobNo,
      write_path: "update_query",
    });
  }
  const normalizedOf = (value: unknown) => normalizeJobNo(typeof value === "string" ? value : null) ?? null;
  for (const target of operators) target.normalized_job_no = normalizedOf(target.job_no);
  if (top) update.normalized_job_no = normalizedOf(update.job_no);
  if (unsetsJob) unset!.normalized_job_no = "";
});

BookedLeadSchema.pre(["replaceOne", "findOneAndReplace"], async function checkJobNumberReplacement() {
  const replacement = this.getUpdate() as Record<string, unknown> | null;
  if (!replacement) return;
  await checkBookingJobNumber({
    connection: this.model.db,
    session: this.getOptions().session ?? null,
    booking_id: queryBookingId(this.getFilter()),
    job_no: replacement.job_no,
    write_path: "update_query",
  });
  replacement.normalized_job_no = normalizeJobNo(typeof replacement.job_no === "string" ? replacement.job_no : null) ?? null;
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
