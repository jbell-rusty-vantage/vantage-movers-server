import { listCatalogItems } from "../catalog";
import {
  listSourceCompanies,
  listSourceGranularities,
  type SourceCompanyItem,
  type SourceGranularityItem,
} from "../operationsRegistry";
import { getAdminModels } from "./adminScope.service";

export type FilterCatalogOrigin = "registry" | "historical_distinct";

export type FilterCatalogCompany = {
  id: string;
  company_slug: string;
  owner_label: string;
  active: boolean;
  origin: FilterCatalogOrigin;
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
  origin: FilterCatalogOrigin;
};

export type FilterCatalogAgent = {
  id: string;
  name: string;
  active: boolean;
  origin: FilterCatalogOrigin;
};

export type FilterCatalogMerchant = {
  id: string;
  name: string;
  active: boolean;
  origin: FilterCatalogOrigin;
};

export type FilterCatalog = {
  source_companies: FilterCatalogCompany[];
  source_granularities: FilterCatalogGranularity[];
  agents: FilterCatalogAgent[];
  merchants: FilterCatalogMerchant[];
};

export const EMPTY_FILTER_CATALOG: FilterCatalog = {
  source_companies: [],
  source_granularities: [],
  agents: [],
  merchants: [],
};

export function emptyFilterCatalog(): FilterCatalog {
  return {
    source_companies: [],
    source_granularities: [],
    agents: [],
    merchants: [],
  };
}

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
      .map((item) => ({
        id: item.id,
        name: item.name,
        active: item.active,
        origin: "registry" as const,
      }))
      .sort(byName),
    merchants: merchants
      .map((item) => ({
        id: item.id,
        name: item.name,
        active: item.active,
        origin: "registry" as const,
      }))
      .sort(byName),
  };
}

export async function loadHistoricalCatalog(
  production: FilterCatalog = EMPTY_FILTER_CATALOG,
): Promise<FilterCatalog> {
  const models = getAdminModels("historical");
  const booked = models["booked-leads"];
  const formLeads = models["form-leads"];
  const callLeads = models["call-leads"];

  const [
    formKeys,
    formSnapshots,
    formCompanies,
    callKeys,
    callSnapshots,
    callCompanies,
    bookedSources,
    bookedKeys,
    bookedSnapshots,
    agentRows,
    merchants,
  ] = await Promise.all([
    distinctStrings(formLeads, "source_granularity_key"),
    distinctStrings(formLeads, "source_granularity_label_snapshot"),
    distinctStrings(formLeads, "source_company"),
    distinctStrings(callLeads, "source_granularity_key"),
    distinctStrings(callLeads, "source_granularity_label_snapshot"),
    distinctStrings(callLeads, "source_company"),
    distinctStrings(booked, "source"),
    distinctStrings(booked, "employee_source_snapshot.source_granularity_key"),
    distinctStrings(booked, "employee_source_snapshot.source_granularity_label_snapshot"),
    safeList(() =>
      booked.aggregate<{ _id: unknown }>([
        { $unwind: "$agent_allocations" },
        { $group: { _id: "$agent_allocations.agent_name_snapshot" } },
      ]),
    ),
    distinctStrings(booked, "merchant"),
  ]);

  const observed = emptyFilterCatalog();
  addObservedGranularities(observed, formKeys, formSnapshots, formCompanies, "form", production);
  addObservedGranularities(observed, callKeys, callSnapshots, callCompanies, "call", production);
  addBookedOnlyGranularities(observed, bookedKeys, bookedSnapshots, bookedSources, production);

  for (const name of cleanStrings(agentRows.map((row) => row._id))) {
    observed.agents.push({
      id: "",
      name,
      active: true,
      origin: "historical_distinct",
    });
  }
  for (const name of merchants) {
    observed.merchants.push({
      id: "",
      name,
      active: true,
      origin: "historical_distinct",
    });
  }

  return overlayProductionIdentity(observed, production);
}

