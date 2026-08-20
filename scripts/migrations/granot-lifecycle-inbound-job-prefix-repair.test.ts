import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INBOUND_JOB_PREFIX_REPAIR_VERSION,
  OPERATOR_BOOKING_CASE_REASON,
  assertInboundJobPrefixRepairApplyAllowed,
  buildInboundJobPrefixRepairManifest,
  planInboundJobPrefixRepairRow,
  planInboundJobPrefixRepairWrites,
  scanInboundJobPrefixRepairManifestForPii,
  type InboundJobPrefixRepairFacts,
  type InboundJobPrefixRepairWrite,
} from "./granot-lifecycle-inbound-job-prefix-repair.lib.js";

function historicalPriority(overrides: Partial<InboundJobPrefixRepairFacts> = {}): InboundJobPrefixRepairFacts {
  return {
    decision_id: "6a86982d78429188531c3e50",
    observation_id: "6a86982d78429188531c3e48",
    receipt_id: "6a7cd4df80d2f0547edc6185",
    attempt: 1,
    execution_mode: "historical_shadow",
    old_outcome: "conflict",
    old_reason_code: "job_number_conflict",
    decided_at: "2026-08-20T06:01:17.026Z",
    captured_at: "2026-08-20T06:01:16.000Z",
    route_event_class: "priority_updated",
    observation_job: "5562366",
    call_lead_id: "6a7ced2f8335828749b0552f",
    call_lead_job: "P5562366",
    identity: {
      outcome: "linked",
      reason_code: "call_job_no_exact",
      match_method: "call_job_no_exact",
      target_id: "6a7ced2f8335828749b0552f",
      target_model: "CallLead",
    },
    jobs_prefix_equivalent: true,
    record_link_exists: false,
    booking_exists: false,
    case_exists: false,
    ...overrides,
  };
}

function grossingerBooked(overrides: Partial<InboundJobPrefixRepairFacts> = {}): InboundJobPrefixRepairFacts {
  return historicalPriority({
    decision_id: "6a870d48424028963e53e98c",
    observation_id: "6a870d48424028963e53e98b",
    receipt_id: "6a870d48a2b9f73500413ec9",
    decided_at: "2026-08-20T14:20:56.496Z",
    captured_at: "2026-08-20T14:20:56.000Z",
    route_event_class: "booking_action",
    booking_action: "booked",
    observation_job: "5562530",
    call_lead_id: "6a7f8ff6df93ba7fb544dad3",
    call_lead_job: "P5562530",
    identity: {
      outcome: "linked",
      reason_code: "call_job_no_exact",
      match_method: "call_job_no_exact",
      target_id: "6a7f8ff6df93ba7fb544dad3",
      target_model: "CallLead",
    },
    booking_classification: {
      kind: "case",
      mode: "create_missing_booking",
      evidence_action: "booked",
    },
    live_processor_would_open_case: false,
    live_processor_block_reason: "historical_shadow_requires_live_mode",
    ...overrides,
  });
}

test("[AC-04] prefix-equivalent historical priority plans a job-level Record Link and no Booking", () => {
  const planned = planInboundJobPrefixRepairRow(historicalPriority());
  assert.equal(planned.action, "establish_job_level_record_link");
  assert.equal(planned.apply_eligible, true);
  assert.equal(planned.jobs_prefix_equivalent, true);
  assert.equal(planned.identity_would_link, true);
  assert.equal(planned.open_booking_case, false);
  assert.equal(planned.create_official_booking, false);
  assert.equal(planned.attach_lead_ref, false);
  assert.equal(planned.mutate_original_decision, false);
});

test("[AC-19] Grossinger booked plans an owner-exception create_missing_booking case, not a Booking", () => {
  const planned = planInboundJobPrefixRepairRow(grossingerBooked());
  assert.equal(planned.action, "open_booking_case_operator_exception");
  assert.equal(planned.apply_eligible, true);
  assert.equal(planned.open_booking_case, true);
  assert.equal(planned.booking_case_mode, "create_missing_booking");
  assert.equal(planned.operator_reason, OPERATOR_BOOKING_CASE_REASON);
  assert.equal(planned.create_official_booking, false);
  assert.equal(planned.establish_record_link, true);
  assert.equal(planned.attach_lead_ref, false);
  assert.equal(planned.live_processor_would_open_case, false);
});

test("[AC-04] different digit cores stay conflict and are not repaired", () => {
  const planned = planInboundJobPrefixRepairRow(
    historicalPriority({
      observation_job: "5562366",
      call_lead_job: "P5569999",
      jobs_prefix_equivalent: false,
      identity: { outcome: "conflict", reason_code: "job_number_conflict" },
    }),
  );
  assert.equal(planned.action, "leave_real_conflict");
  assert.equal(planned.apply_eligible, false);
  assert.equal(planned.establish_record_link, false);
  assert.equal(planned.open_booking_case, false);
});

