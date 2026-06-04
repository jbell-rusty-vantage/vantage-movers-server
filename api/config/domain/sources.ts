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
  "10best_leads",
  "best_relocation_leads",
  "main_site",
  "not_provided",
] as const;

export type SourceCompany = (typeof SOURCE_COMPANIES)[number];

// TODO: Ensure these will work at the exact character order level Best Relocation Forms and BestRelocation Forms or BestRelocationForms is the same

export const SOURCE_LABEL_TO_COMPANY = {
  "Main Site Forms": "main_site",
  "Main Site Inbounds": "main_site",
  "Get Movers": "main_site",
  "TBM Forms": "tbm_leads",
  "TBM Prime Forms": "tbm_prime_leads",
  "TBM Forms Prime": "tbm_prime_leads",
  "TBM Prime Inbounds": "tbm_prime_leads",
  "Top10 Forms": "top10_leads",
  "Top10 Inbounds": "top10_leads",
  "10best Inbounds": "10best_leads",
  "Best Relocation Forms": "best_relocation_leads",
  "Best Relocation Locals": "best_relocation_leads",
  "Best Relocation Inbounds": "best_relocation_leads",
  "BestRelocation Forms": "best_relocation_leads",
  "BestRelocation Locals": "best_relocation_leads",
  "BestRelocation Inbounds": "best_relocation_leads",
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
    aliases: ["TBM Leads", "tbm", "10bestmovingcompanies.com"],
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
  "10best_leads": {
    slug: "10best_leads",
    label: "10best Leads",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads["10best_leads"],
    hasBadTabs: true,
    aliases: ["10best Leads", "10best", "10best Inbounds"],
  },
  best_relocation_leads: {
    slug: "best_relocation_leads",
    label: "Best Relocation Leads",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.best_relocation_leads,
    hasBadTabs: true,
    aliases: ["Best Relocation Leads", "Best Relocation", "BestRelocation.com"],
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

export function getSourceCompanyLabel(sourceCompany: SourceCompany): string {
  return SOURCE_COMPANY_CONFIGS[sourceCompany].label;
}

export function getFormLeadSourceCompanyLabel(sourceCompany: SourceCompany): string {
  switch (sourceCompany) {
    case "tbm_leads":
      return "TBM Forms";
    case "tbm_prime_leads":
      return "TBM Prime Forms";
    case "top10_leads":
      return "Top10 Forms";
    case "10best_leads":
      return getSourceCompanyLabel(sourceCompany);
    case "best_relocation_leads":
      return "Best Relocation Forms";
    case "main_site":
      return "Main Site Forms";
    case "not_provided":
      return getSourceCompanyLabel(sourceCompany);
  }
}

export function getCallLeadSourceCompanyLabel(sourceCompany: SourceCompany): string {
  switch (sourceCompany) {
    case "tbm_leads":
      return "TBM Inbounds";
    case "tbm_prime_leads":
      return "TBM Prime Inbounds";
    case "top10_leads":
      return "Top10 Inbounds";
    case "10best_leads":
      return "10best Inbounds";
    case "best_relocation_leads":
      return "Best Relocation Inbounds";
    case "main_site":
      return "Main Site Inbounds";
    case "not_provided":
      return getSourceCompanyLabel(sourceCompany);
  }
}
