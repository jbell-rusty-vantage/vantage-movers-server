import assert from "node:assert/strict";
import { test } from "node:test";
import { SHEET_SYNC_PENDING_TOO_LONG_MS } from "./attention.js";
import { T0, T1, T2, T3, WP_JOB, wordpressRows } from "./fixtures.js";
import {
  ALWAYS_LIMITATION_CODES,
  GOLDEN_EXPECTATIONS,
  GOLDEN_JOBS,
  goldenBookedRows,
  goldenCancelledRows,
  goldenContradictoryChronologyRows,
  goldenGranotRows,
  goldenOpenCancellationIntakeRows,
  goldenPolicySkipRows,
  goldenResolvedBookingWithoutFactRows,
  goldenResolvedReleaseWithoutFactRows,
  goldenRingCentralRows,
  goldenWordpressRows,
} from "./golden-pages.js";
import { createMemoryEvidenceLoader } from "./memory-evidence-loader.js";
import { createJobNumberTimelineModule } from "./module.js";
import { emptyJobTimelineRows, type JobTimelineRows } from "./rows.js";
import type { EnhancedJobTimelinePage, TimelineAttentionCode, TimelineLimitationCode } from "./types.js";

const ATTENTION_CATALOG: TimelineAttentionCode[] = [
  "LEAD_UNRESOLVED",
  "BOOKING_CASE_RESOLVED_WITHOUT_FACT",
  "CANCELLATION_CASE_RESOLVED_WITHOUT_FACT",
  "ORPHAN_CANCELLATION_REFERENCE",
  "OFFICIAL_BOOKING_UNAVAILABLE",
  "SHEET_SYNC_PENDING_TOO_LONG",
  "SHEET_SYNC_TERMINAL_FAILURE",
  "CONTRADICTORY_OFFICIAL_STATE",
  "SOURCE_SCOPE_CONFLICT",
  "PROCESSING_EVIDENCE_GAP",
];

const LIMITATION_CATALOG: TimelineLimitationCode[] = [
  "WORDPRESS_RECEIPT_UNAVAILABLE",
  "RINGCENTRAL_CURSOR_BOUNDED",
  "GOOGLE_DESTINATION_UNVERIFIED",
  "MOVE_COMPLETION_UNAVAILABLE",
  "MULTI_QUERY_READ",
  "TIMELINE_TRUNCATED",
];

function moduleFor(rows: JobTimelineRows) {
  return createJobNumberTimelineModule({
    loader: createMemoryEvidenceLoader({ rows }),
  });
}

async function ok(jobNo: string, rows: JobTimelineRows, now?: Date): Promise<EnhancedJobTimelinePage> {
  const result = await moduleFor(rows).read({ job_no: jobNo, now });
  assert.equal(result.status, "ok", JSON.stringify(result));
  if (result.status !== "ok") throw new Error("expected ok");
  return result.page;
}

function codes(page: EnhancedJobTimelinePage): TimelineAttentionCode[] {
  return page.attention.map((row) => row.code);
}

function limitationCodes(page: EnhancedJobTimelinePage): TimelineLimitationCode[] {
  return page.limitations.map((row) => row.code);
}

function stage(page: EnhancedJobTimelinePage, name: EnhancedJobTimelinePage["stage_assessments"][number]["stage"]) {
  const assessment = page.stage_assessments.find((row) => row.stage === name);
  assert.ok(assessment, `missing stage ${name}`);
  return assessment;
}

function assertCatalogOnly(page: EnhancedJobTimelinePage) {
  for (const code of codes(page)) {
    assert.ok(ATTENTION_CATALOG.includes(code), `invented attention code ${code}`);
  }
  for (const code of limitationCodes(page)) {
    assert.ok(LIMITATION_CATALOG.includes(code), `invented limitation code ${code}`);
  }
}

