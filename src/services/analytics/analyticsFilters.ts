import type { PipelineStage } from "mongoose";
import {
  SOURCE_COMPANY_CONFIGS,
  SOURCE_LABEL_TO_COMPANY,
  resolveSourceCompany,
} from "../../config/domain/sources";
import type { AnalyticsQuery } from "../../validation/v1.validation";
import { getAdminFacets } from "../admin/adminFacets.service";
import {
  findCatalogGranularity,
  type FilterCatalog,
} from "../admin/filterCatalog";
import { isObjectIdString, toObjectId } from "../../utils/objectId";

export type AnalyticsRow = Record<string, unknown>;

export function dateMatch(field: string, query: AnalyticsQuery): PipelineStage.Match[] {
  if (!query.from && !query.to) return [];
  const range: Record<string, Date> = {};
  if (query.from) range.$gte = query.from;
  if (query.to) range.$lte = query.to;
  return [{ $match: { [field]: range } }];
}

export function bookedLeadPrefix(query: AnalyticsQuery): PipelineStage[] {
  return [
    ...directBookedLeadMatch(query),
    ...bookedLeadSourceLookups(),
    ...sourceDropdownMatch("derived_source_company", "derived_source_granularity_key", query),
  ];
}

export function cancelledLeadPrefix(query: AnalyticsQuery): PipelineStage[] {
  return [
    ...directCancelledLeadMatch(query),
    {
      $lookup: {
        from: "booked_leads",
        localField: "booked_lead",
        foreignField: "_id",
        as: "booked_lead_doc",
      },
    },
    {
      $set: {
        joined_lead_ref: {
          $ifNull: ["$lead_ref", { $arrayElemAt: ["$booked_lead_doc.lead_ref", 0] }],
        },
        joined_lead_model: {
          $ifNull: ["$lead_model", { $arrayElemAt: ["$booked_lead_doc.lead_model", 0] }],
        },
      },
    },
    {
      $lookup: {
        from: "form_leads",
        localField: "joined_lead_ref",
        foreignField: "_id",
        as: "form_lead",
      },
    },
    {
      $lookup: {
        from: "call_leads",
        localField: "joined_lead_ref",
        foreignField: "_id",
        as: "call_lead",
      },
    },
    {
      $set: {
        derived_source_company: sourceCompanyExpression(),
        derived_source_granularity_key: sourceGranularityExpression(),
      },
    },
    ...sourceDropdownMatch("derived_source_company", "derived_source_granularity_key", query),
  ];
}

export async function leadMatchForQuery(
  leadType: "FormLead" | "CallLead",
  query: AnalyticsQuery,
): Promise<Record<string, unknown>> {
  if (!query.source_granularity_key) {
    return leadMatch(leadType, query);
  }
  const catalog = (await getAdminFacets(query.database_scope)).catalog;
  return leadMatch(leadType, query, catalog);
}

export function leadMatch(
  leadType: "FormLead" | "CallLead",
  query: AnalyticsQuery,
  catalog?: FilterCatalog,
): Record<string, unknown> {
  const clauses: Record<string, unknown>[] = [];
  if (query.lead_type && query.lead_type !== leadType) {
    clauses.push({ _id: { $exists: false } });
  }
  const dateClauses = dateMatch("timestamp", query);
  if (dateClauses[0]) clauses.push(dateClauses[0].$match);
  if (query.local) clauses.push({ local: exactRegex(query.local) });
  if (query.source_granularity_key) {
    clauses.push(
      sourceGranularityLeadClause(leadType, query.source_granularity_key, catalog, query.database_scope),
    );
  } else if (query.source_company) {
    clauses.push({ source_company: { $in: sourceCompanyRegexes(query.source_company) } });
  }
  if (!clauses.length) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

export function bookedLeadSourceLookups(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: "form_leads",
        localField: "lead_ref",
        foreignField: "_id",
        as: "form_lead",
      },
    },
    {
      $lookup: {
        from: "call_leads",
        localField: "lead_ref",
        foreignField: "_id",
        as: "call_lead",
      },
    },
    {
      $set: {
        derived_source_company: sourceCompanyExpression(),
        derived_source_granularity_key: sourceGranularityExpression(),
        is_cancelled: {
          $ne: [{ $ifNull: ["$cancelled", null] }, null],
        },
      },
    },
  ];
}

