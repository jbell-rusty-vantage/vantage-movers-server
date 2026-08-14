/**
 * 34.5 — Granot Observation Receipt index deployment.
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
  orderedReceiptIndexCreates,
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

async function listDeclaredIndexes(): Promise<DeclaredMongoIndex[]> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
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
  specs: readonly (typeof GRANOT_OBSERVATION_RECEIPT_INDEXES)[number][],
): Promise<string[]> {
  const collection = mongoose.connection.db?.collection(
    GRANOT_OBSERVATION_RECEIPT_COLLECTION,
  );
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
  const ordered = orderedReceiptIndexCreates();
  let created: string[] = [];
  let verify: ReturnType<typeof verifyReceiptIndexDefinitions> | undefined;

  if (mode === "apply") {
    created = await createIndexes(ordered.nonUnique);
    if (collisions.length > 0) {
      const manifest = buildManifest({
        databaseName,
        mode,
        collisions,
        created,
        uniqueCreated: [],
        verify,
      });
      await writeGranotLifecycleManifest({
        directory: OUTPUT_DIR,
        runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
        manifest,
      });
      throw new Error(
        `Refusing unique index create: ${collisions.length} collision group(s).`,
      );
    }
    created = [...created, ...(await createIndexes(ordered.unique))];
  }

  if (mode === "verify") {
    verify = verifyReceiptIndexDefinitions(await listDeclaredIndexes());
  }

  const manifest = buildManifest({
    databaseName,
    mode,
    collisions,
    created,
    uniqueCreated: mode === "apply" && collisions.length === 0
      ? ordered.unique.map((index) => index.name)
      : [],
    verify,
  });
  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `granot-lifecycle-indexes-${mode}-${Date.now()}`,
    manifest,
  });

  if (mode === "verify" && verify && !verify.ok) {
    throw new Error(
      `Index verify failed: missing ${verify.missing.join(", ") || "none"}; mismatched ${verify.mismatched.join(", ") || "none"}.`,
    );
  }
}

function buildManifest(input: {
  databaseName: string;
  mode: string;
  collisions: ReturnType<typeof findChannelOperationIdCollisions>;
  created: string[];
  uniqueCreated: string[];
  verify?: ReturnType<typeof verifyReceiptIndexDefinitions>;
}) {
  return {
    script_version: INDEX_MIGRATION_SCRIPT_VERSION,
    database_name: input.databaseName,
    mode: input.mode,
    contract_index_names: GRANOT_OBSERVATION_RECEIPT_INDEXES.map(
      (index) => index.name,
    ),
    collision_count: input.collisions.length,
    collisions: input.collisions,
    created_index_names: input.created,
    unique_index_names_created: input.uniqueCreated,
    verify: input.verify,
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(message);
  process.exitCode = 1;
});
