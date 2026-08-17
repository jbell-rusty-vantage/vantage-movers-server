import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import type { DurableActor } from "../services/durableWork/types";
import { GRANOT_LIFECYCLE_ACTIVATION_KEY } from "./granotLifecycleSchemas";

export type GranotLifecycleActivationDocument = {
  _id: mongoose.Types.ObjectId;
  key: typeof GRANOT_LIFECYCLE_ACTIVATION_KEY;
  activated_at: Date;
  activated_by: DurableActor;
  reason: string;
  processor_version: string;
  createdAt: Date;
};

export const GRANOT_LIFECYCLE_ACTIVATION_COLLECTION =
  "granot_lifecycle_activations";
export const GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME =
  "GranotLifecycleActivation";

export const GRANOT_LIFECYCLE_ACTIVATION_INDEXES = [
  {
    name: "granot_lifecycle_activation_key_unique",
    key: { key: 1 },
    unique: true,
  },
] as const;

const durableActorSchema = new Schema(
  {
    actor_type: { type: String, required: true, enum: ["owner", "admin", "system"] },
    actor_id: { type: String, required: true, trim: true },
    actor_label: { type: String, required: true, trim: true },
    actor_role: { type: String, required: true, enum: ["owner", "admin", "system"] },
    request_id: { type: String, required: true, trim: true },
    origin: {
      type: String,
      required: true,
      enum: ["vantage_admin", "external_sheet_ingestion", "reporting_projection"],
    },
  },
  { _id: false },
);

const GranotLifecycleActivationSchema = new Schema<GranotLifecycleActivationDocument>(
  {
    key: {
      type: String,
      required: true,
      enum: [GRANOT_LIFECYCLE_ACTIVATION_KEY],
    },
    activated_at: { type: Date, required: true },
    activated_by: { type: durableActorSchema, required: true },
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
    processor_version: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 100,
    },
  },
  {
    collection: GRANOT_LIFECYCLE_ACTIVATION_COLLECTION,
    timestamps: { createdAt: true, updatedAt: false },
    strict: true,
    autoIndex: false,
  },
);

for (const index of GRANOT_LIFECYCLE_ACTIVATION_INDEXES) {
  GranotLifecycleActivationSchema.index(index.key, {
    name: index.name,
    unique: true,
  });
}

GranotLifecycleActivationSchema.pre("save", function rejectActivationMutation() {
  if (this.isNew) {
    return;
  }
  throw new Error("GranotLifecycleActivation is write-once");
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
  GranotLifecycleActivationSchema.pre(
    operation,
    function rejectActivationMutation() {
      throw new Error(
        "GranotLifecycleActivation cannot be updated, replaced, deleted, or upserted after existence",
      );
    },
  );
}

export const GranotLifecycleActivation: Model<GranotLifecycleActivationDocument> =
  (mongoose.models[GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME] as
    | Model<GranotLifecycleActivationDocument>
    | undefined) ??
  mongoose.model<GranotLifecycleActivationDocument>(
    GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME,
    GranotLifecycleActivationSchema,
  );

export function getGranotLifecycleActivationModel(): Model<GranotLifecycleActivationDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotLifecycleActivation;
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME] as
      | Model<GranotLifecycleActivationDocument>
      | undefined) ??
    db.model<GranotLifecycleActivationDocument>(
      GRANOT_LIFECYCLE_ACTIVATION_MODEL_NAME,
      GranotLifecycleActivationSchema,
    )
  );
}
