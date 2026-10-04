import { CsiError } from "../auth";

export const NUDGE_TEMPLATES = Object.freeze({ review_context: 1 });
export type NudgePurpose = keyof typeof NUDGE_TEMPLATES;
export function validateNudgeBody(body: string): string {
  const result = body.trim();
  if (!result || result.length > 1000) throw new CsiError("NUDGE_BODY_INVALID");
  return result;
}
/**
 * The RingCentral Accounts message is the Owner's own text to one directory User. It has no
 * customer, so contact wording is the Owner's message; the template key and version must match.
 */
export function renderNudgeTemplate(input: { purpose: NudgePurpose; template_key: string; template_version: number; body: string }) {
  if (input.template_key !== input.purpose || NUDGE_TEMPLATES[input.purpose] !== input.template_version) throw new CsiError("INVALID_INPUT");
  return validateNudgeBody(input.body);
}
