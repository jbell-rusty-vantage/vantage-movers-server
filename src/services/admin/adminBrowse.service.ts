import mongoose, { type QueryFilter } from "mongoose";
import { resolveSourceCompany } from "../../config/domain";
import { getLeadMessageModel } from "../../models/LeadMessage";
import type { AdminBrowseQuery } from "../../validation/v1.validation";
import { V1ServiceError } from "../v1ServiceError";
import { getAdminModels, type AdminResource } from "./adminScope.service";
import { getAdminFacets } from "./adminFacets.service";
import { findCatalogGranularity } from "./filterCatalog";
import { isObjectIdString, toObjectId } from "../../utils/objectId";
import {
  CALL_LEAD_CONTACT_EMAIL_PATHS,
  CALL_LEAD_CONTACT_NAME_PATHS,
  CALL_LEAD_CONTACT_PHONE_PATHS,
  FORM_LEAD_CONTACT_EMAIL_PATHS,
  FORM_LEAD_CONTACT_NAME_PATHS,
  FORM_LEAD_CONTACT_PHONE_PATHS,
} from "../search/leadBrowseShared";

type AdminRecord = Record<string, unknown>;
type AdminFilter = QueryFilter<AdminRecord>;

export type AdminBrowseResult = {
  items: AdminRecord[];
  page: number;
  limit: number;
  total: number;
  has_next_page: boolean;
};

type ResourceConfig = {
  defaultSort: string;
  allowedSorts: string[];
  defaultDateField: string;
  dateFields: string[];
  qFields: string[];
  stringFilters: Record<string, string[]>;
  booleanFilters?: Record<string, string>;
  numberRanges?: Record<string, { min?: string; max?: string }>;
  populate?: string[];
};

