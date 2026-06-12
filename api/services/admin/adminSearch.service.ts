import mongoose from "mongoose";
import type { AdminSearchQuery } from "../../validation/v1.validation";
import { concreteScopes, getAdminModels, type AdminResource, type ConcreteAdminScope } from "./adminScope.service";

type AdminSearchDoc = Record<string, unknown> & {
  _id: mongoose.Types.ObjectId | string;
};

export type AdminSearchItem = {
  id: string;
  database_scope: ConcreteAdminScope;
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
    fields: ["name", "email", "phone_number", "source_company", "ref_no", "lid"],
    hrefPrefix: "/form-leads",
    primary: (doc) => label(doc.ref_no, doc.name, doc.phone_number, "Form lead"),
    secondary: (doc) => label(doc.name, doc.email, doc.phone_number, doc.source_company),
    badges: leadBadges,
  },
  "call-leads": {
    fields: ["name", "email", "phone_number", "normalized_phone_number", "source_company", "job_no"],
    hrefPrefix: "/call-leads",
    primary: (doc) => label(doc.job_no, doc.name, doc.phone_number, "Call lead"),
    secondary: (doc) => label(doc.name, doc.email, doc.phone_number, doc.source_company),
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
  customers: {
    fields: ["full_name", "normalized_name", "phone_number", "email"],
    hrefPrefix: "/customers",
    primary: (doc) => label(doc.full_name, doc.phone_number, "Customer"),
    secondary: (doc) => label(doc.email, doc.phone_number),
    badges: () => ["customer"],
  },
  agents: {
    fields: ["name", "normalized_name", "role"],
    hrefPrefix: "/agents",
    primary: (doc) => label(doc.name, "Agent"),
    secondary: (doc) => label(doc.role, doc.active === false ? "inactive" : "active"),
    badges: (doc) => [doc.active === false ? "inactive" : "active", "agent"],
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
  const items = await Promise.all(
    concreteScopes(query.database_scope).map((scope) => searchConcrete(resource, scope, query)),
  );
  return items.flat().slice(0, query.limit);
}

async function searchConcrete(
  resource: AdminResource,
  scope: ConcreteAdminScope,
  query: AdminSearchQuery,
): Promise<AdminSearchItem[]> {
  const config = SEARCH_CONFIGS[resource];
  const models = getAdminModels(scope);
  const q = query.q.trim();
  const objectIdClause = mongoose.isValidObjectId(q)
    ? [{ _id: mongoose.Types.ObjectId.createFromHexString(q) }]
    : [];
  const regex = new RegExp(escapeRegex(q), "i");
  const filter = { $or: [...objectIdClause, ...config.fields.map((field) => ({ [field]: regex }))] };
  const docs = await models[resource].find(filter).sort({ createdAt: -1 }).limit(query.limit).lean().exec();
  return (docs as AdminSearchDoc[]).map((doc) => {
    const id = String(doc._id);
    return {
      id,
      database_scope: scope,
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

function label(...values: unknown[]): string {
  return values.find((value) => typeof value === "string" && value.trim()) as string || "";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
