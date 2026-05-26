import type { HydratedDocument } from "mongoose";
import { getCplForSource, type LocalType, type SourceCompany } from "../config/domain";
import { CallLead, type CallLeadDocument } from "../models/CallLead";
import { getStateCodeForZip } from "../utils/pickupZipState";
import { normalizePhoneNumberForMatch } from "../utils/phone";
import type {
  CallLeadEnrichmentBatchInput,
  CallLeadEnrichmentRowInput,
} from "../validation/v1.validation";
import { scheduleCallLeadSheetSync } from "./v1.service";

export type CallLeadEnrichmentStatus =
  | "updateable"
  | "updated"
  | "unchanged"
  | "conflict"
  | "no_match"
  | "invalid"
  | "failed";

export type CallLeadMatchMethod =
  | "phone_and_job_no"
  | "phone_only"
  | "job_no_only"
  | "none";

export type CallLeadEnrichmentResult = {
  row_id: string;
  status: CallLeadEnrichmentStatus;
  message: string;
  call_lead_id?: string;
  matched_phone_number?: string;
  job_no?: string;
  /** How we found the matched call lead in the database. */
  match_method?: CallLeadMatchMethod;
  /** Whether the matched call lead has a booking attached (BookedLead present). */
  has_booking?: boolean;
  changes: string[];
  warnings: string[];
  parsed?: ParsedCallLeadEnrichmentRow;
};

type ParsedCallLeadEnrichmentRow = {
  row_id: string;
  row_index?: number;
  job_no?: string;
  name?: string;
  phone?: string;
  normalized_phone_number?: string;
  email?: string;
  pickup_zip?: string;
  delivery_zip?: string;
  pickup_state?: string;
  delivery_state?: string;
  local?: LocalType;
  cubic_feet?: number;
};

type ResolvedEnrichment = {
  result: CallLeadEnrichmentResult;
  lead?: HydratedDocument<CallLeadDocument>;
  update?: Partial<CallLeadDocument>;
};

const PLACEHOLDERS = new Set(["na", "n/a", "none", "null", "-", "--"]);

export async function previewCallLeadEnrichment(
  input: CallLeadEnrichmentBatchInput,
): Promise<CallLeadEnrichmentResult[]> {
  const results: CallLeadEnrichmentResult[] = [];
  for (const row of input.rows) {
    results.push((await resolveEnrichmentRow(row)).result);
  }
  return results;
}

export async function syncCallLeadEnrichment(
  input: CallLeadEnrichmentBatchInput,
): Promise<CallLeadEnrichmentResult[]> {
  const results: CallLeadEnrichmentResult[] = [];
  for (const row of input.rows) {
    try {
      const resolved = await resolveEnrichmentRow(row);
      if (resolved.result.status !== "updateable" || !resolved.lead || !resolved.update) {
        results.push(resolved.result);
        continue;
      }

      Object.assign(resolved.lead, resolved.update);
      if (resolved.update.local) {
        resolved.lead.cpl = getCplForSource(
          resolved.lead.source_company as SourceCompany,
          resolved.update.local as LocalType,
        );
      }
      await resolved.lead.save();
      scheduleCallLeadSheetSync(resolved.lead._id.toString(), "call_lead.enrichment.sync");
      results.push({
        ...resolved.result,
        status: "updated",
        message: `Updated call lead ${resolved.lead._id.toString()}.`,
      });
    } catch (error) {
      results.push({
        row_id: row.row_id,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        changes: [],
        warnings: [],
      });
    }
  }
  return results;
}

