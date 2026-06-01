import type { PipelineStage } from "mongoose";
import { toCsv } from "../../utils/csv";
import type { AgentSalesReportQuery } from "../../validation/v1.validation";
import { getAdminModels } from "../admin/adminScope.service";
import { numberValue, roundMoney } from "./analyticsFilters";

export type AgentSalesReportResult = {
  database_scope: "production";
  from: string;
  to: string;
  agents: string[];
  generated_at: string;
  items: Record<string, unknown>[];
  totals: Record<string, unknown>;
};

const NUMERIC_FIELDS = [
  "leads",
  "booked_deals",
  "active_bookings",
  "cancelled_bookings",
  "total_binder_amount",
  "total_deposit_amount",
] as const;

const CSV_COLUMNS = [
  "agent_name",
  "leads",
  "booked_deals",
  "active_bookings",
  "cancelled_bookings",
  "total_binder_amount",
  "total_deposit_amount",
];

// The Agent Sales report only applies to the production (vantagemovers)
// database. Production form/call leads carry no agent link, so "leads" reflects
// the number of leads each agent booked (one booked deal == one booked lead).
export async function getAgentSalesReport(
  query: AgentSalesReportQuery,
): Promise<AgentSalesReportResult> {
  const models = getAdminModels("production");
  const selected = query.agents ?? [];
  const agentRegexes = selected.map(exactRegex);

  const match: Record<string, unknown> = {
    book_date: { $gte: query.from, $lte: query.to },
  };
  if (agentRegexes.length) {
    match["agent_allocations.agent_name_snapshot"] = { $in: agentRegexes };
  }

  const pipeline: PipelineStage[] = [
    { $match: match },
    { $set: { is_cancelled: { $ne: [{ $ifNull: ["$cancelled", null] }, null] } } },
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
    agentRegexes.length
      ? { $match: { agent_name: { $in: agentRegexes } } }
      : { $match: { agent_name: { $ne: "" } } },
    {
      $group: {
        _id: "$agent_name",
        booked_deals: { $sum: 1 },
        cancelled_bookings: { $sum: { $cond: ["$is_cancelled", 1, 0] } },
        total_binder_amount: { $sum: { $ifNull: ["$agent_allocations.binder_amount", 0] } },
        total_deposit_amount: { $sum: { $ifNull: ["$deposit_amount", 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        agent_name: "$_id",
        leads: "$booked_deals",
        booked_deals: 1,
        cancelled_bookings: 1,
        active_bookings: { $subtract: ["$booked_deals", "$cancelled_bookings"] },
        total_binder_amount: { $round: ["$total_binder_amount", 2] },
        total_deposit_amount: { $round: ["$total_deposit_amount", 2] },
      },
    },
    { $sort: { total_binder_amount: -1, booked_deals: -1, agent_name: 1 } },
  ];

  const items = await models["booked-leads"].aggregate<Record<string, unknown>>(pipeline);

  return {
    database_scope: "production",
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    agents: selected,
    generated_at: new Date().toISOString(),
    items,
    totals: computeTotals(items),
  };
}

export async function exportAgentSalesReportCsv(
  query: AgentSalesReportQuery,
): Promise<{ filename: string; csv: string }> {
  const report = await getAgentSalesReport(query);
  const rows = [
    ...report.items,
    { agent_name: "TOTAL", ...report.totals },
  ];
  return {
    filename: `agent-sales-${report.from.slice(0, 10)}_${report.to.slice(0, 10)}.csv`,
    csv: toCsv(rows, CSV_COLUMNS),
  };
}

function computeTotals(items: Record<string, unknown>[]): Record<string, unknown> {
  const totals: Record<string, number> = {};
  for (const field of NUMERIC_FIELDS) {
    totals[field] = 0;
  }
  for (const item of items) {
    for (const field of NUMERIC_FIELDS) {
      totals[field] += numberValue(item[field]);
    }
  }
  totals.total_binder_amount = roundMoney(totals.total_binder_amount);
  totals.total_deposit_amount = roundMoney(totals.total_deposit_amount);
  return totals;
}

function exactRegex(value: string): RegExp {
  return new RegExp(`^${value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}
