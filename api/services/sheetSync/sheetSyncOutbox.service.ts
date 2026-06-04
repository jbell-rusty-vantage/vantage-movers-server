import type { ClientSession } from "mongoose";
import {
  buildCoalescingKey,
  getSheetSyncDrainGuardrails,
  priorityForJob,
  supersededUpsertCoalescingKey,
  type SheetSyncCreatedBy,
  type SheetSyncEntityModel,
  type SheetSyncResource,
} from "../../config/domain";
import { logger } from "../../logger";
import { SheetSyncJob, type SheetSyncJobDocument } from "../../models/SheetSyncJob";
import type { FullSheetSyncJob } from "./sheetSyncJobs";

/**
 * Statuses that a new domain write may coalesce onto. We deliberately exclude
 * `processing`: coalescing onto an in-flight job risks the drainer marking it
 * `synced` while losing the newer write. Instead a write during processing
 * creates a fresh `pending` job, which the drainer later reloads against the
 * latest Mongo state (at most one extra idempotent sync).
 */
const COALESCE_STATUSES = ["pending", "retrying"] as const;

type JobDescriptor = {
  resource: SheetSyncResource;
  entityModel: SheetSyncEntityModel;
  entityId: string;
};

/**
 * Translates the in-memory `FullSheetSyncJob` (the legacy scheduler shape that
 * domain services already build) into the durable outbox descriptor.
 */
function describeJob(job: FullSheetSyncJob): JobDescriptor {
  switch (job.resource) {
    case "source_lead":
      return { resource: "source_lead", entityModel: job.leadModel, entityId: job.leadId };
    case "booked_lead":
      return { resource: "booked_lead", entityModel: "BookedLead", entityId: job.bookingId };
    case "booking_chain":
      return { resource: "booking_chain", entityModel: "BookedLead", entityId: job.bookingId };
    case "cancellation_chain":
      return {
        resource: "cancellation_chain",
        entityModel: "CancelledLead",
        entityId: job.cancellationId,
      };
  }
}

export type EnqueueSheetSyncJobOptions = {
  session?: ClientSession;
  createdBy?: SheetSyncCreatedBy;
  /** Override the debounce-derived due time (e.g. cron/admin re-enqueue). */
  dueAt?: Date;
};

/**
 * Creates or coalesces a durable upsert outbox job for a domain write.
 *
 * Repeated writes for the same entity collapse onto one active row via the
 * coalescing key; `due_at` is pulled earlier (never pushed later) and the
 * highest priority wins. Designed to run inside the caller's Mongo transaction
 * so the domain document and the outbox job commit atomically.
 */
export async function enqueueSheetSyncJob(
  job: FullSheetSyncJob,
  options: EnqueueSheetSyncJobOptions = {},
): Promise<SheetSyncJobDocument> {
  const { resource, entityModel, entityId } = describeJob(job);
  return upsertActiveJob({
    resource,
    entityModel,
    entityId,
    operation: job.operation,
    options,
  });
}