const RESOURCE_CONFIGS: Record<AdminResource, ResourceConfig> = {
  "form-leads": {
    defaultSort: "createdAt",
    allowedSorts: ["createdAt", "timestamp", "move_date", "source_company", "name", "ref_no"],
    defaultDateField: "timestamp",
    dateFields: ["timestamp", "createdAt", "move_date"],
    qFields: [
      ...FORM_LEAD_CONTACT_NAME_PATHS,
      ...FORM_LEAD_CONTACT_EMAIL_PATHS,
      ...FORM_LEAD_CONTACT_PHONE_PATHS,
      "source_company",
      "source_company_label_snapshot",
      "source_granularity_label_snapshot",
      "crm_source_label_snapshot",
      "ref_no",
      "lid",
      "pickup_city",
      "delivery_city",
    ],
    stringFilters: {
      source_company: [
        "source_company",
        "source_company_label_snapshot",
        "source_granularity_label_snapshot",
        "crm_source_label_snapshot",
      ],
      source_granularity_key: ["source_granularity_key"],
      name: [...FORM_LEAD_CONTACT_NAME_PATHS],
      email: [...FORM_LEAD_CONTACT_EMAIL_PATHS],
      phone_number: [...FORM_LEAD_CONTACT_PHONE_PATHS],
      ref_no: ["ref_no", "normalized_ref_no"],
      pickup_city: ["pickup_city"],
      pickup_state: ["pickup_state"],
      pickup_zip: ["pickup_zip"],
      delivery_city: ["delivery_city"],
      delivery_state: ["delivery_state"],
      delivery_zip: ["delivery_zip", "destination_zip"],
      move_size: ["move_size"],
      local: ["local"],
    },
    booleanFilters: { booked: "booked", cancelled: "cancelled", no_sync: "no_sync" },
    populate: ["booked", "cancelled"],
  },
  "call-leads": {
    defaultSort: "createdAt",
    allowedSorts: ["createdAt", "timestamp", "start_time", "end_time", "source_company", "job_no"],
    defaultDateField: "timestamp",
    dateFields: ["timestamp", "createdAt", "start_time", "end_time"],
    qFields: [
      ...CALL_LEAD_CONTACT_NAME_PATHS,
      ...CALL_LEAD_CONTACT_EMAIL_PATHS,
      ...CALL_LEAD_CONTACT_PHONE_PATHS,
      "source_company",
      "source_company_label_snapshot",
      "source_granularity_label_snapshot",
      "crm_source_label_snapshot",
      "job_no",
      "pickup_city",
      "delivery_city",
    ],
    stringFilters: {
      source_company: [
        "source_company",
        "source_company_label_snapshot",
        "source_granularity_label_snapshot",
        "crm_source_label_snapshot",
      ],
      source_granularity_key: ["source_granularity_key"],
      name: [...CALL_LEAD_CONTACT_NAME_PATHS],
      email: [...CALL_LEAD_CONTACT_EMAIL_PATHS],
      phone_number: [...CALL_LEAD_CONTACT_PHONE_PATHS],
      job_no: ["job_no", "normalized_job_no"],
      pickup_city: ["pickup_city"],
      pickup_state: ["pickup_state"],
      pickup_zip: ["pickup_zip"],
      delivery_city: ["delivery_city"],
      delivery_state: ["delivery_state"],
      delivery_zip: ["delivery_zip"],
      local: ["local"],
    },
    booleanFilters: { booked: "booked", cancelled: "cancelled", no_sync: "no_sync" },
    populate: ["booked", "cancelled"],
  },
  "booked-leads": {
    defaultSort: "createdAt",
    allowedSorts: ["createdAt", "timestamp", "book_date", "job_no", "deposit_amount", "total_binder_amount"],
    defaultDateField: "book_date",
    dateFields: ["book_date", "timestamp", "createdAt"],
    qFields: [
      "job_no",
      "normalized_job_no",
      "customer_name",
      "customer_name_snapshot",
      "source",
      "merchant",
      "agent_allocations.agent_name_snapshot",
    ],
    stringFilters: {
      agent: ["agent_allocations.agent_name_snapshot"],
      customer_name: ["customer_name", "customer_name_snapshot"],
      job_no: ["job_no", "normalized_job_no"],
      merchant: ["merchant"],
      local: ["local"],
    },
    booleanFilters: { cancelled: "cancelled" },
    numberRanges: {
      deposit_amount: { min: "deposit_min", max: "deposit_max" },
      total_binder_amount: { min: "binder_min", max: "binder_max" },
    },
    populate: ["customer", "lead_ref", "cancelled", "agent_allocations.agent"],
  },
  "cancelled-leads": {
    defaultSort: "createdAt",
    allowedSorts: ["createdAt", "timestamp", "cancel_date", "book_date", "job_no", "refund_amount"],
    defaultDateField: "cancel_date",
    dateFields: ["cancel_date", "timestamp", "createdAt", "book_date"],
    qFields: ["job_no", "normalized_job_no", "customer_name", "reason", "cancelled_by", "source", "merchant", "agent"],
    stringFilters: {
      agent: ["agent"],
      customer_name: ["customer_name", "normalized_customer_name"],
      job_no: ["job_no", "normalized_job_no"],
      merchant: ["merchant"],
      reason: ["reason"],
      cancelled_by: ["cancelled_by"],
    },
    numberRanges: {
      refund_amount: { min: "refund_min", max: "refund_max" },
    },
    populate: ["booked_lead", "customer", "lead_ref"],
  },
};

export async function browseAdminResource(
  resource: AdminResource,
  query: AdminBrowseQuery,
): Promise<AdminBrowseResult> {
  const model = getAdminModels()[resource];
  const config = RESOURCE_CONFIGS[resource];
  const filter = applyResourceFilter(
    resource,
    query,
    mergeFilters(
      buildFilter(config, query),
      await leadSourceGranularityFilter(resource, query),
    ),
  );
  const sortField = safeSortField(resource, query.sort);
  const sort = { [sortField]: query.direction === "asc" ? 1 : -1 } as Record<string, 1 | -1>;
  const skip = (query.page - 1) * query.limit;
  const findQuery = applyPopulate(model.find(filter).sort(sort).skip(skip).limit(query.limit), config);
  const [docs, total] = await Promise.all([
    findQuery.lean().exec(),
    model.countDocuments(filter).exec(),
  ]);
  const items = (docs as Record<string, unknown>[]).map(normalizeDoc);
  return {
    items: resource === "form-leads" ? await enrichFormLeadItems(items, false) : items,
    page: query.page,
    limit: query.limit,
    total,
    has_next_page: skip + docs.length < total,
  };
}

