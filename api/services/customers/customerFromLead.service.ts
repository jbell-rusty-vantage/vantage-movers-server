import { Customer } from "../../models/Customer";

/**
 * Upserts the customer record derived from a source lead's contact fields.
 *
 * Matches the original behavior in `v1.service.ts`:
 *   - returns `undefined` when the lead lacks both name and phone, so the
 *     booking can still be created without a linked customer
 *   - matches existing customers by `phone_number`
 *   - updates the customer's `full_name`, `phone_number`, and (if present)
 *     normalized `email` on every call so booking-time data wins
 *
 * Used by booked lead creation and the booking refresh flow when a source
 * lead's contact info changes.
 */
export async function upsertCustomerFromLead(lead: {
  name?: string | null;
  phone_number?: string | null;
  email?: string | null;
}) {
  if (!lead.name?.trim() || !lead.phone_number?.trim()) {
    return undefined;
  }

  const update = {
    full_name: lead.name.trim(),
    phone_number: lead.phone_number.trim(),
    ...(lead.email ? { email: lead.email.trim().toLowerCase() } : {}),
  };
  return Customer.findOneAndUpdate({ phone_number: update.phone_number }, update, {
    upsert: true,
    returnDocument: "after",
    setDefaultsOnInsert: true,
  }).orFail();
}
