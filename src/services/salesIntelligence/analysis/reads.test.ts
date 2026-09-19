import assert from "node:assert/strict";
import { test } from "node:test";
import { leadRelevance, projectLead, readContentSchema, readCursor } from "./reads";
import type { ReadScope } from "./contracts";

const scope: ReadScope = { run_id: "a".repeat(24), subject_key: `number:${"b".repeat(24)}`, contact_number_id: "b".repeat(24), conversation_id: null, outreach_record_id: null, account_id: null, e164: "+12025550100", lead_refs: [{ model: "CallLead", id: "c".repeat(24) }] };
test("cursor cannot change run, filter, or smuggle a Mongo operator", () => {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const key = `${scope.run_id}:leads:CallLead:synthetic`;
  assert.equal(readCursor(encode({ key, after: "d".repeat(24) }), key), "d".repeat(24));
  assert.throws(() => readCursor(encode({ key, after: { $ne: null } }), key), /INVALID_INPUT/);
  assert.throws(() => readCursor(encode({ key, after: "d".repeat(24) }), `${key}changed`), /INVALID_INPUT/);
  assert.throws(() => readCursor(encode({ key, after: "d".repeat(24), limit: 500 }), key), /INVALID_INPUT/);
});
test("relevance derives only from authorized lead edges and full normalized number", () => {
  const call = leadRelevance(scope, "CallLead");
  const form = leadRelevance(scope, "FormLead");
  assert.equal(JSON.stringify(call.$or[0]), JSON.stringify({ _id: { $in: ["c".repeat(24)] } }));
  assert.equal(JSON.stringify(form.$or[0]), JSON.stringify({ _id: { $in: [] } }));
  const normalized = call.$or.find(c => "normalized_phone_number" in c);
  assert.deepEqual(normalized, { normalized_phone_number: "2025550100" });
  const phone = call.$or.find(c => "phone_number" in c)!.phone_number as RegExp;
  assert(phone.test("+1 (202) 555-0100"));
  assert(!phone.test("+1 (202) 555-0199"));
  assert(!phone.test("9992025550100"));
});
test("projection excludes operational secrets and redacts untrusted free text", () => {
  const row = projectLead({ _id: "c".repeat(24), domain_revision: 8, name: "Synthetic cvv 123", phone_number: "2025550100", email: "private@example.invalid", raw_provider_body: "secret", booked: "d".repeat(24) }, "CallLead");
  assert.equal(row.revision, "8");
  assert.equal(row.fields.name, "Synthetic cvv [REDACTED:CVV]");
  assert.equal(row.fields.booked, true);
  assert(!JSON.stringify(row).includes("secret"));
  assert(!JSON.stringify(row).includes("private@"));
});
test("response contract retains unknown speaker and nullable timing and rejects extra authority", () => {
  const content = { page: { records: [], complete: false, next_cursor: "next", missing_ranges: ["segments_after:1"] },
    coverage: { known_through: null, gaps: [], capabilities: { call_log: "unknown" }, ai_paused: false }, allowed_followup_ids: [], instructions: [], speaker_refs: [],
    transcript: { conversation_id: "d".repeat(24), transcript_version: "csi-transcript-v1:synthetic", source_snapshot_id: "e".repeat(24), segments: [{ sid: 1, text: "Synthetic evidence", start_ms: null, end_ms: null, timing_source: "unavailable", speaker: "unknown" }] } };
  assert.deepEqual(readContentSchema.parse(content), content);
  assert.throws(() => readContentSchema.parse({ ...content, send_message: true }));
  assert.throws(() => readContentSchema.parse({ ...content, page: { ...content.page, records: [{ record_type: "lead", record_id: "a", revision: "1", fields: { arbitrary_authority: true } }] } }));
});
