import { analyticsQuerySchema } from "../../validation/v1.validation";
import { getAdminModels, type AdminModels } from "../admin/adminScope.service";
import { getTopAgentsByDeposit } from "./agentPerformance.service";
import { bookedLeadPrefix, type AnalyticsRow } from "./analyticsFilters";
import { getLeadCost, type LeadCostResult } from "./leadCost.service";
import { getSummary } from "./summary.service";
import { nestObservedSourceRows } from "./sourceHierarchy";

export type OverviewPeriod = {
  from: string;
  to: string;
};

export type OverviewTotals = AnalyticsRow;

export type OverviewAllTime = {
  totals: OverviewTotals;
  lead_cost: LeadCostResult;
  top_agents: AnalyticsRow[];
};

export type OverviewLast7Days = {
  period: OverviewPeriod;
  totals: OverviewTotals;
  by_source_company: AnalyticsRow[];
  lead_cost: LeadCostResult;
  top_agents: AnalyticsRow[];
};

export type OverviewResponse = {
  generated_at: string;
  all_time: OverviewAllTime;
  last_7_days: OverviewLast7Days;
};

export function rollingLast7DaysWindow(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export async function getOverviewReport(): Promise<OverviewResponse> {
  const models = getAdminModels();
  const { from, to } = rollingLast7DaysWindow();
  const rangeQuery = analyticsQuerySchema.parse({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const all_time = await buildAllTimeSection(models);
  const last_7_days = await buildLast7DaysSection(models, rangeQuery, { from, to });

  return {
    generated_at: new Date().toISOString(),
    all_time,
    last_7_days,
  };
}

async function buildAllTimeSection(models: AdminModels): Promise<OverviewAllTime> {
  const emptyQuery = analyticsQuerySchema.parse({});
  const [summary, topAgents, lead_cost] = await Promise.all([
    getSummary(models, emptyQuery),
    getTopAgentsByDeposit(models, emptyQuery, 5),
    getLeadCost(models, emptyQuery),
  ]);

  return {
    totals: (summary.totals ?? {}) as OverviewTotals,
    lead_cost,
    top_agents: topAgents,
  };
}

async function buildLast7DaysSection(
  models: AdminModels,
  query: ReturnType<typeof analyticsQuerySchema.parse>,
  window: { from: Date; to: Date },
): Promise<OverviewLast7Days> {
  const [summary, by_source_company, lead_cost, top_agents] = await Promise.all([
    getSummary(models, query),
    getSalesBySourceCompany(models, query),
    getLeadCost(models, query),
    getTopAgentsByDeposit(models, query, 5),
  ]);

  return {
    period: {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    },
    totals: (summary.totals ?? {}) as OverviewTotals,
    by_source_company,
    lead_cost,
    top_agents,
  };
}

async function getSalesBySourceCompany(
  models: AdminModels,
  query: ReturnType<typeof analyticsQuerySchema.parse>,
): Promise<AnalyticsRow[]> {
  const leaves = await models["booked-leads"].aggregate([
    ...bookedLeadPrefix(query),
    {
      $group: {
        _id: {
          source_company: "$derived_source_company",
          source_granularity_key: {
            $ifNull: ["$derived_source_granularity_key", "unknown"],
          },
        },
        bookings: { $sum: 1 },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
      },
    },
  ]);
  return nestObservedSourceRows(leaves, query, {
    additiveFields: ["bookings", "total_deposit_amount"],
    derive: (row) => ({
      ...row,
      total_deposit_amount:
        Math.round((Number(row.total_deposit_amount ?? 0) + Number.EPSILON) * 100) / 100,
    }),
    sort: (left, right) =>
      Number(right.total_deposit_amount) - Number(left.total_deposit_amount) ||
      Number(right.bookings) - Number(left.bookings) ||
      left.source_company.localeCompare(right.source_company),
  });
}
