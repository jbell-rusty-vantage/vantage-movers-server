import assert from "node:assert/strict";
import { test } from "node:test";
import { T0, T1 } from "./fixtures.js";
import {
  ALWAYS_LIMITATION_CODES,
  GOLDEN_JOBS,
  goldenBookedRows,
  goldenContradictoryChronologyRows,
  goldenOpenCancellationIntakeRows,
  goldenResolvedBookingWithoutFactRows,
} from "./golden-pages.js";
import { createMemoryEvidenceLoader } from "./memory-evidence-loader.js";
import { createJobNumberTimelineModule } from "./module.js";
import { emptyJobTimelineRows, type JobTimelineRows } from "./rows.js";
import type { EnhancedJobTimelinePage, TimelineAttentionCode, TimelineLimitationCode } from "./types.js";


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

test("resolved finalizing booking case without fact yields attention", async () => {
  const page = await ok(GOLDEN_JOBS.resolvedBookingWithoutFact, goldenResolvedBookingWithoutFactRows());
  assert.equal(page.current_outcome, "lead_active");
  assert.equal(page.coverage.official_booking, false);
  assert.ok(codes(page).includes("BOOKING_CASE_RESOLVED_WITHOUT_FACT"));
  assert.equal(stage(page, "booking").state, "attention");
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

test("open cancellation intake does not become official cancelled outcome", async () => {
  const page = await ok(GOLDEN_JOBS.cancellationIntakeOpen, goldenOpenCancellationIntakeRows());
  assert.equal(page.current_outcome, "cancellation_intake_open");
  assert.equal(page.coverage.official_cancellation, false);
  assert.equal(stage(page, "cancellation").state, "active");
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
