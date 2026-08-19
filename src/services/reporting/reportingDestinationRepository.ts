import mongoose from "mongoose";
import { ReportingDestination } from "../../models/ReportingDestination";
import { toObjectId } from "../../utils/objectId";
import type { DurableActor } from "../durableWork";
import { snapshotChecksumFromDestinationRecord } from "./destinationContract";

export type ReportingDestinationRecord = Record<string, unknown>;

export async function listReportingDestinations(input: {
  state?: "active" | "archived";
  limit?: number;
}): Promise<ReportingDestinationRecord[]> {
  const query = ReportingDestination.find({
    ...(input.state ? { state: input.state } : {}),
  })
    .sort({ updated_at: -1, _id: 1 })
    .limit(input.limit ?? 50);
  return query.lean().exec();
}

export async function getReportingDestinationById(
  id: string,
): Promise<ReportingDestinationRecord | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  return ReportingDestination.findById(id).lean().exec();
}

export async function insertReportingDestination(
  value: Record<string, unknown>,
): Promise<ReportingDestinationRecord> {
  const created = await ReportingDestination.create(value);
  return created.toObject();
}

export async function updateReportingDestination(
  id: string,
  expectedVersion: number,
  patch: Record<string, unknown>,
): Promise<ReportingDestinationRecord | null> {
  return ReportingDestination.findOneAndUpdate(
    { _id: id, version: expectedVersion, state: "active" },
    {
      $set: patch,
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  )
    .lean()
    .exec();
}

/**
 * CAS-update the managed immutable sheet ID after a verified replace_tab
 * promotion. Matches the previously published sheet ID so a concurrent repair
 * cannot be clobbered.
 */
export async function casUpdateManagedSheetAfterPromotion(input: {
  destinationId: string;
  expectedOldSheetId: number;
  nextSheetId: number;
  publishedTitle: string;
  now: Date;
}): Promise<ReportingDestinationRecord | null> {
  if (
    !Number.isSafeInteger(input.expectedOldSheetId) ||
    !Number.isSafeInteger(input.nextSheetId)
  ) {
    throw new TypeError("Invalid managed sheet IDs for promotion CAS.");
  }
  return ReportingDestination.collection.findOneAndUpdate(
    {
      _id: toObjectId(input.destinationId),
      state: "active",
      strategy: "replace_tab",
      "managed_tab.immutable_sheet_id": input.expectedOldSheetId,
    },
    {
      $set: {
        "managed_tab.immutable_sheet_id": input.nextSheetId,
        "managed_tab.name": input.publishedTitle,
        access_status: "verified",
        health_verified_at: input.now,
        denylist_checked_at: input.now,
        updated_at: input.now,
      },
      $addToSet: {
        "managed_tab.predecessor_sheet_ids": input.expectedOldSheetId,
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  );
}

/**
 * After a live denylist allow, refresh denylist_checked_at with health so
 * verified destinations do not age out spuriously on only one timestamp.
 */
export async function refreshDestinationHealthAndDenylist(input: {
  destinationId: string;
  now: Date;
}): Promise<boolean> {
  if (!mongoose.isValidObjectId(input.destinationId)) return false;
  const result = await ReportingDestination.collection.updateOne(
    {
      _id: toObjectId(input.destinationId),
      state: "active",
      access_status: "verified",
    },
    {
      $set: {
        health_verified_at: input.now,
        denylist_checked_at: input.now,
        updated_at: input.now,
      },
    },
  );
  return result.matchedCount === 1;
}

export async function archiveReportingDestination(
  id: string,
  expectedVersion: number,
  actor: DurableActor,
): Promise<ReportingDestinationRecord | null> {
  return ReportingDestination.findOneAndUpdate(
    { _id: id, version: expectedVersion, state: "active" },
    {
      $set: {
        state: "archived",
        access_status: "unhealthy",
        updated_by: actor,
      },
      $inc: { version: 1 },
    },
    { returnDocument: "after" },
  )
    .lean()
    .exec();
}

export function safeReportingDestinationForRead(
  value: ReportingDestinationRecord,
): Record<string, unknown> {
  const destinationId = String(value._id ?? "");
  const snapshotChecksum = snapshotChecksumFromDestinationRecord(value, destinationId);
  const safe: Record<string, unknown> = {
    _id: value._id,
    provider: value.provider,
    owner_identity_snapshot: value.owner_identity_snapshot,
    folder: value.folder,
    strategy: value.strategy,
    workbook: value.workbook ?? null,
    managed_tab: value.managed_tab ?? null,
    destination_type: value.destination_type,
    ownership_policy: value.ownership_policy,
    access_status: value.access_status,
    health_verified_at: value.health_verified_at ?? null,
    denylist_checked_at: value.denylist_checked_at ?? null,
    capacity: value.capacity,
    state: value.state,
    version: value.version,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
  if (snapshotChecksum) {
    safe.snapshot_checksum = snapshotChecksum;
  }
  return safe;
}
