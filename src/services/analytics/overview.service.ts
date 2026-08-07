import type { AdminDatabaseScope } from "../../validation/v1.validation";
import type { OverviewQuery } from "../../validation/v1/analytics.validation";
import { analyticsQuerySchema } from "../../validation/v1.validation";
import {
  concreteScopes,
  getAdminModels,
  type AdminModels,
  type ConcreteAdminScope,
} from "../admin/adminScope.service";
import { getTopAgentsByDeposit } from "./agentPerformance.service";
import { bookedLeadPrefix, type AnalyticsRow } from "./analyticsFilters";
import { mergeAnalyticsPayload, mergeRows, type AnalyticsPayload } from "./analyticsMerge";
import { getLeadCost, type LeadCostResult } from "./leadCost.service";
import { getSummary } from "./summary.service";
import {
  loadProductionSourceLabelIndex,
  nestSourceCompanyRows,
  type SourceLabelIndex,
} from "./sourceHierarchy";

export type OverviewPeriod = {
  from: string;
  to: string;
};

export type OverviewTotals = AnalyticsRow;

export type OverviewAllTime = {
  totals: OverviewTotals;
  lead_cost: LeadCostResult | null;
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
  database_scope: AdminDatabaseScope;
  generated_at: string;
  all_time: OverviewAllTime;
  last_7_days: OverviewLast7Days | null;
};

export function rollingLast7DaysWindow(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export async function getOverviewReport(query: OverviewQuery): Promise<OverviewResponse> {
  const scopes = concreteScopes(query.database_scope);
  const sourceLabels =
    query.database_scope === "production"
      ? await loadProductionSourceLabelIndex()
      : undefined;
  const allTimePayloads = await Promise.all(
    scopes.map((scope) =>
      buildAllTimeSection(
        getAdminModels(scope),
        scope,
        query.database_scope,
        sourceLabels,
      ),
    ),
  );
  const all_time = mergeOverviewAllTime(allTimePayloads, query.database_scope);

  let last_7_days: OverviewLast7Days | null = null;
  if (query.database_scope === "production") {
    const { from, to } = rollingLast7DaysWindow();
    const rangeQuery = analyticsQuerySchema.parse({
      database_scope: "production",
      from: from.toISOString(),
      to: to.toISOString(),
    });
    last_7_days = await buildLast7DaysSection(
      getAdminModels("production"),
      rangeQuery,
      { from, to },
      sourceLabels!,
    );
  }

  return {
    database_scope: query.database_scope,
    generated_at: new Date().toISOString(),
    all_time,
    last_7_days,
  };
}

async function buildAllTimeSection(
  models: AdminModels,
  scope: ConcreteAdminScope,
  requestedScope: AdminDatabaseScope,
  sourceLabels?: SourceLabelIndex,
): Promise<OverviewAllTime> {
  const emptyQuery = analyticsQuerySchema.parse({ database_scope: scope });
  const [summary, topAgents] = await Promise.all([
    getSummary(models, emptyQuery),
    getTopAgentsByDeposit(models, emptyQuery, 5),
  ]);

  const lead_cost =
    requestedScope === "production" && scope === "production"
      ? await getLeadCost(models, emptyQuery, sourceLabels)
      : null;

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
  sourceLabels: SourceLabelIndex,
): Promise<OverviewLast7Days> {
  const [summary, by_source_company, lead_cost, top_agents] = await Promise.all([
    getSummary(models, query),
    getSalesBySourceCompany(models, query, sourceLabels),
    getLeadCost(models, query, sourceLabels),
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
  sourceLabels: SourceLabelIndex,
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
  return nestSourceCompanyRows(leaves, sourceLabels, {
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

export function mergeOverviewAllTime(
  payloads: OverviewAllTime[],
  requestedScope: AdminDatabaseScope,
): OverviewAllTime {
  if (payloads.length === 1) {
    return {
      ...payloads[0],
      lead_cost: requestedScope === "production" ? payloads[0].lead_cost : null,
    };
  }

  const mergedTotals = mergeSummaryTotals(payloads.map((payload) => ({ totals: payload.totals })));
  const top_agents = mergeRows(
    payloads.flatMap((payload) => payload.top_agents),
    ["agent_name"],
  ).slice(0, 5);

  return {
    totals: mergedTotals,
    lead_cost: null,
    top_agents,
  };
}

function mergeSummaryTotals(payloads: AnalyticsPayload[]): OverviewTotals {
  const merged = mergeAnalyticsPayload("summary", payloads);
  return (merged.totals ?? {}) as OverviewTotals;
}
