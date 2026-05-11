export type CompanySource = {
  company: string;
  site: string;
  labels: {
    leads: string;
    calls: string;
  };
};

export const COMPANY_SOURCES = [
  {
    company: "Spotover",
    site: "10bestmovingcompanies.com",
    labels: {
      leads: "TBM Forms",
      calls: "TBM Forms",
    },
  },
  {
    company: "Natural Intelligence",
    site: "Topmovingexperts.com",
    labels: {
      leads: "Top Moving Experts",
      calls: "TBM Prime",
    },
  },
  {
    company: "Applied Mind",
    site: "BestRelocation.com",
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
