import mongoose, { Schema, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";

/**
 * Bounded aggregate state behind Granot lifecycle Health. Rows are keyed by a
 * deterministic string `_id`, so every write is an atomic upsert on one row:
 *
 * - `coverage`: when counting started, the last successful write, and the
 *   latest instant a counter write was missed.
 * - `bucket:<metric>:<dimension>:<minute>`: one per-minute counter. Metrics and
 *   dimensions come from closed catalogs. Buckets expire after the retention.
 * - `last_run:<trigger>`: the latest queue or cron drain run.
 * - `alert:<code>:<scope>`: persisted alert state for transition dedupe.
 *
 * No per-event rows, payloads, contact fields or free text are stored.
 */
export const GRANOT_LIFECYCLE_HEALTH_STATE_COLLECTION = "granot_lifecycle_health_state";
export const GRANOT_LIFECYCLE_HEALTH_STATE_MODEL_NAME = "GranotLifecycleHealthState";

export const GRANOT_LIFECYCLE_HEALTH_STATE_KINDS = [
  "coverage",
  "bucket",
  "last_run",
  "alert",
] as const;

export const GRANOT_LIFECYCLE_HEALTH_COUNTER_METRICS = [
  "capture_failed",
  "claim_recovered",
  "owner_command_conflict",
] as const;

export const GRANOT_LIFECYCLE_HEALTH_RUN_TRIGGERS = ["queue", "cron"] as const;

export type GranotLifecycleHealthStateKind =
  (typeof GRANOT_LIFECYCLE_HEALTH_STATE_KINDS)[number];
export type GranotLifecycleHealthCounterMetric =
  (typeof GRANOT_LIFECYCLE_HEALTH_COUNTER_METRICS)[number];
export type GranotLifecycleHealthRunTrigger =
  (typeof GRANOT_LIFECYCLE_HEALTH_RUN_TRIGGERS)[number];

export type GranotLifecycleHealthStateDocument = {
  _id: string;
  kind: GranotLifecycleHealthStateKind;
  counters_since?: Date;
  last_write_at?: Date;
  gap_at?: Date;
  metric?: GranotLifecycleHealthCounterMetric;
  dimension?: string;
  bucket_start?: Date;
  count?: number;
  expires_at?: Date;
  trigger?: GranotLifecycleHealthRunTrigger;
  status?: "completed" | "failed";
  at?: Date;
  code?: string;
  scope_ref?: string;
  state?: "firing" | "ok";
  since?: Date;
  transitioned_at?: Date;
};

export const GRANOT_LIFECYCLE_HEALTH_STATE_INDEXES = [
  {
    name: "granot_lifecycle_health_bucket_unique",
    key: { kind: 1, metric: 1, dimension: 1, bucket_start: 1 },
    unique: true,
    partialFilterExpression: { kind: "bucket" },
  },
  {
    name: "granot_lifecycle_health_expires_ttl",
    key: { expires_at: 1 },
    expireAfterSeconds: 0,
  },
] as const;

const GranotLifecycleHealthStateSchema = new Schema<GranotLifecycleHealthStateDocument>(
  {
    _id: { type: String, required: true },
    kind: { type: String, required: true, enum: GRANOT_LIFECYCLE_HEALTH_STATE_KINDS },
    counters_since: { type: Date },
    last_write_at: { type: Date },
    gap_at: { type: Date },
    metric: { type: String, enum: GRANOT_LIFECYCLE_HEALTH_COUNTER_METRICS },
    dimension: { type: String, maxlength: 64 },
    bucket_start: { type: Date },
    count: { type: Number, min: 0 },
    expires_at: { type: Date },
    trigger: { type: String, enum: GRANOT_LIFECYCLE_HEALTH_RUN_TRIGGERS },
    status: { type: String, enum: ["completed", "failed"] },
    at: { type: Date },
    code: { type: String, maxlength: 64 },
    scope_ref: { type: String, maxlength: 64 },
    state: { type: String, enum: ["firing", "ok"] },
    since: { type: Date },
    transitioned_at: { type: Date },
  },
  {
    collection: GRANOT_LIFECYCLE_HEALTH_STATE_COLLECTION,
    strict: true,
    versionKey: false,
  },
);

for (const index of GRANOT_LIFECYCLE_HEALTH_STATE_INDEXES) {
  const { key, ...options } = index;
  GranotLifecycleHealthStateSchema.index(key, options);
}

export const GranotLifecycleHealthState: Model<GranotLifecycleHealthStateDocument> =
  (mongoose.models[GRANOT_LIFECYCLE_HEALTH_STATE_MODEL_NAME] as
    | Model<GranotLifecycleHealthStateDocument>
    | undefined) ??
  mongoose.model<GranotLifecycleHealthStateDocument>(
    GRANOT_LIFECYCLE_HEALTH_STATE_MODEL_NAME,
    GranotLifecycleHealthStateSchema,
  );

export function getGranotLifecycleHealthStateModel(): Model<GranotLifecycleHealthStateDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotLifecycleHealthState;
  }
  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[GRANOT_LIFECYCLE_HEALTH_STATE_MODEL_NAME] as
      | Model<GranotLifecycleHealthStateDocument>
      | undefined) ??
    db.model<GranotLifecycleHealthStateDocument>(
      GRANOT_LIFECYCLE_HEALTH_STATE_MODEL_NAME,
      GranotLifecycleHealthStateSchema,
    )
  );
}
