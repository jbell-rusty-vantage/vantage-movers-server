import mongoose from "mongoose";
import {
  getDailyOperationsRedis,
  getDailyOperationsStreamKey,
} from "../../config/domain/dailyOperations";
import { isTestMode, isVantageTestRunner } from "../../config/domain/runtime";
import { getDailyOperationsEventModel } from "../../models/DailyOperationsEvent";
import { easternDayKey, easternInstantBounds } from "./dayDocument";
import {
  decodeDailyOperationsEventCursor,
  encodeDailyOperationsEventCursor,
  projectDailyOperationsEventItem,
  type DailyOperationsEventCursor,
  type DailyOperationsEventItem,
  type DailyOperationsEventRow,
} from "./eventsPage";
import { type DailyOperationsSnapshot } from "./snapshot";

export const LIVE_DAILY_OPERATIONS_POLL_MS = 1_000;
export const LIVE_DAILY_OPERATIONS_HEARTBEAT_MS = 15_000;
export const LIVE_DAILY_OPERATIONS_MAX_MS = 240_000;
export const LIVE_DAILY_OPERATIONS_XREAD_COUNT = 25;

export type DailyOperationsLiveWriter = {
  write(chunk: string): void;
};

export type DailyOperationsRedisWake = {
  redis_stream_id: string;
  event_id: string;
};

export type DailyOperationsLiveRedisReader = {
  xread(input: {
    key: string;
    lastId: string;
    count: number;
  }): Promise<DailyOperationsRedisWake[]>;
};

export type DailyOperationsLiveEventRow = DailyOperationsEventRow & {
  redis_stream_id?: string | null;
};

export type DailyOperationsLiveSseDeps = {
  getSnapshot: () => Promise<DailyOperationsSnapshot>;
  findEventById: (eventId: string) => Promise<DailyOperationsLiveEventRow | null>;
  listAfter: (
    cursor: DailyOperationsEventCursor,
    day: string,
  ) => Promise<DailyOperationsLiveEventRow[]>;
  listNewest?: (day: string) => Promise<DailyOperationsLiveEventRow | null>;
  getRedis?: () => DailyOperationsLiveRedisReader | null;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  pollMs?: number;
  heartbeatMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
};

export function formatDailyOperationsSse(
  event: string,
  data: unknown,
  id?: string,
): string {
  const lines = [
    id ? `id: ${id}` : null,
    `event: ${event}`,
    `data: ${JSON.stringify(data)}`,
    "",
    "",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

/**
 * Upstash REST `XREAD` returns `[ [key, [ [id, fields], ... ] ], ... ]`.
 * `fields` may be a record or a flat key/value array. Never log tokens.
 */
export function parseDailyOperationsXread(result: unknown): DailyOperationsRedisWake[] {
  if (!result || !Array.isArray(result)) return [];
  const wakes: DailyOperationsRedisWake[] = [];
  for (const stream of result) {
    if (!Array.isArray(stream) || stream.length < 2) continue;
    const entries = stream[1];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const parsed = parseXreadEntry(entry);
      if (parsed) wakes.push(parsed);
    }
  }
  return wakes;
}

export function createDailyOperationsLiveRedisReader(): DailyOperationsLiveRedisReader | null {
  if (isVantageTestRunner() || isTestMode()) {
    return null;
  }
  const redis = getDailyOperationsRedis();
  if (!redis) return null;
  return {
    async xread({ key, lastId, count }) {
      const result = await redis.xread(key, lastId, { count });
      return parseDailyOperationsXread(result);
    },
  };
}

export async function runDailyOperationsLiveSse(
  writer: DailyOperationsLiveWriter,
  deps: DailyOperationsLiveSseDeps,
  lastEventId?: string,
): Promise<void> {
  const pollMs = deps.pollMs ?? LIVE_DAILY_OPERATIONS_POLL_MS;
  const heartbeatMs = deps.heartbeatMs ?? LIVE_DAILY_OPERATIONS_HEARTBEAT_MS;
  const maxMs = deps.maxMs ?? LIVE_DAILY_OPERATIONS_MAX_MS;
  const started = deps.now();
  let lastHeartbeat = started;
  const day = easternDayKey(new Date(started));
  let cursor = decodeDailyOperationsEventCursor(lastEventId);
  let redisLastId = "0-0";
  const getRedis = deps.getRedis ?? createDailyOperationsLiveRedisReader;

  if (!cursor) {
    const snapshot = await deps.getSnapshot();
    writer.write(formatDailyOperationsSse("snapshot", snapshot));
    const newest = deps.listNewest ? await deps.listNewest(day) : null;
    if (newest) {
      cursor = cursorFromRow(newest);
      redisLastId = newest.redis_stream_id ?? "0-0";
    } else {
      cursor = startOfDayCursor(day);
    }
  } else {
    const remembered = await deps.findEventById(cursor.event_id);
    if (remembered?.redis_stream_id) {
      redisLastId = remembered.redis_stream_id;
    }
  }

  while (deps.now() - started < maxMs) {
    if (deps.signal?.aborted) {
      return;
    }

    const redis = getRedis();
    let usedMongoFallback = redis == null;
    if (redis) {
      try {
        const wakes = await redis.xread({
          key: getDailyOperationsStreamKey(day),
          lastId: redisLastId,
          count: LIVE_DAILY_OPERATIONS_XREAD_COUNT,
        });
        const touches = await emitWakes({
          writer,
          wakes,
          cursor,
          findEventById: deps.findEventById,
          onRedisAdvance: (streamId) => {
            redisLastId = streamId;
          },
          onEmit: (nextCursor, streamId) => {
            cursor = nextCursor;
            redisLastId = streamId;
          },
        });
        emitMetricsIfTouched(writer, touches);
      } catch {
        usedMongoFallback = true;
      }
    }

    if (usedMongoFallback) {
      const rows = await deps.listAfter(cursor, day);
      const touches: string[] = [];
      for (const row of rows) {
        const item = projectDailyOperationsEventItem(row);
        writer.write(
          formatDailyOperationsSse(
            "event",
            item,
            encodeDailyOperationsEventCursor({
              occurred_at: item.occurred_at,
              event_id: item.event_id,
            }),
          ),
        );
        cursor = {
          occurred_at: item.occurred_at,
          event_id: item.event_id,
        };
        if (row.redis_stream_id) {
          redisLastId = row.redis_stream_id;
        }
        touches.push(...item.metric_touches);
      }
      emitMetricsIfTouched(writer, touches);
    }

    const tick = deps.now();
    if (tick - lastHeartbeat >= heartbeatMs) {
      writer.write(
        formatDailyOperationsSse("heartbeat", {
          ts: new Date(tick).toISOString(),
        }),
      );
      lastHeartbeat = tick;
    }
    await deps.sleep(pollMs);
  }
}

export async function defaultFindDailyOperationsEventById(
  eventId: string,
): Promise<DailyOperationsLiveEventRow | null> {
  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    return null;
  }
  const row = await getDailyOperationsEventModel()
    .findById(eventId)
    .lean()
    .exec();
  return (row as DailyOperationsLiveEventRow | null) ?? null;
}

