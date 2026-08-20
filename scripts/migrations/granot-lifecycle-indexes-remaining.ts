/**
 * Completes collision-free unique/S08 index creates after the official
 * catalog apply stops on a Record Link collision. Never creates
 * `granot_record_link_active_job_unique`.
 *
 *   TEST_MODE=false RINGCENTRAL_COLLECTION_MODE=production \
 *     pnpm exec tsx --env-file=.env scripts/migrations/granot-lifecycle-indexes-remaining.ts \
 *     --apply --confirm-production=vantagemovers
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { DOMAIN_COMMAND_EXECUTION_INDEXES } from "../../src/models/DomainCommandExecution.js";
import { ENTITY_CHANGE_INDEXES } from "../../src/models/EntityChange.js";
import { ENTITY_CHANGE_COLLECTION } from "../../src/models/EntityChange.js";
import { FORM_LEAD_S08_INDEXES } from "../../src/models/FormLead.js";
import { CALL_LEAD_S08_INDEXES } from "../../src/models/CallLead.js";
import { GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES } from "../../src/models/GranotCrmSource.js";
import { GRANOT_CRM_SOURCE_COLLECTION } from "../../src/models/GranotCrmSource.js";
import { GRANOT_LIFECYCLE_ACTIVATION_INDEXES } from "../../src/models/GranotLifecycleActivation.js";
import { GRANOT_LIFECYCLE_ACTIVATION_COLLECTION } from "../../src/models/GranotLifecycleActivation.js";
import { SYNCHRONIZATION_DECISION_INDEXES } from "../../src/models/SynchronizationDecision.js";
import { SYNCHRONIZATION_DECISION_COLLECTION } from "../../src/models/SynchronizationDecision.js";
import { GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES } from "../../src/models/GranotBookingReconciliationCase.js";
import { GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES } from "../../src/models/GranotReleaseReconciliationCase.js";
import { GRANOT_BOOKING_DISCREPANCY_INDEXES } from "../../src/models/GranotBookingDiscrepancy.js";
import { GRANOT_RELEASE_DISCREPANCY_INDEXES } from "../../src/models/GranotReleaseDiscrepancy.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
} from "./granot-lifecycle-migration.lib.js";
import {
  CALL_LEAD_COLLECTION,
  DOMAIN_COMMAND_EXECUTION_COLLECTION,
  FORM_LEAD_COLLECTION,
  GRANOT_BOOKING_DISCREPANCY_COLLECTION,
  GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
  GRANOT_RELEASE_DISCREPANCY_COLLECTION,
  GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION,
} from "./granot-lifecycle-indexes.lib.js";

type IndexSpec = {
  name: string;
  key: Record<string, number>;
  unique?: true;
  sparse?: true;
  partialFilterExpression?: Record<string, unknown>;
};

const GROUPS: Array<{ collection: string; indexes: readonly IndexSpec[] }> = [
  { collection: FORM_LEAD_COLLECTION, indexes: FORM_LEAD_S08_INDEXES },
  { collection: CALL_LEAD_COLLECTION, indexes: CALL_LEAD_S08_INDEXES },
  { collection: DOMAIN_COMMAND_EXECUTION_COLLECTION, indexes: DOMAIN_COMMAND_EXECUTION_INDEXES },
  { collection: ENTITY_CHANGE_COLLECTION, indexes: ENTITY_CHANGE_INDEXES },
  { collection: GRANOT_CRM_SOURCE_COLLECTION, indexes: GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES },
  { collection: GRANOT_LIFECYCLE_ACTIVATION_COLLECTION, indexes: GRANOT_LIFECYCLE_ACTIVATION_INDEXES },
  { collection: SYNCHRONIZATION_DECISION_COLLECTION, indexes: SYNCHRONIZATION_DECISION_INDEXES },
  {
    collection: GRANOT_BOOKING_RECONCILIATION_CASE_COLLECTION,
    indexes: GRANOT_BOOKING_RECONCILIATION_CASE_INDEXES,
  },
  {
    collection: GRANOT_RELEASE_RECONCILIATION_CASE_COLLECTION,
    indexes: GRANOT_RELEASE_RECONCILIATION_CASE_INDEXES,
  },
  { collection: GRANOT_BOOKING_DISCREPANCY_COLLECTION, indexes: GRANOT_BOOKING_DISCREPANCY_INDEXES },
  { collection: GRANOT_RELEASE_DISCREPANCY_COLLECTION, indexes: GRANOT_RELEASE_DISCREPANCY_INDEXES },
];

async function main(): Promise<void> {
  assertGranotLifecycleApplyAuthorized({
    args: process.argv,
    databaseName: getMongoDatabaseName(),
  });
  await connectMongo();
  const databaseName = mongoose.connection.db?.databaseName;
  assertGranotLifecycleDatabaseAllowed(databaseName);
  if (databaseName !== getMongoDatabaseName()) {
    throw new Error("Connected database does not match migration preflight database.");
  }
  assertGranotLifecycleApplyAuthorized({
    args: process.argv,
    databaseName,
  });

  const created: string[] = [];
  const skipped: string[] = [];
  for (const group of GROUPS) {
    const collection = mongoose.connection.db?.collection(group.collection);
    if (!collection) {
      throw new Error(`Cannot create indexes: ${group.collection} is unavailable.`);
    }
    let existing: Awaited<ReturnType<typeof collection.indexes>> = [];
    try {
      existing = await collection.indexes();
    } catch (error) {
      if ((error as { code?: number }).code !== 26) throw error;
    }
    for (const spec of group.indexes) {
      const present = existing.some((index) => index.name === spec.name);
      if (present) {
        skipped.push(`${group.collection}.${spec.name}`);
        continue;
      }
      const sameKey = existing.filter(
        (index) =>
          index.name !== "_id_" &&
          JSON.stringify(index.key) === JSON.stringify(spec.key),
      );
      for (const index of sameKey) {
        await collection.dropIndex(String(index.name));
      }
      try {
        await collection.createIndex(spec.key, {
          name: spec.name,
          ...("unique" in spec && spec.unique ? { unique: true } : {}),
          ...("sparse" in spec && spec.sparse ? { sparse: true } : {}),
          ...("partialFilterExpression" in spec
            ? { partialFilterExpression: spec.partialFilterExpression }
            : {}),
        });
        created.push(`${group.collection}.${spec.name}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push(`${group.collection}.${spec.name}: ${message}`);
      }
      existing = await collection.indexes();
    }
  }

  console.log(
    JSON.stringify(
      {
        database_name: databaseName,
        skipped_record_link_unique: "granot_record_link_active_job_unique",
        created,
        already_present: skipped,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
