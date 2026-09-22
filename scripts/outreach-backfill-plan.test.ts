import assert from "node:assert/strict";
import { test } from "node:test";
import { selectCandidates, type Candidate } from "./outreach-backfill-plan";

const candidate = (id: string, model: Candidate["model"] = "FormLead", overrides: Partial<Candidate> = {}): Candidate => ({
  lead_id: id, model, arrived_at: new Date("2026-09-20"), number_ids: [id], outreach_id: null,
  outreach_state: "unworked", edges: [], conversations: [], ...overrides,
});
test("selection keeps both channels, excludes closed/ambiguous work and deduplicates numbers", () => {
  const rows = [candidate("form"), candidate("call", "CallLead"), candidate("closed", "CallLead", { outreach_state: "closed" }),
    candidate("ambiguous", "FormLead", { outreach_state: "identity_review" }), candidate("repeat", "FormLead", { number_ids: ["form"] })];
  assert.deepEqual(selectCandidates(rows, 10).map(c => c.lead_id), ["form", "call"]);
});
test("unfinished recorded evidence outranks completed evidence and recency alone; no duration cutoff", () => {
  const recording = { id: "c", number_id: "n", interaction_id: "i", started_at: new Date(), duration_seconds: 1, state: "transcribed", transcript: true, media: true };
  const rows = [candidate("new", "FormLead", { arrived_at: new Date() }),
    candidate("complete", "FormLead", { conversations: [{ ...recording, state: "complete" }] }),
    candidate("unfinished", "FormLead", { conversations: [recording] })];
  assert.equal(selectCandidates(rows, 1)[0]?.lead_id, "unfinished");
  assert.throws(() => selectCandidates(rows, 0));
  assert.throws(() => selectCandidates(rows, 101));
});
