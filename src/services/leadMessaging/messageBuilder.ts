import type { CreateFormLeadInput } from "../../validation/v1.validation";

export const LEAD_CONFIRMATION_MESSAGE_KEY = "quote_request_confirmation";
export const LEAD_CONFIRMATION_TEMPLATE_VERSION = 2;

export function buildLeadConfirmationMessage(
  input: CreateFormLeadInput,
): string {
  const firstName =
    input.first_name?.trim() ||
    input.name?.trim().split(/\s+/)[0] ||
    "there";
  return `Hi ${firstName}, this is Vantage Movers. We received your request for a quote. Call us at (888) 486-2499 to review your move details and get your free quote.`;
}
