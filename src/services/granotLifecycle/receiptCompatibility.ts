import type { GranotRouteEventClass, ReceiptWorkState } from "./types";
import {
  classifyPayloadKind,
  hashCredentialRedactedPayload,
  mergeRemovedCredentialKeyCounts,
  redactCredentialKeys,
  type RemovedCredentialKeyCounts,
} from "./receiptEvidence";

export const LEGACY_RECEIVED_PROCESSING_STATUS = "received" as const;

export const REFUSED_LEGACY_PROCESSING_STATUSES = [
  "processed",
  "ignored",
  "failed",
] as const;

export type ReceiptProcessingDefaults = {
  state: Extract<ReceiptWorkState, "pending">;
  technical_attempts: number;
  match_attempt: 0;
  next_attempt_at: Date;
  manual_requeue_count: 0;
};

export type LegacyProcessingTranslation =
  | { ok: true; processing: ReceiptProcessingDefaults }
  | {
      ok: false;
      reason: "refused_legacy_processing_status";
      processing_status: string;
    };

const ROUTE_EVENT_CLASSES = new Set<GranotRouteEventClass>([
  "lead_created",
  "priority_updated",
  "booking_status_changed",
]);

export function isGranotRouteEventClass(
  value: unknown,
): value is GranotRouteEventClass {
  return (
    typeof value === "string" &&
    ROUTE_EVENT_CLASSES.has(value as GranotRouteEventClass)
  );
}

export function translateLegacyProcessingState(
  processingStatus: unknown,
  processingAttempts: unknown,
  capturedAt: Date,
): LegacyProcessingTranslation {
  if (processingStatus !== LEGACY_RECEIVED_PROCESSING_STATUS) {
    return {
      ok: false,
      reason: "refused_legacy_processing_status",
      processing_status:
        typeof processingStatus === "string" ? processingStatus : "unknown",
    };
  }

  return {
    ok: true,
    processing: {
      state: "pending",
      technical_attempts: nonnegativeAttemptCount(processingAttempts),
      match_attempt: 0,
      next_attempt_at: capturedAt,
      manual_requeue_count: 0,
    },
  };
}

export type LegacyReceiptCompatibilityInput = {
  source_system?: unknown;
  observation_channel?: unknown;
  captured_at?: unknown;
  route_event_class?: unknown;
  authentication_method?: unknown;
  evidence_version?: unknown;
  payload_kind?: unknown;
  headers?: unknown;
  payload?: unknown;
  payload_sha256?: unknown;
  processing?: unknown;
  event_type?: unknown;
  received_at?: unknown;
  createdAt?: unknown;
  processing_status?: unknown;
  processing_attempts?: unknown;
};

export type LegacyReceiptV2Fields = {
  source_system: "granot";
  observation_channel: "granot_webhook";
  captured_at: Date;
  route_event_class: GranotRouteEventClass;
  evidence_version: 2;
  authentication_method: "legacy_unknown";
  payload_kind: "object" | "array" | "null" | "primitive";
  headers: unknown;
  payload: unknown;
  payload_sha256: string;
  processing: ReceiptProcessingDefaults;
};

export type LegacyReceiptCompatibilityFill =
  | {
      ok: true;
      already_current: true;
      set_fields: Partial<LegacyReceiptV2Fields>;
      removed_key_counts: RemovedCredentialKeyCounts;
    }
  | {
      ok: true;
      already_current: false;
      fields: LegacyReceiptV2Fields;
      set_fields: Partial<LegacyReceiptV2Fields>;
      removed_key_counts: RemovedCredentialKeyCounts;
    }
  | {
      ok: false;
      reason:
        | "refused_legacy_processing_status"
        | "missing_capture_time"
        | "missing_route_event_class"
        | "missing_payload";
      processing_status: string;
      removed_key_counts: RemovedCredentialKeyCounts;
    };

export function hasRequiredReceiptV2Fields(
  input: LegacyReceiptCompatibilityInput,
): boolean {
  const processing = asRecord(input.processing);
  return (
    input.source_system === "granot" &&
    typeof input.observation_channel === "string" &&
    coerceDate(input.captured_at) !== undefined &&
    input.evidence_version === 2 &&
    typeof input.authentication_method === "string" &&
    typeof input.payload_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(input.payload_sha256) &&
    processing !== undefined &&
    typeof processing.state === "string" &&
    typeof processing.technical_attempts === "number" &&
    typeof processing.match_attempt === "number" &&
    typeof processing.manual_requeue_count === "number" &&
    coerceDate(processing.next_attempt_at) !== undefined
  );
}

