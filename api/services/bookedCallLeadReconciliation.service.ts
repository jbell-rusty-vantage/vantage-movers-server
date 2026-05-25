import mongoose, { type HydratedDocument } from "mongoose";
import {
  getCplForSource,
  resolveSourceCompany,
  type LocalType,
  type SourceCompany,
} from "../config/domain";
import { BookedLead, type BookedLeadDocument } from "../models/BookedLead";
import { CallLead, type CallLeadDocument } from "../models/CallLead";
import { Customer } from "../models/Customer";
import { getStateCodeForZip } from "../utils/pickupZipState";
import { normalizePhoneNumberForMatch } from "../utils/phone";
import type {
  BookedCallLeadReconciliationBatchInput,
  BookedCallLeadReconciliationRowInput,
} from "../validation/v1.validation";
import { scheduleBookingChainSheetSync } from "./v1.service";

export type BookedCallLeadReconciliationStatus =
  | "updateable"
  | "updated"
  | "unchanged"
  | "booking_missing"
  | "invalid"
  | "conflict"
  | "failed";

export type BookedCallLeadReconciliationResult = {
  row_id: string;
  status: BookedCallLeadReconciliationStatus;
  message: string;
  job_no?: string;
  booking_id?: string;
  call_lead_id?: string;
  changes: string[];
  warnings: string[];
  parsed?: ParsedBookedCallLeadRow;
};

type ParsedBookedCallLeadRow = {
  row_id: string;
  row_index?: number;
  section?: "bookedJobs" | "followUpEstimates";
  job_no?: string;
  source_company?: SourceCompany;
  source_label?: string;
  prior?: string;
  book_date?: Date;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  email?: string;
  pickup_zip?: string;
  delivery_zip?: string;
  pickup_state?: string;
  delivery_state?: string;
  local?: LocalType;
  cubic_feet?: number;
};

type ResolvedReconciliation = {
  result: BookedCallLeadReconciliationResult;
  booking?: HydratedDocument<BookedLeadDocument>;
  lead?: HydratedDocument<CallLeadDocument>;
  leadUpdate?: Partial<CallLeadDocument>;
  bookingUpdate?: Partial<BookedLeadDocument>;
  customerInput?: {
    full_name: string;
    phone_number: string;
    email?: string;
  };
};

const PLACEHOLDERS = new Set(["na", "n/a", "none", "null", "-", "--"]);

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
        !resolved.booking ||
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

      if (resolved.bookingUpdate) {
        Object.assign(resolved.booking, resolved.bookingUpdate);
      }

      if (resolved.customerInput) {
        const customer = await Customer.findOneAndUpdate(
          { phone_number: resolved.customerInput.phone_number },
          resolved.customerInput,
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
        ).orFail();
        resolved.booking.customer = customer._id;
      }

      await resolved.booking.save();
      scheduleBookingChainSheetSync(
        resolved.booking._id.toString(),
        "booked_call_lead.reconciliation.sync",
      );

      results.push({
        ...resolved.result,
        status: "updated",
        message: `Updated booked call lead ${resolved.lead._id.toString()} and booking ${resolved.booking._id.toString()}.`,
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
    return {
      result: {
        ...base,
        status: "booking_missing",
        message: `No booked lead matched job_no ${parsed.job_no}.`,
      },
    };
  }

  base.booking_id = booking._id.toString();
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
      result: {
        ...base,
        status: "unchanged",
        message: "Booked call lead is already up to date.",
      },
    };
  }

  return {
    booking,
    lead,
    leadUpdate,
    bookingUpdate,
    customerInput,
    result: {
      ...base,
      status: "updateable",
      message: `Ready to update ${changes.length} field(s).`,
      changes,
    },
  };
}

async function parseBookedCallLeadRow(
  row: BookedCallLeadReconciliationRowInput,
): Promise<ParsedBookedCallLeadRow> {
  const warnings: string[] = [];
  const pickupZip = cleanZip(row.from_zip);
  const deliveryZip = cleanZip(row.to_zip);
  const [pickupState, deliveryState] = await Promise.all([
    pickupZip ? getStateCodeForZip(pickupZip) : undefined,
    deliveryZip ? getStateCodeForZip(deliveryZip) : undefined,
  ]);
  const local = pickupState && deliveryState ? deriveLocal(pickupState, deliveryState) : undefined;
  const sourceLabel = cleanValue(row.source);
  const sourceCompany = sourceLabel ? resolveSourceCompany(sourceLabel) : undefined;
  if (sourceLabel && !sourceCompany) {
    warnings.push(`Skipped unknown source "${sourceLabel}".`);
  }

  const parsed: ParsedBookedCallLeadRow & { warnings?: string[] } = {
    row_id: row.row_id,
    row_index: row.row_index,
    section: row.section,
    job_no: cleanValue(row.job_no),
    source_company: sourceCompany,
    source_label: sourceLabel,
    prior: cleanValue(row.prior),
    book_date: parseOptionalDate(row.book_date, warnings),
    name: cleanValue(row.customer),
    phone_number: cleanValue(row.phone),
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

function validateParsedRow(parsed: ParsedBookedCallLeadRow): string[] {
  const reasons: string[] = [];
  if (!parsed.job_no) {
    reasons.push("Missing required job_no.");
  }
  if (parsed.section !== "bookedJobs" && parsed.prior !== "5") {
    reasons.push("Row is not from Booked Jobs and prior is not 5.");
  }
  return reasons;
}

function buildLeadUpdate(
  lead: HydratedDocument<CallLeadDocument>,
  parsed: ParsedBookedCallLeadRow,
  warnings: string[],
): Partial<CallLeadDocument> {
  const update: Partial<CallLeadDocument> = {};
  assignIfChanged(update, lead, "job_no", parsed.job_no);
  assignIfChanged(update, lead, "name", parsed.name);
  assignIfChanged(update, lead, "phone_number", parsed.phone_number);
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

function resultBase(
  rowId: string,
  parsed: ParsedBookedCallLeadRow & { warnings?: string[] },
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

function parseOptionalDate(value: string | null | undefined, warnings: string[]): Date | undefined {
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
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(parsed.getTime())) {
    warnings.push(`Skipped invalid book_date value "${cleaned}".`);
    return undefined;
  }
  return parsed;
}

function deriveLocal(pickupState: string, deliveryState: string): LocalType {
  return pickupState === deliveryState ? "local" : "long_distance";
}
