import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain";

const registryActorSnapshotSchema = new Schema(
  {
    actor_type: { type: String, required: true, trim: true },
    actor_id: { type: String, required: true, trim: true },
    actor_label: { type: String, required: true, trim: true },
    actor_role: { type: String, required: true, trim: true, lowercase: true },
  },
  { _id: false },
);

const RingCentralInboundRouteSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ["ringcentral"],
      required: true,
      default: "ringcentral",
      immutable: true,
    },
    phone_number: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      immutable: function (this: { phone_locked?: boolean }) {
        return this.phone_locked === true;
      },
    },
    phone_locked: { type: Boolean, required: true, default: false },
    display_label: { type: String, required: true, trim: true },
    active: { type: Boolean, required: true, default: false, index: true },
    ever_activated: { type: Boolean, required: true, default: false },
    archived_at: { type: Date },
    deactivation_reason: { type: String, trim: true },

    ringcentral_phone_number_id: { type: String, trim: true },
    ringcentral_extension_id: { type: String, trim: true },
    ringcentral_queue_id: { type: String, trim: true },
    ringcentral_queue_name: { type: String, trim: true },
    observed_target_names: { type: [String], default: [] },

    validation_status: {
      type: String,
      enum: ["unvalidated", "valid", "invalid"],
      required: true,
      default: "unvalidated",
      index: true,
    },
    validation_code: { type: String, trim: true },
    validation_message: { type: String, trim: true },
    validated_at: { type: Date },
    validated_by: { type: registryActorSnapshotSchema },
    last_seen_in_call_log_at: { type: Date },
    last_seen_in_webhook_at: { type: Date },

    created_from: { type: String, required: true, trim: true, default: "admin" },
    created_by: { type: registryActorSnapshotSchema, required: true },
  },
  {
    collection: "ringcentral_inbound_routes",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

RingCentralInboundRouteSchema.index({ active: 1, validation_status: 1 });
RingCentralInboundRouteSchema.index(
  { ringcentral_phone_number_id: 1 },
  { sparse: true },
);
RingCentralInboundRouteSchema.index(
  { ringcentral_extension_id: 1 },
  { sparse: true },
);
RingCentralInboundRouteSchema.index(
  { ringcentral_queue_id: 1 },
  { sparse: true },
);

export type RingCentralInboundRouteDocument = InferSchemaType<
  typeof RingCentralInboundRouteSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const RingCentralInboundRoute: Model<RingCentralInboundRouteDocument> =
  mongoose.models.RingCentralInboundRoute ??
  mongoose.model<RingCentralInboundRouteDocument>(
    "RingCentralInboundRoute",
    RingCentralInboundRouteSchema,
  );

export function getRingCentralInboundRouteModel(): Model<RingCentralInboundRouteDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return RingCentralInboundRoute;
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.RingCentralInboundRoute as
      | Model<RingCentralInboundRouteDocument>
      | undefined) ??
    db.model<RingCentralInboundRouteDocument>(
      "RingCentralInboundRoute",
      RingCentralInboundRouteSchema,
    )
  );
}
