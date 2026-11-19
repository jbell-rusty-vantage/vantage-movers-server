import assert from "node:assert/strict";
import { test } from "node:test";
import { T0, T1, T3, WP_JOB, wordpressReceiptRows, wordpressRows } from "./fixtures.js";
import {
  ALWAYS_LIMITATION_CODES,
  GOLDEN_EXPECTATIONS,
  GOLDEN_JOBS,
  goldenBookedRows,
  goldenCancelledRows,
  goldenGranotRows,
  goldenRingCentralRows,
  goldenWordpressRows,
} from "./golden-pages.js";
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

test("timeline emits wordpress source_received only when the receipt exists", async () => {
  const withReceipt = await ok(WP_JOB, wordpressReceiptRows());
  const receipts = withReceipt.events.filter((event) => event.kind === "source_received");
  assert.equal(withReceipt.proof_shape, "wordpress_born");
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]?.data.ingress, "wordpress");
  assert.equal(receipts[0]?.type_priority, 5);
  assert.ok(withReceipt.events.findIndex((event) => event.kind === "source_received")
    < withReceipt.events.findIndex((event) => event.kind === "lead_created"));
  assert.equal(
    withReceipt.limitations.some((row) => row.code === "WORDPRESS_RECEIPT_UNAVAILABLE"),
    false,
  );

  const withoutReceipt = await ok(WP_JOB, wordpressRows());
  assert.equal(withoutReceipt.events.some((event) => event.kind === "source_received"), false);
  assert.ok(withoutReceipt.limitations.some((row) => row.code === "WORDPRESS_RECEIPT_UNAVAILABLE"));
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
