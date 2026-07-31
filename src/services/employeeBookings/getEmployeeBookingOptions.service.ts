import { listCatalogItems, type CatalogItem } from "../catalog";
import {
  listSourceCompanies,
  listSourceGranularities,
  type SourceCompanyItem,
  type SourceGranularityItem,
} from "../operationsRegistry";

export type EmployeeBookingLeadSourceOption = {
  company_id: string;
  company_label: string;
  granularity_id: string;
  granularity_key: string;
  granularity_label: string;
  crm_label: string;
  channel: "form" | "call";
};

export type EmployeeBookingCatalogOption = {
  value: string;
  label: string;
};

export type EmployeeBookingOptions = {
  lead_sources: EmployeeBookingLeadSourceOption[];
  agents: EmployeeBookingCatalogOption[];
  merchants: EmployeeBookingCatalogOption[];
};

export function assembleEmployeeBookingOptions(input: {
  companies: readonly SourceCompanyItem[];
  granularities: readonly SourceGranularityItem[];
  agents: readonly CatalogItem[];
  merchants: readonly CatalogItem[];
}): EmployeeBookingOptions {
  const activeCompanies = new Map(
    input.companies
      .filter((company) => company.active === true)
      .map((company) => [company.id, company] as const),
  );

  const lead_sources = input.granularities
    .filter((granularity) => granularity.active === true)
    .flatMap((granularity) => {
      const company = activeCompanies.get(granularity.source_company);
      if (!company) {
        return [];
      }
      if (granularity.channel !== "form" && granularity.channel !== "call") {
        return [];
      }
      return [
        {
          company_id: company.id,
          company_label: company.owner_label,
          granularity_id: granularity.id,
          granularity_key: granularity.granularity_key,
          granularity_label: granularity.owner_label,
          crm_label: granularity.crm_label,
          channel: granularity.channel,
        } satisfies EmployeeBookingLeadSourceOption,
      ];
    })
    .sort((left, right) =>
      `${left.company_label} ${left.granularity_label}`.localeCompare(
        `${right.company_label} ${right.granularity_label}`,
      ),
    );

  return {
    lead_sources,
    agents: toCatalogOptions(input.agents),
    merchants: toCatalogOptions(input.merchants),
  };
}

export async function getEmployeeBookingOptions(): Promise<EmployeeBookingOptions> {
  const [companies, granularities, agents, merchants] = await Promise.all([
    listSourceCompanies(),
    listSourceGranularities(),
    listCatalogItems("agents"),
    listCatalogItems("merchants"),
  ]);

  return assembleEmployeeBookingOptions({
    companies,
    granularities,
    agents,
    merchants,
  });
}

function toCatalogOptions(
  items: readonly CatalogItem[],
): EmployeeBookingCatalogOption[] {
  return items
    .filter((item) => item.active === true)
    .map((item) => ({ value: item.name, label: item.name }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
