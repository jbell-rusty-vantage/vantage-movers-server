import assert from "node:assert/strict";
import test from "node:test";
import { entityChangeVerdict, type IncidentFacts } from "./entityChanges";

const lead = "a".repeat(24), observation = "b".repeat(24);
const at = new Date("2026-11-01T00:00:00.000Z");
const row = { _id: "c".repeat(24), entity: { model: "CallLead", id: lead }, command_name: "synchronizeLeadFromGranot",
  changed_paths: ["current_move_provenance", "last_accepted_granot_observation"], revision_before: 9, revision_after: 10, applied_at: at,
  provenance: { receipt_id: "d".repeat(24), observation_id: observation, decision_id: "e".repeat(24) } };
const facts = (over: Partial<IncidentFacts> = {}): IncidentFacts => ({ until: new Date(+at + 1000), floors: new Map([[lead, new Date(+at + 1)]]),
  latest: new Map([[lead, 300]]), hot: new Set(), ...over });

test("an incident Entity Change retires only under the full §5 proof predicate", () => {
  for (const [name, input, given, expected] of [
    ["proven incident revision", row, facts(), "retire"],
    ["another path changed too", { ...row, changed_paths: [...row.changed_paths, "receiver_agent"] }, facts(), "not_incident_revision"],
    ["a Form Lead row", { ...row, entity: { model: "FormLead", id: lead } }, facts(), "not_incident_revision"],
    ["another command", { ...row, command_name: "updateSourceOwnedLead" }, facts(), "not_incident_revision"],
    ["the creation row", { ...row, revision_before: 0 }, facts(), "not_incident_revision"],
    ["no later revision", row, facts({ latest: new Map([[lead, 10]]) }), "latest_revision"],
    ["a tail is not 120 s past it", row, facts({ until: at }), "tail_not_past"],
    ["inside the newest 50 (tie at the 50th)", row, facts({ floors: new Map([[lead, at]]) }), "newest_50"],
    ["the Lead has fewer than 50 rows", row, facts({ floors: new Map([[lead, null]]) }), "newest_50"],
    ["its Observation is still hot", row, facts({ hot: new Set([observation]) }), "granot_record_hot"],
  ] as const) {
    const verdict = entityChangeVerdict(input, given);
    assert.equal(verdict.verdict === "retire" ? "retire" : verdict.reason, expected, name);
  }
});
