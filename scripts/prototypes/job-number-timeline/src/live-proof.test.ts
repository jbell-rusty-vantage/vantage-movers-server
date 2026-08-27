import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOLDEN_JOBS,
  goldenBookedRows,
  goldenCancelledRows,
  goldenGranotRows,
  goldenOpenCancellationIntakeRows,
  goldenWordpressRows,
} from "../../../../src/services/jobNumberTimeline/golden-pages.js";
import { createMemoryEvidenceLoader } from "../../../../src/services/jobNumberTimeline/memory-evidence-loader.js";
import { createJobNumberTimelineModule } from "../../../../src/services/jobNumberTimeline/index.js";
import type { JobTimelineRows } from "../../../../src/services/jobNumberTimeline/rows.js";
import {
  activityGroupingPreservesCounts,
  aliasJobNumber,
  analyzeProofPage,
  collectionCountDeltas,
  percentile,
  selectProofAliases,
} from "./live-proof.js";

async function page(jobNo: string, rows: JobTimelineRows) {
  const result = await createJobNumberTimelineModule({
    loader: createMemoryEvidenceLoader({ rows }),
  }).read({ job_no: jobNo });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw new Error("expected ok");
  return result.page;
}

test("activity grouping preserves every event id", async () => {
  const wordpress = await page(GOLDEN_JOBS.wordpress, goldenWordpressRows());
  assert.equal(activityGroupingPreservesCounts(wordpress), true);
  assert.equal(wordpress.summary.event_count, wordpress.events.length);
});

test("proof notes alias Job Numbers and pick required shapes", async () => {
  const aliases = new Map<string, string>();
  const pages = [
    await page(GOLDEN_JOBS.wordpress, goldenWordpressRows()),
    await page(GOLDEN_JOBS.granot, goldenGranotRows()),
    await page(GOLDEN_JOBS.booked, goldenBookedRows()),
    await page(GOLDEN_JOBS.cancelled, goldenCancelledRows()),
    await page(GOLDEN_JOBS.cancellationIntakeOpen, goldenOpenCancellationIntakeRows()),
  ];
  const notes = pages.map((item) => analyzeProofPage(item, aliasJobNumber(item.normalized_job_no, aliases)));
  assert.equal(notes.every((note) => note.forbidden_scan === "pass"), true);
  assert.equal(notes.every((note) => note.activity_grouping_preserves_counts), true);
  assert.match(notes[0]?.alias ?? "", /^JOB-\d+$/);
  const selection = selectProofAliases(notes);
  assert.equal(selection.origin_shapes.wordpress_born, "JOB-1");
  assert.ok(selection.booking_intake_and_official);
  assert.ok(selection.official_cancellation);
  assert.ok(selection.cancellation_intake);
});

test("collection count deltas stay empty when counts match", () => {
  const counts = { booked_leads: 3, form_leads: 10 };
  assert.deepEqual(collectionCountDeltas(counts, { ...counts }), {});
  assert.deepEqual(collectionCountDeltas(counts, { booked_leads: 4, form_leads: 10 }), {
    booked_leads: 1,
  });
});

test("percentile uses the ceiling rank", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 95), 50);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([], 95), 0);
});
