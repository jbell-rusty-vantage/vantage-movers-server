import assert from "node:assert/strict";
import { test } from "node:test";
import { assertExpansionManifest, type ExpansionManifest } from "./expansion";
import { contentHash, type CandidatePin } from "./manifest";

const pin = (n: number): CandidatePin => ({ lead: { model: "FormLead", id: n.toString(16).padStart(24, "0") }, lead_revision: 2, receiver_agent_id: "123456789012345678901234",
  job_hash: "job", source_company_id: "223456789012345678901234", source_granularity_id: "323456789012345678901234", source_policy_hash: "policy",
  accepted_observation_id: "423456789012345678901234", accepted_at: "2026-10-14T21:00:00Z", decision_id: "523456789012345678901234", link_id: "623456789012345678901234", link_revision: 1,
  subject_id: null, subject_revision: null, sheet_lineage_hash: "sheet", checks: { assigned_desk_rep: true, canonical_membership_eligible: true }, holds: [] });
const manifest = (candidates: CandidatePin[] = [pin(1)]): ExpansionManifest => ({ contract: "pool-reviewed-expansion-v1", database: "testvantagemovers_pool",
  captured_at: "2026-10-14T21:00:00.000Z", expires_at: "2026-10-14T21:30:00.000Z", configuration_revision: 27, configuration_hash: "config", candidates,
  cohort_hashes: { pilot_ready: contentHash(candidates) }, cohort_counts: { pilot_ready: candidates.length }, review_hash: "review", writes: 0 });
const now = +new Date("2026-10-14T21:01:00Z");

test("reviewed expansion permits exact bounded cohort; changed pins/hash/target are rejected", () => {
  const full = manifest(Array.from({ length: 601 }, (_, i) => pin(i + 1)));
  assertExpansionManifest(full, full.database, now);
  assert.throws(() => assertExpansionManifest(full, "vantagemovers", now));
  const altered = structuredClone(full); altered.candidates[0]!.lead_revision++;
  assert.throws(() => assertExpansionManifest(altered, altered.database, now));
  assert.throws(() => assertExpansionManifest(manifest(Array.from({ length: 602 }, (_, i) => pin(i + 1))), full.database, now));
  assert.throws(() => assertExpansionManifest(full, full.database, +new Date(full.expires_at)));
});
test("unassigned and other receivers remain separate reviewed shared cohorts; closed stays held", () => {
  const assigned = pin(1), other = { ...pin(2), checks: { assigned_desk_rep: false, canonical_membership_eligible: true }, holds: ["assigned_desk_rep"] };
  const unassigned = { ...other, lead: pin(3).lead, receiver_agent_id: null };
  const report = manifest([assigned, other, unassigned]);
  report.cohort_hashes = { pilot_ready: contentHash([assigned]), assigned_other_review: contentHash([other]), unassigned_review: contentHash([unassigned]) };
  report.cohort_counts = { pilot_ready: 1, assigned_other_review: 1, unassigned_review: 1 };
  assertExpansionManifest(report, report.database, now);
  const unreviewed = structuredClone(report); delete unreviewed.cohort_hashes.unassigned_review;
  assert.throws(() => assertExpansionManifest(unreviewed, report.database, now));
  const closed = structuredClone(report); closed.candidates[1]!.holds.push("closed_subject");
  assert.throws(() => assertExpansionManifest(closed, report.database, now));
});
