import { Types, type ClientSession } from "mongoose";
import { connectMongo, withTransaction } from "../../db";
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
 * domain write. Retained event/counter projection is atomic; Redis is not used.
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
  recordEvent: (input: {
    event: DailyOperationsEventInsert;
    increments: Record<string, number> | null;
    seed: DailyOperationsDaySeed;
    writtenAt: Date;
  }) => Promise<{ id: string; outcome: "recorded" | "closed_day" } | { duplicate: true }>;
};

export type RecordDailyOperationsFactDeps = {
  stores?: DailyOperationsFactStores;
  now?: () => Date;
};

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 11000);
}

/** Initialize missing fields and increment an open day without status/existence reads. */
export function dailyOperationsDayUpdatePipeline(
  seed: DailyOperationsDaySeed,
  increments: Record<string, number>,
  writtenAt: Date,
): Record<string, unknown>[] {
  const initialize: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...seed, revision: 0, createdAt: writtenAt, updatedAt: writtenAt })) {
    initialize[key] = { $ifNull: [`$${key}`, { $literal: value }] };
  }
  const open = { $eq: ["$status", "open"] };
  const update: Record<string, unknown> = {
    updatedAt: { $cond: [open, { $literal: writtenAt }, "$updatedAt"] },
  };
  const hourly = new Map<number, Record<string, unknown>>();
  for (const [key, amount] of Object.entries(increments)) {
    const hour = /^hourly\.(\d+)\.(\w+)$/.exec(key);
    if (hour) {
      const fields = hourly.get(Number(hour[1])) ?? {};
      fields[hour[2]!] = { $add: [{ $ifNull: [`$$bucket.${hour[2]}`, 0] }, amount] };
      hourly.set(Number(hour[1]), fields);
    } else {
      update[key] = { $cond: [open, { $add: [{ $ifNull: [`$${key}`, 0] }, amount] }, `$${key}`] };
    }
  }
  if (hourly.size) update.hourly = {
    $map: {
      input: "$hourly", as: "bucket",
      in: { $switch: {
        branches: [...hourly].map(([hour, fields]) => ({
          case: { $and: [open, { $eq: ["$$bucket.hour", hour] }] },
          then: { $mergeObjects: ["$$bucket", fields] },
        })),
        default: "$$bucket",
      } },
    },
  };
  return [{ $set: initialize }, { $set: update }];
}

export function createMongoDailyOperationsStores(): DailyOperationsFactStores {
  return {
    async recordEvent({ event, increments, seed, writtenAt }) {
      await connectMongo();
      const Event = getDailyOperationsEventModel();
      const eventId = new Types.ObjectId();
      const insert = async (session?: ClientSession, closed = false) => {
        await Event.create([{
          ...event, _id: eventId, metric_touches: closed ? [] : event.metric_touches,
          createdAt: writtenAt, updatedAt: writtenAt,
        }], session ? { session } : {});
        return { id: eventId.toString(), outcome: closed ? "closed_day" as const : "recorded" as const };
      };
      if (!increments) {
        try { return await insert(); }
        catch (error) { if (isDuplicateKey(error)) return { duplicate: true }; throw error; }
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await withTransaction(async (session) => {
            const day = await getDailyOperationsDayModel().collection.findOneAndUpdate(
              { day: event.day }, dailyOperationsDayUpdatePipeline(seed, increments, writtenAt),
              { session, upsert: true, returnDocument: "after", includeResultMetadata: false },
            );
            if (!day) throw new Error("Daily Operations day update returned no document");
            return insert(session, day.status === "closed");
          });
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
          const key = error as { keyPattern?: Record<string, unknown>; message?: string };
          // A concurrent first-day upsert can lose unique(day); retry the complete transaction.
          if (key.keyPattern?.day || /day_1/.test(key.message ?? "")) {
            if (attempt < 2) continue;
            throw error;
          }
          // The deduped event lost its race. Its transactional day change has rolled back.
          return { duplicate: true };
        }
      }
      throw new Error("Daily Operations day initialization retries exhausted");
    },
  };
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
    const metricTouches = input.metric_touches.filter((touch) => !touch.startsWith("decisions."));

    if (isTestDailyOperationsSinkActive() && !deps.stores) {
      captureDailyOperationsFactForTest(input);
      return { outcome: "recorded", event_id: "test", day };
    }

    const stores = deps.stores ?? createMongoDailyOperationsStores();

    const writtenAt = deps.now?.() ?? new Date();
    const inserted = await stores.recordEvent({
      event: {
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
      },
      increments: metricTouches.length ? buildDayIncrements(metricTouches, nyHour) : null,
      seed: buildDaySeed(day),
      writtenAt,
    });
    if ("duplicate" in inserted) return { event_id: "", day, outcome: "duplicate" };
    return { event_id: inserted.id, day, outcome: inserted.outcome };
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
