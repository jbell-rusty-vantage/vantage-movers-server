import { CsiError } from "../auth";

export const NUDGE_TEMPLATES = Object.freeze({ call_suggestion: 1, review_context: 1 });
export type NudgePurpose = keyof typeof NUDGE_TEMPLATES;
/** Also recognizes Unicode full-width digits and punctuation-separated NANP forms. */
export function validateNudgeBody(body: string, customerNumbers: readonly string[]): string {
  const result = body.trim();
  const digits = result.normalize("NFKC").replace(/\D/g, "");
  if (!result || result.length > 1000 || customerNumbers.some(number => {
    const n = number.replace(/\D/g, "");
    return digits.includes(n) || (n.length === 11 && n.startsWith("1") && digits.includes(n.slice(1)));
  })) throw new CsiError("NUDGE_BODY_INVALID");
  return result;
}
const reasonText: Record<string, string> = {
  promised_callback_overdue: "A promised callback is due.", no_call_yet: "No attributable call is recorded yet.",
  missed_call_no_callback: "An unanswered inbound call needs attention.", followups_due: "A followup is due.",
  no_next_step: "The next step needs review.", missing_responsibility: "Responsibility needs review.", going_cold: "The record needs attention.",
};
const clean = (text: string) => text.replace(/[\r\n\t]/g, " ").trim();
const CONTACT_ACTION = String.raw`(?:call|dial|phone|text|sms|contact|message|ring|reach(?:\s+out)?(?:\s+to)?)`;
const REVIEW_CONTACT_INSTRUCTION = new RegExp(
  String.raw`(?:` +
    String.raw`\b(?:please|kindly)\b(?:\s+\w+){0,4}\s+${CONTACT_ACTION}\b` +
    String.raw`|` +
    String.raw`\b(?:can|could|would|should|must|need(?:s)?\s+to|have\s+to|ought\s+to)(?:\s+you)?(?:\s+\w+){0,3}\s+${CONTACT_ACTION}\b` +
    String.raw`|` +
    String.raw`(?:^|[.!?;\n]\s*)[\p{L}.''-]+(?:\s+[\p{L}.''-]+)?,\s+(?:please\s+)?(?:\w+\s+){0,3}${CONTACT_ACTION}\b` +
    String.raw`|` +
    String.raw`(?:^|[.!?;\n]\s+)${CONTACT_ACTION}\b` +
    String.raw`|` +
    String.raw`\b(?:go\s+ahead\s+and|let'?s|make\s+(?:sure\s+)?(?:to\s+)?|be\s+sure\s+to|remember\s+to)\s+${CONTACT_ACTION}\b` +
    String.raw`|` +
    String.raw`\b${CONTACT_ACTION}\s+(?:the\s+)?(?:customer|client|them|him|her|this\s+(?:person|lead))\b` +
    String.raw`|` +
    String.raw`\b${CONTACT_ACTION}\s+(?:now|today|asap|immediately|urgently|tomorrow|tonight)\b` +
  String.raw`)`,
  "giu",
);
/** Edited review-context bodies fail closed on contact instructions. Restriction discussion and the documented disclaimer stay legal. */
export function reviewContextForbidsContactRequest(body: string): boolean {
  const stripped = body.normalize("NFKC").replace(/\bthis is not a request to (?:call|contact|text|message|dial|phone|sms|ring)\b/gi, " ");
  for (const match of stripped.matchAll(REVIEW_CONTACT_INSTRUCTION)) {
    const before = stripped.slice(Math.max(0, (match.index ?? 0) - 40), match.index);
    if (/(?:do\s+not|don't|never|not\s+(?:a\s+request|asking|telling))\s*$/i.test(before)) continue;
    return true;
  }
  return false;
}
export function renderNudgeTemplate(input: {
  purpose: NudgePurpose; template_key: string; template_version: number; repName: string; customerName: string | null;
  customerNumber: string | null; reasons: readonly string[]; lastContact: Date | null; source: string | null;
  recordUrl: string; ownerId: string; body?: string; customerNumbers: readonly string[];
}) {
  if (input.template_key !== input.purpose || NUDGE_TEMPLATES[input.purpose] !== input.template_version) throw new CsiError("INVALID_INPUT");
  // Review-context edits cannot turn the internal template into a contact request before any provider call.
  if (input.body && input.purpose === "review_context" && reviewContextForbidsContactRequest(input.body)) throw new CsiError("NUDGE_NOT_ACTIONABLE");
  if (!input.customerNumber) {
    if (input.purpose !== "review_context" || !input.body) throw new CsiError("INVALID_INPUT");
    return validateNudgeBody(input.body, input.customerNumbers);
  }
  const name = clean(input.customerName ?? "Customer").split(/\s+/);
  const maskedName = `${name[0]}${name.length > 1 ? ` ${name.at(-1)![0]}.` : ""}`;
  const reason = input.purpose === "review_context" ? `${reasonText[input.reasons[0] ?? ""] ?? "Internal Outreach context needs review."} Please review the internal context; this is not a request to contact the customer.` :
    `${reasonText[input.reasons[0] ?? ""] ?? "An eligible call action needs attention."} Please review the call action in Vantage.`;
  const body = input.body ?? `${clean(input.repName).split(/\s+/)[0]} — ${reason}\n${maskedName}, number ending ${input.customerNumber.slice(-4)}.\nLast recorded human contact: ${input.lastContact?.toISOString() ?? "none recorded"}; source: ${clean(input.source ?? "stored Outreach")}.\n${input.recordUrl}\nOwner: ${clean(input.ownerId)}`;
  return validateNudgeBody(body, input.customerNumbers);
}
