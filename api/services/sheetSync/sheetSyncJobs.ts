import type { LeadModelName } from "../../config/domain";

export type SourceLeadSheetSyncJob = {
  resource: "source_lead";
  operation: string;
  leadModel: LeadModelName;
  leadId: string;
};

export type BookingChainSheetSyncJob = {
  resource: "booking_chain";
  operation: string;
  bookingId: string;
};

export type BookedLeadSheetSyncJob = {
  resource: "booked_lead";
  operation: string;
  bookingId: string;
};

export type CancellationChainSheetSyncJob = {
  resource: "cancellation_chain";
  operation: string;
  cancellationId: string;
};

export type FullSheetSyncJob =
  | SourceLeadSheetSyncJob
  | BookedLeadSheetSyncJob
  | BookingChainSheetSyncJob
  | CancellationChainSheetSyncJob;

export function sheetSyncLogContext(job: FullSheetSyncJob): Record<string, string> {
  switch (job.resource) {
    case "source_lead":
      return {
        resource: job.resource,
        leadModel: job.leadModel,
        leadId: job.leadId,
      };
    case "booking_chain":
    case "booked_lead":
      return {
        resource: job.resource,
        bookingId: job.bookingId,
      };
    case "cancellation_chain":
      return {
        resource: job.resource,
        cancellationId: job.cancellationId,
      };
  }
}
