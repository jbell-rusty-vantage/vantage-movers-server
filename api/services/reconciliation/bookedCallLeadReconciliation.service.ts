import mongoose, { type HydratedDocument } from "mongoose";
import {
  getCplForSource,
  type LocalType,
  type SourceCompany,
} from "../../config/domain";
import { BookedLead, type BookedLeadDocument } from "../../models/BookedLead";
import { CallLead, type CallLeadDocument } from "../../models/CallLead";
import { Customer } from "../../models/Customer";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type {
  BookedCallLeadReconciliationBatchInput,
  BookedCallLeadReconciliationRowInput,
} from "../../validation/v1.validation";
import {
  scheduleBookingChainSheetSync,
  scheduleCallLeadSheetSync,
} from "../sheetSync";
import {
  cleanValue,
  parseBookedCallLeadRow,
  validateParsedRow,
  type ParsedBookedCallLeadRow,
  type ParsedBookedCallLeadRowWithWarnings,
} from "./bookedCallLeadRows";

export type BookedCallLeadReconciliationStatus =
  | "updateable"
  | "updated"
  | "unchanged"
  | "booking_missing"
  | "no_match"
  | "invalid"
  | "conflict"
  | "failed";

export type BookedCallLeadMatchMethod =
  | "job_no_with_booking"
  | "job_no_only"
  | "phone_only"
  | "none";

export type BookedCallLeadReconciliationResult = {
  row_id: string;
  status: BookedCallLeadReconciliationStatus;
  message: string;
  job_no?: string;
  booking_id?: string;
  call_lead_id?: string;
  /** How we located the call lead / booking in the database. */
  match_method?: BookedCallLeadMatchMethod;
  /** Whether the matched call lead has a booking attached. */
  has_booking?: boolean;
  changes: string[];
  warnings: string[];
  parsed?: ParsedBookedCallLeadRow;
};

type ResolvedReconciliation = {
  result: BookedCallLeadReconciliationResult;
  booking?: HydratedDocument<BookedLeadDocument>;
  lead?: HydratedDocument<CallLeadDocument>;
  leadUpdate?: Partial<CallLeadDocument>;
  bookingUpdate?: Partial<BookedLeadDocument>;
  syncTarget?: "booking_chain" | "call_lead";
  customerInput?: {
    full_name: string;
    phone_number: string;
    email?: string;
  };
};

export async function previewBookedCallLeadReconciliation(
  input: BookedCallLeadReconciliationBatchInput,
): Promise<BookedCallLeadReconciliationResult[]> {
  const results: BookedCallLeadReconciliationResult[] = [];
  for (const row of input.rows) {
    results.push((await resolveReconciliationRow(row)).result);
  }
  return results;
}

