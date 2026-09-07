import {
  getDailyOperationsRedis,
  getDailyOperationsStreamKey,
  shouldPublishDailyOperationsRedis,
} from "../../config/domain/dailyOperations";
import { connectMongo } from "../../db";
import { logger } from "../../logger";
import { getDailyOperationsDayModel } from "../../models/DailyOperationsDay";
import {
  getDailyOperationsEventModel,
  type DailyOperationsCard,
  type DailyOperationsEventDocument,
  type DailyOperationsLinks,
} from "../../models/DailyOperationsEvent";
import {
  buildDayIncrements,
  buildDaySeed,
  easternDayKey,
  easternHour,
  type DailyOperationsDaySeed,
} from "./dayDocument";
import {
  laneForKind,
  titleForKind,
  type DailyOperationsKind,
  type DailyOperationsLane,
} from "./kinds";
import {
  captureDailyOperationsFactForTest,
  isTestDailyOperationsSinkActive,
} from "./testDailyOperationsSink";

/**
 * After-commit Daily Operations writer. Never throws. Never changes the
 * domain write. Redis is a doorbell (`XADD` only — never `INCR`).
 */

export type RecordDailyOperationsFactInput = {
  kind: DailyOperationsKind;
  dedupe_key: string;
  occurred_at?: Date;
  title?: string;
  lane?: DailyOperationsLane;
  source_company?: string | null;
  ingestion_origin?: string | null;
  lead_kind?: "form" | "call" | null;
  job_no?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  parent_receipt_id?: string | null;
  links?: DailyOperationsLinks;
  card?: DailyOperationsCard;
  metric_touches: string[];
};

export type RecordDailyOperationsFactResult = {
  event_id: string;
  day: string;
  outcome: "recorded" | "duplicate" | "closed_day";
};

export type DailyOperationsEventInsert = {
  day: string;
  occurred_at: Date;
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
  dedupe_key: string;
  redis_stream_id: string | null;
};

export type DailyOperationsFactStores = {
  insertEvent: (
    doc: DailyOperationsEventInsert,
  ) => Promise<{ id: string } | { duplicate: true }>;
  setEventMetricTouches: (id: string, touches: string[]) => Promise<void>;
  setEventRedisStreamId: (id: string, streamId: string) => Promise<void>;
  findDayStatus: (day: string) => Promise<"open" | "closed" | null>;
  incrementOpenDay: (args: {
    day: string;
    increments: Record<string, number>;
    seed: DailyOperationsDaySeed;
  }) => Promise<void>;
};

export type DailyOperationsRedisPublisher = {
  xadd: (
    key: string,
    id: "*",
    fields: Record<string, string>,
    options: {
      trim: {
        type: "MAXLEN";
        threshold: number;
        comparison: "~";
      };
    },
  ) => Promise<string | null | undefined>;
};

export type RecordDailyOperationsFactDeps = {
  stores?: DailyOperationsFactStores;
  getRedis?: () => DailyOperationsRedisPublisher | null;
  shouldPublish?: () => boolean;
  now?: () => Date;
};

const REDIS_STREAM_MAXLEN = 2000;

function isDuplicateKey(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000,
  );
}

export function createMongoDailyOperationsStores(): DailyOperationsFactStores {
  return {
    async insertEvent(doc) {
      await connectMongo();
      const Event = getDailyOperationsEventModel();
      try {
        const created = await Event.create(doc);
        return { id: created._id.toString() };
      } catch (error) {
        if (isDuplicateKey(error)) {
          return { duplicate: true };
        }
        throw error;
      }
    },
    async setEventMetricTouches(id, touches) {
      await connectMongo();
      const Event = getDailyOperationsEventModel();
      await Event.updateOne({ _id: id }, { $set: { metric_touches: touches } });
    },
    async setEventRedisStreamId(id, streamId) {
      await connectMongo();
      const Event = getDailyOperationsEventModel();
      await Event.updateOne({ _id: id }, { $set: { redis_stream_id: streamId } });
    },
    async findDayStatus(day) {
      await connectMongo();
      const Day = getDailyOperationsDayModel();
      const found = await Day.findOne({ day }).select("status").lean();
      return found?.status ?? null;
    },
    async incrementOpenDay({ day, increments, seed }) {
      await connectMongo();
      const Day = getDailyOperationsDayModel();
      const existing = await Day.findOne({ day }).select("_id").lean();
      if (!existing) {
        try {
          await Day.create(seed);
        } catch (error) {
          if (!isDuplicateKey(error)) {
            throw error;
          }
        }
      }
      await Day.updateOne({ day, status: "open" }, { $inc: increments });
    },
  };
}