export async function getAdminResourceDetail(
  resource: AdminResource,
  id: string,
): Promise<AdminRecord> {
  if (!mongoose.isValidObjectId(id)) {
    throw new V1ServiceError("Invalid Mongo ObjectId", 400);
  }
  const config = RESOURCE_CONFIGS[resource];
  const findQuery = applyPopulate(getAdminModels()[resource].findById(id), config);
  const doc = await findQuery.lean().exec();
  if (!doc) {
    throw new V1ServiceError("Admin record not found", 404);
  }
  const item = normalizeDoc(doc as AdminRecord);
  if (resource === "form-leads") {
    return (await enrichFormLeadItems([item], true))[0];
  }
  return item;
}

export async function exportAdminResourceRows(
  resource: AdminResource,
  query: AdminBrowseQuery,
  maxRows = 5_000,
): Promise<AdminRecord[]> {
  const exportQuery = { ...query, page: 1, limit: Math.min(maxRows, 250) };
  const rows: AdminRecord[] = [];
  let page = 1;
  while (rows.length < maxRows) {
    const result = await browseAdminResource(resource, { ...exportQuery, page });
    rows.push(...result.items);
    if (!result.has_next_page || result.items.length === 0) {
      break;
    }
    page += 1;
  }
  return rows.slice(0, maxRows);
}

function applyResourceFilter(
  resource: AdminResource,
  query: AdminBrowseQuery,
  filter: AdminFilter,
): AdminFilter {
  if (resource === "form-leads" || resource === "call-leads") {
    const duplicateClause =
      query.duplicate === true ? { duplicate: true } : { duplicate: { $ne: true } };
    return mergeFilters(
      mergeFilters(
        mergeFilters(
          mergeFilters(filter, duplicateClause),
          receiverAgentFilterClause(query),
        ),
        leadSourceCompanyFilterClause(query),
      ),
      pastMoveDateFilterClause(resource, query),
    );
  }

  if (resource === "booked-leads") {
    return mergeFilters(
      mergeFilters(filter, bookingSourceFilterClause(query)),
      leadlessBookingFilterClause(query),
    );
  }

  if (resource === "cancelled-leads") {
    return mergeFilters(filter, bookingSourceFilterClause(query));
  }

  return filter;
}

function receiverAgentFilterClause(query: AdminBrowseQuery): AdminFilter {
  const receiverAgent = typeof query.receiver_agent === "string" ? query.receiver_agent.trim() : "";
  if (!receiverAgent) {
    return {};
  }
  return {
    receiver_agent: toObjectId(receiverAgent),
  };
}

function leadSourceCompanyFilterClause(query: AdminBrowseQuery): AdminFilter {
  const leadSourceCompany =
    typeof query.lead_source_company === "string" ? query.lead_source_company.trim() : "";
  if (!leadSourceCompany) {
    return {};
  }
  return {
    lead_source_company: toObjectId(leadSourceCompany),
  };
}

/**
 * Form leads whose chosen move_date is at least one calendar day before the
 * submission `timestamp`. Both fields store Florida calendar components as UTC
 * date parts, so comparing move_date (UTC midnight) to the UTC start of the
 * timestamp's calendar day matches owner-facing "day behind" semantics.
 */
function pastMoveDateFilterClause(
  resource: AdminResource,
  query: AdminBrowseQuery,
): AdminFilter {
  if (resource !== "form-leads" || typeof query.past_move_date !== "boolean") {
    return {};
  }

  const moveDateBeforeCreated = {
    $lt: [
      "$move_date",
      {
        $dateFromParts: {
          year: { $year: "$timestamp" },
          month: { $month: "$timestamp" },
          day: { $dayOfMonth: "$timestamp" },
        },
      },
    ],
  };

  return {
    $expr: query.past_move_date ? moveDateBeforeCreated : { $not: [moveDateBeforeCreated] },
  };
}

