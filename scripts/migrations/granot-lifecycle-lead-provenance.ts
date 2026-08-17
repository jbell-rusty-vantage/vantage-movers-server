/**
 * 34.3 revision-only foundation — Form/Call domain_revision and history boundary.
 *
 * Dry-run / --report by default. Mutation requires
 * --apply --confirm-production=<database-name>.
 *
 *   pnpm migration:granot-lifecycle:leads -- --report
 *   pnpm migration:granot-lifecycle:leads -- --apply --confirm-production=testvantagemovers
 *   pnpm migration:granot-lifecycle:leads -- --verify
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
  granotLifecycleOutputDirectory,
  parseGranotLifecycleMigrationMode,
  writeGranotLifecycleManifest,
} from "./granot-lifecycle-migration.lib.js";
import {
  leadRevisionManifestBody,
  LEAD_PROVENANCE_REVISION_COLLECTIONS,
  planLeadRevisionMigration,
  verifyLeadRevisionMigration,
} from "./granot-lifecycle-lead-provenance.lib.js";
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

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-lead-provenance");

async function loadRows(
  collectionName: (typeof LEAD_PROVENANCE_REVISION_COLLECTIONS)[number],
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
        },
      },
    )
    .toArray();
  return documents.map(projectRevisionInventoryRow);
}

async function main(): Promise<void> {
  const mode = parseGranotLifecycleMigrationMode(process.argv);
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertGranotLifecycleDatabaseAllowed(databaseName);
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
    form_leads: await loadRows("form_leads"),
    call_leads: await loadRows("call_leads"),
  };
  const plans = planLeadRevisionMigration({ rowsByCollection });
  let applied = 0;
  let concurrentMismatch = false;
  let verify: ReturnType<typeof verifyLeadRevisionMigration> | undefined;

  if (mode === "apply") {
    assertRevisionApplyAllowed({ plans });
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
    verify = verifyLeadRevisionMigration({ rowsByCollection });
  }

  const manifest = leadRevisionManifestBody({
    databaseName,
    databaseCategory: granotLifecycleDatabaseCategory(databaseName),
    mode,
    reviewedBoundary: boundary.record.reviewed_change_history_started_at,
    boundarySource: boundary.source,
    plans,
    applied,
    concurrentMismatch,
    verify,
  });
  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `granot-lifecycle-lead-provenance-${mode}-${Date.now()}`,
    manifest,
  });

  if (mode === "verify" && verify && !verify.ok) {
    throw new Error(
      `Lead revision verify failed: ${verify.failures.join("; ") || "invariant mismatch"}.`,
    );
  }
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
