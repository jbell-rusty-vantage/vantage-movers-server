import { waitUntil } from "@vercel/functions";
import type { ClientSession } from "mongoose";
import { getSheetSyncMode } from "../../config/domain";
import { connectMongo, withTransaction } from "../../db";
import { logger } from "../../logger";
import { enqueueSheetSyncJob } from "./sheetSyncOutbox.service";
import { publishSheetSyncWakeup } from "./sheetSyncQueue.service";
import { sheetSyncLogContext, type FullSheetSyncJob } from "./sheetSyncJobs";
import {
  syncBookedLeadById,
  syncBookingChainById,
  syncCancellationChainById,
  syncSourceLeadById,
} from "./sheetSyncSourceLookup";

/**
 * Mode-aware compatibility boundary for sheet sync.
 *
 * - `legacy`   -> the original Vercel `waitUntil(runFullSheetSyncProcess)`.
 * - `queued`   -> best-effort fallback: enqueue a durable outbox job and
 *                 publish a wake-up in the background. Transactional callers
 *                 should prefer `persistSheetSyncIntent` (inside their Mongo
 *                 transaction) + `finalizeSheetSync` (after commit); this path
 *                 keeps any un-migrated caller correct.
 * - `disabled` -> log intent and do nothing.
 *
 * Log message shapes are preserved (`${operation}.sheet_sync.*`) so existing
 * log searches keep working.
 */
export function scheduleFullSheetSyncProcess(job: FullSheetSyncJob): void {
  const context = sheetSyncLogContext(job);
  const mode = getSheetSyncMode();

  if (mode === "disabled") {
    logger.info({ msg: `${job.operation}.sheet_sync.disabled`, ...context });
    return;
  }

  if (mode === "queued") {
    logger.info({ msg: `${job.operation}.sheet_sync.queued`, ...context });
    waitUntil(
      enqueueAndPublish(job).catch((error) => {
        logger.error(
          { err: error, msg: `${job.operation}.sheet_sync.enqueue_failed`, ...context },
          "Background sheet sync enqueue failed",
        );
      }),
    );
    return;
  }

  logger.info({ msg: `${job.operation}.sheet_sync.scheduled`, ...context });
  waitUntil(
    runFullSheetSyncProcess(job).catch((error) => {
      logger.error(
        {
          err: error,
          msg: `${job.operation}.sheet_sync.failed`,
          ...context,
        },
        "Background sheet sync failed",
      );
    }),
  );
}

async function enqueueAndPublish(job: FullSheetSyncJob): Promise<void> {
  await connectMongo();
  await enqueueSheetSyncJob(job);
  await publishSheetSyncWakeup({ reason: "domain_write" });
}

/**
 * Runs a domain write through the correct durability path for the active mode.
 *
 * - `queued`            -> opens a real Mongo transaction and passes the session
 *                          to `fn`, so the domain document writes and the outbox
 *                          job (via `persistSheetSyncIntent`) commit atomically.
 * - `legacy`/`disabled` -> runs `fn` with `undefined` (no transaction), exactly
 *                          preserving the current production code path so the
 *                          default mode sees zero behavioral change.
 *
 * `fn` must keep external side effects (Sheets, queue publish, CRM) out of the
 * callback; callers run those after this resolves (see `finalizeSheetSync`).
 */
export async function runSheetSyncWrite<T>(
  fn: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  if (getSheetSyncMode() === "queued") {
    return withTransaction((session) => fn(session));
  }
  await connectMongo();
  return fn(undefined);
}

/**
 * Writes durable sheet-sync intent for a domain write, intended to run inside
 * the caller's Mongo transaction so the domain document and the outbox job
 * commit atomically.
 *
 * Only acts in `queued` mode. In `legacy`/`disabled` mode it is a no-op; those
 * modes rely on `finalizeSheetSync` (called after commit) to schedule or skip
 * the sync.
 */
export async function persistSheetSyncIntent(
  job: FullSheetSyncJob,
  session?: ClientSession,
): Promise<void> {
  if (getSheetSyncMode() !== "queued") {
    return;
  }
  await enqueueSheetSyncJob(job, { session, createdBy: "api" });
}

/**
 * Completes sheet-sync handling for a domain write, intended to run AFTER the
 * Mongo transaction commits.
 *
 * - `queued`   -> publish a queue wake-up (durable job already committed).
 * - `legacy`   -> schedule the original `waitUntil` background sync.
 * - `disabled` -> log intent only.
 */
export async function finalizeSheetSync(job: FullSheetSyncJob): Promise<void> {
  const mode = getSheetSyncMode();
  if (mode === "disabled") {
    logger.info({ msg: `${job.operation}.sheet_sync.disabled`, ...sheetSyncLogContext(job) });
    return;
  }
  if (mode === "queued") {
    await publishSheetSyncWakeup({ reason: "domain_write" });
    return;
  }
  scheduleFullSheetSyncProcess(job);
}

/**
 * Publishes a queue wake-up after a delete tombstone has been committed.
 *
 * Intended to run AFTER the Mongo transaction commits in `queued` mode. In
 * `legacy`/`disabled` mode it is a no-op: those modes perform the sheet row
 * deletion inline (see each delete service) rather than via the outbox.
 */
export async function finalizeSheetSyncDelete(): Promise<void> {
  if (getSheetSyncMode() !== "queued") {
    return;
  }
  await publishSheetSyncWakeup({ reason: "domain_delete" });
}

/**
 * Schedules a source-lead sync for a call lead. Exposed so call lead
 * enrichment and reconciliation services can request a row refresh without
 * reaching into the coordinator's job-shape internals.
 */
export function scheduleCallLeadSheetSync(leadId: string, operation: string): void {
  scheduleFullSheetSyncProcess({
    resource: "source_lead",
    operation,
    leadModel: "CallLead",
    leadId,
  });
}

/**
 * Schedules a booking-chain sync. Used by booked-call-lead reconciliation
 * after it mutates a booking and its source lead.
 */
export function scheduleBookingChainSheetSync(bookingId: string, operation: string): void {
  scheduleFullSheetSyncProcess({
    resource: "booking_chain",
    operation,
    bookingId,
  });
}

/**
 * Schedules a booked-row-only sync. Referral bookings use this so they update
 * the Master Booked sheet without trying to refresh a non-existent lead row.
 */
export function scheduleBookedLeadSheetSync(bookingId: string, operation: string): void {
  scheduleFullSheetSyncProcess({
    resource: "booked_lead",
    operation,
    bookingId,
  });
}

/**
 * Runs the full sheet sync process synchronously. Normally invoked through
 * `scheduleFullSheetSyncProcess`, but exposed for callers that need to await
 * a sync (e.g. tests, scripts, or future synchronous workflows).
 */
export async function runFullSheetSyncProcess(job: FullSheetSyncJob): Promise<void> {
  const context = sheetSyncLogContext(job);
  logger.info({ msg: `${job.operation}.sheet_sync.started`, ...context });

  await connectMongo();

  switch (job.resource) {
    case "source_lead":
      await syncSourceLeadById(job.leadModel, job.leadId);
      break;
    case "booked_lead":
      await syncBookedLeadById(job.bookingId);
      break;
    case "booking_chain":
      await syncBookingChainById(job.bookingId);
      break;
    case "cancellation_chain":
      await syncCancellationChainById(job.cancellationId);
      break;
  }

  logger.info({ msg: `${job.operation}.sheet_sync.completed`, ...context });
}
