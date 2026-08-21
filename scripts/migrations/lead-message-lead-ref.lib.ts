export const LEAD_MESSAGE_LEAD_REF_SCRIPT_VERSION = "lead-message-lead-ref-v1";

export type LeadMessageLeadRefInventoryRow = {
  id: string;
  has_form_lead: boolean;
  has_lead_ref: boolean;
  form_lead?: string;
  lead_ref_id?: string;
  origin?: string;
};

export function needsLeadRefBackfill(row: {
  lead_ref?: { id?: unknown } | null;
}): boolean {
  return !row.lead_ref?.id;
}

export function leadRefBackfillUpdate(formLeadId: unknown): {
  lead_ref: { model: "FormLead"; id: unknown };
  origin: "public_form";
} {
  return {
    lead_ref: { model: "FormLead", id: formLeadId },
    origin: "public_form",
  };
}

export function leadRefMatchesFormLead(row: {
  form_lead?: unknown;
  lead_ref?: { id?: unknown } | null;
}): boolean {
  if (!row.form_lead || !row.lead_ref?.id) return true;
  return String(row.form_lead) === String(row.lead_ref.id);
}

export function summarizeLeadRefInventory(rows: LeadMessageLeadRefInventoryRow[]): {
  total: number;
  missing_lead_ref: number;
  orphaned_form_lead: number;
  mismatched_lead_ref: number;
} {
  return {
    total: rows.length,
    missing_lead_ref: rows.filter((row) => !row.has_lead_ref).length,
    orphaned_form_lead: rows.filter((row) => !row.has_form_lead).length,
    mismatched_lead_ref: rows.filter(
      (row) =>
        row.has_form_lead &&
        row.has_lead_ref &&
        row.form_lead !== row.lead_ref_id,
    ).length,
  };
}

export function toLeadRefInventoryRow(
  row: Record<string, unknown>,
): LeadMessageLeadRefInventoryRow {
  const leadRef =
    row.lead_ref && typeof row.lead_ref === "object"
      ? (row.lead_ref as Record<string, unknown>)
      : null;
  return {
    id: String(row._id ?? row.id ?? ""),
    has_form_lead: Boolean(row.form_lead),
    has_lead_ref: Boolean(leadRef?.id),
    form_lead: row.form_lead ? String(row.form_lead) : undefined,
    lead_ref_id: leadRef?.id ? String(leadRef.id) : undefined,
    origin: typeof row.origin === "string" ? row.origin : undefined,
  };
}
