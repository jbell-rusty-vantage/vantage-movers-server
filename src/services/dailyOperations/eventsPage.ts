import mongoose from "mongoose";
import {
  getDailyOperationsEventModel,
  type DailyOperationsCard,
  type DailyOperationsEventDocument,
  type DailyOperationsLinks,
} from "../../models/DailyOperationsEvent";
import { FLORIDA_TIME_ZONE } from "../../utils/easternTime";
import { easternDayKey } from "./dayDocument";
import {
  DAILY_OPERATIONS_LANES,
  type DailyOperationsKind,
  type DailyOperationsLane,
} from "./kinds";

export const DAILY_OPERATIONS_EVENTS_DEFAULT_LIMIT = 80;
export const DAILY_OPERATIONS_EVENTS_MAX_LIMIT = 200;
export const DAILY_OPERATIONS_EVENTS_ORDER = "newest_first" as const;

export type DailyOperationsEventCursor = {
  occurred_at: string;
  event_id: string;
};

export type DailyOperationsEventItem = {
  event_id: string;
  day: string;
  occurred_at: string;
  lane: DailyOperationsLane;
  kind: DailyOperationsKind;
  title: string;
  source_company: string | null;
  ingestion_origin: string | null;
  lead_kind: "form" | "call" | null;
  job_no: string | null;
  entity_type: string | null;
  entity_id: string | null;
  parent_receipt_id: string | null;
  links: DailyOperationsLinks;
  card: DailyOperationsCard;
  metric_touches: string[];
};

export type DailyOperationsEventsPage = {
  day: string;
  timezone: typeof FLORIDA_TIME_ZONE;
  order: typeof DAILY_OPERATIONS_EVENTS_ORDER;
  limit: number;
  items: DailyOperationsEventItem[];
  next_cursor: string | null;
};

export type ListDailyOperationsEventsQuery = {
  cursor?: string | null;
  lane?: string | null;
  limit?: number | null;
};

export type DailyOperationsEventRow = Pick<
  DailyOperationsEventDocument,
  | "day"
  | "occurred_at"
  | "lane"
  | "kind"
  | "title"
  | "source_company"
  | "ingestion_origin"
  | "lead_kind"
  | "job_no"
  | "entity_type"
  | "entity_id"
  | "parent_receipt_id"
  | "links"
  | "card"
  | "metric_touches"
> & { _id: { toString(): string } };

export type ListDailyOperationsEventsDeps = {
  now?: () => Date;
  listEvents?: (input: {
    day: string;
    lane?: DailyOperationsLane;
    cursor: DailyOperationsEventCursor | null;
    limit: number;
  }) => Promise<DailyOperationsEventRow[]>;
};

export function encodeDailyOperationsEventCursor(input: {
  occurred_at: Date | string;
  event_id: string;
}): string {
  const iso =
    input.occurred_at instanceof Date
      ? input.occurred_at.toISOString()
      : input.occurred_at;
  return `${iso}:${input.event_id}`;
}

/**
 * `{occurred_at_iso}:{event_id}` — ISO-8601 contains colons, so parse with
 * `lastIndexOf(":")`. Same idea as Live Events.
 */
export function decodeDailyOperationsEventCursor(
  value: string | undefined | null,
): DailyOperationsEventCursor | null {
  if (!value) return null;
  const separator = value.lastIndexOf(":");
  if (separator <= 0) return null;
  const occurred_at = value.slice(0, separator);
  const event_id = value.slice(separator + 1);
  if (!event_id || Number.isNaN(Date.parse(occurred_at))) {
    return null;
  }
  return { occurred_at, event_id };
}

export class DailyOperationsEventsQueryError extends Error {
  readonly statusCode = 400;
  readonly code = "INVALID_EVENTS_QUERY";
  constructor(message: string) {
    super(message);
  }
}

