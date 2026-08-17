import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import type {
  GranotBookingAction,
  GranotObservationKind,
  GranotRouteEventClass,
  NormalizationIssueCode,
  NormalizationResult,
} from "../services/granotLifecycle/types";
import {
  GRANOT_BOOKING_ACTIONS,
  NORMALIZATION_ISSUE_CODES,
  NORMALIZATION_ISSUE_SEVERITIES,
  NORMALIZATION_RESULTS,
  OBSERVATION_KINDS,
  ROUTE_EVENT_CLASSES,
} from "./granotLifecycleSchemas";

export type GranotObservationIssueSeverity =
  (typeof NORMALIZATION_ISSUE_SEVERITIES)[number];

export type GranotObservationIssue = {
  code: NormalizationIssueCode;
  path?: string;
  severity: GranotObservationIssueSeverity;
};

export type GranotObservationIdentity = {
  job_no_raw?: string;
  normalized_job_no?: string;
  form_ref_raw?: string;
  normalized_form_ref?: string;
};

export type GranotObservationContact = {
  first_name?: string;
  last_name?: string;
  display_name?: string;
  phone_raw?: string;
  normalized_phone?: string;
  email_raw?: string;
  normalized_email?: string;
};

export type GranotObservationLocation = {
  city?: string;
  state?: string;
  zip?: string;
};

export type GranotObservationMove = {
  move_date_raw?: string;
  move_date?: Date;
  service_type_raw?: string;
  granot_move_size_raw?: string;
  estimated_cubic_feet_raw?: string;
  estimated_cubic_feet?: number;
  origin?: GranotObservationLocation;
  destination?: GranotObservationLocation;
};

export type GranotObservationPriority = {
  raw?: unknown;
  canonical?: string;
  valid: boolean;
};

export type GranotObservationBookingAction = {
  raw?: string;
  normalized?: GranotBookingAction;
};

export type GranotObservationDisplayMoneyAmount = {
  raw: string;
  canonical?: string;
};

export type GranotObservationDisplayMoney = {
  estimate?: GranotObservationDisplayMoneyAmount;
  payment?: GranotObservationDisplayMoneyAmount;
  balance?: GranotObservationDisplayMoneyAmount;
};

export type GranotObservationDocument = {
  _id: mongoose.Types.ObjectId;
  receipt_id: mongoose.Types.ObjectId;
  schema_version: 1;
  kind: GranotObservationKind;
  normalization_result: NormalizationResult;
  route_event_class?: GranotRouteEventClass;
  payload_event_type_raw?: string;
  source_label_raw?: string;
  normalized_source_label?: string;
  granot_crm_source_id?: mongoose.Types.ObjectId;
  captured_at: Date;
  identity: GranotObservationIdentity;
  contact: GranotObservationContact;
  move: GranotObservationMove;
  priority: GranotObservationPriority;
  booking_action: GranotObservationBookingAction;
  display_money: GranotObservationDisplayMoney;
  agent_identity: { user_raw?: string; rep_raw?: string };
  provider_context: { type_raw?: string };
  issues: GranotObservationIssue[];
  createdAt: Date;
  updatedAt: Date;
};

export const GRANOT_OBSERVATION_COLLECTION = "granot_observations";
export const GRANOT_OBSERVATION_MODEL_NAME = "GranotObservation";

export const GRANOT_OBSERVATION_INDEXES = [
  {
    name: "granot_observation_receipt_id_unique",
    key: { receipt_id: 1 },
    unique: true,
  },
  {
    name: "granot_observation_kind_captured",
    key: { kind: 1, captured_at: -1 },
  },
  {
    name: "granot_observation_normalized_job_no_captured",
    key: { "identity.normalized_job_no": 1, captured_at: -1 },
  },
  {
    name: "granot_observation_source_route_captured",
    key: { normalized_source_label: 1, route_event_class: 1, captured_at: -1 },
  },
  {
    name: "granot_observation_normalized_form_ref_captured",
    key: { "identity.normalized_form_ref": 1, captured_at: -1 },
  },
  {
    name: "granot_observation_normalized_phone_captured",
    key: { "contact.normalized_phone": 1, captured_at: -1 },
  },
] as const;

const locationSchema = new Schema(
  {
    city: { type: String },
    state: { type: String },
    zip: { type: String },
  },
  { _id: false },
);

const displayMoneyAmountSchema = new Schema(
  {
    raw: { type: String, required: true },
    canonical: { type: String },
  },
  { _id: false },
);

