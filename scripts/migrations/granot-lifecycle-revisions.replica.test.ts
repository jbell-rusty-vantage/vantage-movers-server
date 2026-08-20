import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { connectMongo } from "../../src/db";
import { BOOKED_LEAD_NORMALIZED_JOB_INDEX } from "../../src/models/BookedLead";
import {
  compareAndSwapDomainRevision,
  DOMAIN_REVISION_CONFLICT,
} from "../../src/services/granotLifecycle/aggregateRevision";
import {
  applyRevisionPlan,
  assertRevisionApplyAllowed,
  inventoryBookingJobs,
  planRevisionBackfill,
  verifyRevisionInventory,
} from "./granot-lifecycle-revisions.lib";
import { verifyBookedLeadNormalizedJobIndexDefinitions } from "./granot-lifecycle-indexes.lib";

const REVIEWED = new Date("2026-08-17T20:00:00.000Z");

function replicaEnvironmentReady(): string | null {
  if (process.env.GRANOT_LIFECYCLE_REPLICA_TESTS !== "true") {
    return "Replica-set proof is opt-in via GRANOT_LIFECYCLE_REPLICA_TESTS=true.";
  }
  if (!/^testvantagemovers(?:_[a-z0-9]+)?$/i.test(getMongoDatabaseName())) {
    return "Replica-set proof requires TEST_MODE=true before process start.";
  }
  return null;
}

const skipReason = replicaEnvironmentReady();

