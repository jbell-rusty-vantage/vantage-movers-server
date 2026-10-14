import assert from "node:assert/strict";
import { test } from "node:test";
import { assertFreshManifest, buildManifest, contentHash, expansionCohorts, publicSummary, selectionSchema, type CandidatePin } from "./manifest";

const candidate = (id = "0123456789abcdef01234567"): CandidatePin => ({ lead: { model: "FormLead", id }, lead_revision: 4,
  receiver_agent_id: "1123456789abcdef01234567", job_hash: contentHash("SYNTHETIC"), source_company_id: "2123456789abcdef01234567",
  source_granularity_id: "3123456789abcdef01234567", source_policy_hash: contentHash("policy"), accepted_observation_id: "4123456789abcdef01234567",
  accepted_at: "2026-10-14T20:00:00.000Z", decision_id: "5123456789abcdef01234567", link_id: "6123456789abcdef01234567",
  link_revision: 2, subject_id: null, subject_revision: null, sheet_lineage_hash: contentHash("sheet"), checks: { assigned: true }, holds: [] });
const manifest = (candidates = [candidate()]) => buildManifest({ database: "testvantagemovers_pool", captured_at: "2026-10-14T20:00:00.000Z", configuration_revision: 10, configuration_hash: "hash", candidates });

test("pilot accepts exact ready pins only within thirty minutes on the named target", () => {
  assertFreshManifest(manifest(), "testvantagemovers_pool", new Date("2026-10-14T20:29:59Z"));
  assert.throws(() => assertFreshManifest(manifest(), "vantagemovers", new Date("2026-10-14T20:01:00Z")));
  assert.throws(() => assertFreshManifest(manifest(), "testvantagemovers_pool", new Date("2026-10-14T20:30:00Z")));
});
test("changed pins, held rows and expanded selections are refused", () => {
  const changed = manifest(); changed.candidates[0]!.lead_revision++;
  assert.throws(() => assertFreshManifest(changed, changed.database, new Date("2026-10-14T20:01:00Z")));
  const held = manifest([{ ...candidate(), checks: { closed: false }, holds: ["closed"] }]);
  assert.equal(held.ready, false);
  assert.throws(() => assertFreshManifest(held, held.database, new Date("2026-10-14T20:01:00Z")));
  assert.throws(() => selectionSchema.parse(Array.from({ length: 21 }, (_, i) => ({ model: "FormLead", id: i.toString(16).padStart(24, "0") }))));
  assert.throws(() => selectionSchema.parse([candidate().lead, candidate().lead]));
});
test("tracked summary contains no operational identity or customer data", () => {
  const summary = JSON.stringify(publicSummary(manifest()));
  for (const id of [candidate().lead.id, candidate().receiver_agent_id, candidate().source_company_id, candidate().accepted_observation_id]) assert.ok(!summary.includes(id!));
  assert.equal(publicSummary(manifest()).selected, 1);
});
test("receiver eligibility narrows pilot, never canonical shared eligibility", () => {
  const active = { ...candidate(), checks: { assigned_desk_rep: true } };
  const other = { ...candidate("0123456789abcdef01234568"), checks: { assigned_desk_rep: false }, holds: ["assigned_desk_rep"] };
  const unassigned = { ...candidate("0123456789abcdef01234569"), receiver_agent_id: null, checks: { assigned_desk_rep: false }, holds: ["assigned_desk_rep"] };
  const closed = { ...candidate("0123456789abcdef0123456a"), holds: ["subject_not_closed_or_review"] };
  const grouped = expansionCohorts([active, other, unassigned, closed]);
  assert.deepEqual([grouped.coherent.length, grouped.pilot_ready.length, grouped.assigned_other_review.length, grouped.unassigned_review.length, grouped.held.length], [3, 1, 1, 1, 1]);
});
