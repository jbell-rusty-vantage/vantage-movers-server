import mongoose from "mongoose";
import { getGranotBookingReconciliationCaseModel } from "../../models/GranotBookingReconciliationCase";
import { getGranotObservationModel } from "../../models/GranotObservation";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { recordOperationalEvent } from "../observability";
import { isSupportedGranotBookingAction } from "./normalization";
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

export type LiveWebhookIntakeLink = {
  case_id: string;
  kind: "booking";
  state: "open" | "resolved";
  matched_via: "evidence_observation_id";
};

export type LiveWebhookReceipt = {
  receipt_id: string;
  captured_at: string;
  route_event_class: LiveWebhookEventClass;
  observation_channel: "granot_webhook";
  processing_state: ReceiptWorkState | string;
  observation_id?: string | null;
  intake_link?: LiveWebhookIntakeLink | null;
  lead: LiveWebhookLead;
  granot_statement: unknown;
};

export type LiveReceiptObservationRow = {
  _id: string;
  receipt_id: string;
  route_event_class?: string;
  payload_event_type_raw?: string | null;
};

export type LiveReceiptBookingCaseRow = {
  _id: string;
  state: "open" | "resolved";
  evidence: Array<{ observation_id: string }>;
};

export type LiveReceiptIntakeLinkStores = {
  findObservationsByReceiptIds: (receiptIds: string[]) => Promise<LiveReceiptObservationRow[]>;
  findBookingCasesByObservationIds: (
    observationIds: string[],
  ) => Promise<LiveReceiptBookingCaseRow[]>;
  recordAmbiguousIntakeLink?: (input: {
    receipt_id: string;
    observation_id: string;
    case_ids: string[];
  }) => Promise<void>;
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

export function projectLiveWebhookReceipt(
  row: ReceiptRow,
  intake?: {
    observation_id?: string | null;
    intake_link?: LiveWebhookIntakeLink | null;
  },
): LiveWebhookReceipt | null {
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
    observation_id: intake?.observation_id ?? null,
    intake_link: intake?.intake_link ?? null,
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

function asIdString(value: unknown): string | null {
  if (value instanceof mongoose.Types.ObjectId) {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function eventTypeQualifiesForIntakeLink(eventType: string | null | undefined): boolean {
  if (!eventType || eventType.trim().length === 0) {
    return false;
  }
  return isSupportedGranotBookingAction(eventType);
}

async function recordAmbiguousIntakeLinkDefault(input: {
  receipt_id: string;
  observation_id: string;
  case_ids: string[];
}): Promise<void> {
  await recordOperationalEvent({
    level: "error",
    eventKey: "granot_lifecycle.live_receipt.ambiguous_intake_link",
    category: "admin",
    workflow: "granot_lifecycle",
    summary: "Multiple booking cases share one Observation; Live Events intake link omitted.",
    details: {
      observation_id: input.observation_id,
      case_count: input.case_ids.length,
    },
    entity: { type: "granot_observation", id: input.observation_id },
    piiPolicy: "none",
    reportable: true,
    ownerVisible: false,
  });
}

async function defaultFindObservationsByReceiptIds(
  receiptIds: string[],
): Promise<LiveReceiptObservationRow[]> {
  const ids = receiptIds.map(asObjectId).filter((id): id is mongoose.Types.ObjectId => id !== null);
  if (ids.length === 0) {
    return [];
  }
  const rows = await getGranotObservationModel()
    .find({ receipt_id: { $in: ids } })
    .select({
      _id: 1,
      receipt_id: 1,
      route_event_class: 1,
      payload_event_type_raw: 1,
    })
    .lean()
    .exec();
  return rows.flatMap((row) => {
    const id = asIdString(row._id);
    const receiptId = asIdString(row.receipt_id);
    if (!id || !receiptId) {
      return [];
    }
    return [
      {
        _id: id,
        receipt_id: receiptId,
        route_event_class: row.route_event_class,
        payload_event_type_raw: row.payload_event_type_raw ?? null,
      },
    ];
  });
}

async function defaultFindBookingCasesByObservationIds(
  observationIds: string[],
): Promise<LiveReceiptBookingCaseRow[]> {
  const ids = observationIds
    .map(asObjectId)
    .filter((id): id is mongoose.Types.ObjectId => id !== null);
  if (ids.length === 0) {
    return [];
  }
  const rows = await getGranotBookingReconciliationCaseModel()
    .find({ "evidence.observation_id": { $in: ids } })
    .select({ _id: 1, state: 1, "evidence.observation_id": 1 })
    .lean()
    .exec();
  return rows.flatMap((row) => {
    const id = asIdString(row._id);
    if (!id || (row.state !== "open" && row.state !== "resolved")) {
      return [];
    }
    return [
      {
        _id: id,
        state: row.state,
        evidence: (row.evidence ?? []).flatMap((item) => {
          const observationId = asIdString(item.observation_id);
          return observationId ? [{ observation_id: observationId }] : [];
        }),
      },
    ];
  });
}

function defaultIntakeLinkStores(): LiveReceiptIntakeLinkStores {
  return {
    findObservationsByReceiptIds: defaultFindObservationsByReceiptIds,
    findBookingCasesByObservationIds: defaultFindBookingCasesByObservationIds,
    recordAmbiguousIntakeLink: recordAmbiguousIntakeLinkDefault,
  };
}

function casesForObservation(
  cases: LiveReceiptBookingCaseRow[],
  observationId: string,
): LiveReceiptBookingCaseRow[] {
  return cases.filter((row) =>
    row.evidence.some((evidence) => evidence.observation_id === observationId),
  );
}

async function resolveIntakeForReceipt(input: {
  receipt: Pick<LiveWebhookReceipt, "receipt_id" | "route_event_class" | "lead">;
  observation: LiveReceiptObservationRow | undefined;
  cases: LiveReceiptBookingCaseRow[];
  stores: LiveReceiptIntakeLinkStores;
}): Promise<{
  observation_id: string | null;
  intake_link: LiveWebhookIntakeLink | null;
}> {
  if (!input.observation) {
    return { observation_id: null, intake_link: null };
  }
  const observation_id = input.observation._id;
  const matches = casesForObservation(input.cases, observation_id);
  if (matches.length > 1) {
    await (input.stores.recordAmbiguousIntakeLink ?? recordAmbiguousIntakeLinkDefault)({
      receipt_id: input.receipt.receipt_id,
      observation_id,
      case_ids: matches.map((row) => row._id),
    });
    return { observation_id, intake_link: null };
  }
  const bookingCase = matches[0];
  if (!bookingCase) {
    return { observation_id, intake_link: null };
  }
  const routeClass = isLiveWebhookEventClass(input.observation.route_event_class)
    ? input.observation.route_event_class
    : input.receipt.route_event_class;
  if (routeClass !== "booking_status_changed") {
    return { observation_id, intake_link: null };
  }
  const eventType =
    input.observation.payload_event_type_raw ?? input.receipt.lead.event_type ?? null;
  if (!eventTypeQualifiesForIntakeLink(eventType)) {
    return { observation_id, intake_link: null };
  }
  return {
    observation_id,
    intake_link: {
      case_id: bookingCase._id,
      kind: "booking",
      state: bookingCase.state,
      matched_via: "evidence_observation_id",
    },
  };
}

export async function enrichLiveWebhookReceipts(
  receipts: LiveWebhookReceipt[],
  stores: LiveReceiptIntakeLinkStores = defaultIntakeLinkStores(),
): Promise<LiveWebhookReceipt[]> {
  if (receipts.length === 0) {
    return receipts;
  }
  const observations = await stores.findObservationsByReceiptIds(
    receipts.map((receipt) => receipt.receipt_id),
  );
  const observationsByReceiptId = new Map(
    observations.map((row) => [row.receipt_id, row] as const),
  );
  const observationIds = [...new Set(observations.map((row) => row._id))];
  const cases =
    observationIds.length > 0
      ? await stores.findBookingCasesByObservationIds(observationIds)
      : [];
  const enriched: LiveWebhookReceipt[] = [];
  for (const receipt of receipts) {
    const intake = await resolveIntakeForReceipt({
      receipt,
      observation: observationsByReceiptId.get(receipt.receipt_id),
      cases,
      stores,
    });
    enriched.push({
      ...receipt,
      observation_id: intake.observation_id,
      intake_link: intake.intake_link,
    });
  }
  return enriched;
}

export async function resolveLiveReceiptIntakeLink(
  input: { receipt_id: string },
  stores: LiveReceiptIntakeLinkStores = defaultIntakeLinkStores(),
): Promise<{
  observation_id: string | null;
  intake_link: LiveWebhookIntakeLink | null;
}> {
  const [resolved] = await enrichLiveWebhookReceipts(
    [
      {
        receipt_id: input.receipt_id,
        captured_at: "1970-01-01T00:00:00.000Z",
        route_event_class: "booking_status_changed",
        observation_channel: "granot_webhook",
        processing_state: "completed",
        lead: {
          display_name: null,
          first_name: null,
          last_name: null,
          email: null,
          phone: null,
          job_no: null,
          event_type: null,
          priority: null,
          origin: null,
          destination: null,
          move_date: null,
        },
        granot_statement: {},
      },
    ],
    stores,
  );
  return {
    observation_id: resolved?.observation_id ?? null,
    intake_link: resolved?.intake_link ?? null,
  };
}

async function projectAndEnrich(
  rows: ReceiptRow[],
  stores?: LiveReceiptIntakeLinkStores,
): Promise<LiveWebhookReceipt[]> {
  return enrichLiveWebhookReceipts(projectRows(rows), stores);
}

export async function listLiveWebhookReceiptSnapshot(
  now = new Date(),
  stores?: LiveReceiptIntakeLinkStores,
): Promise<LiveWebhookReceipt[]> {
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
  return projectAndEnrich(rows as ReceiptRow[], stores);
}

export async function listLiveWebhookReceiptsUpdated(
  now = new Date(),
  stores?: LiveReceiptIntakeLinkStores,
): Promise<LiveWebhookReceipt[]> {
  return listLiveWebhookReceiptSnapshot(now, stores);
}

export async function listLiveWebhookReceiptsAfter(
  cursor: LiveReceiptCursor,
  stores?: LiveReceiptIntakeLinkStores,
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
  return projectAndEnrich(rows as ReceiptRow[], stores);
}

export function cursorFromReceipt(receipt: LiveWebhookReceipt): LiveReceiptCursor {
  return { captured_at: receipt.captured_at, receipt_id: receipt.receipt_id };
}
