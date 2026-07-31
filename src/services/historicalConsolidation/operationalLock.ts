import type { ClientSession, Db } from "mongodb";

const LOCKS = "historical_import_locks";
const LOCK_ID = "historical-consolidation";
const LOCK_TTL_MS = 60_000;

export type HistoricalOperationalLock = {
  owner: string;
  fencing_token: number;
};

export async function acquireHistoricalOperationalLock(db: Db, manifestHash: string, owner: string): Promise<HistoricalOperationalLock> {
  const now = new Date();
  try {
    const result = await db.collection(LOCKS).findOneAndUpdate(
      { _id: LOCK_ID, $or: [{ expires_at: { $lte: now } }, { owner }] } as never,
      { $set: { owner, manifest_hash: manifestHash, expires_at: new Date(now.getTime() + LOCK_TTL_MS), heartbeat_at: now }, $inc: { fencing_token: 1 } },
      { upsert: true, returnDocument: "after" },
    );
    if (!result) throw new Error("Migration lock acquisition returned no record");
    return { owner, fencing_token: Number(result.fencing_token) };
  } catch (error) {
    if (error instanceof Error && (error.message.includes("E11000") || error.message.includes("duplicate key"))) throw new Error("Another historical migration holds the target lock");
    throw error;
  }
}

export async function assertHistoricalOperationalFence(db: Db, lock: HistoricalOperationalLock, session: ClientSession): Promise<void> {
  const current = await db.collection(LOCKS).findOne({ _id: LOCK_ID, owner: lock.owner, fencing_token: lock.fencing_token, expires_at: { $gt: new Date() } } as never, { session });
  if (!current) throw new Error("Historical migration lock was lost or fenced");
}

export async function heartbeatHistoricalOperationalLock(db: Db, lock: HistoricalOperationalLock): Promise<void> {
  const now = new Date();
  const result = await db.collection(LOCKS).updateOne(
    { _id: LOCK_ID, owner: lock.owner, fencing_token: lock.fencing_token } as never,
    { $set: { heartbeat_at: now, expires_at: new Date(now.getTime() + LOCK_TTL_MS) } },
  );
  if (result.matchedCount !== 1) throw new Error("Historical migration lock heartbeat was fenced");
}

export async function releaseHistoricalOperationalLock(db: Db, lock: HistoricalOperationalLock): Promise<void> {
  await db.collection(LOCKS).deleteOne({ _id: LOCK_ID, owner: lock.owner, fencing_token: lock.fencing_token } as never);
}
