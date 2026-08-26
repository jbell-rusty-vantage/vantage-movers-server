import type { PipelineStage } from "mongoose";
import { SUCCESSFUL_LEAD_MESSAGE_STATUSES } from "../../config/domain";
import { getLeadMessageModel } from "../../models/LeadMessage";
import type { AnalyticsQuery } from "../../validation/v1.validation";
import type { AdminModels } from "../admin/adminScope.service";
import {
  leadMatchForQuery,
  numberValue,
  rate,
  type AnalyticsRow,
} from "./analyticsFilters";

const SMS_CONVERSION_UNSUPPORTED_METADATA = {
  sms_conversion_scope: "unsupported",
  historical_sms_conversion_supported: false,
  historical_excluded_from_sms_conversion_metrics: true,
  message:
    "Lead Messages live on production only. Switch to Production or Combined to view the texted-lead booking rate.",
} as const;

const SMS_CONVERSION_PRODUCTION_METADATA = {
  sms_conversion_scope: "production_only",
  historical_sms_conversion_supported: false,
  historical_excluded_from_sms_conversion_metrics: true,
  message: "This rate counts production Leads that successfully received a confirmation text.",
} as const;

export type SmsConversionOriginRow = {
  origin: string;
  texted_leads: number;
  booked_leads: number;
};

export type SmsConversionItem = AnalyticsRow & {
  origin: string;
  label: string;
  texted_leads: number;
  booked_leads: number;
  not_booked_leads: number;
  booking_rate: number;
};

export function unsupportedSmsConversionReport() {
  return {
    items: [] as SmsConversionItem[],
    metadata: SMS_CONVERSION_UNSUPPORTED_METADATA,
  };
}

export function smsConversionOriginLabel(origin: string): string {
  if (origin === "all") return "All";
  if (origin === "public_form") return "Public form";
  if (origin === "granot_lead_created") return "Granot lead created";
  const trimmed = origin.trim();
  if (!trimmed) return "Unknown";
  return trimmed.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function smsConversionFromOriginRows(
  rows: ReadonlyArray<SmsConversionOriginRow>,
): { items: SmsConversionItem[]; metadata: typeof SMS_CONVERSION_PRODUCTION_METADATA } {
  const origins = rows
    .map((row) => toItem(row.origin, numberValue(row.texted_leads), numberValue(row.booked_leads)))
    .filter((row) => row.texted_leads > 0)
    .sort((left, right) => right.texted_leads - left.texted_leads || left.label.localeCompare(right.label));
  const texted = origins.reduce((sum, row) => sum + row.texted_leads, 0);
  const booked = origins.reduce((sum, row) => sum + row.booked_leads, 0);
  return {
    items: [toItem("all", texted, booked), ...origins],
    metadata: SMS_CONVERSION_PRODUCTION_METADATA,
  };
}

export async function getSmsSuccessfullySentThenBooked(
  models: AdminModels,
  query: AnalyticsQuery,
) {
  const LeadMessage = getLeadMessageModel();
  const leadMatch = await joinedLeadMatch(query);
  const formCollection = models["form-leads"].collection.collectionName;
  const callCollection = models["call-leads"].collection.collectionName;
  const includeForm = !query.lead_type || query.lead_type === "FormLead";
  const includeCall = !query.lead_type || query.lead_type === "CallLead";

  const pipeline: PipelineStage[] = [
    { $match: { status: { $in: [...SUCCESSFUL_LEAD_MESSAGE_STATUSES] } } },
    {
      $set: {
        joined_lead_id: { $ifNull: ["$lead_ref.id", "$form_lead"] },
      },
    },
    { $match: { joined_lead_id: { $ne: null } } },
    ...(includeForm
      ? [
          {
            $lookup: {
              from: formCollection,
              localField: "joined_lead_id",
              foreignField: "_id",
              as: "form",
            },
          } satisfies PipelineStage,
        ]
      : [{ $set: { form: [] } } satisfies PipelineStage]),
    ...(includeCall
      ? [
          {
            $lookup: {
              from: callCollection,
              localField: "joined_lead_id",
              foreignField: "_id",
              as: "call",
            },
          } satisfies PipelineStage,
        ]
      : [{ $set: { call: [] } } satisfies PipelineStage]),
    {
      $set: {
        lead: {
          $ifNull: [{ $arrayElemAt: ["$form", 0] }, { $arrayElemAt: ["$call", 0] }],
        },
      },
    },
    { $match: { lead: { $ne: null } } },
    ...(leadMatch ? [{ $match: leadMatch } satisfies PipelineStage] : []),
    {
      $group: {
        _id: "$lead._id",
        origin: { $first: { $ifNull: ["$origin", "unknown"] } },
        booked: {
          $max: {
            $cond: [{ $ne: [{ $ifNull: ["$lead.booked", null] }, null] }, 1, 0],
          },
        },
      },
    },
    {
      $group: {
        _id: "$origin",
        texted_leads: { $sum: 1 },
        booked_leads: { $sum: "$booked" },
      },
    },
    {
      $project: {
        _id: 0,
        origin: "$_id",
        texted_leads: 1,
        booked_leads: 1,
      },
    },
  ];

  const rows = await LeadMessage.aggregate<SmsConversionOriginRow>(pipeline);
  return smsConversionFromOriginRows(rows);
}

async function joinedLeadMatch(
  query: AnalyticsQuery,
): Promise<Record<string, unknown> | undefined> {
  const leadType = query.lead_type === "CallLead" ? "CallLead" : "FormLead";
  const match = await leadMatchForQuery(leadType, {
    ...query,
    lead_type: undefined,
  });
  if (!Object.keys(match).length) return undefined;
  return prefixMatchKeys(match, "lead.");
}

function prefixMatchKeys(
  match: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(match)) {
    if (key === "$and" || key === "$or" || key === "$nor") {
      next[key] = Array.isArray(value)
        ? value.map((clause) =>
            clause && typeof clause === "object" && !Array.isArray(clause)
              ? prefixMatchKeys(clause as Record<string, unknown>, prefix)
              : clause,
          )
        : value;
      continue;
    }
    next[key.startsWith("$") ? key : `${prefix}${key}`] = value;
  }
  return next;
}

function toItem(origin: string, texted: number, booked: number): SmsConversionItem {
  return {
    origin,
    label: smsConversionOriginLabel(origin),
    texted_leads: texted,
    booked_leads: booked,
    not_booked_leads: Math.max(texted - booked, 0),
    booking_rate: rate(booked, texted),
  };
}
