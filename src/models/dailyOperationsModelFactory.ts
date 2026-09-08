import mongoose, { type Model, type Schema } from "mongoose";
import { getMongoDatabaseName } from "../config/domain";
import {
  getDailyOperationsCollectionName,
  type DailyOperationsCollectionKey,
} from "../config/domain/dailyOperations";

/**
 * Resolves a Daily Operations Mongoose model bound to the runtime-selected
 * database (via `getMongoDatabaseName()`) and the runtime-selected collection
 * name (via `getDailyOperationsCollectionName()`).
 *
 * Collection names are resolved at call time (production / test runner /
 * TEST_MODE), so the model registration name is keyed by the resolved
 * collection name. This lets the same process target `daily_operations_*` or
 * `test_daily_operations_*` without the first-registered name sticking.
 *
 * Dedicated factory — do not reuse observability collection keys.
 */
export function getDailyOperationsModel<TDoc>(
  modelKey: string,
  collectionKey: DailyOperationsCollectionKey,
  schema: Schema<TDoc>,
): Model<TDoc> {
  const dbName = getMongoDatabaseName();
  const collectionName = getDailyOperationsCollectionName(collectionKey);
  const registrationName = `${modelKey}__${collectionName}`;

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[registrationName] as Model<TDoc> | undefined) ??
    db.model<TDoc>(registrationName, schema, collectionName)
  );
}
