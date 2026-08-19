import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import type {
  EntityRef,
  ExecutionMode,
  GranotLifecycleDisposition,
  SynchronizationOutcome,
  SynchronizationReasonCode,
} from "../services/granotLifecycle/types";
import {
  ENTITY_REF_MODELS,
  EXECUTION_MODES,
  GRANOT_LIFECYCLE_DISPOSITIONS,
  SYNCHRONIZATION_EFFECT_KINDS,
  SYNCHRONIZATION_MATCH_METHODS,
  SYNCHRONIZATION_OUTCOMES,
  SYNCHRONIZATION_REASON_CODES,
} from "./granotLifecycleSchemas";

export type SynchronizationMatchMethod =
  (typeof SYNCHRONIZATION_MATCH_METHODS)[number];

export type SynchronizationEffectKind =
  (typeof SYNCHRONIZATION_EFFECT_KINDS)[number];

export type SynchronizationDecisionSourceScope = {
  granot_crm_source_id: mongoose.Types.ObjectId;
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
  disposition: GranotLifecycleDisposition;
  policy_version: string;
};

export type SynchronizationDecisionSourcePolicy = {
  granot_crm_source_id: mongoose.Types.ObjectId;
  disposition: GranotLifecycleDisposition;
  policy_version: string;
};

export type SynchronizationDecisionCandidate = {
  target: EntityRef;
  reason_codes: string[];
};

export type SynchronizationDecisionEvaluatedGate = {
  gate: string;
  allowed: boolean;
};

export type SynchronizationDecisionEffect = {
  kind: SynchronizationEffectKind;
  ref?: EntityRef;
  changed_paths?: string[];
};

export type SynchronizationDecisionDocument = {
  _id: mongoose.Types.ObjectId;
  observation_id: mongoose.Types.ObjectId;
  attempt: number;
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?: SynchronizationMatchMethod;
  target?: EntityRef;
  source_scope?: SynchronizationDecisionSourceScope;
  source_policy?: SynchronizationDecisionSourcePolicy;
  candidates: SynchronizationDecisionCandidate[];
  evaluated_gates: SynchronizationDecisionEvaluatedGate[];
  effects: SynchronizationDecisionEffect[];
  next_match_attempt_at?: Date;
  decided_at: Date;
};

export const SYNCHRONIZATION_DECISION_COLLECTION = "synchronization_decisions";
export const SYNCHRONIZATION_DECISION_MODEL_NAME = "SynchronizationDecision";

export const SYNCHRONIZATION_DECISION_INDEXES = [
  {
    name: "synchronization_decision_observation_attempt_unique",
    key: { observation_id: 1, attempt: 1 },
    unique: true,
  },
  {
    name: "synchronization_decision_outcome_decided",
    key: { outcome: 1, decided_at: -1 },
  },
  {
    name: "synchronization_decision_target_decided",
    key: { "target.model": 1, "target.id": 1, decided_at: -1 },
  },
  {
    name: "synchronization_decision_source_decided",
    key: { "source_scope.granot_crm_source_id": 1, decided_at: -1 },
  },
] as const;

const entityRefSchema = new Schema(
  {
    model: { type: String, required: true, enum: ENTITY_REF_MODELS },
    id: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const SynchronizationDecisionSchema = new Schema<SynchronizationDecisionDocument>(
  {
    observation_id: { type: Schema.Types.ObjectId, required: true },
    attempt: { type: Number, required: true, min: 1, validate: Number.isInteger },
    execution_mode: { type: String, required: true, enum: EXECUTION_MODES },
    outcome: { type: String, required: true, enum: SYNCHRONIZATION_OUTCOMES },
    reason_code: {
      type: String,
      required: true,
      enum: SYNCHRONIZATION_REASON_CODES,
    },
    match_method: { type: String, enum: SYNCHRONIZATION_MATCH_METHODS },
    target: { type: entityRefSchema },
    source_scope: {
      type: new Schema(
        {
          granot_crm_source_id: { type: Schema.Types.ObjectId, required: true },
          lead_source_company: { type: Schema.Types.ObjectId, required: true },
          source_granularity_id: { type: Schema.Types.ObjectId, required: true },
          disposition: {
            type: String,
            required: true,
            enum: GRANOT_LIFECYCLE_DISPOSITIONS,
          },
          policy_version: { type: String, required: true, trim: true },
        },
        { _id: false },
      ),
    },
    source_policy: {
      type: new Schema(
        {
          granot_crm_source_id: { type: Schema.Types.ObjectId, required: true },
          disposition: {
            type: String,
            required: true,
            enum: GRANOT_LIFECYCLE_DISPOSITIONS,
          },
          policy_version: { type: String, required: true, trim: true },
        },
        { _id: false },
      ),
    },
    candidates: {
      type: [
        new Schema(
          {
            target: { type: entityRefSchema, required: true },
            reason_codes: { type: [String], required: true, default: [] },
          },
          { _id: false },
        ),
      ],
      required: true,
      default: [],
    },
    evaluated_gates: {
      type: [
        new Schema(
          {
            gate: { type: String, required: true, trim: true },
            allowed: { type: Boolean, required: true },
          },
          { _id: false },
        ),
      ],
      required: true,
      default: [],
    },
    effects: {
      type: [
        new Schema(
          {
            kind: {
              type: String,
              required: true,
              enum: SYNCHRONIZATION_EFFECT_KINDS,
            },
            ref: { type: entityRefSchema },
            changed_paths: { type: [String] },
          },
          { _id: false },
        ),
      ],
      required: true,
      default: [],
    },
    next_match_attempt_at: { type: Date },
    decided_at: { type: Date, required: true },
  },
  {
    collection: SYNCHRONIZATION_DECISION_COLLECTION,
    timestamps: false,
    strict: true,
    autoIndex: false,
  },
);

for (const index of SYNCHRONIZATION_DECISION_INDEXES) {
  const options: Record<string, unknown> = { name: index.name };
  if ("unique" in index) {
    options.unique = true;
  }
  SynchronizationDecisionSchema.index(index.key, options);
}

SynchronizationDecisionSchema.pre("save", function rejectDecisionMutation() {
  if (this.isNew) {
    return;
  }
  throw new Error("SynchronizationDecision evidence is write-once");
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
  SynchronizationDecisionSchema.pre(operation, function rejectDecisionMutation() {
    throw new Error(
      "SynchronizationDecision evidence cannot be updated, replaced, or deleted",
    );
  });
}

export const SynchronizationDecision: Model<SynchronizationDecisionDocument> =
  (mongoose.models[SYNCHRONIZATION_DECISION_MODEL_NAME] as
    | Model<SynchronizationDecisionDocument>
    | undefined) ??
  mongoose.model<SynchronizationDecisionDocument>(
    SYNCHRONIZATION_DECISION_MODEL_NAME,
    SynchronizationDecisionSchema,
  );

export function getSynchronizationDecisionModel(): Model<SynchronizationDecisionDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return SynchronizationDecision;
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[SYNCHRONIZATION_DECISION_MODEL_NAME] as
      | Model<SynchronizationDecisionDocument>
      | undefined) ??
    db.model<SynchronizationDecisionDocument>(
      SYNCHRONIZATION_DECISION_MODEL_NAME,
      SynchronizationDecisionSchema,
    )
  );
}
