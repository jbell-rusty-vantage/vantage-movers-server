import type { LocalType } from "./constants";
import {
  SHEET_CONTAINER_ENV_VARS,
  type SourceLeadSheetEnvVar,
} from "./sheets";

/**
 * Source-company slugs, owner-facing label maps, alias maps, and the pure
 * per-source metadata table.
 *
 * This module deliberately holds no `process.env` reads so it can be
 * imported from tests, scripts, and validation without requiring runtime
 * env configuration. CPL values (the only previously env-derived per-source
 * fields) live in `./cpl.ts` and are looked up via `getCplForSource`.
 */

export const SOURCE_COMPANIES = [
  "tbm_leads",
  "tbm_prime_leads",
  "top10_leads",
  "best_relocation_leads",
  "get_movers_leads",
  "main_site",
  "paid_overflow",
  "not_provided",
] as const;

export type SourceCompany = (typeof SOURCE_COMPANIES)[number];

/** Exact Granot CRM `label` values accepted by HelloMoving. */
export const CRM_SOURCE_LABELS = [
  "TBM Forms",
  "10best Inbounds",
  "TBM Prime Forms",
  "TBM Prime Inbounds",
  "Top10 Forms",
  "Top10 Inbounds",
  "Best Relocation Forms",
  "Best Relocation Locals",
  "Best Relocation Inbounds",
  "GetMovers Forms",
  "GetMovers Inbounds",
  "Main Site Forms",
  "Main Site Inbounds",
  "Paid Overflow",
] as const;

export type CrmSourceLabel = (typeof CRM_SOURCE_LABELS)[number];

export const SOURCE_LABEL_TO_COMPANY = {
  "Main Site Forms": "main_site",
  "Main Site Inbounds": "main_site",
  "Get Movers": "get_movers_leads",
  "GetMovers Forms": "get_movers_leads",
  "Get Movers Forms": "get_movers_leads",
  "GetMovers Inbounds": "get_movers_leads",
  "Get Movers Inbounds": "get_movers_leads",
  "TBM Forms": "tbm_leads",
  "TBM Prime Forms": "tbm_prime_leads",
  "TBM Forms Prime": "tbm_prime_leads",
  "TBM Prime Inbounds": "tbm_prime_leads",
  "Top10 Forms": "top10_leads",
  "Top10 Inbounds": "top10_leads",
  "10 Best Inbounds": "tbm_leads",
  "10Best Inbounds": "tbm_leads",
  "10best Inbounds": "tbm_leads",
  "Best Relocation Forms": "best_relocation_leads",
  "Best Relocation Locals": "best_relocation_leads",
  "Best Relocation Inbounds": "best_relocation_leads",
  "BestRelocation Forms": "best_relocation_leads",
  "BestRelocation Locals": "best_relocation_leads",
  "BestRelocation Inbounds": "best_relocation_leads",
  "Paid Overflow": "paid_overflow",
} as const satisfies Record<string, SourceCompany>;

export type SourceCompanyConfig = {
  slug: SourceCompany;
  label: string;
  leadSheetEnvVar?: SourceLeadSheetEnvVar;
  hasBadTabs: boolean;
  aliases: readonly string[];
};

export const SOURCE_COMPANY_CONFIGS = {
  tbm_leads: {
    slug: "tbm_leads",
    label: "TBM Leads",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.tbm_leads,
    hasBadTabs: true,
    aliases: [
      "TBM Leads",
      "tbm",
      "10best",
      "10best Leads",
      "10 Best Leads",
      "10bestmovingcompanies.com",
    ],
  },
  tbm_prime_leads: {
    slug: "tbm_prime_leads",
    label: "TBM Prime Leads",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.tbm_prime_leads,
    hasBadTabs: true,
    aliases: ["TBM Prime Leads", "TBM Prime", "Topmovingexperts.com"],
  },
  top10_leads: {
    slug: "top10_leads",
    label: "Top 10 Forms",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.top10_leads,
    hasBadTabs: true,
    aliases: ["Top 10 Leads", "Top10 Leads", "Top 10"],
  },
  best_relocation_leads: {
    slug: "best_relocation_leads",
    label: "Best Relocation Leads",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.best_relocation_leads,
    hasBadTabs: true,
    aliases: ["Best Relocation Leads", "Best Relocation", "BestRelocation.com"],
  },
  get_movers_leads: {
    slug: "get_movers_leads",
    label: "GetMovers Leads",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.get_movers_leads,
    hasBadTabs: true,
    aliases: [
      "GetMovers Leads",
      "Get Movers Leads",
      "Get Movers",
      "GetMovers",
      "get_movers_leads",
    ],
  },
  main_site: {
    slug: "main_site",
    label: "main site",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.main_site,
    hasBadTabs: false,
    aliases: [
      "main site",
      "main_site",
      "mainsite",
      "Vantage Movers",
      "vantage_movers",
      "vantagemovers.com",
    ],
  },
  paid_overflow: {
    slug: "paid_overflow",
    label: "Paid Overflow",
    leadSheetEnvVar: undefined,
    hasBadTabs: false,
    aliases: ["Paid Overflow", "paid overflow", "paid_overflow"],
  },
  not_provided: {
    slug: "not_provided",
    label: "not provided",
    leadSheetEnvVar: undefined,
    hasBadTabs: false,
    aliases: ["not provided", "not_provided", ""],
  },
} as const satisfies Record<SourceCompany, SourceCompanyConfig>;

