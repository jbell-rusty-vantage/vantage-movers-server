import mongoose, { Schema, type Connection, type InferSchemaType, type Model } from "mongoose";

export const HistoricalAgentSchema = new Schema(
  {
    name: { type: String, trim: true },
    normalized_name: { type: String, trim: true, lowercase: true, index: true },
    active: { type: Boolean, default: true },
    role: { type: String, trim: true, default: "agent" },
    created_from: { type: String, trim: true, default: "booked_lead" },
  },
  {
    collection: "agents",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export type HistoricalAgentDocument = InferSchemaType<typeof HistoricalAgentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export function registerHistoricalAgent(connection: Connection): Model<HistoricalAgentDocument> {
  return (
    connection.models.Agent ??
    connection.model<HistoricalAgentDocument>("Agent", HistoricalAgentSchema)
  );
}
