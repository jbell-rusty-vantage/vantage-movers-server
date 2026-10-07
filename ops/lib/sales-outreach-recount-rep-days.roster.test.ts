import assert from "node:assert/strict";
import { test } from "node:test";
import { planRecountKeys } from "./sales-outreach-recount-rep-days";

/** P08a-1: the recount script materializes zero rows for each day's own effective roster (desk reps at that day's end). */
const ALICE = "a".repeat(24);
const BOB = "b".repeat(24);
const CAROL = "c".repeat(24);
const TODAY = "2026-10-07";

test("planRecountKeys with a per-day roster: each past day gets the materialize keys of its own roster", () => {
  const rows = [{ agent_id: ALICE, business_day: "2026-10-05", count_scope: "all_outbound" as const, actual_confirmed: 3, both_counts: true }];
  const rosterOf = (day: string) => (day === "2026-10-05" ? [ALICE, BOB] : day === "2026-10-06" ? [BOB, CAROL] : []);
  const keys = planRecountKeys({ rows, roster: rosterOf, from: "2026-10-05", to: TODAY, today: TODAY, materialize_roster: true });
  assert.deepEqual(keys, [
    { agent_id: ALICE, business_day: "2026-10-05" },
    { agent_id: BOB, business_day: "2026-10-05", materialize: true },
    { agent_id: BOB, business_day: "2026-10-06", materialize: true },
    { agent_id: CAROL, business_day: "2026-10-06", materialize: true },
  ]);
  // A plain list still applies to every past day (the explicit rule).
  const flat = planRecountKeys({ rows, roster: [CAROL], from: "2026-10-05", to: TODAY, today: TODAY, materialize_roster: true });
  assert.deepEqual(flat.filter((k) => k.materialize).map((k) => [k.agent_id, k.business_day]), [[CAROL, "2026-10-05"], [CAROL, "2026-10-06"]]);
});