export function normalizeDimension(value: unknown, fallback = "unknown"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

export function normalizeDimensionKey(value: unknown, fallback = "unknown"): string {
  return normalizeDimension(value, fallback).toLowerCase();
}

export function normalizeSourceDimension(value: unknown): string {
  const normalized = normalizeDimension(value);
  const resolved = resolveSourceCompany(normalized);
  return resolved ?? normalized.trim().toLowerCase();
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function rate(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

export function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function trendDateExpression(query: AnalyticsQuery) {
  return {
    $dateToString: {
      date: "$report_date",
      format: query.granularity === "day" ? "%Y-%m-%d" : "%Y-%m",
    },
  };
}

function directBookedLeadMatch(query: AnalyticsQuery): PipelineStage.Match[] {
  const match: Record<string, unknown> = {};
  Object.assign(match, dateMatchObject("book_date", query));
  if (query.source) match.source = exactRegex(query.source);
  if (query.merchant) match.merchant = exactRegex(query.merchant);
  if (query.local) match.local = exactRegex(query.local);
  if (query.agent) match["agent_allocations.agent_name_snapshot"] = exactRegex(query.agent);
  if (query.lead_type) match.lead_model = query.lead_type;
  return Object.keys(match).length ? [{ $match: match }] : [];
}

function directCancelledLeadMatch(query: AnalyticsQuery): PipelineStage.Match[] {
  const match: Record<string, unknown> = {};
  Object.assign(match, dateMatchObject("cancel_date", query));
  if (query.source) match.source = exactRegex(query.source);
  if (query.merchant) match.merchant = exactRegex(query.merchant);
  if (query.agent) match.agent = exactRegex(query.agent);
  if (query.lead_type) match.lead_model = query.lead_type;
  return Object.keys(match).length ? [{ $match: match }] : [];
}

function dateMatchObject(field: string, query: AnalyticsQuery): Record<string, unknown> {
  if (!query.from && !query.to) return {};
  const range: Record<string, Date> = {};
  if (query.from) range.$gte = query.from;
  if (query.to) range.$lte = query.to;
  return { [field]: range };
}

function sourceDropdownMatch(
  companyField: string,
  granularityField: string,
  query: AnalyticsQuery,
): PipelineStage.Match[] {
  if (query.source_granularity_key) {
    return sourceGranularityMatch(granularityField, query.source_granularity_key);
  }
  return sourceCompanyMatch(companyField, query.source_company);
}

function sourceCompanyMatch(field: string, value?: string): PipelineStage.Match[] {
  if (!value) return [];
  return [{ $match: { [field]: { $in: sourceCompanyRegexes(value) } } }];
}

export function sourceGranularityMatch(field: string, value?: string): PipelineStage.Match[] {
  if (!value) return [];
  return [{ $match: { [field]: exactRegex(value) } }];
}

function sourceCompanyRegexes(value: string): RegExp[] {
  return sourceCompanyVariants(value).map(exactRegex);
}

function sourceCompanyVariants(value: string): string[] {
  const variants = new Set([value]);
  const resolved = resolveSourceCompany(value);
  if (!resolved) {
    return Array.from(variants).filter(Boolean);
  }
  variants.add(resolved);
  const config = SOURCE_COMPANY_CONFIGS[resolved];
  variants.add(config.label);
  for (const alias of config.aliases) variants.add(alias);
  for (const [label, company] of Object.entries(SOURCE_LABEL_TO_COMPANY)) {
    if (company === resolved) variants.add(label);
  }
  return Array.from(variants).filter(Boolean);
}

function sourceCompanyExpression() {
  const sourceCompany = {
    $ifNull: [
      "$employee_source_snapshot.source_company",
      {
        $ifNull: [
          { $arrayElemAt: ["$form_lead.source_company", 0] },
          {
            $ifNull: [
              { $arrayElemAt: ["$call_lead.source_company", 0] },
              {
                $ifNull: [
                  { $arrayElemAt: ["$form_lead.source_company_label_snapshot", 0] },
                  {
                    $ifNull: [
                      { $arrayElemAt: ["$call_lead.source_company_label_snapshot", 0] },
                      { $ifNull: ["$source", "unknown"] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  return {
    $let: {
      vars: { sourceCompany },
      in: {
        $cond: [
          { $or: [{ $eq: ["$$sourceCompany", null] }, { $eq: ["$$sourceCompany", ""] }] },
          "unknown",
          "$$sourceCompany",
        ],
      },
    },
  };
}

function sourceGranularityLeadClause(
  leadType: "FormLead" | "CallLead",
  submitted: string,
  catalog?: FilterCatalog,
  databaseScope?: AnalyticsQuery["database_scope"],
): Record<string, unknown> {
  const orClauses: Record<string, unknown>[] = [
    { source_granularity_key: exactRegex(submitted) },
    { source_granularity_label_snapshot: exactRegex(submitted) },
    { source_company: exactRegex(submitted) },
  ];
  const row = catalog ? findCatalogGranularity(catalog, submitted) : undefined;
  if (row?.id && isObjectIdString(row.id)) {
    orClauses.push({ source_granularity_id: toObjectId(row.id) });
  }
  const expectedChannel = leadType === "FormLead" ? "form" : "call";
  const historicalScope = databaseScope === "historical" || databaseScope === "combined";
  if (
    historicalScope &&
    row?.company_slug &&
    row.channel === expectedChannel &&
    row.company_slug.trim().toLowerCase() !== submitted.trim().toLowerCase()
  ) {
    orClauses.push({ source_company: exactRegex(row.company_slug) });
  }
  return { $or: orClauses };
}

function sourceGranularityExpression() {
  return {
    $ifNull: [
      "$employee_source_snapshot.source_granularity_key",
      {
        $ifNull: [
          { $arrayElemAt: ["$form_lead.source_granularity_key", 0] },
          {
            $ifNull: [
              { $arrayElemAt: ["$call_lead.source_granularity_key", 0] },
              "$source",
            ],
          },
        ],
      },
    ],
  };
}

function exactRegex(value: string): RegExp {
  return new RegExp(`^${escapeRegex(value.trim())}$`, "i");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
