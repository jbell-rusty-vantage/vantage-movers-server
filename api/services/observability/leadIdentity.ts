/**
 * Normalizes owner-facing lead identity fields for operational events.
 *
 * Identity must be copied from validated Vantage documents or validated lead
 * creation input (never raw untrusted payloads). This module only normalizes
 * shape; callers are responsible for sourcing the values safely.
 *
 * Normalization rules (per the implementation spec):
 *   - `name`:  trim whitespace.
 *   - `phone`: trim; use the customer-facing display value as provided.
 *   - `email`: trim and lowercase.
 *   - Empty strings become `null`.
 */

export type LeadIdentityInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type NormalizedLeadIdentity = {
  lead_name: string | null;
  lead_phone: string | null;
  lead_email: string | null;
};

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeLeadIdentity(
  identity: LeadIdentityInput | null | undefined,
): NormalizedLeadIdentity {
  if (!identity) {
    return { lead_name: null, lead_phone: null, lead_email: null };
  }

  const email = cleanString(identity.email);

  return {
    lead_name: cleanString(identity.name),
    lead_phone: cleanString(identity.phone),
    lead_email: email ? email.toLowerCase() : null,
  };
}
