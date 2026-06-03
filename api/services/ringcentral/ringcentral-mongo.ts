import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../config/domain";
import { connectMongo } from "../../db";

/**
 * Shared accessor for the active Mongo database used by the newer RingCentral
 * hybrid stores (sessions, processed calls, sync state, shadow leads,
 * analytics snapshots). Centralizes the `connectMongo()` + `useDb()` dance so
 * each store does not repeat it.
 *
 * Database selection still honors `TEST_MODE` via `getMongoDatabaseName()`;
 * collection-level test/production separation is handled by the `_test`
 * suffix in `ringcentral-config.ts`.
 */
export async function getRingCentralDb() {
  await connectMongo();
  const db = mongoose.connection.useDb(getMongoDatabaseName(), {
    useCache: true,
  }).db;
  if (!db) {
    throw new Error("MongoDB connection is not ready");
  }
  return db;
}

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGO_URI?.trim());
}
