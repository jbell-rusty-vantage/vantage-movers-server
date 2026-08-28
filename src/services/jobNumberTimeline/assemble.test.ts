import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleJobNumberTimeline } from "./assemble.js";
import {
  GRANOT_JOB,
  LEAD_NAME,
  SMS_BODY,
  T0,
  T1,
  T2,
  WP_JOB,
  granotRows,
  wordpressRows,
} from "./fixtures.js";
import { emptyJobTimelineRows } from "./rows.js";
import type { JobTimelineRows } from "./rows.js";
import type { JobTimelineEventKind, JobTimelinePage } from "./types.js";

function ok(rawJobNo: string, rows: JobTimelineRows, filters?: JobTimelineRows extends never ? never : {
  source_granularity_id?: string;
  company_granularity_ids?: string[];
}): JobTimelinePage {
  const result = assembleJobNumberTimeline({ rawJobNo, rows, filters });
  assert.equal(result.status, "ok", JSON.stringify(result));
  if (result.status !== "ok") throw new Error("expected ok");
  return result.page;
}

function kinds(page: JobTimelinePage): JobTimelineEventKind[] {
  return page.events.map((event) => event.kind);
}

function indexOf(page: JobTimelinePage, kind: JobTimelineEventKind): number {
  const index = page.events.findIndex((event) => event.kind === kind);
  assert.ok(index >= 0, `missing ${kind}`);
  return index;
}

test("WordPress walk-back", () => {
  const page = ok(WP_JOB, wordpressRows());
  const created = indexOf(page, "lead_created");
  const message = indexOf(page, "lead_message");
  const acquired = indexOf(page, "job_number_acquired");
  const intake = indexOf(page, "booking_intake");
  assert.ok(created < message && message < acquired && acquired < intake);
  assert.equal(page.proof_shape, "wordpress_born");
  assert.equal(page.coverage.job_number_at_create, false);
  assert.equal(page.events[created]?.headline, "Lead created (wordpress_form)");
  assert.equal(page.events[message]?.headline, "Text delivered (quote_request_confirmation)");
  assert.equal(page.events[acquired]?.headline, "Job Number acquired");
  assert.equal(page.events[intake]?.headline, "Booking intake opened (confirm)");
  assert.ok(page.events.some((event) => event.kind === "sheet_sync"));
  const createdEvent = page.events.find((event) => event.kind === "lead_created");
  assert.equal(createdEvent?.data.ingestion_origin, "wordpress_form");
  assert.deepEqual(createdEvent?.data.form_snapshot, {
    submitted_as: "A•••",
    phone_masked: "•••1234",
    email_masked: "a•••@example.invalid",
    move_date: "2026-04-01T00:00:00.000Z",
    move_size: "2 Bedrooms",
    pickup: "NY 10001",
    delivery: "FL 33101",
  });
});

test("Lead updated headline omits changed paths", () => {
  const page = ok(WP_JOB, {
    ...wordpressRows(),
    entity_changes: [
      ...(wordpressRows().entity_changes ?? []),
      {
        id: "chg-wp-priority",
        entity_model: "FormLead",
        entity_id: "lead-wp-1",
        command_name: "synchronizeLeadFromGranot",
        applied_at: T2,
        changed_paths: ["granot_priority", "cubic_feet", "pickup_city"],
      },
    ],
  });
  const updated = page.events.filter((event) => event.kind === "lead_updated");
  assert.ok(updated.length >= 1);
  assert.ok(updated.every((event) => event.headline === "Lead updated (synchronizeLeadFromGranot)"));
  assert.equal(updated.some((event) => event.headline.includes("cubic_feet")), false);
});

test("Granot-born", () => {
  const page = ok(GRANOT_JOB, granotRows());
  assert.equal(page.proof_shape, "granot_born");
  const acquired = page.events.find((event) => event.kind === "job_number_acquired");
  assert.equal(acquired?.data.acquired_at_create, true);
  assert.equal(acquired?.headline, "Job Number present at create");
  assert.ok(page.events.some((event) => event.kind === "lead_message" && event.data.observation_id === "obs-gr-create"));
  assert.ok(page.events.some((event) => event.kind === "synchronization_decision" && event.data.reason_code === "priority_updated"));
});

