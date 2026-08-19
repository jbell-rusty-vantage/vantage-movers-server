import mongoose from "mongoose";
import { connectMongo } from "../../../../../src/db.js";
import {
  getMongoDatabaseName,
  withRuntimeDomainOverrides,
} from "../../../../../src/config/domain/runtime.js";

export const PRODUCTION_DATABASE = "vantagemovers";
export const PRODUCTION_CONFIRMATION = "--confirm-production-db=vantagemovers";

export function assertProductionDryRunArgs(args: readonly string[]): void {
  if (!args.includes(PRODUCTION_CONFIRMATION)) {
    throw new Error(
      `Refusing production dry-run without ${PRODUCTION_CONFIRMATION}. This script is read-only but still opens vantagemovers.`,
    );
  }
}

/**
 * `.env` is TEST_MODE=true, so connectMongo's default db is testvantagemovers.
 * Lifecycle models call getMongoDatabaseName() at query time and useDb() when
 * it differs. Running the work inside testMode:false pins every helper on
 * vantagemovers without writing.
 */
export async function withProductionReadOnly<T>(
  work: () => Promise<T>,
): Promise<T> {
  await connectMongo();
  try {
    return await withRuntimeDomainOverrides({ testMode: false }, async () => {
      const dbName = getMongoDatabaseName();
      if (dbName !== PRODUCTION_DATABASE) {
        throw new Error(`Expected getMongoDatabaseName()=${PRODUCTION_DATABASE}; got ${dbName}`);
      }
      const production = mongoose.connection.useDb(PRODUCTION_DATABASE, {
        useCache: true,
      });
      if (production.name !== PRODUCTION_DATABASE) {
        throw new Error(`useDb did not pin ${PRODUCTION_DATABASE}`);
      }
      return work();
    });
  } finally {
    await mongoose.disconnect();
  }
}
