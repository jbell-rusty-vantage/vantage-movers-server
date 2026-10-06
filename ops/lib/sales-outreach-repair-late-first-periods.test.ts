import assert from "node:assert/strict";
import test from "node:test";
import {
  isLateFirstPeriod,
  parseRepairArgs,
  planLateFirstPeriodRepair,
  summarizeRepair,
  type RepairCandidate,
} from "./sales-outreach-repair-late-first-periods";

const at = (iso: string) => new Date(iso);
/** A review subject admitted Mon 14:00Z whose priority was accepted Wed 18:00Z (the pre-B1 bug row). */
const row = (overrides: Partial<RepairCandidate> = {}): RepairCandidate => ({
  period_id: "p".repeat(24),
  subject_id: "s".repeat(24),
  period_revision: 1,
  started_at: at("2026-10-05T14:00:00Z"),
  ended_at: null,
  time_basis: "activation_boundary",
  period_created_at: at("2026-10-07T18:00:05Z"),
  subject_created_at: at("2026-10-05T14:01:00Z"),
  activation_at: at("2026-10-05T14:00:00Z"),
  priority_source_ref: "o".repeat(24),
  observation_captured_at: at("2026-10-07T18:00:00Z"),
  ...overrides,
});

test("parseRepairArgs: dry run by default, --target required and plain, --apply, guard flag passes through", () => {
  assert.deepEqual(parseRepairArgs(["--target=vantagemovers"]), { target: "vantagemovers", apply: false });
  assert.deepEqual(parseRepairArgs(["--target=testvantagemovers", "--apply", "--allow-schema-drift"]), { target: "testvantagemovers", apply: true });
  assert.throws(() => parseRepairArgs([]), /--target=<database name> is required/);
  assert.throws(() => parseRepairArgs(["--target=vantage movers"]), /plain database name/);
  assert.throws(() => parseRepairArgs(["--target=vantagemovers", "apply"]), /Unknown argument: apply/);
});

test("isLateFirstPeriod: only a period written more than 60 s after its subject", () => {
  assert.equal(isLateFirstPeriod({ subject_created_at: at("2026-10-05T14:00:00Z"), period_created_at: at("2026-10-05T14:00:01Z") }), false);
  assert.equal(isLateFirstPeriod({ subject_created_at: at("2026-10-05T14:00:00Z"), period_created_at: at("2026-10-05T14:01:00Z") }), false);
  assert.equal(isLateFirstPeriod({ subject_created_at: at("2026-10-05T14:00:00Z"), period_created_at: at("2026-10-05T14:01:00.001Z") }), true);
});

test("plan: the late first period moves to the accepted observation time, as an activation start", () => {
  const plan = planLateFirstPeriodRepair(row());
  assert.equal(plan.action, "repair");
  if (plan.action !== "repair") return;
  assert.deepEqual(
    [plan.next.started_at.toISOString(), plan.next.start_kind, plan.next.time_basis, plan.expected_revision],
    ["2026-10-07T18:00:00.000Z", "activation", "accepted_observation_captured_at", 1],
  );
  assert.deepEqual([plan.prior.started_at.toISOString(), plan.prior.start_kind, plan.prior.time_basis], ["2026-10-05T14:00:00.000Z", "intake", "activation_boundary"]);
});

test("plan: no observation → the period row's creation instant (desk_decision_at); never before the boundary", () => {
  const noObservation = planLateFirstPeriodRepair(row({ priority_source_ref: null, observation_captured_at: null }));
  assert.ok(noObservation.action === "repair");
  if (noObservation.action !== "repair") return;
  assert.deepEqual([noObservation.next.started_at.toISOString(), noObservation.next.time_basis], ["2026-10-07T18:00:05.000Z", "desk_decision_at"]);
  const early = planLateFirstPeriodRepair(row({ observation_captured_at: at("2026-10-01T09:00:00Z") }));
  assert.ok(early.action === "repair");
  if (early.action !== "repair") return;
  assert.deepEqual([early.next.started_at.toISOString(), early.next.start_kind, early.next.time_basis], ["2026-10-05T14:00:00.000Z", "activation", "activation_boundary"]);
});

test("plan: a period written with its subject, or whose new start would pass its end, is skipped", () => {
  assert.deepEqual(planLateFirstPeriodRepair(row({ period_created_at: at("2026-10-05T14:01:02Z") })), {
    action: "skip",
    period_id: "p".repeat(24),
    subject_id: "s".repeat(24),
    reason: "written_with_subject",
  });
  assert.equal((planLateFirstPeriodRepair(row({ ended_at: at("2026-10-06T12:00:00Z") })) as { reason?: string }).reason, "starts_after_end");
  // An ended period whose new start is still before its end is repaired.
  assert.equal(planLateFirstPeriodRepair(row({ ended_at: at("2026-10-08T12:00:00Z") })).action, "repair");
});

test("summarizeRepair: counts repairable rows and real skips; ids and instants only", () => {
  const plans = [
    planLateFirstPeriodRepair(row()),
    planLateFirstPeriodRepair(row({ period_id: "a".repeat(24), ended_at: at("2026-10-06T12:00:00Z") })),
    planLateFirstPeriodRepair(row({ period_id: "b".repeat(24), period_created_at: at("2026-10-05T14:01:01Z") })),
  ];
  const summary = summarizeRepair(7, plans);
  assert.equal(summary.intake_periods, 7);
  assert.equal(summary.repairable, 1);
  assert.deepEqual(summary.skipped, { starts_after_end: 1 });
  assert.deepEqual(summary.plans, [
    { period_id: "p".repeat(24), subject_id: "s".repeat(24), action: "repair", from: "2026-10-05T14:00:00.000Z", to: "2026-10-07T18:00:00.000Z", time_basis: "accepted_observation_captured_at" },
    { period_id: "a".repeat(24), subject_id: "s".repeat(24), action: "skip", reason: "starts_after_end" },
  ]);
});
