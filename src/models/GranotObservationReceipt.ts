import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import type { DurableActor } from "../services/durableWork/types";
import {
  hashCredentialRedactedPayload,
  redactCredentialKeys,
} from "../services/granotLifecycle/receiptEvidence";
import type {
  ChannelOperationKind,
  GranotRouteEventClass,
  ObservationChannel,
  ReceiptWorkState,
} from "../services/granotLifecycle/types";
import {
  AUTHENTICATION_METHODS,
  CHANNEL_OPERATION_KINDS,
  OBSERVATION_CHANNELS,
  PAYLOAD_KINDS,
  ROUTE_EVENT_CLASSES,
  assertChannelOperationId,
  assertReceiptChannelShape,
  granotReceiptProcessingSchema,
} from "./granotLifecycleSchemas";

export type GranotObservationReceiptAuthenticationMethod =
  (typeof AUTHENTICATION_METHODS)[number];

export type GranotObservationReceiptProcessing = {
  state: ReceiptWorkState;
  technical_attempts: number;
  match_attempt: number;
  next_attempt_at: Date;
  lease_owner?: string;
  leased_until?: Date;
  last_started_at?: Date;
  last_error?: {
    code: string;
    message: string;
    failed_at: Date;
  };
  completed_at?: Date;
  latest_decision_id?: mongoose.Types.ObjectId;
  manual_requeue_count: number;
};

export type GranotObservationReceiptDocument = {
  _id: mongoose.Types.ObjectId;
  source_system: "granot";
  observation_channel: ObservationChannel;
  captured_at: Date;
  route_event_class?: GranotRouteEventClass;
  channel_operation_kind?: ChannelOperationKind;
  authentication_method: GranotObservationReceiptAuthenticationMethod;
  evidence_version: 2;
  payload_kind: "object" | "array" | "null" | "primitive";
  payload_schema_hint?: string;
  headers: Record<string, string | string[]>;
  payload: unknown;
  payload_sha256: string;
  channel_operation_id?: string;
  initiator?: DurableActor;
  processing: GranotObservationReceiptProcessing;
  provider: "granot";
  createdAt: Date;
  updatedAt: Date;
};

export const GRANOT_OBSERVATION_RECEIPT_COLLECTION = "granot_webhook_receipts";
export const GRANOT_OBSERVATION_RECEIPT_MODEL_NAME = "GranotObservationReceipt";

export const GRANOT_OBSERVATION_RECEIPT_INDEXES = [
  {
    name: "granot_observation_receipt_channel_operation_id_unique",
    key: { observation_channel: 1, channel_operation_id: 1 },
    unique: true,
    partialFilterExpression: { channel_operation_id: { $type: "string" } },
  },
  {
    name: "granot_observation_receipt_processing_due",
    key: { "processing.state": 1, "processing.next_attempt_at": 1, captured_at: 1 },
  },
  {
    name: "granot_observation_receipt_leased_until",
    key: { "processing.leased_until": 1 },
  },
  {
    name: "granot_observation_receipt_route_event_captured",
    key: { route_event_class: 1, captured_at: -1 },
  },
  {
    name: "granot_observation_receipt_payload_sha256_diag",
    key: { payload_sha256: 1, captured_at: -1 },
  },
] as const;

export const GRANOT_OBSERVATION_RECEIPT_EVIDENCE_FIELDS = [
  "source_system",
  "observation_channel",
  "captured_at",
  "route_event_class",
  "channel_operation_kind",
  "authentication_method",
  "evidence_version",
  "payload_kind",
  "payload_schema_hint",
  "headers",
  "payload",
  "payload_sha256",
  "channel_operation_id",
  "initiator",
  "createdAt",
  "provider",
] as const;

const ALLOWED_UPDATE_OPERATORS = new Set(["$set", "$inc", "$unset", "$setOnInsert"]);

export function assertAllowlistedReceiptProcessingUpdate(
  update: unknown,
): void {
  if (update == null || typeof update !== "object" || Array.isArray(update)) {
    throw new Error(
      "GranotObservationReceipt updates must use allowlisted processing operators",
    );
  }
  const operators = Object.keys(update as Record<string, unknown>);
  if (operators.length === 0) {
    throw new Error(
      "GranotObservationReceipt updates must use allowlisted processing operators",
    );
  }
  for (const operator of operators) {
    if (!ALLOWED_UPDATE_OPERATORS.has(operator)) {
      throw new Error(
        `GranotObservationReceipt updates may not use operator ${operator}`,
      );
    }
    const spec = (update as Record<string, unknown>)[operator];
    if (spec == null || typeof spec !== "object" || Array.isArray(spec)) {
      throw new Error(
        `GranotObservationReceipt ${operator} must target processing fields`,
      );
    }
    for (const path of Object.keys(spec as Record<string, unknown>)) {
      if (operator === "$setOnInsert" && path === "createdAt") {
        continue;
      }
      if (path === "updatedAt") {
        continue;
      }
      if (path !== "processing" && !path.startsWith("processing.")) {
        throw new Error(
          `GranotObservationReceipt ${operator} may only target processing.* fields`,
        );
      }
    }
  }
}

