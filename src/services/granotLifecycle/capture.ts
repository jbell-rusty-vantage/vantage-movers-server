import type { IncomingHttpHeaders } from "node:http";
import { connectMongo } from "../../db";
import {
  getGranotObservationReceiptModel,
  type GranotObservationReceiptDocument,
} from "../../models/GranotObservationReceipt";
import type { GranotWebhookAuthenticationMethod } from "../../middleware/requireGranotWebhookSecret";
import type { DurableActor } from "../durableWork/types";
import {
  CaptureUnavailableError,
  OperationIdempotencyConflictError,
} from "./errors";
import type {
  ChannelOperationKind,
  GranotRouteEventClass,
  ObservationChannel,
} from "./types";
import {
  classifyPayloadKind,
  hashCredentialRedactedPayload,
} from "./receiptEvidence";
import { incrementGranotLifecycleReceiptsTotal } from "./metrics";

export const GRANOT_WEBHOOK_STORED_HEADER_ALLOWLIST = [
  "content-type",
  "content-length",
  "user-agent",
  "x-request-id",
  "x-vercel-id",
] as const;

export const GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH = 1024;

export type CaptureGranotLifecycleWebhookInput = {
  route_event_class: GranotRouteEventClass;
  captured_at: Date;
  headers: IncomingHttpHeaders;
  payload: unknown;
  authentication_method: GranotWebhookAuthenticationMethod;
};

export type CaptureGranotLifecycleWebhookResult = {
  receipt_id: string;
};

export type GranotWebhookReceiptInsert = {
  source_system: "granot";
  observation_channel: "granot_webhook";
  captured_at: Date;
  route_event_class: GranotRouteEventClass;
  authentication_method: GranotWebhookAuthenticationMethod;
  evidence_version: 2;
  payload_kind: "object" | "array" | "null" | "primitive";
  headers: Record<string, string | string[]>;
  payload: unknown;
  payload_sha256: string;
  processing: {
    state: "pending";
    technical_attempts: 0;
    match_attempt: 0;
    next_attempt_at: Date;
    manual_requeue_count: 0;
  };
  provider: "granot";
  event_type: GranotRouteEventClass;
  received_at: Date;
  schema_version: 1;
  processing_status: "received";
  processing_attempts: 0;
};

export type PersistGranotWebhookReceipt = (
  document: GranotWebhookReceiptInsert,
) => Promise<CaptureGranotLifecycleWebhookResult>;

export function allowlistGranotWebhookHeaders(
  headers: IncomingHttpHeaders | Record<string, unknown>,
): Record<string, string | string[]> {
  const allowlisted = new Set<string>(GRANOT_WEBHOOK_STORED_HEADER_ALLOWLIST);
  const stored: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (!allowlisted.has(normalizedKey)) {
      continue;
    }
    const storedValue = storeHeaderValue(value);
    if (storedValue !== undefined) {
      stored[normalizedKey] = storedValue;
    }
  }
  return stored;
}

export function buildGranotWebhookReceiptInsert(
  input: CaptureGranotLifecycleWebhookInput,
): GranotWebhookReceiptInsert {
  if (
    input.authentication_method !== "body_secret" &&
    input.authentication_method !== "header_secret"
  ) {
    throw new Error(
      "Granot webhook capture requires a proven authentication method",
    );
  }

  const headers = allowlistGranotWebhookHeaders(input.headers);
  const evidence = hashCredentialRedactedPayload(input.payload);
  return {
    source_system: "granot",
    observation_channel: "granot_webhook",
    captured_at: input.captured_at,
    route_event_class: input.route_event_class,
    authentication_method: input.authentication_method,
    evidence_version: 2,
    payload_kind: classifyPayloadKind(evidence.redacted_payload),
    headers,
    payload: evidence.redacted_payload,
    payload_sha256: evidence.payload_sha256,
    processing: {
      state: "pending",
      technical_attempts: 0,
      match_attempt: 0,
      next_attempt_at: input.captured_at,
      manual_requeue_count: 0,
    },
    provider: "granot",
    event_type: input.route_event_class,
    received_at: input.captured_at,
    schema_version: 1,
    processing_status: "received",
    processing_attempts: 0,
  };
}

