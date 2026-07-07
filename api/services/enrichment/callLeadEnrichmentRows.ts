import {
  resolveSourceCompany,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { ValidationError } from "../errors";
import { getStateCodeForZip } from "../../utils/location/pickupZipState";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type { CallLeadEnrichmentRowInput } from "../../validation/v1.validation";
import { deriveLocal } from "../leads";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";

type ResolvedLeadSourceAssignment = Awaited<ReturnType<typeof resolveLeadSourceAssignment>>;

/**
 * Row-shaped parsing, validation, and cleaning helpers for the call lead
 * enrichment service.
 *
 * Kept local to the enrichment folder because the placeholder set, email
 * validation, and the parsed row shape are specific to CRM enrichment rows.
 * `deriveLocal` is reused from `services/leads` since it is identical.
 */

export type ParsedCallLeadEnrichmentRow = {
  row_id: string;
  row_index?: number;
  job_no?: string;
  source_company?: SourceCompany;
  source_label?: string;
  source_assignment?: ResolvedLeadSourceAssignment["assignment"];
  source_cpl?: number;
  name?: string;
  phone?: string;
  granot_crm_username?: string;
  normalized_phone_number?: string;
  email?: string;
  pickup_zip?: string;
  delivery_zip?: string;
  pickup_state?: string;
  delivery_state?: string;
  local?: LocalType;
  cubic_feet?: number;
};

export type ParsedCallLeadEnrichmentRowWithWarnings = ParsedCallLeadEnrichmentRow & {
  warnings?: string[];
};

const PLACEHOLDERS = new Set(["na", "n/a", "none", "null", "-", "--"]);

export async function parseEnrichmentRow(
  row: CallLeadEnrichmentRowInput,
): Promise<ParsedCallLeadEnrichmentRowWithWarnings> {
  const warnings: string[] = [];
  const pickupZip = cleanZip(row.from_zip);
  const deliveryZip = cleanZip(row.to_zip);
  const [pickupState, deliveryState] = await Promise.all([
    pickupZip ? getStateCodeForZip(pickupZip) : undefined,
    deliveryZip ? getStateCodeForZip(deliveryZip) : undefined,
  ]);
  const local = pickupState && deliveryState ? deriveLocal(pickupState, deliveryState) : undefined;
  if (pickupZip && !pickupState) {
    warnings.push(`Could not resolve state for from_zip ${pickupZip}.`);
  }
  if (deliveryZip && !deliveryState) {
    warnings.push(`Could not resolve state for to_zip ${deliveryZip}.`);
  }
  const sourceLabel = cleanValue(row.source);
  const legacySourceCompany = resolveSourceCompany(sourceLabel);
  let sourceAssignment: ResolvedLeadSourceAssignment | undefined;
  if (sourceLabel && shouldResolveCatalogSource()) {
    try {
      sourceAssignment = await resolveLeadSourceAssignment({
        channel: "call",
        value: sourceLabel,
        company_slug: legacySourceCompany,
        local,
      });
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }
      warnings.push(`Skipped unknown source "${sourceLabel}".`);
    }
  }

  return {
    row_id: row.row_id,
    row_index: row.row_index,
    job_no: cleanRequired(row.job_no),
    source_company:
      (sourceAssignment?.assignment.source_company as SourceCompany | undefined) ??
      legacySourceCompany,
    source_label: sourceLabel,
    source_assignment: sourceAssignment?.assignment,
    source_cpl: sourceAssignment?.resolution.granularity.cpl,
    name: cleanValue(row.customer),
    phone: cleanValue(row.phone),
    granot_crm_username: cleanValue(row.granot_crm_username),
    normalized_phone_number: normalizePhoneNumberForMatch(row.phone),
    email: cleanEmail(row.email, warnings),
    pickup_zip: pickupZip,
    delivery_zip: deliveryZip,
    pickup_state: pickupState,
    delivery_state: deliveryState,
    local,
    cubic_feet: parseOptionalNumber(row.est_cf, warnings),
    warnings,
  };
}

function shouldResolveCatalogSource(): boolean {
  return process.env.VANTAGE_TEST_RUNNER !== "true";
}

export function validateParsedRow(parsed: ParsedCallLeadEnrichmentRow): string[] {
  const reasons: string[] = [];
  if (!parsed.normalized_phone_number && !parsed.job_no) {
    reasons.push("Cannot match: row has neither a valid phone number nor a job_no.");
  }
  return reasons;
}

export function cleanRequired(value?: string | null): string | undefined {
  return cleanValue(value);
}

export function cleanValue(value?: string | null): string | undefined {
  const cleaned = value?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || PLACEHOLDERS.has(cleaned.toLowerCase())) {
    return undefined;
  }
  return cleaned;
}

export function cleanZip(value?: string | null): string | undefined {
  const cleaned = cleanValue(value);
  return cleaned && /^\d{5}$/.test(cleaned) ? cleaned : undefined;
}

export function cleanEmail(value: string | null | undefined, warnings: string[]): string | undefined {
  const cleaned = cleanValue(value)?.toLowerCase();
  if (!cleaned) {
    return undefined;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    warnings.push(`Skipped invalid email value "${cleaned}".`);
    return undefined;
  }
  return cleaned;
}

export function parseOptionalNumber(
  value: string | null | undefined,
  warnings: string[],
): number | undefined {
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return undefined;
  }
  const parsed = Number(cleaned.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) {
    warnings.push(`Skipped invalid est_cf value "${cleaned}".`);
    return undefined;
  }
  return parsed;
}
