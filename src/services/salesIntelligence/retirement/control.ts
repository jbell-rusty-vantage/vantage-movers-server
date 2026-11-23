import type { Db } from "mongodb";

/**
 * Runtime switch for validated retirement (Mongo, never an env var). One document:
 * `sales_intelligence_job_retirement` `{ _id: "v1", enabled_at, cursor, lease_owner, lease_until, last_run }`.
 * Absent or without `enabled_at`: completions compact on the spot (the November 22 three-day receipt rule).
 * Present: completions keep their full row and the retirement worker archives, proves and compacts them.
 */
export const RETIREMENT_CONTROL_COLLECTION = "sales_intelligence_job_retirement";
export const RETIREMENT_CONTROL_ID = "v1";

const CACHE_MS = 60_000;
let cached: { at: number; enabled: boolean } | null = null;

/** Cached for a minute per process. Any read failure answers `false`: the completion keeps the receipt rule. */
export async function jobRetirementEnabled(db: Db | undefined, now = Date.now()): Promise<boolean> {
  if (cached && now - cached.at < CACHE_MS) return cached.enabled;
  let enabled = false;
  try {
    const row = db ? await db.collection<{ _id: string; enabled_at?: unknown }>(RETIREMENT_CONTROL_COLLECTION)
      .findOne({ _id: RETIREMENT_CONTROL_ID }, { projection: { enabled_at: 1 } }) : null;
    enabled = row?.enabled_at instanceof Date;
  } catch {
    enabled = false;
  }
  cached = { at: now, enabled };
  return enabled;
}

/** Test seam. */
export function resetJobRetirementCache() {
  cached = null;
}
