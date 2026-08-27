import assert from "node:assert/strict";
import { test } from "node:test";
import { LEAD_NAME, LEAD_PHONE, OBS_CONTACT, SMS_BODY, T0, T1, T2, T3, WP_JOB, wordpressRows } from "./fixtures.js";
import {
  ALWAYS_LIMITATION_CODES,
  GOLDEN_EXPECTATIONS,
  GOLDEN_JOBS,
  T_RECORDED,
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
import { assertPageSafe, pageContainsForbiddenContact } from "./masking.js";
import { createMemoryEvidenceLoader } from "./memory-evidence-loader.js";
import { createJobNumberTimelineModule } from "./module.js";
import { emptyJobTimelineRows, type JobTimelineRows } from "./rows.js";
import type { EnhancedJobTimelinePage } from "./types.js";
import { JOB_TIMELINE_EVENT_CAP } from "./types.js";

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

test("schema_version is job_timeline.v2 on ok pages", async () => {
  const page = await ok(GOLDEN_JOBS.wordpress, goldenWordpressRows());
  assert.equal(page.schema_version, "job_timeline.v2");
  assert.equal(page.events[0]?.event_at, page.events[0]?.time.occurred_at);
  assert.ok(page.events.every((event) => event.headline && event.coverage && event.clock_field));
});

test("source receipt and lead creation remain separate events", async () => {
  const page = await ok(GOLDEN_JOBS.granot, goldenGranotRows());
  const receipts = page.events.filter((event) => event.kind === "source_received");
  const created = page.events.filter((event) => event.kind === "lead_created");
  assert.equal(receipts.length, 1);
  assert.equal(created.length, 1);
  assert.equal(receipts[0]?.data.ingress, "granot");
  assert.equal(created[0]?.kind, "lead_created");
  assert.equal(created[0]?.data.command_name, "createLeadFromGranot");
  assert.ok(page.events.findIndex((event) => event.kind === "source_received")
    < page.events.findIndex((event) => event.kind === "lead_created"));
  assert.equal(receipts[0]?.type_priority, 5);
  assert.equal(created[0]?.type_priority, 10);
});

test("wordpress creation reports no invented receipt event", async () => {
  const page = await ok(WP_JOB, wordpressRows());
  assert.equal(page.proof_shape, "wordpress_born");
  assert.equal(page.events.some((event) => event.kind === "source_received"), false);
  assert.equal(page.events.some((event) => event.kind === "lead_created"), true);
  assert.equal(page.events.find((event) => event.kind === "lead_created")?.data.ingestion_origin, "wordpress_form");
  assert.ok(page.limitations.some((row) => row.code === "WORDPRESS_RECEIPT_UNAVAILABLE"));
});

test("dual clocks order by occurred time and preserve recorded time", async () => {
  const page = await ok(GOLDEN_JOBS.granot, goldenGranotRows());
  const receipt = page.events.find((event) => event.kind === "source_received");
  assert.ok(receipt);
  assert.equal(receipt?.time.occurred_at, T0);
  assert.equal(receipt?.time.recorded_at, T_RECORDED);
  assert.equal(receipt?.event_at, receipt?.time.occurred_at);
  const later = page.events.find((event) => event.event_at === T2);
  assert.ok(later);
  assert.ok(page.events.findIndex((event) => event.id === receipt?.id)
    < page.events.findIndex((event) => event.id === later?.id));
});

test("related receipt decision change and sheet rows share activity id", async () => {
  const page = await ok(GOLDEN_JOBS.granot, goldenGranotRows());
  const receipt = page.events.find((event) => event.kind === "source_received");
  const observation = page.events.find((event) =>
    event.kind === "granot_observation" && event.data.observation_id === "obs-gr-create",
  );
  const decision = page.events.find((event) =>
    event.kind === "synchronization_decision" && event.data.observation_id === "obs-gr-create",
  );
  const acquired = page.events.find((event) => event.kind === "job_number_acquired");
  const sheet = page.events.find((event) => event.kind === "sheet_sync");
  assert.ok(receipt && observation && decision && acquired && sheet);
  const activityId = receipt?.causality.activity_id;
  assert.ok(activityId?.startsWith("activity:observation:obs-gr-create"));
  assert.equal(observation?.causality.activity_id, activityId);
  assert.equal(decision?.causality.activity_id, activityId);
  assert.equal(acquired?.causality.activity_id, activityId);
  assert.equal(sheet?.causality.activity_id, activityId);
});

test("activity grouping does not remove original evidence events", async () => {
  const page = await ok(GOLDEN_JOBS.granot, goldenGranotRows());
  const kinds = page.events.map((event) => event.kind);
  assert.ok(kinds.includes("source_received"));
  assert.ok(kinds.includes("lead_created"));
  assert.ok(kinds.includes("job_number_acquired"));
  assert.ok(kinds.includes("granot_observation"));
  assert.ok(kinds.includes("synchronization_decision"));
  assert.ok(kinds.includes("sheet_sync"));
  const activity = page.activities.find((row) => row.activity_id === "activity:observation:obs-gr-create");
  assert.ok(activity);
  assert.ok((activity?.event_ids.length ?? 0) >= 2);
  assert.ok(activity?.event_ids.every((id) => page.events.some((event) => event.id === id)));
  assert.equal(page.events.filter((event) => event.kind === "lead_created").length, 1);
  assert.equal(page.events.filter((event) => event.kind === "source_received").length, 1);
});

test("orphan cancellation is not attached without durable job snapshot", async () => {
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
  assert.equal(page.events.some((event) => event.kind === "official_cancellation"), false);
  assert.equal(page.coverage.official_cancellation, false);
  assert.equal(page.current.cancellation_id, undefined);
  assert.ok(page.attention.some((row) => row.code === "ORPHAN_CANCELLATION_REFERENCE"));
});

test("cancellation snapshot restores exact job correlation", async () => {
  const page = await ok("7702", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-snap",
        captured_at: T0,
        normalized_job_no: "7702",
        route_event_class: "booking_status_changed",
      },
    ],
    cancellations: [
      {
        id: "cancel-snap",
        booked_lead: "deleted-booking",
        createdAt: T1,
        job_no_snapshot: "7702",
        normalized_job_no_snapshot: "7702",
        lead_ref_snapshot: { model: "FormLead", id: "lead-gone" },
      },
    ],
  });
  const cancellation = page.events.find((event) => event.kind === "official_cancellation");
  assert.ok(cancellation);
  assert.equal(page.coverage.official_cancellation, true);
  assert.equal(cancellation?.correlation.confidence, "exact");
  assert.equal(cancellation?.correlation.method, "direct_job_number");
});