test("post-activation live prefix conflicts are reported and excluded from apply", () => {
  const planned = planInboundJobPrefixRepairRow(
    historicalPriority({
      execution_mode: "live",
      decided_at: "2026-08-20T19:03:56.839Z",
      captured_at: "2026-08-20T19:03:56.688Z",
      observation_job: "5560216",
      call_lead_id: "6a5d2d0052e58306affb5862",
      call_lead_job: "P5560216",
    }),
  );
  assert.equal(planned.action, "report_only_live_conflict");
  assert.equal(planned.apply_eligible, false);
  assert.equal(planned.establish_record_link, false);
});

test("already-written Record Link or booking case makes apply a no-op", () => {
  const linked = planInboundJobPrefixRepairRow(
    historicalPriority({ record_link_exists: true, record_link_id: "6aaaaaaaaaaaaaaaaaaaaaaa" }),
  );
  assert.equal(linked.action, "already_repaired");
  assert.equal(linked.apply_eligible, false);

  const cased = planInboundJobPrefixRepairRow(
    grossingerBooked({
      record_link_exists: true,
      record_link_id: "6aaaaaaaaaaaaaaaaaaaaaaa",
      case_exists: true,
      case_id: "6bbbbbbbbbbbbbbbbbbbbbbb",
    }),
  );
  assert.equal(cased.action, "already_repaired");
  assert.equal(cased.apply_eligible, false);
});

test("write plan never mutates original conflict Decisions and never mints a Booking", () => {
  const writes = planInboundJobPrefixRepairWrites([
    planInboundJobPrefixRepairRow(historicalPriority()),
    planInboundJobPrefixRepairRow(grossingerBooked()),
    planInboundJobPrefixRepairRow(
      historicalPriority({
        execution_mode: "live",
        observation_job: "5560216",
        call_lead_job: "P5560216",
      }),
    ),
  ]);
  assert.equal(writes.some((write) => write.kind === "update_original_decision"), false);
  assert.equal(writes.some((write) => write.kind === "insert_official_booking"), false);
  assert.equal(writes.filter((write) => write.kind === "insert_job_level_record_link").length, 2);
  assert.equal(writes.filter((write) => write.kind === "insert_booking_reconciliation_case").length, 1);
  assert.equal(writes.filter((write) => write.kind === "insert_repair_decision").length, 2);
  assert.ok(
    writes.some(
      (write) =>
        write.kind === "insert_booking_reconciliation_case" &&
        write.normalized_job_no === "5562530" &&
        write.operator_reason === OPERATOR_BOOKING_CASE_REASON,
    ),
  );
});

test("second apply of the same repaired facts plans zero writes", () => {
  const writes = planInboundJobPrefixRepairWrites([
    planInboundJobPrefixRepairRow(historicalPriority({ record_link_exists: true, record_link_id: "6aaaaaaaaaaaaaaaaaaaaaaa" })),
    planInboundJobPrefixRepairRow(
      grossingerBooked({
        record_link_exists: true,
        record_link_id: "6aaaaaaaaaaaaaaaaaaaaaaa",
        case_exists: true,
        case_id: "6bbbbbbbbbbbbbbbbbbbbbbb",
      }),
    ),
  ]);
  assert.deepEqual(writes, []);
});

test("[AC-35] report manifest keeps ids and jobs and strips names, phones, and emails", () => {
  const planned = [
    planInboundJobPrefixRepairRow(historicalPriority()),
    planInboundJobPrefixRepairRow(grossingerBooked()),
  ];
  const manifest = buildInboundJobPrefixRepairManifest({
    databaseName: "vantagemovers",
    mode: "report",
    rows: planned,
    writes: planInboundJobPrefixRepairWrites(planned),
  });
  assert.equal(manifest.script_version, INBOUND_JOB_PREFIX_REPAIR_VERSION);
  assert.equal(manifest.mode, "report");
  assert.equal(manifest.summary.historical_apply_eligible, 2);
  assert.equal(manifest.summary.booking_cases_planned, 1);
  assert.equal(manifest.summary.official_bookings_planned, 0);
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes("Donia"), false);
  assert.equal(serialized.includes("Grossinger"), false);
  assert.equal(serialized.includes("@"), false);
  assert.deepEqual(scanInboundJobPrefixRepairManifestForPii(manifest), []);
});

test("apply refuses when a live row is marked eligible or a real conflict is planned", () => {
  const live = planInboundJobPrefixRepairRow(
    historicalPriority({ execution_mode: "live", observation_job: "5560216", call_lead_job: "P5560216" }),
  );
  assert.throws(() =>
    assertInboundJobPrefixRepairApplyAllowed({
      rows: [{ ...live, apply_eligible: true }],
      writes: [{ kind: "insert_job_level_record_link", observation_id: live.observation_id, normalized_job_no: "5560216" }],
    }),
  );

  const realConflict = planInboundJobPrefixRepairRow(
    historicalPriority({
      jobs_prefix_equivalent: false,
      identity: { outcome: "conflict", reason_code: "job_number_conflict" },
    }),
  );
  const writes: InboundJobPrefixRepairWrite[] = [
    { kind: "insert_job_level_record_link", observation_id: realConflict.observation_id, normalized_job_no: "5562366" },
  ];
  assert.throws(() => assertInboundJobPrefixRepairApplyAllowed({ rows: [realConflict], writes }));
});
