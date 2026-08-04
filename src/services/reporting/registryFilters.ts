import { getLeadSourceCompanyModel } from "../../models/LeadSourceCompany";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { reportingError, type RegistrySelectionSnapshot } from "./catalog";

export async function validateRegistrySelection(input: {
  companyKeys: string[];
  granularityKeys?: string[];
}): Promise<RegistrySelectionSnapshot> {
  const companyKeys = unique(input.companyKeys);
  const granularityKeys = unique(input.granularityKeys ?? []);
  if (!companyKeys.length || companyKeys.length !== input.companyKeys.length) {
    throw reportingError("invalid_registry_selection", "Company keys are required and must be unique.");
  }
  if (granularityKeys.length !== (input.granularityKeys ?? []).length) {
    throw reportingError("invalid_registry_selection", "Granularity keys must be unique.");
  }

  const companies = await getLeadSourceCompanyModel()
    .find({ company_slug: { $in: companyKeys }, active: true })
    .select("_id company_slug owner_label name")
    .lean()
    .exec();
  if (companies.length !== companyKeys.length) {
    throw reportingError("invalid_registry_selection", "Unknown or inactive Source Company key.");
  }
  const companyIds = new Set(companies.map((company) => String(company._id)));
  const granularities = granularityKeys.length
    ? await getLeadSourceGranularityModel()
        .find({ granularity_key: { $in: granularityKeys }, active: true })
        .select("_id granularity_key owner_label source_company")
        .lean()
        .exec()
    : [];
  if (
    granularities.length !== granularityKeys.length ||
    granularities.some((granularity) => !companyIds.has(String(granularity.source_company)))
  ) {
    throw reportingError("invalid_registry_selection", "Granularity must be active beneath a selected company.");
  }
  return {
    companies: companies
      .map((company) => ({
        id: String(company._id),
        key: company.company_slug,
        label: company.owner_label || company.name,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    granularities: granularities
      .map((granularity) => ({
        id: String(granularity._id),
        key: granularity.granularity_key,
        label: granularity.owner_label,
        companyId: String(granularity.source_company),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function registryMongoPredicate(snapshot: RegistrySelectionSnapshot) {
  const selectedByCompany = new Map<string, string[]>();
  for (const granularity of snapshot.granularities) {
    const keys = selectedByCompany.get(granularity.companyId) ?? [];
    keys.push(granularity.key);
    selectedByCompany.set(granularity.companyId, keys);
  }
  return {
    $or: snapshot.companies.map((company) => {
      const narrowed = selectedByCompany.get(company.id);
      return {
        lead_source_company: company.id,
        ...(narrowed?.length ? { source_granularity_key: { $in: narrowed } } : {}),
      };
    }),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}
