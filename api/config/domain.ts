export function isTestMode(): boolean {
  return process.env.TEST_MODE?.trim().toLowerCase() === "true";
}

export function getMongoDatabaseName(): "vantagemovers" | "testvantagemovers" {
  return isTestMode() ? "testvantagemovers" : "vantagemovers";
}

export const MONGO_DATABASE_NAME = getMongoDatabaseName();

export const SOURCE_COMPANIES = [
  "tbm_leads",
  "tbm_prime_leads",
  "top10_leads",
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
  "10best Inbounds": "top10_leads",
  "Best Relocation Forms": "best_relocation_leads",
  "Best Relocation Locals": "best_relocation_leads",
  "Best Relocation Inbounds": "best_relocation_leads",
  "BestRelocation Forms": "best_relocation_leads",
  "BestRelocation Locals": "best_relocation_leads",
  "BestRelocation Inbounds": "best_relocation_leads",
} as const satisfies Record<string, SourceCompany>;

export const LOCAL_TYPES = ["local", "long_distance"] as const;
export type LocalType = (typeof LOCAL_TYPES)[number];

export const LEAD_MODELS = ["FormLead", "CallLead"] as const;
export type LeadModelName = (typeof LEAD_MODELS)[number];

export const MOVE_SIZES = [
  "Studio",
  "2 Bedrooms",
  "3 Bedrooms",
  "4 Bedrooms",
  "5+ Bedrooms",
  "Office",
] as const;

export const SHEET_SYNC_STATUSES = ["pending", "synced", "failed"] as const;

export type SheetSyncStatus = (typeof SHEET_SYNC_STATUSES)[number];

export const SHEET_TAB_NAMES = {
  forms: "Forms",
  calls: "Calls",
  duplicates: "Duplicates",
  badLeads: "Bad Leads",
  badCalls: "Bad Calls",
  bookedDeals: "Booked Deals",
  cancelledDeals: "Cancelled Deals",
} as const;

export const SHEET_CONTAINER_ENV_VARS = {
  masterLeads: "MASTER_LEADS_SHEET_ID",
  masterBooked: "MASTER_BOOKED_SHEET_ID",
  sourceLeads: {
    tbm_leads: "TBM_LEADS_SHEET_ID",
    tbm_prime_leads: "TBM_PRIME_LEADS_SHEET_ID",
    top10_leads: "TOP10_LEADS_SHEET_ID",
    best_relocation_leads: "BEST_RELOCATION_LEADS_SHEET_ID",
    main_site: "MAINSITE_LEADS_SHEET_ID",
  },
} as const;

export const GOOGLE_SERVICE_ACCOUNT_ENV_VARS = {
  json: "GOOGLE_SERVICE_ACCOUNT_JSON",
  testJson: "GOOGLE_SERVICE_ACCOUNT_TEST_JSON",
  base64Json: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
  testBase64Json: "GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64",
} as const;

export const FORM_SHEET_HEADERS = [
  "Timestamp",
  "Name",
  "Pickup Zip",
  "Destination Zip",
  "Pickup State",
  "Delivery State",
  "Move Size",
  "Move Date",
  "Phone Number",
  "Mongo ID",
  "Ref No",
  "Booked",
  "Booked Date",
  "OVER 2000",
  "OVER 4000",
  "Cancelled",
  "Local",
  "Cubic Feet",
  "Lead ID",
  "Source Company",
  "Source Company Site",
  "Quoted",
] as const;

export const CALL_SHEET_HEADERS = [
  "Timestamp",
  "Job No",
  "Phone Number",
  "Duration",
  "Booked",
  "Booked Date",
  "Over 2000",
  "Over 4000",
  "Cancelled",
  "Local",
  "Cubic Feet",
  "Mongo ID",
  "Source Company",
  "FormFill",
] as const;

export const BOOKED_SHEET_HEADERS = [
  "Timestamp",
  "Agent",
  "SplitAgent",
  "Binder Amount",
  "Split",
  "Book Date",
  "Job No",
  "Customer Name",
  "Deposit Amount",
  "Merchant",
  "Source",
  "Mongo ID",
  "Mongo Lead ID",
  "Local",
  "Cancelled",
] as const;

export const CANCELLED_SHEET_HEADERS = [
  "Timestamp",
  "Agent",
  "Cancel Date",
  "Job No",
  "Customer Name",
  "Refund Amount",
  "Source",
  "Mongo ID",
  "Lead Mongo ID",
] as const;

export type SourceCompanyConfig = {
  slug: SourceCompany;
  label: string;
  leadSheetEnvVar?: SourceLeadSheetEnvVar;
  cpl: number | { local: number; long_distance: number };
  hasBadTabs: boolean;
  aliases: readonly string[];
};

