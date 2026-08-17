import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
export const GRANOT_AUTOMATION_OPERATIONS = [
  "form_leads",
  "call_leads",
] as const;

const GranotAutomationSourceSchema = new Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      maxlength: 200,
      validate: {
        validator: (value: string) =>
          !GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN.test(value),
        message: "Granot source labels cannot contain control or bidirectional characters.",
      },
    },
    active: {
      type: Boolean,
      required: true,
      default: true,
      index: true,
    },
    supported_operations: {
      type: [String],
      enum: GRANOT_AUTOMATION_OPERATIONS,
      required: true,
      validate: {
        validator: (values: string[]) =>
          values.length >= 1 &&
          values.length <= GRANOT_AUTOMATION_OPERATIONS.length &&
          new Set(values).size === values.length,
        message:
          "Granot automation sources must support one or two unique Lead workflows.",
      },
    },
    created_from: {
      type: String,
      required: true,
      enum: ["seed", "admin"],
    },
    created_by: {
      type: Schema.Types.Mixed,
      default: null,
    },
    granot_crm_source: {
      type: Schema.Types.ObjectId,
      ref: "GranotCrmSource",
    },
  },
  {
    collection: "granot_automation_sources",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export const GRANOT_AUTOMATION_SOURCE_COLLECTION = "granot_automation_sources";

export const GRANOT_AUTOMATION_SOURCE_INDEXES = [
  {
    name: "granot_automation_source_active_label",
    key: { active: 1, label: 1 },
  },
  {
    name: "granot_automation_source_active_operation_label",
    key: { active: 1, supported_operations: 1, label: 1 },
  },
  {
    name: "granot_automation_source_crm_source_active",
    key: { granot_crm_source: 1, active: 1 },
  },
] as const;

GranotAutomationSourceSchema.index(
  { active: 1, label: 1 },
  { name: "granot_automation_source_active_label" },
);
GranotAutomationSourceSchema.index(
  { active: 1, supported_operations: 1, label: 1 },
  { name: "granot_automation_source_active_operation_label" },
);
GranotAutomationSourceSchema.index(
  { granot_crm_source: 1, active: 1 },
  { name: "granot_automation_source_crm_source_active" },
);

export type GranotAutomationSourceDocument = InferSchemaType<
  typeof GranotAutomationSourceSchema
> & { _id: mongoose.Types.ObjectId };

export const GranotAutomationSource: Model<GranotAutomationSourceDocument> =
  mongoose.models.GranotAutomationSource ??
  mongoose.model<GranotAutomationSourceDocument>(
    "GranotAutomationSource",
    GranotAutomationSourceSchema,
  );
