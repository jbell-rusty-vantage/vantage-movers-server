import mongoose, { type PipelineStage } from "mongoose";
import {
  getCallLeadSourceCompanyLabel,
  getFormLeadSourceCompanyLabel,
  normalizeSourceCompany,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import {
  leadMatch,
  numberValue,
  rate,
  roundMoney,
  trendDateExpression,
  type AnalyticsRow,
} from "./analyticsFilters";

const RECEIVER_AGENT_UNSUPPORTED_METADATA = {
  receiver_agent_scope: "unsupported",
  historical_receiver_agent_supported: false,
  historical_excluded_from_receiver_agent_metrics: true,
  message:
    "Historical lead records do not include receiver_agent attribution. Switch to Production or Combined to view receiver-agent analytics.",
};

export function unsupportedReceiverAgentReport() {
  return {
    items: [],
    metadata: RECEIVER_AGENT_UNSUPPORTED_METADATA,
  };
}

export async function getReceiverAgentPerformance(models: AdminModels, query: AnalyticsQuery) {
  const rows = await receivedLeadRows(models, query, ["receiver_agent_id", "receiver_agent_name", "receiver_agent_group"]);
  return {
    items: rows.map(deriveReceiverRates).sort(receiverPerformanceSort),
    metadata: receiverAgentMetadata(),
  };
}

export async function getReceiverAgentTrend(models: AdminModels, query: AnalyticsQuery) {
  const rows = await receivedLeadRows(models, query, [
    "period",
    "receiver_agent_id",
    "receiver_agent_name",
  ]);
  return {
    items: rows.map(deriveReceiverRates).sort((left, right) => {
      const periodCompare = String(left.period ?? "").localeCompare(String(right.period ?? ""));
      return periodCompare || receiverPerformanceSort(left, right);
    }),
    metadata: receiverAgentMetadata(),
  };
}

export async function getReceiverAgentSourceBreakdown(models: AdminModels, query: AnalyticsQuery) {
  const rows = await receivedLeadRows(models, query, [
    "receiver_agent_id",
    "receiver_agent_name",
    "source_company",
    "source_label",
    "lead_type",
  ]);
  return {
    items: rows.map(deriveReceiverRates).sort(receiverPerformanceSort),
    metadata: receiverAgentMetadata(),
  };
}

async function receivedLeadRows(
  models: AdminModels,
  query: AnalyticsQuery,
  groupFields: string[],
): Promise<AnalyticsRow[]> {
  const [formRows, callRows] = await Promise.all([
    leadRowsForType(models, "FormLead", query, groupFields),
    leadRowsForType(models, "CallLead", query, groupFields),
  ]);
  return mergeReceiverRows([...formRows, ...callRows], groupFields);
}

async function leadRowsForType(
  models: AdminModels,
  leadType: "FormLead" | "CallLead",
  query: AnalyticsQuery,
  groupFields: string[],
): Promise<AnalyticsRow[]> {
  if (query.lead_type && query.lead_type !== leadType) {
    return [];
  }

  const model = leadType === "FormLead" ? models["form-leads"] : models["call-leads"];
  const match = receiverLeadMatch(leadType, query);
  const pipeline: PipelineStage[] = [
    { $match: match },
    ...receiverLeadLookups(leadType),
    {
      $set: {
        period: trendDateExpression(query),
        lead_type: leadType,
        source_company: { $ifNull: ["$source_company", "not_provided"] },
        source_label: sourceLabelExpression(leadType),
        receiver_agent_id: {
          $cond: [
            { $ne: [{ $ifNull: ["$receiver_agent", null] }, null] },
            { $toString: "$receiver_agent" },
            "unassigned",
          ],
        },
        receiver_agent_name: {
          $let: {
            vars: {
              snapshot: { $ifNull: ["$receiver_agent_name_snapshot", ""] },
              agentName: { $ifNull: [{ $arrayElemAt: ["$receiver_agent_doc.name", 0] }, ""] },
            },
            in: {
              $cond: [
                { $ne: ["$$snapshot", ""] },
                "$$snapshot",
                { $cond: [{ $ne: ["$$agentName", ""] }, "$$agentName", "Unassigned"] },
              ],
            },
          },
        },
        receiver_agent_group: {
          $cond: [{ $ne: [{ $ifNull: ["$receiver_agent", null] }, null] }, "assigned", "unassigned"],
        },
        is_billable_received_lead:
          leadType === "FormLead"
            ? { $ne: ["$duplicate", true] }
            : { $ne: ["$created_on_unmatched", true] },
        is_booked_received_lead: {
          $or: [
            { $ne: [{ $ifNull: ["$booked", null] }, null] },
            { $gt: [{ $size: "$booked_lead_docs" }, 0] },
          ],
        },
        is_cancelled_received_lead: {
          $or: [
            { $ne: [{ $ifNull: ["$cancelled", null] }, null] },
            { $ne: [{ $ifNull: [{ $arrayElemAt: ["$booked_lead_docs.cancelled", 0] }, null] }, null] },
            { $gt: [{ $size: "$cancelled_lead_docs" }, 0] },
          ],
        },
      },
    },
    {
      $group: {
        _id: groupId(groupFields),
        received_leads: { $sum: 1 },
        billable_received_leads: { $sum: { $cond: ["$is_billable_received_lead", 1, 0] } },
        form_leads: { $sum: leadType === "FormLead" ? 1 : 0 },
        call_leads: { $sum: leadType === "CallLead" ? 1 : 0 },
        booked_leads: { $sum: { $cond: ["$is_booked_received_lead", 1, 0] } },
        cancelled_leads: { $sum: { $cond: ["$is_cancelled_received_lead", 1, 0] } },
        total_lead_cost: {
          $sum: { $cond: ["$is_billable_received_lead", { $ifNull: ["$cpl", 0] }, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        ...projectGroupFields(groupFields),
        received_leads: 1,
        billable_received_leads: 1,
        form_leads: 1,
        call_leads: 1,
        booked_leads: 1,
        cancelled_leads: 1,
        active_booked_leads: { $max: [{ $subtract: ["$booked_leads", "$cancelled_leads"] }, 0] },
        total_lead_cost: { $round: ["$total_lead_cost", 2] },
      },
    },
  ];

  return model.aggregate(pipeline);
}

function receiverLeadMatch(leadType: "FormLead" | "CallLead", query: AnalyticsQuery): Record<string, unknown> {
  const base = leadMatch(leadType, query);
  const receiverAgent = typeof query.receiver_agent === "string" ? query.receiver_agent.trim() : "";
  if (!receiverAgent) {
    return base;
  }
  const receiverClause = {
    receiver_agent: new mongoose.mongo.ObjectId(receiverAgent),
  };
  if (!Object.keys(base).length) {
    return receiverClause;
  }
  if (Array.isArray(base.$and)) {
    return { $and: [...base.$and, receiverClause] };
  }
  return { $and: [base, receiverClause] };
}

function receiverLeadLookups(leadType: "FormLead" | "CallLead"): PipelineStage[] {
  return [
    {
      $lookup: {
        from: "agents",
        localField: "receiver_agent",
        foreignField: "_id",
        as: "receiver_agent_doc",
      },
    },
    {
      $lookup: {
        from: "booked_leads",
        let: { leadId: "$_id", leadModel: leadType },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$lead_ref", "$$leadId"] },
                  { $eq: ["$lead_model", "$$leadModel"] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "booked_lead_docs",
      },
    },
    {
      $set: {
        derived_booked_lead_id: {
          $ifNull: ["$booked", { $arrayElemAt: ["$booked_lead_docs._id", 0] }],
        },
      },
    },
    {
      $lookup: {
        from: "cancelled_leads",
        let: {
          leadId: "$_id",
          leadModel: leadType,
          bookedLeadId: "$derived_booked_lead_id",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  {
                    $and: [
                      { $eq: ["$lead_ref", "$$leadId"] },
                      { $eq: ["$lead_model", "$$leadModel"] },
                    ],
                  },
                  { $eq: ["$booked_lead", "$$bookedLeadId"] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: "cancelled_lead_docs",
      },
    },
  ];
}

function sourceLabelExpression(leadType: "FormLead" | "CallLead") {
  return {
    $switch: {
      branches: [
        ...sourceLabelBranches(leadType),
      ],
      default: leadType === "FormLead" ? "Main Site Forms" : "Main Site Inbounds",
    },
  };
}

function sourceLabelBranches(leadType: "FormLead" | "CallLead") {
  const sourceCompanies: SourceCompany[] = [
    "tbm_leads",
    "tbm_prime_leads",
    "top10_leads",
    "best_relocation_leads",
    "get_movers_leads",
    "main_site",
    "not_provided",
  ];
  return sourceCompanies.flatMap((sourceCompany) => {
    if (leadType === "CallLead") {
      return [{
        case: { $eq: ["$source_company", sourceCompany] },
        then: getCallLeadSourceCompanyLabel(sourceCompany),
      }];
    }
    if (sourceCompany === "best_relocation_leads") {
      return [
        {
          case: {
            $and: [
              { $eq: ["$source_company", sourceCompany] },
              { $eq: ["$local", "local"] },
            ],
          },
          then: getFormLeadSourceCompanyLabel(sourceCompany, "local"),
        },
        {
          case: { $eq: ["$source_company", sourceCompany] },
          then: getFormLeadSourceCompanyLabel(sourceCompany, "long_distance"),
        },
      ];
    }
    return [{
      case: { $eq: ["$source_company", sourceCompany] },
      then: getFormLeadSourceCompanyLabel(sourceCompany),
    }];
  });
}

function groupId(fields: string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, `$${field}`]));
}

function projectGroupFields(fields: string[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field, `$_id.${field}`]));
}

function mergeReceiverRows(rows: AnalyticsRow[], keyFields: string[]): AnalyticsRow[] {
  const merged = new Map<string, AnalyticsRow>();
  for (const row of rows) {
    const normalizedRow = normalizeSourceRow(row);
    const key = keyFields.map((field) => String(normalizedRow[field] ?? "")).join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...normalizedRow });
      continue;
    }
    for (const field of [
      "received_leads",
      "billable_received_leads",
      "form_leads",
      "call_leads",
      "booked_leads",
      "cancelled_leads",
      "active_booked_leads",
      "total_lead_cost",
    ]) {
      existing[field] = numberValue(existing[field]) + numberValue(normalizedRow[field]);
    }
  }
  return Array.from(merged.values());
}

