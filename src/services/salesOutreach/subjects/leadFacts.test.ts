import assert from "node:assert/strict";
import { test } from "node:test";
import { toDeskLeadFacts } from "./leadFacts";

test("Call Lead move date reaches outreach display as a date-only value; missing/invalid stays unknown", () => {
  const raw = { _id: "a".repeat(24), move_date: new Date("2026-11-01T00:00:00.000Z") };
  assert.equal(toDeskLeadFacts("CallLead", raw).move_date, "2026-11-01");
  assert.equal(toDeskLeadFacts("FormLead", raw).move_date, "2026-11-01");
  assert.equal(toDeskLeadFacts("CallLead", { _id: raw._id }).move_date, null);
  assert.equal(toDeskLeadFacts("CallLead", { ...raw, move_date: new Date("invalid") }).move_date, null);
});
