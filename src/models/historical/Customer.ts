import mongoose, { Schema, type Connection, type InferSchemaType, type Model } from "mongoose";

export const HistoricalCustomerSchema = new Schema(
  {
    full_name: { type: String, trim: true },
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

HistoricalCustomerSchema.virtual("booked_leads", {
  ref: "BookedLead",
  localField: "_id",
  foreignField: "customer",
});

HistoricalCustomerSchema.virtual("cancelled_leads", {
  ref: "CancelledLead",
  localField: "_id",
  foreignField: "customer",
});

export type HistoricalCustomerDocument = InferSchemaType<typeof HistoricalCustomerSchema> & {
  _id: mongoose.Types.ObjectId;
};

export function registerHistoricalCustomer(
  connection: Connection,
): Model<HistoricalCustomerDocument> {
  return (
    connection.models.Customer ??
    connection.model<HistoricalCustomerDocument>("Customer", HistoricalCustomerSchema)
  );
}