export async function captureGranotLifecycleWebhookReceipt(
  input: CaptureGranotLifecycleWebhookInput,
  persist: PersistGranotWebhookReceipt = persistGranotWebhookReceipt,
): Promise<CaptureGranotLifecycleWebhookResult> {
  const document = buildGranotWebhookReceiptInsert(input);
  const result = await persist(document);
  incrementGranotLifecycleReceiptsTotal({
    channel: "granot_webhook",
    event_class: input.route_event_class,
  });
  return { receipt_id: result.receipt_id };
}

async function persistGranotWebhookReceipt(
  document: GranotWebhookReceiptInsert,
): Promise<CaptureGranotLifecycleWebhookResult> {
  await connectMongo();
  const receipt = await getGranotObservationReceiptModel().create(document);
  return { receipt_id: receipt._id.toString() };
}

export type ChannelObservationChannel = Exclude<
  ObservationChannel,
  "granot_webhook"
>;

export type ChannelAuthenticationMethod =
  | "extension_session"
  | "automation_owner_approval";

export type CaptureChannelOperationInput = {
  observation_channel: ChannelObservationChannel;
  authentication_method: ChannelAuthenticationMethod;
  channel_operation_kind: ChannelOperationKind;
  channel_operation_id: string;
  captured_at: Date;
  headers: IncomingHttpHeaders | Record<string, unknown>;
  payload: unknown;
  initiator: DurableActor;
  request_id?: string;
  payload_schema_hint?: string;
};

export type CaptureChannelOperationResult = {
  status: "inserted" | "replayed";
  receipt_id: string;
  payload_sha256: string;
};

export type GranotChannelReceiptInsert = {
  source_system: "granot";
  observation_channel: ChannelObservationChannel;
  captured_at: Date;
  channel_operation_kind: ChannelOperationKind;
  channel_operation_id: string;
  authentication_method: ChannelAuthenticationMethod;
  evidence_version: 2;
  payload_kind: "object" | "array" | "null" | "primitive";
  payload_schema_hint?: string;
  headers: Record<string, string | string[]>;
  payload: unknown;
  payload_sha256: string;
  initiator: DurableActor;
  processing: {
    state: "pending";
    technical_attempts: 0;
    match_attempt: 0;
    next_attempt_at: Date;
    manual_requeue_count: 0;
  };
  provider: "granot";
  schema_version: 1;
  processing_status: "received";
  processing_attempts: 0;
};

export type PersistGranotChannelReceipt = (
  document: GranotChannelReceiptInsert,
) => Promise<{ receipt_id: string }>;

export type LoadChannelReceiptByOperation = (input: {
  observation_channel: ChannelObservationChannel;
  channel_operation_id: string;
}) => Promise<Pick<
  GranotObservationReceiptDocument,
  "_id" | "payload_sha256" | "channel_operation_kind"
> | null>;

