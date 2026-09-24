import assert from "node:assert/strict";
import { test } from "node:test";
import { legacyOutreachFingerprint } from "./legacy-outreach-fingerprint";

// Moved from `analysis/sources.fingerprint.test.ts` with the function (Team 3 S5c-HOUSEKEEPING).
test("V-AC N3: the 01bcf18 hash never matches a Number over the old 200-action bound", () => {
  const action = (i: number) => ({ _id: `a${i}`, kind: "call", description: "Call back", status: "open", due_at: null, origin: "system_default",
    responsible_agent_id: null, promised_by_agent_id: null, source_interaction_id: null });
  const actions = Array.from({ length: 201 }, (_, i) => action(i));
  const base = { number: "n1", calls: [] };
  const outreach = [{ _id: "r1", subject: { kind: "lead", model: "FormLead", id: "l1" }, state: "open", closed_reason: null }];
  assert.equal(legacyOutreachFingerprint({ fingerprint_base: base, outreach: outreach as never, actions: actions as never }), "legacy:over_action_bound");
  assert.match(legacyOutreachFingerprint({ fingerprint_base: base, outreach: outreach as never, actions: actions.slice(0, 200) as never }), /^[a-f0-9]{64}$/);
});