export function mergeCatalogs(production: FilterCatalog, historical: FilterCatalog): FilterCatalog {
  const companies = new Map<string, FilterCatalogCompany>();
  for (const company of [...production.source_companies, ...historical.source_companies]) {
    const key = normalizeKey(company.company_slug || company.owner_label);
    const existing = companies.get(key);
    companies.set(key, existing ? preferRegistryCompany(existing, company) : company);
  }

  const granularities = new Map<string, FilterCatalogGranularity>();
  for (const granularity of [
    ...production.source_granularities,
    ...historical.source_granularities,
  ]) {
    const key = normalizeKey(granularity.granularity_key);
    const existing = granularities.get(key);
    granularities.set(key, existing ? preferRegistryGranularity(existing, granularity) : granularity);
  }

  const agents = new Map<string, FilterCatalogAgent>();
  for (const agent of [...production.agents, ...historical.agents]) {
    const key = normalizeKey(agent.name);
    const existing = agents.get(key);
    agents.set(key, existing ? preferRegistryNamed(existing, agent) : agent);
  }

  const merchants = new Map<string, FilterCatalogMerchant>();
  for (const merchant of [...production.merchants, ...historical.merchants]) {
    const key = normalizeKey(merchant.name);
    const existing = merchants.get(key);
    merchants.set(key, existing ? preferRegistryNamed(existing, merchant) : merchant);
  }

  return {
    source_companies: Array.from(companies.values()).sort(byOwnerLabel),
    source_granularities: Array.from(granularities.values()).sort(byOwnerLabel),
    agents: Array.from(agents.values()).sort(byName),
    merchants: Array.from(merchants.values()).sort(byName),
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
    origin: "registry",
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
    origin: "registry",
  };
}

function addObservedGranularities(
  catalog: FilterCatalog,
  keys: string[],
  snapshots: string[],
  companies: string[],
  channel: "form" | "call",
  production: FilterCatalog = EMPTY_FILTER_CATALOG,
): void {
  const productionByKey = indexProductionGranularities(production, "granularity_key");
  const productionByLabel = indexProductionGranularities(production, "owner_label");
  const seen = new Set(
    catalog.source_granularities
      .filter((row) => row.channel === channel)
      .map((row) => normalizeKey(row.granularity_key)),
  );

  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    catalog.source_granularities.push({
      id: "",
      source_company_id: "",
      company_slug: "",
      company_owner_label: "",
      granularity_key: key,
      channel,
      owner_label: key,
      active: true,
      origin: "historical_distinct",
    });
  }

  for (const snapshot of snapshots) {
    const normalized = normalizeKey(snapshot);
    if (!normalized || seen.has(normalized)) continue;
    const alreadyLabeled = catalog.source_granularities.some(
      (row) => row.channel === channel && normalizeKey(row.owner_label) === normalized,
    );
    if (alreadyLabeled) continue;
    const matched = productionByLabel.get(normalized);
    const existingKeyRow = matched
      ? catalog.source_granularities.find(
          (row) =>
            row.channel === channel &&
            normalizeKey(row.granularity_key) === normalizeKey(matched.granularity_key),
        )
      : undefined;
    if (existingKeyRow) {
      existingKeyRow.owner_label = snapshot;
      continue;
    }
    seen.add(normalized);
    catalog.source_granularities.push({
      id: "",
      source_company_id: "",
      company_slug: "",
      company_owner_label: "",
      granularity_key: snapshot,
      channel,
      owner_label: snapshot,
      active: true,
      origin: "historical_distinct",
    });
  }

  for (const company of companies) {
    const normalized = normalizeKey(company);
    if (!normalized) continue;
    const alreadyHaveCompany = catalog.source_companies.some(
      (row) => normalizeKey(row.company_slug) === normalized,
    );
    if (!alreadyHaveCompany) {
      catalog.source_companies.push({
        id: "",
        company_slug: company,
        owner_label: company,
        active: true,
        origin: "historical_distinct",
      });
    }
    if (seen.has(normalized)) continue;
    if (
      hasKeyedGranularityForCompany(
        catalog,
        channel,
        normalized,
        productionByKey,
        productionByLabel,
      )
    ) {
      seen.add(normalized);
      continue;
    }
    seen.add(normalized);
    catalog.source_granularities.push({
      id: "",
      source_company_id: "",
      company_slug: company,
      company_owner_label: company,
      granularity_key: company,
      channel,
      owner_label: company,
      active: true,
      origin: "historical_distinct",
    });
  }
}

