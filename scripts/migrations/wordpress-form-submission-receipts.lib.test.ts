import assert from "node:assert/strict";
import { test } from "node:test";
import { WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES } from "../../src/models/WordpressFormSubmissionReceipt.js";
import {
  summarizeWordpressReceiptIndexes,
  wordpressReceiptIndexPresent,
} from "./wordpress-form-submission-receipts.lib.js";

test("unique idempotency index is named and unique", () => {
  const unique = WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES[0];
  assert.equal(unique.name, "wordpress_form_submission_receipt_submission_key_unique");
  assert.equal(unique.unique, true);
  assert.deepEqual(unique.key, { submission_key: 1 });
});

test("report-first index inventory names present vs missing", () => {
  const summary = summarizeWordpressReceiptIndexes([
    {
      name: "wordpress_form_submission_receipt_submission_key_unique",
      key: { submission_key: 1 },
    },
  ]);
  assert.equal(wordpressReceiptIndexPresent([], WORDPRESS_FORM_SUBMISSION_RECEIPT_INDEXES[0]), false);
  assert.equal(summary[0]?.present, true);
  assert.equal(summary[1]?.present, false);
});
