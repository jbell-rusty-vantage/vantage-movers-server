import type { RegistryActorContext } from "../operationsRegistry/types";
import type { DurableActor, DurableAuditEnvelope } from "./types";

const SENSITIVE_KEY =
  /authorization|cookie|credential|password|secret|token|api[_-]?key|refresh|raw[_-]?row|report[_-]?row/i;

export function durableActorFromRegistryActor(
  actor: RegistryActorContext,
): DurableActor {
  if (actor.actorType === "system") {
    throw new TypeError(
      "Registry system actors must use a dedicated durable system-actor factory.",
    );
  }
  return {
    actor_type: actor.actorType,
    actor_id: actor.actorId,
    actor_label: actor.actorLabel,
    actor_role: actor.actorRole,
    request_id: actor.requestId,
    origin: "vantage_admin",
  };
}

export function createBestRelocationIngestionActor(
  requestId: string,
): DurableActor {
  return {
    actor_type: "system",
    actor_id: "best-relocation-ingestion",
    actor_label: "Best Relocation ingestion",
    actor_role: "system",
    request_id: requestId,
    origin: "external_sheet_ingestion",
  };
}

export function createReportingProjectionActor(
  requestId: string,
): DurableActor {
  return {
    actor_type: "system",
    actor_id: "reporting-projection",
    actor_label: "Reporting projection",
    actor_role: "system",
    request_id: requestId,
    origin: "reporting_projection",
  };
}

export function createGranotLifecycleProcessorActor(
  receiptId: string,
): DurableActor {
  return {
    actor_type: "system",
    actor_id: "granot-lifecycle-processor",
    actor_label: "Granot Lifecycle Processor",
    actor_role: "system",
    request_id: receiptId,
    origin: "granot_lifecycle",
  };
}

export function createGranotWebhookInitiator(receiptId: string): DurableActor {
  return {
    actor_type: "system",
    actor_id: "granot-webhook",
    actor_label: "Granot webhook",
    actor_role: "system",
    request_id: receiptId,
    origin: "granot_lifecycle",
  };
}

export function createRingCentralCallIngestActor(
  requestId: string,
): DurableActor {
  return {
    actor_type: "system",
    actor_id: "ringcentral-call-ingest",
    actor_label: "RingCentral call ingest",
    actor_role: "system",
    request_id: requestId,
    origin: "ringcentral",
  };
}

export function createDurableAuditEnvelope(input: {
  actor: DurableActor;
  initiator: DurableActor;
  run_id?: string | null;
  command_id?: string | null;
  source_receipt_id?: string | null;
  occurred_at: Date;
}): DurableAuditEnvelope {
  return {
    actor: input.actor,
    initiator: input.initiator,
    run_id: input.run_id ?? null,
    command_id: input.command_id ?? null,
    source_receipt_id: input.source_receipt_id ?? null,
    occurred_at: input.occurred_at,
  };
}

export function sanitizeDurableMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = "[redacted]";
    } else if (isRecord(entry)) {
      result[key] = sanitizeDurableMetadata(entry);
    } else if (Array.isArray(entry)) {
      result[key] = entry.map((item) =>
        isRecord(item) ? sanitizeDurableMetadata(item) : item,
      );
    } else {
      result[key] = entry;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}
