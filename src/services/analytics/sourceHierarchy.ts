import { SOURCE_COMPANY_CONFIGS } from "../../config/domain/sources";
import {
  type SourceCompanyItem,
  type SourceGranularityItem,
} from "../operationsRegistry/sourceRegistry";
import { getAdminFacets } from "../admin/adminFacets.service";
import type { FilterCatalog, FilterCatalogGranularity } from "../admin/filterCatalog";
import {
  normalizeDimension,
  normalizeSourceDimension,
  numberValue,
  type AnalyticsRow,
} from "./analyticsFilters";

export type SourceGranularityMetricRow = AnalyticsRow & {
  source_granularity_key: string;
  source_granularity_label: string;
  channel?: string | null;
};

export type SourceCompanyMetricRow = AnalyticsRow & {
  source_company: string;
  source_company_label: string;
  granularities: SourceGranularityMetricRow[];
};

export type SourceLabelIndex = {
  companyBySlug: Map<string, { label: string }>;
  granularityByKey: Map<
    string,
    { label: string; channel?: string | null; companySlug: string }
  >;
};

export type NestSourceRowsOptions = {
  additiveFields: readonly string[];
  catalog?: FilterCatalog;
  channel?: "form" | "call";
  seedZeros?: boolean;
  derive?: (row: AnalyticsRow) => AnalyticsRow;
  sort?: (left: SourceCompanyMetricRow, right: SourceCompanyMetricRow) => number;
};

export async function loadProductionSourceLabelIndex(): Promise<SourceLabelIndex> {
  const facets = await getAdminFacets("production");
  return sourceLabelIndexFromCatalog(facets.catalog);
}

export function sourceLabelIndexFromCatalog(catalog: FilterCatalog): SourceLabelIndex {
  const companyBySlug = new Map<string, { label: string }>();
  for (const company of catalog.source_companies) {
    companyBySlug.set(normalizeSourceDimension(company.company_slug), {
      label: company.owner_label,
    });
  }
  const granularityByKey = new Map<
    string,
    { label: string; channel?: string | null; companySlug: string }
  >();
  for (const granularity of catalog.source_granularities) {
    granularityByKey.set(normalizeDimension(granularity.granularity_key).toLowerCase(), {
      label: granularity.owner_label,
      channel: granularity.channel ?? null,
      companySlug: normalizeSourceDimension(granularity.company_slug || granularity.company_owner_label),
    });
  }
  return { companyBySlug, granularityByKey };
}

export function catalogChannelFromLeadType(
  leadType?: "FormLead" | "CallLead" | string,
): "form" | "call" | undefined {
  if (leadType === "FormLead" || leadType === "form") return "form";
  if (leadType === "CallLead" || leadType === "call") return "call";
  return undefined;
}

export async function nestObservedSourceRows(
  leaves: readonly AnalyticsRow[],
  query: { database_scope: "production" | "historical" | "combined"; lead_type?: string },
  options: NestSourceRowsOptions,
): Promise<SourceCompanyMetricRow[]> {
  const catalog = (await getAdminFacets(query.database_scope)).catalog;
  const channel = catalogChannelFromLeadType(query.lead_type);
  const labels = sourceLabelIndexFromCatalog(catalog);
  const hasGranularityKeys = leaves.some((leaf) => {
    const key = sourceGranularityFromRow(leaf);
    return Boolean(key && key !== "unknown");
  });
  if (query.database_scope === "historical" && !hasGranularityKeys) {
    return companyOnlySourceRows(leaves, { ...options, catalog });
  }
  return nestSourceCompanyRows(leaves, labels, {
    ...options,
    catalog,
    channel,
    seedZeros: query.database_scope !== "historical",
  });
}

