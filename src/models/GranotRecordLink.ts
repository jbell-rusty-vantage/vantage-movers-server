import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";
import { normalizeJobNo } from "../services/bookings/bookingIdentity";
import type { LeadModel } from "../services/granotLifecycle/types";
import {
  GRANOT_LEAD_MODELS,
  RECORD_LINK_STATES,
} from "./granotLifecycleSchemas";

export type GranotRecordLinkState = (typeof RECORD_LINK_STATES)[number];

export type GranotRecordLinkLeadRef = {
  model: LeadModel;
  id: mongoose.Types.ObjectId;
};

export type GranotRecordLinkSourceScope = {
  lead_source_company: mongoose.Types.ObjectId;
  source_granularity_id: mongoose.Types.ObjectId;
};

export type GranotRecordLinkDocument = {
  _id: mongoose.Types.ObjectId;
  provider: "granot";
  normalized_job_no: string;
  job_no_snapshot: string;
  state: GranotRecordLinkState;
  lead_ref?: GranotRecordLinkLeadRef;
  booking_ref?: mongoose.Types.ObjectId;
  source_scope?: GranotRecordLinkSourceScope;
  disputed: boolean;
  dispute_reason?: string;
  established_by_decision_id: mongoose.Types.ObjectId;
  established_at: Date;
  last_observation_id: mongoose.Types.ObjectId;
  last_observed_at: Date;
  domain_revision: number;
  last_change_id?: mongoose.Types.ObjectId;
  last_changed_at?: Date;
  superseded_by?: mongoose.Types.ObjectId;
};

export const GRANOT_RECORD_LINK_COLLECTION = "granot_record_links";
export const GRANOT_RECORD_LINK_MODEL_NAME = "GranotRecordLink";

export const GRANOT_RECORD_LINK_INDEXES = [
  {
    name: "granot_record_link_active_job_unique",
    key: { provider: 1, normalized_job_no: 1 },
    unique: true,
    partialFilterExpression: { state: "active" },
  },
  {
    name: "granot_record_link_lead_state",
    key: { "lead_ref.model": 1, "lead_ref.id": 1, state: 1 },
  },
  {
    name: "granot_record_link_booking_state",
    key: { booking_ref: 1, state: 1 },
  },
] as const;

const ALLOWED_RECORD_LINK_SET_PATHS = new Set([
  "last_observation_id",
  "last_observed_at",
  "lead_ref",
  "source_scope",
  "disputed",
  "dispute_reason",
  "last_change_id",
  "last_changed_at",
  "domain_revision",
  "state",
  "superseded_by",
  "updatedAt",
]);

export function assertAllowlistedRecordLinkRefreshUpdate(update: unknown): void {
  if (update == null || typeof update !== "object" || Array.isArray(update)) {
    throw new Error("GranotRecordLink updates must use allowlisted refresh operators");
  }
  const document = update as Record<string, unknown>;
  if ("$setOnInsert" in document) {
    throw new Error("GranotRecordLink upsert-after-existence is forbidden");
  }
  const operators = Object.keys(document).filter((key) => key.startsWith("$"));
  if (operators.length === 0) {
    throw new Error("GranotRecordLink replacement updates are forbidden");
  }
  for (const operator of operators) {
    if (operator !== "$set" && operator !== "$inc") {
      throw new Error("GranotRecordLink updates must use allowlisted refresh operators");
    }
  }
  const set = document.$set;
  if (set != null) {
    if (typeof set !== "object" || Array.isArray(set)) {
      throw new Error("GranotRecordLink $set must be an object");
    }
    for (const path of Object.keys(set as Record<string, unknown>)) {
      if (!ALLOWED_RECORD_LINK_SET_PATHS.has(path)) {
        throw new Error(`GranotRecordLink cannot update ${path}`);
      }
    }
    const values = set as Record<string, unknown>;
    if ("state" in values || "superseded_by" in values) {
      if (values.state !== "superseded" || !(values.superseded_by instanceof mongoose.Types.ObjectId)) {
        throw new Error("Record Link correction must atomically set superseded state and superseded_by");
      }
    }
  }
  const inc = document.$inc;
  if (inc != null) {
    if (typeof inc !== "object" || Array.isArray(inc)) {
      throw new Error("GranotRecordLink $inc must be an object");
    }
    const paths = Object.keys(inc as Record<string, unknown>);
    if (paths.some((path) => path !== "domain_revision")) {
      throw new Error("GranotRecordLink $inc may only advance domain_revision");
    }
  }
}

