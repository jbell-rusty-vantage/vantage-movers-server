import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleJobNumberTimeline } from "../../../../src/services/jobNumberTimeline/assemble.js";
import { emptyJobTimelineRows } from "../../../../src/services/jobNumberTimeline/rows.js";
import type { JobTimelinePage } from "../../../../src/services/jobNumberTimeline/types.js";
import { discoverJobNumberTimelines } from "./discover.js";

const T0 = "2026-03-01T10:00:00.000Z";
const T1 = "2026-03-01T11:00:00.000Z";
const T2 = "2026-03-01T12:00:00.000Z";
const T3 = "2026-03-01T13:00:00.000Z";

function pageOrThrow(rawJobNo: string, rows: ReturnType<typeof emptyJobTimelineRows>): JobTimelinePage {
  const result = assembleJobNumberTimeline({ rawJobNo, rows });
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw new Error("expected ok");
  return result.page;
}

test("Discover score", () => {
  const wordpress = pageOrThrow("9001001", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-wp-1",
        captured_at: T2,
        normalized_job_no: "9001001",
        route_event_class: "priority_updated",
      },
    ],
    decisions: [
      {
        id: "dec-wp-1",
        observation_id: "obs-wp-1",
        attempt: 1,
        decided_at: T2,
        outcome: "applied",
        reason_code: "lead_synchronized",
        target: { model: "FormLead", id: "lead-wp-1" },
      },
    ],
    booking_cases: [
      {
        id: "case-wp-1",
        kind: "booking",
        normalized_job_no: "9001001",
        state: "open",
        mode: "confirm",
        evidence: [{ observation_id: "obs-wp-1", captured_at: T3 }],
      },
    ],
    leads: [
      {
        id: "lead-wp-1",
        model: "FormLead",
        ingestion_origin: "wordpress_form",
        timestamp: T0,
      },
    ],
    entity_changes: [
      {
        id: "chg-wp-create",
        entity_model: "FormLead",
        entity_id: "lead-wp-1",
        command_name: "createFormLead",
        applied_at: T0,
        changed_paths: ["name"],
      },
      {
        id: "chg-wp-sync",
        entity_model: "FormLead",
        entity_id: "lead-wp-1",
        command_name: "synchronizeLeadFromGranot",
        applied_at: T2,
        changed_paths: ["job_no", "normalized_job_no"],
      },
    ],
    lead_messages: [
      {
        id: "msg-wp-1",
        lead_id: "lead-wp-1",
        origin: "public_form",
        purpose: "quote_request_confirmation",
        status: "delivered",
        delivered_at: T1,
      },
    ],
  });

  const thin = pageOrThrow("1111111", {
    ...emptyJobTimelineRows(),
    observations: [
      {
        id: "obs-thin",
        captured_at: T0,
        normalized_job_no: "1111111",
        route_event_class: "priority_updated",
      },
    ],
    decisions: [
      {
        id: "dec-thin",
        observation_id: "obs-thin",
        attempt: 1,
        decided_at: T0,
        outcome: "applied",
        reason_code: "priority_updated",
      },
    ],
  });

  assert.equal(wordpress.proof_shape, "wordpress_born");
  const ranked = discoverJobNumberTimelines([thin, wordpress], { minScore: 1, limit: 20 });
  assert.equal(ranked[0]?.normalized_job_no, "9001001");
  const thinScore = ranked.find((row) => row.normalized_job_no === "1111111")?.score ?? 0;
  assert.ok((ranked[0]?.score ?? 0) > thinScore);
});
