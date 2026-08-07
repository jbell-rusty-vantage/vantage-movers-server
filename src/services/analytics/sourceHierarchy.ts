import { SOURCE_COMPANY_CONFIGS } from "../../config/domain/sources";
import {
  listSourceCompanies,
  listSourceGranularities,
  type SourceCompanyItem,
  type SourceGranularityItem,
} from "../operationsRegistry/sourceRegistry";
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
  derive?: (row: AnalyticsRow) => AnalyticsRow;
  sort?: (left: SourceCompanyMetricRow, right: SourceCompanyMetricRow) => number;
};

export async function loadProductionSourceLabelIndex(): Promise<SourceLabelIndex> {
  const [companies, granularities] = await Promise.all([
    listSourceCompanies({ includeInactive: true }),
    listSourceGranularities({ includeInactive: true }),
  ]);
  return buildSourceLabelIndex(companies, granularities);
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
  const companies = new Map<
    string,
    {
      row: SourceCompanyMetricRow;
      children: Map<string, AnalyticsRow>;
    }
  >();
  for (const input of leaves) {
    const sourceCompany = sourceCompanyFromRow(input);
    const granularityKey = sourceGranularityFromRow(input);
    const label = labels.granularityByKey.get(granularityKey);
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
          source_company_label: resolveCompanyLabel(sourceCompany, labels),
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
  options: Pick<NestSourceRowsOptions, "derive" | "sort"> = {},
): SourceCompanyMetricRow[] {
  return rows
    .map((input) => {
      const sourceCompany = sourceCompanyFromRow(input);
      const base: SourceCompanyMetricRow = {
        ...withoutAggregateId(input),
        source_company: sourceCompany,
        source_company_label: fallbackCompanyLabel(sourceCompany),
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
