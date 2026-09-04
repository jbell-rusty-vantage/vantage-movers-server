import type { PipelineStage } from "mongoose";
import type { AdminBrowseQuery } from "../../validation/v1.validation";
import { bookedLeadPrefix } from "../analytics/analyticsFilters";
import type { AdminModels } from "./adminScope.service";

export type AgentBrowseMetrics = {
  booking_count: number;
  total_binder_amount: number;
  total_deposit_amount: number;
  cancellation_count: number;
  cancellation_rate: number;
};

const EMPTY_AGENT_METRICS: AgentBrowseMetrics = {
  booking_count: 0,
  total_binder_amount: 0,
  total_deposit_amount: 0,
  cancellation_count: 0,
  cancellation_rate: 0,
};

type AgentMetricRow = AgentBrowseMetrics & {
  agent_key: string;
};

type AgentNameFields = {
  name?: unknown;
  normalized_name?: unknown;
};

export async function getAgentBrowseMetrics(
  models: AdminModels,
  query: AdminBrowseQuery,
  agentNames: string[],
): Promise<Map<string, AgentBrowseMetrics>> {
  const matchKeys = uniqueLowercasedAgentNames(agentNames);
  if (!matchKeys.length) {
    return new Map();
  }

  const rows = await models["booked-leads"].aggregate<AgentMetricRow>(
    buildAgentBrowseMetricsPipeline(query, matchKeys) as PipelineStage[],
  );

  return new Map(rows.map((row) => [row.agent_key, toMetricFields(row)]));
}

export function buildAgentBrowseMetricsPipeline(
  query: AdminBrowseQuery,
  matchKeys: string[],
): PipelineStage[] {
  return [
    ...bookedLeadPrefix(toAnalyticsCompatibleQuery(query)),
    { $unwind: "$agent_allocations" },
    {
      $set: {
        agent_key: {
          $toLower: {
            $trim: {
              input: { $ifNull: ["$agent_allocations.agent_name_snapshot", ""] },
            },
          },
        },
      },
    },
    { $match: { agent_key: { $in: matchKeys } } },
    {
      $group: {
        _id: { agent_key: "$agent_key", booking_id: "$_id" },
        total_binder_amount: { $sum: { $ifNull: ["$agent_allocations.binder_amount", 0] } },
        deposit_amount: { $first: { $ifNull: ["$deposit_amount", 0] } },
        is_cancelled: { $max: { $cond: ["$is_cancelled", 1, 0] } },
      },
    },
    {
      $group: {
        _id: "$_id.agent_key",
        booking_count: { $sum: 1 },
        cancellation_count: { $sum: "$is_cancelled" },
        total_binder_amount: { $sum: "$total_binder_amount" },
        total_deposit_amount: { $sum: "$deposit_amount" },
      },
    },
    {
      $project: {
        _id: 0,
        agent_key: "$_id",
        booking_count: 1,
        cancellation_count: 1,
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
        cancellation_rate: {
          $cond: [{ $eq: ["$booking_count", 0] }, 0, { $divide: ["$cancellation_count", "$booking_count"] }],
        },
      },
    },
  ];
}

export function emptyAgentBrowseMetrics(): AgentBrowseMetrics {
  return { ...EMPTY_AGENT_METRICS };
}

export function normalizeAgentMetricKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function collectAgentMatchNames(item: AgentNameFields): string[] {
  const names: string[] = [];
  if (typeof item.name === "string") names.push(item.name);
  if (typeof item.normalized_name === "string") names.push(item.normalized_name);
  return names;
}

export function lookupAgentBrowseMetrics(
  metricsByAgent: Map<string, AgentBrowseMetrics>,
  item: AgentNameFields,
): AgentBrowseMetrics {
  for (const name of collectAgentMatchNames(item)) {
    const metrics = metricsByAgent.get(normalizeAgentMetricKey(name));
    if (metrics) return metrics;
  }
  return emptyAgentBrowseMetrics();
}

export function uniqueLowercasedAgentNames(agentNames: string[]): string[] {
  const keys = new Set<string>();
  for (const name of agentNames) {
    const key = normalizeAgentMetricKey(name);
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

function toMetricFields(row: AgentMetricRow): AgentBrowseMetrics {
  return {
    booking_count: numberValue(row.booking_count),
    total_binder_amount: numberValue(row.total_binder_amount),
    total_deposit_amount: numberValue(row.total_deposit_amount),
    cancellation_count: numberValue(row.cancellation_count),
    cancellation_rate: numberValue(row.cancellation_rate),
  };
}

function toAnalyticsCompatibleQuery(query: AdminBrowseQuery) {
  return {
    database_scope: query.database_scope,
    from: query.from,
    to: query.to,
    source_company: query.source_company,
    source_granularity_key: query.source_granularity_key,
    source: query.source,
    agent: query.agent,
    merchant: query.merchant,
    local: query.local,
    lead_type: undefined,
    granularity: "month" as const,
  };
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
