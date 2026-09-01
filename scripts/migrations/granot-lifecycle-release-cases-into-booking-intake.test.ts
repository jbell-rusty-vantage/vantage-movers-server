import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HISTORICAL_DATABASE,
  PRODUCTION_DATABASE,
  TEST_DATABASE,
} from "./operations-registry-migration.lib.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
} from "./granot-lifecycle-migration.lib.js";
import {
  RELEASE_CASE_MIGRATE_REASON,
  RELEASE_CASES_INTO_BOOKING_INTAKE_VERSION,
  RELEASE_DISCREPANCY_MIGRATE_CHOICE,
  assertReleaseCasesIntoBookingIntakeApplyAllowed,
  buildReleaseCasesIntoBookingIntakeManifest,
  planReleaseCasesIntoBookingIntakeRow,
  planReleaseCasesIntoBookingIntakeWrites,
  planReleaseWithoutVantageBookingDiscrepancies,
  scanReleaseCasesIntoBookingIntakeManifestForPii,
  type ReleaseCasesIntoBookingIntakeFacts,
  type ReleaseCasesIntoBookingIntakeWrite,
} from "./granot-lifecycle-release-cases-into-booking-intake.lib.js";

function releaseEvidence(
  observationId = "6a874c35eac3718160f4db0b",
  capturedAt = "2026-08-20T18:49:24.824Z",
) {
  return {
    observation_id: observationId,
    decision_id: "6a874c35eac3718160f4db0c",
    captured_at: capturedAt,
  };
}

function openRelease(overrides: Partial<ReleaseCasesIntoBookingIntakeFacts> = {}): ReleaseCasesIntoBookingIntakeFacts {
  return {
    release_case_id: "6a875b809f4c8bcfbf5cd870",
    normalized_job_no: "5562117",
    job_no_snapshot: "5562117",
    release_evidence: [releaseEvidence()],
    max_booking_sequence: 0,
    ...overrides,
  };
}

test("open Release + no booking case + no official Booking plans open create-missing, append release evidence, and resolve", () => {
  const planned = planReleaseCasesIntoBookingIntakeRow(openRelease());
  assert.equal(planned.action, "open_booking_case");
  assert.equal(planned.apply_eligible, true);
  assert.equal(planned.open_booking_case, true);
  assert.equal(planned.booking_case_mode, "create_missing_booking");
  assert.equal(planned.planned_sequence, 1);
  assert.deepEqual(planned.append_observation_ids, ["6a874c35eac3718160f4db0b"]);
  assert.equal(planned.resolve_release_case.state, "resolved");
  assert.equal(planned.resolve_release_case.outcome, "no_action");
  assert.equal(planned.resolve_release_case.reason, RELEASE_CASE_MIGRATE_REASON);
  assert.equal(planned.create_official_booking, false);
  assert.equal(planned.create_official_cancellation, false);

  const writes = planReleaseCasesIntoBookingIntakeWrites([planned]);
  assert.equal(writes.filter((write) => write.kind === "insert_booking_reconciliation_case").length, 1);
  assert.equal(writes.filter((write) => write.kind === "append_booking_case_evidence").length, 0);
  assert.equal(writes.filter((write) => write.kind === "resolve_release_case").length, 1);
  const opened = writes.find((write) => write.kind === "insert_booking_reconciliation_case");
  assert.ok(opened && opened.kind === "insert_booking_reconciliation_case");
  assert.equal(opened.sequence, 1);
  assert.equal(opened.mode, "create_missing_booking");
  assert.deepEqual(opened.append_observation_ids, ["6a874c35eac3718160f4db0b"]);
});

test("open Release + existing open booking case plans append only (no second case) and resolve", () => {
  const planned = planReleaseCasesIntoBookingIntakeRow(
    openRelease({
      open_booking_case: {
        id: "6a875b809f4c8bcfbf5cd875",
        mode: "create_missing_booking",
        evidence_observation_ids: ["6a874c35eac3718160f4daaa"],
      },
      max_booking_sequence: 2,
    }),
  );
  assert.equal(planned.action, "append_release_evidence");
  assert.equal(planned.open_booking_case, false);
  assert.equal(planned.booking_case_id, "6a875b809f4c8bcfbf5cd875");
  assert.equal(planned.planned_sequence, undefined);
  assert.deepEqual(planned.append_observation_ids, ["6a874c35eac3718160f4db0b"]);
  assert.equal(planned.resolve_release_case.outcome, "no_action");

  const writes = planReleaseCasesIntoBookingIntakeWrites([planned]);
  assert.equal(writes.filter((write) => write.kind === "insert_booking_reconciliation_case").length, 0);
  assert.equal(writes.filter((write) => write.kind === "append_booking_case_evidence").length, 1);
  assert.equal(writes.filter((write) => write.kind === "resolve_release_case").length, 1);
});