test("Latest attempt only", () => {
  const page = ok("7001", {
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
  assert.equal(decisions[0]?.data.outcome, "applied");
  assert.equal(decisions[0]?.data.attempt, 2);
});

test("Granularity filter", () => {
  const result = assembleJobNumberTimeline({
    rawJobNo: WP_JOB,
    filters: { source_granularity_id: "gran-b" },
    rows: wordpressRows(),
  });
  assert.equal(result.status, "filtered_out");
  if (result.status !== "filtered_out") throw new Error("expected filtered_out");
  assert.equal(result.normalized_job_no, WP_JOB);
  assert.equal(result.scopes.length > 0, true);
});

test("No contact match", () => {
  const page = ok("6001", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-orphan",
        captured_at: T0,
        normalized_job_no: "6001",
        route_event_class: "priority_updated",
      },
    ],
    decisions: [
      {
        id: "dec-orphan",
        observation_id: "obs-orphan",
        attempt: 1,
        decided_at: T0,
        outcome: "pending_match",
        reason_code: "pending_source_scoped_match",
      },
    ],
    lead_messages: [
      {
        id: "msg-other",
        lead_id: "someone-else",
        status: "delivered",
        purpose: "quote_request_confirmation",
        delivered_at: T1,
        body: SMS_BODY,
      },
    ],
    leads: [
      {
        id: "someone-else",
        model: "FormLead",
        ingestion_origin: "wordpress_form",
        timestamp: T0,
        name: LEAD_NAME,
      },
    ],
  });
  assert.equal(page.coverage.lead, "unresolved");
  assert.equal(kinds(page).includes("lead_created"), false);
  assert.equal(kinds(page).includes("lead_message"), false);
});

test("Priority 5 is not Booked", () => {
  const page = ok("5001", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-p5",
        captured_at: T0,
        normalized_job_no: "5001",
        route_event_class: "priority_updated",
        priority_canonical: "5",
        priority_valid: true,
      },
    ],
    decisions: [
      {
        id: "dec-p5",
        observation_id: "obs-p5",
        attempt: 1,
        decided_at: T0,
        outcome: "applied",
        reason_code: "priority_updated",
      },
    ],
  });
  assert.equal(kinds(page).includes("official_booking"), false);
  assert.equal(kinds(page).includes("booking_intake"), false);
  assert.equal(page.coverage.official_booking, false);
});

test("Case is not a Booking", () => {
  const page = ok("4001", {
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
  assert.equal(page.coverage.booking_intake, "open");
});

test("Equivalent Job Number", () => {
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
  const prefixed = ok("P5562924", rows);
  const core = ok("5562924", rows);
  assert.deepEqual(prefixed.events.map((event) => event.id), core.events.map((event) => event.id));
  const reversed = {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-prefix",
        captured_at: T0,
        normalized_job_no: "P5562924",
        route_event_class: "lead_created",
      },
    ],
  };
  assert.equal(ok("5562924", reversed).events.some((event) => event.id.includes("obs-prefix")), true);
});

test("Sheet Sync walk-back", () => {
  const page = ok(WP_JOB, wordpressRows());
  const created = indexOf(page, "lead_created");
  const sheet = indexOf(page, "sheet_sync");
  const acquired = indexOf(page, "job_number_acquired");
  assert.ok(created < sheet && sheet < acquired);
  const job = page.events[sheet];
  assert.equal(job?.data.operation, "form_lead.create");
  assert.equal(job?.data.entity_id, "lead-wp-1");
  assert.equal(job?.data.spreadsheet_id, undefined);
  assert.equal(job?.data.last_error, undefined);
});

