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

// Query-time-only reverse relationships (virtual populate, never persisted)
// from the lead side's `receiver_agent` ref. Kept as two virtuals rather than
// one unified `leads_received` because Mongoose virtual populate cannot span
// two different collections in a single virtual.
AgentSchema.virtual("form_leads_received", {
  ref: "FormLead",
  localField: "_id",
  foreignField: "receiver_agent",
});

AgentSchema.virtual("call_leads_received", {
  ref: "CallLead",
  localField: "_id",
  foreignField: "receiver_agent",
});

export type AgentDocument = InferSchemaType<typeof AgentSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Agent: Model<AgentDocument> =
  mongoose.models.Agent ?? mongoose.model<AgentDocument>("Agent", AgentSchema);
