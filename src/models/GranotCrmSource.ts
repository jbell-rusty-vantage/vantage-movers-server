import mongoose, {
  Schema,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from "mongoose";
import {
  GRANOT_CRM_CSV_KINDS,
  OUTBOUND_SMS_CONSENT_BASES,
  OUTBOUND_SMS_TRIGGERS,
  getMongoDatabaseName,
  type GranotCrmCsvKind,
} from "../config/domain";
import { sourceCompanyField } from "./schemaHelpers";
import {
  GRANOT_LEAD_CREATED_POLICIES,
  GRANOT_LIFECYCLE_DISPOSITIONS,
  GRANOT_LIFECYCLE_LEAD_MODELS,
  GRANOT_LIFECYCLE_MOVE_TYPES,
  validateGranotCrmSourceSemantics,
  type GranotCrmSourceRouteInput,
} from "./granotCrmSourceSemantics";

export const GRANOT_CRM_CHANNELS = ["form", "call", "unknown"] as const;
export const GRANOT_CRM_SOURCE_COLLECTION = "granot_crm_sources";
export const GRANOT_CRM_SOURCE_MODEL_NAME = "GranotCrmSource";

export const GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES = [
  {
    name: "granot_crm_source_normalized_label_unique",
    key: { normalized_granot_label: 1 },
    unique: true,
  },
  {
    name: "granot_crm_source_lifecycle_disposition_label",
    key: {
      lifecycle_enabled: 1,
      lifecycle_disposition: 1,
      normalized_granot_label: 1,
    },
  },
  {
    name: "granot_crm_source_lifecycle_route_granularity",
    key: { "lifecycle_routes.source_granularity_id": 1 },
  },
] as const;

const csvPathsSchema = new Schema(
  {
    follow_up: { type: String, trim: true },
    booked: { type: String, trim: true },
  },
  { _id: false },
);

const lastIngestionSchema = new Schema(
  {
    content_sha256: { type: String, trim: true },
    ingestion_id: { type: Schema.Types.ObjectId, ref: "GranotCrmCsvIngestion" },
    s3_key: { type: String, trim: true },
    imported_at: { type: Date },
  },
  { _id: false },
);

const outboundSmsActorSchema = new Schema(
  {
    actor_type: { type: String, trim: true },
    actor_id: { type: String, trim: true },
    actor_label: { type: String, trim: true },
    actor_role: { type: String, trim: true },
  },
  { _id: false },
);

const outboundSmsSchema = new Schema(
  {
    enabled: { type: Boolean, required: true, default: false },
    trigger: {
      type: String,
      required: true,
      enum: OUTBOUND_SMS_TRIGGERS,
      default: "granot_lead_created",
    },
    body_template: { type: String, trim: true, maxlength: 320 },
    template_version: { type: Number, required: true, default: 1 },
    consent_basis: {
      type: String,
      required: true,
      enum: OUTBOUND_SMS_CONSENT_BASES,
      default: "not_attested",
    },
    consent_attested_by: { type: outboundSmsActorSchema },
    consent_attested_at: { type: Date },
    daily_cap: { type: Number, required: true, default: 0, min: 0 },
    activated_at: { type: Date },
    deactivated_at: { type: Date },
    deactivation_reason: { type: String, trim: true },
  },
  { _id: false },
);

const lifecycleRouteSchema = new Schema(
  {
    route_key: { type: String, required: true, trim: true },
    lead_model: {
      type: String,
      required: true,
      enum: GRANOT_LIFECYCLE_LEAD_MODELS,
    },
    move_type: {
      type: String,
      required: true,
      enum: GRANOT_LIFECYCLE_MOVE_TYPES,
    },
    source_granularity_id: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "LeadSourceGranularity",
    },
  },
  { _id: false },
);

