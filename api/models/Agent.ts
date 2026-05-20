import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const AgentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    normalized_name: { type: String, required: true, trim: true, lowercase: true, unique: true },
    active: { type: Boolean, required: true, default: true },
    role: { type: String, required: true, trim: true, default: "agent" },
    created_from: { type: String, required: true, trim: true, default: "booked_lead" },
  },
  {
    collection: "agents",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

AgentSchema.index({ normalized_name: 1 }, { unique: true });

export type AgentDocument = InferSchemaType<typeof AgentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Agent: Model<AgentDocument> =
  mongoose.models.Agent ?? mongoose.model<AgentDocument>("Agent", AgentSchema);
