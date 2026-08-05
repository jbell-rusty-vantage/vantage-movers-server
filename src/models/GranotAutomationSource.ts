import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

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
    created_from: {
      type: String,
      required: true,
      enum: ["seed", "admin"],
    },
    created_by: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    collection: "granot_automation_sources",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

GranotAutomationSourceSchema.index(
  { active: 1, label: 1 },
  { name: "granot_automation_source_active_label" },
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