function leadlessBookingFilterClause(query: AdminBrowseQuery): AdminFilter {
  if (query.leadless === true) {
    return { is_leadless_booking: true };
  }
  if (query.leadless === false) {
    return {
      $or: [
        { is_leadless_booking: false },
        { is_leadless_booking: { $exists: false } },
      ],
    };
  }
  return {};
}

function bookingSourceFilterClause(query: AdminBrowseQuery): AdminFilter {
  const raw =
    (typeof query.source === "string" ? query.source.trim() : "") ||
    (typeof query.source_label === "string" ? query.source_label.trim() : "") ||
    (typeof query.source_company === "string" ? query.source_company.trim() : "");

  if (!raw) {
    return {};
  }

  const resolved = resolveSourceCompany(raw) ?? raw;
  const variants = resolved === raw ? [resolved] : [resolved, raw];
  const uniqueVariants = [...new Set(variants.map((value) => value.toLowerCase()))].map(
    (lower) => variants.find((value) => value.toLowerCase() === lower)!,
  );

  if (uniqueVariants.length === 1) {
    return { source: exactCaseInsensitivePattern(uniqueVariants[0]) };
  }

  return {
    $or: uniqueVariants.map((value) => ({ source: exactCaseInsensitivePattern(value) })),
  };
}

function exactCaseInsensitivePattern(value: string): RegExp {
  return new RegExp(`^${escapeRegex(value)}$`, "i");
}

function mergeFilters(
  base: AdminFilter,
  extra: AdminFilter,
): AdminFilter {
  if (!Object.keys(base).length) {
    return extra;
  }

  if (!Object.keys(extra).length) {
    return base;
  }

  return { $and: [base, extra] };
}

