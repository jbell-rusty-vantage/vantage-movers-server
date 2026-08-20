import mongoose, {
  Schema,
  type InferSchemaType,
  type Model,
} from "mongoose";

const COMMAND_ORIGINS = [
  "external_sheet_ingestion",
  "vantage_admin",
  "granot_lifecycle",
  "ringcentral",
] as const;

const EntityReferenceSchema = new Schema(
  {
    model: { type: String, required: true, trim: true },
    id: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const StoredCommandResultSchema = new Schema(
  {
    status: {
      type: String,
      required: true,
      enum: ["applied"],
    },
    entity_refs: {
      type: [EntityReferenceSchema],
      required: true,
      default: [],
    },
    warnings: { type: [String], required: true, default: [] },
  },
  { _id: false },
);

const DomainCommandExecutionSchema = new Schema(
  {
    origin: {
      type: String,
      required: true,
      enum: COMMAND_ORIGINS,
    },
    idempotency_key: { type: String, required: true, trim: true },
    command_id: { type: String, required: true, trim: true },
    command_name: { type: String, required: true, trim: true },
    payload_checksum: { type: String, required: true, trim: true },
    actor: { type: Schema.Types.Mixed, required: true },
    initiator: { type: Schema.Types.Mixed, required: true },
    provenance: { type: Schema.Types.Mixed, required: true },
    result: { type: StoredCommandResultSchema, required: false },
    entity_refs: {
      type: [EntityReferenceSchema],
      required: true,
      default: [],
    },
    warnings: { type: [String], required: true, default: [] },
    applied_at: { type: Date, required: true },
  },
  {
    collection: "domain_command_executions",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

export const DOMAIN_COMMAND_EXECUTION_COLLECTION = "domain_command_executions";
export const DOMAIN_COMMAND_EXECUTION_INDEXES = [
  { name: "domain_command_origin", key: { origin: 1 } },
  { name: "domain_command_command_id_unique", key: { command_id: 1 }, unique: true },
  { name: "domain_command_origin_idempotency_unique", key: { origin: 1, idempotency_key: 1 }, unique: true },
  { name: "domain_command_applied_at", key: { applied_at: -1 } },
] as const;

for (const index of DOMAIN_COMMAND_EXECUTION_INDEXES) {
  DomainCommandExecutionSchema.index(index.key, {
    name: index.name,
    ...("unique" in index ? { unique: index.unique } : {}),
  });
}

export type DomainCommandExecutionDocument = InferSchemaType<
  typeof DomainCommandExecutionSchema
> & {
  _id: mongoose.Types.ObjectId;
};

export const DomainCommandExecution: Model<DomainCommandExecutionDocument> =
  mongoose.models.DomainCommandExecution ??
  mongoose.model<DomainCommandExecutionDocument>(
    "DomainCommandExecution",
    DomainCommandExecutionSchema,
  );

export function readStoredCanonicalCommandResult(document: {
  result?: {
    status?: string;
    entity_refs?: Array<{ model: string; id: string }>;
    warnings?: string[];
  } | null;
  entity_refs?: Array<{ model: string; id: string }>;
  warnings?: string[];
}): {
  status: "applied";
  entity_refs: Array<{ model: string; id: string }>;
  warnings: string[];
} {
  if (document.result?.status === "applied") {
    return {
      status: "applied",
      entity_refs: (document.result.entity_refs ?? []).map((entry) => ({
        model: entry.model,
        id: entry.id,
      })),
      warnings: [...(document.result.warnings ?? [])],
    };
  }
  return {
    status: "applied",
    entity_refs: (document.entity_refs ?? []).map((entry) => ({
      model: entry.model,
      id: entry.id,
    })),
    warnings: [...(document.warnings ?? [])],
  };
}
