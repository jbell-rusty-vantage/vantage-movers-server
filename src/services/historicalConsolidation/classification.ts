export const FORM_DUPLICATE_CUTOFF = new Date("2026-04-30T04:00:00.000Z");
export const CALL_DUPLICATE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export type CanonicalLead = {
  id: string;
  kind: "form" | "call";
  timestamp: string;
  source_company_id: string;
  source_granularity_id: string;
  normalized_phone?: string | null;
  normalized_email?: string | null;
  duplicate?: boolean;
  preserve_duplicate?: boolean;
};

export type ClassifiedLead = CanonicalLead & { duplicate: boolean; duplicate_anchor_ids: string[]; form_fill?: boolean };

function order(leads: readonly CanonicalLead[]): CanonicalLead[] {
  return [...leads].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
}

export function classifyHistoricalLeads(leads: readonly CanonicalLead[]): ClassifiedLead[] {
  const forms: ClassifiedLead[] = [];
  const calls: ClassifiedLead[] = [];
  for (const lead of order(leads)) {
    if (!lead.source_granularity_id) throw new Error(`Lead ${lead.id} has no exact Source Granularity`);
    const timestamp = new Date(lead.timestamp).getTime();
    if (!Number.isFinite(timestamp)) throw new Error(`Lead ${lead.id} has an invalid timestamp`);
    if (lead.kind === "form") {
      const cohort = timestamp < FORM_DUPLICATE_CUTOFF.getTime() ? "historical" : "modern";
      const anchors = forms.filter((candidate) => {
        const candidateTime = new Date(candidate.timestamp).getTime();
        const candidateCohort = candidateTime < FORM_DUPLICATE_CUTOFF.getTime() ? "historical" : "modern";
        return candidateCohort === cohort && candidate.source_granularity_id === lead.source_granularity_id && !candidate.duplicate && ((lead.normalized_phone && candidate.normalized_phone === lead.normalized_phone) || (lead.normalized_email && candidate.normalized_email === lead.normalized_email));
      });
      const duplicate = lead.preserve_duplicate ? Boolean(lead.duplicate) : anchors.length > 0;
      forms.push({ ...lead, duplicate, duplicate_anchor_ids: anchors.map((entry) => entry.id) });
    } else {
      const anchors = calls.filter((candidate) => {
        const delta = timestamp - new Date(candidate.timestamp).getTime();
        return candidate.source_granularity_id === lead.source_granularity_id && !candidate.duplicate && Boolean(lead.normalized_phone) && candidate.normalized_phone === lead.normalized_phone && delta >= 0 && delta <= CALL_DUPLICATE_WINDOW_MS;
      });
      calls.push({ ...lead, duplicate: anchors.length > 0, duplicate_anchor_ids: anchors.map((entry) => entry.id) });
    }
  }
  const nonDuplicateForms = forms.filter((lead) => !lead.duplicate && lead.normalized_phone);
  return [...forms, ...calls.map((call) => ({ ...call, form_fill: nonDuplicateForms.some((form) => form.source_company_id === call.source_company_id && form.normalized_phone === call.normalized_phone) }))]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
}
