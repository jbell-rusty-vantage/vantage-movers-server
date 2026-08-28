import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";

export const WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION =
  "wordpress_form_submission_receipts";
export const WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME =
  "WordpressFormSubmissionReceipt";

export const WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES = [
  {
    name: "wordpress_form_submission_receipt_submission_key_unique",
    key: { submission_key: 1 },
    unique: true as const,
  },
  {
    name: "wordpress_form_submission_receipt_lead_ref",
    key: { "lead_ref.id": 1 },
    unique: false as const,
    partialFilterExpression: {
      "lead_ref.id": { $type: "objectId" },
    },
  },
] as const;

const IMMUTABLE_PATHS = [
  "source_system",
  "submission_key",
  "received_at",
  "form_path",
] as const;

const leadRefSchema = new Schema(
  {
    model: { type: String, enum: ["FormLead"], required: true },
    id: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const WordpressFormSubmissionReceiptSchema = new Schema(
  {
    source_system: {
      type: String,
      required: true,
      enum: ["wordpress"],
      default: "wordpress",
    },
    submission_key: { type: String, required: true, trim: true },
    received_at: { type: Date, required: true },
    processing_status: {
      type: String,
      required: true,
      enum: ["received", "lead_created"],
      default: "received",
    },
    lead_ref: { type: leadRefSchema, default: null },
    form_path: { type: String, required: true, enum: ["test"], default: "test" },
  },
  {
    collection: WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION,
    autoIndex: false,
    timestamps: true,
    strict: true,
  },
);

for (const index of WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES) {
  const options: Record<string, unknown> = {
    name: index.name,
    unique: index.unique,
  };
  if ("partialFilterExpression" in index) {
    options.partialFilterExpression = index.partialFilterExpression;
  }
  WordpressFormSubmissionReceiptSchema.index(index.key, options);
}

WordpressFormSubmissionReceiptSchema.pre("validate", function rejectImmutableReceiptFields() {
  if (this.isNew) return;
  for (const path of IMMUTABLE_PATHS) {
    if (this.isModified(path)) {
      this.invalidate(path, `${path} is immutable after insert`);
    }
  }
  if (this.isModified("lead_ref") && this.get("lead_ref") == null) {
    this.invalidate("lead_ref", "lead_ref is write-once");
  }
});

export type WordpressFormSubmissionReceiptDocument =
  InferSchemaType<typeof WordpressFormSubmissionReceiptSchema> & {
    _id: mongoose.Types.ObjectId;
  };

export const WordpressFormSubmissionReceipt: Model<WordpressFormSubmissionReceiptDocument> =
  mongoose.models[WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME] ??
  mongoose.model<WordpressFormSubmissionReceiptDocument>(
    WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME,
    WordpressFormSubmissionReceiptSchema,
  );

export function getWordpressFormSubmissionReceiptModel(): Model<WordpressFormSubmissionReceiptDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return WordpressFormSubmissionReceipt;
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME] as
      | Model<WordpressFormSubmissionReceiptDocument>
      | undefined) ??
    db.model<WordpressFormSubmissionReceiptDocument>(
      WORDPRESS_FORM_SUBMISSION_RECEIPT_MODEL_NAME,
      WordpressFormSubmissionReceiptSchema,
    )
  );
}