export function buildGranotChannelReceiptInsert(
  input: CaptureChannelOperationInput,
): GranotChannelReceiptInsert {
  if (input.observation_channel === ("granot_webhook" as string)) {
    throw new Error("Channel capture must not accept webhook deliveries");
  }
  if (
    input.authentication_method !== "extension_session" &&
    input.authentication_method !== "automation_owner_approval"
  ) {
    throw new Error("Channel capture requires a proven channel authentication method");
  }
  if (
    input.observation_channel === "browser_extension" &&
    input.authentication_method !== "extension_session"
  ) {
    throw new Error("browser_extension capture requires extension_session authentication");
  }
  if (input.initiator.origin !== "browser_extension" && input.observation_channel === "browser_extension") {
    throw new Error("browser_extension capture requires a browser_extension initiator");
  }
  if (
    input.observation_channel === "granot_http_automation" &&
    input.authentication_method !== "automation_owner_approval"
  ) {
    throw new Error("granot_http_automation capture requires automation_owner_approval");
  }
  if (
    input.observation_channel === "granot_http_automation" &&
    input.initiator.origin !== "vantage_admin"
  ) {
    throw new Error("granot_http_automation capture requires a vantage_admin initiator");
  }

  const headers = allowlistGranotWebhookHeaders(input.headers);
  const evidence = hashCredentialRedactedPayload(input.payload);
  return {
    source_system: "granot",
    observation_channel: input.observation_channel,
    captured_at: input.captured_at,
    channel_operation_kind: input.channel_operation_kind,
    channel_operation_id: input.channel_operation_id,
    authentication_method: input.authentication_method,
    evidence_version: 2,
    payload_kind: classifyPayloadKind(evidence.redacted_payload),
    payload_schema_hint: input.payload_schema_hint,
    headers,
    payload: evidence.redacted_payload,
    payload_sha256: evidence.payload_sha256,
    initiator: input.initiator,
    processing: {
      state: "pending",
      technical_attempts: 0,
      match_attempt: 0,
      next_attempt_at: input.captured_at,
      manual_requeue_count: 0,
    },
    provider: "granot",
    schema_version: 1,
    processing_status: "received",
    processing_attempts: 0,
  };
}

export async function captureChannelOperationReceipt(
  input: CaptureChannelOperationInput,
  persist: PersistGranotChannelReceipt = persistGranotChannelReceipt,
  loadExisting: LoadChannelReceiptByOperation = loadChannelReceiptByOperation,
): Promise<CaptureChannelOperationResult> {
  const document = buildGranotChannelReceiptInsert(input);
  try {
    const result = await persist(document);
    incrementGranotLifecycleReceiptsTotal({
      channel: input.observation_channel,
      event_class: input.channel_operation_kind,
    });
    return {
      status: "inserted",
      receipt_id: result.receipt_id,
      payload_sha256: document.payload_sha256,
    };
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw new CaptureUnavailableError(input.request_id);
    }
    const existing = await loadExisting({
      observation_channel: input.observation_channel,
      channel_operation_id: input.channel_operation_id,
    });
    if (!existing) {
      throw new CaptureUnavailableError(input.request_id);
    }
    if (
      existing.payload_sha256 !== document.payload_sha256 ||
      existing.channel_operation_kind !== document.channel_operation_kind
    ) {
      throw new OperationIdempotencyConflictError(input.request_id);
    }
    return {
      status: "replayed",
      receipt_id: existing._id.toString(),
      payload_sha256: existing.payload_sha256,
    };
  }
}

async function persistGranotChannelReceipt(
  document: GranotChannelReceiptInsert,
): Promise<{ receipt_id: string }> {
  await connectMongo();
  const receipt = await getGranotObservationReceiptModel().create(document);
  return { receipt_id: receipt._id.toString() };
}

async function loadChannelReceiptByOperation(input: {
  observation_channel: ChannelObservationChannel;
  channel_operation_id: string;
}): Promise<Pick<
  GranotObservationReceiptDocument,
  "_id" | "payload_sha256" | "channel_operation_kind"
> | null> {
  await connectMongo();
  return getGranotObservationReceiptModel()
    .findOne({
      observation_channel: input.observation_channel,
      channel_operation_id: input.channel_operation_id,
    })
    .select({ _id: 1, payload_sha256: 1, channel_operation_kind: 1 })
    .lean();
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: number }).code === 11000,
  );
}

function storeHeaderValue(value: unknown): string | string[] | undefined {
  if (typeof value === "string") {
    return value.slice(0, GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH);
  }
  if (Array.isArray(value)) {
    const stored = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.slice(0, GRANOT_WEBHOOK_STORED_HEADER_MAX_LENGTH));
    return stored.length > 0 ? stored : undefined;
  }
  return undefined;
}
