import { WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES } from "../../src/models/WordpressFormSubmissionReceipt.js";

export const WORDPRESS_FORM_SUBMISSION_RECEIPTS_SCRIPT_VERSION = "jte-07.1";

export function wordpressReceiptIndexPresent(
  indexes: Array<{ name?: string; key?: Record<string, unknown> }>,
  expected: (typeof WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES)[number],
): boolean {
  return indexes.some(
    (index) =>
      index.name === expected.name
      && JSON.stringify(index.key) === JSON.stringify(expected.key),
  );
}

export function summarizeWordpressReceiptIndexes(
  indexes: Array<{ name?: string; key?: Record<string, unknown> }>,
) {
  return WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES.map((expected) => ({
    name: expected.name,
    unique: expected.unique,
    present: wordpressReceiptIndexPresent(indexes, expected),
  }));
}
