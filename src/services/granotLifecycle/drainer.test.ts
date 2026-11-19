import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { toObjectId } from "../../utils/objectId";
import { GRANOT_LIFECYCLE_FLAG_DEFAULTS } from "../../config/domain/granotLifecycle";
import {
  claimAndProcessOrPoll,
  drainRequestedReceipt,
  type ClaimedReceiptSnapshot,
  type ClaimResult,
  type DrainerDeps,
  type ProcessorResult,
} from "./drainer";
import {
  getGranotLifecycleDeadLettersTotal,
  resetGranotLifecycleMetrics,
} from "./metrics";
import { LEASE_DURATION_MS, TECHNICAL_DEAD_LETTER_ATTEMPT } from "./schedules";
import type { SynchronizationOutcome } from "./types";
import {
  clearCapturedDailyOperationsFacts,
  getCapturedDailyOperationsFacts,
} from "../dailyOperations/testDailyOperationsSink";

const capturedAt = new Date("2026-08-17T00:00:00.000Z");

function objectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId();
}

function snapshot(overrides: Partial<ClaimedReceiptSnapshot> = {}): ClaimedReceiptSnapshot {
  const { processing, ...rest } = overrides;
  return {
    _id: objectId(),
    captured_at: capturedAt,
    observation_channel: "granot_webhook",
    payload_sha256: "a".repeat(64),
    ...rest,
    processing: {
      state: "pending",
      technical_attempts: 0,
      match_attempt: 0,
      next_attempt_at: capturedAt,
      manual_requeue_count: 0,
      ...processing,
    },
  };
}

function processorResult(
  outcome: SynchronizationOutcome,
  extras: Partial<ProcessorResult> = {},
): ProcessorResult {
  return {
    observation_id: String(objectId()),
    decision_id: String(objectId()),
    outcome,
    effects: [],
    ...extras,
  };
}

function matchesClaimFilter(
  row: ClaimedReceiptSnapshot,
  filter: Record<string, unknown>,
  now: Date,
): boolean {
  if (filter._id != null && String(filter._id) !== String(row._id)) {
    return false;
  }
  if (!["pending", "retry_scheduled", "claimed"].includes(row.processing.state)) {
    return false;
  }
  const dueAt = new Date(row.processing.next_attempt_at).getTime();
  if (dueAt > now.getTime()) {
    return false;
  }
  if (row.processing.state === "claimed") {
    return Boolean(
      row.processing.leased_until && row.processing.leased_until.getTime() <= now.getTime(),
    );
  }
  return true;
}

