/**
 * Unit 20 / Section 34.5 processed-call identity index refinement.
 *
 * Report is the default. Apply requires an exact database confirmation.
 * Production apply is never implied by Unit 20 assignment.
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { getMongoDatabaseName } from "../../src/config/domain.js";
import { getRingCentralCollectionName } from "../../src/services/ringcentral/ringcentral-config.js";
import { RINGCENTRAL_PROCESSED_CALL_INDEXES } from "../../src/services/ringcentral/processed-calls-store.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  hasRequiredUniqueCallLogIndex,
  RINGCENTRAL_PROCESSED_CALL_INDEX_SCRIPT_VERSION,
  summarizeProcessedCallIdentityCollisions,
} from "./ringcentral-processed-call-indexes.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory(
  "ringcentral-processed-call-indexes",
);

async function main(): Promise<void> {
  const mode = parseGranotLifecycleMigrationMode(process.argv.slice(2));
  await connectMongo();
  const databaseName = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(databaseName);
  assertCollectionMode(databaseName);
  const db = mongoose.connection.useDb(databaseName, { useCache: true }).db;
  if (!db) throw new Error("Connected Mongo database is unavailable.");
  const collectionName = getRingCentralCollectionName("processedCalls");
  const collection = db.collection(collectionName);
  const rows = await collection
    .find(
      { callLogId: { $type: "string", $ne: "" } },
      { projection: { callLogId: 1 } },
    )
    .toArray();
  let placeholderRows = await collection.countDocuments({
    callLogId: { $exists: true, $in: [null, ""] },
  });
  const placeholderRowsBefore = placeholderRows;
  let sessionPlaceholderRows = await collection.countDocuments({
    telephonySessionId: { $exists: true, $in: [null, ""] },
  });
  const sessionPlaceholderRowsBefore = sessionPlaceholderRows;
  const collisions = summarizeProcessedCallIdentityCollisions(rows);
  let indexes = await readIndexes(collection);
  const droppedIndexNames: string[] = [];
  const createdIndexNames: string[] = [];

  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv.slice(2),
      databaseName,
    });
    if (collisions.length > 0) {
      throw new Error(
        `Refusing unique call-log index apply: ${collisions.length} collision group(s) remain.`,
      );
    }
    if (placeholderRows > 0) {
      await collection.updateMany(
        { callLogId: { $exists: true, $in: [null, ""] } },
        { $unset: { callLogId: "" } },
      );
      placeholderRows = await collection.countDocuments({
        callLogId: { $exists: true, $in: [null, ""] },
      });
    }
    if (sessionPlaceholderRows > 0) {
      await collection.updateMany(
        {
          telephonySessionId: {
            $exists: true,
            $in: [null, ""],
          },
        },
        { $unset: { telephonySessionId: "" } },
      );
      sessionPlaceholderRows = await collection.countDocuments({
        telephonySessionId: { $exists: true, $in: [null, ""] },
      });
    }
    for (const spec of RINGCENTRAL_PROCESSED_CALL_INDEXES) {
      indexes = await readIndexes(collection);
      const sameKey = indexes.filter(
        (index) =>
          index.name !== "_id_" &&
          JSON.stringify(index.key) === JSON.stringify(spec.key),
      );
      const exact = sameKey.find(
        (index) =>
          index.name === spec.name &&
          Boolean(index.unique) === Boolean("unique" in spec && spec.unique) &&
          Boolean(index.sparse) === Boolean("sparse" in spec && spec.sparse),
      );
      if (exact) {
        continue;
      }
      for (const index of sameKey) {
        await collection.dropIndex(String(index.name));
        droppedIndexNames.push(String(index.name));
      }
      await collection.createIndex(spec.key, {
        name: spec.name,
        ...("unique" in spec && spec.unique ? { unique: true } : {}),
        ...("sparse" in spec && spec.sparse ? { sparse: true } : {}),
      });
      createdIndexNames.push(spec.name);
    }
    indexes = await readIndexes(collection);
  }

  const verified = hasRequiredUniqueCallLogIndex(indexes);
  const missingContractNames = RINGCENTRAL_PROCESSED_CALL_INDEXES.filter(
    (expected) =>
      !indexes.some(
        (index) =>
          index.name === expected.name &&
          JSON.stringify(index.key) === JSON.stringify(expected.key) &&
          Boolean(index.unique) === Boolean("unique" in expected && expected.unique) &&
          Boolean(index.sparse) === Boolean("sparse" in expected && expected.sparse),
      ),
  ).map((index) => index.name);
  const manifest = {
    script_version: RINGCENTRAL_PROCESSED_CALL_INDEX_SCRIPT_VERSION,
    mode,
    database: databaseName,
    collection: collectionName,
    generated_at: new Date().toISOString(),
    call_log_identity_rows: rows.length,
    collision_group_count: collisions.length,
    sparse_placeholder_rows_before: placeholderRowsBefore,
    sparse_placeholder_rows_remaining: placeholderRows,
    session_sparse_placeholder_rows_before: sessionPlaceholderRowsBefore,
    session_sparse_placeholder_rows_remaining: sessionPlaceholderRows,
    collisions,
    required_index_present: verified && missingContractNames.length === 0,
    missing_contract_index_names: missingContractNames,
    contract_index_names: RINGCENTRAL_PROCESSED_CALL_INDEXES.map((index) => index.name),
    dropped_index_names: droppedIndexNames,
    created_index_names: createdIndexNames,
    observed_index_names: indexes
      .map((index) => index.name)
      .filter((name): name is string => typeof name === "string"),
  };
  const runId = `${mode}-${Date.now()}`;
  const output = await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId,
    manifest,
  });
  console.log(JSON.stringify({ ...manifest, output }, null, 2));
  if (
    mode === "verify" &&
    (collisions.length > 0 ||
      placeholderRows > 0 ||
      sessionPlaceholderRows > 0 ||
      !verified ||
      missingContractNames.length > 0)
  ) {
    throw new Error(
      "Processed-call index verification failed: collisions/placeholders remain or the unique sparse callLogId index is missing.",
    );
  }
}

async function readIndexes(
  collection: ReturnType<
    NonNullable<typeof mongoose.connection.db>["collection"]
  >,
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

function assertCollectionMode(databaseName: string): void {
  const mode = process.env.RINGCENTRAL_COLLECTION_MODE?.trim().toLowerCase();
  if (databaseName.startsWith("test") && mode !== "test") {
    throw new Error(
      "Refusing test-database migration unless RINGCENTRAL_COLLECTION_MODE=test.",
    );
  }
  if (!databaseName.startsWith("test") && mode !== "production") {
    throw new Error(
      "Refusing production-database migration unless RINGCENTRAL_COLLECTION_MODE=production.",
    );
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
