import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import {
  getGranotLifecycleFlags,
  type GranotLifecycleFlags,
} from "../../config/domain/granotLifecycle";
import { logger } from "../../logger";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { getSynchronizationDecisionModel } from "../../models/SynchronizationDecision";
import { toObjectId } from "../../utils/objectId";
import { SYNCHRONIZATION_OUTCOMES } from "../../models/granotLifecycleSchemas";
import type { DurableActor } from "../durableWork/types";
import { recordOperationalEvent } from "../observability";
import { emitGranotLifecycleEvent } from "./observability";
import { ProcessingDisabledError } from "./errors";
import { classifyTechnicalFailureCode, sanitizeLastError } from "./lastError";
import {
  incrementGranotLifecycleClaimRecoveries,
  incrementGranotLifecycleDeadLetters,
  incrementGranotLifecycleTechnicalRetries,
  setGranotLifecycleOldestDueSeconds,
  setGranotLifecycleQueueDue,
} from "./metrics";
import { granotObservationProcessor } from "./processor";
import {
  CLAIM_BATCH_SIZE,
  CLAIM_CONCURRENCY,
  LEASE_DURATION_MS,
  LEASE_RENEW_INTERVAL_MS,
  SYNC_POLL_DEADLINE_MS,
  nextPendingMatchDueAt,
  shouldCompletePendingMatch,
  syncPollBackoffMs,
  technicalRetryDelayMs,
  TECHNICAL_DEAD_LETTER_ATTEMPT,
} from "./schedules";
import type {
  EntityRef,
  GranotObservationProcessor,
  ReceiptWorkState,
  SynchronizationEffectSummary,
  SynchronizationOutcome,
} from "./types";

export type DrainTrigger = "queue" | "cron" | "sync";

export type ProcessorResult = {
  observation_id: string;
  decision_id: string;
  outcome: SynchronizationOutcome;
  effects: SynchronizationEffectSummary[];
  target?: EntityRef;
};

export type ClaimedReceiptSnapshot = {
  _id: mongoose.Types.ObjectId;
  captured_at: Date;
  observation_channel: string;
  payload_sha256: string;
  channel_operation_id?: string;
  initiator?: DurableActor;
  processing: {
    state: ReceiptWorkState;
    technical_attempts: number;
    match_attempt: number;
    next_attempt_at: Date;
    lease_owner?: string;
    leased_until?: Date;
    last_started_at?: Date;
    last_error?: { code: string; message: string; failed_at: Date };
    completed_at?: Date;
    latest_decision_id?: mongoose.Types.ObjectId;
    manual_requeue_count: number;
  };
};

export type ClaimResult = {
  previous: ClaimedReceiptSnapshot;
  claimed: ClaimedReceiptSnapshot;
  recovered: boolean;
};

export type DrainItemResult =
  | { status: "skipped"; reason: "processing_disabled" | "not_claimable" | "invalid_id" }
  | { status: "lease_lost" }
  | {
      status: "completed" | "retry_scheduled" | "dead_letter";
      receipt_id: string;
      outcome?: SynchronizationOutcome;
      recovered: boolean;
    };

export type DrainSummary = {
  trigger: DrainTrigger;
  skipped: boolean;
  reason?: "processing_disabled";
  scanned: number;
  claimed: number;
  completed: number;
  retried: number;
  dead_lettered: number;
  recovered: number;
  lease_lost: number;
};

export type AcceptedForProcessing = {
  status: "accepted_for_processing";
  receipt_id: string;
  state: ReceiptWorkState;
  next_attempt_at: string;
};

export type SyncClaimResult =
  | { status: "processed"; result: ProcessorResult }
  | AcceptedForProcessing
  | { status: "skipped"; reason: "processing_disabled" | "not_found" | "invalid_id" };

const TERMINAL_OUTCOMES = new Set<SynchronizationOutcome>(
  (SYNCHRONIZATION_OUTCOMES as readonly SynchronizationOutcome[]).filter(
    (outcome) => outcome !== "pending_match",
  ),
);

const CLAIMABLE_STATES: ReceiptWorkState[] = ["pending", "retry_scheduled", "claimed"];

