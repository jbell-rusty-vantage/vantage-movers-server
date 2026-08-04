import mongoose, {
  Schema,
  type InferSchemaType,
  type Model,
} from "mongoose";

const EntityReferenceSchema = new Schema(
  {
    model: { type: String, required: true, trim: true },
    id: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const DomainCommandExecutionSchema = new Schema(
  {
    origin: {
      type: String,
      required: true,
      enum: ["external_sheet_ingestion", "vantage_admin"],
      index: true,
    },
    idempotency_key: { type: String, required: true, trim: true },
    command_id: { type: String, required: true, trim: true, unique: true },
    command_name: { type: String, required: true, trim: true },
    payload_checksum: { type: String, required: true, trim: true },
    actor: { type: Schema.Types.Mixed, required: true },
    initiator: { type: Schema.Types.Mixed, required: true },
    provenance: { type: Schema.Types.Mixed, required: true },
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

DomainCommandExecutionSchema.index(
  { origin: 1, idempotency_key: 1 },
  { unique: true, name: "domain_command_origin_idempotency_unique" },
);
DomainCommandExecutionSchema.index({ applied_at: -1 });

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
