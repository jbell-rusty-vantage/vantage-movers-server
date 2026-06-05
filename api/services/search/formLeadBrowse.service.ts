import { FormLead } from "../../models/FormLead";
import type { BrowseFormLeadsQuery } from "../../validation/v1.validation";
import {
  attachmentClause,
  BOOKING_SUMMARY_SELECT,
  CANCELLATION_SUMMARY_SELECT,
  combineClauses,
  fieldContainsClause,
  fieldEqualsClause,
  fullTextClause,
  normalizeValue,
  toBookingSummary,
  toCancellationSummary,
  type LeadBookingSummary,
  type LeadCancellationSummary,
} from "./leadBrowseShared";

/**
 * List/browse form leads for the extension Search workspace. Unlike the scored
 * `searchFormLeads` (fallback id resolution), every filter is optional so an
 * empty query lists the latest leads. Populates the booking + cancellation refs
 * so result cards can show attachment status.
 */

const FULL_TEXT_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "email",
  "phone_number",
  "source_company",
  "ref_no",
];

export type FormLeadBrowseResult = {
  _id: string;
  source_company?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  ref_no?: string;
  quoted?: boolean;
  cubic_feet?: number;
  createdAt?: Date;
  booked: LeadBookingSummary | null;
  cancelled: LeadCancellationSummary | null;
};

export type FormLeadBrowseResponse = {
  results: FormLeadBrowseResult[];
  count: number;
};

export async function browseFormLeads(
  query: BrowseFormLeadsQuery,
): Promise<FormLeadBrowseResponse> {
  const filter = buildFormLeadBrowseFilter(query);

  const [docs, count] = await Promise.all([
    FormLead.find(filter)
      .sort({ createdAt: -1 })
      .skip(query.skip)
      .limit(query.limit)
      .populate({ path: "booked", select: BOOKING_SUMMARY_SELECT })
      .populate({ path: "cancelled", select: CANCELLATION_SUMMARY_SELECT })
      .lean()
      .exec(),
    FormLead.countDocuments(filter).exec(),
  ]);

  return {
    results: docs.map(mapFormLead),
    count,
  };
}

function buildFormLeadBrowseFilter(
  query: BrowseFormLeadsQuery,
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];

  const q = normalizeValue(query.q);
  if (q) {
    clauses.push(fullTextClause(FULL_TEXT_FIELDS, q));
  }

  const sourceCompany = normalizeValue(query.source_company);
  if (sourceCompany) {
    clauses.push(fieldEqualsClause("source_company", sourceCompany));
  }

  const name = normalizeValue(query.name);
  if (name) {
    clauses.push({
      $or: [
        fieldContainsClause("name", name),
        fieldContainsClause("first_name", name),
        fieldContainsClause("last_name", name),
      ],
    });
  }

  const email = normalizeValue(query.email)?.toLowerCase();
  if (email) {
    clauses.push(fieldContainsClause("email", email));
  }

  const phone = normalizeValue(query.phone_number);
  if (phone) {
    clauses.push(fieldContainsClause("phone_number", phone));
  }

  if (typeof query.booked === "boolean") {
    clauses.push(attachmentClause("booked", query.booked));
  }

  if (typeof query.cancelled === "boolean") {
    clauses.push(attachmentClause("cancelled", query.cancelled));
  }

  return combineClauses(clauses);
}

function mapFormLead(doc: Record<string, unknown>): FormLeadBrowseResult {
  return {
    _id: String(doc._id),
    source_company: doc.source_company as string | undefined,
    name: doc.name as string | undefined,
    first_name: doc.first_name as string | undefined,
    last_name: doc.last_name as string | undefined,
    email: doc.email as string | undefined,
    phone_number: doc.phone_number as string | undefined,
    ref_no: doc.ref_no as string | undefined,
    quoted: doc.quoted as boolean | undefined,
    cubic_feet: doc.cubic_feet as number | undefined,
    createdAt: doc.createdAt as Date | undefined,
    booked: toBookingSummary(doc.booked),
    cancelled: toCancellationSummary(doc.cancelled),
  };
}
