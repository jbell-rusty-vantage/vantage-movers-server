import assert from "node:assert/strict";
import test from "node:test";
import { qualifiedShadowWeek } from "./shadowWeek";

test("promotion requires seven complete, successful production shadow days after explicit arming", () => {
  const now = new Date("2026-11-18T13:00:00Z"),
    armed = new Date("2026-11-03T18:00:00Z");
  const days = ["11", "12", "13", "14", "15", "16", "17"].map((d) => ({
    _id: "2026-11-" + d,
    qualified: 100,
    read_comparisons: 3,
    ttl_stamped: 0,
    mode: "shadow",
  }));
  assert.equal(qualifiedShadowWeek(now, armed, days), true);
  for (const bad of [
    { failures: 1 },
    { mismatches: 1 },
    { qualified: 0 },
    { read_comparisons: 0 },
    { ttl_stamped: 1 },
    { mode: "future" },
    { _id: "2026-11-18" },
  ]) {
    assert.equal(
      qualifiedShadowWeek(now, armed, [
        { ...days[0], ...bad },
        ...days.slice(1),
      ]),
      false,
    );
  }
  assert.equal(qualifiedShadowWeek(now, new Date("2026-11-12"), days), false);
  assert.equal(qualifiedShadowWeek(now, armed, days.slice(1)), false);
});