const GranotRecordLinkSchema = new Schema<GranotRecordLinkDocument>(
  {
    provider: { type: String, required: true, enum: ["granot"] },
    normalized_job_no: { type: String, required: true, trim: true },
    job_no_snapshot: { type: String, required: true, trim: true, maxlength: 64 },
    state: { type: String, required: true, enum: RECORD_LINK_STATES },
    lead_ref: {
      type: new Schema(
        {
          model: { type: String, required: true, enum: GRANOT_LEAD_MODELS },
          id: { type: Schema.Types.ObjectId, required: true },
        },
        { _id: false },
      ),
    },
    booking_ref: { type: Schema.Types.ObjectId },
    source_scope: {
      type: new Schema(
        {
          lead_source_company: { type: Schema.Types.ObjectId, required: true },
          source_granularity_id: { type: Schema.Types.ObjectId, required: true },
        },
        { _id: false },
      ),
    },
    disputed: { type: Boolean, required: true, default: false },
    dispute_reason: { type: String, trim: true },
    established_by_decision_id: { type: Schema.Types.ObjectId, required: true },
    established_at: { type: Date, required: true },
    last_observation_id: { type: Schema.Types.ObjectId, required: true },
    last_observed_at: { type: Date, required: true },
    domain_revision: { type: Number, required: true, min: 0, default: 0 },
    last_change_id: { type: Schema.Types.ObjectId },
    last_changed_at: { type: Date },
    superseded_by: { type: Schema.Types.ObjectId },
  },
  {
    collection: GRANOT_RECORD_LINK_COLLECTION,
    timestamps: false,
    strict: true,
    autoIndex: false,
  },
);

GranotRecordLinkSchema.pre("validate", function validateJobSnapshot() {
  const normalizedSnapshot = normalizeJobNo(this.job_no_snapshot);
  if (!normalizedSnapshot || normalizedSnapshot !== this.normalized_job_no) {
    throw new Error("job_no_snapshot must normalize back to normalized_job_no");
  }
});

for (const index of GRANOT_RECORD_LINK_INDEXES) {
  const options: Record<string, unknown> = { name: index.name };
  if ("unique" in index) {
    options.unique = true;
  }
  if ("partialFilterExpression" in index) {
    options.partialFilterExpression = index.partialFilterExpression;
  }
  GranotRecordLinkSchema.index(index.key, options);
}

for (const operation of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
] as const) {
  GranotRecordLinkSchema.pre(operation, function rejectForbiddenLinkUpdate() {
    const query = this as { getUpdate?: () => unknown; getOptions?: () => { upsert?: boolean } };
    if (query.getOptions?.().upsert) {
      throw new Error("GranotRecordLink upsert-after-existence is forbidden");
    }
    assertAllowlistedRecordLinkRefreshUpdate(query.getUpdate?.());
  });
}

for (const operation of [
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  GranotRecordLinkSchema.pre(operation, function rejectLinkReplaceOrDelete() {
    throw new Error("GranotRecordLink cannot be replaced or deleted");
  });
}

export const GranotRecordLink: Model<GranotRecordLinkDocument> =
  (mongoose.models[GRANOT_RECORD_LINK_MODEL_NAME] as
    | Model<GranotRecordLinkDocument>
    | undefined) ??
  mongoose.model<GranotRecordLinkDocument>(
    GRANOT_RECORD_LINK_MODEL_NAME,
    GranotRecordLinkSchema,
  );

export function getGranotRecordLinkModel(): Model<GranotRecordLinkDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotRecordLink;
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[GRANOT_RECORD_LINK_MODEL_NAME] as
      | Model<GranotRecordLinkDocument>
      | undefined) ??
    db.model<GranotRecordLinkDocument>(
      GRANOT_RECORD_LINK_MODEL_NAME,
      GranotRecordLinkSchema,
    )
  );
}