export function buildClaimFilter(
  now: Date,
  receiptId?: mongoose.Types.ObjectId,
): Record<string, unknown> {
  return {
    ...(receiptId ? { _id: receiptId } : {}),
    "processing.state": { $in: CLAIMABLE_STATES },
    "processing.next_attempt_at": { $lte: now },
    $or: [
      { "processing.state": { $ne: "claimed" } },
      { "processing.leased_until": { $lte: now } },
    ],
  };
}

export function buildClaimUpdate(
  now: Date,
  owner: string,
): {
  $set: Record<string, unknown>;
  $inc: Record<string, number>;
} {
  return {
    $set: {
      "processing.state": "claimed",
      "processing.lease_owner": owner,
      "processing.leased_until": new Date(now.getTime() + LEASE_DURATION_MS),
      "processing.last_started_at": now,
    },
    $inc: { "processing.technical_attempts": 1 },
  };
}

export function buildFenceFilter(
  id: mongoose.Types.ObjectId,
  owner: string,
): Record<string, unknown> {
  return {
    _id: id,
    "processing.state": "claimed",
    "processing.lease_owner": owner,
  };
}

export function createLeaseOwner(trigger: DrainTrigger): string {
  return `glc_${trigger}_${randomBytes(8).toString("hex")}`;
}

export type DrainerDeps = {
  now?: () => Date;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  flags?: GranotLifecycleFlags;
  processor?: GranotObservationProcessor;
  createOwner?: (trigger: DrainTrigger) => string;
  claimOne?: (
    filter: Record<string, unknown>,
    update: ReturnType<typeof buildClaimUpdate>,
  ) => Promise<ClaimResult | null>;
  findDueIds?: (now: Date, limit: number) => Promise<mongoose.Types.ObjectId[]>;
  renewLease?: (
    id: mongoose.Types.ObjectId,
    owner: string,
    until: Date,
  ) => Promise<boolean>;
  finalize?: (
    id: mongoose.Types.ObjectId,
    owner: string,
    update: Record<string, unknown>,
  ) => Promise<boolean>;
  loadReceipt?: (id: string) => Promise<ClaimedReceiptSnapshot | null>;
  loadDecisionResult?: (decisionId: mongoose.Types.ObjectId) => Promise<ProcessorResult | null>;
  recordEvent?: (input: {
    level: "info" | "warn" | "error";
    eventKey: string;
    category: "queue" | "cron" | "mongo";
    summary: string;
    details: Record<string, unknown>;
    entityId?: string;
  }) => Promise<void>;
};

export async function drainRequestedReceipt(
  receiptId: string,
  trigger: DrainTrigger = "queue",
  deps: DrainerDeps = {},
): Promise<DrainSummary> {
  const flags = deps.flags ?? getGranotLifecycleFlags();
  if (!flags.processing_enabled) {
    return skippedSummary(trigger);
  }
  const item = await processRequestedReceipt(receiptId, trigger, deps);
  return summarize(trigger, [item]);
}

export async function drainDueReceipts(
  trigger: DrainTrigger = "cron",
  deps: DrainerDeps = {},
): Promise<DrainSummary> {
  const flags = deps.flags ?? getGranotLifecycleFlags();
  if (!flags.processing_enabled) {
    return skippedSummary(trigger);
  }
  const now = (deps.now ?? (() => new Date()))();
  const ids = await (deps.findDueIds ?? defaultFindDueIds)(now, CLAIM_BATCH_SIZE);
  const items = await mapLimit(ids, CLAIM_CONCURRENCY, (id) =>
    processRequestedReceipt(String(id), trigger, deps),
  );
  return summarize(trigger, items);
}

