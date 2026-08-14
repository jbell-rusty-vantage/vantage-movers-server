import { Schema } from "mongoose";
import type {
  ChannelOperationKind,
  GranotRouteEventClass,
  ObservationChannel,
  ReceiptWorkState,
} from "../services/granotLifecycle/types";

export const RECEIPT_WORK_STATES = [
  "pending",
  "claimed",
  "retry_scheduled",
  "completed",
  "dead_letter",
] as const satisfies readonly ReceiptWorkState[];

export const AUTHENTICATION_METHODS = [
  "body_secret",
  "header_secret",
  "extension_session",
  "automation_owner_approval",
  "legacy_unknown",
] as const;

export const PAYLOAD_KINDS = ["object", "array", "null", "primitive"] as const;

export const OBSERVATION_CHANNELS = [
  "granot_webhook",
  "browser_extension",
  "granot_http_automation",
] as const satisfies readonly ObservationChannel[];

export const ROUTE_EVENT_CLASSES = [
  "lead_created",
  "priority_updated",
  "booking_status_changed",
] as const satisfies readonly GranotRouteEventClass[];

export const CHANNEL_OPERATION_KINDS = [
  "lead_snapshot_apply",
  "booking_action_apply",
] as const satisfies readonly ChannelOperationKind[];

const CONTROL_OR_BIDI = /[\p{Cc}\p{Cf}]/u;
const LOWERCASE_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const granotReceiptLastErrorSchema = new Schema(
  {
    code: { type: String, required: true, trim: true },
    message: { type: String, required: true, maxlength: 500 },
    failed_at: { type: Date, required: true },
  },
  { _id: false },
);

export const granotReceiptProcessingSchema = new Schema(
  {
    state: {
      type: String,
      required: true,
      enum: RECEIPT_WORK_STATES,
    },
    technical_attempts: { type: Number, required: true, min: 0 },
    match_attempt: { type: Number, required: true, min: 0 },
    next_attempt_at: { type: Date, required: true },
    lease_owner: { type: String, trim: true },
    leased_until: { type: Date },
    last_started_at: { type: Date },
    last_error: { type: granotReceiptLastErrorSchema },
    completed_at: { type: Date },
    latest_decision_id: { type: Schema.Types.ObjectId },
    manual_requeue_count: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

export function assertChannelOperationId(
  value: unknown,
  channel: ObservationChannel | undefined,
): asserts value is string {
  if (typeof value !== "string") {
    throw new Error("channel_operation_id must be a string when present");
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 300) {
    throw new Error("channel_operation_id must be 1-300 trimmed characters");
  }
  if (CONTROL_OR_BIDI.test(trimmed)) {
    throw new Error(
      "channel_operation_id must not contain control or bidirectional characters",
    );
  }
  if (channel === "browser_extension" && !LOWERCASE_UUID_V4.test(trimmed)) {
    throw new Error("browser_extension channel_operation_id must be a lowercase UUID v4");
  }
  if (channel === "granot_http_automation" && !isAutomationOperationId(trimmed)) {
    throw new Error(
      "granot_http_automation channel_operation_id must exactly equal ${run_id}:${action_id}",
    );
  }
}

export function isAutomationOperationId(value: string): boolean {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return false;
  }
  const runId = value.slice(0, separator);
  const actionId = value.slice(separator + 1);
  return (
    runId.length > 0 &&
    actionId.length > 0 &&
    !CONTROL_OR_BIDI.test(runId) &&
    !CONTROL_OR_BIDI.test(actionId)
  );
}

export function assertReceiptChannelShape(input: {
  observation_channel?: ObservationChannel;
  route_event_class?: unknown;
  channel_operation_kind?: ChannelOperationKind | unknown;
  channel_operation_id?: unknown;
}): void {
  const channel = input.observation_channel;
  if (channel === "granot_webhook") {
    if (input.route_event_class == null || input.route_event_class === "") {
      throw new Error("granot_webhook receipts require route_event_class");
    }
    if (input.channel_operation_kind != null) {
      throw new Error("granot_webhook receipts forbid channel_operation_kind");
    }
    return;
  }

  if (channel === "browser_extension" || channel === "granot_http_automation") {
    if (input.route_event_class != null && input.route_event_class !== "") {
      throw new Error(
        `${channel} receipts must not pretend to be webhook route deliveries`,
      );
    }
    if (input.channel_operation_kind == null || input.channel_operation_kind === "") {
      throw new Error(`${channel} receipts require channel_operation_kind`);
    }
    if (input.channel_operation_id == null || input.channel_operation_id === "") {
      throw new Error(`${channel} receipts require channel_operation_id`);
    }
  }
}
