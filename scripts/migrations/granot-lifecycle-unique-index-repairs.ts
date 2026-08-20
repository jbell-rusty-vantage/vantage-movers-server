/**
 * Production repair for the two unique indexes the catalog still refuses:
 * one Record Link race, and unmapped CRM sources missing normalized labels.
 *
 *   TEST_MODE=false RINGCENTRAL_COLLECTION_MODE=production \
 *     pnpm exec tsx --env-file=.env scripts/migrations/granot-lifecycle-unique-index-repairs.ts \
 *     --apply --confirm-production=vantagemovers
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { getMongoDatabaseName } from "../../src/config/domain/runtime.js";
import { GRANOT_CRM_SOURCE_COLLECTION, GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES } from "../../src/models/GranotCrmSource.js";
import {
  GRANOT_RECORD_LINK_COLLECTION,
  GRANOT_RECORD_LINK_INDEXES,
  assertAllowlistedRecordLinkRefreshUpdate,
} from "../../src/models/GranotRecordLink.js";
import { normalizeGranotSourceLabel } from "../../src/services/granotLifecycle/sourceLabel.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
} from "./granot-lifecycle-migration.lib.js";

const KEEP_LINK_ID = "6a86982f78429188531c3e83";
const SUPERSEDE_LINK_ID = "6a86982f78429188531c3e87";
const JOB = "5557044";

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

  const db = mongoose.connection.db;
  if (!db) throw new Error("Mongo database is unavailable.");

  const links = db.collection(GRANOT_RECORD_LINK_COLLECTION);
  const keepId = new mongoose.Types.ObjectId(KEEP_LINK_ID);
  const supersedeId = new mongoose.Types.ObjectId(SUPERSEDE_LINK_ID);
  const [keep, supersede] = await Promise.all([
    links.findOne({ _id: keepId, normalized_job_no: JOB, state: "active" }),
    links.findOne({ _id: supersedeId, normalized_job_no: JOB, state: "active" }),
  ]);
  if (!keep || !supersede) {
    throw new Error("Expected both colliding Record Links to still be active.");
  }
  if (keep.lead_ref || keep.booking_ref || supersede.lead_ref || supersede.booking_ref) {
    throw new Error("Refusing race repair: a colliding link already has a Lead or Booking.");
  }
  const now = new Date();
  const linkUpdate = {
    $set: {
      state: "superseded",
      superseded_by: keepId,
      last_changed_at: now,
      updatedAt: now,
    },
    $inc: { domain_revision: 1 },
  };
  assertAllowlistedRecordLinkRefreshUpdate(linkUpdate);
  const linkResult = await links.updateOne(
    { _id: supersedeId, state: "active", domain_revision: 0, normalized_job_no: JOB },
    linkUpdate,
  );
  if (linkResult.matchedCount !== 1) {
    throw new Error("Record Link supersede did not match the expected active race loser.");
  }

  const crm = db.collection(GRANOT_CRM_SOURCE_COLLECTION);
  const unlabeled = await crm
    .find({
      $or: [
        { normalized_granot_label: { $exists: false } },
        { normalized_granot_label: null },
        { normalized_granot_label: "" },
      ],
    })
    .project({ _id: 1, granot_label: 1 })
    .toArray();
  const labelWrites: Array<{ id: string; granot_label: string; normalized_granot_label: string }> = [];
  for (const row of unlabeled) {
    const granotLabel = typeof row.granot_label === "string" ? row.granot_label : "";
    const normalized = normalizeGranotSourceLabel(granotLabel);
    if (!normalized) {
      throw new Error(`Cannot normalize CRM source ${String(row._id)}: granot_label is unusable.`);
    }
    await crm.updateOne(
      { _id: row._id, $or: [{ normalized_granot_label: { $exists: false } }, { normalized_granot_label: null }, { normalized_granot_label: "" }] },
      { $set: { normalized_granot_label: normalized, updatedAt: now } },
    );
    labelWrites.push({
      id: String(row._id),
      granot_label: granotLabel,
      normalized_granot_label: normalized,
    });
  }

  const createdIndexes: string[] = [];
  for (const spec of [
    GRANOT_RECORD_LINK_INDEXES[0],
    GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES[0],
  ]) {
    const collectionName =
      spec.name === GRANOT_RECORD_LINK_INDEXES[0].name
        ? GRANOT_RECORD_LINK_COLLECTION
        : GRANOT_CRM_SOURCE_COLLECTION;
    const collection = db.collection(collectionName);
    const existing = await collection.indexes();
    if (existing.some((index) => index.name === spec.name)) {
      continue;
    }
    await collection.createIndex(spec.key, {
      name: spec.name,
      unique: true,
      ...("partialFilterExpression" in spec
        ? { partialFilterExpression: spec.partialFilterExpression }
        : {}),
    });
    createdIndexes.push(`${collectionName}.${spec.name}`);
  }

  const remainingActive = await links.countDocuments({
    provider: "granot",
    normalized_job_no: JOB,
    state: "active",
  });
  const remainingUnlabeled = await crm.countDocuments({
    $or: [
      { normalized_granot_label: { $exists: false } },
      { normalized_granot_label: null },
      { normalized_granot_label: "" },
    ],
  });

  console.log(
    JSON.stringify(
      {
        database_name: databaseName,
        kept_record_link: KEEP_LINK_ID,
        superseded_record_link: SUPERSEDE_LINK_ID,
        remaining_active_links_for_job: remainingActive,
        crm_labels_written: labelWrites,
        remaining_unlabeled_crm_sources: remainingUnlabeled,
        created_indexes: createdIndexes,
      },
      null,
      2,
    ),
  );
  if (remainingActive !== 1 || remainingUnlabeled !== 0) {
    throw new Error("Repair did not leave exactly one active link and zero unlabeled CRM sources.");
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
