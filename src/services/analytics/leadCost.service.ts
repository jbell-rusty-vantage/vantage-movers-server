import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import {
  leadMatch,
  normalizeSourceDimension,
  numberValue,
  roundMoney,
  type AnalyticsRow,
} from "./analyticsFilters";

export type LeadCostResult = {
  total: number;
  by_source_company: AnalyticsRow[];
};

function billableFormLeadMatch(query: AnalyticsQuery): Record<string, unknown> {
  const base = leadMatch("FormLead", query);
  const duplicateFilter = { duplicate: { $ne: true } };
  if (!Object.keys(base).length) {
    return duplicateFilter;
  }
  if (Array.isArray(base.$and)) {
    return { $and: [...base.$and, duplicateFilter] };
  }
  return { $and: [base, duplicateFilter] };
}

function billableCallLeadMatch(query: AnalyticsQuery): Record<string, unknown> {
  const base = leadMatch("CallLead", query);
  const unmatchedFilter = { created_on_unmatched: { $ne: true } };
  if (!Object.keys(base).length) {
    return unmatchedFilter;
  }
  if (Array.isArray(base.$and)) {
    return { $and: [...base.$and, unmatchedFilter] };
  }
  return { $and: [base, unmatchedFilter] };
}

async function leadCostRowsBySource(
  models: AdminModels,
  query: AnalyticsQuery,
): Promise<AnalyticsRow[]> {
  const [formRows, callRows] = await Promise.all([
    models["form-leads"].aggregate([
      { $match: billableFormLeadMatch(query) },
      {
        $group: {
          _id: "$source_company",
          lead_count: { $sum: 1 },
          total_lead_cost: { $sum: { $ifNull: ["$cpl", 0] } },
        },
      },
    ]),
    models["call-leads"].aggregate([
      { $match: billableCallLeadMatch(query) },
      {
        $group: {
          _id: "$source_company",
          lead_count: { $sum: 1 },
          total_lead_cost: { $sum: { $ifNull: ["$cpl", 0] } },
        },
      },
    ]),
  ]);

  const bySource = new Map<string, AnalyticsRow>();
  for (const row of [...formRows, ...callRows]) {
    const source = normalizeSourceDimension(row._id);
    const existing = bySource.get(source) ?? {
      source_company: source,
      lead_count: 0,
      total_lead_cost: 0,
    };
    existing.lead_count = numberValue(existing.lead_count) + numberValue(row.lead_count);
    existing.total_lead_cost = numberValue(existing.total_lead_cost) + numberValue(row.total_lead_cost);
    bySource.set(source, existing);
  }

  return Array.from(bySource.values())
    .map((row) => ({
      source_company: row.source_company,
      lead_count: numberValue(row.lead_count),
      total_lead_cost: roundMoney(numberValue(row.total_lead_cost)),
    }))
    .sort(
      (left, right) =>
        numberValue(right.total_lead_cost) - numberValue(left.total_lead_cost) ||
        String(left.source_company).localeCompare(String(right.source_company)),
    );
}

export async function getLeadCost(models: AdminModels, query: AnalyticsQuery): Promise<LeadCostResult> {
  const by_source_company = await leadCostRowsBySource(models, query);
  const total = roundMoney(
    by_source_company.reduce((sum, row) => sum + numberValue(row.total_lead_cost), 0),
  );
  return { total, by_source_company };
}
