import assert from "node:assert/strict";
import test from "node:test";
import { sourceOf } from "./build";
import type { StoryEvent } from "../story/types";

// UI-2 gate (operator, 2026-09-25): a rep's own completion names the rep in the Case File; everything else is unchanged.
const completed = (actor: Partial<StoryEvent["actor"]>, origin = "owner") =>
  ({ kind: "followup_completed", actor: { kind: "rep", name: null, agent_id: null, identity_status: null, ...actor }, detail: { origin } }) as unknown as StoryEvent;

test("a rep's completion reads `{rep} (rep)`, or `A rep` without a known Agent", () => {
  assert.equal(sourceOf(completed({ agent_id: "a1" }), { a1: "Dana Reyes" }), "Dana Reyes (rep)");
  assert.equal(sourceOf(completed({ agent_id: "a2" }), { a1: "Dana Reyes" }), "A rep");
  assert.equal(sourceOf(completed({ agent_id: null })), "A rep");
});

test("an Owner's or Vantage's completion keeps its origin label", () => {
  assert.equal(sourceOf(completed({ kind: "owner" }, "owner"), { a1: "Dana Reyes" }), "Owner");
  assert.equal(sourceOf(completed({ kind: "vantage" }, "suggestion")), "Vantage Outreach");
});