export async function claimAndProcessOrPoll(
  receiptId: string,
  deps: DrainerDeps = {},
): Promise<SyncClaimResult> {
  const flags = deps.flags ?? getGranotLifecycleFlags();
  if (!flags.processing_enabled) {
    return { status: "skipped", reason: "processing_disabled" };
  }
  if (!mongoose.isValidObjectId(receiptId)) {
    return { status: "skipped", reason: "invalid_id" };
  }

  const item = await processRequestedReceipt(receiptId, "sync", deps);
  if (item.status === "completed" || item.status === "retry_scheduled" || item.status === "dead_letter") {
    if (item.status === "completed" && item.outcome) {
      const receipt = await (deps.loadReceipt ?? defaultLoadReceipt)(receiptId);
      const stored = receipt?.processing.latest_decision_id
        ? await (deps.loadDecisionResult ?? defaultLoadDecisionResult)(
            receipt.processing.latest_decision_id,
          )
        : null;
      if (stored) {
        return { status: "processed", result: stored };
      }
    }
    if (item.status === "completed") {
      const receipt = await (deps.loadReceipt ?? defaultLoadReceipt)(receiptId);
      const stored = receipt?.processing.latest_decision_id
        ? await (deps.loadDecisionResult ?? defaultLoadDecisionResult)(
            receipt.processing.latest_decision_id,
          )
        : null;
      if (stored) {
        return { status: "processed", result: stored };
      }
    }
  }
  if (item.status === "skipped" && item.reason === "not_claimable") {
    return pollForResult(receiptId, deps);
  }
  if (item.status === "lease_lost") {
    return pollForResult(receiptId, deps);
  }
  if (item.status === "skipped" && item.reason === "invalid_id") {
    return { status: "skipped", reason: "invalid_id" };
  }
  if (item.status === "completed") {
    return pollForResult(receiptId, deps);
  }
  const receipt = await (deps.loadReceipt ?? defaultLoadReceipt)(receiptId);
  if (!receipt) {
    return { status: "skipped", reason: "not_found" };
  }
  if (receipt.processing.state === "completed") {
    const stored = receipt.processing.latest_decision_id
      ? await (deps.loadDecisionResult ?? defaultLoadDecisionResult)(
          receipt.processing.latest_decision_id,
        )
      : null;
    if (stored) {
      return { status: "processed", result: stored };
    }
  }
  return {
    status: "accepted_for_processing",
    receipt_id: receiptId,
    state: receipt.processing.state,
    next_attempt_at: new Date(receipt.processing.next_attempt_at).toISOString(),
  };
}

export async function parseReceiptWakeup(payload: unknown): Promise<string> {
  const body = unwrapWakeup(payload);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Queue wakeup must be { receipt_id }");
  }
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "receipt_id") {
    throw new Error("Queue wakeup must be { receipt_id }");
  }
  const receiptId = (body as { receipt_id?: unknown }).receipt_id;
  if (typeof receiptId !== "string" || !mongoose.isValidObjectId(receiptId)) {
    throw new Error("Queue wakeup receipt_id is invalid");
  }
  return receiptId;
}

async function processRequestedReceipt(
  receiptId: string,
  trigger: DrainTrigger,
  deps: DrainerDeps,
): Promise<DrainItemResult> {
  if (!mongoose.isValidObjectId(receiptId)) {
    return { status: "skipped", reason: "invalid_id" };
  }
  const nowFn = deps.now ?? (() => new Date());
  const now = nowFn();
  const owner = (deps.createOwner ?? createLeaseOwner)(trigger);
  const claimed = await (deps.claimOne ?? defaultClaimOne)(
    buildClaimFilter(now, toObjectId(receiptId)),
    buildClaimUpdate(now, owner),
  );
  if (!claimed) {
    return { status: "skipped", reason: "not_claimable" };
  }
  if (claimed.recovered) {
    incrementGranotLifecycleClaimRecoveries();
    await emitGranotLifecycleEvent({
      eventKey: "granot_lifecycle.claim.recovered",
      category: "mongo",
      summary: "Granot lifecycle expired claim recovered.",
      details: { trigger, receipt_id: String(claimed.claimed._id) },
      entity: { type: "granot_observation_receipt", id: String(claimed.claimed._id) },
    });
  }
  return runFencedProcessor(claimed, owner, trigger, deps);
}

