import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const MerchantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    normalized_name: { type: String, required: true, trim: true, lowercase: true, unique: true },
    active: { type: Boolean, required: true, default: true },
    created_from: { type: String, required: true, trim: true, default: "admin" },
    name_aliases: { type: [String], default: [] },
    archived_at: { type: Date },
    deactivation_reason: { type: String, trim: true },
  },
  {
    collection: "merchants",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

MerchantSchema.index({ name_aliases: 1 });

export type MerchantDocument = InferSchemaType<typeof MerchantSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Merchant: Model<MerchantDocument> =
  mongoose.models.Merchant ??
  mongoose.model<MerchantDocument>("Merchant", MerchantSchema);
