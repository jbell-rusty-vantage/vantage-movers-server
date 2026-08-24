import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import type { DurableActor } from "../services/durableWork/types";
import type { EntityRef, LeadModel } from "../services/granotLifecycle/types";
import type { BookingPriorityPairingClass } from "../services/granotLifecycle/bookingPriorityPairing";
import {
  ENTITY_REF_MODELS,
  GRANOT_BOOKING_RECONCILIATION_MODES,
  GRANOT_BOOKING_RECONCILIATION_OUTCOMES,
  GRANOT_LEAD_MODELS,
  GRANOT_RECONCILIATION_CASE_STATES,
  GRANOT_RECONCILIATION_EVIDENCE_ACTIONS,
  GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES,
} from "./granotLifecycleSchemas";

export type GranotBookingCaseState = "open" | "resolved";
export type GranotBookingCaseEvidenceAction = "priority_5" | "booked" | "release";
export type GranotBookingCaseNoActionReasonCode =
  (typeof GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES)[number];

export type GranotBookingCaseEvidence = {
  observation_id: mongoose.Types.ObjectId;
  decision_id: mongoose.Types.ObjectId;
  captured_at: Date;
  action: GranotBookingCaseEvidenceAction;
};

export type GranotBookingReconciliationCaseDocument = {
  _id: mongoose.Types.ObjectId;
  normalized_job_no: string;
  job_no_snapshot: string;
  action_kind: "booked";
  sequence_number: number;
  mode: (typeof GRANOT_BOOKING_RECONCILIATION_MODES)[number];
  state: GranotBookingCaseState;
  case_revision: number;
  evidence_revision: number;
  source_scope?: {
    granot_crm_source_id: mongoose.Types.ObjectId;
    lead_source_company: mongoose.Types.ObjectId;
    source_granularity_id: mongoose.Types.ObjectId;
  };
  record_link_id?: mongoose.Types.ObjectId;
  deterministic_booking_id?: mongoose.Types.ObjectId;
  evidence: GranotBookingCaseEvidence[];
  observed_context: {
    contact?: { name?: string; phone_number?: string; email?: string };
    move_date?: Date;
    estimated_cubic_feet?: number;
    estimate?: string;
    payment?: string;
    balance?: string;
    granot_priority?: string;
    granot_username?: string;
  };
  suggested_lead?: {
    lead_ref: { model: LeadModel; id: mongoose.Types.ObjectId };
    confidence: "high" | "medium";
    match_method: string;
    reason_codes: string[];
  };
  resolution?: {
    outcome: (typeof GRANOT_BOOKING_RECONCILIATION_OUTCOMES)[number];
    command_execution_id: mongoose.Types.ObjectId;
    actor: DurableActor;
    reason_code?: GranotBookingCaseNoActionReasonCode;
    reason_text?: string;
    resolved_at: Date;
    entity_ref?: EntityRef;
  };
  opened_at: Date;
  last_evidence_at: Date;
  resolved_at?: Date;
  priority_pairing?: {
    pairing: BookingPriorityPairingClass;
    creating_booked_observation_id: mongoose.Types.ObjectId;
    creating_booked_priority_canonical?: string;
    creating_booked_priority_valid: boolean;
    creating_booked_priority_is_5: boolean;
    preceding_priority_5_observation_id?: mongoose.Types.ObjectId;
    preceding_priority_5_captured_at?: Date;
    computed_at: Date;
  };
};

export const GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION =
  "granot_booking_reconciliation_cases";
export const GRANOT_BOOKING_RECONCILIATION_CASE_MODEL_NAME =
  "GranotBookingReconciliationCase";

export const GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES = [
  {
    name: "granot_booking_case_open_job_kind_unique",
    key: { normalized_job_no: 1, action_kind: 1 },
    unique: true,
    partialFilterExpression: { state: "open" },
  },
  {
    name: "granot_booking_case_job_kind_sequence_unique",
    key: { normalized_job_no: 1, action_kind: 1, sequence_number: 1 },
    unique: true,
  },
  {
    name: "granot_booking_case_state_last_evidence",
    key: { state: 1, last_evidence_at: -1 },
  },
  {
    name: "granot_booking_case_booking_state",
    key: { deterministic_booking_id: 1, state: 1 },
  },
  {
    name: "granot_booking_case_suggested_lead_state",
    key: {
      "suggested_lead.lead_ref.model": 1,
      "suggested_lead.lead_ref.id": 1,
      state: 1,
    },
  },
] as const;

