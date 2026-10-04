import mongoose from "mongoose";
import type { AdminSearchQuery } from "../../validation/v1.validation";
import { getAdminModels, type AdminResource } from "./adminScope.service";
import { toObjectId } from "../../utils/objectId";
import {
  CALL_LEAD_CONTACT_EMAIL_PATHS,
  CALL_LEAD_CONTACT_NAME_PATHS,
  CALL_LEAD_CONTACT_PHONE_PATHS,
  FORM_LEAD_CONTACT_EMAIL_PATHS,
  FORM_LEAD_CONTACT_NAME_PATHS,
  FORM_LEAD_CONTACT_PHONE_PATHS,
} from "../search/leadBrowseShared";

type AdminSearchDoc = Record<string, unknown> & {
  _id: mongoose.Types.ObjectId | string;
};

export type AdminSearchItem = {
  id: string;
  primary_label: string;
  secondary_label: string;
  badges: string[];
  href: string;
};

export type AdminSearchGroup = {
  record_type: AdminResource;
  items: AdminSearchItem[];
};

const SEARCH_CONFIGS: Record<
  AdminResource,
  {
    fields: string[];
    hrefPrefix: string;
    primary: (doc: Record<string, unknown>) => string;
    secondary: (doc: Record<string, unknown>) => string;
    badges: (doc: Record<string, unknown>) => string[];
  }
> = {
  "form-leads": {
    fields: uniqueSearchFields([
      ...FORM_LEAD_CONTACT_NAME_PATHS,
      ...FORM_LEAD_CONTACT_EMAIL_PATHS,
      ...FORM_LEAD_CONTACT_PHONE_PATHS,
      "source_company",
      "source_company_label_snapshot",
      "source_granularity_label_snapshot",
      "crm_source_label_snapshot",
      "source_granularity_key",
      "ref_no",
      "lid",
    ]),
    hrefPrefix: "/form-leads",
    primary: (doc) => label(doc.ref_no, doc.name, doc.phone_number, "Form lead"),
    secondary: (doc) => label(doc.name, doc.email, doc.phone_number, sourceLabel(doc)),
    badges: leadBadges,
  },
  "call-leads": {
    fields: uniqueSearchFields([
      ...CALL_LEAD_CONTACT_NAME_PATHS,
      ...CALL_LEAD_CONTACT_EMAIL_PATHS,
      ...CALL_LEAD_CONTACT_PHONE_PATHS,
      "source_company",
      "source_company_label_snapshot",
      "source_granularity_label_snapshot",
      "crm_source_label_snapshot",
      "source_granularity_key",
      "job_no",
    ]),
    hrefPrefix: "/call-leads",
    primary: (doc) => label(doc.job_no, doc.name, doc.phone_number, "Call lead"),
    secondary: (doc) => label(doc.name, doc.email, doc.phone_number, sourceLabel(doc)),
    badges: leadBadges,
  },
  "booked-leads": {
    fields: ["job_no", "normalized_job_no", "customer_name", "customer_name_snapshot", "source", "merchant", "agent_allocations.agent_name_snapshot"],
    hrefPrefix: "/bookings",
    primary: (doc) => label(doc.job_no, "Booking"),
    secondary: (doc) => label(doc.customer_name, doc.customer_name_snapshot, doc.source, doc.merchant),
    badges: (doc) => ["booked", ...(doc.cancelled ? ["cancelled"] : [])],
  },
  "cancelled-leads": {
    fields: ["job_no", "normalized_job_no", "customer_name", "reason", "cancelled_by", "source", "merchant", "agent"],
    hrefPrefix: "/cancellations",
    primary: (doc) => label(doc.job_no, "Cancellation"),
    secondary: (doc) => label(doc.customer_name, doc.reason, doc.source),
    badges: () => ["cancelled"],
  },
};

export async function globalAdminSearch(query: AdminSearchQuery): Promise<{ groups: AdminSearchGroup[] }> {
  const resources = Object.keys(SEARCH_CONFIGS) as AdminResource[];
  const groups = await Promise.all(
    resources.map(async (resource) => ({
      record_type: resource,
      items: await searchResource(resource, query),
    })),
  );
  return { groups: groups.filter((group) => group.items.length > 0) };
}

async function searchResource(resource: AdminResource, query: AdminSearchQuery): Promise<AdminSearchItem[]> {
  const config = SEARCH_CONFIGS[resource];
  const q = query.q.trim();
  const objectIdClause = mongoose.isValidObjectId(q)
    ? [{ _id: toObjectId(q) }]
    : [];
  const regex = new RegExp(escapeRegex(q), "i");
  const filter = { $or: [...objectIdClause, ...config.fields.map((field) => ({ [field]: regex }))] };
  const docs = await getAdminModels()[resource].find(filter).sort({ createdAt: -1 }).limit(query.limit).lean().exec();
  return (docs as AdminSearchDoc[]).map((doc) => {
    const id = String(doc._id);
    return {
      id,
      primary_label: config.primary(doc),
      secondary_label: config.secondary(doc),
      badges: config.badges(doc),
      href: `${config.hrefPrefix}/${id}`,
    };
  });
}

function leadBadges(doc: Record<string, unknown>): string[] {
  return [doc.booked ? "booked" : "unbooked", ...(doc.cancelled ? ["cancelled"] : [])];
}

function sourceLabel(doc: Record<string, unknown>): unknown {
  return (
    doc.crm_source_label_snapshot ||
    doc.source_granularity_label_snapshot ||
    doc.source_company_label_snapshot ||
    doc.source_company
  );
}

function label(...values: unknown[]): string {
  return values.find((value) => typeof value === "string" && value.trim()) as string || "";
}

function uniqueSearchFields(fields: string[]): string[] {
  return [...new Set(fields)];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