test("Sheet Sync after official Booking", () => {
  const clock = "2026-03-02T10:00:00.000Z";
  const page = ok("3001", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-book",
        captured_at: clock,
        normalized_job_no: "3001",
        route_event_class: "booking_status_changed",
        booking_action_normalized: "booked",
      },
    ],
    decisions: [
      {
        id: "dec-book",
        observation_id: "obs-book",
        attempt: 1,
        decided_at: clock,
        outcome: "applied",
        reason_code: "booking_confirmed",
        effect_kinds: ["sheet_sync_requested"],
      },
    ],
    bookings: [
      {
        id: "booking-1",
        normalized_job_no: "3001",
        job_no_snapshot: "3001",
        timestamp: clock,
        createdAt: clock,
      },
    ],
    sheet_sync_jobs: [
      {
        id: "sheet-booking",
        entity_id: "booking-1",
        entity_model: "BookedLead",
        resource: "booking_chain",
        operation: "booked_lead.create",
        status: "synced",
        createdAt: clock,
        updatedAt: clock,
        target_hints: ["Booked"],
      },
    ],
  });
  const official = indexOf(page, "official_booking");
  const sheet = indexOf(page, "sheet_sync");
  assert.ok(official < sheet);
  assert.equal(page.events[official]?.event_at, page.events[sheet]?.event_at);
  assert.equal(page.events[sheet]?.type_priority, 110);
  assert.equal(page.events.filter((event) => event.kind === "sheet_sync").length, 1);
});

test("Unresolved Lead has no source-lead Sheet Sync", () => {
  const page = ok("2001", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-only",
        captured_at: T0,
        normalized_job_no: "2001",
        route_event_class: "lead_created",
      },
    ],
    sheet_sync_jobs: [
      {
        id: "sheet-other",
        entity_id: "lead-other",
        resource: "source_lead",
        operation: "form_lead.create",
        status: "synced",
        createdAt: T0,
      },
    ],
    leads: [
      {
        id: "lead-other",
        model: "FormLead",
        ingestion_origin: "wordpress_form",
        timestamp: T0,
        normalized_job_no: "2001",
      },
    ],
  });
  assert.equal(page.coverage.lead, "unresolved");
  assert.equal(kinds(page).includes("sheet_sync"), false);
});

test("orphan cancellation without snapshot is not a first-hop survivor", () => {
  const result = assembleJobNumberTimeline({
    rawJobNo: "7704",
    rows: {
      ...emptyJobTimelineRows(),
      cancellations: [
        {
          id: "cancel-orphan-only",
          booked_lead: "missing-booking",
          createdAt: T1,
        },
      ],
    },
  });
  assert.equal(result.status, "not_found");
});

test("Typed search not_found", () => {
  const result = assembleJobNumberTimeline({
    rawJobNo: "1999",
    rows: {
      ...emptyJobTimelineRows(),
      leads: [
        {
          id: "lead-only",
          model: "FormLead",
          ingestion_origin: "wordpress_form",
          timestamp: T0,
          job_no: "1999",
          normalized_job_no: "1999",
          name: LEAD_NAME,
        },
      ],
      lead_messages: [
        {
          id: "msg-only",
          lead_id: "lead-only",
          status: "delivered",
          purpose: "quote_request_confirmation",
          delivered_at: T1,
          body: SMS_BODY,
        },
      ],
    },
  });
  assert.equal(result.status, "not_found");
  if (result.status !== "not_found") throw new Error("expected not_found");
  assert.equal(result.normalized_job_no, "1999");
});

test("Typed equivalent search", () => {
  const rows = {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-eq",
        captured_at: T0,
        normalized_job_no: "5562924",
        route_event_class: "lead_created",
      },
    ],
  };
  const left = ok("P5562924", rows);
  const right = ok("5562924", rows);
  assert.deepEqual(
    left.events.map((event) => event.id),
    right.events.map((event) => event.id),
  );
});

test("blank Job Number is invalid_job_number", () => {
  const result = assembleJobNumberTimeline({
    rawJobNo: "   ",
    rows: emptyJobTimelineRows(),
  });
  assert.equal(result.status, "invalid_job_number");
});

test("assemble is a pure function over injected rows", () => {
  const rows = wordpressRows();
  const first = assembleJobNumberTimeline({ rawJobNo: WP_JOB, rows });
  const second = assembleJobNumberTimeline({ rawJobNo: WP_JOB, rows });
  assert.deepEqual(first, second);
});
