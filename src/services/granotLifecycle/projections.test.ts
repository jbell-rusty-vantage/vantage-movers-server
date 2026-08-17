import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JOB_PROJECTION_LIMIT,
  assertJobProjectionMasked,
  collectForbiddenProjectionKeys,
  flagsToNamedBooleans,
  normalizeJobProjectionPath,
} from "./projections";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import { GRANOT_LIFECYCLE_ERROR_CODES } from "./errors";
import type { GranotJobProjection } from "./projections";

test("[AC-35] portion Job path normalization rejects empty values", () => {
  assert.equal(normalizeJobProjectionPath("synthetic-job-100"), "SYNTHETIC JOB 100");
  assert.throws(
    () => normalizeJobProjectionPath("   "),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      (error as { code: string }).code === GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
  );
});

test("[AC-35] portion Job projection capabilities stay incomplete and raw-free", () => {
  const projection: GranotJobProjection = {
    normalized_job_no: "SYNTHETIC JOB 100",
    observations: [
      {
        id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        receipt_id: "bbbbbbbbbbbbbbbbbbbbbbbb",
        kind: "lead_snapshot",
        normalization_result: "valid",
        captured_at: "2026-08-17T16:00:00.000Z",
        priority: { canonical: "1", valid: true },
        issue_codes: [],
      },
    ],
    decisions: [
      {
        id: "cccccccccccccccccccccccc",
        observation_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        attempt: 1,
        execution_mode: "historical_shadow",
        outcome: "linked",
        reason_code: "record_link_established",
        candidates: [],
        evaluated_gates: [],
        effects: [],
        decided_at: "2026-08-17T16:00:00.000Z",
      },
    ],
    capabilities: { complete_timeline: false, cases: false, official_facts: false },
  };
  assert.equal(projection.capabilities.complete_timeline, false);
  assert.equal(JOB_PROJECTION_LIMIT, 100);
  assertJobProjectionMasked(projection);
  assert.deepEqual(
    collectForbiddenProjectionKeys({
      ...projection,
      payload: { secret: true },
    }),
    ["payload"],
  );
});

test("health flag names match the ten centralized lifecycle flags", () => {
  const flags = flagsToNamedBooleans(GRANOT_LIFECYCLE_FLAG_DEFAULTS);
  assert.equal(flags.GRANOT_LIFECYCLE_PROCESSING_ENABLED, true);
  assert.equal(flags.GRANOT_LIFECYCLE_SHADOW_MODE, true);
  assert.equal(flags.GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED, false);
  assert.equal(flags.GRANOT_LIFECYCLE_EMAIL_ENABLED, false);
});

test("[AC-35] portion health projection stays raw-free and includes Unit 08 counts", () => {
  const health = {
    flags: flagsToNamedBooleans(GRANOT_LIFECYCLE_FLAG_DEFAULTS),
    activation: { present: false },
    receipts: {
      by_work_state: {
        pending: 1,
        claimed: 2,
        retry_scheduled: 0,
        completed: 4,
        dead_letter: 1,
      },
      due_count: 3,
      oldest_due_at: "2026-08-17T16:00:00.000Z",
      oldest_due_age_ms: 60_000,
      claimed_count: 2,
      expired_claim_count: 1,
      dead_letter_count: 1,
    },
    decisions_last_24h: [],
    record_links: { active: 0, disputed: 0 },
    last_queue_run: { at: "2026-08-17T16:05:00.000Z", status: "completed" as const },
    last_cron_run: null,
  };
  assert.equal(health.receipts.claimed_count, 2);
  assert.equal(health.receipts.expired_claim_count, 1);
  assert.equal(health.receipts.dead_letter_count, 1);
  assert.equal(health.last_queue_run?.status, "completed");
  assert.deepEqual(collectForbiddenProjectionKeys(health), []);
  assert.deepEqual(
    collectForbiddenProjectionKeys({
      ...health,
      last_error: { message: "owner@example.invalid" },
      payload: { secret: true },
    }),
    ["payload"],
  );
});
