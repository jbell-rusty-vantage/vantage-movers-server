import mongoose, { Schema, type Model } from "mongoose";
import type { DurableActor } from "../services/durableWork/types";
import type { LeadModel } from "../services/granotLifecycle/types";
import {
  GRANOT_LEAD_MODELS,
  GRANOT_RECONCILIATION_EVIDENCE_ACTIONS,
  GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES,
} from "./granotLifecycleSchemas";

export type GranotDiscrepancyKind = "booking" | "release";
export type GranotDiscrepancyEvidence = {
  observation_id: mongoose.Types.ObjectId;
  decision_id: mongoose.Types.ObjectId;
  captured_at: Date;
  action: "priority_5" | "booked" | "release";
};

export type GranotDiscrepancyDocument = {
  _id: mongoose.Types.ObjectId;
  normalized_job_no: string;
  discrepancy_kind: GranotDiscrepancyKind;
  reason_code: string;
  reason_fingerprint: string;
  state: "open" | "resolved";
  record_link_id?: mongoose.Types.ObjectId;
  lead_ref?: { model: LeadModel; id: mongoose.Types.ObjectId };
  booking_id?: mongoose.Types.ObjectId;
  cancellation_id?: mongoose.Types.ObjectId;
  evidence: GranotDiscrepancyEvidence[];
  evidence_revision: number;
  revision: number;
  resolution?: {
    outcome: "re_evaluated" | "record_link_corrected" | "no_action";
    command_execution_id: mongoose.Types.ObjectId;
    actor: DurableActor;
    reason_code?: (typeof GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES)[number];
    reason_text?: string;
    resolved_at: Date;
  };
  opened_at: Date;
  last_evidence_at: Date;
};

export type GranotDiscrepancyIndexContract = {
  name: string;
  key: Record<string, 1 | -1>;
  unique?: true;
  partialFilterExpression?: { state: "open" };
};

const actorSchema = new Schema(
  {
    actor_type: { type: String, required: true, enum: ["owner", "admin", "system"] },
    actor_id: { type: String, required: true, trim: true },
    actor_label: { type: String, required: true, trim: true },
    actor_role: { type: String, required: true, enum: ["owner", "admin", "system"] },
    request_id: { type: String, required: true, trim: true },
    origin: {
      type: String,
      required: true,
      enum: [
        "vantage_admin",
        "browser_extension",
        "external_sheet_ingestion",
        "reporting_projection",
        "granot_lifecycle",
        "ringcentral",
      ],
    },
  },
  { _id: false },
);

const evidenceSchema = new Schema(
  {
    observation_id: { type: Schema.Types.ObjectId, required: true },
    decision_id: { type: Schema.Types.ObjectId, required: true },
    captured_at: { type: Date, required: true },
    action: {
      type: String,
      required: true,
      enum: GRANOT_RECONCILIATION_EVIDENCE_ACTIONS,
    },
  },
  { _id: false },
);

export function createGranotDiscrepancyModel(input: {
  model_name: string;
  collection: string;
  kind: GranotDiscrepancyKind;
  reason_codes: readonly string[];
  indexes: readonly GranotDiscrepancyIndexContract[];
}): { schema: Schema<GranotDiscrepancyDocument>; model: Model<GranotDiscrepancyDocument> } {
  const schema = new Schema<GranotDiscrepancyDocument>(
    {
      normalized_job_no: { type: String, required: true, trim: true },
      discrepancy_kind: {
        type: String,
        required: true,
        enum: [input.kind],
        default: input.kind,
      },
      reason_code: { type: String, required: true, enum: input.reason_codes },
      reason_fingerprint: {
        type: String,
        required: true,
        lowercase: true,
        match: /^[a-f0-9]{64}$/,
      },
      state: {
        type: String,
        required: true,
        enum: ["open", "resolved"],
        default: "open",
      },
      record_link_id: { type: Schema.Types.ObjectId },
      lead_ref: {
        type: new Schema(
          {
            model: { type: String, required: true, enum: GRANOT_LEAD_MODELS },
            id: { type: Schema.Types.ObjectId, required: true },
          },
          { _id: false },
        ),
      },
      booking_id: { type: Schema.Types.ObjectId },
      cancellation_id: { type: Schema.Types.ObjectId },
      evidence: {
        type: [evidenceSchema],
        required: true,
        validate: {
          validator: (rows: unknown[]) => rows.length > 0,
          message: "evidence must contain at least one causal reference",
        },
      },
      evidence_revision: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isInteger,
        default: 1,
      },
      revision: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isInteger,
        default: 1,
      },
      resolution: {
        type: new Schema(
          {
            outcome: {
              type: String,
              required: true,
              enum: ["re_evaluated", "record_link_corrected", "no_action"],
            },
            command_execution_id: { type: Schema.Types.ObjectId, required: true },
            actor: { type: actorSchema, required: true },
            reason_code: {
              type: String,
              enum: GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES,
            },
            reason_text: { type: String, trim: true, maxlength: 1000 },
            resolved_at: { type: Date, required: true },
          },
          { _id: false },
        ),
      },
      opened_at: { type: Date, required: true },
      last_evidence_at: { type: Date, required: true },
    },
    {
      collection: input.collection,
      timestamps: true,
      strict: true,
      autoIndex: false,
    },
  );

  for (const index of input.indexes) {
    schema.index(index.key, {
      name: index.name,
      ...(index.unique ? { unique: true } : {}),
      ...(index.partialFilterExpression
        ? { partialFilterExpression: index.partialFilterExpression }
        : {}),
    });
  }

  schema.post("init", function rememberImmutableState(doc) {
    doc.$locals.persisted_state = doc.state;
    doc.$locals.persisted_evidence_ids = doc.evidence.map((row) =>
      String(row.observation_id),
    );
  });
  schema.pre("validate", function rejectForbiddenMutation() {
    if (this.isNew) return;
    if (this.$locals.persisted_state === "resolved") {
      throw new Error("A resolved discrepancy is immutable");
    }
    const before = (this.$locals.persisted_evidence_ids ?? []) as string[];
    const current = new Set(this.evidence.map((row) => String(row.observation_id)));
    if (before.some((id) => !current.has(id))) {
      throw new Error("Existing discrepancy evidence IDs are immutable");
    }
  });
  schema.pre(
    ["updateOne", "findOneAndUpdate", "replaceOne"],
    function rejectUnsafeDirectUpdate() {
      const filter = this.getFilter() as Record<string, unknown>;
      const update = this.getUpdate() as Record<string, unknown> | null;
      if (!update) return;
      if (!Object.keys(update).some((key) => key.startsWith("$"))) {
        throw new Error("Discrepancies cannot be replaced directly");
      }
      if (filter.state !== "open") {
        throw new Error("Discrepancy updates must guard on open state");
      }
      const set = (update.$set ?? {}) as Record<string, unknown>;
      if (set.state === "open") {
        throw new Error("A resolved discrepancy cannot return to open");
      }
      if (
        "evidence" in set ||
        "reason_code" in set ||
        "reason_fingerprint" in set ||
        "discrepancy_kind" in set ||
        "$pull" in update ||
        "$pop" in update ||
        "$unset" in update
      ) {
        throw new Error("Discrepancy identity and evidence are immutable");
      }
    },
  );

  const model =
    (mongoose.models[input.model_name] as Model<GranotDiscrepancyDocument> | undefined) ??
    mongoose.model<GranotDiscrepancyDocument>(input.model_name, schema);
  return { schema, model };
}
