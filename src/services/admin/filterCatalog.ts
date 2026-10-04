import { listCatalogItems } from "../catalog";
import {
  listSourceCompanies,
  listSourceGranularities,
  type SourceCompanyItem,
  type SourceGranularityItem,
} from "../operationsRegistry";

export type FilterCatalogCompany = {
  id: string;
  company_slug: string;
  owner_label: string;
  active: boolean;
};

export type FilterCatalogGranularity = {
  id: string;
  source_company_id: string;
  company_slug: string;
  company_owner_label: string;
  granularity_key: string;
  channel?: "form" | "call";
  owner_label: string;
  crm_label?: string;
  local?: "local" | "long_distance";
  active: boolean;
};

export type FilterCatalogAgent = {
  id: string;
  name: string;
  active: boolean;
};

export type FilterCatalogMerchant = {
  id: string;
  name: string;
  active: boolean;
};

export type FilterCatalog = {
  source_companies: FilterCatalogCompany[];
  source_granularities: FilterCatalogGranularity[];
  agents: FilterCatalogAgent[];
  merchants: FilterCatalogMerchant[];
};

export async function loadProductionCatalog(): Promise<FilterCatalog> {
  const [companies, granularities, agents, merchants] = await Promise.all([
    safeList(() => listSourceCompanies({ includeInactive: true })),
    safeList(() => listSourceGranularities({ includeInactive: true })),
    safeList(() => listCatalogItems("agents", { includeInactive: true })),
    safeList(() => listCatalogItems("merchants", { includeInactive: true })),
  ]);

  const companyById = new Map<string, FilterCatalogCompany>();
  for (const company of companies) {
    const row = toRegistryCompany(company);
    companyById.set(row.id, row);
  }

  const catalogGranularities = granularities
    .map((granularity) => toRegistryGranularity(granularity, companyById))
    .sort(byOwnerLabel);

  return {
    source_companies: Array.from(companyById.values()).sort(byOwnerLabel),
    source_granularities: catalogGranularities,
    agents: agents
      .map((item) => ({ id: item.id, name: item.name, active: item.active }))
      .sort(byName),
    merchants: merchants
      .map((item) => ({ id: item.id, name: item.name, active: item.active }))
      .sort(byName),
  };
}

export function findCatalogGranularity(
  catalog: FilterCatalog,
  submitted: string,
): FilterCatalogGranularity | undefined {
  const key = normalizeKey(submitted);
  if (!key) return undefined;
  return catalog.source_granularities.find(
    (row) =>
      normalizeKey(row.granularity_key) === key ||
      normalizeKey(row.owner_label) === key ||
      normalizeKey(row.crm_label ?? "") === key,
  );
}

function toRegistryCompany(company: SourceCompanyItem): FilterCatalogCompany {
  return {
    id: company.id,
    company_slug: company.company_slug,
    owner_label: company.owner_label || company.name || company.company_slug,
    active: company.active === true,
  };
}

function toRegistryGranularity(
  granularity: SourceGranularityItem,
  companies: Map<string, FilterCatalogCompany>,
): FilterCatalogGranularity {
  const parent = companies.get(String(granularity.source_company));
  return {
    id: granularity.id,
    source_company_id: parent?.id ?? String(granularity.source_company ?? ""),
    company_slug: parent?.company_slug ?? "",
    company_owner_label: parent?.owner_label ?? "",
    granularity_key: granularity.granularity_key,
    channel: granularity.channel,
    owner_label: granularity.owner_label || granularity.crm_label || granularity.granularity_key,
    ...(granularity.crm_label ? { crm_label: granularity.crm_label } : {}),
    ...(granularity.local ? { local: granularity.local } : {}),
    active: granularity.active === true,
  };
}

function byOwnerLabel(
  left: { owner_label: string },
  right: { owner_label: string },
): number {
  return left.owner_label.localeCompare(right.owner_label, "en", { sensitivity: "base" });
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

async function safeList<T>(load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch {
    return [];
  }
}