export async function defaultListDailyOperationsEventsAfter(
  cursor: DailyOperationsEventCursor,
  day: string,
): Promise<DailyOperationsLiveEventRow[]> {
  const since = new Date(cursor.occurred_at);
  if (Number.isNaN(since.getTime())) {
    return [];
  }
  const afterId = asObjectId(cursor.event_id);
  const filter: Record<string, unknown> = {
    day,
    ...(afterId
      ? {
          $or: [
            { occurred_at: { $gt: since } },
            { occurred_at: since, _id: { $gt: afterId } },
          ],
        }
      : { occurred_at: { $gt: since } }),
  };
  return getDailyOperationsEventModel()
    .find(filter)
    .sort({ occurred_at: 1, _id: 1 })
    .limit(LIVE_DAILY_OPERATIONS_XREAD_COUNT)
    .lean()
    .exec() as Promise<DailyOperationsLiveEventRow[]>;
}

export async function defaultListNewestDailyOperationsEvent(
  day: string,
): Promise<DailyOperationsLiveEventRow | null> {
  const row = await getDailyOperationsEventModel()
    .findOne({ day })
    .sort({ occurred_at: -1, _id: -1 })
    .lean()
    .exec();
  return (row as DailyOperationsLiveEventRow | null) ?? null;
}

function startOfDayCursor(day: string): DailyOperationsEventCursor {
  return {
    occurred_at: easternInstantBounds(day).start.toISOString(),
    event_id: "0".repeat(24),
  };
}

function cursorFromRow(row: DailyOperationsLiveEventRow): DailyOperationsEventCursor {
  const occurredAt =
    row.occurred_at instanceof Date
      ? row.occurred_at.toISOString()
      : new Date(row.occurred_at).toISOString();
  return {
    occurred_at: occurredAt,
    event_id: row._id.toString(),
  };
}

function isAfterCursor(
  item: DailyOperationsEventItem,
  cursor: DailyOperationsEventCursor,
): boolean {
  if (item.occurred_at > cursor.occurred_at) return true;
  if (item.occurred_at === cursor.occurred_at && item.event_id > cursor.event_id) {
    return true;
  }
  return false;
}

async function emitWakes(args: {
  writer: DailyOperationsLiveWriter;
  wakes: DailyOperationsRedisWake[];
  cursor: DailyOperationsEventCursor;
  findEventById: DailyOperationsLiveSseDeps["findEventById"];
  onRedisAdvance: (streamId: string) => void;
  onEmit: (cursor: DailyOperationsEventCursor, streamId: string) => void;
}): Promise<string[]> {
  const touches: string[] = [];
  for (const wake of args.wakes) {
    const row = await args.findEventById(wake.event_id);
    if (!row) {
      break;
    }
    const item = projectDailyOperationsEventItem(row);
    if (!isAfterCursor(item, args.cursor)) {
      args.onRedisAdvance(wake.redis_stream_id);
      continue;
    }
    args.writer.write(
      formatDailyOperationsSse(
        "event",
        item,
        encodeDailyOperationsEventCursor({
          occurred_at: item.occurred_at,
          event_id: item.event_id,
        }),
      ),
    );
    args.cursor = {
      occurred_at: item.occurred_at,
      event_id: item.event_id,
    };
    args.onEmit(args.cursor, wake.redis_stream_id);
    touches.push(...item.metric_touches);
  }
  return touches;
}

function emitMetricsIfTouched(
  writer: DailyOperationsLiveWriter,
  touches: string[],
): void {
  if (touches.length === 0) return;
  const metric_touches = [...new Set(touches)];
  writer.write(formatDailyOperationsSse("metrics", { metric_touches }));
}

function parseXreadEntry(entry: unknown): DailyOperationsRedisWake | null {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const streamId = entry[0];
  if (typeof streamId !== "string" || !streamId) return null;
  const fields = fieldsToRecord(entry[1]);
  const eventId = fields.event_id;
  if (!eventId) return null;
  return { redis_stream_id: streamId, event_id: eventId };
}

function fieldsToRecord(fields: unknown): Record<string, string> {
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  if (!Array.isArray(fields)) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (typeof key === "string" && typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

function asObjectId(id: string): mongoose.Types.ObjectId | null {
  if (!/^[a-fA-F0-9]{24}$/.test(id)) {
    return null;
  }
  return new mongoose.Types.ObjectId(id);
}
