import type { HydratedDocument } from "mongoose";
import type { CallLeadDocument } from "../../models/CallLead";

export type CallLeadSourceParsedRow = {
  source_company?: string;
  source_label?: string;
  source_assignment?: {
    lead_source_company?: unknown;
    source_granularity_key?: string;
    source_company?: string;
    crm_source_label_snapshot?: string;
    source_granularity_label_snapshot?: string;
    source_company_label_snapshot?: string;
  };
};

export function isUnassignedSource(sourceCompany: unknown): boolean {
  return !sourceCompany || sourceCompany === "not_provided";
}

export function isLeadSourceCompatible(
  lead: HydratedDocument<CallLeadDocument>,
  parsed: CallLeadSourceParsedRow,
): boolean {
  if (isUnassignedSource(lead.source_company)) {
    return true;
  }
  if (
    parsed.source_assignment?.lead_source_company &&
    lead.lead_source_company &&
    String(lead.lead_source_company) === String(parsed.source_assignment.lead_source_company)
  ) {
    return true;
  }
  if (
    parsed.source_assignment?.source_granularity_key &&
    lead.source_granularity_key === parsed.source_assignment.source_granularity_key
  ) {
    return true;
  }
  return Boolean(parsed.source_company && lead.source_company === parsed.source_company);
}

export function sourceDisplayLabel(parsed: CallLeadSourceParsedRow): string {
  return (
    parsed.source_assignment?.crm_source_label_snapshot ??
    parsed.source_assignment?.source_granularity_label_snapshot ??
    parsed.source_assignment?.source_company_label_snapshot ??
    parsed.source_label ??
    parsed.source_company ??
    "unknown"
  );
}

export function leadSourceDisplayLabel(lead: HydratedDocument<CallLeadDocument>): string {
  return (
    lead.crm_source_label_snapshot ??
    lead.source_granularity_label_snapshot ??
    lead.source_company_label_snapshot ??
    lead.source_granularity_key ??
    lead.source_company ??
    "unknown"
  );
}

export function buildAssignedSourceConflict(
  lead: HydratedDocument<CallLeadDocument>,
  parsed: CallLeadSourceParsedRow,
): string | undefined {
  if (!parsed.source_company || isLeadSourceCompatible(lead, parsed)) {
    return undefined;
  }
  const existing = leadSourceDisplayLabel(lead);
  return `Matched call lead has source ${existing}; CRM row source maps to ${sourceDisplayLabel(parsed)}.`;
}
