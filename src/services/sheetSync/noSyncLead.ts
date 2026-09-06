/**
 * Shared No-Sync Lead predicates for Sheet Sync planner, legacy sync, and
 * Owner contains. Only `no_sync === true` excludes. Missing / false / null
 * stay syncable.
 */

export function isNoSyncLead(lead: { no_sync?: boolean | null }): boolean {
  return lead.no_sync === true;
}

export function noSyncAppliesToNormalTabs(lead: {
  no_sync?: boolean | null;
  duplicate?: boolean | null;
  bad_lead?: unknown;
}): boolean {
  if (lead.no_sync !== true) return false;
  if (lead.duplicate === true) return false;
  if (lead.bad_lead) return false;
  return true;
}
