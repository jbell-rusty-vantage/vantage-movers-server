import type { LeadSourceCompanyItem } from "../leadSourceCompanies";
import {
  normalizeComparisonName,
  normalizeJobNo,
  normalizeSubmissionLid,
} from "../bookings/bookingIdentity";
import { normalizePhoneNumberForMatch } from "../../utils/phone";

type CollisionRecord = {
  normalized: string;
  ids: string[];
};

export function collectNormalizedCollisions<T extends { _id: string }>(
  docs: T[],
  normalize: (doc: T) => string | undefined,
): CollisionRecord[] {
  const byNormalized = new Map<string, string[]>();
  for (const doc of docs) {
    const normalized = normalize(doc);
    if (!normalized) {
      continue;
    }
    byNormalized.set(normalized, [...(byNormalized.get(normalized) ?? []), doc._id]);
  }
  return [...byNormalized.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([normalized, ids]) => ({ normalized, ids }))
    .sort((left, right) => right.ids.length - left.ids.length || left.normalized.localeCompare(right.normalized));
}

export function buildEmployeeBookingMigrationReport(input: {
  bookedLeads: Array<{
    _id: string;
    job_no?: string | null;
    submission_id?: string | null;
    booking_origin?: string | null;
  }>;
  callLeads: Array<{ _id: string; job_no?: string | null }>;
  formLeads: Array<{ _id: string; lid?: string | null; phone_number?: string | null; name?: string | null }>;
  sourceCompanies: LeadSourceCompanyItem[];
}) {
  return {
    bookedLeadJobNoCollisions: collectNormalizedCollisions(
      input.bookedLeads,
      (doc) => normalizeJobNo(doc.job_no),
    ),
    bookedLeadSubmissionIdCollisions: collectNormalizedCollisions(
      input.bookedLeads.filter((doc) => doc.booking_origin === "employee_booking"),
      (doc) => doc.submission_id?.trim() || undefined,
    ),
    callLeadJobNoCollisions: collectNormalizedCollisions(
      input.callLeads,
      (doc) => normalizeJobNo(doc.job_no),
    ),
    formLeadLidCollisions: collectNormalizedCollisions(
      input.formLeads,
      (doc) => normalizeSubmissionLid(doc.lid),
    ),
    formLeadNormalizedPhoneCollisions: collectNormalizedCollisions(
      input.formLeads,
      (doc) => normalizePhoneNumberForMatch(doc.phone_number),
    ),
    formLeadNormalizedNameCollisions: collectNormalizedCollisions(
      input.formLeads,
      (doc) => normalizeComparisonName(doc.name),
    ),
    invalidSourceChannels: input.sourceCompanies.flatMap((company) =>
      company.granularities
        .filter(
          (granularity) =>
            granularity.active && granularity.channel !== "form" && granularity.channel !== "call",
        )
        .map((granularity) => ({
          company_slug: company.company_slug,
          granularity_key: granularity.granularity_key,
          channel: String(granularity.channel),
        })),
    ),
  };
}

export function reportHasBlockingCollisions(report: ReturnType<typeof buildEmployeeBookingMigrationReport>): boolean {
  return (
    report.bookedLeadJobNoCollisions.length > 0 ||
    report.bookedLeadSubmissionIdCollisions.length > 0
  );
}
