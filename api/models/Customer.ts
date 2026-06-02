import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const CustomerSchema = new Schema(
  {
    full_name: { type: String, required: true, trim: true },
    normalized_name: { type: String, trim: true, lowercase: true, index: true },
    phone_number: { type: String, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, index: true },
  },
  {
    collection: "customers",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

CustomerSchema.virtual("booked_leads", {
  ref: "BookedLead",
  localField: "_id",
  foreignField: "customer",
});

CustomerSchema.virtual("cancelled_leads", {
  ref: "CancelledLead",
  localField: "_id",
  foreignField: "customer",
});

export type CustomerDocument = InferSchemaType<typeof CustomerSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Customer: Model<CustomerDocument> =
  mongoose.models.Customer ??
  mongoose.model<CustomerDocument>("Customer", CustomerSchema);
