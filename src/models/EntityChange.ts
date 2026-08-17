import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import type { DurableActor } from "../services/durableWork/types";
import type { EntityRef, ObservationChannel } from "../services/granotLifecycle/types";
import {
  ENTITY_REF_MODELS,
  OBSERVATION_CHANNELS,
  isNonnegativeIntegerRevision,
} from "./granotLifecycleSchemas";

export const ENTITY_CHANGE_SOURCE_SYSTEMS = [
  "vantage",
  "granot",
  "ringcentral",
] as const;

export type EntityChangeSourceSystem =
  (typeof ENTITY_CHANGE_SOURCE_SYSTEMS)[number];

export const ENTITY_CHANGE_VALUE_MODES = [
  "stored",
  "hashed",
  "reference_only",
] as const;

export type EntityChangeValueMode = (typeof ENTITY_CHANGE_VALUE_MODES)[number];

export const DELETED_ENTITY_CHANGE_PATH = "$deleted";

export type EntityChangeField = {
  path: string;
  value_mode: EntityChangeValueMode;
  before?: unknown;
  after?: unknown;
  before_hash?: string;
  after_hash?: string;
};

export type EntityChangeProvenance = {
  source_system: EntityChangeSourceSystem;
  observation_channel?: ObservationChannel;
  actor: DurableActor;
  initiator: DurableActor;
  receipt_id?: mongoose.Types.ObjectId;
  observation_id?: mongoose.Types.ObjectId;
  decision_id?: mongoose.Types.ObjectId;
  case_id?: mongoose.Types.ObjectId;
  discrepancy_id?: mongoose.Types.ObjectId;
  run_id?: string;
  request_id?: string;
};

export type EntityChangeDocument = {
  _id: mongoose.Types.ObjectId;
  entity: EntityRef;
  command_execution_id: mongoose.Types.ObjectId;
  command_name: string;
  provenance: EntityChangeProvenance;
  changed_paths: string[];
  fields: EntityChangeField[];
  revision_before: number;
  revision_after: number;
  applied_at: Date;
};

export const ENTITY_CHANGE_COLLECTION = "entity_changes";
export const ENTITY_CHANGE_MODEL_NAME = "EntityChange";

export const ENTITY_CHANGE_INDEXES = [
  {
    name: "entity_change_entity_revision_unique",
    key: { "entity.model": 1, "entity.id": 1, revision_after: 1 },
    unique: true,
  },
  {
    name: "entity_change_command_execution_id",
    key: { command_execution_id: 1 },
  },
  {
    name: "entity_change_entity_applied",
    key: { "entity.model": 1, "entity.id": 1, applied_at: -1 },
  },
  {
    name: "entity_change_changed_paths_applied",
    key: { changed_paths: 1, applied_at: -1 },
  },
] as const;

const CONTACT_OR_ADDRESS_PATH =
  /(^|\.)(name|first_name|last_name|display_name|phone|phone_number|normalized_phone_number|email|normalized_email|customer_name|customer_phone|customer_email|address|street|city|zip|pickup_zip|destination_zip|pickup_city|delivery_city|pickup_state|delivery_state|origin|destination)(\.|$)/i;

const FORBIDDEN_RAW_PATH =
  /(payload|headers|secret|credential|authorization|cookie|password|token|api[_-]?key)/i;

const entityRefSchema = new Schema(
  {
    model: { type: String, required: true, enum: ENTITY_REF_MODELS },
    id: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const entityChangeFieldSchema = new Schema(
  {
    path: { type: String, required: true, trim: true },
    value_mode: {
      type: String,
      required: true,
      enum: ENTITY_CHANGE_VALUE_MODES,
    },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    before_hash: { type: String, trim: true },
    after_hash: { type: String, trim: true },
  },
  { _id: false },
);

const EntityChangeSchema = new Schema<EntityChangeDocument>(
  {
    entity: { type: entityRefSchema, required: true },
    command_execution_id: { type: Schema.Types.ObjectId, required: true },
    command_name: { type: String, required: true, trim: true },
    provenance: { type: Schema.Types.Mixed, required: true },
    changed_paths: { type: [String], required: true, default: [] },
    fields: { type: [entityChangeFieldSchema], required: true, default: [] },
    revision_before: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isNonnegativeIntegerRevision,
        message: "revision_before must be a nonnegative integer",
      },
    },
    revision_after: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: isNonnegativeIntegerRevision,
        message: "revision_after must be a nonnegative integer",
      },
    },
    applied_at: { type: Date, required: true },
  },
  {
    collection: ENTITY_CHANGE_COLLECTION,
    timestamps: false,
    strict: true,
    autoIndex: false,
  },
);