function buildFilter(config: ResourceConfig, query: AdminBrowseQuery): AdminFilter {
  const clauses: AdminFilter[] = [];
  addDateClause(clauses, config, query);
  addQClause(clauses, config.qFields, query.q);
  const granularitySelected =
    typeof query.source_granularity_key === "string" && Boolean(query.source_granularity_key.trim());
  for (const [param, fields] of Object.entries(config.stringFilters)) {
    if (param === "source_granularity_key") continue;
    if (param === "source_company" && granularitySelected) continue;
    const value = query[param as keyof AdminBrowseQuery];
    if (typeof value === "string" && value.trim()) {
      clauses.push(
        param === "source_company" ? orExact(fields, value) : orContains(fields, value),
      );
    }
  }
  for (const [param, field] of Object.entries(config.booleanFilters ?? {})) {
    const value = query[param as keyof AdminBrowseQuery];
    if (typeof value === "boolean") {
      clauses.push(booleanFilterClause(field, value));
    }
  }
  for (const [field, params] of Object.entries(config.numberRanges ?? {})) {
    const range: Record<string, number> = {};
    const min = params.min ? query[params.min as keyof AdminBrowseQuery] : undefined;
    const max = params.max ? query[params.max as keyof AdminBrowseQuery] : undefined;
    if (typeof min === "number") range.$gte = min;
    if (typeof max === "number") range.$lte = max;
    if (Object.keys(range).length) clauses.push({ [field]: range });
  }
  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

function addDateClause(
  clauses: AdminFilter[],
  config: ResourceConfig,
  query: AdminBrowseQuery,
) {
  if (!query.from && !query.to) return;
  const field =
    query.date_field && config.dateFields.includes(query.date_field)
      ? query.date_field
      : config.defaultDateField;
  const range: Record<string, Date> = {};
  if (query.from) range.$gte = query.from;
  if (query.to) range.$lte = query.to;
  clauses.push({ [field]: range });
}

function addQClause(clauses: AdminFilter[], fields: string[], q?: string) {
  if (!q) return;
  const objectIdClause = mongoose.isValidObjectId(q)
    ? [{ _id: toObjectId(q) }]
    : [];
  clauses.push({ $or: [...objectIdClause, ...containsClauses(fields, q)] });
}

async function leadSourceGranularityFilter(
  resource: AdminResource,
  query: AdminBrowseQuery,
): Promise<AdminFilter> {
  if (resource !== "form-leads" && resource !== "call-leads") {
    return {};
  }
  const submitted =
    typeof query.source_granularity_key === "string" ? query.source_granularity_key.trim() : "";
  if (!submitted) {
    return {};
  }

  const fields = ["source_granularity_key", "source_granularity_label_snapshot"];
  const catalog = (await getAdminFacets()).catalog;
  const row = findCatalogGranularity(catalog, submitted);
  if (row?.id && isObjectIdString(row.id)) {
    return {
      $or: [
        ...fields.map((field) => ({ [field]: exactCaseInsensitivePattern(submitted) })),
        { source_granularity_id: toObjectId(row.id) },
      ],
    };
  }
  return orExact(fields, submitted);
}

function orContains(fields: string[], value: string): AdminFilter {
  return { $or: containsClauses(fields, value) };
}

function orExact(fields: string[], value: string): AdminFilter {
  return { $or: fields.map((field) => ({ [field]: exactCaseInsensitivePattern(value) })) };
}

function containsClauses(fields: string[], value: string): AdminFilter[] {
  const regex = new RegExp(escapeRegex(value), "i");
  return fields.map((field) => ({ [field]: regex }));
}

function booleanFilterClause(field: string, value: boolean): AdminFilter {
  if (field === "no_sync") {
    return value ? { no_sync: true } : { no_sync: { $ne: true } };
  }
  return presenceClause(field, value);
}

function presenceClause(field: string, present: boolean): AdminFilter {
  return present
    ? { [field]: { $ne: null, $exists: true } }
    : { $or: [{ [field]: null }, { [field]: { $exists: false } }] };
}

function safeSortField(resource: AdminResource, sort?: string): string {
  const config = RESOURCE_CONFIGS[resource];
  return sort && config.allowedSorts.includes(sort) ? sort : config.defaultSort;
}

function applyPopulate<TQuery extends mongoose.Query<unknown, unknown>>(
  query: TQuery,
  config: ResourceConfig,
): TQuery {
  let populated = query as mongoose.Query<unknown, unknown>;
  for (const path of config.populate ?? []) {
    populated = populated.populate(path);
  }
  return populated as TQuery;
}

async function enrichFormLeadItems(
  items: AdminRecord[],
  includeMessageData: boolean,
): Promise<AdminRecord[]> {
  const leadIds = items
    .map((item) => item._id)
    .filter((id): id is string => typeof id === "string" && mongoose.isValidObjectId(id))
    .map((id) => toObjectId(id));
  if (leadIds.length === 0) {
    return items.map((item) => ({
      ...item,
      sms_message_sent: false,
      ...(includeMessageData ? { sms_message: null } : {}),
    }));
  }

  const LeadMessage = getLeadMessageModel();
  if (!includeMessageData) {
    const sentLeadRows = await LeadMessage.aggregate<{ _id: mongoose.Types.ObjectId }>([
      {
        $match: {
          form_lead: { $in: leadIds },
          twilio_message_sid: { $type: "string", $ne: "" },
        },
      },
      { $group: { _id: "$form_lead" } },
    ]).exec();
    const sentLeadIds = new Set(sentLeadRows.map((row) => row._id.toString()));
    return items.map((item) => ({
      ...item,
      sms_message_sent: sentLeadIds.has(String(item._id ?? "")),
    }));
  }

  const leadId = leadIds[0];
  const latestMessage = await LeadMessage.findOne({ form_lead: leadId })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  const message = latestMessage
    ? normalizeLeadMessage(latestMessage as unknown as AdminRecord)
    : undefined;
  const sentMessage = await LeadMessage.exists({
    form_lead: leadId,
    twilio_message_sid: { $type: "string", $ne: "" },
  });
  return items.map((item) => ({
    ...item,
    sms_message_sent: Boolean(sentMessage),
    sms_message: message ?? null,
  }));
}

function normalizeLeadMessage(message: AdminRecord): AdminRecord {
  return {
    ...message,
    _id: String(message._id),
    form_lead: String(message.form_lead),
  };
}

function normalizeDoc(doc: AdminRecord): AdminRecord {
  return {
    ...doc,
    _id: String(doc._id),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
