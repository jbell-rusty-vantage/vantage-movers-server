import mongoose, { type Model, type Schema } from "mongoose";
import { getMongoDatabaseName } from "../config/domain";
import {
  getObservabilityCollectionName,
  type ObservabilityCollectionKey,
} from "../config/domain/observability";

/**
 * Resolves an observability Mongoose model bound to the runtime-selected
 * database (via `getMongoDatabaseName()`) and the runtime-selected collection
 * name (via `getObservabilityCollectionName()`).
 *
 * Observability collection names are resolved at call time (production / test /
 * custom), so the model registration name is keyed by the resolved collection
 * name. This lets the same process safely target different collections (for
 * example production vs `test_` collections) without the first-registered
 * collection name sticking.
 *
 * Callers must have established a connection (`connectMongo()`) before invoking
 * this; every observability service awaits `connectMongo()` first.
 */
export function getObservabilityModel<TDoc>(
  modelKey: string,
  collectionKey: ObservabilityCollectionKey,
  schema: Schema<TDoc>,
): Model<TDoc> {
  const dbName = getMongoDatabaseName();
  const collectionName = getObservabilityCollectionName(collectionKey);
  const registrationName = `${modelKey}__${collectionName}`;

  const db = mongoose.connection.useDb(dbName, { useCache: true });
  return (
    (db.models[registrationName] as Model<TDoc> | undefined) ??
    db.model<TDoc>(registrationName, schema, collectionName)
  );
}
