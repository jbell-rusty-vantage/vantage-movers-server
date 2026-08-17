import {
  BOOKING_REVISION_COLLECTIONS,
  inventoryBookingJobs,
  planRevisionBackfill,
  publicRevisionCollectionSummary,
  revisionManifestChecksum,
  verifyRevisionInventory,
  type BookingJobInventory,
  type RevisionCollectionPlan,
  type RevisionInventoryRow,
} from "./granot-lifecycle-revisions.lib";

export const AGGREGATE_REVISION_SCRIPT_VERSION =
  "granot-lifecycle-aggregate-revisions/1";

export const AGGREGATE_REVISION_COLLECTIONS = BOOKING_REVISION_COLLECTIONS;

export function planAggregateRevisionMigration(input: {
  rowsByCollection: Record<(typeof BOOKING_REVISION_COLLECTIONS)[number], readonly RevisionInventoryRow[]>;
}): {
  plans: RevisionCollectionPlan[];
  bookingJobs: BookingJobInventory;
} {
  const plans = BOOKING_REVISION_COLLECTIONS.map((collection) =>
    planRevisionBackfill({
      collection,
      rows: input.rowsByCollection[collection],
    }),
  );
  return {
    plans,
    bookingJobs: inventoryBookingJobs(input.rowsByCollection.booked_leads),
  };
}

export function verifyAggregateRevisionMigration(input: {
  rowsByCollection: Record<(typeof BOOKING_REVISION_COLLECTIONS)[number], readonly RevisionInventoryRow[]>;
}) {
  const planned = planAggregateRevisionMigration(input);
  const results = BOOKING_REVISION_COLLECTIONS.map((collection) =>
    verifyRevisionInventory({
      collection,
      rows: input.rowsByCollection[collection],
    }),
  );
  const failures = results.flatMap((result) => result.failures);
  if (!planned.bookingJobs.unique_index_ready) {
    failures.push(
      `booked_leads: ${planned.bookingJobs.collision_groups.length} normalized-Job collision group(s)`,
    );
  }
  return {
    ok: failures.length === 0,
    failures,
    bookingJobs: planned.bookingJobs,
  };
}

export function aggregateRevisionManifestBody(input: {
  databaseName: string;
  databaseCategory: "test" | "production";
  mode: string;
  reviewedBoundary: string;
  boundarySource: string;
  plans: readonly RevisionCollectionPlan[];
  bookingJobs: BookingJobInventory;
  applied: number;
  concurrentMismatch?: boolean;
  verify?: { ok: boolean; failures: string[] };
}) {
  const collections = input.plans.map(publicRevisionCollectionSummary);
  const checksum = revisionManifestChecksum({
    reviewed_change_history_started_at: input.reviewedBoundary,
    collections: collections.map((collection) => ({
      collection: collection.collection,
      total: collection.total,
      missing_revision: collection.missing_revision,
      valid_revision: collection.valid_revision,
      invalid_revision: collection.invalid_revision,
      missing_boundary: collection.missing_boundary,
      valid_boundary: collection.valid_boundary,
      invalid_boundary: collection.invalid_boundary,
      planned_count: collection.planned_count,
      blocker_count: collection.blocker_count,
    })),
    collision_count: input.bookingJobs.collision_groups.length,
    unique_index_ready: input.bookingJobs.unique_index_ready,
  });
  return {
    script_version: AGGREGATE_REVISION_SCRIPT_VERSION,
    database_name: input.databaseName,
    database_category: input.databaseCategory,
    mode: input.mode,
    reviewed_change_history_started_at: input.reviewedBoundary,
    reviewed_boundary_source: input.boundarySource,
    collections,
    booking_job_readiness: {
      missing_normalized_job: input.bookingJobs.missing_normalized_job,
      invalid_normalized_job: input.bookingJobs.invalid_normalized_job,
      collision_count: input.bookingJobs.collision_groups.length,
      unique_index_ready: input.bookingJobs.unique_index_ready,
      collisions: input.bookingJobs.collision_groups,
      missing_masked_ids: input.bookingJobs.missing_masked_ids,
      invalid_masked_ids: input.bookingJobs.invalid_masked_ids,
    },
    applied: input.applied,
    concurrent_mismatch: input.concurrentMismatch ?? false,
    last_change_writes: 0,
    fabricated_entity_changes: 0,
    fabricated_decisions: 0,
    fabricated_commands: 0,
    sheet_sync_requests: 0,
    historical_collections_targeted: [],
    checksum,
    verify: input.verify,
  };
}
