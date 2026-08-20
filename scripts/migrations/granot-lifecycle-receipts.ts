/**
 * Unit 33 — guarded retirement of legacy receipt fields and indexes.
 *
 * Dry-run / --report by default. Mutation requires
 * --apply --confirm-production=<database-name>.
 *
 *   pnpm migration:granot-lifecycle:receipts -- --report
 *   pnpm migration:granot-lifecycle:receipts -- --apply --confirm-production=testvantagemovers
 *   pnpm migration:granot-lifecycle:receipts -- --verify
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
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
  RETIRED_RECEIPT_FIELDS,
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

const RETIRED_RECEIPT_INDEX_KEYS = [
  { event_type: 1, received_at: -1 },
  { processing_status: 1, received_at: 1 },
] as const;

function sameKey(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadRetiredIndexNames(): Promise<string[]> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
  if (!collection) throw new Error("Cannot inspect receipt indexes: Mongo collection is unavailable.");
  let indexes: Awaited<ReturnType<typeof collection.indexes>>;
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if ((error as { codeName?: string }).codeName === "NamespaceNotFound") return [];
    throw error;
  }
  return indexes
    .filter((index) => RETIRED_RECEIPT_INDEX_KEYS.some((key) => sameKey(index.key, key)))
    .map((index) => index.name)
    .filter((name): name is string => typeof name === "string")
    .sort();
}

async function applyCleanup(
  plan: ReturnType<typeof planGranotLifecycleReceiptMigration>,
): Promise<number> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
  if (!collection) {
    throw new Error("Cannot apply receipts: Mongo collection is unavailable.");
  }
  if (plan.cleanup_masked_ids.length === 0) return 0;
  const unset = Object.fromEntries(RETIRED_RECEIPT_FIELDS.map((field) => [field, ""]));
  const result = await collection.updateMany(
    { $or: RETIRED_RECEIPT_FIELDS.map((field) => ({ [field]: { $exists: true } })) },
    { $unset: unset },
  );
  return result.modifiedCount;
}

async function main(): Promise<void> {
  const mode = parseGranotLifecycleMigrationMode(process.argv);
  const configuredDatabase = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(configuredDatabase);
  if (mode === "apply") assertGranotLifecycleApplyAuthorized({ args: process.argv, databaseName: configuredDatabase });
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertGranotLifecycleDatabaseAllowed(databaseName);
  if (databaseName !== configuredDatabase) throw new Error("Connected database does not match migration preflight database.");
  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName,
    });
  }

  const rows = await loadLegacyReceiptRows();
  const plan = planGranotLifecycleReceiptMigration(rows);
  const retiredIndexesBefore = await loadRetiredIndexNames();
  let applied = 0;
  let droppedLegacyIndexes: string[] = [];
  let verify:
    | ReturnType<typeof verifyGranotLifecycleReceiptMigration>
    | undefined;

  if (mode === "apply") {
    assertReceiptMigrationApplyAllowed(plan);
    applied = await applyCleanup(plan);
    const collection = mongoose.connection.db?.collection(
      GRANOT_OBSERVATION_RECEIPT_COLLECTION,
    );
    if (!collection) throw new Error("Cannot drop receipt indexes: Mongo collection is unavailable.");
    for (const name of retiredIndexesBefore) {
      await collection.dropIndex(name);
      droppedLegacyIndexes.push(name);
    }
  }
  if (mode === "verify") {
    verify = verifyGranotLifecycleReceiptMigration(rows);
    if (retiredIndexesBefore.length > 0) {
      verify = {
        ok: false,
        failures: [
          ...verify.failures,
          ...retiredIndexesBefore.map(() => ({
            masked_id: "index",
            code: "legacy_fields_remaining" as const,
          })),
        ],
      };
    }
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
    v2_complete_count: plan.already_current,
    legacy_field_counts: plan.legacy_field_counts,
    cleanup_count: plan.cleanup_masked_ids.length,
    supported_legacy_consumer_count: plan.supported_legacy_consumers.length,
    retired_index_names: retiredIndexesBefore,
    applied,
    dropped_legacy_indexes: droppedLegacyIndexes,
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

main()
  .catch(() => {
    console.error("Granot lifecycle receipt migration failed with a bounded technical error.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