async function resolveEnrichmentRow(
  row: CallLeadEnrichmentRowInput,
): Promise<ResolvedEnrichment> {
  const parsed = await parseEnrichmentRow(row);
  const base = resultBase(row.row_id, parsed);
  const invalidReasons = validateParsedRow(parsed);
  if (invalidReasons.length > 0) {
    return {
      result: {
        ...base,
        status: "invalid",
        message: invalidReasons.join(" "),
      },
    };
  }

  const { lead, warnings, matchMethod } = await findBestCallLeadMatch(
    parsed.normalized_phone_number,
    parsed.job_no,
  );
  if (!lead) {
    const identityParts: string[] = [];
    if (parsed.normalized_phone_number) {
      identityParts.push(`phone ${parsed.normalized_phone_number}`);
    }
    if (parsed.job_no) {
      identityParts.push(`job_no ${parsed.job_no}`);
    }
    const identity = identityParts.length ? identityParts.join(" or ") : "the provided identifiers";
    return {
      result: {
        ...base,
        status: "no_match",
        match_method: "none",
        message: `Not found in Vantage by ${identity}. This can happen if the customer's phone has been switched in Granot or the lead is older than the system's retention window.`,
      },
    };
  }

  const leadId = lead._id.toString();
  base.call_lead_id = leadId;
  base.matched_phone_number = lead.phone_number ?? undefined;
  base.match_method = matchMethod;
  base.has_booking = Boolean(lead.booked);
  base.warnings.push(...warnings);

  const existingJobNo = cleanValue(lead.job_no);
  const hasJobConflict =
    Boolean(existingJobNo) && existingJobNo !== parsed.job_no;
  if (hasJobConflict) {
    base.warnings.push(
      `Existing call lead already has job_no ${existingJobNo}; CRM row has ${parsed.job_no}. The job_no will be left as-is during sync.`,
    );
  }

  const update = buildUpdate(lead, parsed, base.warnings, {
    skipJobNo: hasJobConflict,
  });
  const changes = Object.keys(update);

  if (lead.booked) {
    if (changes.length === 0) {
      return {
        lead,
        result: {
          ...base,
          status: "unchanged",
          message: buildBookingAttachedMessage(matchMethod, true),
        },
      };
    }
    return {
      lead,
      update,
      result: {
        ...base,
        status: "updateable",
        message: buildBookingAttachedMessage(matchMethod, false, changes.length),
        changes,
      },
    };
  }

  if (changes.length === 0) {
    return {
      lead,
      result: {
        ...base,
        status: "unchanged",
        message: buildNoBookingMessage(matchMethod, true),
      },
    };
  }

  return {
    lead,
    update,
    result: {
      ...base,
      status: "updateable",
      message: buildNoBookingMessage(matchMethod, false, changes.length),
      changes,
    },
  };
}

function buildBookingAttachedMessage(
  method: CallLeadMatchMethod | undefined,
  upToDate: boolean,
  changeCount = 0,
): string {
  const how = formatMatchMethod(method);
  if (upToDate) {
    return `Found call lead ${how}. This call lead already has a booking attached; running sync is idempotent (no fields will change).`;
  }
  return `Found call lead ${how}. This call lead has a booking attached, but ${changeCount} field(s) on the call lead will be refreshed from the CRM row.`;
}

function buildNoBookingMessage(
  method: CallLeadMatchMethod | undefined,
  upToDate: boolean,
  changeCount = 0,
): string {
  const how = formatMatchMethod(method);
  if (upToDate) {
    return `Found call lead ${how}. No booking attached and all fields already match; running sync is idempotent.`;
  }
  return `Found call lead ${how}. No booking attached. Sync will update ${changeCount} field(s) on the call lead.`;
}

function formatMatchMethod(method: CallLeadMatchMethod | undefined): string {
  switch (method) {
    case "phone_and_job_no":
      return "by phone_number AND job_no";
    case "phone_only":
      return "by phone_number only";
    case "job_no_only":
      return "by job_no only";
    default:
      return "in Vantage";
  }
}