async function upsertActiveJob(args: {
  resource: SheetSyncResource;
  entityModel: SheetSyncEntityModel;
  entityId: string;
  operation: string;
  options: EnqueueSheetSyncJobOptions;
}): Promise<SheetSyncJobDocument> {
  const { resource, entityModel, entityId, operation, options } = args;
  const coalescingKey = buildCoalescingKey({ resource, entityId, entityModel });
  const priority = priorityForJob(resource, operation);
  const guardrails = getSheetSyncDrainGuardrails();
  const dueAt = options.dueAt ?? new Date(Date.now() + guardrails.debounceWindowMs);

  const job = await SheetSyncJob.findOneAndUpdate(
    { coalescing_key: coalescingKey, status: { $in: COALESCE_STATUSES } },
    {
      $set: {
        resource,
        operation,
        entity_model: entityModel,
        entity_id: entityId,
        coalescing_key: coalescingKey,
        target_hints: [],
      },
      $max: { priority },
      $min: { due_at: dueAt },
      $setOnInsert: {
        status: "pending",
        attempts: 0,
        created_by: options.createdBy ?? "api",
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      session: options.session,
    },
  );

  logger.info({
    msg: "sheet_sync.outbox.enqueued",
    coalescingKey,
    resource,
    operation,
    jobId: job._id.toString(),
    dueAt: job.due_at,
    priority: job.priority,
  });

  return job;
}

type SheetSyncEntryLike = {
  target: string;
  spreadsheet_id: string;
  tab_name: string;
  row_number?: number;
  status?: string;
};

/**
 * Snapshots a soon-to-be-deleted document's `sheet_sync` metadata into the
 * tombstone `previous_targets` shape. The drainer re-validates each row against
 * the live tab before deleting, so a stale `row_number` is safe.
 */
export function buildTombstonePreviousTargets(
  sheetSync: SheetSyncEntryLike[] | undefined,
): { target: string; spreadsheet_id: string; tab_name: string; row_number?: number }[] {
  return (sheetSync ?? [])
    .filter((entry) => entry.spreadsheet_id && entry.tab_name)
    .map((entry) => ({
      target: entry.target,
      spreadsheet_id: entry.spreadsheet_id,
      tab_name: entry.tab_name,
      row_number: entry.row_number,
    }));
}

export type SheetSyncTombstoneInput = {
  mongo_id: string;
  source_company?: string;
  duplicate?: boolean;
  previous_targets?: {
    target: string;
    spreadsheet_id: string;
    tab_name: string;
    row_number?: number;
  }[];
  linked_booking_id?: string;
  linked_cancellation_id?: string;
  linked_lead_id?: string;
  linked_lead_model?: string;
};

export type EnqueueSheetSyncTombstoneOptions = EnqueueSheetSyncJobOptions & {
  targetHints?: string[];
};

/**
 * Creates a durable delete tombstone job and cancels any pending upsert job it
 * supersedes for the same entity. Deletes are time-critical (a stale upsert
 * could re-add a deleted row), so they bypass the debounce window.
 */
export async function enqueueSheetSyncTombstone(
  args: {
    resource: "delete_source_lead" | "delete_booked_lead" | "delete_cancelled_lead";
    entityModel: SheetSyncEntityModel;
    entityId: string;
    operation: string;
    tombstone: SheetSyncTombstoneInput;
  },
  options: EnqueueSheetSyncTombstoneOptions = {},
): Promise<SheetSyncJobDocument> {
  const { resource, entityModel, entityId, operation, tombstone } = args;
  const coalescingKey = buildCoalescingKey({ resource, entityId, entityModel });
  const priority = priorityForJob(resource, operation);

  const supersededKey = supersededUpsertCoalescingKey({ resource, entityId, entityModel });
  if (supersededKey) {
    const result = await SheetSyncJob.updateMany(
      { coalescing_key: supersededKey, status: { $in: COALESCE_STATUSES } },
      { $set: { status: "cancelled", last_error: "superseded_by_delete_tombstone" } },
      { session: options.session },
    );
    if (result.modifiedCount > 0) {
      logger.info({
        msg: "sheet_sync.outbox.upsert_superseded_by_delete",
        supersededKey,
        cancelled: result.modifiedCount,
      });
    }
  }

  const job = await SheetSyncJob.findOneAndUpdate(
    { coalescing_key: coalescingKey, status: { $in: COALESCE_STATUSES } },
    {
      $set: {
        resource,
        operation,
        entity_model: entityModel,
        entity_id: entityId,
        coalescing_key: coalescingKey,
        tombstone,
        target_hints: options.targetHints ?? [],
      },
      $max: { priority },
      $min: { due_at: new Date() },
      $setOnInsert: {
        status: "pending",
        attempts: 0,
        created_by: options.createdBy ?? "api",
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      session: options.session,
    },
  );

  logger.info({
    msg: "sheet_sync.outbox.tombstone_enqueued",
    coalescingKey,
    resource,
    operation,
    jobId: job._id.toString(),
    mongoId: tombstone.mongo_id,
  });

  return job;
}