describe("Unit 09 replica-set revision proofs", { concurrency: 1, skip: skipReason ?? false }, () => {
  before(async () => {
    await connectMongo();
    if (mongoose.connection.db?.databaseName !== getMongoDatabaseName()) {
      throw new Error("Refusing replica-set proof against a non-test database.");
    }
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    if (!hello || hello.setName == null) {
      throw new Error("Connected Mongo is not a replica set.");
    }
  });

  after(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });

  test("[AC-21] replica CAS: sequential loser is DOMAIN_REVISION_CONFLICT; concurrent pair has one winner", async (t) => {
    const collection = mongoose.connection.db?.collection("u09_domain_revision_cas");
    assert.ok(collection);
    const inserted = await collection.insertOne({ domain_revision: 0 });
    const concurrent = await collection.insertOne({ domain_revision: 0 });
    t.after(async () => {
      await collection.deleteMany({
        _id: { $in: [inserted.insertedId, concurrent.insertedId] },
      });
    });

    const first = await compareAndSwapDomainRevision(collection, {
      _id: inserted.insertedId,
      domain_revision: 0,
    });
    const second = await compareAndSwapDomainRevision(collection, {
      _id: inserted.insertedId,
      domain_revision: 0,
    });
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.domain_revision, 1);
    }
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, DOMAIN_REVISION_CONFLICT);
    }
    const stored = await collection.findOne({ _id: inserted.insertedId });
    assert.equal(stored?.domain_revision, 1);

    const raced = await Promise.all([
      compareAndSwapDomainRevision(collection, {
        _id: concurrent.insertedId,
        domain_revision: 0,
      }),
      compareAndSwapDomainRevision(collection, {
        _id: concurrent.insertedId,
        domain_revision: 0,
      }),
    ]);
    assert.equal(raced.filter((result) => result.ok).length, 1);
    assert.equal(
      raced.filter((result) => !result.ok && result.code === DOMAIN_REVISION_CONFLICT).length,
      1,
    );
    const racedDoc = await collection.findOne({ _id: concurrent.insertedId });
    assert.equal(racedDoc?.domain_revision, 1);
  });

  test("[AC-32] disposable report writes zero documents; apply is conditional and idempotent", async () => {
    const collection = mongoose.connection.db?.collection("form_leads");
    assert.ok(collection);
    const missing = await collection.insertOne({
      name: "Synthetic Missing Revision",
      pickup_zip: "10001",
      destination_zip: "94105",
      move_size: "Studio",
      phone_number: "5550100180",
      _u09_marker: "revision-apply",
    });
    const positive = await collection.insertOne({
      name: "Synthetic Positive Revision",
      pickup_zip: "10001",
      destination_zip: "94105",
      move_size: "Studio",
      phone_number: "5550100181",
      domain_revision: 5,
      change_history_started_at: new Date("2026-01-01T00:00:00.000Z"),
      _u09_marker: "revision-apply",
    });
    try {
      const before = await collection.find({
        _id: { $in: [missing.insertedId, positive.insertedId] },
      }).toArray();
      const reportPlan = planRevisionBackfill({
        collection: "form_leads",
        rows: before.map((document) => ({
          _id: String(document._id),
          domain_revision: document.domain_revision,
          change_history_started_at: document.change_history_started_at,
        })),
      });
      assert.equal(reportPlan.planned.length, 1);
      assert.equal(reportPlan.already_current, 1);
      const afterReport = await collection.findOne({ _id: missing.insertedId });
      assert.equal(afterReport?.domain_revision, undefined);

      assertRevisionApplyAllowed({ plans: [reportPlan] });
      const firstApply = await applyRevisionPlan({
        collection,
        planned: reportPlan.planned,
        reviewedBoundary: REVIEWED,
      });
      assert.equal(firstApply.concurrent_mismatch, false);
      assert.ok(firstApply.updated >= 1);

      const filled = await collection.findOne({ _id: missing.insertedId });
      assert.equal(filled?.domain_revision, 0);
      assert.equal(
        (filled?.change_history_started_at as Date).toISOString(),
        REVIEWED.toISOString(),
      );
      const preserved = await collection.findOne({ _id: positive.insertedId });
      assert.equal(preserved?.domain_revision, 5);
      assert.equal(
        (preserved?.change_history_started_at as Date).toISOString(),
        "2026-01-01T00:00:00.000Z",
      );
      assert.equal(preserved?.last_change_id, undefined);

      const rerunPlan = planRevisionBackfill({
        collection: "form_leads",
        rows: [filled, preserved].map((document) => ({
          _id: String(document?._id),
          domain_revision: document?.domain_revision,
          change_history_started_at: document?.change_history_started_at,
        })),
      });
      assert.equal(rerunPlan.planned.length, 0);
      const secondApply = await applyRevisionPlan({
        collection,
        planned: rerunPlan.planned,
        reviewedBoundary: REVIEWED,
      });
      assert.equal(secondApply.updated, 0);

      const verified = verifyRevisionInventory({
        collection: "form_leads",
        rows: [filled, preserved].map((document) => ({
          _id: String(document?._id),
          domain_revision: document?.domain_revision,
          change_history_started_at: document?.change_history_started_at,
        })),
      });
      assert.equal(verified.ok, true);
    } finally {
      await collection.deleteMany({ _id: { $in: [missing.insertedId, positive.insertedId] } });
    }
  });

  test("[AC-21] Booking uniqueness/collision: duplicate Job blocks readiness; unique index holds", async () => {
    const collection = mongoose.connection.db?.collection("booked_leads");
    assert.ok(collection);
    const indexes = await collection.indexes();
    const verified = verifyBookedLeadNormalizedJobIndexDefinitions(
      indexes.map((index) => ({
        name: String(index.name),
        key: index.key as Record<string, unknown>,
        unique: index.unique === true ? true : undefined,
        partialFilterExpression: index.partialFilterExpression as
          | Record<string, unknown>
          | undefined,
      })),
    );
    const first = await collection.insertOne({
      book_date: new Date("2026-08-17T00:00:00.000Z"),
      job_no: "SYNTH-U09-COLLIDE",
      normalized_job_no: "SYNTH-U09-COLLIDE",
      merchant: "synthetic_merchant",
      source: "synthetic",
      deposit_amount: 0,
      total_binder_amount: 0,
      is_referral_booking: true,
      _u09_marker: "booking-collision",
    });
    let secondId: mongoose.Types.ObjectId | undefined;
    try {
      try {
        const second = await collection.insertOne({
          book_date: new Date("2026-08-17T00:00:00.000Z"),
          job_no: "SYNTH-U09-COLLIDE",
          normalized_job_no: "SYNTH-U09-COLLIDE",
          merchant: "synthetic_merchant",
          source: "synthetic",
          deposit_amount: 0,
          total_binder_amount: 0,
          is_referral_booking: true,
          _u09_marker: "booking-collision",
        });
        secondId = second.insertedId;
      } catch (error) {
        const code = (error as { code?: number }).code;
        assert.equal(code, 11000);
      }

      if (secondId) {
        const collisions = inventoryBookingJobs([
          { _id: String(first.insertedId), normalized_job_no: "SYNTH-U09-COLLIDE" },
          { _id: String(secondId), normalized_job_no: "SYNTH-U09-COLLIDE" },
        ]);
        assert.equal(collisions.unique_index_ready, false);
        assert.throws(() =>
          assertRevisionApplyAllowed({
            plans: [
              planRevisionBackfill({
                collection: "booked_leads",
                rows: [
                  { _id: String(first.insertedId) },
                  { _id: String(secondId) },
                ],
              }),
            ],
            bookingJobs: collisions,
          }),
        );
      } else {
        assert.equal(verified.ok || verified.missing.length === 0, true);
        assert.ok(
          indexes.some(
            (index) =>
              index.unique === true &&
              (index.name === BOOKED_LEAD_NORMALIZED_JOB_INDEX.name ||
                index.name === "normalized_job_no_1"),
          ),
        );
      }
    } finally {
      await collection.deleteMany({
        _id: { $in: [first.insertedId, ...(secondId ? [secondId] : [])] },
      });
    }
  });
});