for (const index of ENTITY_CHANGE_INDEXES) {
  const options: Record<string, unknown> = { name: index.name };
  if ("unique" in index) {
    options.unique = true;
  }
  EntityChangeSchema.index(index.key, options);
}

EntityChangeSchema.pre("validate", function rejectInvalidEntityChange() {
  if (this.revision_after !== this.revision_before + 1) {
    this.invalidate(
      "revision_after",
      "revision_after must equal revision_before + 1",
    );
  }

  const paths = [...new Set(this.changed_paths)].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    paths.length !== this.changed_paths.length ||
    paths.some((path, index) => path !== this.changed_paths[index])
  ) {
    this.invalidate(
      "changed_paths",
      "changed_paths must be unique, sorted, and duplicate-free",
    );
  }

  const fieldPaths = this.fields.map((field) => field.path);
  if (fieldPaths.length !== new Set(fieldPaths).size) {
    this.invalidate("fields", "fields.path values must be unique");
  }
  for (const path of paths) {
    if (!fieldPaths.includes(path)) {
      this.invalidate(
        "changed_paths",
        `changed_paths entry ${path} must have a matching fields.path`,
      );
    }
  }
  for (const field of this.fields) {
    if (!paths.includes(field.path)) {
      this.invalidate(
        "fields",
        `fields.path ${field.path} must appear in changed_paths`,
      );
    }
    if (FORBIDDEN_RAW_PATH.test(field.path)) {
      this.invalidate("fields", "EntityChange cannot store forbidden raw paths");
    }
    if (
      field.path === DELETED_ENTITY_CHANGE_PATH ||
      CONTACT_OR_ADDRESS_PATH.test(field.path)
    ) {
      if (field.value_mode !== "reference_only") {
        this.invalidate(
          "fields",
          "Contact, address, and delete descriptors must be reference_only",
        );
      }
      if (
        field.before !== undefined ||
        field.after !== undefined ||
        field.before_hash !== undefined ||
        field.after_hash !== undefined
      ) {
        this.invalidate(
          "fields",
          "reference_only contact/address/delete fields cannot store values or hashes",
        );
      }
    }
    if (field.value_mode === "hashed") {
      if (field.before !== undefined || field.after !== undefined) {
        this.invalidate(
          "fields",
          "hashed fields cannot store raw before/after values",
        );
      }
      if (!field.before_hash && !field.after_hash) {
        this.invalidate(
          "fields",
          "hashed fields require before_hash or after_hash",
        );
      }
    }
    if (field.value_mode === "reference_only") {
      if (
        field.before !== undefined ||
        field.after !== undefined ||
        field.before_hash !== undefined ||
        field.after_hash !== undefined
      ) {
        this.invalidate(
          "fields",
          "reference_only fields cannot store values or hashes",
        );
      }
    }
  }

  const provenance = this.provenance as EntityChangeProvenance | undefined;
  if (
    !provenance ||
    !ENTITY_CHANGE_SOURCE_SYSTEMS.includes(provenance.source_system) ||
    !provenance.actor ||
    !provenance.initiator
  ) {
    this.invalidate("provenance", "EntityChange provenance is incomplete");
  }
  if (
    provenance?.observation_channel &&
    !OBSERVATION_CHANNELS.includes(provenance.observation_channel)
  ) {
    this.invalidate("provenance", "observation_channel is not a known channel");
  }
});

EntityChangeSchema.pre("save", function rejectEntityChangeMutation() {
  if (this.isNew) {
    return;
  }
  throw new Error("EntityChange evidence is write-once");
});

for (const operation of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  EntityChangeSchema.pre(operation, function rejectEntityChangeMutation() {
    throw new Error(
      "EntityChange evidence cannot be updated, replaced, or deleted",
    );
  });
}

export const EntityChange: Model<EntityChangeDocument> =
  (mongoose.models[ENTITY_CHANGE_MODEL_NAME] as
    | Model<EntityChangeDocument>
    | undefined) ??
  mongoose.model<EntityChangeDocument>(
    ENTITY_CHANGE_MODEL_NAME,
    EntityChangeSchema,
  );

export function getEntityChangeModel(): Model<EntityChangeDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return EntityChange;
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[ENTITY_CHANGE_MODEL_NAME] as
      | Model<EntityChangeDocument>
      | undefined) ??
    db.model<EntityChangeDocument>(
      ENTITY_CHANGE_MODEL_NAME,
      EntityChangeSchema,
    )
  );
}