const entityRefSchema = new Schema(
  {
    model: { type: String, required: true, enum: ENTITY_REF_MODELS },
    id: { type: String, required: true, trim: true },
  },
  { _id: false },
);

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

const caseEvidenceSchema = new Schema(
  {
    observation_id: { type: Schema.Types.ObjectId, required: true },
    decision_id: { type: Schema.Types.ObjectId, required: true },
    captured_at: { type: Date, required: true },
    action: { type: String, required: true, enum: GRANOT_RECONCILIATION_EVIDENCE_ACTIONS },
  },
  { _id: false },
);

const GranotBookingReconciliationCaseSchema =
  new Schema<GranotBookingReconciliationCaseDocument>(
    {
      normalized_job_no: { type: String, required: true, trim: true },
      job_no_snapshot: { type: String, required: true, trim: true },
      action_kind: { type: String, required: true, enum: ["booked"], default: "booked" },
      sequence_number: { type: Number, required: true, min: 1, validate: Number.isInteger },
      mode: { type: String, required: true, enum: GRANOT_BOOKING_RECONCILIATION_MODES },
      state: { type: String, required: true, enum: GRANOT_RECONCILIATION_CASE_STATES, default: "open" },
      case_revision: { type: Number, required: true, min: 1, validate: Number.isInteger, default: 1 },
      evidence_revision: { type: Number, required: true, min: 1, validate: Number.isInteger, default: 1 },
      source_scope: {
        type: new Schema(
          {
            granot_crm_source_id: { type: Schema.Types.ObjectId, required: true },
            lead_source_company: { type: Schema.Types.ObjectId, required: true },
            source_granularity_id: { type: Schema.Types.ObjectId, required: true },
          },
          { _id: false },
        ),
      },
      record_link_id: { type: Schema.Types.ObjectId },
      deterministic_booking_id: { type: Schema.Types.ObjectId },
      evidence: { type: [caseEvidenceSchema], required: true, default: [] },
      observed_context: {
        type: new Schema(
          {
            contact: {
              type: new Schema(
                {
                  name: { type: String, trim: true },
                  phone_number: { type: String, trim: true },
                  email: { type: String, trim: true },
                },
                { _id: false },
              ),
            },
            move_date: { type: Date },
            estimated_cubic_feet: { type: Number },
            estimate: { type: String, trim: true },
            payment: { type: String, trim: true },
            balance: { type: String, trim: true },
            granot_priority: { type: String, trim: true },
            granot_username: { type: String, trim: true },
          },
          { _id: false },
        ),
        required: true,
        default: {},
      },
      suggested_lead: {
        type: new Schema(
          {
            lead_ref: {
              type: new Schema(
                {
                  model: { type: String, required: true, enum: GRANOT_LEAD_MODELS },
                  id: { type: Schema.Types.ObjectId, required: true },
                },
                { _id: false },
              ),
              required: true,
            },
            confidence: { type: String, required: true, enum: ["high", "medium"] },
            match_method: { type: String, required: true, trim: true },
            reason_codes: { type: [String], required: true, default: [] },
          },
          { _id: false },
        ),
      },
      resolution: {
        type: new Schema(
          {
            outcome: { type: String, required: true, enum: GRANOT_BOOKING_RECONCILIATION_OUTCOMES },
            command_execution_id: { type: Schema.Types.ObjectId, required: true },
            actor: { type: actorSchema, required: true },
            reason_code: { type: String, enum: GRANOT_RECONCILIATION_NO_ACTION_REASON_CODES },
            reason_text: { type: String, trim: true },
            resolved_at: { type: Date, required: true },
            entity_ref: { type: entityRefSchema },
          },
          { _id: false },
        ),
      },
      opened_at: { type: Date, required: true },
      last_evidence_at: { type: Date, required: true },
      resolved_at: { type: Date },
      priority_pairing: {
        type: new Schema(
          {
            pairing: {
              type: String,
              required: true,
              enum: [
                "priority_5_then_booked",
                "booked_carries_priority_5",
                "booked_without_priority_5",
              ],
            },
            creating_booked_observation_id: { type: Schema.Types.ObjectId, required: true },
            creating_booked_priority_canonical: { type: String, trim: true },
            creating_booked_priority_valid: { type: Boolean, required: true },
            creating_booked_priority_is_5: { type: Boolean, required: true },
            preceding_priority_5_observation_id: { type: Schema.Types.ObjectId },
            preceding_priority_5_captured_at: { type: Date },
            computed_at: { type: Date, required: true },
          },
          { _id: false },
        ),
      },
    },
    {
      collection: GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
      timestamps: true,
      strict: true,
      autoIndex: false,
    },
  );

