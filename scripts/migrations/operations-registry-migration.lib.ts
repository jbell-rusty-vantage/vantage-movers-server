import { createHash } from "node:crypto";

export const PRODUCTION_DATABASE = "vantagemovers";
export const TEST_DATABASE = "testvantagemovers";
export const HISTORICAL_DATABASE = "vantagemovershistorical";
export const PRODUCTION_CONFIRMATION = "--confirm-production-db=vantagemovers";

export type MigrationMode = "dry_run" | "apply";

export type MigrationPlannedCounts = {
  creates: number;
  updates: number;
  no_ops: number;
  conflicts: number;
};

export type MigrationAppliedCounts = {
  creates: number;
  updates: number;
  no_ops: number;
  failures: number;
};

export type MigrationCollisionSeverity = "blocking" | "reviewable";

export type MigrationCollision = {
  code: string;
  severity: MigrationCollisionSeverity;
  category: string;
  message: string;
  details: Record<string, unknown>;
};

export type MigrationConflictSummary = {
  blocking: number;
  reviewable: number;
  total: number;
  by_category: Record<string, number>;
};

export type OperationsRegistryMigrationManifestBase = {
  run_id: string;
  script_version: string;
  git_sha?: string;
  database_name: string;
  mode: MigrationMode;
  started_at: string;
  completed_at: string;
  operator?: string;
  planned: MigrationPlannedCounts;
  applied: MigrationAppliedCounts;
  mapping_checksum: string;
  conflict_summary: MigrationConflictSummary;
  collisions: MigrationCollision[];
  resume_cursor: Record<string, unknown> | null;
};

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeMigrationChecksum(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function summarizeMigrationCollisions(
  collisions: MigrationCollision[],
): MigrationConflictSummary {
  const byCategory: Record<string, number> = {};
  let blocking = 0;
  let reviewable = 0;
  for (const collision of collisions) {
    byCategory[collision.category] = (byCategory[collision.category] ?? 0) + 1;
    if (collision.severity === "blocking") {
      blocking += 1;
    } else {
      reviewable += 1;
    }
  }
  return {
    blocking,
    reviewable,
    total: collisions.length,
    by_category: Object.fromEntries(
      Object.entries(byCategory).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function sortMigrationCollisions(
  collisions: MigrationCollision[],
): MigrationCollision[] {
  return [...collisions].sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.category.localeCompare(right.category) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

export function assertMigrationDatabaseAllowed(
  databaseName: string | undefined,
  args: readonly string[],
): asserts databaseName is string {
  if (!databaseName) {
    throw new Error("Cannot run migration: connected database name is unknown.");
  }
  if (databaseName === HISTORICAL_DATABASE) {
    throw new Error(
      `Refusing migration against historical database ${HISTORICAL_DATABASE}.`,
    );
  }
  if (databaseName === TEST_DATABASE) {
    return;
  }
  if (databaseName === PRODUCTION_DATABASE) {
    if (!args.includes(PRODUCTION_CONFIRMATION)) {
      throw new Error(
        `Refusing production migration without explicit confirmation flag ${PRODUCTION_CONFIRMATION}.`,
      );
    }
    return;
  }
  throw new Error(
    `Refusing migration against unknown database "${databaseName}". Allowed targets: ${TEST_DATABASE}, or ${PRODUCTION_DATABASE} with ${PRODUCTION_CONFIRMATION}.`,
  );
}

export function countPlannedActions<T extends { action: string }>(
  items: readonly T[],
): MigrationPlannedCounts {
  let creates = 0;
  let updates = 0;
  let no_ops = 0;
  let conflicts = 0;
  for (const item of items) {
    switch (item.action) {
      case "create":
      case "create_granularity":
        creates += 1;
        break;
      case "update":
      case "update_identity":
      case "update_company":
      case "init_aliases":
        updates += 1;
        break;
      case "conflict":
        conflicts += 1;
        break;
      default:
        no_ops += 1;
        break;
    }
  }
  return { creates, updates, no_ops, conflicts };
}

export function hasBlockingMigrationCollisions(
  collisions: readonly MigrationCollision[],
): boolean {
  return collisions.some((collision) => collision.severity === "blocking");
}
