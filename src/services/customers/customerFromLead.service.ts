import type { ClientSession } from "mongoose";
import { Customer } from "../../models/Customer";

function normalizeCustomerName(value: string): string {
  return value.trim().toLowerCase();
}

function buildCustomerUpdate(input: {
  full_name: string;
  phone_number?: string;
  email?: string | null;
}) {
  return {
    full_name: input.full_name,
    normalized_name: normalizeCustomerName(input.full_name),
    ...(input.phone_number ? { phone_number: input.phone_number } : {}),
    ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
  };
}

/**
 * Upserts the customer record derived from a source lead's contact fields.
 *
 * Returns `undefined` when the lead lacks a name so the booking can still be
 * created without a linked customer. Matches by phone when present, otherwise
 * by normalized name.
 */
export async function upsertCustomerFromLead(
  lead: {
    name?: string | null;
    phone_number?: string | null;
    email?: string | null;
  },
  session?: ClientSession,
) {
  if (!lead.name?.trim()) {
    return undefined;
  }

  const full_name = lead.name.trim();
  const phone_number = lead.phone_number?.trim() || undefined;
  const update = buildCustomerUpdate({
    full_name,
    phone_number,
    email: lead.email,
  });

  if (phone_number) {
    return Customer.findOneAndUpdate({ phone_number }, update, {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
      session,
    }).orFail();
  }

  return Customer.findOneAndUpdate({ normalized_name: update.normalized_name }, update, {
    upsert: true,
    returnDocument: "after",
    setDefaultsOnInsert: true,
    session,
  }).orFail();
}

/**
 * Upserts a customer when an explicit booking contact name is provided.
 *
 * Resolves phone from the submitted customer phone first, then from the linked
 * lead when available. Matches by phone when present, otherwise normalized name.
 */
export async function upsertCustomerFromBookingContact(
  input: {
    customer_name: string;
    customer_phone?: string | null;
    customer_email?: string | null;
    lead?: {
      name?: string | null;
      phone_number?: string | null;
      email?: string | null;
    };
  },
  session?: ClientSession,
) {
  const full_name = input.customer_name.trim();
  if (!full_name) {
    return undefined;
  }

  const phone_number =
    input.customer_phone?.trim() || input.lead?.phone_number?.trim() || undefined;
  const update = buildCustomerUpdate({
    full_name,
    phone_number,
    email: input.customer_email ?? input.lead?.email,
  });

  if (phone_number) {
    return Customer.findOneAndUpdate({ phone_number }, update, {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
      session,
    }).orFail();
  }

  return Customer.findOneAndUpdate({ normalized_name: update.normalized_name }, update, {
    upsert: true,
    returnDocument: "after",
    setDefaultsOnInsert: true,
    session,
  }).orFail();
}
