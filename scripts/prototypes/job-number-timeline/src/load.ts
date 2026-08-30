import type { Db } from "mongodb";
import mongoose from "mongoose";
import { PRODUCTION_CONFIRMATION } from "../../../migrations/operations-registry-inventory.lib.js";
import { TEST_DATABASE } from "../../../migrations/operations-registry-migration.lib.js";

export const PRODUCTION_DATABASE = "vantagemovers";
export { TEST_DATABASE, PRODUCTION_CONFIRMATION };

export function resolveTimelineDatabase(args: readonly string[]): string {
  if (args.includes(PRODUCTION_CONFIRMATION)) {
    return PRODUCTION_DATABASE;
  }
  return TEST_DATABASE;
}

export function assertTimelineDatabaseAllowed(
  databaseName: string,
  args: readonly string[],
): void {
  if (databaseName === PRODUCTION_DATABASE && !args.includes(PRODUCTION_CONFIRMATION)) {
    throw new Error(
      `Refusing ${PRODUCTION_DATABASE} read without ${PRODUCTION_CONFIRMATION}.`,
    );
  }
  if (databaseName !== PRODUCTION_DATABASE && databaseName !== TEST_DATABASE) {
    throw new Error(`Refusing unknown database ${databaseName}.`);
  }
}

export async function timelineDatabase(
  connection: typeof mongoose,
  databaseName: string,
): Promise<Db> {
  const db = connection.connection.getClient().db(databaseName);
  if (db.databaseName !== databaseName) {
    throw new Error(`Refusing read against ${db.databaseName}. Expected ${databaseName}.`);
  }
  return db;
}
