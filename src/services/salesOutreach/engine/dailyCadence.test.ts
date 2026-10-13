import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDeskPolicy } from "../subjects/policyMapping";
import { accepted, deskConfiguration, leadFacts } from "../subjects/testing";
import { evaluate, obligationsOn, period, scenario, ny } from "./testSupport";

test("priority 2 and priority 3 each take one ordinary call a day and stay open, including a future move date", () => {
  for (const code of ["2", "3"] as const) {
    const decision = resolveDeskPolicy(
      leadFacts({ ...accepted(code, "2026-10-05T13:00:00Z"), move_date: "2026-11-20" }),
      deskConfiguration().value.cadence,
    );
    assert.equal(decision.kind, "accepted", code);
    if (decision.kind !== "accepted") continue;
    assert.equal(decision.workflow, "daily", code);

    const started = ny("2026-10-05", "09:00");
    const input = scenario({
      move_date: "2026-11-20",
      periods: [period("d1", "daily", started, "transition", null, code)],
    });
    const firstDay = evaluate(input, ny("2026-10-05", "15:00"));
    assert.equal(firstDay.state, "active", code);
    assert.equal(obligationsOn(firstDay, "2026-10-05", "call").length, 1);
    assert.equal(obligationsOn(firstDay, "2026-10-05", "call")[0]?.kind, "ordinary");
    assert.ok(firstDay.obligations.every((obligation) => obligation.kind !== "quoted"), code);

    const secondDay = evaluate(input, ny("2026-10-06", "15:00"));
    assert.equal(secondDay.state, "active", code);
    assert.equal(obligationsOn(secondDay, "2026-10-05", "call").length, 1);
    assert.equal(obligationsOn(secondDay, "2026-10-06", "call").length, 1);
    assert.equal(obligationsOn(secondDay, "2026-10-06", "sms").length, 0);
  }
});