function assertAlwaysLimitations(page: EnhancedJobTimelinePage) {
  for (const code of ALWAYS_LIMITATION_CODES) {
    assert.ok(limitationCodes(page).includes(code), `missing ${code}`);
  }
  assert.equal(page.events.some((event) => String(event.kind) === "move_completion"), false);
  assert.equal(page.stage_assessments.some((row) => String(row.stage) === "move_completion"), false);
  assert.equal(page.events.some((event) => String(event.kind) === "multi_query_read"), false);
  assert.equal(page.freshness.google_destination_readback, "not_performed");
  assert.equal(page.freshness.consistency, "multi_query_best_effort");
  assert.equal(page.schema_version, "job_timeline.v2");
  assert.equal(page.summary.attention_count, page.attention.length);
  assert.equal(page.stage_assessments.length, 7);
}

test("text policy skip is not applicable rather than attention", async () => {
  const page = await ok(GOLDEN_JOBS.policySkip, goldenPolicySkipRows());
  const engagement = stage(page, "engagement");
  assert.equal(engagement.state, "not_applicable");
  assert.equal(engagement.label, "Text skipped");
  assert.equal(engagement.reason_code, "TEXT_POLICY_SKIP");
  assert.equal(codes(page).some((code) => code.includes("TEXT") || code.includes("MESSAGE")), false);
  assert.equal(page.attention.length, 0);
  assertCatalogOnly(page);
  assertAlwaysLimitations(page);
});

test("open booking intake yields active stage and no official booking", async () => {
  const page = await ok(WP_JOB, wordpressRows());
  assert.equal(page.current_outcome, "booking_intake_open");
  assert.equal(page.coverage.official_booking, false);
  assert.equal(page.events.some((event) => event.kind === "official_booking"), false);
  const booking = stage(page, "booking");
  assert.equal(booking.state, "active");
  assert.equal(booking.label, "Booking intake open");
  assert.equal(page.summary.headline, "Booking intake open");
  assertAlwaysLimitations(page);
});

test("resolved finalizing booking case without fact yields attention", async () => {
  const page = await ok(GOLDEN_JOBS.resolvedBookingWithoutFact, goldenResolvedBookingWithoutFactRows());
  assert.equal(page.current_outcome, "lead_active");
  assert.equal(page.coverage.official_booking, false);
  assert.ok(codes(page).includes("BOOKING_CASE_RESOLVED_WITHOUT_FACT"));
  assert.equal(stage(page, "booking").state, "attention");
  assertAlwaysLimitations(page);
});

test("ordinary booked job has no cancellation attention", async () => {
  const page = await ok(GOLDEN_JOBS.booked, goldenBookedRows());
  assert.equal(page.current_outcome, "booked");
  assert.equal(page.coverage.official_booking, true);
  assert.equal(page.coverage.official_cancellation, false);
  assert.equal(stage(page, "cancellation").state, "not_started");
  assert.equal(stage(page, "cancellation").label, "No cancellation activity");
  assert.equal(codes(page).includes("CANCELLATION_CASE_RESOLVED_WITHOUT_FACT"), false);
  assert.equal(codes(page).includes("ORPHAN_CANCELLATION_REFERENCE"), false);
  assert.deepEqual(codes(page), []);
  assertAlwaysLimitations(page);
});

test("resolved release case without cancellation yields attention", async () => {
  const page = await ok(GOLDEN_JOBS.resolvedReleaseWithoutFact, goldenResolvedReleaseWithoutFactRows());
  assert.equal(page.current_outcome, "booked");
  assert.equal(page.coverage.official_cancellation, false);
  assert.ok(codes(page).includes("CANCELLATION_CASE_RESOLVED_WITHOUT_FACT"));
  assert.equal(stage(page, "cancellation").state, "attention");
  assertAlwaysLimitations(page);
});

test("official cancellation determines cancelled outcome", async () => {
  const page = await ok(GOLDEN_JOBS.cancelled, goldenCancelledRows());
  assert.equal(page.current_outcome, "cancelled");
  assert.equal(page.coverage.official_booking, true);
  assert.equal(page.coverage.official_cancellation, true);
  assert.equal(stage(page, "cancellation").state, "complete");
  assert.equal(stage(page, "cancellation").label, "Cancelled");
  assert.equal(page.summary.headline, "Cancelled");
  assert.deepEqual(codes(page), []);
  assertAlwaysLimitations(page);
});

