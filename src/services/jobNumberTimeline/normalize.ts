import {
  equivalentNormalizedJobFilter,
  equivalentNormalizedJobSnapshotFilter,
  jobNumbersEquivalent,
  normalizeJobNo,
} from "../bookings/bookingIdentity.js";

export function normalizeTypedJobNo(raw: string | null | undefined): string | undefined {
  return normalizeJobNo(raw?.trim() ?? "");
}

export function jobsEquivalent(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) return false;
  return jobNumbersEquivalent(left, right);
}

export { equivalentNormalizedJobFilter, equivalentNormalizedJobSnapshotFilter, normalizeJobNo };
