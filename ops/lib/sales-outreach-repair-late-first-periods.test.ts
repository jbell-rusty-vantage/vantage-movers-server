import assert from "node:assert/strict";
import test from "node:test";
import { fakeSession, MemoryDeskSubjectStore } from "../../src/services/salesOutreach/subjects/testing";
import { SUBJECT_WAKE_SOURCES_PER_KIND } from "../../src/services/salesOutreach/subjects/sync";
import {
  isLateFirstPeriod,
  nominateRepairContactWake,
  parseRepairArgs,
  planLateFirstPeriodRepair,
  repairContactWakeOf,
  summarizeRepair,
  type RepairCandidate,
  type RepairPlan,
} from "./sales-outreach-repair-late-first-periods";

const at = (iso: string) => new Date(iso);
/** A review subject admitted Mon 14:00Z whose priority was accepted Wed 18:00Z (the pre-B1 bug row). */
const row = (overrides: Partial<RepairCandidate> = {}): RepairCandidate => ({
  period_id: "p".repeat(24),
  subject_id: "s".repeat(24),
  lead: { model: "FormLead", id: "l".repeat(24) },
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

const repairOf = (overrides: Partial<RepairCandidate> = {}) => {
  const plan = planLateFirstPeriodRepair(row(overrides));
  assert.equal(plan.action, "repair");
  return plan as Extract<RepairPlan, { action: "repair" }>;
};

test("BW1 repairContactWakeOf: the window the start moved over [old start, new start), C4 bounds, repair identity", () => {
  const plan = repairOf();
  const now = at("2026-10-08T12:00:00Z");
  assert.deepEqual(repairContactWakeOf(plan, now), {
    lead: { model: "FormLead", id: "l".repeat(24) },
    since: at("2026-10-05T14:00:00Z"),
    until: at("2026-10-07T18:00:00Z"),
    source_revision: `repair:${"p".repeat(24)}`,
    limit_per_kind: SUBJECT_WAKE_SOURCES_PER_KIND,
    now,
  });
  // Never earlier than C4's 14-day lookback before now.
  assert.equal(repairContactWakeOf(plan, at("2026-10-20T14:00:00Z"))?.since.toISOString(), "2026-10-06T14:00:00.000Z");
  // The whole window is older than the lookback: nothing to re-derive.
  assert.equal(repairContactWakeOf(plan, at("2026-10-22T12:00:00Z")), null);
  // The boundary wins (the start does not move): nothing to re-derive.
  assert.equal(repairContactWakeOf(repairOf({ observation_captured_at: at("2026-10-01T09:00:00Z") }), now), null);
});

test("BW1 nominateRepairContactWake: only while the desk wants contact evidence; the C4 nomination gets the window", async () => {
  const plan = repairOf();
  const now = at("2026-10-08T12:00:00Z");
  const requests: unknown[] = [];
  const nominate = async (request: unknown) => (requests.push(request), 3);
  assert.equal(await nominateRepairContactWake(plan, now, fakeSession, { wanted: async () => false, nominate }), 0);
  assert.equal(requests.length, 0, "controls off: nothing nominated (C4's rule, fail closed)");
  assert.equal(await nominateRepairContactWake(plan, now, fakeSession, { wanted: async () => true, nominate }), 3);
  assert.deepEqual(requests, [repairContactWakeOf(plan, now)]);
  let asked = false;
  const noMove = repairOf({ observation_captured_at: at("2026-10-01T09:00:00Z") });
  assert.equal(await nominateRepairContactWake(noMove, now, fakeSession, { wanted: async () => ((asked = true), true), nominate }), 0);
  assert.equal(asked, false, "an empty window reads no configuration");
});

test("BW1 with C4's store: only the subject's calls and SMS between the old and the new start are re-derived, once", async () => {
  const store = new MemoryDeskSubjectStore();
  store.creditedNumbers.set(`FormLead:${"l".repeat(24)}`, [{ id: "n1", e164: "+15550100001" }]);
  store.creditedNumbers.set("FormLead:other", [{ id: "n2", e164: "+15550100002" }]);
  const call = (id: string, iso: string, number = "n1") => store.calls.push({ id, contact_number_id: number, started_at: at(iso) });
  call("c-before-old-start", "2026-10-05T13:59:59Z");
  call("c-at-old-start", "2026-10-05T14:00:00Z");
  call("c-between", "2026-10-06T16:00:00Z");
  call("c-at-new-start", "2026-10-07T18:00:00Z");
  call("c-after", "2026-10-07T19:00:00Z");
  call("c-other-lead", "2026-10-06T16:00:00Z", "n2");
  store.sms.push({ id: "m-between", counterpart_numbers: ["+15550100001"], provider_created_at: at("2026-10-06T17:00:00Z") });
  store.sms.push({ id: "m-scheduled-before-sent-between", counterpart_numbers: ["+15550100001"], provider_created_at: at("2026-10-05T12:00:00Z"), send_at: at("2026-10-06T12:00:00Z") });
  store.sms.push({ id: "m-after", counterpart_numbers: ["+15550100001"], provider_created_at: at("2026-10-07T20:00:00Z") });
  const plan = repairOf();
  const now = at("2026-10-08T12:00:00Z");
  const deps = { wanted: async () => true, nominate: store.nominateContactSources.bind(store) };
  assert.equal(await nominateRepairContactWake(plan, now, fakeSession, deps), 4);
  assert.deepEqual(
    [...store.contactJobs.keys()].sort(),
    [
      `sod:contact_change:call:c-at-old-start:repair:${"p".repeat(24)}`,
      `sod:contact_change:call:c-between:repair:${"p".repeat(24)}`,
      `sod:contact_change:sms:m-between:repair:${"p".repeat(24)}`,
      `sod:contact_change:sms:m-scheduled-before-sent-between:repair:${"p".repeat(24)}`,
    ],
  );
  await nominateRepairContactWake(plan, now, fakeSession, deps);
  assert.equal(store.contactJobs.size, 4, "a replay dedupes on the job identity");
});
