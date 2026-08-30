import type { JobTimelineRows, ObservationReceiptRow, ProcessedCallRow } from "./rows.js";
import type { JobTimelineEvent, TimelineEventTime } from "./types.js";

function asIso(value: string | undefined | null): string | null {
  return value && value.trim() ? value : null;
}

function receiptForEvent(
  event: JobTimelineEvent,
  rows: JobTimelineRows,
): ObservationReceiptRow | undefined {
  const receiptId = typeof event.data.receipt_id === "string" ? event.data.receipt_id : undefined;
  if (!receiptId) return undefined;
  return (rows.observation_receipts ?? []).find((row) => row.id === receiptId);
}

function processedCallForEvent(
  event: JobTimelineEvent,
  rows: JobTimelineRows,
): ProcessedCallRow | undefined {
  const suffix = event.id.startsWith("source_received:ringcentral:")
    ? event.id.slice("source_received:ringcentral:".length)
    : undefined;
  if (!suffix) return undefined;
  return (rows.processed_calls ?? []).find((row) => row.id === suffix);
}

export function selectEventTime(event: JobTimelineEvent, rows: JobTimelineRows): TimelineEventTime {
  const occurred_at = event.event_at;
  const occurred_at_field = event.clock_field;

  if (event.kind === "source_received" && event.data.ingress === "wordpress") {
    const receiptId = typeof event.data.receipt_id === "string" ? event.data.receipt_id : undefined;
    const receipt = receiptId
      ? (rows.wordpress_form_submission_receipts ?? []).find((row) => row.id === receiptId)
      : undefined;
    const recorded_at = asIso(receipt?.createdAt) ?? asIso(receipt?.received_at) ?? occurred_at;
    return {
      occurred_at,
      occurred_at_field,
      recorded_at,
      recorded_at_field: receipt?.createdAt
        ? "wordpress_receipt.createdAt"
        : "wordpress_receipt.received_at",
      precision: "capture",
    };
  }

  if (event.kind === "source_received" && event.data.ingress === "granot") {
    const receipt = receiptForEvent(event, rows);
    const recorded_at = asIso(receipt?.createdAt) ?? asIso(receipt?.captured_at) ?? occurred_at;
    return {
      occurred_at,
      occurred_at_field,
      recorded_at,
      recorded_at_field: receipt?.createdAt ? "receipt.createdAt" : "receipt.captured_at",
      precision: "capture",
    };
  }

  if (event.kind === "source_received" && event.data.ingress === "ringcentral") {
    const call = processedCallForEvent(event, rows);
    const recorded_at = asIso(call?.updatedAt) ?? asIso(call?.firstProcessedAt) ?? occurred_at;
    return {
      occurred_at,
      occurred_at_field,
      recorded_at,
      recorded_at_field: call?.updatedAt ? "processed_call.updatedAt" : "processed_call.firstProcessedAt",
      precision: "domain",
    };
  }

  if (event.kind === "granot_observation") {
    const observationId = typeof event.data.observation_id === "string" ? event.data.observation_id : undefined;
    const observation = (rows.observations ?? []).find((row) => row.id === observationId);
    const recorded_at = asIso(observation?.createdAt) ?? occurred_at;
    return {
      occurred_at,
      occurred_at_field,
      recorded_at,
      recorded_at_field: observation?.createdAt ? "observation.createdAt" : occurred_at_field,
      precision: observation?.createdAt && observation.createdAt !== occurred_at ? "capture" : "domain",
    };
  }

  if (event.kind === "lead_message") {
    const messageId = event.id.slice("lead_message:".length);
    const message = (rows.lead_messages ?? []).find((row) => row.id === messageId);
    const recorded_at = asIso(message?.createdAt) ?? occurred_at;
    return {
      occurred_at,
      occurred_at_field,
      recorded_at,
      recorded_at_field: message?.createdAt ? "lead_message.createdAt" : occurred_at_field,
      precision: event.clock_field.includes("delivered") || event.clock_field.includes("sent")
        ? "provider"
        : "domain",
    };
  }

  if (event.kind === "lead_created" && event.coverage === "official_fact_only") {
    const leadId = event.id.slice("lead_created:".length);
    const lead = (rows.leads ?? []).find((row) => row.id === leadId);
    const recorded_at = asIso(lead?.createdAt) ?? occurred_at;
    return {
      occurred_at,
      occurred_at_field,
      recorded_at,
      recorded_at_field: lead?.createdAt ? "lead.createdAt" : occurred_at_field,
      precision: "storage_fallback",
    };
  }

  if (event.kind === "sheet_sync") {
    const jobId = typeof event.data.job_id === "string" ? event.data.job_id : event.id.slice("sheet_sync:".length);
    const job = (rows.sheet_sync_jobs ?? []).find((row) => row.id === jobId);
    const recorded_at = asIso(job?.createdAt) ?? occurred_at;
    return {
      occurred_at,
      occurred_at_field,
      recorded_at,
      recorded_at_field: "sheet_sync_job.createdAt",
      precision: "domain",
    };
  }

  if (event.kind === "official_booking") {
    const bookingId = typeof event.data.booking_id === "string" ? event.data.booking_id : undefined;
    const booking = (rows.bookings ?? []).find((row) => row.id === bookingId);
    const recorded_at = asIso(booking?.createdAt) ?? occurred_at;
    return {
      occurred_at,
      occurred_at_field,
      recorded_at,
      recorded_at_field: booking?.createdAt ? "booking.createdAt" : occurred_at_field,
      precision: "domain",
    };
  }

  if (event.kind === "official_cancellation") {
    const cancellationId = typeof event.data.cancellation_id === "string"
      ? event.data.cancellation_id
      : undefined;
    const cancellation = (rows.cancellations ?? []).find((row) => row.id === cancellationId);
    const recorded_at = asIso(cancellation?.createdAt) ?? occurred_at;
    return {
      occurred_at,
      occurred_at_field,
      recorded_at,
      recorded_at_field: cancellation?.createdAt ? "cancellation.createdAt" : occurred_at_field,
      precision: "domain",
    };
  }

  if (event.clock_field.includes("applied_at") || event.clock_field.includes("decided_at")) {
    return {
      occurred_at,
      occurred_at_field,
      recorded_at: occurred_at,
      recorded_at_field: occurred_at_field,
      precision: "domain",
    };
  }

  return {
    occurred_at,
    occurred_at_field,
    recorded_at: occurred_at,
    recorded_at_field: occurred_at_field,
    precision: "domain",
  };
}

export function compareOccurredThenPriority(
  left: { time: TimelineEventTime; type_priority: number; id: string },
  right: { time: TimelineEventTime; type_priority: number; id: string },
): number {
  if (left.time.occurred_at !== right.time.occurred_at) {
    return left.time.occurred_at.localeCompare(right.time.occurred_at);
  }
  if (left.type_priority !== right.type_priority) {
    return left.type_priority - right.type_priority;
  }
  return left.id.localeCompare(right.id);
}
