import type { AdminDatabaseScope } from "../../validation/v1.validation";
import { onRegistryCacheInvalidation } from "../operationsRegistry";
import type { ConcreteAdminScope } from "./adminScope.service";
import {
  EMPTY_FILTER_CATALOG,
  type FilterCatalog,
  loadHistoricalCatalog,
  loadProductionCatalog,
  mergeCatalogs,
} from "./filterCatalog";

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

const cache = new Map<ConcreteAdminScope, { value: AdminFacets; expiresAt: number }>();

onRegistryCacheInvalidation((keys) => {
  if (keys.includes("facets")) {
    cache.delete("production");
    cache.delete("historical");
  }
});

export async function getAdminFacets(scope: AdminDatabaseScope): Promise<AdminFacets> {
  if (scope === "combined") {
    const [production, historical] = await Promise.all([
      getAdminFacets("production"),
      getAdminFacets("historical"),
    ]);
    return mergeFacets(production, historical);
  }

  const cached = cache.get(scope);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const catalog =
    scope === "production"
      ? await loadProductionCatalog()
      : await loadHistoricalCatalog((await getAdminFacets("production")).catalog);
  const value = withCompatibility(catalog);
  cache.set(scope, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function resetAdminFacetsCacheForTests(): void {
  cache.clear();
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

function mergeFacets(production: AdminFacets, historical: AdminFacets): AdminFacets {
  return withCompatibility(mergeCatalogs(production.catalog, historical.catalog));
}

export function catalogOrEmpty(catalog: FilterCatalog | undefined): FilterCatalog {
  return catalog ?? EMPTY_FILTER_CATALOG;
}
