import { waitUntil } from "@vercel/functions";
import { connectMongo } from "../../db";
import { logger } from "../../logger";
import { sheetSyncLogContext, type FullSheetSyncJob } from "./sheetSyncJobs";
import {
  syncBookedLeadById,
  syncBookingChainById,
  syncCancellationChainById,
  syncSourceLeadById,
} from "./sheetSyncSourceLookup";

/**
 * Schedules a sheet sync job to run as a Vercel `waitUntil` background task.
 *
 * Logs scheduling, success, and failure with the same `${operation}.sheet_sync.*`
 * message shape used before extraction so existing log searches keep working.
 */
export function scheduleFullSheetSyncProcess(job: FullSheetSyncJob): void {
  const context = sheetSyncLogContext(job);
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