export type SourceLeadSheetEnvVar =
  | "TBM_LEADS_SHEET_ID"
  | "TBM_PRIME_LEADS_SHEET_ID"
  | "TOP10_LEADS_SHEET_ID"
  | "BEST_RELOCATION_LEADS_SHEET_ID"
  | "MAINSITE_LEADS_SHEET_ID";

export type SheetContainerEnvVar =
  | "MASTER_LEADS_SHEET_ID"
  | "MASTER_BOOKED_SHEET_ID"
  | SourceLeadSheetEnvVar;

export type RuntimeSheetContainerEnvVar =
  | SheetContainerEnvVar
  | `TEST_${SheetContainerEnvVar}`;

export const SOURCE_COMPANY_CONFIGS = {
  tbm_leads: {
    slug: "tbm_leads",
    label: "TBM Leads",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.tbm_leads,
    cpl: Number(process.env.TBM_LEADS_CPL ?? 190),
    hasBadTabs: true,
    aliases: ["TBM Leads", "tbm", "10bestmovingcompanies.com"],
  },
  tbm_prime_leads: {
    slug: "tbm_prime_leads",
    label: "TBM Prime Leads",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.tbm_prime_leads,
    cpl: Number(process.env.TBM_PRIME_LEADS_CPL ?? 190),
    hasBadTabs: true,
    aliases: ["TBM Prime Leads", "TBM Prime", "Topmovingexperts.com"],
  },
  top10_leads: {
    slug: "top10_leads",
    label: "Top 10 Forms",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.top10_leads,
    cpl: Number(process.env.TOP10_LEADS_CPL ?? 190),
    hasBadTabs: true,
    aliases: ["Top 10 Leads", "Top10 Leads", "Top 10"],
  },
  best_relocation_leads: {
    slug: "best_relocation_leads",
    label: "Best Relocation Leads",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.best_relocation_leads,
    cpl: {
      local: Number(process.env.BEST_RELOCATION_LOCALS_CPL ?? 40),
      long_distance: Number(process.env.BEST_RELOCATION_LEADS_CPL ?? 195),
    },
    hasBadTabs: true,
    aliases: ["Best Relocation Leads", "Best Relocation", "BestRelocation.com"],
  },
  main_site: {
    slug: "main_site",
    label: "main site",
    leadSheetEnvVar: SHEET_CONTAINER_ENV_VARS.sourceLeads.main_site,
    cpl: Number(process.env.MAINSITE_CPL ?? 0),
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
    cpl: 0,
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

export function getCplForSource(
  sourceCompany: SourceCompany,
  local: LocalType | undefined,
): number {
  const cpl = SOURCE_COMPANY_CONFIGS[sourceCompany].cpl;
  if (typeof cpl === "number") {
    return cpl;
  }

  return cpl[local ?? "long_distance"];
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

export function getRuntimeSheetContainerEnvVar(
  envVar: SheetContainerEnvVar,
): RuntimeSheetContainerEnvVar {
  return isTestMode() ? (`TEST_${envVar}` as const) : envVar;
}

export function getGoogleServiceAccountJsonEnvVar():
  | "GOOGLE_SERVICE_ACCOUNT_JSON"
  | "GOOGLE_SERVICE_ACCOUNT_TEST_JSON" {
  return isTestMode()
    ? GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testJson
    : GOOGLE_SERVICE_ACCOUNT_ENV_VARS.json;
}

export function getGoogleServiceAccountJsonBase64EnvVar():
  | "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"
  | "GOOGLE_SERVICE_ACCOUNT_TEST_JSON_BASE64" {
  return isTestMode()
    ? GOOGLE_SERVICE_ACCOUNT_ENV_VARS.testBase64Json
    : GOOGLE_SERVICE_ACCOUNT_ENV_VARS.base64Json;
}

export function getMasterLeadsSheetContainerId(): string {
  return getRequiredEnv(getRuntimeSheetContainerEnvVar(SHEET_CONTAINER_ENV_VARS.masterLeads));
}

export function getMasterBookedSheetContainerId(): string {
  return getRequiredEnv(getRuntimeSheetContainerEnvVar(SHEET_CONTAINER_ENV_VARS.masterBooked));
}

export function getSourceLeadSheetContainerId(
  sourceCompany: SourceCompany,
): string | undefined {
  const envVar = SOURCE_COMPANY_CONFIGS[sourceCompany].leadSheetEnvVar;
  return envVar ? getRequiredEnv(getRuntimeSheetContainerEnvVar(envVar)) : undefined;
}
