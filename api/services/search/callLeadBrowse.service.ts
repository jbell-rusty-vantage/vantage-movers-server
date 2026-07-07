import { CallLead } from "../../models/CallLead";
import type { BrowseCallLeadsQuery } from "../../validation/v1.validation";
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
 * List/browse call leads for the extension Search workspace. Every filter is
 * optional so an empty query lists the latest leads; `source_company` works as
 * a standalone filter and `q` is a loose full-text match. Populates booking +
 * cancellation refs for compact attachment chips.
 */

const FULL_TEXT_FIELDS = [
  "name",
  "first_name",
  "last_name",
  "email",
  "phone_number",
  "source_company",
  "source_company_label_snapshot",
  "source_granularity_label_snapshot",
  "crm_source_label_snapshot",
  "job_no",
];

export type CallLeadBrowseResult = {
  _id: string;
  source_company?: string;
  lead_source_company?: string;
  source_granularity_key?: string;
  source_company_label_snapshot?: string;
  source_granularity_label_snapshot?: string;
  crm_source_label_snapshot?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  job_no?: string;
  cubic_feet?: number;
  createdAt?: Date;
  receiver_agent_name_snapshot?: string;
  receiver_agent_granot_crm_username?: string;
  booked: LeadBookingSummary | null;
  cancelled: LeadCancellationSummary | null;
};

export type CallLeadBrowseResponse = {
  results: CallLeadBrowseResult[];
  count: number;
};

export async function browseCallLeads(
  query: BrowseCallLeadsQuery,
): Promise<CallLeadBrowseResponse> {
  const filter = buildCallLeadBrowseFilter(query);

  const [docs, count] = await Promise.all([
    CallLead.find(filter)
      .sort({ createdAt: -1 })
      .skip(query.skip)
      .limit(query.limit)
      .populate({ path: "booked", select: BOOKING_SUMMARY_SELECT })
      .populate({ path: "cancelled", select: CANCELLATION_SUMMARY_SELECT })
      .populate({ path: "receiver_agent", select: "granot_crm_username" })
      .lean()
      .exec(),
    CallLead.countDocuments(filter).exec(),
  ]);

  return {
    results: docs.map(mapCallLead),
    count,
  };
}

function buildCallLeadBrowseFilter(
  query: BrowseCallLeadsQuery,
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];

  const q = normalizeValue(query.q);
  if (q) {
    clauses.push(fullTextClause(FULL_TEXT_FIELDS, q));
  }

  const sourceCompany = normalizeValue(query.source_company);
  if (sourceCompany) {
    clauses.push({
      $or: [
        fieldEqualsClause("source_company", sourceCompany),
        fieldEqualsClause("source_company_label_snapshot", sourceCompany),
        fieldEqualsClause("source_granularity_label_snapshot", sourceCompany),
        fieldEqualsClause("crm_source_label_snapshot", sourceCompany),
      ],
    });
  }

  const leadSourceCompany = normalizeValue(query.lead_source_company);
  if (leadSourceCompany) {
    clauses.push({ lead_source_company: leadSourceCompany });
  }

  const sourceGranularityKey = normalizeValue(query.source_granularity_key);
  if (sourceGranularityKey) {
    clauses.push(fieldEqualsClause("source_granularity_key", sourceGranularityKey));
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

  const jobNo = normalizeValue(query.job_no);
  if (jobNo) {
    clauses.push(fieldContainsClause("job_no", jobNo));
  }

  if (typeof query.booked === "boolean") {
    clauses.push(attachmentClause("booked", query.booked));
  }

  if (typeof query.cancelled === "boolean") {
    clauses.push(attachmentClause("cancelled", query.cancelled));
  }

  return combineClauses(clauses);
}

function mapCallLead(doc: Record<string, unknown>): CallLeadBrowseResult {
  return {
    _id: String(doc._id),
    source_company: doc.source_company as string | undefined,
    lead_source_company: doc.lead_source_company
      ? String(doc.lead_source_company)
      : undefined,
    source_granularity_key: doc.source_granularity_key as string | undefined,
    source_company_label_snapshot: doc.source_company_label_snapshot as string | undefined,
    source_granularity_label_snapshot: doc.source_granularity_label_snapshot as string | undefined,
    crm_source_label_snapshot: doc.crm_source_label_snapshot as string | undefined,
    name: doc.name as string | undefined,
    first_name: doc.first_name as string | undefined,
    last_name: doc.last_name as string | undefined,
    email: doc.email as string | undefined,
    phone_number: doc.phone_number as string | undefined,
    job_no: doc.job_no as string | undefined,
    cubic_feet: doc.cubic_feet as number | undefined,
    createdAt: doc.createdAt as Date | undefined,
    receiver_agent_name_snapshot: doc.receiver_agent_name_snapshot as string | undefined,
    receiver_agent_granot_crm_username: getReceiverAgentCrmUsername(doc.receiver_agent),
    booked: toBookingSummary(doc.booked),
    cancelled: toCancellationSummary(doc.cancelled),
  };
}

function getReceiverAgentCrmUsername(receiverAgent: unknown): string | undefined {
  if (!receiverAgent || typeof receiverAgent !== "object") {
    return undefined;
  }
  const value = (receiverAgent as { granot_crm_username?: unknown }).granot_crm_username;
  return typeof value === "string" ? value : undefined;
}