async function runFencedProcessor(
  claimed: ClaimResult,
  owner: string,
  trigger: DrainTrigger,
  deps: DrainerDeps,
): Promise<DrainItemResult> {
  const nowFn = deps.now ?? (() => new Date());
  const renew = deps.renewLease ?? defaultRenewLease;
  const finalize = deps.finalize ?? defaultFinalize;
  const processor = deps.processor ?? granotObservationProcessor;
  const recordEvent = deps.recordEvent ?? defaultRecordEvent;

  const renewed = await renew(
    claimed.claimed._id,
    owner,
    new Date(nowFn().getTime() + LEASE_DURATION_MS),
  );
  if (!renewed) {
    return { status: "lease_lost" };
  }

  let renewTimer: ReturnType<typeof setInterval> | undefined;
  if (LEASE_RENEW_INTERVAL_MS > 0) {
    renewTimer = setInterval(() => {
      void renew(
        claimed.claimed._id,
        owner,
        new Date(nowFn().getTime() + LEASE_DURATION_MS),
      );
    }, LEASE_RENEW_INTERVAL_MS);
    renewTimer.unref?.();
  }

  try {
    let result: ProcessorResult;
    try {
      result = await processor.process({
        receipt_id: String(claimed.claimed._id),
        initiator: claimed.claimed.initiator,
      });
    } catch (error) {
      if (error instanceof ProcessingDisabledError) {
        return finalizeTechnicalFailure({
          claimed,
          owner,
          error,
          code: "dependency_failure",
          trigger,
          deps,
          finalize,
          recordEvent,
        });
      }
      return finalizeTechnicalFailure({
        claimed,
        owner,
        error,
        code: classifyTechnicalFailureCode(error),
        trigger,
        deps,
        finalize,
        recordEvent,
      });
    }

    if (!(SYNCHRONIZATION_OUTCOMES as readonly string[]).includes(result.outcome)) {
      return finalizeTechnicalFailure({
        claimed,
        owner,
        error: Object.assign(new Error("Processor returned an unknown outcome"), {
          code: "unknown_outcome",
        }),
        code: "unknown_outcome",
        trigger,
        deps,
        finalize,
        recordEvent,
      });
    }

    if (result.outcome === "pending_match") {
      return finalizePendingMatch({
        claimed,
        owner,
        result,
        trigger,
        deps,
        finalize,
      });
    }

    if (!TERMINAL_OUTCOMES.has(result.outcome)) {
      return finalizeTechnicalFailure({
        claimed,
        owner,
        error: Object.assign(new Error("Processor returned an unknown outcome"), {
          code: "unknown_outcome",
        }),
        code: "unknown_outcome",
        trigger,
        deps,
        finalize,
        recordEvent,
      });
    }

    const now = nowFn();
    const fenced = await finalize(
      claimed.claimed._id,
      owner,
      {
        $set: {
          "processing.state": "completed",
          "processing.completed_at": now,
          "processing.latest_decision_id": toObjectId(result.decision_id),
          "processing.technical_attempts": 0,
        },
        $unset: {
          "processing.lease_owner": "",
          "processing.leased_until": "",
          "processing.last_error": "",
        },
      },
    );
    if (!fenced) {
      return { status: "lease_lost" };
    }
    return {
      status: "completed",
      receipt_id: String(claimed.claimed._id),
      outcome: result.outcome,
      recovered: claimed.recovered,
    };
  } finally {
    if (renewTimer) {
      clearInterval(renewTimer);
    }
  }
}

async function finalizePendingMatch(input: {
  claimed: ClaimResult;
  owner: string;
  result: ProcessorResult;
  trigger: DrainTrigger;
  deps: DrainerDeps;
  finalize: NonNullable<DrainerDeps["finalize"]>;
}): Promise<DrainItemResult> {
  const now = (input.deps.now ?? (() => new Date()))();
  const matchAttemptAfter = input.claimed.claimed.processing.match_attempt + 1;
  const complete = shouldCompletePendingMatch({
    capturedAt: input.claimed.claimed.captured_at,
    now,
    matchAttemptAfterIncrement: matchAttemptAfter,
  });
  const nextDue = complete
    ? null
    : nextPendingMatchDueAt(input.claimed.claimed.captured_at, matchAttemptAfter);
  const update = complete || !nextDue
    ? {
        $set: {
          "processing.state": "completed",
          "processing.completed_at": now,
          "processing.latest_decision_id": toObjectId(input.result.decision_id),
          "processing.technical_attempts": 0,
        },
        $inc: { "processing.match_attempt": 1 },
        $unset: {
          "processing.lease_owner": "",
          "processing.leased_until": "",
          "processing.last_error": "",
        },
      }
    : {
        $set: {
          "processing.state": "retry_scheduled",
          "processing.next_attempt_at": nextDue,
          "processing.latest_decision_id": toObjectId(input.result.decision_id),
          "processing.technical_attempts": 0,
        },
        $inc: { "processing.match_attempt": 1 },
        $unset: {
          "processing.lease_owner": "",
          "processing.leased_until": "",
          "processing.last_error": "",
          "processing.completed_at": "",
        },
      };
  const fenced = await input.finalize(input.claimed.claimed._id, input.owner, update);
  if (!fenced) {
    return { status: "lease_lost" };
  }
  return {
    status: complete || !nextDue ? "completed" : "retry_scheduled",
    receipt_id: String(input.claimed.claimed._id),
    outcome: input.result.outcome,
    recovered: input.claimed.recovered,
  };
}