async function parseEnrichmentRow(
  row: CallLeadEnrichmentRowInput,
): Promise<ParsedCallLeadEnrichmentRow> {
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

  const parsed: ParsedCallLeadEnrichmentRow & { warnings?: string[] } = {
    row_id: row.row_id,
    row_index: row.row_index,
    job_no: cleanRequired(row.job_no),
    name: cleanValue(row.customer),
    phone: cleanValue(row.phone),
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

  return parsed;
}

function validateParsedRow(parsed: ParsedCallLeadEnrichmentRow): string[] {
  const reasons: string[] = [];
  if (!parsed.normalized_phone_number && !parsed.job_no) {
    reasons.push(
      "Cannot match: row has neither a valid phone number nor a job_no.",
    );
  }
  return reasons;
}

async function findBestCallLeadMatch(
  normalizedPhone: string | undefined,
  jobNo: string | undefined,
): Promise<{
  lead?: HydratedDocument<CallLeadDocument>;
  warnings: string[];
  matchMethod: CallLeadMatchMethod;
}> {
  const candidates = normalizedPhone
    ? (
        await CallLead.find({
          $or: [
            { normalized_phone_number: normalizedPhone },
            { phone_number: buildPhoneRegex(normalizedPhone) },
          ],
        })
          .sort({ createdAt: -1 })
          .limit(25)
          .exec()
      ).filter(
        (lead) =>
          normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone,
      )
    : [];

  if (candidates.length > 0) {
    const activeCandidates = candidates.filter(
      (lead) => !lead.booked && !lead.cancelled,
    );
    const ranked = activeCandidates.length > 0 ? activeCandidates : candidates;
    ranked.sort(compareCallLeadRecency);
    const warnings: string[] = [];
    if (candidates.length > 1) {
      warnings.push(
        `Multiple call leads matched phone ${normalizedPhone}; selected newest eligible lead.`,
      );
    }
    const selected = ranked[0];
    const selectedJobNo = cleanValue(selected.job_no);
    const matchMethod: CallLeadMatchMethod =
      jobNo && selectedJobNo === jobNo ? "phone_and_job_no" : "phone_only";
    return { lead: selected, warnings, matchMethod };
  }

  if (jobNo) {
    const byJobNo = await CallLead.find({ job_no: jobNo })
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();
    if (byJobNo.length > 0) {
      byJobNo.sort(compareCallLeadRecency);
      const warnings: string[] = [];
      if (byJobNo.length > 1) {
        warnings.push(
          `Multiple call leads matched job_no ${jobNo}; selected newest eligible lead.`,
        );
      }
      return {
        lead: byJobNo[0],
        warnings,
        matchMethod: "job_no_only",
      };
    }
  }

  return { warnings: [], matchMethod: "none" };
}

function buildUpdate(
  lead: HydratedDocument<CallLeadDocument>,
  parsed: ParsedCallLeadEnrichmentRow,
  warnings: string[],
  options?: { skipJobNo?: boolean },
): Partial<CallLeadDocument> {
  const update: Partial<CallLeadDocument> = {};
  if (!options?.skipJobNo) {
    assignIfChanged(update, lead, "job_no", parsed.job_no);
  }
  assignIfChanged(update, lead, "name", parsed.name);
  assignIfChanged(update, lead, "email", parsed.email);
  assignIfChanged(update, lead, "pickup_zip", parsed.pickup_zip);
  assignIfChanged(update, lead, "delivery_zip", parsed.delivery_zip);
  assignIfChanged(update, lead, "pickup_state", parsed.pickup_state);
  assignIfChanged(update, lead, "delivery_state", parsed.delivery_state);
  assignNumberIfChanged(update, lead, "cubic_feet", parsed.cubic_feet);

  if (parsed.local) {
    assignIfChanged(update, lead, "local", parsed.local);
  } else if (lead.local) {
    warnings.push("Preserved existing local value because one or both states were unresolved.");
  }

  return update;
}

function assignIfChanged<K extends keyof CallLeadDocument>(
  update: Partial<CallLeadDocument>,
  lead: HydratedDocument<CallLeadDocument>,
  key: K,
  value: CallLeadDocument[K] | undefined,
) {
  if (value === undefined || value === null) {
    return;
  }
  if (String(lead[key] ?? "") === String(value)) {
    return;
  }
  update[key] = value;
}

function assignNumberIfChanged<K extends keyof CallLeadDocument>(
  update: Partial<CallLeadDocument>,
  lead: HydratedDocument<CallLeadDocument>,
  key: K,
  value: number | undefined,
) {
  if (value === undefined) {
    return;
  }
  if (Number(lead[key]) === value) {
    return;
  }
  update[key] = value as CallLeadDocument[K];
}

function resultBase(
  rowId: string,
  parsed: ParsedCallLeadEnrichmentRow & { warnings?: string[] },
): CallLeadEnrichmentResult {
  return {
    row_id: rowId,
    status: "invalid",
    message: "",
    job_no: parsed.job_no,
    parsed,
    changes: [],
    warnings: parsed.warnings ?? [],
  };
}

function cleanRequired(value?: string | null): string | undefined {
  return cleanValue(value);
}

function cleanValue(value?: string | null): string | undefined {
  const cleaned = value?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned || PLACEHOLDERS.has(cleaned.toLowerCase())) {
    return undefined;
  }
  return cleaned;
}

function cleanZip(value?: string | null): string | undefined {
  const cleaned = cleanValue(value);
  return cleaned && /^\d{5}$/.test(cleaned) ? cleaned : undefined;
}

function cleanEmail(value: string | null | undefined, warnings: string[]): string | undefined {
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

function parseOptionalNumber(value: string | null | undefined, warnings: string[]): number | undefined {
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

function compareCallLeadRecency(
  a: HydratedDocument<CallLeadDocument>,
  b: HydratedDocument<CallLeadDocument>,
): number {
  return getLeadTime(b) - getLeadTime(a);
}

function getLeadTime(lead: HydratedDocument<CallLeadDocument>): number {
  const doc = lead as HydratedDocument<CallLeadDocument> & { createdAt?: Date };
  return (lead.timestamp ?? doc.createdAt ?? new Date(0)).getTime();
}

function deriveLocal(pickupState: string, deliveryState: string): LocalType {
  return pickupState === deliveryState ? "local" : "long_distance";
}

function buildPhoneRegex(normalizedPhone: string): RegExp {
  return new RegExp(`(?:^|\\D)${normalizedPhone.split("").join("\\D*")}(?:\\D|$)`);
}
