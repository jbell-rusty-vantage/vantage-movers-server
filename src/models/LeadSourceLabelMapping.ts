import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain";
import { normalizeSourceLabel } from "../services/operationsRegistry/sourceLabelNormalize";

export const LABEL_MAPPING_NAMESPACES = [
  "sheet_lead_source",
  "legacy_api_source",
] as const;

export type LabelMappingNamespace = (typeof LABEL_MAPPING_NAMESPACES)[number];

const registryActorContextSchema = new Schema(
  {
    actor_type: {
      type: String,
      required: true,
      enum: ["owner", "admin", "system"],
    },
    actor_id: { type: String, required: true, trim: true },
    actor_label: { type: String, required: true, trim: true },
    actor_role: { type: String, required: true, trim: true, lowercase: true },
    request_id: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const IMMUTABLE_AFTER_CREATE = [
  "label",
  "namespace",
  "source_company",
  "source_granularity",
] as const;

const LeadSourceLabelMappingSchema = new Schema(
  {
    label: { type: String, required: true, immutable: true },
    normalized_label: {
      type: String,
      required: true,
      validate: {
        validator(this: { label?: string }, value: string) {
          return value === normalizeSourceLabel(this.label ?? "");
        },
        message: "normalized_label must equal normalizeSourceLabel(label)",
      },
    },
    namespace: {
      type: String,
      required: true,
      enum: LABEL_MAPPING_NAMESPACES,
      immutable: true,
    },
    source_company: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceCompany",
      required: true,
      immutable: true,
    },
    source_granularity: {
      type: Schema.Types.ObjectId,
      ref: "LeadSourceGranularity",
      required: true,
      immutable: true,
    },
    active: { type: Boolean, required: true, default: true, index: true },
    created_by: {
      type: registryActorContextSchema,
      required: true,
      immutable: true,
    },
    change_reason: { type: String, trim: true, minlength: 10, maxlength: 1000 },
    archived_at: { type: Date },
  },
  {
    collection: "lead_source_label_mappings",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

LeadSourceLabelMappingSchema.index(
  { namespace: 1, normalized_label: 1 },
  {
    unique: true,
    partialFilterExpression: { active: true },
    name: "lead_source_label_mappings_active_namespace_normalized_label_unique",
  },
);
LeadSourceLabelMappingSchema.index({ source_granularity: 1, active: 1 });
LeadSourceLabelMappingSchema.index({ source_company: 1, active: 1 });

LeadSourceLabelMappingSchema.pre("validate", function rejectImmutableEdits() {
  if (this.isNew) {
    return;
  }
  for (const field of IMMUTABLE_AFTER_CREATE) {
    if (this.isModified(field)) {
      throw new Error(
        `${field} is immutable after create. Deactivate this mapping and create a replacement.`,
      );
    }
  }
});

export type LeadSourceLabelMappingDocument = InferSchemaType<
  typeof LeadSourceLabelMappingSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const LeadSourceLabelMapping: Model<LeadSourceLabelMappingDocument> =
  mongoose.models.LeadSourceLabelMapping ??
  mongoose.model<LeadSourceLabelMappingDocument>(
    "LeadSourceLabelMapping",
    LeadSourceLabelMappingSchema,
  );

export function getLeadSourceLabelMappingModel(): Model<LeadSourceLabelMappingDocument> {
  const dbName = getMongoDatabaseName();
  if (mongoose.connection.name === dbName) {
    return LeadSourceLabelMapping;
  }

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models.LeadSourceLabelMapping as
      | Model<LeadSourceLabelMappingDocument>
      | undefined) ??
    db.model<LeadSourceLabelMappingDocument>(
      "LeadSourceLabelMapping",
      LeadSourceLabelMappingSchema,
    )
  );
}
