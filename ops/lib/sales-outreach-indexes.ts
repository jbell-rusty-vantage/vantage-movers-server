/**
 * Pure planning half of `ops/sales-outreach/build-indexes.ts`: compares the indexes the Sales
 * Outreach Desk models declare with what a database holds, and parses the operator's arguments.
 * No Mongo access here, so the plan is unit-tested without a database.
 */
import { canonicalJson } from "../../src/services/durableWork/checksum";
import type { CsiIndex } from "../../src/models/salesIntelligence/common";

export type ObservedIndex = {
  name?: string;
  key: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
  expireAfterSeconds?: number;
};

export type DeclaredCollection = { collection: string; indexes: readonly CsiIndex[] };

export type IndexAction =
  | { collection: string; name: string; action: "exists" }
  | { collection: string; name: string; action: "create"; spec: CsiIndex }
  | { collection: string; name: string; action: "conflict"; reason: string };

export type IndexBuildMode = "plan" | "apply";

export type IndexBuildArgs = { target: string; mode: IndexBuildMode };

/**
 * `--target=<database>` is required and must name the database this process resolves to (it is
 * never inferred). `--apply` builds; anything else only plans. Unknown flags are refused, except
 * the production-writer guard's own `--allow-schema-drift`.
 */
export function parseIndexBuildArgs(argv: readonly string[]): IndexBuildArgs {
  let target: string | null = null;
  let mode: IndexBuildMode = "plan";
  for (const arg of argv) {
    if (arg.startsWith("--target=")) target = arg.slice("--target=".length).trim();
    else if (arg === "--apply") mode = "apply";
    else if (arg === "--plan") mode = "plan";
    else if (arg === "--allow-schema-drift") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!target) throw new Error("--target=<database name> is required (for example --target=vantagemovers)");
  if (!/^[A-Za-z0-9_]+$/.test(target)) throw new Error("--target must be a plain database name");
  return { target, mode };
}

export function assertTargetMatchesDatabase(target: string, resolvedDatabase: string): void {
  if (target !== resolvedDatabase)
    throw new Error(`Refusing: --target=${target} but this process resolves the database "${resolvedDatabase}" (check TEST_MODE / TEST_MONGO_DATABASE_NAME)`);
}

const optionsOf = (index: { unique?: unknown; sparse?: unknown; partialFilterExpression?: unknown; expireAfterSeconds?: unknown }) =>
  canonicalJson({
    unique: index.unique === true,
    sparse: Boolean(index.sparse),
    partialFilterExpression: index.partialFilterExpression ?? null,
    expireAfterSeconds: index.expireAfterSeconds ?? null,
  });

/** Idempotent plan: an identical index (same name, key and options) is left alone; a same-name or same-key mismatch is a conflict the operator must resolve. */
export function planIndexBuild(declared: readonly DeclaredCollection[], observed: ReadonlyMap<string, readonly ObservedIndex[]>): IndexAction[] {
  const actions: IndexAction[] = [];
  for (const { collection, indexes } of declared) {
    const existing = observed.get(collection) ?? [];
    for (const spec of indexes) {
      const sameName = existing.find((i) => i.name === spec.name);
      const sameKey = existing.find((i) => canonicalJson(i.key) === canonicalJson(spec.key) && i.name !== spec.name);
      if (sameName) {
        if (canonicalJson(sameName.key) !== canonicalJson(spec.key))
          actions.push({ collection, name: spec.name, action: "conflict", reason: "an index with this name has a different key" });
        else if (optionsOf(sameName) !== optionsOf(spec))
          actions.push({ collection, name: spec.name, action: "conflict", reason: "an index with this name has different options" });
        else actions.push({ collection, name: spec.name, action: "exists" });
      } else if (sameKey) {
        actions.push({ collection, name: spec.name, action: "conflict", reason: `the same key exists as "${sameKey.name ?? "?"}"` });
      } else {
        actions.push({ collection, name: spec.name, action: "create", spec });
      }
    }
  }
  return actions;
}

/** Driver `createIndex` options for a declared index (only the options the desk declares). */
export function createIndexOptions(spec: CsiIndex): { name: string; unique?: true; sparse?: true; partialFilterExpression?: Record<string, unknown>; expireAfterSeconds?: number } {
  return {
    name: spec.name,
    ...(spec.unique === true ? { unique: true as const } : {}),
    ...(spec.sparse === true ? { sparse: true as const } : {}),
    ...(spec.partialFilterExpression ? { partialFilterExpression: spec.partialFilterExpression as Record<string, unknown> } : {}),
    ...(typeof spec.expireAfterSeconds === "number" ? { expireAfterSeconds: spec.expireAfterSeconds } : {}),
  };
}

/** Aggregation that finds documents a unique index would reject (respecting its partial filter). */
export function duplicateProbePipeline(spec: CsiIndex, limit = 5): Record<string, unknown>[] {
  const fields = Object.keys(spec.key as Record<string, unknown>);
  const group: Record<string, string> = {};
  fields.forEach((field, i) => { group[`k${i}`] = `$${field}`; });
  return [
    ...(spec.partialFilterExpression ? [{ $match: spec.partialFilterExpression }] : []),
    { $group: { _id: group, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: limit },
  ];
}
