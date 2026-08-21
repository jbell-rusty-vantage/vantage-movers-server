import { DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE } from "../../src/services/leadMessaging/granotCreatedLead.js";

export const CRM_SOURCE_OUTBOUND_SMS_SCRIPT_VERSION = "granot-crm-source-outbound-sms-v1";

export const DEFAULT_CRM_SOURCE_OUTBOUND_SMS = {
  enabled: false,
  trigger: "granot_lead_created" as const,
  body_template: DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE,
  template_version: 1,
  consent_basis: "not_attested" as const,
  daily_cap: 0,
};

export type CrmSourceOutboundSmsInventoryRow = {
  id: string;
  granot_label: string;
  has_outbound_sms: boolean;
  enabled: boolean;
};

export function needsOutboundSmsBackfill(row: { outbound_sms?: unknown }): boolean {
  return !row.outbound_sms || typeof row.outbound_sms !== "object";
}

export function summarizeOutboundSmsInventory(
  rows: CrmSourceOutboundSmsInventoryRow[],
): {
  total: number;
  missing_outbound_sms: number;
  already_configured: number;
  enabled: number;
} {
  return {
    total: rows.length,
    missing_outbound_sms: rows.filter((row) => !row.has_outbound_sms).length,
    already_configured: rows.filter((row) => row.has_outbound_sms).length,
    enabled: rows.filter((row) => row.enabled).length,
  };
}

export function toInventoryRow(row: Record<string, unknown>): CrmSourceOutboundSmsInventoryRow {
  const outbound =
    row.outbound_sms && typeof row.outbound_sms === "object"
      ? (row.outbound_sms as Record<string, unknown>)
      : null;
  return {
    id: String(row._id ?? row.id ?? ""),
    granot_label: String(row.granot_label ?? ""),
    has_outbound_sms: outbound !== null,
    enabled: outbound?.enabled === true,
  };
}