test("contradictory official chronology yields contradictory outcome", async () => {
  const page = await ok(GOLDEN_JOBS.contradictory, goldenContradictoryChronologyRows());
  assert.equal(page.current_outcome, "contradictory");
  assert.ok(codes(page).includes("CONTRADICTORY_OFFICIAL_STATE"));
  assert.equal(page.summary.headline, "Contradictory official state");
  const booking = page.events.find((event) => event.kind === "official_booking");
  const cancellation = page.events.find((event) => event.kind === "official_cancellation");
  assert.ok(booking && cancellation);
  assert.ok((cancellation?.event_at ?? "") < (booking?.event_at ?? ""));
  assertAlwaysLimitations(page);
});

test("synced sheet job still reports google destination unverified", async () => {
  const page = await ok(GOLDEN_JOBS.booked, goldenBookedRows());
  assert.equal(page.coverage.sheet_sync, "synced");
  assert.ok(page.events.some((event) => event.kind === "sheet_sync" && event.data.status === "synced"));
  assert.ok(limitationCodes(page).includes("GOOGLE_DESTINATION_UNVERIFIED"));
  assert.equal(stage(page, "delivery").state, "unverifiable");
  assert.equal(stage(page, "delivery").label, "Google not verified");
  assert.equal(page.freshness.google_destination_readback, "not_performed");
  assertAlwaysLimitations(page);
});

test("wordpress-born golden includes wordpress receipt limitation", async () => {
  const page = await ok(GOLDEN_JOBS.wordpress, goldenWordpressRows());
  assert.equal(page.proof_shape, "wordpress_born");
  assert.equal(page.events.some((event) => event.kind === "source_received"), false);
  assert.ok(limitationCodes(page).includes("WORDPRESS_RECEIPT_UNAVAILABLE"));
  assert.equal(page.current_outcome, GOLDEN_EXPECTATIONS.wordpress.outcome);
  assertAlwaysLimitations(page);
});

test("later Granot receipt does not clear wordpress receipt limitation", async () => {
  const rows = wordpressRows();
  const page = await ok(WP_JOB, {
    ...rows,
    observation_receipts: [
      {
        id: "rcpt-wp-1",
        captured_at: T2,
        createdAt: T2,
        route_event_class: "priority_updated",
        processing_state: "completed",
      },
    ],
  });
  assert.equal(page.proof_shape, "wordpress_born");
  assert.equal(
    page.events.some((event) => event.kind === "source_received" && event.data.ingress === "granot"),
    true,
  );
  assert.equal(
    page.events.some((event) => event.kind === "source_received" && event.data.ingress === "wordpress"),
    false,
  );
  assert.ok(limitationCodes(page).includes("WORDPRESS_RECEIPT_UNAVAILABLE"));
});

test("ringcentral-born golden bounds confidence with the cursor", async () => {
  const now = new Date("2026-03-01T14:00:00.000Z");
  const page = await ok(GOLDEN_JOBS.ringcentral, goldenRingCentralRows(), now);
  assert.equal(page.proof_shape, "ringcentral_born");
  assert.equal(page.freshness.ringcentral_covered_through, T3);
  assert.equal(page.freshness.ringcentral_cursor_lag_seconds, 3600);
  assert.ok(limitationCodes(page).includes("RINGCENTRAL_CURSOR_BOUNDED"));
  assert.equal(page.current_outcome, GOLDEN_EXPECTATIONS.ringcentral.outcome);
  assertAlwaysLimitations(page);
});

test("move completion and multi query appear only as limitations", async () => {
  const page = await ok(GOLDEN_JOBS.granot, goldenGranotRows());
  assert.ok(limitationCodes(page).includes("MOVE_COMPLETION_UNAVAILABLE"));
  assert.ok(limitationCodes(page).includes("MULTI_QUERY_READ"));
  assertAlwaysLimitations(page);
  assert.equal(page.current_outcome, "lead_active");
  assert.deepEqual(codes(page), GOLDEN_EXPECTATIONS.granot.attention);
});

test("open cancellation intake does not become official cancelled outcome", async () => {
  const page = await ok(GOLDEN_JOBS.cancellationIntakeOpen, goldenOpenCancellationIntakeRows());
  assert.equal(page.current_outcome, "cancellation_intake_open");
  assert.equal(page.coverage.official_cancellation, false);
  assert.equal(stage(page, "cancellation").state, "active");
  assertAlwaysLimitations(page);
});

