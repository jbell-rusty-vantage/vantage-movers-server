import { createHash } from "node:crypto";
import type { TestimonialSource } from "../../config/domain";

/** BBB redacts PII with the literal token "REMOVED" (sometimes "REMOVE"). */
const BBB_REDACTION_PATTERN = /\b(?:REMOVED|REMOVE)/i;

export function hasBbbRedaction(text: string): boolean {
  return BBB_REDACTION_PATTERN.test(text);
}

export function normalizeReviewerName(value: string): string {
  return value.trim().toLowerCase();
}

export function parseReviewDate(value: string): Date {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`Invalid review date (expected YYYY-MM-DD): ${value}`);
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid review date: ${value}`);
  }

  return parsed;
}

export function buildContentFingerprint(input: {
  source: TestimonialSource;
  normalized_reviewer_name: string;
  review_date: Date;
  review_text: string;
}): string {
  const dateKey = input.review_date.toISOString().slice(0, 10);
  const payload = [
    input.source,
    input.normalized_reviewer_name,
    dateKey,
    input.review_text.trim(),
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}
