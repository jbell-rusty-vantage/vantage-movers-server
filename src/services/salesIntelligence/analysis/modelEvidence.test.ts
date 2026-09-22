import assert from "node:assert/strict";
import { test } from "node:test";
import { modelEvidence } from "./modelEvidence";

test("model context omits server metadata even inside encoded prior findings and Owner corrections", () => {
  const source = { records: [{ record_id: "allowed-lead", details: JSON.stringify({ claim: "quoted price",
    evidence: [{ snapshot_id: "hidden", conversation_id: "hidden", transcript_version: "hidden", segment_ids: [1] }] }) }],
    corrections: [{ current: { speaker_ref: "agent:hidden", finding_keys: ["hidden"], value: { description: "Owner instruction" } } }] };
  const result = JSON.stringify(modelEvidence(source));
  assert.doesNotMatch(result, /snapshot_id|conversation_id|transcript_version|speaker_ref|finding_keys/);
  assert.match(result, /allowed-lead/);
  assert.match(result, /Owner instruction/);
  assert.match(JSON.stringify(source), /snapshot_id/, "persisted source is not mutated");
});
