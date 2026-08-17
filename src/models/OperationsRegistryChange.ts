import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export const REGISTRY_CHANGE_ENTITY_TYPES = [
  "agent",
  "merchant",
  "source_company",
  "source_granularity",
  "cpl_schedule",
  "ringcentral_route",
  "ringcentral_assignment",
  "registry",
  "granot_crm_source",
] as const;

export type RegistryChangeEntityType = (typeof REGISTRY_CHANGE_ENTITY_TYPES)[number];

export const REGISTRY_CHANGE_ACTIONS = [
  "create",
  "update",
  "activate",
  "deactivate",
  "rename",
  "schedule_apply",
  "validate",
  "reassign",
  "correction",
] as const;

export type RegistryChangeAction = (typeof REGISTRY_CHANGE_ACTIONS)[number];

export const REGISTRY_CHANGE_ACTOR_TYPES = ["owner", "admin", "system"] as const;

export type RegistryChangeActorType = (typeof REGISTRY_CHANGE_ACTOR_TYPES)[number];

const OperationsRegistryChangeSchema = new Schema(
  {
    entity_type: {
      type: String,
      required: true,
      enum: REGISTRY_CHANGE_ENTITY_TYPES,
      index: true,
    },
    entity_id: { type: String, required: true, trim: true, index: true },
    action: { type: String, required: true, enum: REGISTRY_CHANGE_ACTIONS },
    actor_type: { type: String, required: true, enum: REGISTRY_CHANGE_ACTOR_TYPES },
    actor_id: { type: String, required: true, trim: true, index: true },
    actor_label: { type: String, required: true, trim: true },
    actor_role: { type: String, required: true, trim: true, lowercase: true },
    request_id: { type: String, required: true, trim: true },
    reason: { type: String, trim: true },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    created_at: { type: Date, required: true, default: Date.now, index: true },
  },
  {
    collection: "operations_registry_changes",
    versionKey: false,
  },
);

OperationsRegistryChangeSchema.index({ entity_type: 1, entity_id: 1, created_at: -1 });
OperationsRegistryChangeSchema.index({ actor_id: 1, created_at: -1 });
OperationsRegistryChangeSchema.index({ request_id: 1 }, { unique: true });

export type OperationsRegistryChangeDocument = InferSchemaType<
  typeof OperationsRegistryChangeSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const OperationsRegistryChange: Model<OperationsRegistryChangeDocument> =
  mongoose.models.OperationsRegistryChange ??
  mongoose.model<OperationsRegistryChangeDocument>(
    "OperationsRegistryChange",
    OperationsRegistryChangeSchema,
  );
