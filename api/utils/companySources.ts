export type CompanySource = {
  company: string;
  site: string;
  spreadsheetEnvVar: "SPOTOVER_SHEET_ID" | "NATURAL_INTELLIGENCE_SHEET_ID" | "APPLIED_MIND_SHEET_ID";
  labels: {
    leads: string;
    calls: string;
  };
};

export const COMPANY_SOURCES = [
  {
    company: "Spotover",
    site: "10bestmovingcompanies.com",
    spreadsheetEnvVar: "SPOTOVER_SHEET_ID",
    labels: {
      leads: "TBM Forms",
      calls: "TBM Forms",
    },
  },
  {
    company: "Natural Intelligence",
    site: "Topmovingexperts.com",
    spreadsheetEnvVar: "NATURAL_INTELLIGENCE_SHEET_ID",
    labels: {
      leads: "Top Moving Experts",
      calls: "TBM Prime",
    },
  },
  {
    company: "Applied Mind",
    site: "BestRelocation.com",
    spreadsheetEnvVar: "APPLIED_MIND_SHEET_ID",
    labels: {
      leads: "Best Relocation Forms",
      calls: "Best Relocation Forms",
    },
  },
] as const satisfies readonly CompanySource[];

function normalizeCompanyLookupValue(value: string): string {
  return value.trim().toLowerCase();
}

export function findCompanySource(value: string): CompanySource | undefined {
  const normalized = normalizeCompanyLookupValue(value);

  return COMPANY_SOURCES.find(
    (source) =>
      normalizeCompanyLookupValue(source.site) === normalized ||
      normalizeCompanyLookupValue(source.company) === normalized ||
      normalizeCompanyLookupValue(source.labels.leads) === normalized ||
      normalizeCompanyLookupValue(source.labels.calls) === normalized,
  );
}

export function getCompanySourceBySite(site: string): CompanySource | undefined {
  const normalized = normalizeCompanyLookupValue(site);

  return COMPANY_SOURCES.find((source) => normalizeCompanyLookupValue(source.site) === normalized);
}

export function getCompanySourceSpreadsheetId(source: CompanySource): string {
  const spreadsheetId = process.env[source.spreadsheetEnvVar]?.trim();
  if (!spreadsheetId) {
    throw new Error(`${source.spreadsheetEnvVar} is not set`);
  }

  return spreadsheetId;
}