const GranotCrmSourceSchema = new Schema(
  {
    crm_origin: { type: String, required: true, trim: true, index: true },
    workspace_slug: { type: String, required: true, trim: true, index: true },
    granot_label: { type: String, required: true, trim: true },
    default_channel: {
      type: String,
      enum: GRANOT_CRM_CHANNELS,
      required: true,
      default: "unknown",
    },
    source_company: sourceCompanyField,
    csv_paths: { type: csvPathsSchema, default: {} },
    enabled: { type: Boolean, required: true, default: true, index: true },
    notes: { type: String, trim: true },
    last_ingestions: {
      follow_up: { type: lastIngestionSchema },
      booked: { type: lastIngestionSchema },
    },
    normalized_granot_label: { type: String, trim: true, lowercase: true },
    lifecycle_enabled: { type: Boolean, required: true, default: false },
    lifecycle_disposition: {
      type: String,
      required: true,
      enum: GRANOT_LIFECYCLE_DISPOSITIONS,
      default: "deferred",
    },
    lead_created_policy: {
      type: String,
      required: true,
      enum: GRANOT_LEAD_CREATED_POLICIES,
      default: "observation_only",
    },
    lead_source_company: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceCompany",
    },
    lifecycle_routes: { type: [lifecycleRouteSchema], default: [] },
    lifecycle_policy_version: { type: String, trim: true, default: "" },
    outbound_sms: { type: outboundSmsSchema },
  },
  {
    collection: GRANOT_CRM_SOURCE_COLLECTION,
    timestamps: true,
    autoIndex: false,
  },
);

GranotCrmSourceSchema.index(
  { crm_origin: 1, workspace_slug: 1 },
  { unique: true },
);
for (const csvKind of GRANOT_CRM_CSV_KINDS) {
  GranotCrmSourceSchema.index({ [`csv_paths.${csvKind}`]: 1 });
}
for (const index of GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES) {
  const options: Record<string, unknown> = { name: index.name };
  if ("unique" in index) {
    options.unique = true;
  }
  GranotCrmSourceSchema.index(index.key, options);
}

GranotCrmSourceSchema.pre("validate", function validateLifecycleSemantics() {
  const routes = ((this.lifecycle_routes ?? []) as Array<{
    route_key?: string;
    lead_model?: string;
    move_type?: string;
    source_granularity_id?: mongoose.Types.ObjectId;
  }>).map((route) => ({
    route_key: String(route.route_key ?? ""),
    lead_model: route.lead_model as GranotCrmSourceRouteInput["lead_model"],
    move_type: route.move_type as GranotCrmSourceRouteInput["move_type"],
    source_granularity_id: String(route.source_granularity_id ?? ""),
  }));
  const result = validateGranotCrmSourceSemantics({
    granot_label: this.granot_label,
    normalized_granot_label: this.normalized_granot_label || undefined,
    enabled: this.enabled !== false,
    lifecycle_enabled: this.lifecycle_enabled === true,
    lifecycle_disposition: this.lifecycle_disposition ?? "deferred",
    lead_created_policy: this.lead_created_policy ?? "observation_only",
    lead_source_company: this.lead_source_company
      ? String(this.lead_source_company)
      : undefined,
    lifecycle_routes: routes,
    lifecycle_policy_version: this.lifecycle_policy_version || undefined,
  });
  if (!result.ok) {
    this.invalidate("lifecycle_disposition", result.message);
  }
});

type GranotCrmLastIngestion = {
  content_sha256?: string;
  ingestion_id?: mongoose.Types.ObjectId;
  s3_key?: string;
  imported_at?: Date;
};

export type GranotCrmSource = Omit<
  InferSchemaType<typeof GranotCrmSourceSchema>,
  "last_ingestions"
> & {
  _id: mongoose.Types.ObjectId;
  last_ingestions?: Partial<Record<GranotCrmCsvKind, GranotCrmLastIngestion>>;
};

export type GranotCrmSourceDocument = HydratedDocument<GranotCrmSource>;

export const GranotCrmSource: Model<GranotCrmSourceDocument> =
  mongoose.models.GranotCrmSource ??
  mongoose.model<GranotCrmSourceDocument>(
    GRANOT_CRM_SOURCE_MODEL_NAME,
    GranotCrmSourceSchema,
  );

export function getGranotCrmSourceModel(): Model<GranotCrmSourceDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return GranotCrmSource;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.GranotCrmSource as Model<GranotCrmSourceDocument> | undefined) ??
    db.model<GranotCrmSourceDocument>(
      GRANOT_CRM_SOURCE_MODEL_NAME,
      GranotCrmSourceSchema,
    )
  );
}
