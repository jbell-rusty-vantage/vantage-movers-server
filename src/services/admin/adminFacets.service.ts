import type { AdminDatabaseScope } from "../../validation/v1.validation";
import { listCatalogItems } from "../catalog";
import { listLeadSourceCompanies } from "../leadSourceCompanies";
import { getAdminModels, type ConcreteAdminScope } from "./adminScope.service";

/**
 * Distinct filter values ("facets") per database scope. Production filters
 * mirror the fixed Google Form dropdowns / source-company enum, while
 * historical filters are computed live from the `vantagemovershistorical`
 * collections (agents, source companies, source labels, merchants) because
 * that data set is open-ended and read-only. Results are cached briefly to
 * avoid re-scanning the historical collections on every dashboard load.
 */
export type AdminFacets = {
  agents: string[];
  source_companies: string[];
  source_granularities: string[];
  sources: string[];
  merchants: string[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<ConcreteAdminScope, { value: AdminFacets; expiresAt: number }>();

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

  const value = scope === "production" ? await productionFacets() : await historicalFacets();
  cache.set(scope, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function productionFacets(): Promise<AdminFacets> {
  const [agents, merchants, sourceCompanies] = await Promise.all([
    listCatalogItems("agents"),
    listCatalogItems("merchants"),
    listLeadSourceCompanies(),
  ]);
  return {
    agents: agents.map((item) => item.name),
    source_companies: sourceCompanies.map((company) => company.company_slug),
    source_granularities: sourceCompanies.flatMap((company) =>
      company.granularities.map((granularity) => granularity.granularity_key),
    ),
    sources: sourceCompanies.flatMap((company) =>
      company.granularities.map((granularity) => granularity.crm_label),
    ),
    merchants: merchants.map((item) => item.name),
  };
}

async function historicalFacets(): Promise<AdminFacets> {
  const models = getAdminModels("historical");
  const booked = models["booked-leads"];
  const formLeads = models["form-leads"];
  const callLeads = models["call-leads"];

  const [agentRows, sources, formSources, callSources, formGranularities, callGranularities, merchants] = await Promise.all([
    booked.aggregate<{ _id: unknown }>([
      { $unwind: "$agent_allocations" },
      { $group: { _id: "$agent_allocations.agent_name_snapshot" } },
    ]),
    booked.distinct("source"),
    formLeads.distinct("source_company"),
    callLeads.distinct("source_company"),
    formLeads.distinct("source_granularity_key"),
    callLeads.distinct("source_granularity_key"),
    booked.distinct("merchant"),
  ]);

  const sourceList = cleanStrings(sources);
  return {
    agents: cleanStrings(agentRows.map((row) => row._id)),
    // The analytics source-company filter matches the derived source company,
    // which can be either a lead source_company slug or the booked `source`
    // label, so expose the union of both for historical scope.
    source_companies: cleanStrings([...formSources, ...callSources, ...sourceList]),
    source_granularities: cleanStrings([...formGranularities, ...callGranularities]),
    sources: sourceList,
    merchants: cleanStrings(merchants),
  };
}

function cleanStrings(values: unknown[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, trimmed);
    }
  }
  return Array.from(seen.values()).sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}

function mergeFacets(left: AdminFacets, right: AdminFacets): AdminFacets {
  return {
    agents: cleanStrings([...left.agents, ...right.agents]),
    source_companies: cleanStrings([...left.source_companies, ...right.source_companies]),
    source_granularities: cleanStrings([...left.source_granularities, ...right.source_granularities]),
    sources: cleanStrings([...left.sources, ...right.sources]),
    merchants: cleanStrings([...left.merchants, ...right.merchants]),
  };
}