const GranotObservationReceiptSchema = new Schema(
  {
    source_system: { type: String, required: true, enum: ["granot"] },
    observation_channel: {
      type: String,
      required: true,
      enum: OBSERVATION_CHANNELS,
    },
    captured_at: { type: Date, required: true },
    route_event_class: { type: String, enum: ROUTE_EVENT_CLASSES },
    channel_operation_kind: { type: String, enum: CHANNEL_OPERATION_KINDS },
    authentication_method: {
      type: String,
      required: true,
      enum: AUTHENTICATION_METHODS,
    },
    evidence_version: { type: Number, required: true, enum: [2] },
    payload_kind: { type: String, required: true, enum: PAYLOAD_KINDS },
    payload_schema_hint: { type: String, trim: true },
    headers: { type: Schema.Types.Mixed, required: true, default: {} },
    payload: { type: Schema.Types.Mixed, default: null },
    payload_sha256: {
      type: String,
      required: true,
      validate: {
        validator(value: string) {
          return /^[0-9a-f]{64}$/.test(value);
        },
        message: "payload_sha256 must be lowercase 64-character hex",
      },
    },
    channel_operation_id: {
      type: String,
      trim: true,
      validate: {
        validator(value: string) {
          if (value == null || value === "") {
            return true;
          }
          const document = this as { observation_channel?: ObservationChannel };
          assertChannelOperationId(value, document.observation_channel);
          return true;
        },
      },
    },
    initiator: { type: Schema.Types.Mixed },
    processing: { type: granotReceiptProcessingSchema, required: true },
    provider: { type: String, required: true, enum: ["granot"], default: "granot" },
  },
  {
    collection: GRANOT_OBSERVATION_RECEIPT_COLLECTION,
    timestamps: true,
    strict: true,
  },
);

for (const index of GRANOT_OBSERVATION_RECEIPT_INDEXES) {
  const options: Record<string, unknown> = { name: index.name };
  if ("unique" in index) {
    options.unique = true;
  }
  if ("partialFilterExpression" in index) {
    options.partialFilterExpression = index.partialFilterExpression;
  }
  GranotObservationReceiptSchema.index(index.key, options);
}

GranotObservationReceiptSchema.pre("validate", function normalizeOperationId() {
  if (!this.isNew) {
    return;
  }

  const receipt = this as unknown as GranotObservationReceiptDocument & {
    set(path: string, value: unknown): void;
  };

  if (receipt.channel_operation_id === "") {
    receipt.set("channel_operation_id", undefined);
  }

  const headerRedaction = redactCredentialKeys(receipt.headers ?? {});
  const payloadEvidence = hashCredentialRedactedPayload(receipt.payload);
  receipt.set("headers", headerRedaction.value);
  receipt.set("payload", payloadEvidence.redacted_payload);
  if (
    receipt.payload_sha256 == null ||
    Object.values(payloadEvidence.removed_key_counts).some((count) => count > 0)
  ) {
    receipt.set("payload_sha256", payloadEvidence.payload_sha256);
  }
});

GranotObservationReceiptSchema.pre("validate", function validateChannelContract() {
  const receipt = this as unknown as GranotObservationReceiptDocument;
  assertReceiptChannelShape({
    observation_channel: receipt.observation_channel,
    route_event_class: receipt.route_event_class,
    channel_operation_kind: receipt.channel_operation_kind,
    channel_operation_id: receipt.channel_operation_id,
  });
  if (receipt.channel_operation_id) {
    assertChannelOperationId(
      receipt.channel_operation_id,
      receipt.observation_channel,
    );
  }
});

GranotObservationReceiptSchema.pre("save", function rejectEvidenceMutation() {
  if (this.isNew) {
    return;
  }
  for (const field of GRANOT_OBSERVATION_RECEIPT_EVIDENCE_FIELDS) {
    if (this.isModified(field)) {
      throw new Error(
        `GranotObservationReceipt evidence field "${field}" is write-once`,
      );
    }
  }
  for (const path of this.modifiedPaths()) {
    if (path === "updatedAt" || path === "processing" || path.startsWith("processing.")) {
      continue;
    }
    throw new Error(
      `GranotObservationReceipt may only mutate processing.* after insert; rejected "${path}"`,
    );
  }
});

for (const operation of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
] as const) {
  GranotObservationReceiptSchema.pre(operation, function rejectNonProcessingUpdate() {
    assertAllowlistedReceiptProcessingUpdate(this.getUpdate());
  });
}

for (const operation of [
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  GranotObservationReceiptSchema.pre(operation, function rejectEvidenceReplaceOrDelete() {
    throw new Error(
      "GranotObservationReceipt evidence cannot be replaced or deleted",
    );
  });
}

export const GranotObservationReceipt: Model<GranotObservationReceiptDocument> =
  (mongoose.models[GRANOT_OBSERVATION_RECEIPT_MODEL_NAME] as
    | Model<GranotObservationReceiptDocument>
    | undefined) ??
  mongoose.model<GranotObservationReceiptDocument>(
    GRANOT_OBSERVATION_RECEIPT_MODEL_NAME,
    GranotObservationReceiptSchema,
  );

export function getGranotObservationReceiptModel(): Model<GranotObservationReceiptDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotObservationReceipt;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[GRANOT_OBSERVATION_RECEIPT_MODEL_NAME] as
      | Model<GranotObservationReceiptDocument>
      | undefined) ??
    db.model<GranotObservationReceiptDocument>(
      GRANOT_OBSERVATION_RECEIPT_MODEL_NAME,
      GranotObservationReceiptSchema,
    )
  );
}