async function publishRedisDoorbell(args: {
  deps: RecordDailyOperationsFactDeps;
  eventId: string;
  day: string;
  kind: DailyOperationsKind;
  lane: DailyOperationsLane;
  occurredAt: Date;
  dedupeKey: string;
  stores: DailyOperationsFactStores;
}): Promise<void> {
  const shouldPublish = args.deps.shouldPublish ?? shouldPublishDailyOperationsRedis;
  if (!shouldPublish()) {
    return;
  }

  const getRedis = args.deps.getRedis ?? getDailyOperationsRedis;
  const redis = getRedis();
  if (!redis) {
    return;
  }

  try {
    const streamId = await redis.xadd(
      getDailyOperationsStreamKey(args.day),
      "*",
      {
        event_id: args.eventId,
        day: args.day,
        kind: args.kind,
        lane: args.lane,
        occurred_at: args.occurredAt.toISOString(),
        dedupe_key: args.dedupeKey,
      },
      {
        trim: {
          type: "MAXLEN",
          threshold: REDIS_STREAM_MAXLEN,
          comparison: "~",
        },
      },
    );
    if (streamId) {
      await args.stores.setEventRedisStreamId(args.eventId, streamId);
    }
  } catch (error) {
    logger.warn({
      msg: "daily_operations.redis.xadd_failed",
      kind: args.kind,
      day: args.day,
      err: error,
    });
  }
}

export async function recordDailyOperationsFact(
  input: RecordDailyOperationsFactInput,
  deps: RecordDailyOperationsFactDeps = {},
): Promise<RecordDailyOperationsFactResult | null> {
  try {
    const dedupeKey = input.dedupe_key?.trim();
    if (!dedupeKey) {
      logger.warn({
        msg: "daily_operations.record_fact_skipped",
        reason: "missing_dedupe_key",
        kind: input.kind,
      });
      return null;
    }

    const occurredAt = input.occurred_at ?? deps.now?.() ?? new Date();
    const day = easternDayKey(occurredAt);
    const nyHour = easternHour(occurredAt);
    const lane = input.lane ?? laneForKind(input.kind);
    const title = input.title ?? titleForKind(input.kind);
    const metricTouches = [...input.metric_touches];

    if (isTestDailyOperationsSinkActive() && !deps.stores) {
      captureDailyOperationsFactForTest(input);
      return { outcome: "recorded", event_id: "test", day };
    }

    const stores = deps.stores ?? createMongoDailyOperationsStores();

    const inserted = await stores.insertEvent({
      day,
      occurred_at: occurredAt,
      lane,
      kind: input.kind,
      title,
      source_company: input.source_company ?? null,
      ingestion_origin: input.ingestion_origin ?? null,
      lead_kind: input.lead_kind ?? null,
      job_no: input.job_no ?? null,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      parent_receipt_id: input.parent_receipt_id ?? null,
      links: input.links ?? {},
      card: input.card ?? {},
      metric_touches: metricTouches,
      dedupe_key: dedupeKey,
      redis_stream_id: null,
    });

    if ("duplicate" in inserted) {
      return { event_id: "", day, outcome: "duplicate" };
    }

    const dayStatus = await stores.findDayStatus(day);
    if (dayStatus === "closed") {
      await stores.setEventMetricTouches(inserted.id, []);
      await publishRedisDoorbell({
        deps,
        eventId: inserted.id,
        day,
        kind: input.kind,
        lane,
        occurredAt,
        dedupeKey,
        stores,
      });
      return { event_id: inserted.id, day, outcome: "closed_day" };
    }

    await stores.incrementOpenDay({
      day,
      increments: buildDayIncrements(metricTouches, nyHour),
      seed: buildDaySeed(day),
    });

    await publishRedisDoorbell({
      deps,
      eventId: inserted.id,
      day,
      kind: input.kind,
      lane,
      occurredAt,
      dedupeKey,
      stores,
    });

    return { event_id: inserted.id, day, outcome: "recorded" };
  } catch (error) {
    logger.error({
      msg: "daily_operations.record_fact_failed",
      kind: input.kind,
      err: error,
    });
    return null;
  }
}

export type { DailyOperationsEventDocument };
