import { CallLead, type CallLeadDocument } from "../../models/CallLead";
import type { SearchCallLeadsInput } from "../../validation/v1.validation";
import { normalizePhoneNumberForMatch } from "../../utils/phone";

export type CallLeadSearchSummary = Pick<
  CallLeadDocument,
  | "timestamp"
  | "source_company"
  | "name"
  | "email"
  | "phone_number"
  | "normalized_phone_number"
  | "job_no"
  | "pickup_city"
  | "pickup_zip"
  | "delivery_city"
  | "delivery_zip"
  | "pickup_state"
  | "delivery_state"
  | "local"
  | "cubic_feet"
  | "booked"
  | "cancelled"
> & {
  _id: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export async function searchCallLeads(input: SearchCallLeadsInput): Promise<CallLeadSearchSummary[]> {
  const filter = buildCallLeadSearchFilter(input);
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 25);
  const leads = await CallLead.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
  return leads.map(summarizeCallLead);
}

export function summarizeCallLead(lead: CallLeadDocument): CallLeadSearchSummary {
  const doc = lead as CallLeadDocument & { createdAt?: Date; updatedAt?: Date };
  return {
    _id: lead._id.toString(),
    timestamp: lead.timestamp,
    source_company: lead.source_company,
    name: lead.name,
    email: lead.email,
    phone_number: lead.phone_number,
    normalized_phone_number: lead.normalized_phone_number,
    job_no: lead.job_no,
    pickup_city: lead.pickup_city,
    pickup_zip: lead.pickup_zip,
    delivery_city: lead.delivery_city,
    delivery_zip: lead.delivery_zip,
    pickup_state: lead.pickup_state,
    delivery_state: lead.delivery_state,
    local: lead.local,
    cubic_feet: lead.cubic_feet,
    booked: lead.booked,
    cancelled: lead.cancelled,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function buildCallLeadSearchFilter(input: SearchCallLeadsInput): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];
  const normalizedPhone = normalizePhoneNumberForMatch(input.phone_number);
  if (normalizedPhone) {
    clauses.push({
      $or: [
        { normalized_phone_number: normalizedPhone },
        { phone_number: buildPhoneRegex(normalizedPhone) },
      ],
    });
  }

  const jobNo = normalizeValue(input.job_no);
  if (jobNo) {
    clauses.push({ job_no: jobNo });
  }

  const email = normalizeValue(input.email)?.toLowerCase();
  if (email) {
    clauses.push({ email });
  }

  const name = normalizeName(input.name);
  if (name) {
    clauses.push({ name: buildNameRegex(name) });
  }

  if (clauses.length === 0) {
    return { _id: { $exists: false } };
  }

  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function normalizeValue(value?: string | null): string | undefined {
  return value?.trim() || undefined;
}

function normalizeName(value?: string | null): string | undefined {
  return normalizeValue(value)?.replace(/\s+/g, " ");
}

function buildNameRegex(name: string): RegExp {
  const pattern = name.split(/\s+/).map(escapeRegex).join("\\s+");
  return new RegExp(pattern, "i");
}

function buildPhoneRegex(normalizedPhone: string): RegExp {
  const digits = normalizedPhone.replace(/\D/g, "");
  return new RegExp(`(?:^|\\D)${digits.split("").join("\\D*")}(?:\\D|$)`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
