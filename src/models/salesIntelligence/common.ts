import mongoose, {
  Schema,
  type InferSchemaType,
  type IndexDefinition,
  type IndexOptions,
  type SchemaDefinition,
} from "mongoose";
import { z } from "zod";
import { getMongoDatabaseName } from "../../config/domain/runtime";
import { canonicalJson } from "../../services/durableWork/checksum";
export type CsiIndex = {
  key: IndexDefinition;
  name: string;
} & IndexOptions;
export const str = { type: String, required: true, trim: true } as const;
export const text = { type: String, default: null } as const;
export const oid = { type: Schema.Types.ObjectId, required: true } as const;
export const ref = { type: Schema.Types.ObjectId, default: null } as const;
export const date = { type: Date, default: null } as const;
export const at = { type: Date, required: true } as const;
export const revision = {
  type: Number,
  required: true,
  default: 1,
  min: 1,
  validate: Number.isSafeInteger,
} as const;
export const count = {
  type: Number,
  required: true,
  default: 0,
  min: 0,
  validate: Number.isSafeInteger,
} as const;
export const strings = { type: [String], default: [] };
export const refs = { type: [Schema.Types.ObjectId], default: [] };
export const enumeration = <T extends string>(
  values: readonly T[],
  fallback?: T,
) => ({
  type: String,
  required: true,
  enum: [...values],
  ...(fallback ? { default: fallback } : {}),
});
/** JSON is permitted only for captured redacted evidence/audit values; effectful assertions use their strict Zod validator. */
export const validatedJson = (validator: z.ZodType = z.json()) => ({
  type: Schema.Types.Mixed,
  required: true,
  validate: {
    validator: (v: unknown) => validator.safeParse(v).success,
    message: "Invalid CSI structured value",
  },
});
export const subject = new Schema(
  {
    kind: enumeration(["lead", "number_review"]),
    model: { type: String, enum: ["FormLead", "CallLead"], default: null },
    id: ref,
    contact_number_id: ref,
  },
  { _id: false, strict: "throw" },
);
export const leadRef = new Schema(
  { model: enumeration(["FormLead", "CallLead"]), id: oid },
  { _id: false, strict: "throw" },
);
export const actor = new Schema(
  {
    // S8-REP: `rep` for a signed rep's own follow-up change or media play (id = its admin user id).
    kind: enumeration(["owner", "worker", "intelligence", "rep"]),
    id: str,
    request_id: str,
    run_id: ref,
  },
  { _id: false, strict: "throw" },
);
export const assignment = new Schema(
  {
    origin: enumeration([
      "owner",
      "first_conversation",
      "rep_promise",
      "inherited_outreach",
      // Team 4 AC5-ACTIVITY (spec §7.2): two or more attributable attempts by one reviewed rep.
      "first_attempts",
    ]),
    actor_id: text,
    evidence_id: ref,
    assigned_at: at,
    instruction_id: ref,
  },
  { _id: false, strict: "throw" },
);
export const dateResolution = new Schema(
  {
    precision: enumeration(["exact", "day", "unresolved"]),
    timezone: str,
    assumption: text,
    anchor: date,
    policy_version: str,
  },
  { _id: false, strict: "throw" },
);
/** `db.collection` namespaces whose unique fences this process has verified. */
const verifiedCsiFences = new Set<string>();

/** Test seam; production never needs to forget a verified fence. */
export function resetVerifiedCsiFences(): void {
  verifiedCsiFences.clear();
}

export function defineCsiModel<S extends Schema>(
  name: string,
  schema: S,
  indexes: readonly CsiIndex[],
  appendOnly = false,
) {
  schema.set("autoIndex", false);
  schema.set("autoCreate", false);
  schema.set("timestamps", true);
  schema.set("minimize", false);
  schema.set("strict", "throw");
  for (const child of schema.childSchemas) child.schema.set("strict", "throw");
  for (const { key, ...options } of indexes) schema.index(key, options);
  async function requireUniqueFences() {
    const uniqueIndexes = indexes.filter((i) => i.unique);
    if (!uniqueIndexes.length) return;
    const dbName = getMongoDatabaseName();
    const collection = String(schema.options.collection);
    // A satisfied unique fence cannot become unsatisfied inside a process
    // lifetime — dropping an index is an operator action that restarts the
    // worker. Without this memo every single CSI write issues its own
    // `listIndexes` server command (14 §10, same reasoning as `assertIndexes`).
    // Only successes are cached, so a genuinely missing fence keeps failing
    // closed on every write until it is created.
    const memoKey = `${dbName}.${collection}`;
    if (verifiedCsiFences.has(memoKey)) return;
    const db = mongoose.connection.useDb(dbName, {
      useCache: true,
    }).db;
    if (!db) throw new Error("INDEX_REQUIRED");
    const observed = await db.collection(collection).indexes();
    for (const expected of uniqueIndexes) {
      if (
        !observed.some(
          (actual) =>
            actual.name === expected.name &&
            actual.unique === true &&
            canonicalJson(actual.key) === canonicalJson(expected.key) &&
            canonicalJson(actual.partialFilterExpression ?? null) ===
              canonicalJson(expected.partialFilterExpression ?? null) &&
            Boolean(actual.sparse) === Boolean(expected.sparse),
        )
      )
        throw new Error("INDEX_REQUIRED");
    }
    verifiedCsiFences.add(memoKey);
  }
  schema.pre("save", requireUniqueFences);
  schema.pre("insertMany", requireUniqueFences);
  schema.pre("bulkWrite", requireUniqueFences);
  schema.pre(
    [
      "updateOne",
      "updateMany",
      "findOneAndUpdate",
      "replaceOne",
      "findOneAndReplace",
    ],
    requireUniqueFences,
  );
  if (appendOnly) {
    schema.pre("save", function () {
      if (!this.isNew) throw new Error("CSI evidence is append-only");
    });
    schema.pre(
      [
        "updateOne",
        "updateMany",
        "findOneAndUpdate",
        "replaceOne",
        "findOneAndReplace",
        "deleteOne",
        "deleteMany",
        "findOneAndDelete",
      ],
      function () {
        throw new Error("CSI evidence is append-only");
      },
    );
    schema.pre("bulkWrite", function () {
      throw new Error("CSI evidence bulk mutation is forbidden");
    });
  }
  type Row = InferSchemaType<S> & {
    _id: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
  };
  return () => {
    const db = mongoose.connection.useDb(getMongoDatabaseName(), {
      useCache: true,
    });
    return (
      (db.models[name] as mongoose.Model<Row> | undefined) ??
      db.model<Row>(name, schema)
    );
  };
}
export const unique = (
  name: string,
  key: IndexDefinition,
  partialFilterExpression?: Record<string, unknown>,
): CsiIndex => ({
  name,
  key,
  unique: true,
  ...(partialFilterExpression ? { partialFilterExpression } : {}),
});
export const index = (name: string, key: IndexDefinition): CsiIndex => ({
  name,
  key,
});
