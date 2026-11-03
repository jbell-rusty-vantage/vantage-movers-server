import assert from "node:assert/strict";
import { test } from "node:test";
import { isImportOutreachSuppressed } from "./importAdmission";
import { accepted, leadFacts } from "./testing";

test("import timestamp and old/equal observations cannot release the immutable import admission hold", () => {
 const facts = leadFacts({ outreach_automation_suppressed: true });
 assert.equal(isImportOutreachSuppressed(facts), true);
 const newerBusinessTimestamp = { ...facts, timestamp: new Date("2030-01-01") };
 assert.equal(isImportOutreachSuppressed(newerBusinessTimestamp), true);
 for (const capturedAt of ["2026-09-01T00:00:00Z", facts.created_at!.toISOString()]) {
  assert.equal(isImportOutreachSuppressed({ ...facts, ...accepted("9", capturedAt) }), true);
 }
 assert.equal(isImportOutreachSuppressed({ ...facts, ...accepted("9", "2026-10-01T14:00:05.001Z") }), false);
 assert.equal(isImportOutreachSuppressed({ ...facts, created_at: null, ...accepted("9", "2026-10-01T15:00:00Z") }), true);
 assert.equal(isImportOutreachSuppressed({ ...facts, accepted_observation: { observation_id: "", captured_at: new Date("2026-10-01T15:00:00Z") } }), true);
 assert.equal(facts.outreach_automation_suppressed, true);
});

test("the marker affects imported Forms only; ordinary intake and Call policies stay independent", () => {
 assert.equal(isImportOutreachSuppressed(leadFacts()), false);
 assert.equal(isImportOutreachSuppressed(leadFacts({ model: "CallLead", outreach_automation_suppressed: true })), false);
});
