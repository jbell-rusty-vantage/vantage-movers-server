import type { Types } from "mongoose";

/**
 * Slimming wave-1 bridge (SPEC §7.4). S-NUM removed these fields from the ContactNumber schema; the legacy
 * AI/Outreach modules that wave 2 deletes still read them from stored documents. This type only keeps those
 * modules compiling until they are deleted. No retained code may import it, and it is deleted with them.
 */
export type LegacyContactNumberFields = {
  content_purge_pending?: boolean | null;
  retention_epoch?: number | null;
  evidence_fence?: number | null;
  running_summary?: { text: string; run_id: Types.ObjectId; evidence_digest: string; computed_at: Date } | null;
  intelligence_schedule?: { fingerprint: string; generation: number; job_id: Types.ObjectId } | null;
};

/** Widens a stored ContactNumber (or null) with the retired fields; null and undefined stay as they are. */
export function legacyNumber<T>(number: T): T extends object ? T & LegacyContactNumberFields : T {
  return number as T extends object ? T & LegacyContactNumberFields : T;
}
