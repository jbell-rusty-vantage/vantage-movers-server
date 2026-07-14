import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const MovingCarrierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    normalized_name: { type: String, required: true, trim: true, lowercase: true, index: true },
    dot_number: { type: String, required: true, trim: true, unique: true },
    mc_number: { type: String, required: true, trim: true, unique: true },
    active: { type: Boolean, required: true, default: true, index: true },
    created_from: { type: String, required: true, trim: true, default: "admin" },
  },
  {
    collection: "moving_carriers",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

MovingCarrierSchema.index({ dot_number: 1, mc_number: 1 }, { unique: true });
MovingCarrierSchema.index({ active: 1, name: 1 });

export type MovingCarrierDocument = InferSchemaType<typeof MovingCarrierSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const MovingCarrier: Model<MovingCarrierDocument> =
  mongoose.models.MovingCarrier ??
  mongoose.model<MovingCarrierDocument>("MovingCarrier", MovingCarrierSchema);
