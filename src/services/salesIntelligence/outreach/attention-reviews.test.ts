import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionReviewSubject } from "./attention";
import { csiSubjectSchema } from "../../../validation/v1/salesIntelligence";

test("conversation reviews project to the actual Number, not an invalid Lead", () => {
  const conversation = "aaaaaaaaaaaaaaaaaaaaaaaa", number = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const subject = attentionReviewSubject(`conversation:${conversation}`, new Map([[conversation, number]]));
  assert.deepEqual(csiSubjectSchema.parse(subject), { kind: "number_review", contact_number_id: number });
  assert.equal(attentionReviewSubject(`conversation:${conversation}`, new Map()), null);
  assert.equal(attentionReviewSubject("invalid:subject", new Map()), null);
  assert.deepEqual(attentionReviewSubject(`lead:FormLead:${number}`, new Map()), { kind: "lead", model: "FormLead", id: number });
});