async function finalizeTechnicalFailure(input: {
  claimed: ClaimResult;
  owner: string;
  error: unknown;
  code: string;
  trigger: DrainTrigger;
  deps: DrainerDeps;
  finalize: NonNullable<DrainerDeps["finalize"]>;
  recordEvent: NonNullable<DrainerDeps["recordEvent"]>;
}): Promise<DrainItemResult> {
  const now = (input.deps.now ?? (() => new Date()))();
  const random = input.deps.random ?? Math.random;
  const attempts = input.claimed.claimed.processing.technical_attempts;
  const last_error = sanitizeLastError(input.error, now, input.code);
  const deadLetter = attempts >= TECHNICAL_DEAD_LETTER_ATTEMPT;
  const update = deadLetter
    ? {
        $set: {
          "processing.state": "dead_letter",
          "processing.last_error": last_error,
        },
        $unset: {
          "processing.lease_owner": "",
          "processing.leased_until": "",
          "processing.completed_at": "",
        },
      }
    : {
        $set: {
          "processing.state": "retry_scheduled",
          "processing.next_attempt_at": new Date(
            now.getTime() + technicalRetryDelayMs(attempts, random),
          ),
          "processing.last_error": last_error,
        },
        $unset: {
          "processing.lease_owner": "",
          "processing.leased_until": "",
          "processing.completed_at": "",
        },
      };
  const fenced = await input.finalize(input.claimed.claimed._id, input.owner, update);
  if (!fenced) {
    return { status: "lease_lost" };
  }
  if (deadLetter) {
    incrementGranotLifecycleDeadLetters(last_error.code);
    await input.recordEvent({
      level: "error",
      eventKey: "granot_lifecycle.dead_letter.entered",
      category: "mongo",
      summary: "Granot lifecycle receipt moved to dead letter.",
      details: {
        code: last_error.code,
        technical_attempts: attempts,
        trigger: input.trigger,
      },
      entityId: String(input.claimed.claimed._id),
    });
    return {
      status: "dead_letter",
      receipt_id: String(input.claimed.claimed._id),
      recovered: input.claimed.recovered,
    };
  }
  incrementGranotLifecycleTechnicalRetries(last_error.code);
  await input.recordEvent({
    level: "warn",
    eventKey: "granot_lifecycle.technical_retry.scheduled",
    category: "mongo",
    summary: "Granot lifecycle technical retry scheduled.",
    details: {
      code: last_error.code,
      technical_attempts: attempts,
      trigger: input.trigger,
    },
    entityId: String(input.claimed.claimed._id),
  });
  return {
    status: "retry_scheduled",
    receipt_id: String(input.claimed.claimed._id),
    recovered: input.claimed.recovered,
  };
}