export async function syncBookedCallLeadReconciliation(
  input: BookedCallLeadReconciliationBatchInput,
): Promise<BookedCallLeadReconciliationResult[]> {
  const results: BookedCallLeadReconciliationResult[] = [];
  for (const row of input.rows) {
    try {
      const resolved = await resolveReconciliationRow(row);
      if (
        resolved.result.status !== "updateable" ||
        !resolved.lead ||
        (!resolved.leadUpdate && !resolved.bookingUpdate && !resolved.customerInput)
      ) {
        results.push(resolved.result);
        continue;
      }

      if (resolved.leadUpdate) {
        Object.assign(resolved.lead, resolved.leadUpdate);
        resolved.lead.cpl = getCplForSource(
          resolved.lead.source_company as SourceCompany,
          resolved.lead.local as LocalType | undefined,
        );
        await resolved.lead.save();
      }

      if (resolved.booking && resolved.bookingUpdate) {
        Object.assign(resolved.booking, resolved.bookingUpdate);
      }

      if (resolved.booking && resolved.customerInput) {
        const customer = await Customer.findOneAndUpdate(
          { phone_number: resolved.customerInput.phone_number },
          resolved.customerInput,
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
        ).orFail();
        resolved.booking.customer = customer._id;
      }

      if (resolved.syncTarget === "booking_chain" && resolved.booking) {
        await resolved.booking.save();
        scheduleBookingChainSheetSync(
          resolved.booking._id.toString(),
          "booked_call_lead.reconciliation.sync",
        );
      } else {
        scheduleCallLeadSheetSync(
          resolved.lead._id.toString(),
          "booked_call_lead.call_lead_only.sync",
        );
      }

      results.push({
        ...resolved.result,
        status: "updated",
        message:
          resolved.syncTarget === "booking_chain" && resolved.booking
            ? `Updated booked call lead ${resolved.lead._id.toString()} and booking ${resolved.booking._id.toString()}.`
            : `Updated call lead ${resolved.lead._id.toString()} from Booked Jobs row.`,
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

async function resolveReconciliationRow(
  row: BookedCallLeadReconciliationRowInput,
): Promise<ResolvedReconciliation> {
  const parsed = await parseBookedCallLeadRow(row);
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

  const booking = await BookedLead.findOne({ job_no: parsed.job_no });
  if (!booking) {
    return resolveCallLeadOnlyRow(parsed, base);
  }

  base.booking_id = booking._id.toString();
  base.match_method = "job_no_with_booking";
  base.has_booking = true;
  if (booking.lead_model !== "CallLead") {
    return {
      result: {
        ...base,
        status: "conflict",
        message: `Booked lead ${booking._id.toString()} is linked to ${booking.lead_model}, not CallLead.`,
      },
    };
  }

  const lead = await CallLead.findById(booking.lead_ref);
  if (!lead) {
    return {
      result: {
        ...base,
        status: "conflict",
        message: `Booked lead ${booking._id.toString()} points to a missing call lead.`,
      },
    };
  }
  base.call_lead_id = lead._id.toString();

  const sourceConflict = buildAssignedSourceConflict(lead, parsed);
  if (sourceConflict) {
    return {
      result: {
        ...base,
        status: "conflict",
        message: sourceConflict,
      },
    };
  }

  const leadUpdate = buildLeadUpdate(lead, parsed, base.warnings);
  const bookingUpdate = buildBookingUpdate(booking, parsed);
  const customerInput = buildCustomerInput(parsed);
  const changes = [
    ...Object.keys(leadUpdate).map((key) => `lead.${key}`),
    ...Object.keys(bookingUpdate).map((key) => `booking.${key}`),
  ];

  if (
    customerInput &&
    (!booking.customer ||
      !sameObjectId(booking.customer, await findExistingCustomerId(customerInput.phone_number)))
  ) {
    changes.push("booking.customer");
  }

  if (changes.length === 0) {
    return {
      booking,
      lead,
      syncTarget: "booking_chain",
      result: {
        ...base,
        status: "unchanged",
        message: `Found a Vantage booking by job_no ${parsed.job_no} (booking ${booking._id.toString()}, call lead ${lead._id.toString()}). All fields already match; running sync is idempotent.`,
      },
    };
  }

  return {
    booking,
    lead,
    leadUpdate,
    bookingUpdate,
    customerInput,
    syncTarget: "booking_chain",
    result: {
      ...base,
      status: "updateable",
      message: `Found a Vantage booking by job_no ${parsed.job_no} (booking ${booking._id.toString()}). Sync will refresh ${changes.length} field(s) across the call lead and booking; the booking link itself is preserved.`,
      changes,
    },
  };
}

async function resolveCallLeadOnlyRow(
  parsed: ParsedBookedCallLeadRow,
  base: BookedCallLeadReconciliationResult,
): Promise<ResolvedReconciliation> {
  const match = await findCallLeadOnlyMatch(parsed);
  if (match.result) {
    return {
      result: {
        ...base,
        ...match.result,
        match_method: match.matchMethod ?? base.match_method,
      },
    };
  }
  if (!match.lead) {
    base.match_method = "none";
    return {
      result: {
        ...base,
        status: "no_match",
        message: `No Vantage booking exists for job_no ${parsed.job_no}, and no call lead matched ${
          parsed.normalized_phone_number ? `phone ${parsed.normalized_phone_number}` : ""
        }${parsed.normalized_phone_number ? " or " : ""}job_no ${parsed.job_no}. The customer's phone may have been switched in Granot, or the lead is older than the system's retention window.`,
      },
    };
  }

  const lead = match.lead;
  base.call_lead_id = lead._id.toString();
  base.match_method = match.matchMethod;
  base.has_booking = Boolean(lead.booked);
  if (match.warnings.length > 0) {
    base.warnings.push(...match.warnings);
  }

  const existingJobNo = cleanValue(lead.job_no);
  const hasJobConflict =
    Boolean(existingJobNo) && existingJobNo !== parsed.job_no;
  if (hasJobConflict) {
    base.warnings.push(
      `Existing call lead already has job_no ${existingJobNo}; CRM row has ${parsed.job_no}. The job_no will be left as-is during sync.`,
    );
  }

  const leadUpdate = buildLeadUpdate(lead, parsed, base.warnings, {
    skipJobNo: hasJobConflict,
  });
  const changes = Object.keys(leadUpdate).map((key) => `lead.${key}`);
  const how = formatMatchMethodLabel(match.matchMethod);
  if (changes.length === 0) {
    return {
      lead,
      syncTarget: "call_lead",
      result: {
        ...base,
        status: "unchanged",
        message: `No Vantage booking exists for job_no ${parsed.job_no} yet. Found a call lead ${how}; all fields already match. Running sync is idempotent.`,
      },
    };
  }

  return {
    lead,
    leadUpdate,
    syncTarget: "call_lead",
    result: {
      ...base,
      status: "updateable",
      message: `No Vantage booking exists for job_no ${parsed.job_no} yet. Found a call lead ${how}. Sync will update ${changes.length} field(s) on the call lead.`,
      changes,
    },
  };
}

function formatMatchMethodLabel(
  method: BookedCallLeadMatchMethod | undefined,
): string {
  switch (method) {
    case "job_no_only":
      return "by job_no only";
    case "phone_only":
      return "by phone_number only";
    default:
      return "in Vantage";
  }
}

function buildLeadUpdate(
  lead: HydratedDocument<CallLeadDocument>,
  parsed: ParsedBookedCallLeadRow,
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
  assignIfChanged(update, lead, "source_company", parsed.source_company);

  if (parsed.local) {
    assignIfChanged(update, lead, "local", parsed.local);
  } else if (lead.local) {
    warnings.push("Preserved existing local value because one or both states were unresolved.");
  }

  return update;
}

function buildBookingUpdate(
  booking: HydratedDocument<BookedLeadDocument>,
  parsed: ParsedBookedCallLeadRow,
): Partial<BookedLeadDocument> {
  const update: Partial<BookedLeadDocument> = {};
  assignIfChanged(update, booking, "source", parsed.source_company);
  assignIfChanged(update, booking, "local", parsed.local);
  assignDateIfChanged(update, booking, "book_date", parsed.book_date);
  return update;
}

function buildCustomerInput(parsed: ParsedBookedCallLeadRow) {
  if (!parsed.name?.trim() || !parsed.phone_number?.trim()) {
    return undefined;
  }
  return {
    full_name: parsed.name.trim(),
    phone_number: parsed.phone_number.trim(),
    ...(parsed.email ? { email: parsed.email } : {}),
  };
}

async function findCallLeadOnlyMatch(
  parsed: ParsedBookedCallLeadRow,
): Promise<{
  lead?: HydratedDocument<CallLeadDocument>;
  warnings: string[];
  matchMethod?: BookedCallLeadMatchMethod;
  result?: Partial<BookedCallLeadReconciliationResult>;
}> {
  const byJobNo = await findEligibleCallLeadCandidates({ job_no: parsed.job_no });
  if (byJobNo.length > 0) {
    const selected = selectSourceCompatibleLead(byJobNo, parsed.source_company!, "job_no");
    if (selected.lead || selected.result) {
      return { ...selected, matchMethod: "job_no_only" };
    }
  }

  if (!parsed.normalized_phone_number) {
    return {
      result: {
        status: "no_match",
        message: "No booked lead matched job_no and the row has no valid phone for call lead matching.",
      },
      warnings: [],
      matchMethod: "none",
    };
  }

  const byPhone = (
    await findEligibleCallLeadCandidates({
      normalizedPhone: parsed.normalized_phone_number,
    })
  ).filter((lead) => normalizePhoneNumberForMatch(lead.phone_number) === parsed.normalized_phone_number);

  if (byPhone.length === 0) {
    return {
      result: {
        status: "no_match",
        message: `No call lead matched phone ${parsed.normalized_phone_number}.`,
      },
      warnings: [],
      matchMethod: "none",
    };
  }

  const sourceCompatible = byPhone.filter((lead) =>
    isLeadSourceCompatible(lead, parsed.source_company!),
  );
  if (sourceCompatible.length === 0) {
    const selected = selectSourceCompatibleLead(byPhone, parsed.source_company!, "phone");
    return { ...selected, matchMethod: "phone_only" };
  }

  const jobCompatible = sourceCompatible.filter((lead) => {
    const existingJobNo = cleanValue(lead.job_no);
    return !existingJobNo || existingJobNo === parsed.job_no;
  });
  if (jobCompatible.length > 0) {
    const selected = selectSourceCompatibleLead(jobCompatible, parsed.source_company!, "phone");
    return { ...selected, matchMethod: "phone_only" };
  }

  sourceCompatible.sort(compareCallLeadRecency);
  return { lead: sourceCompatible[0], warnings: [], matchMethod: "phone_only" };
}

async function findEligibleCallLeadCandidates(input: {
  job_no?: string;
  normalizedPhone?: string;
}): Promise<HydratedDocument<CallLeadDocument>[]> {
  if (!input.job_no && !input.normalizedPhone) {
    return [];
  }

  const identity = input.job_no
    ? { job_no: input.job_no }
    : {
        $or: [
          { normalized_phone_number: input.normalizedPhone },
          { phone_number: buildPhoneRegex(input.normalizedPhone!) },
        ],
      };

  return CallLead.find({
    ...identity,
    created_on_unmatched: { $ne: true },
    $and: [
      { $or: [{ booked: { $exists: false } }, { booked: null }] },
      { $or: [{ cancelled: { $exists: false } }, { cancelled: null }] },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(25)
    .exec();
}

function selectSourceCompatibleLead(
  candidates: HydratedDocument<CallLeadDocument>[],
  sourceCompany: SourceCompany,
  matchType: "job_no" | "phone",
): {
  lead?: HydratedDocument<CallLeadDocument>;
  warnings: string[];
  result?: Partial<BookedCallLeadReconciliationResult>;
} {
  const compatible = candidates.filter((lead) => isLeadSourceCompatible(lead, sourceCompany));
  if (compatible.length === 0) {
    const message =
      matchType === "job_no"
        ? `Call lead job_no matched, but no candidate had source_company ${sourceCompany} or an unassigned source.`
        : `Call lead phone matched, but no candidate had source_company ${sourceCompany} or an unassigned source.`;
    return {
      result: {
        status: matchType === "job_no" ? "conflict" : "no_match",
        message,
      },
      warnings: [],
    };
  }

  compatible.sort(compareCallLeadRecency);
  const selected = compatible[0];
  const nextWarnings: string[] = [];
  if (compatible.length > 1) {
    nextWarnings.push(
      `Multiple call leads matched ${matchType} and source ${sourceCompany}; selected newest eligible lead.`,
    );
  }
  if (isUnassignedSource(selected.source_company)) {
    nextWarnings.push(`Claiming unassigned call lead source_company as ${sourceCompany}.`);
  }

  return { lead: selected, warnings: nextWarnings };
}

function buildAssignedSourceConflict(
  lead: HydratedDocument<CallLeadDocument>,
  parsed: ParsedBookedCallLeadRow,
): string | undefined {
  if (!parsed.source_company || isLeadSourceCompatible(lead, parsed.source_company)) {
    return undefined;
  }
  return `Matched call lead has source_company ${lead.source_company}; CRM row source maps to ${parsed.source_company}.`;
}

function isLeadSourceCompatible(
  lead: HydratedDocument<CallLeadDocument>,
  sourceCompany: SourceCompany,
): boolean {
  return lead.source_company === sourceCompany || isUnassignedSource(lead.source_company);
}

function isUnassignedSource(sourceCompany: unknown): boolean {
  return !sourceCompany || sourceCompany === "not_provided";
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

function resultBase(
  rowId: string,
  parsed: ParsedBookedCallLeadRowWithWarnings,
): BookedCallLeadReconciliationResult {
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

function assignIfChanged<T extends Record<string, unknown>, K extends keyof T>(
  update: Partial<T>,
  document: T,
  key: K,
  value: T[K] | undefined,
) {
  if (value === undefined || value === null) {
    return;
  }
  if (String(document[key] ?? "") === String(value)) {
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

function assignDateIfChanged<K extends keyof BookedLeadDocument>(
  update: Partial<BookedLeadDocument>,
  booking: HydratedDocument<BookedLeadDocument>,
  key: K,
  value: Date | undefined,
) {
  if (!value) {
    return;
  }
  const existing = booking[key];
  if (existing instanceof Date && existing.getTime() === value.getTime()) {
    return;
  }
  update[key] = value as BookedLeadDocument[K];
}

async function findExistingCustomerId(phoneNumber: string): Promise<mongoose.Types.ObjectId | undefined> {
  const customer = await Customer.findOne({ phone_number: phoneNumber }).select("_id");
  return customer?._id;
}

function sameObjectId(left: unknown, right: unknown): boolean {
  if (!left || !right) {
    return false;
  }
  return String(left) === String(right);
}

/**
 * Mongo-side regex sieve used to widen the phone-number candidate set.
 *
 * Includes a leading word-boundary `(?:^|\\D)` (vs. the leads helper which
 * deliberately omits it) so the sieve never matches the suffix of a longer
 * stored value. Callers always re-verify exact matches in memory via
 * `normalizePhoneNumberForMatch`.
 */
function buildPhoneRegex(normalizedPhone: string): RegExp {
  const digits = normalizedPhone.replace(/\D/g, "");
  return new RegExp(`(?:^|\\D)${digits.split("").join("\\D*")}(?:\\D|$)`);
}
