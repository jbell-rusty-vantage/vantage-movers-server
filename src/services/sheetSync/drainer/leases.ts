import { SheetSyncLease } from "../../../models/SheetSyncLease";

/**
 * Attempts to acquire a named lease, returning `true` only if this owner now
 * holds it. A lease is free when it does not exist or its `leased_until` has
 * passed. The conditional `findOneAndUpdate` makes acquisition atomic across
 * concurrent drains (queue wake-up vs cron safety net).
 */
export async function acquireLease(
  scope: string,
  owner: string,
  ttlMs: number,
): Promise<boolean> {
  const now = new Date();
  const leasedUntil = new Date(now.getTime() + ttlMs);
  try {
    const result = await SheetSyncLease.findOneAndUpdate(
      {
        scope,
        $or: [{ leased_until: { $lte: now } }, { leased_until: { $exists: false } }],
      },
      { $set: { lease_owner: owner, leased_until: leasedUntil } },
      { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
    );
    return result?.lease_owner === owner;
  } catch (error) {
    // Duplicate-key on the unique `scope` index means another drain holds an
    // unexpired lease (the upsert raced an existing live row): not acquired.
    if (isDuplicateKeyError(error)) {
      return false;
    }
    throw error;
  }
}

/** Releases a lease this owner holds (no-op if it was reclaimed/expired). */
export async function releaseLease(scope: string, owner: string): Promise<void> {
  await SheetSyncLease.updateOne(
    { scope, lease_owner: owner },
    { $set: { leased_until: new Date(0) } },
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