test("event cap returns explicit truncation limitation", async () => {
  const observations = Array.from({ length: 260 }, (_, index) => ({
    id: `obs-cap-${String(index).padStart(3, "0")}`,
    captured_at: `2026-04-01T${String(10 + Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
    normalized_job_no: "8801",
    route_event_class: "priority_updated",
  }));
  const page = await ok("8801", {
    ...emptyJobTimelineRows(),
    observations,
  });
  assert.equal(page.events.length, JOB_TIMELINE_EVENT_CAP);
  assert.equal(page.summary.event_count, JOB_TIMELINE_EVENT_CAP);
  const truncated = page.limitations.find((row) => row.code === "TIMELINE_TRUNCATED");
  assert.ok(truncated);
  assert.ok((truncated?.counts_by_stage?.processing ?? 0) > 0);
  assert.ok((truncated?.event_ids.length ?? 0) > 0);
});

test("serialized v2 page contains no forbidden fields or contact", async () => {
  const goldens: Array<[string, string, JobTimelineRows]> = [
    ["wordpress", GOLDEN_JOBS.wordpress, goldenWordpressRows()],
    ["granot", GOLDEN_JOBS.granot, goldenGranotRows()],
    ["ringcentral", GOLDEN_JOBS.ringcentral, goldenRingCentralRows()],
    ["booked", GOLDEN_JOBS.booked, goldenBookedRows()],
    ["cancelled", GOLDEN_JOBS.cancelled, goldenCancelledRows()],
    ["policySkip", GOLDEN_JOBS.policySkip, goldenPolicySkipRows()],
    ["resolvedBookingWithoutFact", GOLDEN_JOBS.resolvedBookingWithoutFact, goldenResolvedBookingWithoutFactRows()],
    ["resolvedReleaseWithoutFact", GOLDEN_JOBS.resolvedReleaseWithoutFact, goldenResolvedReleaseWithoutFactRows()],
    ["contradictory", GOLDEN_JOBS.contradictory, goldenContradictoryChronologyRows()],
    ["cancellationIntakeOpen", GOLDEN_JOBS.cancellationIntakeOpen, goldenOpenCancellationIntakeRows()],
  ];
  for (const [name, jobNo, rows] of goldens) {
    const page = await ok(jobNo, rows);
    const serialized = JSON.stringify(page);
    assertPageSafe(serialized);
    assert.equal(
      pageContainsForbiddenContact(serialized, [LEAD_NAME, LEAD_PHONE, SMS_BODY, OBS_CONTACT]),
      false,
      `${name} leaked a forbidden contact token`,
    );
    assert.equal(serialized.includes("spreadsheet_id"), false, name);
    assert.equal(serialized.includes("last_error"), false, name);
    assert.equal(serialized.includes("phone_raw"), false, name);
    assert.equal(serialized.includes("transcript"), false, name);
    assert.equal(serialized.includes("recording_url"), false, name);
    assert.equal(page.events.every((event) => event.evidence_level !== undefined), true, name);
    assert.equal(
      page.events.some((event) => String(event.evidence_level) === "inferred"),
      false,
      name,
    );
  }
});

test("golden pages cover origin and official-fact shapes", async () => {
  const wordpress = await ok(GOLDEN_JOBS.wordpress, goldenWordpressRows());
  const granot = await ok(GOLDEN_JOBS.granot, goldenGranotRows());
  const ringcentral = await ok(GOLDEN_JOBS.ringcentral, goldenRingCentralRows());
  const booked = await ok(GOLDEN_JOBS.booked, goldenBookedRows());
  const cancelled = await ok(GOLDEN_JOBS.cancelled, goldenCancelledRows());

  assert.equal(wordpress.proof_shape, "wordpress_born");
  assert.equal(wordpress.events.some((event) => event.kind === "source_received"), false);
  assert.equal(granot.proof_shape, "granot_born");
  assert.equal(granot.events.some((event) => event.kind === "source_received"), true);
  assert.equal(ringcentral.proof_shape, "ringcentral_born");
  const rcReceipt = ringcentral.events.find((event) => event.kind === "source_received");
  assert.equal(rcReceipt?.data.ingress, "ringcentral");
  assert.equal(rcReceipt?.data.qualification_outcome, "qualified_inbound");
  assert.equal("callerPhoneNumber" in (rcReceipt?.data ?? {}), false);
  assert.equal(ringcentral.freshness.ringcentral_covered_through, T3);
  assert.equal(wordpress.current_outcome, GOLDEN_EXPECTATIONS.wordpress.outcome);
  assert.equal(granot.current_outcome, GOLDEN_EXPECTATIONS.granot.outcome);
  assert.equal(ringcentral.current_outcome, GOLDEN_EXPECTATIONS.ringcentral.outcome);
  assert.equal(booked.current_outcome, GOLDEN_EXPECTATIONS.booked.outcome);
  assert.equal(cancelled.current_outcome, GOLDEN_EXPECTATIONS.cancelled.outcome);
  assert.ok(wordpress.limitations.some((row) => row.code === "WORDPRESS_RECEIPT_UNAVAILABLE"));
  assert.ok(ringcentral.limitations.some((row) => row.code === "RINGCENTRAL_CURSOR_BOUNDED"));
  for (const page of [wordpress, granot, ringcentral, booked, cancelled]) {
    assert.equal(page.stage_assessments.length, 7);
    for (const code of ALWAYS_LIMITATION_CODES) {
      assert.ok(page.limitations.some((row) => row.code === code), `${page.proof_shape} missing ${code}`);
    }
    assert.equal(page.summary.attention_count, page.attention.length);
    assert.ok(page.summary.headline);
  }
  assert.equal(booked.coverage.official_booking, true);
  assert.equal(booked.events.some((event) => event.kind === "official_booking"), true);
  assert.equal(cancelled.coverage.official_cancellation, true);
  assert.equal(cancelled.events.some((event) => event.kind === "official_cancellation"), true);
  assert.ok(cancelled.events.some((event) => event.kind === "official_booking"));
  const officialBooking = cancelled.events.find((event) => event.kind === "official_booking");
  const officialCancellation = cancelled.events.find((event) => event.kind === "official_cancellation");
  assert.ok(officialBooking && officialCancellation);
  assert.notEqual(officialBooking?.causality.activity_id, officialCancellation?.causality.activity_id);
});

test("skipped ringcentral ledger row is not a source receipt", async () => {
  const rows = goldenRingCentralRows();
  const page = await ok(GOLDEN_JOBS.ringcentral, {
    ...rows,
    processed_calls: [
      {
        id: "pc-skipped",
        callLeadId: "lead-rc-1",
        status: "skipped",
        qualificationReason: "too_short",
        firstProcessedAt: T0,
      },
    ],
  });
  assert.equal(page.events.some((event) => event.kind === "source_received"), false);
  assert.equal(page.events.some((event) => event.kind === "lead_created"), true);
});

test("v1 fields remain populated on enhanced events", async () => {
  const page = await ok(GOLDEN_JOBS.wordpress, goldenWordpressRows());
  for (const event of page.events) {
    assert.ok(event.id);
    assert.ok(event.kind);
    assert.ok(event.event_at);
    assert.ok(event.clock_field);
    assert.ok(typeof event.type_priority === "number");
    assert.ok(event.coverage);
    assert.ok(event.headline);
    assert.ok(event.data && typeof event.data === "object");
    assert.ok(event.stage);
    assert.ok(event.evidence_level);
    assert.ok(event.time.occurred_at);
    assert.ok(event.correlation.method);
    assert.ok(event.causality.activity_id);
  }
});
