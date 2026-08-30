/**
 * JTE-06 Cancellation correlation snapshots.
 *
 * Report is the default. Apply requires --apply --confirm-production=<db>.
 * Production apply / index / vantagemovers backfill stay unauthorized unless
 * the Owner later passes the existing confirm flag.
 *
 *   TEST_MODE=true pnpm migration:cancellation-correlation-snapshots -- --report
 *   TEST_MODE=true pnpm migration:cancellation-correlation-snapshots -- --apply --confirm-production=testvantagemovers
 *   TEST_MODE=true pnpm migration:cancellation-correlation-snapshots -- --verify --confirm-production=testvantagemovers
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import { CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX } from "../../src/models/CancelledLead.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  CANCELLATION_CORRELATION_SNAPSHOTS_SCRIPT_VERSION,
  CANCELLATION_SNAPSHOT_INDEX_NAME,
  cancellationSnapshotBackfillUpdate,
  classifyHistoricalCancellation,
  summarizeCancellationSnapshotInventory,
  type ClassificationResult,
} from "./cancellation-correlation-snapshots.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("cancellation-correlation-snapshots");

function asId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "toHexString" in value) {
    return String((value as { toHexString: () => string }).toHexString());
  }
  return String(value);
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

function snapshotIndexPresent(
  indexes: Array<{ name?: string; key?: Record<string, unknown> }>,
): boolean {
  return indexes.some(
    (index) =>
      index.name === CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX.name
      && JSON.stringify(index.key) === JSON.stringify(CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX.key),
  );
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
  const db = mongoose.connection.db;
  if (!db) throw new Error("Connected Mongo database is unavailable.");
  const cancellations = db.collection("cancelled_leads");
  const bookings = db.collection("booked_leads");

  const cancellationRows = await cancellations
    .find({}, {
      projection: {
        booked_lead: 1,
        job_no_snapshot: 1,
        normalized_job_no_snapshot: 1,
        lead_ref_snapshot: 1,
        booking_created_at_snapshot: 1,
      },
    })
    .toArray();
  const bookingIds = [
    ...new Set(
      cancellationRows
        .map((row) => asId(row.booked_lead))
        .filter(Boolean),
    ),
  ];
  const bookingDocs = bookingIds.length > 0
    ? await bookings
      .find(
        { _id: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) } },
        {
          projection: {
            job_no: 1,
            normalized_job_no: 1,
            lead_ref: 1,
            lead_model: 1,
            createdAt: 1,
          },
        },
      )
      .toArray()
    : [];
  const bookingsById = new Map(bookingDocs.map((row) => [asId(row._id), row]));

  const classified: ClassificationResult[] = cancellationRows.map((row) =>
    classifyHistoricalCancellation({
      cancellation: {
        id: asId(row._id),
        booked_lead: row.booked_lead ? asId(row.booked_lead) : null,
        has_normalized_job_no_snapshot: typeof row.normalized_job_no_snapshot === "string",
        normalized_job_no_snapshot: row.normalized_job_no_snapshot,
        job_no_snapshot: row.job_no_snapshot,
      },
      booking: (bookingsById.get(asId(row.booked_lead)) as {
        job_no?: unknown;
        normalized_job_no?: unknown;
        lead_ref?: unknown;
        lead_model?: unknown;
        createdAt?: unknown;
      } | undefined) ?? null,
    }),
  );
  const summary = summarizeCancellationSnapshotInventory(classified);
  let indexes = await readIndexes(cancellations);
  const createdIndexNames: string[] = [];
  let updated = 0;

  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({ args, databaseName });
    if (!snapshotIndexPresent(indexes)) {
      await cancellations.createIndex(
        CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX.key,
        {
          name: CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX.name,
          unique: false,
          partialFilterExpression:
            CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX.partialFilterExpression,
        },
      );
      createdIndexNames.push(CANCELLATION_SNAPSHOT_INDEX_NAME);
      indexes = await readIndexes(cancellations);
    }
    for (const row of classified) {
      if (row.class !== "deterministic" || !row.snapshots) continue;
      const result = await cancellations.updateOne(
        {
          _id: new mongoose.Types.ObjectId(row.id),
          $or: [
            { normalized_job_no_snapshot: { $exists: false } },
            { normalized_job_no_snapshot: null },
            { normalized_job_no_snapshot: "" },
          ],
        },
        { $set: {
          ...cancellationSnapshotBackfillUpdate(row.snapshots),
          lead_ref_snapshot: row.snapshots.lead_ref_snapshot
            ? {
                model: row.snapshots.lead_ref_snapshot.model,
                id: new mongoose.Types.ObjectId(row.snapshots.lead_ref_snapshot.id),
              }
            : null,
        } },
      );
      updated += result.modifiedCount;
    }
  }

  const indexPresent = snapshotIndexPresent(indexes);
  const manifest = {
    script_version: CANCELLATION_CORRELATION_SNAPSHOTS_SCRIPT_VERSION,
    mode,
    database: databaseName,
    generated_at: new Date().toISOString(),
    authorization: {
      write_target: "test database only unless later Owner approval",
      production_apply_authorized: false,
      confirmed_database: args.find((arg) => arg.startsWith("--confirm-production="))
        ?.slice("--confirm-production=".length) ?? null,
    },
    summary,
    required_index_present: indexPresent,
    created_index_names: createdIndexNames,
    updated,
    observed_index_names: indexes
      .map((index) => index.name)
      .filter((name): name is string => typeof name === "string"),
  };
  const output = await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `${mode}-${Date.now()}`,
    manifest,
  });
  console.log(JSON.stringify({
    ...manifest,
    output,
    remainder_ids: summary.remainder_ids,
  }, null, 2));

  if (mode === "verify") {
    const deterministicMissing = classified.filter((row) => row.class === "deterministic").length;
    if (!indexPresent || deterministicMissing > 0) {
      throw new Error(
        "Cancellation snapshot verification failed: index missing or deterministic rows remain unstamped.",
      );
    }
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