function normalizeSourceRow(row: AnalyticsRow): AnalyticsRow {
  if (typeof row.source_company !== "string") {
    return row;
  }
  const sourceCompany = normalizeSourceCompany(row.source_company);
  const leadType = row.lead_type;
  const local = typeof row.local === "string" ? (row.local as LocalType) : undefined;
  return {
    ...row,
    source_company: sourceCompany,
    source_label:
      leadType === "FormLead"
        ? getFormLeadSourceCompanyLabel(sourceCompany as SourceCompany, local)
        : getCallLeadSourceCompanyLabel(sourceCompany as SourceCompany),
  };
}

function deriveReceiverRates(row: AnalyticsRow): AnalyticsRow {
  const receivedLeads = numberValue(row.received_leads);
  const billableReceivedLeads = numberValue(row.billable_received_leads);
  const bookedLeads = numberValue(row.booked_leads);
  const cancelledLeads = numberValue(row.cancelled_leads);
  const totalLeadCost = roundMoney(numberValue(row.total_lead_cost));
  return {
    ...row,
    active_booked_leads: Math.max(bookedLeads - cancelledLeads, 0),
    total_lead_cost: totalLeadCost,
    average_cpl: roundMoney(rate(totalLeadCost, billableReceivedLeads)),
    cost_per_received_lead: roundMoney(rate(totalLeadCost, billableReceivedLeads)),
    cost_per_booked_lead: roundMoney(rate(totalLeadCost, bookedLeads)),
    booking_rate: rate(bookedLeads, receivedLeads),
    cancellation_rate: rate(cancelledLeads, bookedLeads),
    receiver_attribution_rate: row.receiver_agent_group === "unassigned" ? 0 : 1,
  };
}

function receiverPerformanceSort(left: AnalyticsRow, right: AnalyticsRow): number {
  return (
    numberValue(right.received_leads) - numberValue(left.received_leads) ||
    numberValue(right.booked_leads) - numberValue(left.booked_leads) ||
    String(left.receiver_agent_name ?? "").localeCompare(String(right.receiver_agent_name ?? ""))
  );
}

function receiverAgentMetadata() {
  return {
    receiver_agent_scope: "production_only",
    historical_receiver_agent_supported: false,
    historical_excluded_from_receiver_agent_metrics: true,
    message: "Historical lead records do not include receiver_agent attribution.",
  };
}
