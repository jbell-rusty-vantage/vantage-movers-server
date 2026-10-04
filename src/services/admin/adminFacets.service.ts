import { onRegistryCacheInvalidation } from "../operationsRegistry";
import { type FilterCatalog, loadProductionCatalog } from "./filterCatalog";

export type {
  FilterCatalog,
  FilterCatalogAgent,
  FilterCatalogCompany,
  FilterCatalogGranularity,
  FilterCatalogMerchant,
} from "./filterCatalog";

export type AdminFacets = {
  catalog: FilterCatalog;
  agents: string[];
  source_companies: string[];
  source_granularities: string[];
  sources: string[];
  merchants: string[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { value: AdminFacets; expiresAt: number } | undefined;

onRegistryCacheInvalidation((keys) => {
  if (keys.includes("facets")) {
    cache = undefined;
  }
});

export async function getAdminFacets(): Promise<AdminFacets> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.value;
  }

  const value = withCompatibility(await loadProductionCatalog());
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export function resetAdminFacetsCacheForTests(): void {
  cache = undefined;
}

function withCompatibility(catalog: FilterCatalog): AdminFacets {
  return {
    catalog,
    source_companies: catalog.source_companies.map((company) => company.company_slug),
    source_granularities: catalog.source_granularities.map(
      (granularity) => granularity.granularity_key,
    ),
    sources: catalog.source_granularities
      .map((granularity) => granularity.crm_label)
      .filter((label): label is string => Boolean(label && label.trim())),
    agents: catalog.agents.map((agent) => agent.name),
    merchants: catalog.merchants.map((merchant) => merchant.name),
  };
}