function addBookedOnlyGranularities(
  catalog: FilterCatalog,
  keys: string[],
  snapshots: string[],
  sources: string[],
  production: FilterCatalog = EMPTY_FILTER_CATALOG,
): void {
  const productionByLabel = indexProductionGranularities(production, "owner_label");
  const seen = new Set(catalog.source_granularities.map((row) => normalizeKey(row.granularity_key)));
  const knownLabels = new Set(catalog.source_granularities.map((row) => normalizeKey(row.owner_label)));

  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    catalog.source_granularities.push({
      id: "",
      source_company_id: "",
      company_slug: "",
      company_owner_label: "",
      granularity_key: key,
      owner_label: key,
      active: true,
      origin: "historical_distinct",
    });
  }

  for (const snapshot of snapshots) {
    const normalized = normalizeKey(snapshot);
    if (!normalized || seen.has(normalized) || knownLabels.has(normalized)) continue;
    const matched = productionByLabel.get(normalized);
    const existingKeyRow = matched
      ? catalog.source_granularities.find(
          (row) => normalizeKey(row.granularity_key) === normalizeKey(matched.granularity_key),
        )
      : undefined;
    if (existingKeyRow) {
      if (!existingKeyRow.owner_label || normalizeKey(existingKeyRow.owner_label) === normalizeKey(existingKeyRow.granularity_key)) {
        existingKeyRow.owner_label = snapshot;
      }
      continue;
    }
    seen.add(normalized);
    catalog.source_granularities.push({
      id: "",
      source_company_id: "",
      company_slug: "",
      company_owner_label: "",
      granularity_key: snapshot,
      owner_label: snapshot,
      active: true,
      origin: "historical_distinct",
    });
  }

  for (const source of sources) {
    const normalized = normalizeKey(source);
    if (!normalized || seen.has(normalized) || knownLabels.has(normalized)) continue;
    seen.add(normalized);
    catalog.source_companies.push({
      id: "",
      company_slug: source,
      owner_label: source,
      active: true,
      origin: "historical_distinct",
    });
    catalog.source_granularities.push({
      id: "",
      source_company_id: "",
      company_slug: source,
      company_owner_label: source,
      granularity_key: source,
      owner_label: source,
      active: true,
      origin: "historical_distinct",
    });
  }
}

function overlayProductionIdentity(
  historical: FilterCatalog,
  production: FilterCatalog,
): FilterCatalog {
  const productionByKey = new Map(
    production.source_granularities.map((row) => [normalizeKey(row.granularity_key), row]),
  );
  const productionByLabel = new Map(
    production.source_granularities.map((row) => [normalizeKey(row.owner_label), row]),
  );
  const productionCompanyBySlug = new Map(
    production.source_companies.map((row) => [normalizeKey(row.company_slug), row]),
  );
  const productionAgentByName = new Map(
    production.agents.map((row) => [normalizeKey(row.name), row]),
  );
  const productionMerchantByName = new Map(
    production.merchants.map((row) => [normalizeKey(row.name), row]),
  );

  return {
    source_companies: historical.source_companies
      .map((company) => {
        const matched = productionCompanyBySlug.get(normalizeKey(company.company_slug));
        return matched
          ? { ...company, ...matched, origin: company.origin }
          : company;
      })
      .sort(byOwnerLabel),
    source_granularities: finalizeHistoricalGranularities(
      historical.source_granularities.map((granularity) => {
        const matched =
          productionByKey.get(normalizeKey(granularity.granularity_key)) ??
          productionByLabel.get(normalizeKey(granularity.owner_label));
        if (!matched) return granularity;
        return {
          ...granularity,
          id: matched.id,
          source_company_id: matched.source_company_id,
          company_slug: matched.company_slug,
          company_owner_label: matched.company_owner_label,
          granularity_key: matched.granularity_key,
          owner_label: matched.owner_label,
          crm_label: matched.crm_label,
          local: matched.local,
          active: matched.active,
          channel: granularity.channel ?? matched.channel,
        };
      }),
    ).sort(byOwnerLabel),
    agents: historical.agents
      .map((agent) => {
        const matched = productionAgentByName.get(normalizeKey(agent.name));
        return matched ? { ...agent, ...matched, origin: agent.origin } : agent;
      })
      .sort(byName),
    merchants: historical.merchants
      .map((merchant) => {
        const matched = productionMerchantByName.get(normalizeKey(merchant.name));
        return matched ? { ...merchant, ...matched, origin: merchant.origin } : merchant;
      })
      .sort(byName),
  };
}

