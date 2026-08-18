/**
 * 34.3 Lead provenance + Unit 09 revision/history-boundary foundation.
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
  applyLeadProvenancePlan,
  assertLeadProvenanceApplyAllowed,
  LEAD_PROVENANCE_REVISION_COLLECTIONS,
  leadProvenanceApplyManifest,
  leadProvenanceReviewProjection,
  planLeadProvenanceMigration,
  planLeadRevisionMigration,
  projectLeadProvenanceInventoryRow,
  readReviewedBaselineArg,
  resolveReviewedBaseline,
  scanLeadProvenanceArtifactForPii,
  verifyLeadProvenanceMigration,
  type LeadProvenanceInventoryRow,
} from "./granot-lifecycle-lead-provenance.lib.js";
import {
  applyRevisionPlan,
  assertNotHistoricalDatabase,
  granotLifecycleDatabaseCategory,
  readReviewedBoundaryArg,
  resolveReviewedBoundary,
} from "./granot-lifecycle-revisions.lib.js";

const OUTPUT_DIR = granotLifecycleOutputDirectory("granot-lifecycle-lead-provenance");

const LEAD_PROJECTION = {
  domain_revision: 1,
  last_change_id: 1,
  last_changed_at: 1,
  change_history_started_at: 1,
  ingestion_origin: 1,
  job_no: 1,
  normalized_job_no: 1,
  ingested_contact_snapshot: 1,
  ingested_move_snapshot: 1,
  first_name: 1,
  last_name: 1,
  name: 1,
  phone_number: 1,
  normalized_phone_number: 1,
  email: 1,
  pickup_city: 1,
  pickup_zip: 1,
  pickup_state: 1,
  delivery_city: 1,
  destination_zip: 1,
  delivery_state: 1,
  move_date: 1,
  move_size: 1,
  duplicate: 1,
  bad_lead: 1,
  source_granularity_id: 1,
  ref_no: 1,
  lid: 1,
  quoted: 1,
  booked: 1,
  cancelled: 1,
  cpl: 1,
  sheet_sync: 1,
  "ringcentral.ingestion_source": 1,
} as const;

async function loadRows(
  collectionName: (typeof LEAD_PROVENANCE_REVISION_COLLECTIONS)[number],
): Promise<LeadProvenanceInventoryRow[]> {
  const collection = mongoose.connection.db?.collection(collectionName);
  if (!collection) {
    throw new Error(`Cannot load ${collectionName}: Mongo collection is unavailable.`);
  }
  const documents = await collection.find({}, { projection: LEAD_PROJECTION }).toArray();
  return documents.map((document) =>
    projectLeadProvenanceInventoryRow(document as Record<string, unknown>),
  );
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
  const baseline = await resolveReviewedBaseline({
    requested: readReviewedBaselineArg(process.argv),
    allowGenerate: mode === "report",
  });
  const rowsByCollection = {
    form_leads: await loadRows("form_leads"),
    call_leads: await loadRows("call_leads"),
  };
  const revisionPlans = planLeadRevisionMigration({ rowsByCollection });
  const provenancePlans = planLeadProvenanceMigration({ rowsByCollection });
  let applied = 0;
  let concurrentMismatch = false;
  let verify: ReturnType<typeof verifyLeadProvenanceMigration> | undefined;

  if (mode === "apply") {
    assertLeadProvenanceApplyAllowed({
      plans: provenancePlans,
      revisionPlans,
    });
    const reviewedBoundary = new Date(boundary.record.reviewed_change_history_started_at);
    const baselineCapturedAt = new Date(baseline.record.baseline_captured_at);
    for (const plan of revisionPlans) {
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
    if (!concurrentMismatch) {
      for (const plan of provenancePlans) {
        const collection = mongoose.connection.db?.collection(plan.collection);
        if (!collection) {
          throw new Error(`Cannot apply ${plan.collection}: Mongo collection is unavailable.`);
        }
        const result = await applyLeadProvenancePlan({
          collection,
          collectionName: plan.collection,
          planned: plan.planned,
          baselineCapturedAt,
        });
        applied += result.updated;
        if (result.concurrent_mismatch) {
          concurrentMismatch = true;
          break;
        }
      }
    }
    if (concurrentMismatch) {
      throw new Error("Lead provenance apply aborted: concurrent mismatch on a still-missing filter.");
    }
  }

  if (mode === "verify") {
    verify = verifyLeadProvenanceMigration({
      rowsByCollection,
      baselineCapturedAt: baseline.record.baseline_captured_at,
    });
  }

  const applyManifest = leadProvenanceApplyManifest({
    databaseName,
    databaseCategory: granotLifecycleDatabaseCategory(databaseName),
    mode,
    baselineCapturedAt: baseline.record.baseline_captured_at,
    baselineSource: baseline.source,
    reviewedBoundary: boundary.record.reviewed_change_history_started_at,
    plans: provenancePlans,
    revisionPlans,
    applied,
    concurrentMismatch,
  });
  const review = leadProvenanceReviewProjection({
    databaseName,
    databaseCategory: granotLifecycleDatabaseCategory(databaseName),
    mode,
    baselineCapturedAt: baseline.record.baseline_captured_at,
    baselineSource: baseline.source,
    reviewedBoundary: boundary.record.reviewed_change_history_started_at,
    plans: provenancePlans,
    revisionPlans,
    applied,
    concurrentMismatch,
    applyChecksum: applyManifest.checksum,
    verify,
  });
  const piiFindings = [
    ...scanLeadProvenanceArtifactForPii(review),
    ...scanLeadProvenanceArtifactForPii(applyManifest),
  ];
  if (piiFindings.length > 0) {
    throw new Error(`Refusing to write Lead provenance artifacts: PII scan failed.`);
  }

  const runId = `granot-lifecycle-lead-provenance-${mode}-${Date.now()}`;
  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `${runId}-apply`,
    manifest: applyManifest,
  });
  await writeGranotLifecycleManifest({
    directory: OUTPUT_DIR,
    runId: `${runId}-review`,
    manifest: review,
  });

  if (mode === "verify" && verify && !verify.ok) {
    throw new Error(
      `Lead provenance verify failed: ${verify.failures.join("; ") || "invariant mismatch"}.`,
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
