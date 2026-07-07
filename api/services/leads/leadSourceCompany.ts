import { resolveSourceCompany, type SourceCompany } from "../../config/domain";
import { ValidationError } from "../errors";
import {
  leadSourceAssignmentFields,
  resolveLeadSource,
  type LeadSourceChannel,
  type LeadSourceResolution,
} from "../leadSourceCompanies";
import type { LocalType } from "../../config/domain";

/**
 * Service-level wrapper around `resolveSourceCompany` that converts an
 * unresolved source company into a 400 `ValidationError`.
 *
 * Centralizing this here keeps the rejection contract for unknown
 * `source_company` values in one place, even when callers (form lead, call
 * lead, booking-from-source) come from different service folders.
 */
export function parseSourceCompany(value?: string | null): SourceCompany {
  const sourceCompany = resolveSourceCompany(value);
  if (!sourceCompany) {
    throw new ValidationError(`Unknown source_company "${value}"`, {
      metadata: { field: "source_company", value: value ?? null },
    });
  }

  return sourceCompany;
}

export async function resolveLeadSourceAssignment(input: {
  value?: string | null;
  company_slug?: string | null;
  granularity_key?: string | null;
  channel: LeadSourceChannel;
  local?: LocalType;
  source_site?: string | null;
  inbound_phone_number?: string | null;
  requireActive?: boolean;
}): Promise<{
  resolution: LeadSourceResolution;
  assignment: ReturnType<typeof leadSourceAssignmentFields>;
}> {
  const resolution = await resolveLeadSource(input);
  return {
    resolution,
    assignment: leadSourceAssignmentFields(resolution),
  };
}
