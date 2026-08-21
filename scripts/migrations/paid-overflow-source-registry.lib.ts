import { GRANOT_LIFECYCLE_SOURCE_POLICY_VERSION } from "./granot-lifecycle-source-registry.manifest";

export const PAID_OVERFLOW_MIGRATION_SCRIPT_VERSION =
  "paid-overflow-source-registry/1";

export const PAID_OVERFLOW_MIGRATION_ACTOR_ID = "paid-overflow-source-registry";

export const PAID_OVERFLOW_APPLY_REASON =
  "Create Paid Overflow Source Company, Source Granularity, and Granot CRM Source with create_if_missing and confirmation SMS.";

export const PAID_OVERFLOW_SMS_REASON =
  "Enable Granot lead_created confirmation texts for Paid Overflow.";

export const PAID_OVERFLOW_SOURCE = {
  company_slug: "paid_overflow",
  name: "Paid Overflow",
  owner_label: "Paid Overflow",
  aliases: ["Paid Overflow", "paid overflow", "paid_overflow"],
  granularity_key: "paid_overflow",
  granularity_owner_label: "Paid Overflow",
  granularity_crm_label: "Paid Overflow",
  granularity_aliases: ["Paid Overflow"],
  channel: "form",
  granot_label: "Paid Overflow",
  workspace_slug: "paid-overflow",
  default_channel: "form",
  source_company_label: "paid_overflow",
  lifecycle_enabled: true,
  lifecycle_disposition: "source_scoped_lead",
  lead_created_policy: "create_if_missing",
  lifecycle_policy_version: GRANOT_LIFECYCLE_SOURCE_POLICY_VERSION,
  route_key: "form_any",
  lead_model: "FormLead",
  move_type: "any",
  sms_consent_basis: "customer_submitted_form",
  cpl_amount: 0,
  cpl_start_date: "2026-01-01",
  notes:
    "Paid Overflow. Master Sheets only. No Forms/Inbounds split. FormLead + any so local or long-distance can arrive.",
} as const;
