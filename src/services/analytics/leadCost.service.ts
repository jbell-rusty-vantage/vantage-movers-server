import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import {
  leadMatchForQuery,
  numberValue,
  roundMoney,
  type AnalyticsRow,
} from "./analyticsFilters";
import {
  nestObservedSourceRows,
  sourceCompanyFromRow,
  sourceGranularityFromRow,
} from "./sourceHierarchy";

export type LeadCostResult = {
  total: number;
  unresolved_count: number;
  by_source_company: AnalyticsRow[];
};

async function billableFormLeadMatch(query: AnalyticsQuery): Promise<Record<string, unknown>> {
  const base = await leadMatchForQuery("FormLead", query);
  const duplicateFilter = { duplicate: { $ne: true } };
  if (!Object.keys(base).length) {
    return duplicateFilter;
  }
  if (Array.isArray(base.$and)) {
    return { $and: [...base.$and, duplicateFilter] };
  }
  return { $and: [base, duplicateFilter] };
}

async function billableCallLeadMatch(query: AnalyticsQuery): Promise<Record<string, unknown>> {
  const base = await leadMatchForQuery("CallLead", query);
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
  const supportsSourceGranularity = query.database_scope !== "historical";
  const groupId = supportsSourceGranularity
    ? {
        source_company: "$source_company",
        source_granularity_key: { $ifNull: ["$source_granularity_key", "unknown"] },
      }
    : "$source_company";
  const [formRows, callRows] = await Promise.all([
    models["form-leads"].aggregate([
      { $match: await billableFormLeadMatch(query) },
      {
        $group: {
          _id: groupId,
          lead_count: { $sum: 1 },
          unresolved_cpl_count: {
            $sum: {
              $cond: [
                { $eq: [{ $ifNull: ["$cpl", null] }, null] },
                1,
                0,
              ],
            },
          },
          total_lead_cost: {
            $sum: { $ifNull: ["$cpl", 0] },
          },
        },
      },
    ]),
    models["call-leads"].aggregate([
      { $match: await billableCallLeadMatch(query) },
      {
        $group: {
          _id: groupId,
          lead_count: { $sum: 1 },
          unresolved_cpl_count: {
            $sum: {
              $cond: [
                { $eq: [{ $ifNull: ["$cpl", null] }, null] },
                1,
                0,
              ],
            },
          },
          total_lead_cost: {
            $sum: { $ifNull: ["$cpl", 0] },
          },
        },
      },
    ]),
  ]);

  const bySource = new Map<string, AnalyticsRow>();
  for (const row of [...formRows, ...callRows]) {
    const source = sourceCompanyFromRow(row);
    const granularity = supportsSourceGranularity
      ? sourceGranularityFromRow(row)
      : "";
    const key = `${source}|${granularity}`;
    const existing = bySource.get(key) ?? {
      source_company: source,
      ...(supportsSourceGranularity
        ? { source_granularity_key: granularity }
        : {}),
      lead_count: 0,
      unresolved_cpl_count: 0,
      total_lead_cost: 0,
    };
    existing.lead_count = numberValue(existing.lead_count) + numberValue(row.lead_count);
    existing.unresolved_cpl_count =
      numberValue(existing.unresolved_cpl_count) +
      numberValue(row.unresolved_cpl_count);
    existing.total_lead_cost = numberValue(existing.total_lead_cost) + numberValue(row.total_lead_cost);
    bySource.set(key, existing);
  }

  const leaves = Array.from(bySource.values())
    .map((row) => ({
      source_company: row.source_company,
      ...(supportsSourceGranularity
        ? { source_granularity_key: row.source_granularity_key }
        : {}),
      lead_count: numberValue(row.lead_count),
      unresolved_cpl_count: numberValue(row.unresolved_cpl_count),
      total_lead_cost: roundMoney(numberValue(row.total_lead_cost)),
    }));
  const sort = (left: AnalyticsRow, right: AnalyticsRow) =>
    numberValue(right.total_lead_cost) - numberValue(left.total_lead_cost) ||
    String(left.source_company).localeCompare(String(right.source_company));
  return nestObservedSourceRows(leaves, query, {
    additiveFields: ["lead_count", "unresolved_cpl_count", "total_lead_cost"],
    derive: (row) => ({
      ...row,
      total_lead_cost: roundMoney(numberValue(row.total_lead_cost)),
    }),
    sort,
  });
}

export async function getLeadCost(
  models: AdminModels,
  query: AnalyticsQuery,
): Promise<LeadCostResult> {
  const by_source_company = await leadCostRowsBySource(models, query);
  const total = roundMoney(
    by_source_company.reduce((sum, row) => sum + numberValue(row.total_lead_cost), 0),
  );
  const unresolved_count = by_source_company.reduce(
    (sum, row) => sum + numberValue(row.unresolved_cpl_count),
    0,
  );
  return { total, unresolved_count, by_source_company };
}