for (const index of GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES) {
  const options: Record<string, unknown> = { name: index.name };
  if ("unique" in index) options.unique = index.unique;
  if ("partialFilterExpression" in index) {
    options.partialFilterExpression = index.partialFilterExpression;
  }
  GranotBookingReconciliationCaseSchema.index(index.key, options);
}

GranotBookingReconciliationCaseSchema.post("init", function rememberImmutableState(doc) {
  doc.$locals.persisted_state = doc.state;
  doc.$locals.persisted_evidence_ids = doc.evidence.map((row) => String(row.observation_id));
});

GranotBookingReconciliationCaseSchema.pre("validate", function rejectForbiddenMutation() {
  if (this.isNew) return;
  if (this.$locals.persisted_state === "resolved") {
    throw new Error("A resolved case is immutable");
  }
  const before = (this.$locals.persisted_evidence_ids ?? []) as string[];
  const current = new Set(this.evidence.map((row) => String(row.observation_id)));
  if (before.some((id) => !current.has(id))) {
    throw new Error("Existing case evidence IDs are immutable");
  }
});

GranotBookingReconciliationCaseSchema.pre(
  ["updateOne", "findOneAndUpdate", "replaceOne"],
  function rejectUnsafeDirectCaseUpdate() {
    const filter = this.getFilter() as Record<string, unknown>;
    const update = this.getUpdate() as Record<string, unknown> | null;
    if (!update) return;
    if (!Object.keys(update).some((key) => key.startsWith("$"))) {
      throw new Error("Booking reconciliation cases cannot be replaced directly");
    }
    if (filter.state !== "open") {
      throw new Error("Booking reconciliation case updates must guard on open state");
    }
    const set = (update.$set ?? {}) as Record<string, unknown>;
    if (set.state === "open") {
      throw new Error("A resolved case cannot return to open");
    }
    if (
      "evidence" in set ||
      "$pull" in update ||
      "$pop" in update
    ) {
      throw new Error("Existing case evidence IDs are immutable");
    }
  },
);

export const GranotBookingReconciliationCase: Model<GranotBookingReconciliationCaseDocument> =
  (mongoose.models[GRANOT_BOOKING_RECONCILIATION_CASE_MODEL_NAME] as
    | Model<GranotBookingReconciliationCaseDocument>
    | undefined) ??
  mongoose.model<GranotBookingReconciliationCaseDocument>(
    GRANOT_BOOKING_RECONCILIATION_CASE_MODEL_NAME,
    GranotBookingReconciliationCaseSchema,
  );

export function getGranotBookingReconciliationCaseModel(): Model<GranotBookingReconciliationCaseDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) return GranotBookingReconciliationCase;
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[GRANOT_BOOKING_RECONCILIATION_CASE_MODEL_NAME] as
      | Model<GranotBookingReconciliationCaseDocument>
      | undefined) ??
    db.model<GranotBookingReconciliationCaseDocument>(
      GRANOT_BOOKING_RECONCILIATION_CASE_MODEL_NAME,
      GranotBookingReconciliationCaseSchema,
    )
  );
}
