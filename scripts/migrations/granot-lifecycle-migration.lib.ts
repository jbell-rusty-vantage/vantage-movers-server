import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HISTORICAL_DATABASE,
  PRODUCTION_DATABASE,
  TEST_DATABASE,
} from "./operations-registry-migration.lib";

export type GranotLifecycleMigrationMode = "report" | "apply" | "verify";

export const GRANOT_LIFECYCLE_PRODUCTION_DATABASE = PRODUCTION_DATABASE;
export const GRANOT_LIFECYCLE_TEST_DATABASE = TEST_DATABASE;
export const GRANOT_LIFECYCLE_HISTORICAL_DATABASE = HISTORICAL_DATABASE;

export function parseGranotLifecycleMigrationMode(
  args: readonly string[],
): GranotLifecycleMigrationMode {
  const report = args.includes("--report");
  const apply = args.includes("--apply");
  const verify = args.includes("--verify");
  const selected = [report, apply, verify].filter(Boolean).length;
  if (selected > 1) {
    throw new Error("Refusing combined --report, --apply, and --verify flags.");
  }
  if (apply) return "apply";
  if (verify) return "verify";
  return "report";
}

export function readConfirmProductionDatabase(
  args: readonly string[],
): string | undefined {
  const flag = args.find((arg) => arg.startsWith("--confirm-production="));
  return flag?.slice("--confirm-production=".length).trim() || undefined;
}

export function assertGranotLifecycleDatabaseAllowed(
  databaseName: string | undefined,
): asserts databaseName is string {
  if (!databaseName) {
    throw new Error("Cannot run migration: connected database name is unknown.");
  }
  if (databaseName === HISTORICAL_DATABASE) {
    throw new Error(
      `Refusing migration against historical database ${HISTORICAL_DATABASE}.`,
    );
  }
  if (/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(databaseName) || databaseName === PRODUCTION_DATABASE) {
    return;
  }
  throw new Error(
    `Refusing migration against unknown database "${databaseName}". Allowed targets: ${TEST_DATABASE}, or ${PRODUCTION_DATABASE} with --confirm-production=${PRODUCTION_DATABASE}.`,
  );
}

export function assertGranotLifecycleApplyAuthorized(input: {
  args: readonly string[];
  databaseName: string;
}): void {
  const confirmed = readConfirmProductionDatabase(input.args);
  if (!confirmed) {
    throw new Error(
      `Refusing apply without --confirm-production=<database-name>.`,
    );
  }
  if (confirmed !== input.databaseName) {
    throw new Error(
      `Refusing apply: --confirm-production=${confirmed} does not match connected database ${input.databaseName}.`,
    );
  }
  if (input.databaseName === PRODUCTION_DATABASE) {
    return;
  }
  if (/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(input.databaseName)) {
    return;
  }
  throw new Error(
    `Refusing apply against unsupported database "${input.databaseName}".`,
  );
}

export function maskReceiptId(id: string): string {
  const value = String(id);
  if (value.length <= 8) {
    return "…";
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function writeGranotLifecycleManifest(input: {
  directory: string;
  runId: string;
  manifest: unknown;
}): Promise<string> {
  await mkdir(input.directory, { recursive: true });
  const manifestPath = path.join(input.directory, `${input.runId}.json`);
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(sortManifestValue(input.manifest), null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, manifestPath);
  return manifestPath;
}

function sortManifestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortManifestValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortManifestValue(nested)]),
    );
  }
  return value;
}

export function granotLifecycleOutputDirectory(scriptName: string): string {
  return path.join(process.cwd(), "scripts", "output", scriptName);
}
