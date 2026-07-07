import {
  resolveSourceCompanyFromLabel,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { parseFloridaCalendarDate } from "../../utils/easternTime";
import { getStateCodeForZip } from "../../utils/location/pickupZipState";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type { BookedCallLeadReconciliationRowInput } from "../../validation/v1.validation";
import { ValidationError } from "../errors";
import { deriveLocal } from "../leads";
import { resolveLeadSourceAssignment } from "../leads/leadSourceCompany";

type ResolvedLeadSourceAssignment = Awaited<ReturnType<typeof resolveLeadSourceAssignment>>;

/**
 * Row-shaped parsing, validation, and cleaning helpers for the
 * Booked-Jobs/Follow-Up-Estimates reconciliation service.
 *
 * Kept local to the reconciliation folder because the row shape
 * (sections, prior, source label, book_date) is reconciliation-specific.
 * `deriveLocal` is reused from `services/leads` since it is identical.
 */

export type ParsedBookedCallLeadRow = {
  row_id: string;
  row_index?: number;
  section?: "bookedJobs" | "followUpEstimates";
  job_no?: string;
  source_company?: SourceCompany;
  source_assignment?: ResolvedLeadSourceAssignment["assignment"];
  source_cpl?: number;
  source_label?: string;
  prior?: string;
  book_date?: Date;
  name?: string;
  phone_number?: string;
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

export type ParsedBookedCallLeadRowWithWarnings = ParsedBookedCallLeadRow & {
  warnings?: string[];
};

const PLACEHOLDERS = new Set(["na", "n/a", "none", "null", "-", "--"]);

export async function parseBookedCallLeadRow(
  row: BookedCallLeadReconciliationRowInput,
): Promise<ParsedBookedCallLeadRowWithWarnings> {
  const warnings: string[] = [];
  const pickupZip = cleanZip(row.from_zip);
  const deliveryZip = cleanZip(row.to_zip);
  const [pickupState, deliveryState] = await Promise.all([
    pickupZip ? getStateCodeForZip(pickupZip) : undefined,
    deliveryZip ? getStateCodeForZip(deliveryZip) : undefined,
  ]);
  const local = pickupState && deliveryState ? deriveLocal(pickupState, deliveryState) : undefined;
  const sourceLabel = cleanValue(row.source);
  const legacySourceCompany = sourceLabel ? resolveSourceCompanyFromLabel(sourceLabel) : undefined;
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
    section: row.section,
    job_no: cleanValue(row.job_no),
    source_company:
      (sourceAssignment?.assignment.source_company as SourceCompany | undefined) ??
      legacySourceCompany,
    source_assignment: sourceAssignment?.assignment,
    source_cpl: sourceAssignment?.resolution.granularity.cpl,
    source_label: sourceLabel,
    prior: cleanValue(row.prior),
    book_date: parseOptionalDate(row.book_date, warnings),
    name: cleanValue(row.customer),
    phone_number: cleanValue(row.phone),
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

export function validateParsedRow(parsed: ParsedBookedCallLeadRow): string[] {
  const reasons: string[] = [];
  if (!parsed.job_no) {
    reasons.push("Missing required job_no.");
  }
  if (!parsed.source_label) {
    reasons.push("Missing required source.");
  } else if (!parsed.source_company) {
    reasons.push(`Unknown source "${parsed.source_label}".`);
  }
  if (parsed.section !== "bookedJobs" && parsed.prior !== "5") {
    reasons.push("Row is not from Booked Jobs and prior is not 5.");
  }
  return reasons;
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

export function parseOptionalDate(
  value: string | null | undefined,
  warnings: string[],
): Date | undefined {
  const cleaned = cleanValue(value);
  if (!cleaned) {
    return undefined;
  }
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    warnings.push(`Skipped invalid book_date value "${cleaned}".`);
    return undefined;
  }
  const [, month, day, year] = match;
  try {
    return parseFloridaCalendarDate(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
  } catch {
    warnings.push(`Skipped invalid book_date value "${cleaned}".`);
    return undefined;
  }
}
