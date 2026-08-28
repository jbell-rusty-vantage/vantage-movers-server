import mongoose from "mongoose";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { redactCredentialKeys } from "./receiptEvidence";
import type { GranotRouteEventClass, ObservationChannel, ReceiptWorkState } from "./types";

export const LIVE_WEBHOOK_EVENT_CLASSES = [
  "lead_created",
  "priority_updated",
  "booking_status_changed",
] as const;

export type LiveWebhookEventClass = (typeof LIVE_WEBHOOK_EVENT_CLASSES)[number];

export type LiveWebhookLead = {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  job_no: string | null;
  event_type: string | null;
  priority: string | null;
  origin: string | null;
  destination: string | null;
  move_date: string | null;
};

export type LiveWebhookReceipt = {
  receipt_id: string;
  captured_at: string;
  route_event_class: LiveWebhookEventClass;
  observation_channel: "granot_webhook";
  processing_state: ReceiptWorkState | string;
  lead: LiveWebhookLead;
  granot_statement: unknown;
};

export type LiveReceiptCursor = {
  captured_at: string;
  receipt_id: string;
};

export const LIVE_RECEIPT_SNAPSHOT_WINDOW_MS = 30 * 60 * 1000;
export const LIVE_RECEIPT_SNAPSHOT_LIMIT = 40;
export const LIVE_RECEIPT_POLL_LIMIT = 25;

const LIVE_CHANNEL: ObservationChannel = "granot_webhook";

type ReceiptRow = {
  _id: mongoose.Types.ObjectId;
  observation_channel?: string;
  captured_at?: Date;
  route_event_class?: string;
  payload?: unknown;
  processing?: { state?: string };
};

function scalar(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function place(city: unknown, state: unknown): string | null {
  const parts = [scalar(city), scalar(state)].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function isLiveWebhookEventClass(value: unknown): value is LiveWebhookEventClass {
  return (
    value === "lead_created" ||
    value === "priority_updated" ||
    value === "booking_status_changed"
  );
}

export function extractLiveWebhookLead(payload: unknown): LiveWebhookLead {
  const body =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const first_name = scalar(body.first_name);
  const last_name = scalar(body.last_name);
  const composed = [first_name, last_name].filter((part): part is string => part !== null).join(" ");
  return {
    display_name: scalar(body.customer_name) ?? (composed.length > 0 ? composed : null),
    first_name,
    last_name,
    email: scalar(body.email),
    phone: scalar(body.phone) ?? scalar(body.phone_number),
    job_no: scalar(body.job_no),
    event_type: scalar(body.event_type),
    priority: scalar(body.priority) ?? scalar(body.new_priority) ?? scalar(body.priority_id),
    origin: place(body.from_city, body.from_state),
    destination: place(body.to_city, body.to_state),
    move_date: scalar(body.move_date),
  };
}

export function projectLiveWebhookReceipt(row: ReceiptRow): LiveWebhookReceipt | null {
  if (row.observation_channel !== LIVE_CHANNEL) {
    return null;
  }
  if (!isLiveWebhookEventClass(row.route_event_class)) {
    return null;
  }
  if (!(row.captured_at instanceof Date) || Number.isNaN(row.captured_at.getTime())) {
    return null;
  }
  const granot_statement = redactCredentialKeys(row.payload).value;
  return {
    receipt_id: String(row._id),
    captured_at: row.captured_at.toISOString(),
    route_event_class: row.route_event_class,
    observation_channel: "granot_webhook",
    processing_state: row.processing?.state ?? "pending",
    lead: extractLiveWebhookLead(granot_statement),
    granot_statement,
  };
}

export function encodeLiveReceiptEventId(cursor: LiveReceiptCursor): string {
  return `${cursor.captured_at}:${cursor.receipt_id}`;
}

export function decodeLiveReceiptEventId(value: string | undefined | null): LiveReceiptCursor | null {
  if (!value) {
    return null;
  }
  const separator = value.lastIndexOf(":");
  if (separator <= 0) {
    return null;
  }
  const captured_at = value.slice(0, separator);
  const receipt_id = value.slice(separator + 1);
  if (!receipt_id || Number.isNaN(Date.parse(captured_at))) {
    return null;
  }
  return { captured_at, receipt_id };
}

function asObjectId(id: string): mongoose.Types.ObjectId | null {
  if (!/^[a-fA-F0-9]{24}$/.test(id)) {
    return null;
  }
  return new mongoose.Types.ObjectId(id);
}

function webhookFilter(): Record<string, unknown> {
  return {
    observation_channel: LIVE_CHANNEL,
    route_event_class: { $in: [...LIVE_WEBHOOK_EVENT_CLASSES] satisfies GranotRouteEventClass[] },
  };
}

function projectRows(rows: ReceiptRow[]): LiveWebhookReceipt[] {
  const projected: LiveWebhookReceipt[] = [];
  for (const row of rows) {
    const receipt = projectLiveWebhookReceipt(row);
    if (receipt) {
      projected.push(receipt);
    }
  }
  return projected;
}

export async function listLiveWebhookReceiptSnapshot(now = new Date()): Promise<LiveWebhookReceipt[]> {
  const rows = await getGranotObservationReceiptModel()
    .find({
      ...webhookFilter(),
      captured_at: { $gte: new Date(now.getTime() - LIVE_RECEIPT_SNAPSHOT_WINDOW_MS) },
    })
    .sort({ captured_at: -1, _id: -1 })
    .limit(LIVE_RECEIPT_SNAPSHOT_LIMIT)
    .select({
      observation_channel: 1,
      captured_at: 1,
      route_event_class: 1,
      payload: 1,
      "processing.state": 1,
    })
    .lean()
    .exec();
  return projectRows(rows as ReceiptRow[]);
}

export async function listLiveWebhookReceiptsAfter(
  cursor: LiveReceiptCursor,
): Promise<LiveWebhookReceipt[]> {
  const since = new Date(cursor.captured_at);
  if (Number.isNaN(since.getTime())) {
    return [];
  }
  const afterId = asObjectId(cursor.receipt_id);
  const rows = await getGranotObservationReceiptModel()
    .find({
      ...webhookFilter(),
      ...(afterId
        ? {
            $or: [
              { captured_at: { $gt: since } },
              { captured_at: since, _id: { $gt: afterId } },
            ],
          }
        : { captured_at: { $gt: since } }),
    })
    .sort({ captured_at: 1, _id: 1 })
    .limit(LIVE_RECEIPT_POLL_LIMIT)
    .select({
      observation_channel: 1,
      captured_at: 1,
      route_event_class: 1,
      payload: 1,
      "processing.state": 1,
    })
    .lean()
    .exec();
  return projectRows(rows as ReceiptRow[]);
}

export function cursorFromReceipt(receipt: LiveWebhookReceipt): LiveReceiptCursor {
  return { captured_at: receipt.captured_at, receipt_id: receipt.receipt_id };
}