async function pollForResult(
  receiptId: string,
  deps: DrainerDeps,
): Promise<SyncClaimResult> {
  const nowFn = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const started = nowFn().getTime();
  let iteration = 0;
  while (nowFn().getTime() - started < SYNC_POLL_DEADLINE_MS) {
    const receipt = await (deps.loadReceipt ?? defaultLoadReceipt)(receiptId);
    if (!receipt) {
      return { status: "skipped", reason: "not_found" };
    }
    if (receipt.processing.state === "completed" && receipt.processing.latest_decision_id) {
      const stored = await (deps.loadDecisionResult ?? defaultLoadDecisionResult)(
        receipt.processing.latest_decision_id,
      );
      if (stored) {
        return { status: "processed", result: stored };
      }
    }
    const remaining = SYNC_POLL_DEADLINE_MS - (nowFn().getTime() - started);
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(syncPollBackoffMs(iteration), remaining));
    iteration += 1;
  }
  const receipt = await (deps.loadReceipt ?? defaultLoadReceipt)(receiptId);
  if (!receipt) {
    return { status: "skipped", reason: "not_found" };
  }
  if (receipt.processing.state === "completed" && receipt.processing.latest_decision_id) {
    const stored = await (deps.loadDecisionResult ?? defaultLoadDecisionResult)(
      receipt.processing.latest_decision_id,
    );
    if (stored) {
      return { status: "processed", result: stored };
    }
  }
  return {
    status: "accepted_for_processing",
    receipt_id: receiptId,
    state: receipt.processing.state,
    next_attempt_at: new Date(receipt.processing.next_attempt_at).toISOString(),
  };
}

function skippedSummary(trigger: DrainTrigger): DrainSummary {
  return {
    trigger,
    skipped: true,
    reason: "processing_disabled",
    scanned: 0,
    claimed: 0,
    completed: 0,
    retried: 0,
    dead_lettered: 0,
    recovered: 0,
    lease_lost: 0,
  };
}

function summarize(trigger: DrainTrigger, items: DrainItemResult[]): DrainSummary {
  const summary: DrainSummary = {
    trigger,
    skipped: false,
    scanned: items.length,
    claimed: 0,
    completed: 0,
    retried: 0,
    dead_lettered: 0,
    recovered: 0,
    lease_lost: 0,
  };
  for (const item of items) {
    if (item.status === "skipped") {
      continue;
    }
    if (item.status === "lease_lost") {
      summary.lease_lost += 1;
      continue;
    }
    summary.claimed += 1;
    if (item.recovered) {
      summary.recovered += 1;
    }
    if (item.status === "completed") {
      summary.completed += 1;
    } else if (item.status === "retry_scheduled") {
      summary.retried += 1;
    } else if (item.status === "dead_letter") {
      summary.dead_lettered += 1;
    }
  }
  return summary;
}

export async function emitDrainRunEvent(
  summary: DrainSummary,
  failed: boolean,
  deps: DrainerDeps = {},
): Promise<void> {
  const recordEvent = deps.recordEvent ?? defaultRecordEvent;
  const category = summary.trigger === "cron" ? "cron" : "queue";
  await recordEvent({
    level: failed ? "error" : "info",
    eventKey: failed
      ? `granot_lifecycle.${summary.trigger}.run.failed`
      : `granot_lifecycle.${summary.trigger}.run.completed`,
    category,
    summary: failed
      ? "Granot lifecycle drain run failed."
      : "Granot lifecycle drain run completed.",
    details: {
      trigger: summary.trigger,
      skipped: summary.skipped,
      scanned: summary.scanned,
      claimed: summary.claimed,
      completed: summary.completed,
      retried: summary.retried,
      dead_lettered: summary.dead_lettered,
      recovered: summary.recovered,
      lease_lost: summary.lease_lost,
    },
  });
}

export function applyDueGauges(input: {
  due_count: number;
  oldest_due_age_ms: number | null;
}): void {
  setGranotLifecycleQueueDue(input.due_count);
  setGranotLifecycleOldestDueSeconds(
    input.oldest_due_age_ms == null ? 0 : Math.floor(input.oldest_due_age_ms / 1000),
  );
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function unwrapWakeup(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "data" in payload) {
    const data = (payload as { data?: unknown }).data;
    if (data && typeof data === "object" && "receipt_id" in data) {
      return data;
    }
  }
  return payload;
}

function toSnapshot(row: {
  _id: mongoose.Types.ObjectId;
  captured_at: Date;
  observation_channel: string;
  payload_sha256: string;
  channel_operation_id?: string;
  initiator?: DurableActor;
  processing: ClaimedReceiptSnapshot["processing"];
}): ClaimedReceiptSnapshot {
  return {
    _id: row._id,
    captured_at: new Date(row.captured_at),
    observation_channel: row.observation_channel,
    payload_sha256: row.payload_sha256,
    channel_operation_id: row.channel_operation_id,
    initiator: row.initiator,
    processing: {
      ...row.processing,
      next_attempt_at: new Date(row.processing.next_attempt_at),
      leased_until: row.processing.leased_until
        ? new Date(row.processing.leased_until)
        : undefined,
      last_started_at: row.processing.last_started_at
        ? new Date(row.processing.last_started_at)
        : undefined,
      completed_at: row.processing.completed_at
        ? new Date(row.processing.completed_at)
        : undefined,
    },
  };
}