export function fillLegacyWebhookReceiptV2Fields(
  input: LegacyReceiptCompatibilityInput,
): LegacyReceiptCompatibilityFill {
  const headerRedaction = redactCredentialKeys(input.headers ?? {});
  const processing_status =
    typeof input.processing_status === "string"
      ? input.processing_status
      : "unknown";
  if (input.payload === undefined && !hasRequiredReceiptV2Fields(input)) {
    return {
      ok: false,
      reason: "missing_payload",
      processing_status,
      removed_key_counts: headerRedaction.removed_key_counts,
    };
  }
  const payloadEvidence = hashCredentialRedactedPayload(input.payload);
  const removed_key_counts = mergeRemovedCredentialKeyCounts(
    headerRedaction.removed_key_counts,
    payloadEvidence.removed_key_counts,
  );

  if (hasRequiredReceiptV2Fields(input)) {
    return {
      ok: true,
      already_current: true,
      set_fields: {},
      removed_key_counts,
    };
  }

  const captured_at = resolveCapturedAt(input);
  if (!captured_at) {
    return {
      ok: false,
      reason: "missing_capture_time",
      processing_status,
      removed_key_counts,
    };
  }

  const translation = translateLegacyProcessingState(
    input.processing_status,
    input.processing_attempts,
    captured_at,
  );
  if (!translation.ok) {
    return {
      ok: false,
      reason: translation.reason,
      processing_status: translation.processing_status,
      removed_key_counts,
    };
  }

  const route_event_class = isGranotRouteEventClass(input.route_event_class)
    ? input.route_event_class
    : isGranotRouteEventClass(input.event_type)
      ? input.event_type
      : undefined;
  if (!route_event_class) {
    return {
      ok: false,
      reason: "missing_route_event_class",
      processing_status,
      removed_key_counts,
    };
  }

  const fields: LegacyReceiptV2Fields = {
    source_system: "granot",
    observation_channel: "granot_webhook",
    captured_at,
    route_event_class,
    evidence_version: 2,
    authentication_method: "legacy_unknown",
    payload_kind:
      input.payload_kind === "object" ||
      input.payload_kind === "array" ||
      input.payload_kind === "null" ||
      input.payload_kind === "primitive"
        ? input.payload_kind
        : classifyPayloadKind(payloadEvidence.redacted_payload),
    headers: headerRedaction.value,
    payload: payloadEvidence.redacted_payload,
    payload_sha256: payloadEvidence.payload_sha256,
    processing: translation.processing,
  };

  return {
    ok: true,
    already_current: false,
    fields,
    set_fields: absentLegacyV2Fields(input, fields),
    removed_key_counts,
  };
}

function absentLegacyV2Fields(
  input: LegacyReceiptCompatibilityInput,
  fields: LegacyReceiptV2Fields,
): Partial<LegacyReceiptV2Fields> {
  const set_fields: Partial<LegacyReceiptV2Fields> = {};
  if (input.source_system == null) set_fields.source_system = fields.source_system;
  if (input.observation_channel == null) {
    set_fields.observation_channel = fields.observation_channel;
  }
  if (coerceDate(input.captured_at) === undefined) {
    set_fields.captured_at = fields.captured_at;
  }
  if (!isGranotRouteEventClass(input.route_event_class)) {
    set_fields.route_event_class = fields.route_event_class;
  }
  if (input.evidence_version == null) set_fields.evidence_version = fields.evidence_version;
  if (input.authentication_method == null) {
    set_fields.authentication_method = fields.authentication_method;
  }
  if (input.payload_kind == null) set_fields.payload_kind = fields.payload_kind;
  if (input.payload_sha256 == null) {
    set_fields.headers = fields.headers;
    set_fields.payload = fields.payload;
    set_fields.payload_sha256 = fields.payload_sha256;
  }
  if (input.processing == null) set_fields.processing = fields.processing;
  return set_fields;
}

function nonnegativeAttemptCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function coerceDate(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date;
    }
  }
  return undefined;
}

function resolveCapturedAt(input: LegacyReceiptCompatibilityInput): Date | undefined {
  return (
    coerceDate(input.captured_at) ??
    coerceDate(input.received_at) ??
    coerceDate(input.createdAt)
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
