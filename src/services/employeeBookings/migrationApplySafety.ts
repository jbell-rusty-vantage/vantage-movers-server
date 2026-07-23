export type MigrationApplyAuthorizationInput = {
  args: readonly string[];
  testMode: boolean;
  selectedDatabase: string | undefined;
};

const PRODUCTION_DATABASE = "vantagemovers";
const PRODUCTION_CONFIRMATION = "--confirm-production-db=vantagemovers";

/**
 * Prevent a destructive migration from being enabled by an incidental `--apply`
 * flag in production. The selected database check intentionally uses Mongo's
 * connected database name rather than the configured name.
 */
export function assertMigrationApplyAuthorized({
  args,
  testMode,
  selectedDatabase,
}: MigrationApplyAuthorizationInput): void {
  if (testMode && selectedDatabase === "testvantagemovers") {
    return;
  }

  if (!args.includes("--production-apply") || !args.includes(PRODUCTION_CONFIRMATION)) {
    throw new Error(
      `Production apply requires --production-apply ${PRODUCTION_CONFIRMATION}`,
    );
  }

  if (selectedDatabase !== PRODUCTION_DATABASE) {
    throw new Error(
      `Refusing production apply because connected database is ${selectedDatabase ?? "unknown"}, expected ${PRODUCTION_DATABASE}`,
    );
  }
}

export function isMigrationApplyRequested(args: readonly string[]): boolean {
  return args.includes("--apply");
}
