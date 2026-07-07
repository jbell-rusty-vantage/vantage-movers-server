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

export async function getAgentBrowseMetrics(
  models: AdminModels,
  query: AdminBrowseQuery,
  agentNames: string[],
): Promise<Map<string, AgentBrowseMetrics>> {
  const uniqueNames = uniqueAgentNames(agentNames);
  if (!uniqueNames.length) {
    return new Map();
  }

  const rows = await models["booked-leads"].aggregate<AgentMetricRow>([
    ...bookedLeadPrefix(toAnalyticsCompatibleQuery(query)),
    { $unwind: "$agent_allocations" },
    {
      $set: {
        agent_name: {
          $cond: [
            {
              $or: [
                { $eq: ["$agent_allocations.agent_name_snapshot", null] },
                { $eq: ["$agent_allocations.agent_name_snapshot", ""] },
              ],
            },
            "unknown",
            "$agent_allocations.agent_name_snapshot",
          ],
        },
      },
    },
    { $match: { agent_name: { $in: uniqueNames.map(exactCaseInsensitivePattern) } } },
    {
      $group: {
        _id: { $toLower: "$agent_name" },
        booking_count: { $sum: 1 },
        cancellation_count: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$agent_allocations.binder_amount", 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
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
  ] as PipelineStage[]);

  return new Map(rows.map((row) => [row.agent_key, toMetricFields(row)]));
}

export function emptyAgentBrowseMetrics(): AgentBrowseMetrics {
  return { ...EMPTY_AGENT_METRICS };
}

export function normalizeAgentMetricKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

function uniqueAgentNames(agentNames: string[]): string[] {
  const namesByKey = new Map<string, string>();
  for (const name of agentNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = normalizeAgentMetricKey(trimmed);
    if (!namesByKey.has(key)) {
      namesByKey.set(key, trimmed);
    }
  }
  return Array.from(namesByKey.values());
}

function exactCaseInsensitivePattern(value: string): RegExp {
  return new RegExp(`^${escapeRegex(value)}$`, "i");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