export function buildSourceLabelIndex(
  companies: readonly Pick<SourceCompanyItem, "id" | "company_slug" | "owner_label" | "name">[],
  granularities: readonly Pick<
    SourceGranularityItem,
    "source_company" | "granularity_key" | "owner_label" | "crm_label" | "channel"
  >[],
): SourceLabelIndex {
  const companyBySlug = new Map<string, { label: string }>();
  const companySlugById = new Map<string, string>();
  for (const company of companies) {
    const slug = normalizeSourceDimension(company.company_slug);
    companySlugById.set(String(company.id), slug);
    companyBySlug.set(slug, {
      label: company.owner_label || company.name || fallbackCompanyLabel(slug),
    });
  }

  const granularityByKey = new Map<
    string,
    { label: string; channel?: string | null; companySlug: string }
  >();
  for (const granularity of granularities) {
    const key = normalizeDimension(granularity.granularity_key).toLowerCase();
    const companyReference = String(granularity.source_company);
    const companySlug =
      companySlugById.get(companyReference) ?? normalizeSourceDimension(companyReference);
    granularityByKey.set(key, {
      label:
        granularity.owner_label ||
        granularity.crm_label ||
        humanizeSourceKey(granularity.granularity_key),
      channel: granularity.channel ?? null,
      companySlug,
    });
  }
  return { companyBySlug, granularityByKey };
}

export function nestSourceCompanyRows(
  leaves: readonly AnalyticsRow[],
  labels: SourceLabelIndex,
  options: NestSourceRowsOptions,
): SourceCompanyMetricRow[] {
  const catalogLabels = options.catalog
    ? sourceLabelIndexFromCatalog(options.catalog)
    : labels;
  const effectiveLeaves = options.catalog
    ? seedCatalogLeaves(leaves, options.catalog, options)
    : leaves;
  const companies = new Map<
    string,
    {
      row: SourceCompanyMetricRow;
      children: Map<string, AnalyticsRow>;
    }
  >();
  for (const input of effectiveLeaves) {
    const sourceCompany = sourceCompanyFromRow(input);
    const granularityKey = sourceGranularityFromRow(input);
    const label = catalogLabels.granularityByKey.get(granularityKey);
    const child: AnalyticsRow = {
      ...withoutAggregateId(input),
      source_company: sourceCompany,
      source_granularity_key: granularityKey,
      source_granularity_label: label?.label ?? humanizeSourceKey(granularityKey),
      channel: label?.channel ?? null,
    };
    const companyEntry =
      companies.get(sourceCompany) ??
      {
        row: {
          source_company: sourceCompany,
          source_company_label: resolveCompanyLabel(sourceCompany, catalogLabels),
          granularities: [],
        } as SourceCompanyMetricRow,
        children: new Map<string, AnalyticsRow>(),
      };
    const existingChild = companyEntry.children.get(granularityKey);
    if (existingChild) {
      for (const field of options.additiveFields) {
        existingChild[field] =
          numberValue(existingChild[field]) + numberValue(child[field]);
      }
    } else {
      companyEntry.children.set(granularityKey, child);
    }
    companies.set(sourceCompany, companyEntry);
  }

  const rows = Array.from(companies.values()).map(({ row: company, children }) => {
    company.granularities = Array.from(children.values()).map((child) =>
      (options.derive?.(child) ?? child) as SourceGranularityMetricRow
    );
    for (const field of options.additiveFields) {
      company[field] = company.granularities.reduce(
        (sum, child) => sum + numberValue(child[field]),
        0,
      );
    }
    company.granularities.sort((left, right) =>
      left.source_granularity_label.localeCompare(right.source_granularity_label),
    );
    return (options.derive?.(company) ?? company) as SourceCompanyMetricRow;
  });
  return rows.sort(options.sort ?? defaultSourceSort);
}

export function companyOnlySourceRows(
  rows: readonly AnalyticsRow[],
  options: Pick<NestSourceRowsOptions, "derive" | "sort" | "catalog"> = {},
): SourceCompanyMetricRow[] {
  const labels = options.catalog ? sourceLabelIndexFromCatalog(options.catalog) : undefined;
  return rows
    .map((input) => {
      const sourceCompany = sourceCompanyFromRow(input);
      const base: SourceCompanyMetricRow = {
        ...withoutAggregateId(input),
        source_company: sourceCompany,
        source_company_label: labels
          ? resolveCompanyLabel(sourceCompany, labels)
          : fallbackCompanyLabel(sourceCompany),
        granularities: [],
      };
      return (options.derive?.(base) ?? base) as SourceCompanyMetricRow;
    })
    .sort(options.sort ?? defaultSourceSort);
}

