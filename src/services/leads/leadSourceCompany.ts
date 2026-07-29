import mongoose from "mongoose";
import { ValidationError } from "../errors";
import {
  type LeadSourceChannel,
} from "../leadSourceCompanies";
import {
  isRegistryError,
  resolveSourceAttribution,
  type SourceAttribution,
  type SourceAttributionInput,
} from "../operationsRegistry";
import type { LocalType } from "../../config/domain";

export async function resolveLeadSourceAssignment(input: {
  value?: string | null;
  company_slug?: string | null;
  granularity_key?: string | null;
  channel: LeadSourceChannel;
  local?: LocalType;
  source_site?: string | null;
  inbound_phone_number?: string | null;
  requireActive?: boolean;
}, deps: {
  resolver?: (input: SourceAttributionInput) => Promise<SourceAttribution>;
} = {}): Promise<{
  resolution: SourceAttribution;
  assignment: ReturnType<typeof sourceAssignmentFields>;
}> {
  const resolver = deps.resolver ?? resolveSourceAttribution;
  const explicitCompanySlug = normalize(input.company_slug);
  const normalizedValue = normalize(input.value);
  const companySlug =
    explicitCompanySlug ??
    (!normalizedValue || normalizedValue === "not_provided"
      ? "main_site"
      : normalizedValue);
  const registryInput: SourceAttributionInput = {
    channel: input.channel,
    company_slug: companySlug,
    granularity_key: input.granularity_key,
    crm_label:
      !explicitCompanySlug &&
      normalizedValue &&
      normalizedValue !== "not_provided"
        ? input.value
        : undefined,
    source_site: input.source_site,
    fallback_alias: input.value,
    local: input.local,
    allow_company_identifier_fallback:
      !explicitCompanySlug &&
      Boolean(normalizedValue && normalizedValue !== "not_provided"),
  };

  let resolution: SourceAttribution;
  try {
    resolution = await resolver(registryInput);
  } catch (error) {
    if (isRegistryError(error)) {
      throwAsSourceValidation(error);
    } else {
      throw error;
    }
  }

  return {
    resolution,
    assignment: sourceAssignmentFields(resolution),
  };
}

function sourceAssignmentFields(resolution: SourceAttribution) {
  return {
    source_company: resolution.company_slug,
    lead_source_company: mongoose.Types.ObjectId.createFromHexString(
      resolution.company_id,
    ),
    source_granularity_id: mongoose.Types.ObjectId.createFromHexString(
      resolution.granularity_id,
    ),
    source_granularity_key: resolution.granularity_key,
    source_company_label_snapshot: resolution.company_label_snapshot,
    source_granularity_label_snapshot:
      resolution.granularity_label_snapshot,
    crm_source_label_snapshot: resolution.crm_label_snapshot,
  };
}

function normalize(value?: string | null): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function throwAsSourceValidation(error: unknown): never {
  if (!isRegistryError(error)) throw error;
  throw new ValidationError(error.message, {
    metadata: {
      field: "source_company",
      registry_code: error.registryCode,
    },
  });
}
