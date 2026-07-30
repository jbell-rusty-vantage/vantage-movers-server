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

const RingCentralInboundRouteAssignmentSchema = new Schema(
  {
    route: {
      type: Schema.Types.ObjectId,
      ref: "RingCentralInboundRoute",
      required: true,
      immutable: true,
    },
    source_company: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceCompany",
      required: true,
      immutable: true,
      index: true,
    },
    source_granularity: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceGranularity",
      required: true,
      immutable: true,
      index: true,
    },
    effective_from: { type: Date, required: true, immutable: true },
    effective_until: { type: Date },
    active: { type: Boolean, required: true, default: true, index: true },
    created_by: { type: registryActorSnapshotSchema, required: true },
    change_reason: { type: String, trim: true },
  },
  {
    collection: "ringcentral_inbound_route_assignments",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

RingCentralInboundRouteAssignmentSchema.index({ route: 1, effective_from: 1 });
RingCentralInboundRouteAssignmentSchema.index({ route: 1, effective_until: 1 });
RingCentralInboundRouteAssignmentSchema.index(
  { route: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
  },
);
RingCentralInboundRouteAssignmentSchema.index({
  source_granularity: 1,
  active: 1,
});

export type RingCentralInboundRouteAssignmentDocument = InferSchemaType<
  typeof RingCentralInboundRouteAssignmentSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const RingCentralInboundRouteAssignment: Model<RingCentralInboundRouteAssignmentDocument> =
  mongoose.models.RingCentralInboundRouteAssignment ??
  mongoose.model<RingCentralInboundRouteAssignmentDocument>(
    "RingCentralInboundRouteAssignment",
    RingCentralInboundRouteAssignmentSchema,
  );

export function getRingCentralInboundRouteAssignmentModel(): Model<RingCentralInboundRouteAssignmentDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return RingCentralInboundRouteAssignment;
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.RingCentralInboundRouteAssignment as
      | Model<RingCentralInboundRouteAssignmentDocument>
      | undefined) ??
    db.model<RingCentralInboundRouteAssignmentDocument>(
      "RingCentralInboundRouteAssignment",
      RingCentralInboundRouteAssignmentSchema,
    )
  );
}
