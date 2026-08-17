import {
  LEAD_REVISION_COLLECTIONS,
  planRevisionBackfill,
  publicRevisionCollectionSummary,
  revisionManifestChecksum,
  verifyRevisionInventory,
  type RevisionCollectionPlan,
  type RevisionInventoryRow,
} from "./granot-lifecycle-revisions.lib";

export const LEAD_PROVENANCE_REVISION_SCRIPT_VERSION =
  "granot-lifecycle-lead-provenance/1";

export const LEAD_PROVENANCE_REVISION_COLLECTIONS = LEAD_REVISION_COLLECTIONS;

export function planLeadRevisionMigration(input: {
  rowsByCollection: Record<(typeof LEAD_REVISION_COLLECTIONS)[number], readonly RevisionInventoryRow[]>;
}): RevisionCollectionPlan[] {
  return LEAD_REVISION_COLLECTIONS.map((collection) =>
    planRevisionBackfill({
      collection,
      rows: input.rowsByCollection[collection],
    }),
  );
}

export function verifyLeadRevisionMigration(input: {
  rowsByCollection: Record<(typeof LEAD_REVISION_COLLECTIONS)[number], readonly RevisionInventoryRow[]>;
}) {
  const results = LEAD_REVISION_COLLECTIONS.map((collection) =>
    verifyRevisionInventory({
      collection,
      rows: input.rowsByCollection[collection],
    }),
  );
  return {
    ok: results.every((result) => result.ok),
    failures: results.flatMap((result) => result.failures),
  };
}

export function leadRevisionManifestBody(input: {
  databaseName: string;
  databaseCategory: "test" | "production";
  mode: string;
  reviewedBoundary: string;
  boundarySource: string;
  plans: readonly RevisionCollectionPlan[];
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
  });
  return {
    script_version: LEAD_PROVENANCE_REVISION_SCRIPT_VERSION,
    database_name: input.databaseName,
    database_category: input.databaseCategory,
    mode: input.mode,
    reviewed_change_history_started_at: input.reviewedBoundary,
    reviewed_boundary_source: input.boundarySource,
    collections,
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
