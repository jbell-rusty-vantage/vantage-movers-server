import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const GooglePickerSelectionSchema = new Schema(
  {
    reference_hash: { type: String, required: true },
    owner_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    flow: {
      type: String,
      required: true,
      enum: ["folder", "spreadsheet"],
    },
    file_id: { type: String, required: true, trim: true },
    mime_type: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    parent_folder_id: { type: String, trim: true },
    expires_at: { type: Date, required: true },
    consumed_at: { type: Date, default: null },
  },
  {
    collection: "google_picker_selections",
    timestamps: { createdAt: "created_at", updatedAt: false },
    versionKey: false,
  },
);

GooglePickerSelectionSchema.index({ reference_hash: 1 }, { unique: true });
GooglePickerSelectionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

export type GooglePickerSelectionDocument =
  InferSchemaType<typeof GooglePickerSelectionSchema> & {
    _id: mongoose.Types.ObjectId;
  };

export const GooglePickerSelection: Model<GooglePickerSelectionDocument> =
  mongoose.models.GooglePickerSelection ??
  mongoose.model<GooglePickerSelectionDocument>(
    "GooglePickerSelection",
    GooglePickerSelectionSchema,
  );
