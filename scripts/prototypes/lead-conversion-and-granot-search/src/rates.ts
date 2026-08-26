import type {
  ConversionRate,
  ConversionReport,
  ConversionSlice,
  ReceivedLeadRow,
  SuccessfulSmsLeadRow,
} from "./types.js";
import { SUCCESSFUL_LEAD_MESSAGE_STATUSES } from "./types.js";

export function isSuccessfulLeadMessageStatus(status: string): boolean {
  return (SUCCESSFUL_LEAD_MESSAGE_STATUSES as readonly string[]).includes(
    status,
  );
}

export function conversionRate(
  numerator: number,
  denominator: number,
): ConversionRate {
  const rate = denominator === 0 ? 0 : numerator / denominator;
  return {
    numerator,
    denominator,
    rate,
    percent: Math.round(rate * 10000) / 100,
  };
}

export function uniqueSuccessfulSmsLeads(
  rows: ReadonlyArray<SuccessfulSmsLeadRow>,
): SuccessfulSmsLeadRow[] {
  const byLead = new Map<string, SuccessfulSmsLeadRow>();
  for (const row of rows) {
    if (!row.lead_id) continue;
    const existing = byLead.get(row.lead_id);
    if (!existing) {
      byLead.set(row.lead_id, row);
      continue;
    }
    byLead.set(row.lead_id, {
      ...existing,
      booked: existing.booked || row.booked,
      cancelled: existing.cancelled || row.cancelled,
    });
  }
  return [...byLead.values()];
}

function sliceFromLeads(
  key: string,
  rows: ReadonlyArray<{ booked: boolean; cancelled: boolean }>,
): ConversionSlice {
  const booked = rows.filter((row) => row.booked).length;
  const cancelled = rows.filter((row) => row.cancelled).length;
  return {
    key,
    leads: rows.length,
    booked,
    cancelled,
    booked_of_leads: conversionRate(booked, rows.length),
    cancelled_of_leads: conversionRate(cancelled, rows.length),
  };
}

export function computeConversionReport(input: {
  sms_leads: ReadonlyArray<SuccessfulSmsLeadRow>;
  received_leads: ReadonlyArray<ReceivedLeadRow>;
  unassigned_official_cancellations?: number;
}): ConversionReport {
  const smsLeads = uniqueSuccessfulSmsLeads(input.sms_leads);
  const origins = [...new Set(smsLeads.map((row) => row.origin))].sort();
  const models = ["FormLead", "CallLead"] as const;

  const notes = [
    "Successful text = Lead Message status accepted | sent | delivered.",
    "Booked and Cancelled rates use the cohort as the denominator, not booked as the cancelled denominator.",
    "Received by an agent means receiver_agent is set. Unassigned Leads are excluded.",
  ];
  if (
    typeof input.unassigned_official_cancellations === "number" &&
    input.unassigned_official_cancellations > 0
  ) {
    notes.push(
      `${input.unassigned_official_cancellations} official Cancellation(s) sit on Leads with no receiver_agent and are outside the assigned cohort.`,
    );
  }

  return {
    sms_successfully_sent_then_booked: sliceFromLeads("all", smsLeads),
    sms_by_origin: origins.map((origin) =>
      sliceFromLeads(
        origin,
        smsLeads.filter((row) => row.origin === origin),
      ),
    ),
    received_by_agent: sliceFromLeads("all", input.received_leads),
    received_by_agent_by_lead_model: models.map((leadModel) =>
      sliceFromLeads(
        leadModel,
        input.received_leads.filter((row) => row.lead_model === leadModel),
      ),
    ),
    notes,
  };
}
