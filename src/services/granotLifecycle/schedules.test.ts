import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PENDING_MATCH_OFFSETS_MS,
  PENDING_MATCH_WINDOW_MS,
  SYNC_POLL_DEADLINE_MS,
  TECHNICAL_RETRY_CAP_MS,
  nextPendingMatchDueAt,
  shouldCompletePendingMatch,
  syncPollBackoffMs,
  technicalRetryDelayMs,
} from "./schedules";

const capturedAt = new Date("2026-08-17T00:00:00.000Z");

test("[AC-30] foundation technical retry uses exact exponential cap and 0-25% jitter", () => {
  const noJitter = () => 0;
  const maxJitter = () => 1;
  assert.equal(technicalRetryDelayMs(1, noJitter), 30_000);
  assert.equal(technicalRetryDelayMs(2, noJitter), 60_000);
  assert.equal(technicalRetryDelayMs(3, noJitter), 120_000);
  assert.equal(technicalRetryDelayMs(9, noJitter), Math.min(TECHNICAL_RETRY_CAP_MS, 30_000 * 2 ** 8));
  assert.equal(technicalRetryDelayMs(1, maxJitter), Math.floor(30_000 * 1.25));
  const mid = technicalRetryDelayMs(1, () => 0.4);
  assert.ok(mid >= 30_000 && mid <= 37_500);
});

test("[AC-30] foundation pending-match offsets are absolute from captured_at", () => {
  const expected = [0, 1, 5, 15, 60, 120, 360, 720, 1440].map((minutes) => minutes * 60_000);
  assert.deepEqual([...PENDING_MATCH_OFFSETS_MS], expected);
  for (const [index, offset] of PENDING_MATCH_OFFSETS_MS.entries()) {
    const due = nextPendingMatchDueAt(capturedAt, index);
    assert.equal(due?.toISOString(), new Date(capturedAt.getTime() + offset).toISOString());
  }
  assert.equal(nextPendingMatchDueAt(capturedAt, 9), null);
});

test("[AC-30] foundation still-failed match at or after 24 hours is not scheduled", () => {
  assert.equal(PENDING_MATCH_WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.equal(
    shouldCompletePendingMatch({
      capturedAt,
      now: new Date(capturedAt.getTime() + PENDING_MATCH_WINDOW_MS),
      matchAttemptAfterIncrement: 1,
    }),
    true,
  );
  assert.equal(
    shouldCompletePendingMatch({
      capturedAt,
      now: new Date(capturedAt.getTime() + 12 * 60 * 60 * 1000),
      matchAttemptAfterIncrement: 8,
    }),
    false,
  );
  assert.equal(
    shouldCompletePendingMatch({
      capturedAt,
      now: new Date(capturedAt.getTime() + 12 * 60 * 60 * 1000),
      matchAttemptAfterIncrement: 9,
    }),
    true,
  );
});

test("[AC-30] foundation sync poll backoff stays bounded inside five seconds", () => {
  assert.equal(SYNC_POLL_DEADLINE_MS, 5_000);
  let elapsed = 0;
  for (let i = 0; i < 12; i += 1) {
    const step = syncPollBackoffMs(i);
    assert.ok(step <= 1_000);
    elapsed += step;
  }
  assert.ok(elapsed >= SYNC_POLL_DEADLINE_MS);
  assert.equal(syncPollBackoffMs(0), 50);
  assert.equal(syncPollBackoffMs(1), 100);
});
