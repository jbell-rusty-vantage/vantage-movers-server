import type { LeadModelName, LocalType } from "./constants";
import type { SourceCompany } from "./sources";

/**
 * Canonical granular CPL rate slots.
 *
 * Each slot corresponds 1:1 to a `CRM_SOURCE_LABELS` entry from `sources.ts`
 * (the same "lead type + source company" naming convention already used for
 * Granot CRM submission), except `not_provided`, which is intentionally
 * excluded -- unknown-source leads always carry CPL 0 and are not
 * owner-configurable.
 *
 * `defaultCpl` mirrors the values that used to live behind `*_CPL` env vars
 * in the old `SOURCE_COMPANY_CPLS` table (see `cpl.ts`). These are only used
 * to seed the `CplRate` collection the first time a slot is read -- once a
 * `CplRate` document exists, its stored `cpl` is authoritative and the env
 * vars are no longer consulted.
 */

export const CPL_LEAD_TYPES = ["form", "call"] as const;
export type CplLeadType = (typeof CPL_LEAD_TYPES)[number];

export type CplRateDefinition = {
  label: string;
  sourceCompany: SourceCompany;
  leadType: CplLeadType;
  local?: LocalType;
  defaultCpl: number;
};

export const CPL_RATE_DEFINITIONS: readonly CplRateDefinition[] = [
  { label: "TBM Forms", sourceCompany: "tbm_leads", leadType: "form", defaultCpl: 190 },
  { label: "10best Inbounds", sourceCompany: "tbm_leads", leadType: "call", defaultCpl: 190 },
  { label: "TBM Prime Forms", sourceCompany: "tbm_prime_leads", leadType: "form", defaultCpl: 190 },
  { label: "TBM Prime Inbounds", sourceCompany: "tbm_prime_leads", leadType: "call", defaultCpl: 190 },
  { label: "Top10 Forms", sourceCompany: "top10_leads", leadType: "form", defaultCpl: 190 },
  { label: "Top10 Inbounds", sourceCompany: "top10_leads", leadType: "call", defaultCpl: 190 },
  {
    label: "Best Relocation Forms",
    sourceCompany: "best_relocation_leads",
    leadType: "form",
    local: "long_distance",
    defaultCpl: 195,
  },
  {
    label: "Best Relocation Locals",
    sourceCompany: "best_relocation_leads",
    leadType: "form",
    local: "local",
    defaultCpl: 40,
  },
  {
    label: "Best Relocation Inbounds",
    sourceCompany: "best_relocation_leads",
    leadType: "call",
    defaultCpl: 195,
  },
  { label: "GetMovers Forms", sourceCompany: "get_movers_leads", leadType: "form", defaultCpl: 0 },
  { label: "GetMovers Inbounds", sourceCompany: "get_movers_leads", leadType: "call", defaultCpl: 0 },
  { label: "Main Site Forms", sourceCompany: "main_site", leadType: "form", defaultCpl: 0 },
  { label: "Main Site Inbounds", sourceCompany: "main_site", leadType: "call", defaultCpl: 0 },
  { label: "Paid Overflow", sourceCompany: "paid_overflow", leadType: "form", defaultCpl: 0 },
] as const;

export function findCplRateDefinition(label: string): CplRateDefinition | undefined {
  return CPL_RATE_DEFINITIONS.find((definition) => definition.label === label);
}

export function isCplRateLabel(label: string): boolean {
  return findCplRateDefinition(label) !== undefined;
}

/** Cache/lookup key for a given source-company + lead-type + local triple. */
export function cplRateCacheKey(
  sourceCompany: SourceCompany,
  leadType: CplLeadType,
  local: LocalType | undefined,
): string {
  const matchesOnLocal = sourceCompany === "best_relocation_leads" && leadType === "form";
  return `${sourceCompany}:${leadType}:${matchesOnLocal ? (local ?? "long_distance") : ""}`;
}

export function cplLeadTypeForModel(leadModel: LeadModelName): CplLeadType {
  return leadModel === "FormLead" ? "form" : "call";
}