function indexProductionGranularities(
  production: FilterCatalog,
  field: "granularity_key" | "owner_label",
): Map<string, FilterCatalogGranularity> {
  return new Map(
    production.source_granularities.map((row) => [normalizeKey(row[field]), row]),
  );
}

function hasKeyedGranularityForCompany(
  catalog: FilterCatalog,
  channel: "form" | "call",
  companyKey: string,
  productionByKey: Map<string, FilterCatalogGranularity>,
  productionByLabel: Map<string, FilterCatalogGranularity>,
): boolean {
  return catalog.source_granularities.some((row) => {
    if (row.channel !== channel) return false;
    const matched =
      productionByKey.get(normalizeKey(row.granularity_key)) ??
      productionByLabel.get(normalizeKey(row.owner_label));
    if (matched) return normalizeKey(matched.company_slug) === companyKey;
    return (
      Boolean(row.company_slug) &&
      normalizeKey(row.company_slug) === companyKey &&
      normalizeKey(row.granularity_key) !== companyKey
    );
  });
}

function finalizeHistoricalGranularities(
  rows: FilterCatalogGranularity[],
): FilterCatalogGranularity[] {
  const byKey = new Map<string, FilterCatalogGranularity>();
  for (const row of rows) {
    const key = normalizeKey(row.granularity_key);
    const existing = byKey.get(key);
    byKey.set(key, existing ? preferRicherGranularity(existing, row) : row);
  }
  const unique = Array.from(byKey.values());
  const keyedCompanySlugs = new Set(
    unique
      .filter(
        (row) =>
          row.company_slug &&
          normalizeKey(row.granularity_key) !== normalizeKey(row.company_slug),
      )
      .map((row) => normalizeKey(row.company_slug)),
  );
  return unique.filter((row) => {
    const isCompanySlugOption =
      Boolean(row.company_slug) &&
      normalizeKey(row.granularity_key) === normalizeKey(row.company_slug);
    return !(isCompanySlugOption && keyedCompanySlugs.has(normalizeKey(row.company_slug)));
  });
}

function preferRicherGranularity(
  left: FilterCatalogGranularity,
  right: FilterCatalogGranularity,
): FilterCatalogGranularity {
  if (left.id && !right.id) return left;
  if (right.id && !left.id) return right;
  const leftLabelIsKey = normalizeKey(left.owner_label) === normalizeKey(left.granularity_key);
  const rightLabelIsKey = normalizeKey(right.owner_label) === normalizeKey(right.granularity_key);
  if (leftLabelIsKey && !rightLabelIsKey) {
    return { ...left, owner_label: right.owner_label };
  }
  if (rightLabelIsKey && !leftLabelIsKey) {
    return { ...right, owner_label: left.owner_label };
  }
  return left;
}

function preferRegistryCompany(
  left: FilterCatalogCompany,
  right: FilterCatalogCompany,
): FilterCatalogCompany {
  if (left.origin === "registry") {
    return { ...left, owner_label: left.owner_label || right.owner_label };
  }
  if (right.origin === "registry") {
    return { ...right, owner_label: right.owner_label || left.owner_label };
  }
  return left;
}

function preferRegistryGranularity(
  left: FilterCatalogGranularity,
  right: FilterCatalogGranularity,
): FilterCatalogGranularity {
  const registry = left.origin === "registry" ? left : right.origin === "registry" ? right : null;
  const other = registry === left ? right : left;
  if (!registry) return left;
  return {
    ...registry,
    owner_label: registry.owner_label || other.owner_label,
    channel: registry.channel ?? other.channel,
  };
}

function preferRegistryNamed<T extends { origin: FilterCatalogOrigin; id: string; active: boolean }>(
  left: T,
  right: T,
): T {
  if (left.origin === "registry") return left;
  if (right.origin === "registry") return right;
  return left;
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

function cleanStrings(values: unknown[]): string[] {
  const seen = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return Array.from(seen.values()).sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" }),
  );
}

async function distinctStrings(
  model: { distinct: (field: string) => Promise<unknown[]> },
  field: string,
): Promise<string[]> {
  try {
    return cleanStrings(await model.distinct(field));
  } catch {
    return [];
  }
}

async function safeList<T>(load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch {
    return [];
  }
}
