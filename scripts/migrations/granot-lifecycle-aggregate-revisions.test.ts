import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateRevisionManifestBody,
  AGGREGATE_REVISION_COLLECTIONS,
  planAggregateRevisionMigration,
  verifyAggregateRevisionMigration,
} from "./granot-lifecycle-aggregate-revisions.lib";
import {
  assertRevisionApplyAllowed,
  fingerprintNormalizedJob,
  inventoryBookingJobs,
  plannedRevisionUpdateFields,
} from "./granot-lifecycle-revisions.lib";

const REVIEWED = "2026-08-17T20:00:00.000Z";

test("[AC-32] aggregate revision command owns only Booking/Cancellation collections", () => {
  assert.deepEqual([...AGGREGATE_REVISION_COLLECTIONS], ["booked_leads", "cancelled_leads"]);
});

test("[AC-21][AC-32] Booking collision inventory masks IDs and fingerprints the Job key", () => {
  const inventory = inventoryBookingJobs([
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", normalized_job_no: "SYNTHETIC JOB 100" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", normalized_job_no: "SYNTHETIC JOB 100" },
    { _id: "cccccccccccccccccccccccc", normalized_job_no: "SYNTHETIC JOB 200" },
    { _id: "dddddddddddddddddddddddd" },
    { _id: "eeeeeeeeeeeeeeeeeeeeeeee", normalized_job_no: 12 },
  ]);
  assert.equal(inventory.collision_groups.length, 1);
  assert.equal(inventory.collision_groups[0]?.count, 2);
  assert.equal(
    inventory.collision_groups[0]?.key_fingerprint,
    fingerprintNormalizedJob("SYNTHETIC JOB 100"),
  );
  assert.equal(inventory.missing_normalized_job, 1);
  assert.equal(inventory.invalid_normalized_job, 1);
  assert.equal(inventory.unique_index_ready, false);
  const serialized = JSON.stringify(inventory);
  assert.equal(serialized.includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
  assert.equal(serialized.includes("SYNTHETIC JOB 100"), false);
  assert.equal(serialized.includes("customer"), false);
});

test("[AC-21] collision fixtures block apply and unique-index readiness", () => {
  const planned = planAggregateRevisionMigration({
    rowsByCollection: {
      booked_leads: [
        {
          _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
          normalized_job_no: "SYNTHETIC JOB 100",
        },
        {
          _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
          normalized_job_no: "SYNTHETIC JOB 100",
        },
      ],
      cancelled_leads: [],
    },
  });
  assert.equal(planned.bookingJobs.unique_index_ready, false);
  assert.throws(() =>
    assertRevisionApplyAllowed({
      plans: planned.plans,
      bookingJobs: planned.bookingJobs,
    }),
  );
  const verified = verifyAggregateRevisionMigration({
    rowsByCollection: {
      booked_leads: [
        {
          _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
          domain_revision: 0,
          change_history_started_at: new Date(REVIEWED),
          normalized_job_no: "SYNTHETIC JOB 100",
        },
        {
          _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
          domain_revision: 0,
          change_history_started_at: new Date(REVIEWED),
          normalized_job_no: "SYNTHETIC JOB 100",
        },
      ],
      cancelled_leads: [],
    },
  });
  assert.equal(verified.ok, false);
});

test("[AC-32] apply field set never includes last-change, Decision, Command, or Sheet work", () => {
  const fields = plannedRevisionUpdateFields({
    set_revision: true,
    set_boundary: true,
    reviewedBoundary: new Date(REVIEWED),
  });
  assert.deepEqual(Object.keys(fields).sort(), [
    "change_history_started_at",
    "domain_revision",
  ]);
  assert.equal(fields.domain_revision, 0);
  assert.equal((fields.change_history_started_at as Date).toISOString(), REVIEWED);
});

test("[AC-32] report manifest stays PII-safe and records zero fabricated history", () => {
  const planned = planAggregateRevisionMigration({
    rowsByCollection: {
      booked_leads: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa" }],
      cancelled_leads: [{ _id: "bbbbbbbbbbbbbbbbbbbbbbbb" }],
    },
  });
  const manifest = aggregateRevisionManifestBody({
    databaseName: "testvantagemovers",
    databaseCategory: "test",
    mode: "report",
    reviewedBoundary: REVIEWED,
    boundarySource: "requested",
    plans: planned.plans,
    bookingJobs: planned.bookingJobs,
    applied: 0,
  });
  assert.equal(manifest.applied, 0);
  assert.equal(manifest.last_change_writes, 0);
  assert.equal(manifest.fabricated_entity_changes, 0);
  assert.equal(manifest.sheet_sync_requests, 0);
  assert.equal(JSON.stringify(manifest).includes("aaaaaaaaaaaaaaaaaaaaaaaa"), false);
  assert.ok(manifest.checksum.length > 20);
});
