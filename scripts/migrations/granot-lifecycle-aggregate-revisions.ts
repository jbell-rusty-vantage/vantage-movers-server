/**
 * 34.4 — Booking/Cancellation revisions, history boundary, and Job uniqueness readiness.
 *
 * Dry-run / --report by default. Mutation requires
 * --apply --confirm-production=<database-name>.
 *
 *   pnpm migration:granot-lifecycle:revisions -- --report
 *   pnpm migration:granot-lifecycle:revisions -- --apply --confirm-production=testvantagemovers
 *   pnpm migration:granot-lifecycle:revisions -- --verify
 */
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { connectMongo } from "../../src/db.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  aggregateRevisionManifestBody,
  AGGREGATE_REVISION_COLLECTIONS,
  planAggregateRevisionMigration,
  verifyAggregateRevisionMigration,
} from "./granot-lifecycle-aggregate-revisions.lib.js";
import {
  applyRevisionPlan,
  assertNotHistoricalDatabase,
  assertRevisionApplyAllowed,
  granotLifecycleDatabaseCategory,
  projectRevisionInventoryRow,
  readReviewedBoundaryArg,
  resolveReviewedBoundary,
  type RevisionInventoryRow,
} from "./granot-lifecycle-revisions.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-aggregate-revisions");

async function loadRows(
  collectionName: (typeof AGGREGATE_REVISION_COLLECTIONS)[number],
): Promise<RevisionInventoryRow[]> {
  const collection = mongoose.connection.db?.collection(collectionName);
  if (!collection) {
    throw new Error(`Cannot load ${collectionName}: Mongo collection is unavailable.`);
  }
  const documents = await collection
    .find(
      {},
      {
        projection: {
          domain_revision: 1,
          last_change_id: 1,
          last_changed_at: 1,
          change_history_started_at: 1,
          normalized_job_no: 1,
        },
      },
    )
    .toArray();
  return documents.map(projectRevisionInventoryRow);
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
  assertNotHistoricalDatabase(databaseName);
  if (mode === "apply") {
    assertGranotLifecycleApplyAuthorized({
      args: process.argv,
      databaseName,
    });
  }

  const boundary = await resolveReviewedBoundary({
    requested: readReviewedBoundaryArg(process.argv),
    allowGenerate: mode === "report",
  });
  const rowsByCollection = {
    booked_leads: await loadRows("booked_leads"),
    cancelled_leads: await loadRows("cancelled_leads"),
  };
  const { plans, bookingJobs } = planAggregateRevisionMigration({ rowsByCollection });
  let applied = 0;
  let concurrentMismatch = false;
  let verify: ReturnType<typeof verifyAggregateRevisionMigration> | undefined;

  if (mode === "apply") {
    assertRevisionApplyAllowed({ plans, bookingJobs });
    const reviewedBoundary = new Date(boundary.record.reviewed_change_history_started_at);
    for (const plan of plans) {
      const collection = mongoose.connection.db?.collection(plan.collection);
      if (!collection) {
        throw new Error(`Cannot apply ${plan.collection}: Mongo collection is unavailable.`);
      }
      const result = await applyRevisionPlan({
        collection,
        planned: plan.planned,
        reviewedBoundary,
      });
      applied += result.updated;
      if (result.concurrent_mismatch) {
        concurrentMismatch = true;
        break;
      }
    }
    if (concurrentMismatch) {
      throw new Error("Revision apply aborted: concurrent mismatch on a still-missing filter.");
    }
  }

  if (mode === "verify") {
    verify = verifyAggregateRevisionMigration({ rowsByCollection });
  }

  const manifest = aggregateRevisionManifestBody({
    databaseName,
    databaseCategory: granotLifecycleDatabaseCategory(databaseName),
    mode,
    reviewedBoundary: boundary.record.reviewed_change_history_started_at,
    boundarySource: boundary.source,
    plans,
    bookingJobs,
    applied,
    concurrentMismatch,
    verify,
  });
  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `granot-lifecycle-aggregate-revisions-${mode}-${Date.now()}`,
    manifest,
  });

  if (mode === "verify" && verify && !verify.ok) {
    throw new Error(
      `Aggregate revision verify failed: ${verify.failures.join("; ") || "invariant mismatch"}.`,
    );
  }
}

main()
  .catch(() => {
    console.error("Granot lifecycle revision migration failed with a bounded technical error.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