function memoryStore(rows: ClaimedReceiptSnapshot[]): DrainerDeps & {
  rows: ClaimedReceiptSnapshot[];
  processorCalls: string[];
  decisions: ProcessorResult[];
  events: Array<{ eventKey: string; details: Record<string, unknown> }>;
} {
  const processorCalls: string[] = [];
  const decisions: ProcessorResult[] = [];
  const events: Array<{ eventKey: string; details: Record<string, unknown> }> = [];
  let clock = new Date("2026-08-17T00:00:00.000Z");
  const store: DrainerDeps & {
    rows: ClaimedReceiptSnapshot[];
    processorCalls: string[];
    decisions: ProcessorResult[];
    events: Array<{ eventKey: string; details: Record<string, unknown> }>;
  } = {
    rows,
    processorCalls,
    decisions,
    events,
    now: () => clock,
    random: () => 0,
    sleep: async (ms) => {
      clock = new Date(clock.getTime() + ms);
    },
    flags: { ...GRANOT_LIFECYCLE_FLAG_DEFAULTS },
    createOwner: (trigger) => `glc_${trigger}_testowner`,
    claimOne: async (filter, update) => {
      const now = update.$set["processing.last_started_at"] as Date;
      const owner = update.$set["processing.lease_owner"] as string;
      const index = rows.findIndex((row) => matchesClaimFilter(row, filter, now));
      if (index < 0) {
        return null;
      }
      const previous: ClaimedReceiptSnapshot = {
        ...rows[index],
        processing: { ...rows[index].processing },
      };
      rows[index].processing.state = "claimed";
      rows[index].processing.lease_owner = owner;
      rows[index].processing.leased_until = update.$set["processing.leased_until"] as Date;
      rows[index].processing.last_started_at = now;
      rows[index].processing.technical_attempts += 1;
      return {
        previous,
        claimed: {
          ...rows[index],
          processing: { ...rows[index].processing },
        },
        recovered: previous.processing.state === "claimed",
      } satisfies ClaimResult;
    },
    findDueIds: async (now) =>
      rows.filter((row) => matchesClaimFilter(row, {}, now)).map((row) => row._id),
    renewLease: async (id, owner, until) => {
      const row = rows.find((entry) => String(entry._id) === String(id));
      if (!row || row.processing.state !== "claimed" || row.processing.lease_owner !== owner) {
        return false;
      }
      row.processing.leased_until = until;
      return true;
    },
    finalize: async (id, owner, update) => {
      const row = rows.find((entry) => String(entry._id) === String(id));
      if (!row || row.processing.state !== "claimed" || row.processing.lease_owner !== owner) {
        return false;
      }
      const set = (update.$set ?? {}) as Record<string, unknown>;
      const unset = (update.$unset ?? {}) as Record<string, unknown>;
      const inc = (update.$inc ?? {}) as Record<string, number>;
      for (const [path, value] of Object.entries(set)) {
        applyProcessingPath(row, path, value);
      }
      for (const path of Object.keys(unset)) {
        applyProcessingPath(row, path, undefined);
      }
      for (const [path, value] of Object.entries(inc)) {
        const current = readProcessingPath(row, path);
        applyProcessingPath(row, path, Number(current ?? 0) + value);
      }
      return true;
    },
    loadReceipt: async (id) => rows.find((row) => String(row._id) === id) ?? null,
    loadDecisionResult: async (decisionId) =>
      decisions.find((decision) => decision.decision_id === String(decisionId)) ?? null,
    recordEvent: async (input) => {
      events.push({ eventKey: input.eventKey, details: input.details });
    },
    processor: {
      async process(input) {
        processorCalls.push(input.receipt_id);
        const result = processorResult("policy_blocked");
        decisions.push(result);
        return result;
      },
    },
  };
  return store;
}

function applyProcessingPath(
  row: ClaimedReceiptSnapshot,
  path: string,
  value: unknown,
): void {
  const key = path.replace(/^processing\./, "") as keyof ClaimedReceiptSnapshot["processing"];
  if (value === undefined) {
    delete row.processing[key];
    return;
  }
  (row.processing as Record<string, unknown>)[key] = value;
}

function readProcessingPath(row: ClaimedReceiptSnapshot, path: string): unknown {
  const key = path.replace(/^processing\./, "") as keyof ClaimedReceiptSnapshot["processing"];
  return row.processing[key];
}

test("[AC-30] foundation pending_match increments match_attempt once and does not consume technical budget", async () => {
  const row = snapshot();
  const deps = memoryStore([row]);
  const pending = processorResult("pending_match");
  deps.decisions.push(pending);
  deps.processor = {
    async process() {
      deps.processorCalls.push(String(row._id));
      return pending;
    },
  };
  const summary = await drainRequestedReceipt(String(row._id), "cron", deps);
  assert.equal(summary.retried, 1);
  assert.equal(row.processing.state, "retry_scheduled");
  assert.equal(row.processing.match_attempt, 1);
  assert.equal(row.processing.technical_attempts, 0);
  assert.equal(
    row.processing.next_attempt_at.toISOString(),
    new Date(capturedAt.getTime() + 60_000).toISOString(),
  );
});

test("[AC-30] foundation pending_match at 24 hours completes and is not scheduled further", async () => {
  const row = snapshot({
    processing: {
      state: "pending",
      technical_attempts: 0,
      match_attempt: 8,
      next_attempt_at: new Date(capturedAt.getTime() + 24 * 60 * 60 * 1000),
      manual_requeue_count: 0,
    },
  });
  const deps = memoryStore([row]);
  deps.now = () => new Date(capturedAt.getTime() + 24 * 60 * 60 * 1000);
  const pending = processorResult("pending_match");
  deps.processor = {
    async process() {
      return pending;
    },
  };
  const summary = await drainRequestedReceipt(String(row._id), "cron", deps);
  assert.equal(summary.completed, 1);
  assert.equal(row.processing.state, "completed");
  assert.equal(row.processing.match_attempt, 9);
  assert.equal(row.processing.technical_attempts, 0);
});