function applyClaimToSnapshot(
  previous: ClaimedReceiptSnapshot,
  owner: string,
  now: Date,
): ClaimedReceiptSnapshot {
  return {
    ...previous,
    processing: {
      ...previous.processing,
      state: "claimed",
      lease_owner: owner,
      leased_until: new Date(now.getTime() + LEASE_DURATION_MS),
      last_started_at: now,
      technical_attempts: previous.processing.technical_attempts + 1,
    },
  };
}

async function defaultClaimOne(
  filter: Record<string, unknown>,
  update: ReturnType<typeof buildClaimUpdate>,
): Promise<ClaimResult | null> {
  const previous = await getGranotObservationReceiptModel()
    .findOneAndUpdate(filter, update, { returnDocument: "before" })
    .lean();
  if (!previous) {
    return null;
  }
  const now = update.$set["processing.last_started_at"] as Date;
  const owner = update.$set["processing.lease_owner"] as string;
  const previousSnapshot = toSnapshot(previous);
  return {
    previous: previousSnapshot,
    claimed: applyClaimToSnapshot(previousSnapshot, owner, now),
    recovered: previous.processing.state === "claimed",
  };
}

async function defaultFindDueIds(
  now: Date,
  limit: number,
): Promise<mongoose.Types.ObjectId[]> {
  const rows = await getGranotObservationReceiptModel()
    .find(buildClaimFilter(now))
    .sort({ "processing.next_attempt_at": 1, captured_at: 1, _id: 1 })
    .limit(limit)
    .select({ _id: 1 })
    .lean();
  return rows.map((row) => row._id);
}

async function defaultRenewLease(
  id: mongoose.Types.ObjectId,
  owner: string,
  until: Date,
): Promise<boolean> {
  const result = await getGranotObservationReceiptModel().updateOne(
    buildFenceFilter(id, owner),
    { $set: { "processing.leased_until": until } },
  );
  return result.matchedCount === 1;
}

async function defaultFinalize(
  id: mongoose.Types.ObjectId,
  owner: string,
  update: Record<string, unknown>,
): Promise<boolean> {
  const result = await getGranotObservationReceiptModel().updateOne(
    buildFenceFilter(id, owner),
    update,
  );
  return result.matchedCount === 1;
}

async function defaultLoadReceipt(id: string): Promise<ClaimedReceiptSnapshot | null> {
  const row = await getGranotObservationReceiptModel().findById(id).lean();
  return row ? toSnapshot(row) : null;
}

async function defaultLoadDecisionResult(
  decisionId: mongoose.Types.ObjectId,
): Promise<ProcessorResult | null> {
  const decision = await getSynchronizationDecisionModel().findById(decisionId).lean();
  if (!decision) {
    return null;
  }
  return {
    observation_id: String(decision.observation_id),
    decision_id: String(decision._id),
    outcome: decision.outcome,
    effects: (decision.effects ?? []).map((effect) => ({
      kind: effect.kind,
      ref: effect.ref,
      changed_paths: effect.changed_paths,
    })),
    target: decision.target,
  };
}

async function defaultRecordEvent(input: {
  level: "info" | "warn" | "error";
  eventKey: string;
  category: "queue" | "cron" | "mongo";
  summary: string;
  details: Record<string, unknown>;
  entityId?: string;
}): Promise<void> {
  logger[input.level === "info" ? "info" : input.level]({
    msg: input.eventKey,
    ...input.details,
  });
  await emitGranotLifecycleEvent({
    level: input.level,
    eventKey: input.eventKey,
    category: input.category,
    workflow: "granot_lifecycle",
    summary: input.summary,
    details: input.details,
    entity: input.entityId
      ? { type: "granot_observation_receipt", id: input.entityId }
      : undefined,
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