test("evidence observation already on the booking case is not duplicated", () => {
  const planned = planReleaseCasesIntoBookingIntakeRow(
    openRelease({
      release_evidence: [
        releaseEvidence("6a874c35eac3718160f4db0b"),
        releaseEvidence("6a874c35eac3718160f4db11", "2026-08-21T10:00:00.000Z"),
      ],
      open_booking_case: {
        id: "6a875b809f4c8bcfbf5cd875",
        mode: "create_missing_booking",
        evidence_observation_ids: ["6a874c35eac3718160f4db0b"],
      },
    }),
  );
  assert.deepEqual(planned.append_observation_ids, ["6a874c35eac3718160f4db11"]);
  assert.equal(planned.action, "append_release_evidence");

  const allPresent = planReleaseCasesIntoBookingIntakeRow(
    openRelease({
      open_booking_case: {
        id: "6a875b809f4c8bcfbf5cd875",
        mode: "create_missing_booking",
        evidence_observation_ids: ["6a874c35eac3718160f4db0b"],
      },
    }),
  );
  assert.deepEqual(allPresent.append_observation_ids, []);
  assert.equal(allPresent.action, "resolve_release_case_only");
  assert.equal(allPresent.open_booking_case, false);
  const writes = planReleaseCasesIntoBookingIntakeWrites([allPresent]);
  assert.equal(writes.filter((write) => write.kind === "append_booking_case_evidence").length, 0);
  assert.equal(writes.filter((write) => write.kind === "insert_booking_reconciliation_case").length, 0);
  assert.equal(writes.filter((write) => write.kind === "resolve_release_case").length, 1);
});

test("live official Booking plans review_existing_booking and deterministic_booking_id", () => {
  const planned = planReleaseCasesIntoBookingIntakeRow(
    openRelease({
      live_official_booking: {
        id: "6a8747d9bd5412173dc4e6a1",
        officially_cancelled: false,
        domain_revision: 4,
      },
    }),
  );
  assert.equal(planned.action, "open_booking_case");
  assert.equal(planned.booking_case_mode, "review_existing_booking");
  assert.equal(planned.deterministic_booking_id, "6a8747d9bd5412173dc4e6a1");
  assert.equal(planned.official_booking_domain_revision, 4);
  assert.equal(planned.mutate_official_booking, false);

  const existing = planReleaseCasesIntoBookingIntakeRow(
    openRelease({
      open_booking_case: {
        id: "6a875b809f4c8bcfbf5cd875",
        mode: "create_missing_booking",
        evidence_observation_ids: [],
      },
      live_official_booking: {
        id: "6a8747d9bd5412173dc4e6a1",
        officially_cancelled: false,
        domain_revision: 4,
      },
    }),
  );
  assert.equal(existing.booking_case_mode, "review_existing_booking");
  assert.equal(existing.set_review_mode, true);
  const writes = planReleaseCasesIntoBookingIntakeWrites([existing]);
  assert.equal(writes.filter((write) => write.kind === "set_booking_case_review_mode").length, 1);
  const setMode = writes.find((write) => write.kind === "set_booking_case_review_mode");
  assert.ok(setMode && setMode.kind === "set_booking_case_review_mode");
  assert.equal(setMode.deterministic_booking_id, "6a8747d9bd5412173dc4e6a1");
});

test("does not plan official Cancellation or Booking field writes", () => {
  const rows = [
    planReleaseCasesIntoBookingIntakeRow(openRelease()),
    planReleaseCasesIntoBookingIntakeRow(
      openRelease({
        release_case_id: "6a875b809f4c8bcfbf5cd871",
        open_booking_case: {
          id: "6a875b809f4c8bcfbf5cd875",
          mode: "review_existing_booking",
          evidence_observation_ids: [],
          deterministic_booking_id: "6a8747d9bd5412173dc4e6a1",
        },
        live_official_booking: {
          id: "6a8747d9bd5412173dc4e6a1",
          officially_cancelled: false,
          domain_revision: 2,
        },
        official_cancellation: { id: "6a8747d9bd5412173dc4e6b2", domain_revision: 1 },
      }),
    ),
  ];
  const writes = planReleaseCasesIntoBookingIntakeWrites(rows);
  assert.equal(
    writes.some(
      (write) =>
        write.kind === "insert_official_booking" ||
        write.kind === "insert_official_cancellation" ||
        write.kind === "update_official_booking" ||
        write.kind === "update_official_cancellation",
    ),
    false,
  );
  for (const row of rows) {
    assert.equal(row.create_official_booking, false);
    assert.equal(row.create_official_cancellation, false);
    assert.equal(row.mutate_official_booking, false);
    assert.equal(row.mutate_official_cancellation, false);
  }
  assert.doesNotThrow(() => assertReleaseCasesIntoBookingIntakeApplyAllowed({ rows, writes }));
});