export async function listDailyOperationsEvents(
  query: ListDailyOperationsEventsQuery = {},
  deps: ListDailyOperationsEventsDeps = {},
): Promise<DailyOperationsEventsPage> {
  const now = deps.now?.() ?? new Date();
  const day = easternDayKey(now);
  const limit = normalizeLimit(query.limit);
  const lane = normalizeLane(query.lane);
  const cursor = normalizeCursor(query.cursor);
  const listEvents = deps.listEvents ?? defaultListEvents;
  const rows = await listEvents({
    day,
    lane,
    cursor,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    day,
    timezone: FLORIDA_TIME_ZONE,
    order: DAILY_OPERATIONS_EVENTS_ORDER,
    limit,
    items: page.map(projectEventItem),
    next_cursor:
      hasMore && last
        ? encodeDailyOperationsEventCursor({
            occurred_at: last.occurred_at,
            event_id: last._id.toString(),
          })
        : null,
  };
}

function normalizeLimit(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return DAILY_OPERATIONS_EVENTS_DEFAULT_LIMIT;
  }
  const parsed = Math.trunc(Number(value));
  if (parsed < 1 || parsed > DAILY_OPERATIONS_EVENTS_MAX_LIMIT) {
    throw new DailyOperationsEventsQueryError(
      `limit must be between 1 and ${DAILY_OPERATIONS_EVENTS_MAX_LIMIT}`,
    );
  }
  return parsed;
}

function normalizeLane(
  value: string | null | undefined,
): DailyOperationsLane | undefined {
  if (value == null || value === "" || value === "all") return undefined;
  if ((DAILY_OPERATIONS_LANES as readonly string[]).includes(value)) {
    return value as DailyOperationsLane;
  }
  throw new DailyOperationsEventsQueryError(`Unknown lane: ${value}`);
}

function normalizeCursor(
  value: string | null | undefined,
): DailyOperationsEventCursor | null {
  if (value == null || value === "") return null;
  const decoded = decodeDailyOperationsEventCursor(value);
  if (!decoded) {
    throw new DailyOperationsEventsQueryError("Invalid cursor");
  }
  return decoded;
}

function projectEventItem(row: DailyOperationsEventRow): DailyOperationsEventItem {
  const occurredAt =
    row.occurred_at instanceof Date
      ? row.occurred_at.toISOString()
      : new Date(row.occurred_at).toISOString();
  return {
    event_id: row._id.toString(),
    day: row.day,
    occurred_at: occurredAt,
    lane: row.lane,
    kind: row.kind,
    title: row.title,
    source_company: row.source_company ?? null,
    ingestion_origin: row.ingestion_origin ?? null,
    lead_kind: row.lead_kind ?? null,
    job_no: row.job_no ?? null,
    entity_type: row.entity_type ?? null,
    entity_id: row.entity_id ?? null,
    parent_receipt_id: row.parent_receipt_id ?? null,
    links: row.links ?? {},
    card: row.card ?? {},
    metric_touches: row.metric_touches ?? [],
  };
}

async function defaultListEvents(input: {
  day: string;
  lane?: DailyOperationsLane;
  cursor: DailyOperationsEventCursor | null;
  limit: number;
}): Promise<DailyOperationsEventRow[]> {
  const filter: Record<string, unknown> = { day: input.day };
  if (input.lane) filter.lane = input.lane;
  if (input.cursor) {
    const occurredAt = new Date(input.cursor.occurred_at);
    const objectId = mongoose.Types.ObjectId.isValid(input.cursor.event_id)
      ? new mongoose.Types.ObjectId(input.cursor.event_id)
      : null;
    filter.$or = objectId
      ? [
          { occurred_at: { $lt: occurredAt } },
          { occurred_at: occurredAt, _id: { $lt: objectId } },
        ]
      : [{ occurred_at: { $lt: occurredAt } }];
  }
  return getDailyOperationsEventModel()
    .find(filter)
    .sort({ occurred_at: -1, _id: -1 })
    .limit(input.limit)
    .lean()
    .exec();
}
