import { Schema, type Query } from "mongoose";
import { salesOutreachConfigurationValueSchema } from "../../validation/v1/salesOutreach";
import { actor, defineCsiModel, enumeration, text, unique } from "../salesIntelligence/common";

/**
 * `sales_outreach_configuration` — the desk's only policy authority (CONTRACTS "Persisted
 * configuration", IMPLEMENTATION-PLAN §4.8). Two document kinds share the collection:
 *
 * - `version` (`key: "version:<version>"`): immutable full value + content hash + actor.
 * - `pointer` (`key: "active"`): `{ version, content_hash, revision, updated_by }` (+ `updatedAt`),
 *   moved only by a CAS on `revision` in the same transaction as the new version, the command
 *   ledger row and the audit event. Carrying the version's hash lets every reader fetch only the
 *   pointer and reuse an immutable cached version keyed by version + hash.
 *
 * Kind-aware guards: a version document can only be inserted. Updates, replaces and deletes must
 * target the pointer (`kind: "pointer"` in the filter); bulk writes are refused. The model is not
 * registered append-only, which would also freeze the pointer.
 */
export const SALES_OUTREACH_CONFIGURATION_KINDS = ["version", "pointer"] as const;
export const SALES_OUTREACH_CONFIGURATION_POINTER_KEY = "active" as const;
export const salesOutreachConfigurationVersionKey = (version: string) => `version:${version}`;

export const SALES_OUTREACH_CONFIGURATION_INDEXES = [unique("sod_configuration_key_unique", { key: 1 })];

const optionalNumber = { type: Number, default: null } as const;

export const SalesOutreachConfigurationSchema = new Schema(
  {
    kind: enumeration(SALES_OUTREACH_CONFIGURATION_KINDS),
    key: { type: String, required: true, trim: true },
    version: { type: String, required: true, trim: true },
    // version documents
    schema_version: optionalNumber,
    value: {
      type: Schema.Types.Mixed,
      default: null,
      validate: {
        validator: (v: unknown) => v === null || salesOutreachConfigurationValueSchema.safeParse(v).success,
        message: "Invalid sales outreach configuration value",
      },
    },
    // both kinds: the version's content hash
    content_hash: text,
    approval_ref: text,
    created_by: { type: actor, default: null },
    // pointer document
    revision: optionalNumber,
    updated_by: text,
  },
  { collection: "sales_outreach_configuration" },
);

SalesOutreachConfigurationSchema.pre("validate", function () {
  if (this.kind === "version") {
    if (
      this.key !== salesOutreachConfigurationVersionKey(this.version) ||
      this.schema_version !== 1 ||
      this.value === null ||
      !this.content_hash ||
      !this.created_by ||
      this.revision !== null
    )
      throw new Error("Invalid sales outreach configuration version document");
  } else if (
    this.key !== SALES_OUTREACH_CONFIGURATION_POINTER_KEY ||
    !Number.isSafeInteger(this.revision) ||
    (this.revision ?? 0) < 1 ||
    this.value !== null ||
    !this.content_hash
  ) {
    throw new Error("Invalid sales outreach configuration pointer document");
  }
});
SalesOutreachConfigurationSchema.pre("save", function () {
  if (!this.isNew && this.kind === "version") throw new Error("Sales outreach configuration versions are immutable");
});
function requirePointerFilter(this: Query<unknown, unknown>) {
  const filter = this.getFilter() as { kind?: unknown };
  if (filter.kind !== "pointer") throw new Error("Sales outreach configuration versions are immutable");
}
SalesOutreachConfigurationSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"],
  requirePointerFilter,
);
SalesOutreachConfigurationSchema.pre("bulkWrite", function () {
  throw new Error("Sales outreach configuration bulk mutation is forbidden");
});

export const getSalesOutreachConfigurationModel = defineCsiModel(
  "SalesOutreachConfiguration",
  SalesOutreachConfigurationSchema,
  SALES_OUTREACH_CONFIGURATION_INDEXES,
);
