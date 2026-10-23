import { createHash, randomUUID } from "node:crypto";
import { getDailyOperationsRedisEnv } from "../../config/domain/dailyOperations";
import { connectMongo } from "../../db";
import { logger } from "../../logger";
import { getDailyOperationsReadViewModel, type DailyOperationsReadViewDocument } from "../../models/DailyOperationsReadView";
import { easternDayKey } from "./dayDocument";

export const DAILY_OPERATIONS_POLL_AFTER_MS = 60_000;
export const DAILY_OPERATIONS_READ_VIEW_LEASE_MS = 15_000;
export const DAILY_OPERATIONS_READ_VIEW_BUILD_MS = 5_000;
export const DAILY_OPERATIONS_READ_VIEW_SCHEMA_VERSION = 2;

export class DailyOperationsReadViewUnavailable extends Error {
  readonly code = "DAILY_OPERATIONS_VIEW_UNAVAILABLE";
  readonly poll_after_ms = DAILY_OPERATIONS_POLL_AFTER_MS;
  constructor() { super("Daily Operations is initializing or temporarily unavailable."); }
}

type ClaimInput = { key: string; now: Date; token: string; intervalMs: number };
type PublishInput = { key: string; token: string; generation: number; now: Date; payload: unknown; hash: string };
export type DailyOperationsReadViewStore = {
  read(key: string): Promise<DailyOperationsReadViewDocument | null>;
  claim(input: ClaimInput): Promise<DailyOperationsReadViewDocument | null>;
  publish(input: PublishInput): Promise<DailyOperationsReadViewDocument | null>;
  fail(input: { key: string; token: string; generation: number; now: Date }): Promise<void>;
};

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export function createMongoDailyOperationsReadViewStore(): DailyOperationsReadViewStore {
  const collection = () => {
    const model = getDailyOperationsReadViewModel();
    const db = model.db.db;
    if (!db) throw new Error("Daily Operations read-view database is not connected");
    return db.collection<DailyOperationsReadViewDocument>(model.collection.collectionName);
  };
  return {
    async read(key) {
      await connectMongo();
      return collection().findOne({ _id: key }, { maxTimeMS: 4000 }) as Promise<DailyOperationsReadViewDocument | null>;
    },
    async claim({ key, now, token, intervalMs }) {
      // _id uniqueness fences concurrent cold upserts. This claim persists the
      // retry deadline, so a dead owner's short lease cannot cause a retry storm.
      try {
        return await collection().findOneAndUpdate({
          _id: key,
          $and: [
            { $or: [{ next_attempt_at: { $lte: now } }, { next_attempt_at: { $exists: false } }] },
            { $or: [{ lease_expires_at: { $lte: now } }, { lease_expires_at: { $exists: false } }] },
          ],
        }, {
          $set: {
            next_attempt_at: new Date(now.getTime() + intervalMs),
            lease_token: token,
            lease_expires_at: new Date(now.getTime() + DAILY_OPERATIONS_READ_VIEW_LEASE_MS),
          },
          $inc: { generation: 1 },
        }, { upsert: true, returnDocument: "after", maxTimeMS: 4000 }) as DailyOperationsReadViewDocument | null;
      } catch (error) {
        if (isDuplicateKey(error)) return null;
        throw error;
      }
    },
    async publish({ key, token, generation, now, payload, hash }) {
      return collection().findOneAndUpdate({
        _id: key, lease_token: token, generation, lease_expires_at: { $gt: now },
      }, [{ $set: {
        payload: { $literal: payload },
        revision: { $cond: [{ $eq: ["$content_hash", hash] }, { $ifNull: ["$revision", 1] }, { $add: [{ $ifNull: ["$revision", 0] }, 1] }] },
        content_hash: { $literal: hash }, generated_at: now,
        lease_token: null, lease_expires_at: now,
      } }], { returnDocument: "after", maxTimeMS: 4000 }) as Promise<DailyOperationsReadViewDocument | null>;
    },
    async fail({ key, token, generation, now }) {
      await collection().updateOne({ _id: key, lease_token: token, generation }, {
        $set: { lease_token: null, lease_expires_at: now },
      }, { maxTimeMS: 4000 });
    },
  };
}

export type DailyOperationsCachedReadView<T> = {
  payload: T; generated_at: string; revision: number; freshness: "fresh" | "stale";
};
function result<T>(doc: DailyOperationsReadViewDocument | null, stale: boolean): DailyOperationsCachedReadView<T> {
  if (!doc || doc.payload == null || !doc.generated_at) throw new DailyOperationsReadViewUnavailable();
  return { payload: doc.payload as T, generated_at: new Date(doc.generated_at).toISOString(), revision: doc.revision ?? 1, freshness: stale ? "stale" : "fresh" };
}
function contentHash(payload: unknown): string {
  // Freshness timestamps do not change the business-content revision.
  return createHash("sha256").update(JSON.stringify(payload, (key, value: unknown) => key === "generated_at" ? undefined : value)).digest("hex");
}

export async function getCachedDailyOperationsReadView<T>(args: {
  scope: string; intervalMs: number; build: () => Promise<T>; now?: () => Date;
  stores?: DailyOperationsReadViewStore; sourceTimeoutMs?: number; day?: string;
}): Promise<DailyOperationsCachedReadView<T>> {
  const now = args.now ?? (() => new Date());
  const started = now();
  const intervalMs = Math.max(DAILY_OPERATIONS_POLL_AFTER_MS, args.intervalMs);
  const key = `${getDailyOperationsRedisEnv()}:${args.day ?? easternDayKey(started)}:${args.scope}:v${DAILY_OPERATIONS_READ_VIEW_SCHEMA_VERSION}`;
  const stores = args.stores ?? createMongoDailyOperationsReadViewStore();
  const cached = await stores.read(key);
  if (cached?.payload != null && cached.generated_at && started.getTime() - new Date(cached.generated_at).getTime() < intervalMs) return result<T>(cached, false);
  if (cached && new Date(cached.next_attempt_at).getTime() > started.getTime()) return result<T>(cached, true);
  const token = randomUUID();
  let claim: DailyOperationsReadViewDocument | null;
  try {
    claim = await stores.claim({ key, now: started, token, intervalMs });
  } catch {
    // A transient lease-store failure must not discard a value already read.
    return result<T>(cached, true);
  }
  if (!claim) return result<T>(cached, true); // One attempt, no loser busy-wait.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const payload = await Promise.race([
      args.build(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Daily Operations view build timed out")), args.sourceTimeoutMs ?? DAILY_OPERATIONS_READ_VIEW_BUILD_MS); }),
    ]);
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 512 * 1024) {
      throw new Error("Daily Operations read view exceeds its bounded payload size");
    }
    const published = await stores.publish({ key, token, generation: claim.generation, now: now(), payload, hash: contentHash(payload) });
    return published ? result<T>(published, false) : result<T>(cached, true);
  } catch (error) {
    await stores.fail({ key, token, generation: claim.generation, now: now() }).catch(() => undefined);
    logger.warn({ msg: "daily_operations.read_view.refresh_failed", scope: args.scope, errorName: error instanceof Error ? error.name : "Error" });
    return result<T>(cached, true);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
