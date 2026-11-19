import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEAD_NAME,
  LEAD_PHONE,
  OBS_CONTACT,
  SMS_BODY,
  WP_JOB,
  wordpressRows,
} from "./fixtures.js";
import { createMemoryEvidenceLoader } from "./memory-evidence-loader.js";
import { createJobNumberTimelineModule } from "./module.js";
import { type JobTimelineRows } from "./rows.js";
import type { JobTimelinePage } from "./types.js";

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

test("owner milestones retain official history through corrections, repeated links and an archived Booking", async () => {
  const rows = wordpressRows();
  const booked = "2026-03-01T12:00:00.000Z";
  const cancelled = "2026-03-02T12:00:00.000Z";
  rows.bookings = [{ id: "live", normalized_job_no: WP_JOB, book_date: booked, last_changed_at: cancelled }];
  rows.cancellations = [
    { id: "one", booked_lead: "live", cancel_date: cancelled },
    { id: "two", booked_lead: "removed", normalized_job_no_snapshot: WP_JOB, booking_created_at_snapshot: booked, cancel_date: cancelled },
  ];
  const result = await createJobNumberTimelineModule({
    loader: createMemoryEvidenceLoader({ rows }), milestonesOnly: true,
  }).read({ job_no: WP_JOB });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw Error("missing job");
  const events = result.page.events;
  assert.equal(events.filter(row => row.kind === "official_booking" && row.event_at === booked).length, 2);
  assert.equal(events.filter(row => row.kind === "official_cancellation").length, 2);
  assert.ok(events.filter(row => row.kind === "job_number_acquired").length <= 1);
  assert.ok(events.every(row => ["lead_created", "job_number_acquired", "official_booking", "official_cancellation"].includes(row.kind)));
  assert.deepEqual(events.map(row => row.event_at), events.map(row => row.event_at).sort());
});
