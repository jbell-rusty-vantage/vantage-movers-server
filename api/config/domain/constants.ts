/**
 * Pure domain constants shared across services, models, and validation.
 *
 * This module must remain free of `process.env` reads so it is safe to
 * import from tests, scripts, and any module that runs before env loading.
 */

export const LOCAL_TYPES = ["local", "long_distance"] as const;
export type LocalType = (typeof LOCAL_TYPES)[number];

export const LEAD_MODELS = ["FormLead", "CallLead"] as const;
export type LeadModelName = (typeof LEAD_MODELS)[number];

export const MOVE_SIZES = [
  "Studio",
  "2 Bedrooms",
  "3 Bedrooms",
  "4 Bedrooms",
  "5+ Bedrooms",
  "Office",
] as const;

export const SHEET_SYNC_STATUSES = ["pending", "synced", "failed"] as const;
export type SheetSyncStatus = (typeof SHEET_SYNC_STATUSES)[number];
