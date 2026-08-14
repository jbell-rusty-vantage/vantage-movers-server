/**
 * 34.1 — Granot Observation Receipt compatibility backfill.
 *
 * Dry-run / --report by default. Mutation requires
 * --apply --confirm-production=<database-name>.
 *
 *   pnpm migration:granot-lifecycle:receipts -- --report
 *   pnpm migration:granot-lifecycle:receipts -- --apply --confirm-production=testvantagemovers
 *   pnpm migration:granot-lifecycle:receipts -- --verify
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { GRANOT_OBSERVATION_RECEIPT_COLLECTION } from "../../src/models/GranotObservationReceipt.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  RECEIPT_MIGRATION_SCRIPT_VERSION,
  assertReceiptMigrationApplyAllowed,
  planGranotLifecycleReceiptMigration,
  verifyGranotLifecycleReceiptMigration,
  type LegacyReceiptRow,
} from "./granot-lifecycle-receipts.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-receipts");

type StoredReceiptRow = LegacyReceiptRow & { mongo_id: mongoose.Types.ObjectId };

async function loadLegacyReceiptRows(): Promise<StoredReceiptRow[]> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
  if (!collection) {
    throw new Error("Cannot load receipts: Mongo collection is unavailable.");
  }
  const documents = await collection.find({}).toArray();
  return documents.map((document) => ({
    ...(document as unknown as LegacyReceiptRow),
    mongo_id: document._id as mongoose.Types.ObjectId,
    _id: String(document._id),
  }));
}

async function applyTranslations(
  plan: ReturnType<typeof planGranotLifecycleReceiptMigration>,
  rows: readonly StoredReceiptRow[],
): Promise<number> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
  if (!collection) {
    throw new Error("Cannot apply receipts: Mongo collection is unavailable.");
  }
  const byId = new Map(plan.translate.map((entry) => [entry.id, entry]));
  let updated = 0;
  for (const row of rows) {
    const filled = byId.get(row._id);
    if (!filled) {
      continue;
    }
    await collection.updateOne(
      { _id: row.mongo_id },
      { $set: filled.set_fields },
    );
    updated += 1;
  }
  return updated;
}

async function main(): Promise<void> {
  const mode = parseGranotLifecycleMigrationMode(process.argv);
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertGranotLifecycleDatabaseAllowed(databaseName);
  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName,
    });
  }

  const rows = await loadLegacyReceiptRows();
  const plan = planGranotLifecycleReceiptMigration(rows);
  let applied = 0;
  let verify:
    | ReturnType<typeof verifyGranotLifecycleReceiptMigration>
    | undefined;

  if (mode === "apply") {
    assertReceiptMigrationApplyAllowed(plan);
    applied = await applyTranslations(plan, rows);
  }
  if (mode === "verify") {
    verify = verifyGranotLifecycleReceiptMigration(rows);
  }

  const manifest = {
    script_version: RECEIPT_MIGRATION_SCRIPT_VERSION,
    database_name: databaseName,
    mode,
    total: plan.total,
    status_counts: plan.status_counts,
    event_class_counts: plan.event_class_counts,
    credential_key_counts: plan.credential_key_counts,
    translate_count: plan.translate.length,
    already_current: plan.already_current,
    refused_count: plan.refused.length,
    refused: plan.refused.map(({ masked_id, processing_status }) => ({
      masked_id,
      processing_status,
    })),
    translated_masked_ids: plan.translate.map((entry) => entry.masked_id),
    applied,
    verify: verify
      ? {
          ok: verify.ok,
          failures: verify.failures,
        }
      : undefined,
  };

  const runId = `granot-lifecycle-receipts-${mode}-${Date.now()}`;
  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId,
    manifest,
  });

  if (mode === "verify" && verify && !verify.ok) {
    throw new Error(
      `Receipt verify failed: ${verify.failures.length} invariant mismatch(es).`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