test("unresolved lead without official fact is unknown and lead unresolved", async () => {
  const page = await ok("8802", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-unresolved",
        captured_at: T0,
        normalized_job_no: "8802",
        route_event_class: "priority_updated",
      },
    ],
  });
  assert.equal(page.current_outcome, "unknown");
  assert.equal(page.coverage.lead, "unresolved");
  assert.ok(codes(page).includes("LEAD_UNRESOLVED"));
  assertAlwaysLimitations(page);
});

test("snapshot-only cancellation is a found cancelled page", async () => {
  const page = await ok("7703", {
    ...emptyJobTimelineRows(),
    cancellations: [
      {
        id: "cancel-snap-only",
        booked_lead: "deleted-booking",
        createdAt: T1,
        job_no_snapshot: "7703",
        normalized_job_no_snapshot: "7703",
        lead_ref_snapshot: { model: "FormLead", id: "lead-gone" },
        booking_created_at_snapshot: T0,
      },
    ],
  });
  assert.equal(page.current_outcome, "cancelled");
  assert.equal(page.summary.headline, "Cancelled");
  assert.equal(page.coverage.official_cancellation, true);
  assert.equal(page.coverage.official_booking, false);
  assert.equal(page.events.some((event) => event.kind === "official_booking"), false);
  assert.ok(page.events.some((event) => event.kind === "official_cancellation"));
  assert.ok(codes(page).includes("OFFICIAL_BOOKING_UNAVAILABLE"));
  assert.equal(codes(page).includes("CONTRADICTORY_OFFICIAL_STATE"), false);
  assert.equal(stage(page, "booking").state, "attention");
  assert.equal(stage(page, "booking").label, "Official Booking no longer present");
  assert.equal(stage(page, "booking").reason_code, "BOOKING_UNAVAILABLE_AFTER_CANCELLATION");
  assert.equal(stage(page, "cancellation").state, "complete");
  assertAlwaysLimitations(page);
  assertCatalogOnly(page);
});

test("orphan cancellation without snapshot yields orphan attention", async () => {
  const page = await ok("7701", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-orphan-cancel",
        captured_at: T0,
        normalized_job_no: "7701",
        route_event_class: "booking_status_changed",
        booking_action_normalized: "release",
      },
    ],
    release_cases: [
      {
        id: "case-orphan",
        kind: "release",
        normalized_job_no: "7701",
        state: "open",
        evidence: [{ observation_id: "obs-orphan-cancel", captured_at: T0 }],
      },
    ],
    cancellations: [
      {
        id: "cancel-orphan",
        booked_lead: "missing-booking",
        createdAt: T1,
      },
    ],
  });
  assert.equal(page.coverage.official_cancellation, false);
  assert.ok(codes(page).includes("ORPHAN_CANCELLATION_REFERENCE"));
  assertAlwaysLimitations(page);
});