export function resolveSourceCompany(
  value?: string | null,
): SourceCompany | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return "not_provided";
  }

  const sourceCompanyFromLabel = resolveSourceCompanyFromLabel(value);
  if (sourceCompanyFromLabel) {
    return sourceCompanyFromLabel;
  }

  for (const config of Object.values(SOURCE_COMPANY_CONFIGS)) {
    if (
      config.slug === normalized ||
      config.label.toLowerCase() === normalized ||
      config.aliases.some((alias) => alias.trim().toLowerCase() === normalized)
    ) {
      return config.slug;
    }
  }

  return undefined;
}

export function resolveSourceCompanyFromLabel(
  value?: string | null,
): SourceCompany | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  for (const [label, sourceCompany] of Object.entries(
    SOURCE_LABEL_TO_COMPANY,
  )) {
    if (label.toLowerCase() === normalized) {
      return sourceCompany;
    }
  }

  return undefined;
}

export function normalizeSourceCompany(value?: string | null): SourceCompany {
  const sourceCompany = resolveSourceCompany(value);
  if (sourceCompany) {
    return sourceCompany;
  }

  return "not_provided";
}

export function getSourceCompanyLabel(sourceCompany: SourceCompany | string): string {
  const config =
    SOURCE_COMPANY_CONFIGS[sourceCompany as keyof typeof SOURCE_COMPANY_CONFIGS];
  return config?.label ?? sourceCompany;
}

export function getFormLeadSourceCompanyLabel(
  sourceCompany: SourceCompany | string,
  local?: LocalType,
): string {
  switch (sourceCompany) {
    case "tbm_leads":
      return "TBM Forms";
    case "tbm_prime_leads":
      return "TBM Prime Forms";
    case "top10_leads":
      return "Top10 Forms";
    case "best_relocation_leads":
      return local === "local"
        ? "Best Relocation Locals"
        : "Best Relocation Forms";
    case "get_movers_leads":
      return "GetMovers Forms";
    case "main_site":
      return "Main Site Forms";
    case "paid_overflow":
      return "Paid Overflow";
    case "not_provided":
      return "Main Site Forms";
    default:
      return sourceCompany;
  }
}

export function getCallLeadSourceCompanyLabel(sourceCompany: SourceCompany | string): string {
  switch (sourceCompany) {
    case "tbm_leads":
      return "10best Inbounds";
    case "tbm_prime_leads":
      return "TBM Prime Inbounds";
    case "top10_leads":
      return "Top10 Inbounds";
    case "best_relocation_leads":
      return "Best Relocation Inbounds";
    case "get_movers_leads":
      return "GetMovers Inbounds";
    case "main_site":
      return "Main Site Inbounds";
    case "paid_overflow":
      return "Paid Overflow";
    case "not_provided":
      return "Main Site Inbounds";
    default:
      return sourceCompany;
  }
}

/** Granot CRM `label` for a saved form lead (source company + local move type). */
export function getCrmFormLeadSourceCompanyLabel(
  sourceCompany: SourceCompany,
  local: LocalType,
): CrmSourceLabel {
  return getFormLeadSourceCompanyLabel(sourceCompany, local) as CrmSourceLabel;
}
