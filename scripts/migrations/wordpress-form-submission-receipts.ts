/**
 * JTE-07 WordPress form-submission receipt indexes.
 *
 * Report is the default. Apply requires --apply --confirm-production=<db>.
 * Production apply remains unauthorized.
 *
 *   TEST_MODE=true pnpm migration:wordpress-form-submission-receipts -- --report
 *   TEST_MODE=true pnpm migration:wordpress-form-submission-receipts -- --apply --confirm-production=testvantagemovers
 *   TEST_MODE=true pnpm migration:wordpress-form-submission-receipts -- --verify --confirm-production=testvantagemovers
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import {
  WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION,
  WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES,
} from "../../src/models/WordpressFormSubmissionReceipt.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  WORDPRESS_FORM_SUBMISSION_RECEIPTS_SCRIPT_VERSION,
  summarizeWordpressReceiptIndexes,
  wordpressReceiptIndexPresent,
} from "./wordpress-form-submission-receipts.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("wordpress-form-submission-receipts");

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseGranotLifecycleMigrationMode(args);
  const configuredDatabase = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configuredDatabase);
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName ?? configuredDatabase;
  if (databaseName !== configuredDatabase) {
    throw new Error(
      `Connected database ${databaseName} does not match configured ${configuredDatabase}.`,
    );
  }
  if (mode === "apply" && databaseName === "vantagemovers") {
    throw new Error("JTE-07 refuses production index apply.");
  }
  const db = mongoose.connection.db;
  if (!db) throw new Error("Connected Mongo database is unavailable.");
  const receipts = db.collection(WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION);
  let indexes = await readIndexes(receipts);
  const createdIndexNames: string[] = [];

  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({ args, databaseName });
    for (const expected of WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES) {
      if (wordpressReceiptIndexPresent(indexes, expected)) continue;
      const options: Record<string, unknown> = {
        name: expected.name,
        unique: expected.unique,
      };
      if ("partialFilterExpression" in expected) {
        options.partialFilterExpression = expected.partialFilterExpression;
      }
      await receipts.createIndex(expected.key, options);
      createdIndexNames.push(expected.name);
    }
    indexes = await readIndexes(receipts);
  }

  const receiptCount = await receipts.countDocuments();
  const indexSummary = summarizeWordpressReceiptIndexes(indexes);
  const manifest = {
    script_version: WORDPRESS_FORM_SUBMISSION_RECEIPTS_SCRIPT_VERSION,
    mode,
    database: databaseName,
    collection: WORDPRESS_FORM_SUBMISSION_RECEIPT_COLLECTION,
    receipt_count: receiptCount,
    indexes: indexSummary,
    created_index_names: createdIndexNames,
    historical_backfill: 0,
  };
  const output = await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `${mode}-${Date.now()}`,
    manifest,
  });
  console.log(JSON.stringify({ ...manifest, output }, null, 2));
  if (mode === "verify" && indexSummary.some((index) => !index.present)) {
    throw new Error("WordPress receipt verification failed: required index missing.");
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