test("sheet sync pending too long uses the module default threshold", async () => {
  const requested = "2026-03-01T10:00:00.000Z";
  const now = new Date(Date.parse(requested) + SHEET_SYNC_PENDING_TOO_LONG_MS + 1);
  const page = await ok("8803", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-pending-sheet",
        captured_at: T0,
        normalized_job_no: "8803",
        route_event_class: "priority_updated",
      },
    ],
    leads: [
      {
        id: "lead-pending-sheet",
        model: "FormLead",
        ingestion_origin: "granot_lead_created",
        timestamp: T0,
        createdAt: T0,
        job_no: "8803",
        normalized_job_no: "8803",
      },
    ],
    entity_changes: [
      {
        id: "chg-pending-sheet",
        entity_model: "FormLead",
        entity_id: "lead-pending-sheet",
        command_name: "createLeadFromGranot",
        applied_at: T0,
        changed_paths: ["job_no"],
      },
    ],
    decisions: [
      {
        id: "dec-pending-sheet",
        observation_id: "obs-pending-sheet",
        attempt: 1,
        decided_at: T0,
        outcome: "created",
        reason_code: "lead_created",
        target: { model: "FormLead", id: "lead-pending-sheet" },
      },
    ],
    sheet_sync_jobs: [
      {
        id: "sheet-pending",
        entity_id: "lead-pending-sheet",
        entity_model: "FormLead",
        resource: "source_lead",
        operation: "form_lead.create",
        status: "pending",
        createdAt: requested,
      },
    ],
  }, now);
  assert.ok(codes(page).includes("SHEET_SYNC_PENDING_TOO_LONG"));
  const justInside = new Date(Date.parse(requested) + SHEET_SYNC_PENDING_TOO_LONG_MS);
  const inside = await ok("8803", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-pending-sheet",
        captured_at: T0,
        normalized_job_no: "8803",
        route_event_class: "priority_updated",
      },
    ],
    leads: [
      {
        id: "lead-pending-sheet",
        model: "FormLead",
        ingestion_origin: "granot_lead_created",
        timestamp: T0,
        createdAt: T0,
        job_no: "8803",
        normalized_job_no: "8803",
      },
    ],
    entity_changes: [
      {
        id: "chg-pending-sheet",
        entity_model: "FormLead",
        entity_id: "lead-pending-sheet",
        command_name: "createLeadFromGranot",
        applied_at: T0,
        changed_paths: ["job_no"],
      },
    ],
    decisions: [
      {
        id: "dec-pending-sheet",
        observation_id: "obs-pending-sheet",
        attempt: 1,
        decided_at: T0,
        outcome: "created",
        reason_code: "lead_created",
        target: { model: "FormLead", id: "lead-pending-sheet" },
      },
    ],
    sheet_sync_jobs: [
      {
        id: "sheet-pending",
        entity_id: "lead-pending-sheet",
        entity_model: "FormLead",
        resource: "source_lead",
        operation: "form_lead.create",
        status: "pending",
        createdAt: requested,
      },
    ],
  }, justInside);
  assert.equal(codes(inside).includes("SHEET_SYNC_PENDING_TOO_LONG"), false);
  assertAlwaysLimitations(page);
});

test("terminal sheet failure yields sheet sync terminal failure", async () => {
  const page = await ok(WP_JOB, {
    ...wordpressRows(),
    sheet_sync_jobs: [
      {
        id: "sheet-failed",
        entity_id: "lead-wp-1",
        entity_model: "FormLead",
        resource: "source_lead",
        operation: "form_lead.create",
        status: "failed",
        createdAt: T0,
        updatedAt: T1,
      },
    ],
  });
  assert.ok(codes(page).includes("SHEET_SYNC_TERMINAL_FAILURE"));
  assertAlwaysLimitations(page);
});

test("disagreeing source scopes yield source scope conflict", async () => {
  const rows = wordpressRows();
  const page = await ok(WP_JOB, {
    ...rows,
    decisions: (rows.decisions ?? []).map((row) => ({
      ...row,
      source_granularity_id: "gran-b",
    })),
  });
  assert.ok(codes(page).includes("SOURCE_SCOPE_CONFLICT"));
  assertAlwaysLimitations(page);
});

test("applied decision without entity change yields processing evidence gap", async () => {
  const page = await ok("8002002", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-gap",
        captured_at: T0,
        normalized_job_no: "8002002",
        route_event_class: "priority_updated",
      },
    ],
    decisions: [
      {
        id: "dec-gap",
        observation_id: "obs-gap",
        attempt: 1,
        decided_at: T1,
        outcome: "applied",
        reason_code: "priority_updated",
        target: { model: "FormLead", id: "lead-gap" },
      },
    ],
    leads: [
      {
        id: "lead-gap",
        model: "FormLead",
        ingestion_origin: "granot_lead_created",
        timestamp: T0,
        createdAt: T0,
        job_no: "8002002",
        normalized_job_no: "8002002",
      },
    ],
    entity_changes: [
      {
        id: "chg-gap-create",
        entity_model: "FormLead",
        entity_id: "lead-gap",
        command_name: "createLeadFromGranot",
        applied_at: T0,
        changed_paths: ["job_no"],
      },
    ],
  });
  assert.ok(codes(page).includes("PROCESSING_EVIDENCE_GAP"));
  assert.equal(stage(page, "processing").state, "attention");
  assertAlwaysLimitations(page);
});
