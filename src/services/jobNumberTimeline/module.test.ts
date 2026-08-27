import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleJobNumberTimeline } from "./assemble.js";
import {
  GRANOT_JOB,
  LEAD_NAME,
  LEAD_PHONE,
  OBS_CONTACT,
  SMS_BODY,
  T0,
  T1,
  WP_JOB,
  granotRows,
  wordpressRows,
} from "./fixtures.js";
import { createMemoryEvidenceLoader } from "./memory-evidence-loader.js";
import { createJobNumberTimelineModule } from "./module.js";
import { emptyJobTimelineRows, type JobTimelineRows } from "./rows.js";
import type { JobTimelineAssembleResult, JobTimelinePage } from "./types.js";

function moduleFor(rows: JobTimelineRows, companyGranularityIds?: Record<string, string[]>) {
  return createJobNumberTimelineModule({
    loader: createMemoryEvidenceLoader({ rows, companyGranularityIds }),
  });
}

async function ok(
  jobNo: string,
  rows: JobTimelineRows,
  filters?: { source_granularity_id?: string; source_company_id?: string },
): Promise<JobTimelinePage> {
  const result = await moduleFor(rows).read({ job_no: jobNo, ...filters });
  assert.equal(result.status, "ok", JSON.stringify(result));
  if (result.status !== "ok") throw new Error("expected ok");
  return result.page;
}

function kinds(page: JobTimelinePage): string[] {
  return page.events.map((event) => event.kind);
}

test("module WordPress walk-back matches assemble headlines", async () => {
  const page = await ok(WP_JOB, wordpressRows());
  const assembled = assembleJobNumberTimeline({ rawJobNo: WP_JOB, rows: wordpressRows() });
  assert.equal(assembled.status, "ok");
  if (assembled.status !== "ok") throw new Error("expected ok");
  assert.equal(page.proof_shape, "wordpress_born");
  assert.deepEqual(
    page.events.map((event) => event.headline),
    assembled.page.events.map((event) => event.headline),
  );
  assert.ok(page.events.findIndex((event) => event.kind === "lead_created")
    < page.events.findIndex((event) => event.kind === "lead_message"));
  assert.ok(page.events.findIndex((event) => event.kind === "lead_message")
    < page.events.findIndex((event) => event.kind === "job_number_acquired"));
});

test("module Granot-born", async () => {
  const page = await ok(GRANOT_JOB, granotRows());
  assert.equal(page.proof_shape, "granot_born");
  const acquired = page.events.find((event) => event.kind === "job_number_acquired");
  assert.equal(acquired?.data.acquired_at_create, true);
  assert.equal(acquired?.headline, "Job Number present at create");
});

test("module latest Decision attempt only", async () => {
  const page = await ok("7001", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-retry",
        captured_at: T0,
        normalized_job_no: "7001",
        route_event_class: "lead_created",
      },
    ],
    decisions: [
      {
        id: "dec-1",
        observation_id: "obs-retry",
        attempt: 1,
        decided_at: T0,
        outcome: "pending_match",
        reason_code: "pending_source_scoped_match",
      },
      {
        id: "dec-2",
        observation_id: "obs-retry",
        attempt: 2,
        decided_at: T1,
        outcome: "applied",
        reason_code: "lead_synchronized",
        target: { model: "FormLead", id: "lead-retry" },
      },
    ],
  });
  const decisions = page.events.filter((event) => event.kind === "synchronization_decision");
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.data.attempt, 2);
});

test("module intake is not official Booking", async () => {
  const page = await ok("4001", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-case",
        captured_at: T0,
        normalized_job_no: "4001",
        route_event_class: "booking_status_changed",
        booking_action_normalized: "booked",
      },
    ],
    decisions: [
      {
        id: "dec-case",
        observation_id: "obs-case",
        attempt: 1,
        decided_at: T0,
        outcome: "applied",
        reason_code: "booking_case_opened",
      },
    ],
    booking_cases: [
      {
        id: "case-open",
        kind: "booking",
        normalized_job_no: "4001",
        state: "open",
        mode: "confirm",
        evidence: [{ observation_id: "obs-case", captured_at: T0 }],
      },
    ],
  });
  assert.equal(kinds(page).includes("booking_intake"), true);
  assert.equal(kinds(page).includes("official_booking"), false);
  assert.equal(page.coverage.official_booking, false);
});

test("module equivalent Job Number", async () => {
  const rows = {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-core",
        captured_at: T0,
        normalized_job_no: "5562924",
        route_event_class: "lead_created",
      },
    ],
  };
  const prefixed = await ok("P5562924", rows);
  const core = await ok("5562924", rows);
  assert.deepEqual(
    prefixed.events.map((event) => event.id),
    core.events.map((event) => event.id),
  );
});

test("module Sheet Sync joins by entity ID", async () => {
  const page = await ok(WP_JOB, wordpressRows());
  const sheet = page.events.find((event) => event.kind === "sheet_sync");
  assert.equal(sheet?.data.entity_id, "lead-wp-1");
  assert.equal(sheet?.data.operation, "form_lead.create");
  assert.equal(sheet?.data.spreadsheet_id, undefined);
  assert.equal(sheet?.data.last_error, undefined);
});

test("module redacts contact, SMS body, and raw payloads", async () => {
  const page = await ok(WP_JOB, wordpressRows());
  const serialized = JSON.stringify(page);
  assert.equal(serialized.includes(LEAD_NAME), false);
  assert.equal(serialized.includes(LEAD_PHONE), false);
  assert.equal(serialized.includes(SMS_BODY), false);
  assert.equal(serialized.includes(OBS_CONTACT), false);
  assert.equal(serialized.includes("spreadsheet_id"), false);
  assert.equal(serialized.includes("last_error"), false);
});

test("module typed search not_found", async () => {
  const result: JobTimelineAssembleResult = await moduleFor({
    ...emptyJobTimelineRows(),
    leads: [
      {
        id: "lead-only",
        model: "FormLead",
        ingestion_origin: "wordpress_form",
        timestamp: T0,
        job_no: "1999",
        normalized_job_no: "1999",
      },
    ],
  }).read({ job_no: "1999" });
  assert.equal(result.status, "not_found");
});

test("module company/granularity mismatch is filtered_out", async () => {
  const result = await createJobNumberTimelineModule({
    loader: createMemoryEvidenceLoader({
      rows: wordpressRows(),
      companyGranularityIds: { "co-a": ["gran-a"] },
    }),
  }).read({
    job_no: WP_JOB,
    source_company_id: "co-a",
    source_granularity_id: "gran-b",
  });
  assert.equal(result.status, "filtered_out");
  if (result.status !== "filtered_out") throw new Error("expected filtered_out");
  assert.deepEqual(result.scopes, []);
});

test("module unused now stays on the interface", async () => {
  const page = await moduleFor(wordpressRows()).read({
    job_no: WP_JOB,
    now: new Date("2026-08-27T18:00:00.000Z"),
  });
  assert.equal(page.status, "ok");
});
