/**
 * Lead Conversation indexes. Report is default. Apply requires
 * --apply --confirm-production=<database-name>.
 *
 *   pnpm migration:conversations:indexes
 *   pnpm migration:conversations:indexes -- --apply --confirm-production=vantagemovers
 *   pnpm migration:conversations:indexes -- --verify
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { LEAD_CONVERSATION_COLLECTION } from "../../src/config/domain/conversations.js";
import { LEAD_CONVERSATION_INDEXES } from "../../src/models/LeadConversation.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("lead-conversation-indexes");
const SCRIPT_VERSION = "lead-conversation-indexes/1";

async function main(): Promise<void> {
  const mode = parseGranotLifecycleMigrationMode(process.argv.slice(2));
  await connectMongo();
  const databaseName = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(databaseName);
  const db = mongoose.connection.useDb(databaseName, { useCache: true }).db;
  if (!db) throw new Error("Connected Mongo database is unavailable.");
  const collection = db.collection(LEAD_CONVERSATION_COLLECTION);
  let indexes = await readIndexes(collection);
  const droppedIndexNames: string[] = [];
  const createdIndexNames: string[] = [];

  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv.slice(2),
      databaseName,
    });
    for (const spec of LEAD_CONVERSATION_INDEXES) {
      indexes = await readIndexes(collection);
      const sameKey = indexes.filter(
        (index) =>
          index.name !== "_id_" &&
          JSON.stringify(index.key) === JSON.stringify(spec.key),
      );
      const exact = sameKey.find(
        (index) =>
          index.name === spec.name &&
          Boolean(index.unique) === Boolean("unique" in spec && spec.unique),
      );
      if (exact) continue;
      for (const index of sameKey) {
        await collection.dropIndex(String(index.name));
        droppedIndexNames.push(String(index.name));
      }
      await collection.createIndex(spec.key, {
        name: spec.name,
        ...("unique" in spec && spec.unique ? { unique: true } : {}),
      });
      createdIndexNames.push(spec.name);
    }
    indexes = await readIndexes(collection);
  }

  const missing = LEAD_CONVERSATION_INDEXES.filter(
    (expected) =>
      !indexes.some(
        (index) =>
          index.name === expected.name &&
          JSON.stringify(index.key) === JSON.stringify(expected.key) &&
          Boolean(index.unique) === Boolean("unique" in expected && expected.unique),
      ),
  ).map((index) => index.name);

  const manifest = {
    script_version: SCRIPT_VERSION,
    mode,
    database: databaseName,
    collection: LEAD_CONVERSATION_COLLECTION,
    generated_at: new Date().toISOString(),
    required_index_present: missing.length === 0,
    missing_contract_index_names: missing,
    contract_index_names: LEAD_CONVERSATION_INDEXES.map((index) => index.name),
    dropped_index_names: droppedIndexNames,
    created_index_names: createdIndexNames,
    observed_index_names: indexes
      .map((index) => index.name)
      .filter((name): name is string => typeof name === "string"),
  };
  const output = await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `${mode}-${Date.now()}`,
    manifest,
  });
  console.log(JSON.stringify({ ...manifest, output }, null, 2));
  if (mode === "verify" && missing.length > 0) {
    throw new Error(
      `Lead Conversation index verification failed: missing ${missing.join(", ")}`,
    );
  }
}

async function readIndexes(
  collection: ReturnType<NonNullable<typeof mongoose.connection.db>["collection"]>,
) {
  try {
    return await collection.indexes();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 26
    ) {
      return [];
    }
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