test("[AC-30] foundation consecutive technical failure 10 dead-letters with a safe error", async () => {
  resetGranotLifecycleMetrics();
  const row = snapshot({
    processing: {
      state: "retry_scheduled",
      technical_attempts: TECHNICAL_DEAD_LETTER_ATTEMPT - 1,
      match_attempt: 3,
      next_attempt_at: capturedAt,
      manual_requeue_count: 0,
    },
  });
  const deps = memoryStore([row]);
  deps.processor = {
    async process() {
      throw Object.assign(new Error("mongodb://user:pass@host/payload"), {
        code: "transaction_failure",
      });
    },
  };
  clearCapturedDailyOperationsFacts();
  const summary = await drainRequestedReceipt(String(row._id), "cron", deps);
  assert.equal(summary.dead_lettered, 1);
  assert.equal(row.processing.state, "dead_letter");
  const deadLetterFacts = getCapturedDailyOperationsFacts().filter(
    (fact) => fact.input.kind === "exception.dead_letter",
  );
  assert.equal(deadLetterFacts.length, 1);
  assert.equal(
    deadLetterFacts[0]?.input.dedupe_key,
    `exception:dead_letter:${String(row._id)}`,
  );
  assert.equal(row.processing.technical_attempts, TECHNICAL_DEAD_LETTER_ATTEMPT);
  assert.equal(row.processing.match_attempt, 3);
  assert.equal(row.processing.last_error?.code, "transaction_failure");
  assert.equal(row.processing.last_error?.message.includes("mongodb"), false);
  assert.equal(getGranotLifecycleDeadLettersTotal("transaction_failure"), 1);
});

test("synchronous loser polls at most five seconds and never starts a second processor", async () => {
  const row = snapshot({
    processing: {
      state: "claimed",
      technical_attempts: 1,
      match_attempt: 0,
      next_attempt_at: capturedAt,
      lease_owner: "glc_queue_winner",
      leased_until: new Date(capturedAt.getTime() + LEASE_DURATION_MS),
      manual_requeue_count: 0,
    },
  });
  const deps = memoryStore([row]);
  const started = deps.now!().getTime();
  const result = await claimAndProcessOrPoll(String(row._id), deps);
  const elapsed = deps.now!().getTime() - started;
  assert.equal(result.status, "accepted_for_processing");
  assert.ok(elapsed <= 5_000);
  assert.equal(deps.processorCalls.length, 0);
});

test("completed channel replay survives decision expiry and respects a superseding decision", async () => {
  const original = processorResult("already_current");
  const newer = processorResult("linked");
  for (const latest of [original, newer]) {
    const row = snapshot({
      processing: {
        state: "completed", technical_attempts: 0, match_attempt: 0,
        next_attempt_at: capturedAt, completed_at: capturedAt, manual_requeue_count: 0,
        latest_decision_id: toObjectId(latest.decision_id), replay_result: original,
      },
    });
    const deps = memoryStore([row]);
    if (latest === newer) deps.decisions.push(newer);
    const response = await claimAndProcessOrPoll(String(row._id), deps);
    assert.equal(response.status, "processed");
    if (response.status === "processed") assert.equal(response.result.outcome, latest.outcome);
    assert.equal(deps.processorCalls.length, 0);
  }
});

test("routine HTTP Lead results round-trip from the receipt alone and respect later reconciliation", async () => {
  for (const outcome of ["already_current", "stale"] as const) {
    for (const model of ["FormLead", "CallLead"] as const) {
      const row = snapshot({ observation_channel: "granot_http_automation", channel_operation_id: "run:action" });
      const deps = memoryStore([row]);
      const original = processorResult(outcome, { target: { model, id: String(objectId()) } });
      deps.processor = { process: async () => original };
      const expected = { status: "processed", result: original };
      assert.deepEqual(await claimAndProcessOrPoll(String(row._id), deps), expected);
      assert.ok(row.processing.replay_result && "decision" in row.processing.replay_result);
      assert.deepEqual(await claimAndProcessOrPoll(String(row._id), deps), expected);
      const correction = processorResult("linked");
      deps.decisions.push(correction);
      row.processing.latest_decision_id = toObjectId(correction.decision_id);
      assert.deepEqual(await claimAndProcessOrPoll(String(row._id), deps), { status: "processed", result: correction });
    }
  }
});
