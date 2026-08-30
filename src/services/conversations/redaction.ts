export type RedactionResult = { text: string; redactions: number };

const CARD_SPAN = /(?<!\d)(?:\d[\s\-.]*){12,18}\d(?!\d)/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SPOKEN_EMAIL =
  /\b[A-Z0-9._%+-]+\s+at\s+[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CVV_NEAR_CARD =
  /\b(?:cvv|cvc|cbb|cid|security code|magic three)[:\s-]*(\d{3,4})\b/gi;
const EXPIRY_NEAR_CARD =
  /\b(?:exp(?:iry|iration)?|exp\.?)[:\s-]*(\d{1,2}\s*[/\-]\s*\d{2,4})\b/gi;
const ROUTING_NEAR_LABEL =
  /\b(?:routing(?:\s+number)?|aba)[:\s#]*(\d{9})\b/gi;

export function redactTranscript(raw: string): RedactionResult {
  let redactions = 0;
  let text = raw;

  text = text.replace(CARD_SPAN, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return match;
    if (!luhnValid(digits)) return match;
    redactions += 1;
    return "[REDACTED:CARD]";
  });

  text = replaceCaptured(text, CVV_NEAR_CARD, "[REDACTED:CVV]", () => {
    redactions += 1;
  });
  text = replaceCaptured(text, EXPIRY_NEAR_CARD, "[REDACTED:EXPIRY]", () => {
    redactions += 1;
  });
  text = text.replace(SSN, () => {
    redactions += 1;
    return "[REDACTED:SSN]";
  });
  text = replaceCaptured(text, ROUTING_NEAR_LABEL, "[REDACTED:ROUTING]", () => {
    redactions += 1;
  });
  text = text.replace(EMAIL, () => {
    redactions += 1;
    return "[REDACTED:EMAIL]";
  });
  text = text.replace(SPOKEN_EMAIL, () => {
    redactions += 1;
    return "[REDACTED:EMAIL]";
  });

  return { text, redactions };
}

function replaceCaptured(
  input: string,
  pattern: RegExp,
  token: string,
  onMatch: () => void,
): string {
  return input.replace(pattern, (full, captured: string) => {
    onMatch();
    return captured ? full.replace(captured, token) : token;
  });
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let doubleIt = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (!Number.isInteger(value)) return false;
    if (doubleIt) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
}