export function sourceCompanyFromRow(row: AnalyticsRow): string {
  const aggregateId = objectValue(row._id);
  return normalizeSourceDimension(
    row.source_company ?? aggregateId.source_company ?? row._id,
  );
}

export function sourceGranularityFromRow(row: AnalyticsRow): string {
  const aggregateId = objectValue(row._id);
  return normalizeDimension(
    row.source_granularity_key ?? aggregateId.source_granularity_key,
  ).toLowerCase();
}

export function resolveCompanyLabel(sourceCompany: string, labels: SourceLabelIndex): string {
  return labels.companyBySlug.get(sourceCompany)?.label ?? fallbackCompanyLabel(sourceCompany);
}

export function fallbackCompanyLabel(sourceCompany: string): string {
  const config =
    SOURCE_COMPANY_CONFIGS[sourceCompany as keyof typeof SOURCE_COMPANY_CONFIGS];
  return config?.label ?? humanizeSourceKey(sourceCompany);
}

export function humanizeSourceKey(value: string): string {
  if (value === "unknown") return "Unknown";
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function seedCatalogLeaves(
  observed: readonly AnalyticsRow[],
  catalog: FilterCatalog,
  options: NestSourceRowsOptions,
): AnalyticsRow[] {
  const candidates = catalog.source_granularities.filter((row) =>
    granularityInChannelScope(row, options.channel),
  );
  const observedByKey = new Map<string, AnalyticsRow>();
  const extras: AnalyticsRow[] = [];
  for (const leaf of observed) {
    const key = sourceGranularityFromRow(leaf);
    if (!key || key === "unknown") {
      extras.push(leaf);
      continue;
    }
    const existing = observedByKey.get(key);
    if (!existing) {
      observedByKey.set(key, { ...withoutAggregateId(leaf) });
      continue;
    }
    for (const field of options.additiveFields) {
      existing[field] = numberValue(existing[field]) + numberValue(leaf[field]);
    }
  }

  const seeded: AnalyticsRow[] = [];
  for (const candidate of candidates) {
    const key = candidate.granularity_key.toLowerCase();
    const observedLeaf = observedByKey.get(key);
    observedByKey.delete(key);
    if (observedLeaf) {
      seeded.push({
        ...observedLeaf,
        source_company: candidate.company_slug || sourceCompanyFromRow(observedLeaf),
        source_granularity_key: candidate.granularity_key,
        source_granularity_label: candidate.owner_label,
        channel: candidate.channel ?? null,
      });
      continue;
    }
    if (options.seedZeros === false) continue;
    const zeroLeaf: AnalyticsRow = {
      source_company: candidate.company_slug,
      source_granularity_key: candidate.granularity_key,
      source_granularity_label: candidate.owner_label,
      channel: candidate.channel ?? null,
    };
    for (const field of options.additiveFields) {
      zeroLeaf[field] = 0;
    }
    seeded.push(zeroLeaf);
  }

  for (const leftover of observedByKey.values()) extras.push(leftover);
  return [...seeded, ...extras];
}

function granularityInChannelScope(
  row: FilterCatalogGranularity,
  channel?: "form" | "call",
): boolean {
  if (!channel) return true;
  return row.channel === channel;
}

function withoutAggregateId(row: AnalyticsRow): AnalyticsRow {
  const { _id: _ignored, ...rest } = row;
  return rest;
}

function objectValue(value: unknown): AnalyticsRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnalyticsRow)
    : {};
}

function defaultSourceSort(
  left: SourceCompanyMetricRow,
  right: SourceCompanyMetricRow,
): number {
  return (
    numberValue(right.total_deposit_amount) - numberValue(left.total_deposit_amount) ||
    numberValue(right.total_lead_cost) - numberValue(left.total_lead_cost) ||
    numberValue(right.bookings) - numberValue(left.bookings) ||
    left.source_company_label.localeCompare(right.source_company_label)
  );
}