const issueSchema = new Schema(
  {
    code: { type: String, required: true, enum: NORMALIZATION_ISSUE_CODES },
    path: { type: String },
    severity: {
      type: String,
      required: true,
      enum: NORMALIZATION_ISSUE_SEVERITIES,
    },
  },
  { _id: false },
);

const GranotObservationSchema = new Schema(
  {
    receipt_id: { type: Schema.Types.ObjectId, required: true },
    schema_version: { type: Number, required: true, enum: [1] },
    kind: { type: String, required: true, enum: OBSERVATION_KINDS },
    normalization_result: {
      type: String,
      required: true,
      enum: NORMALIZATION_RESULTS,
    },
    route_event_class: { type: String, enum: ROUTE_EVENT_CLASSES },
    payload_event_type_raw: { type: String },
    source_label_raw: { type: String },
    normalized_source_label: { type: String },
    granot_crm_source_id: { type: Schema.Types.ObjectId },
    captured_at: { type: Date, required: true },
    identity: {
      type: new Schema(
        {
          job_no_raw: { type: String },
          normalized_job_no: { type: String },
          form_ref_raw: { type: String },
          normalized_form_ref: { type: String },
        },
        { _id: false },
      ),
      required: true,
      default: {},
    },
    contact: {
      type: new Schema(
        {
          first_name: { type: String },
          last_name: { type: String },
          display_name: { type: String },
          phone_raw: { type: String },
          normalized_phone: { type: String },
          email_raw: { type: String },
          normalized_email: { type: String },
        },
        { _id: false },
      ),
      required: true,
      default: {},
    },
    move: {
      type: new Schema(
        {
          move_date_raw: { type: String },
          move_date: { type: Date },
          service_type_raw: { type: String },
          granot_move_size_raw: { type: String },
          estimated_cubic_feet_raw: { type: String },
          estimated_cubic_feet: { type: Number },
          origin: { type: locationSchema },
          destination: { type: locationSchema },
        },
        { _id: false },
      ),
      required: true,
      default: {},
    },
    priority: {
      type: new Schema(
        {
          raw: { type: Schema.Types.Mixed },
          canonical: { type: String },
          valid: { type: Boolean, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    booking_action: {
      type: new Schema(
        {
          raw: { type: String },
          normalized: { type: String, enum: GRANOT_BOOKING_ACTIONS },
        },
        { _id: false },
      ),
      required: true,
      default: {},
    },
    display_money: {
      type: new Schema(
        {
          estimate: { type: displayMoneyAmountSchema },
          payment: { type: displayMoneyAmountSchema },
          balance: { type: displayMoneyAmountSchema },
        },
        { _id: false },
      ),
      required: true,
      default: {},
    },
    agent_identity: {
      type: new Schema(
        {
          user_raw: { type: String },
          rep_raw: { type: String },
        },
        { _id: false },
      ),
      required: true,
      default: {},
    },
    provider_context: {
      type: new Schema(
        {
          type_raw: { type: String },
        },
        { _id: false },
      ),
      required: true,
      default: {},
    },
    issues: { type: [issueSchema], required: true, default: [] },
  },
  {
    collection: GRANOT_OBSERVATION_COLLECTION,
    timestamps: true,
    strict: true,
  },
);

for (const index of GRANOT_OBSERVATION_INDEXES) {
  const options: Record<string, unknown> = { name: index.name };
  if ("unique" in index) {
    options.unique = true;
  }
  GranotObservationSchema.index(index.key, options);
}

GranotObservationSchema.pre("save", function rejectEvidenceMutation() {
  if (this.isNew) {
    return;
  }
  throw new Error("GranotObservation evidence is write-once");
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
  GranotObservationSchema.pre(operation, function rejectObservationMutation() {
    throw new Error("GranotObservation evidence cannot be updated, replaced, or deleted");
  });
}

export const GranotObservation: Model<GranotObservationDocument> =
  (mongoose.models[GRANOT_OBSERVATION_MODEL_NAME] as
    | Model<GranotObservationDocument>
    | undefined) ??
  mongoose.model<GranotObservationDocument>(
    GRANOT_OBSERVATION_MODEL_NAME,
    GranotObservationSchema,
  );

export function getGranotObservationModel(): Model<GranotObservationDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotObservation;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[GRANOT_OBSERVATION_MODEL_NAME] as
      | Model<GranotObservationDocument>
      | undefined) ??
    db.model<GranotObservationDocument>(
      GRANOT_OBSERVATION_MODEL_NAME,
      GranotObservationSchema,
    )
  );
}
