/**
 * 34.5 — Granot Observation Receipt and Observation index deployment.
 *
 * Dry-run / --report by default. Mutation requires
 * --apply --confirm-production=<database-name>.
 *
 *   pnpm migration:granot-lifecycle:indexes -- --report
 *   pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=testvantagemovers
 *   pnpm migration:granot-lifecycle:indexes -- --verify
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import {
  GRANOT_OBSERVATION_COLLECTION,
  GRANOT_OBSERVATION_INDEXES,
} from "../../src/models/GranotObservation.js";
import {
  GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  GRANOT_OBSERVATION_RECEIPT_INDEXES,
} from "../../src/models/GranotObservationReceipt.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  INDEX_MIGRATION_SCRIPT_VERSION,
  findChannelOperationIdCollisions,
  findObservationReceiptIdCollisions,
  orderedObservationIndexCreates,
  orderedReceiptIndexCreates,
  verifyObservationIndexDefinitions,
  verifyReceiptIndexDefinitions,
  type DeclaredMongoIndex,
} from "./granot-lifecycle-indexes.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-indexes");

async function loadOperationIdRows(): Promise<
  Array<{
    _id: string;
    observation_channel?: unknown;
    channel_operation_id?: unknown;
  }>
> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
  if (!collection) {
    throw new Error("Cannot load receipts: Mongo collection is unavailable.");
  }
  const documents = await collection
    .find(
      {},
      { projection: { observation_channel: 1, channel_operation_id: 1 } },
    )
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    observation_channel: document.observation_channel,
    channel_operation_id: document.channel_operation_id,
  }));
}

async function listDeclaredIndexes(collectionName: string): Promise<DeclaredMongoIndex[]> {
  const collection = mongoose.connection.db?.collection(collectionName);
  if (!collection) {
    throw new Error("Cannot list indexes: Mongo collection is unavailable.");
  }
  const indexes = await collection.indexes();
  return indexes.map((index) => ({
    name: String(index.name),
    key: index.key as Record<string, unknown>,
    unique: index.unique === true ? true : undefined,
    partialFilterExpression: index.partialFilterExpression as
      | Record<string, unknown>
      | undefined,
  }));
}

async function createIndexes(
  collectionName: string,
  specs: readonly { name: string; key: Record<string, number>; unique?: true; partialFilterExpression?: Record<string, unknown> }[],
): Promise<string[]> {
  const collection = mongoose.connection.db?.collection(collectionName);
  if (!collection) {
    throw new Error("Cannot create indexes: Mongo collection is unavailable.");
  }
  const created: string[] = [];
  for (const spec of specs) {
    await collection.createIndex(spec.key, {
      name: spec.name,
      ...("unique" in spec ? { unique: true } : {}),
      ...("partialFilterExpression" in spec
        ? { partialFilterExpression: spec.partialFilterExpression }
        : {}),
    });
    created.push(spec.name);
  }
  return created;
}

async function loadObservationReceiptIdRows(): Promise<
  Array<{ _id: string; receipt_id?: unknown }>
> {
  const collection = mongoose.connection.db?.collection(GRANOT_OBSERVATION_COLLECTION);
  if (!collection) {
    throw new Error("Cannot load observations: Mongo collection is unavailable.");
  }
  const documents = await collection
    .find({}, { projection: { receipt_id: 1 } })
    .toArray();
  return documents.map((document) => ({
    _id: String(document._id),
    receipt_id: document.receipt_id,
  }));
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

  const rows = await loadOperationIdRows();
  const collisions = findChannelOperationIdCollisions(rows);
  const observationRows = await loadObservationReceiptIdRows();
  const observationCollisions = findObservationReceiptIdCollisions(observationRows);
  const ordered = orderedReceiptIndexCreates();
  const observationOrdered = orderedObservationIndexCreates();
  let created: string[] = [];
  let verify: ReturnType<typeof verifyReceiptIndexDefinitions> | undefined;
  let observationVerify: ReturnType<typeof verifyObservationIndexDefinitions> | undefined;

  if (mode === "apply") {
    created = await createIndexes(GRANOT_OBSERVATION_RECEIPT_COLLECTION, ordered.nonUnique);
    created = [
      ...created,
      ...(await createIndexes(GRANOT_OBSERVATION_COLLECTION, observationOrdered.nonUnique)),
    ];
    if (collisions.length > 0 || observationCollisions.length > 0) {
      const manifest = buildManifest({
        databaseName,
        mode,
        collisions,
        observationCollisions,
        created,
        uniqueCreated: [],
        verify,
        observationVerify,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique index create: ${collisions.length + observationCollisions.length} collision group(s).`,
      );
    }
    created = [
      ...created,
      ...(await createIndexes(GRANOT_OBSERVATION_RECEIPT_COLLECTION, ordered.unique)),
      ...(await createIndexes(GRANOT_OBSERVATION_COLLECTION, observationOrdered.unique)),
    ];
  }

  if (mode === "verify") {
    verify = verifyReceiptIndexDefinitions(
      await listDeclaredIndexes(GRANOT_OBSERVATION_RECEIPT_COLLECTION),
    );
    observationVerify = verifyObservationIndexDefinitions(
      await listDeclaredIndexes(GRANOT_OBSERVATION_COLLECTION),
    );
  }

  const uniqueCreated =
    mode === "apply" && collisions.length === 0 && observationCollisions.length === 0
      ? [
          ...ordered.unique.map((index) => index.name),
          ...observationOrdered.unique.map((index) => index.name),
        ]
      : [];

  const manifest = buildManifest({
    databaseName,
    mode,
    collisions,
    observationCollisions,
    created,
    uniqueCreated,
    verify,
    observationVerify,
  });
  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
    manifest,
  });

  if (mode === "verify") {
    const failed = [verify, observationVerify].filter((result) => result && !result.ok);
    if (failed.length > 0) {
      const missing = failed.flatMap((result) => result?.missing ?? []);
      const mismatched = failed.flatMap((result) => result?.mismatched ?? []);
      throw new Error(
        `Index verify failed: missing ${missing.join(", ") || "none"}; mismatched ${mismatched.join(", ") || "none"}.`,
      );
    }
  }
}

function buildManifest(input: {
  databaseName: string;
  mode: string;
  collisions: ReturnType<typeof findChannelOperationIdCollisions>;
  observationCollisions: ReturnType<typeof findObservationReceiptIdCollisions>;
  created: string[];
  uniqueCreated: string[];
  verify?: ReturnType<typeof verifyReceiptIndexDefinitions>;
  observationVerify?: ReturnType<typeof verifyObservationIndexDefinitions>;
}) {
  return {
    script_version: INDEX_MIGRATION_SCRIPT_VERSION,
    database_name: input.databaseName,
    mode: input.mode,
    contract_index_names: [
      ...GRANOT_OBSERVATION_RECEIPT_INDEXES.map((index) => index.name),
      ...GRANOT_OBSERVATION_INDEXES.map((index) => index.name),
    ],
    collision_count: input.collisions.length + input.observationCollisions.length,
    collisions: input.collisions,
    observation_receipt_id_collisions: input.observationCollisions,
    created_index_names: input.created,
    unique_index_names_created: input.uniqueCreated,
    verify: input.verify,
    observation_verify: input.observationVerify,
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
