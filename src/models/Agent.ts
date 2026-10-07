import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const AgentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    normalized_name: { type: String, required: true, trim: true, lowercase: true, unique: true },
    active: { type: Boolean, required: true, default: true },
    role: { type: String, required: true, trim: true, default: "agent" },
    created_from: { type: String, required: true, trim: true, default: "booked_lead" },
    name_aliases: { type: [String], default: [] },
    archived_at: { type: Date },
    deactivation_reason: { type: String, trim: true },
    granot_identity: {
      username: {
        type: String,
        trim: true,
        uppercase: true,
      },
      verified: { type: Boolean, required: true, default: false },
      verified_at: { type: Date },
      last_observed_at: { type: Date },
    },
    // Granot CRM `user`/`rep` column login (e.g. "MIKEM", "JACOB").
    granot_crm_username: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true,
    },
    // Owner's Outreach Desk control (`OUTREACH_DESK_SETTINGS`); absent = "auto".
    outreach_desk: { type: String, enum: ["auto", "on", "off"] },
  },
  {
    collection: "agents",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// One Agent per Granot CRM username. The partial filter already skips Agents
// without a username, so the index must not also be `sparse`: Mongo refuses
// to build an index that mixes the two (CannotCreateIndex 67), and Mongoose
// autoIndex would swallow that error and leave uniqueness unenforced.
AgentSchema.index(
  { "granot_identity.username": 1 },
  {
    unique: true,
    partialFilterExpression: { "granot_identity.username": { $type: "string" } },
  },
);
AgentSchema.index({ name_aliases: 1 });

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
