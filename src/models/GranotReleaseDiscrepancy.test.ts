import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRANOT_RELEASE_DISCREPANCY_INDEXES,
  GranotReleaseDiscrepancy,
  RELEASE_DISCREPANCY_REASON_CODES,
} from "./GranotReleaseDiscrepancy";

describe("GranotReleaseDiscrepancy", () => {
  it("[AC-27][AC-35][AC-36] fixes Release reasons and separate indexes", () => {
    assert.deepEqual(RELEASE_DISCREPANCY_REASON_CODES, [
      "release_without_vantage_booking",
      "release_record_link_conflict",
      "release_job_number_conflict",
      "release_source_scope_conflict",
    ]);
    assert.equal(GRANOT_RELEASE_DISCREPANCY_INDEXES.length, 2);
    assert.equal(
      GRANOT_RELEASE_DISCREPANCY_INDEXES[0]!.name,
      "granot_release_discrepancy_open_fingerprint_unique",
    );
    assert.equal(GranotReleaseDiscrepancy.collection.name, "granot_release_discrepancies");
  });

  it("[AC-27][AC-36] accepts only Release reason rows", async () => {
    const base = {
      normalized_job_no: "U29MODEL2",
      discrepancy_kind: "release" as const,
      reason_code: "release_without_vantage_booking" as const,
      reason_fingerprint: "b".repeat(64),
      state: "open" as const,
      evidence: [{
        observation_id: "64b000000000000000000011",
        decision_id: "64b000000000000000000012",
        captured_at: new Date("2026-08-19T00:00:00.000Z"),
        action: "release" as const,
      }],
      evidence_revision: 1,
      revision: 1,
      opened_at: new Date("2026-08-19T00:00:00.000Z"),
      last_evidence_at: new Date("2026-08-19T00:00:00.000Z"),
    };
    await new GranotReleaseDiscrepancy(base).validate();
    await assert.rejects(
      () => new GranotReleaseDiscrepancy({
        ...base,
        reason_code: "booked_after_official_cancellation",
      }).validate(),
      /reason_code/,
    );
  });
});
