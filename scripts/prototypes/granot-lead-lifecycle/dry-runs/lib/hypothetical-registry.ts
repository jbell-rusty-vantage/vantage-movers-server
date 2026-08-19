import { createHash } from "node:crypto";
import { getLeadSourceCompanyModel } from "../../../../../src/models/LeadSourceCompany.js";
import { getLeadSourceGranularityModel } from "../../../../../src/models/LeadSourceGranularity.js";
import { normalizeGranotSourceLabel } from "../../../../../src/services/granotLifecycle/sourceLabel.js";
import type {
  SourcePolicyRow,
  SourcePolicyStore,
} from "../../../../../src/services/granotLifecycle/sourcePolicy.js";
import type { GranotLeadCreatedPolicy } from "../../../../../src/services/granotLifecycle/types.js";
import type { LoadedGranularityRef, LoadedSourceCompanyRef } from "../../../../../src/models/granotCrmSourceSemantics.js";

export type CatalogCompany = {
  id: string;
  slug: string;
  label: string;
  active: boolean;
};

export type CatalogGranularity = {
  id: string;
  company_id: string;
  granularity_key: string;
  channel: "form" | "call";
  local?: "local" | "long_distance";
  crm_label?: string;
  aliases: string[];
  active: boolean;
};

export type ProductionCatalog = {
  companies: CatalogCompany[];
  granularities: CatalogGranularity[];
};

export type HypotheticalSource = {
  id: string;
  label: string;
  normalized_label: string;
  company_id?: string;
  company_slug?: string;
  disposition: SourcePolicyRow["lifecycle_disposition"];
  lead_created_policy: GranotLeadCreatedPolicy;
  routes: SourcePolicyRow["lifecycle_routes"];
};

const REFERRAL_LABELS = new Set(["referral"]);

export async function loadProductionCatalog(): Promise<ProductionCatalog> {
  const [companyRows, granularityRows] = await Promise.all([
    getLeadSourceCompanyModel().find({}).lean().exec(),
    getLeadSourceGranularityModel().find({}).lean().exec(),
  ]);
  return {
    companies: companyRows.map((row) => ({
      id: String(row._id),
      slug: row.company_slug,
      label: row.owner_label,
      active: row.active === true,
    })),
    granularities: granularityRows.map((row) => ({
      id: String(row._id),
      company_id: String(row.source_company),
      granularity_key: row.granularity_key,
      channel: row.channel === "call" ? "call" : "form",
      local: row.local === "local" || row.local === "long_distance" ? row.local : undefined,
      crm_label: row.crm_label || undefined,
      aliases: (row.aliases ?? []).filter((alias): alias is string => typeof alias === "string"),
      active: row.active === true,
    })),
  };
}

export function buildHypotheticalSources(
  catalog: ProductionCatalog,
  leadCreatedPolicy: GranotLeadCreatedPolicy,
): HypotheticalSource[] {
  const labels = new Set<string>();
  for (const granularity of catalog.granularities) {
    if (granularity.crm_label) labels.add(granularity.crm_label);
    for (const alias of granularity.aliases) labels.add(alias);
  }
  labels.add("Referral");

  const sources: HypotheticalSource[] = [];
  for (const label of [...labels].sort((a, b) => a.localeCompare(b))) {
    const normalized = normalizeGranotSourceLabel(label);
    if (!normalized) continue;
    if (sources.some((source) => source.normalized_label === normalized)) continue;

    if (REFERRAL_LABELS.has(normalized)) {
      sources.push({
        id: syntheticSourceId(normalized),
        label,
        normalized_label: normalized,
        disposition: "referral_booking",
        lead_created_policy: "observation_only",
        routes: [],
      });
      continue;
    }

    const matched = matchGranularities(normalized, catalog);
    if (matched.length === 0) continue;
    const companies = [...new Set(matched.map((row) => row.company_id))];
    if (companies.length !== 1) continue;
    const company = catalog.companies.find((row) => row.id === companies[0]);
    const channels = new Set(matched.map((row) => row.channel));
    if (channels.size !== 1) continue;

    const channel = [...channels][0]!;
    const usable =
      channel === "form"
        ? catalog.granularities.filter(
            (row) => row.company_id === company?.id && row.channel === "form",
          )
        : matched.filter((row) => row.channel === "call");

    sources.push({
      id: syntheticSourceId(normalized),
      label,
      normalized_label: normalized,
      company_id: company?.id,
      company_slug: company?.slug,
      disposition: "source_scoped_lead",
      lead_created_policy: leadCreatedPolicy,
      routes: usable.map((row) => ({
        route_key: `${row.channel}_${row.local ?? "any"}`,
        lead_model: row.channel === "call" ? "CallLead" : "FormLead",
        move_type: row.channel === "form" ? (row.local ?? "any") : "any",
        source_granularity_id: row.id,
      })),
    });
  }
  return sources;
}

export function createHypotheticalPolicyStore(
  catalog: ProductionCatalog,
  sources: HypotheticalSource[],
): SourcePolicyStore {
  const companies = new Map(catalog.companies.map((row) => [row.id, row]));
  const granularities = new Map(catalog.granularities.map((row) => [row.id, row]));
  return {
    async findByNormalizedLabel(label) {
      return sources
        .filter((source) => source.normalized_label === label)
        .map((source) => toPolicyRow(source));
    },
    async findCompany(id) {
      const row = companies.get(id);
      return row ? ({ id: row.id, active: row.active } satisfies LoadedSourceCompanyRef) : null;
    },
    async findGranularity(id) {
      const row = granularities.get(id);
      return row
        ? ({
            id: row.id,
            source_company_id: row.company_id,
            active: row.active,
            channel: row.channel,
            local: row.local,
          } satisfies LoadedGranularityRef)
        : null;
    },
  };
}

function matchGranularities(
  normalized: string,
  catalog: ProductionCatalog,
): CatalogGranularity[] {
  return catalog.granularities.filter((row) => {
    const labels = [row.crm_label, ...row.aliases]
      .map((value) => (value ? normalizeGranotSourceLabel(value) : undefined))
      .filter((value): value is string => Boolean(value));
    return labels.includes(normalized);
  });
}

function toPolicyRow(source: HypotheticalSource): SourcePolicyRow {
  return {
    id: source.id,
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: source.disposition,
    lead_created_policy: source.lead_created_policy,
    lead_source_company: source.company_id,
    lifecycle_routes: source.routes,
    lifecycle_policy_version: "dry-run-hypothetical-v1",
    normalized_granot_label: source.normalized_label,
  };
}

function syntheticSourceId(normalized: string): string {
  return createHash("sha256")
    .update(`dry-run-crm-source:${normalized}`)
    .digest("hex")
    .slice(0, 24);
}