test("opening after a resolved booking case uses max sequence + 1", () => {
  const planned = planReleaseCasesIntoBookingIntakeRow(openRelease({ max_booking_sequence: 3 }));
  assert.equal(planned.planned_sequence, 4);
});

test("officially cancelled Booking is not live — plans create-missing, not review", () => {
  const planned = planReleaseCasesIntoBookingIntakeRow(
    openRelease({
      live_official_booking: {
        id: "6a8747d9bd5412173dc4e6a1",
        officially_cancelled: true,
        domain_revision: 5,
      },
    }),
  );
  assert.equal(planned.booking_case_mode, "create_missing_booking");
  assert.equal(planned.deterministic_booking_id, undefined);
  assert.equal(planned.set_review_mode, false);
});

test("release_without_vantage_booking discrepancies stay historical and do not become intakes", () => {
  const plan = planReleaseWithoutVantageBookingDiscrepancies();
  assert.equal(plan.action, RELEASE_DISCREPANCY_MIGRATE_CHOICE);
  assert.equal(plan.reason_code, "release_without_vantage_booking");
  assert.equal(plan.invent_booking_intake_from_discrepancy, false);
});

test("apply refuses official Booking or Cancellation writes", () => {
  const row = planReleaseCasesIntoBookingIntakeRow(openRelease());
  const official: ReleaseCasesIntoBookingIntakeWrite[] = [
    { kind: "insert_official_booking", normalized_job_no: "5562117" },
  ];
  assert.throws(
    () => assertReleaseCasesIntoBookingIntakeApplyAllowed({ rows: [row], writes: official }),
    /official Bookings and Cancellations/,
  );
  const cancellation: ReleaseCasesIntoBookingIntakeWrite[] = [
    { kind: "insert_official_cancellation", normalized_job_no: "5562117" },
  ];
  assert.throws(
    () => assertReleaseCasesIntoBookingIntakeApplyAllowed({ rows: [row], writes: cancellation }),
    /official Bookings and Cancellations/,
  );
});

test("report vs apply authorization helpers refuse missing confirm and historical DB", () => {
  assert.doesNotThrow(() => assertGranotLifecycleDatabaseAllowed(TEST_DATABASE));
  assert.doesNotThrow(() => assertGranotLifecycleDatabaseAllowed(PRODUCTION_DATABASE));
  assert.throws(() => assertGranotLifecycleDatabaseAllowed(HISTORICAL_DATABASE), /historical/);
  assert.throws(() => assertGranotLifecycleDatabaseAllowed("inventeddb"), /unknown/);
  assert.throws(
    () =>
      assertGranotLifecycleApplyAuthorized({
        args: ["--apply"],
        databaseName: TEST_DATABASE,
      }),
    /confirm-production/,
  );
  assert.throws(
    () =>
      assertGranotLifecycleApplyAuthorized({
        args: ["--apply", `--confirm-production=${TEST_DATABASE}`],
        databaseName: PRODUCTION_DATABASE,
      }),
    /does not match/,
  );
  assert.doesNotThrow(() =>
    assertGranotLifecycleApplyAuthorized({
      args: ["--apply", `--confirm-production=${TEST_DATABASE}`],
      databaseName: TEST_DATABASE,
    }),
  );
});

test("manifest keeps case ids, jobs, and observation ids and strips names, phones, and emails", () => {
  const planned = [planReleaseCasesIntoBookingIntakeRow(openRelease())];
  const manifest = buildReleaseCasesIntoBookingIntakeManifest({
    databaseName: "vantagemovers",
    mode: "report",
    rows: planned,
    writes: planReleaseCasesIntoBookingIntakeWrites(planned),
    openReleaseWithoutVantageBookingDiscrepancies: 11,
  });
  assert.equal(manifest.script_version, RELEASE_CASES_INTO_BOOKING_INTAKE_VERSION);
  assert.equal(manifest.summary.apply_eligible, 1);
  assert.equal(manifest.summary.official_bookings_planned, 0);
  assert.equal(manifest.summary.official_cancellations_planned, 0);
  assert.equal(manifest.summary.discrepancy_action, "leave_historical");
  assert.equal(manifest.discrepancy.action, "leave_historical");
  assert.equal(manifest.rows[0]?.normalized_job_no, "5562117");
  assert.equal(manifest.rows[0]?.release_case_id, "6a875b809f4c8bcfbf5cd870");
  assert.deepEqual(scanReleaseCasesIntoBookingIntakeManifestForPii(manifest), []);
});
