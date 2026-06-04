import { SOURCE_COMPANIES } from "../../config/domain/sources";
import type { AdminDatabaseScope } from "../../validation/v1.validation";
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
  sources: string[];
  merchants: string[];
};

const PRODUCTION_AGENTS = [
  "Austin",
  "Brian",
  "Dylan",
  "Jacob",
  "Josh",
  "Jason",
  "Mike",
  "Patrick",
  "Sil",
  "Roys",
  "House",
] as const;

const PRODUCTION_MERCHANTS = [
  "Elavon",
  "Maverick",
  "Cardpointe",
  "EMS",
  "Paper Check",
  "Seamless",
  "Wire Transfer ACH",
] as const;

const PRODUCTION_SOURCE_LABELS = [
  "TBM Forms",
  "10 Best Inbounds",
  "TBM Prime Forms",
  "TBM Prime Inbounds",
  "Top10 Forms",
  "Top10 Inbounds",
  "Best Relocation Forms",
  "Best Relocation Locals",
  "Best Relocation Inbounds",
  "Main Site Forms",
  "Main Site Inbounds",
] as const;

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

  const value = scope === "production" ? productionFacets() : await historicalFacets();
  cache.set(scope, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function productionFacets(): AdminFacets {
  return {
    agents: [...PRODUCTION_AGENTS],
    source_companies: [...SOURCE_COMPANIES],
    sources: [...PRODUCTION_SOURCE_LABELS],
    merchants: [...PRODUCTION_MERCHANTS],
  };
}

async function historicalFacets(): Promise<AdminFacets> {
  const models = getAdminModels("historical");
  const booked = models["booked-leads"];
  const formLeads = models["form-leads"];
  const callLeads = models["call-leads"];

  const [agentRows, sources, formSources, callSources, merchants] = await Promise.all([
    booked.aggregate<{ _id: unknown }>([
      { $unwind: "$agent_allocations" },
      { $group: { _id: "$agent_allocations.agent_name_snapshot" } },
    ]),
    booked.distinct("source"),
    formLeads.distinct("source_company"),
    callLeads.distinct("source_company"),
    booked.distinct("merchant"),
  ]);

  const sourceList = cleanStrings(sources);
  return {
    agents: cleanStrings(agentRows.map((row) => row._id)),
    // The analytics source-company filter matches the derived source company,
    // which can be either a lead source_company slug or the booked `source`
    // label, so expose the union of both for historical scope.
    source_companies: cleanStrings([...formSources, ...callSources, ...sourceList]),
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
    sources: cleanStrings([...left.sources, ...right.sources]),
    merchants: cleanStrings([...left.merchants, ...right.merchants]),
  };
}
