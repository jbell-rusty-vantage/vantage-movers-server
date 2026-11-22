import { OperationIdempotencyConflictError } from "./errors";
import { hashCredentialRedactedPayload } from "./receiptEvidence";
import { automationRunId, checkClosedOperation, readClosedRun } from "../granotHistory/closedAutomationRun";
import { connectMongo } from "../../db";
import type { DurableActor } from "../durableWork/types";
import {
  isPendingAutomationActionOutcome,
  type GranotAutomationLifecycleApply,
} from "../granotHttpCollector/lifecycleStatement";
import { AUTOMATION_APPLY_ITEM_SCHEMA_HINT } from "./applyItem";
import {
  captureChannelOperationReceipt,
  type CaptureChannelOperationResult,
} from "./capture";
import { claimAndProcessOrPoll, type SyncClaimResult } from "./drainer";
import type { SynchronizationOutcome } from "./types";
import { getGranotObservationReceiptModel } from "../../models/GranotObservationReceipt";
import { readRetiredOperation } from "../granotHistory/retiredRecords";

export type AutomationReplayState = { terminal: boolean; ready: boolean };

/** Read only: receipt clocks remain authoritative; bulk-check before polling old actions. */
export async function loadAutomationReplayStates(ids: string[], now: Date): Promise<Map<string, AutomationReplayState>> {
  if (!ids.length) return new Map();
  const rows = await getGranotObservationReceiptModel().find({ _id: { $in: ids } })
    .select({ _id: 1, processing: 1 }).lean().exec();
  return new Map(rows.map((row) => {
    const p = row.processing;
    const terminal = p.state === "completed" || p.state === "dead_letter";
    return [String(row._id), {
      terminal,
      ready: terminal || p.state === "dead_letter" || (+new Date(p.next_attempt_at) <= +now &&
        (p.state !== "claimed" || !p.leased_until || +new Date(p.leased_until) <= +now)),
    }];
  }));
}

export type GranotAutomationActionReceipt = {
  action_id: string;
  lifecycle_receipt_id: string;
  observation_id?: string;
  decision_id?: string;
  outcome: SynchronizationOutcome | "accepted_for_processing" | "technical_failure";
  applied_at: Date;
  error_code?: string;
  scheduled_direct?: true;
  outreach_refresh_completed?: boolean;
  /** Scheduled direct actions only: the bounded post-commit steps (they never fail the action). */
  post_commit?: ScheduledPostCommitOutcome;
};

/**
 * `done`/`timeout`/`failed` per the 2 s never-throw rule; a finished sibling update records its own outcome
 * (`updated`, or the skip reason from `callLeadFormSibling.ts`).
 */
export type ScheduledPostCommitOutcome = {
  lead_link_wake?: "done" | "timeout" | "failed";
  form_sibling?: string;
};

export type ApplyAutomationActionInput = {
  action_id: string;
  lifecycle_apply: GranotAutomationLifecycleApply;
  initiator: DurableActor;
  existing_receipt?: GranotAutomationActionReceipt;
  captured_at?: Date;
  request_id?: string;
};

export type AutomationApplyDeps = {
  capture?: (
    input: Parameters<typeof captureChannelOperationReceipt>[0],
  ) => Promise<CaptureChannelOperationResult>;
  claimAndProcess?: (receiptId: string) => Promise<SyncClaimResult>;
};

export async function applyAutomationPlanAction(
  input: ApplyAutomationActionInput,
  deps: AutomationApplyDeps = {},
): Promise<GranotAutomationActionReceipt> {
  if (
    input.existing_receipt &&
    isTerminalStoredReceipt(input.existing_receipt)
  ) {
    return input.existing_receipt;
  }

  if (!deps.capture && !deps.claimAndProcess) {
    const run = automationRunId(input.lifecycle_apply.operation_id);
    if (run) {
      await connectMongo();
      const db = getGranotObservationReceiptModel().db.db;
      if (!db) throw new Error("Granot replay database unavailable");
      const closed = await readClosedRun(db, run);
      if (closed) {
        const saved = checkClosedOperation(closed, input.lifecycle_apply, input.existing_receipt?.lifecycle_receipt_id);
        const hot = await getGranotObservationReceiptModel().exists({ _id: saved.receipt });
        if (hot) {
          const current = await claimAndProcessOrPoll(saved.receipt, { syncPollDeadlineMs: 0 });
          return translateClaimResult(input.action_id, saved.receipt, current);
        }
        return translateClaimResult(input.action_id, saved.receipt, { status: "processed", result: saved.result });
      }
    }
  }
  return applyOpenAutomationPlanAction(input, deps);
}

/** Resume a pre-cutover capture, including a crash between capture and the run checkpoint. */
export async function resumeCapturedAutomationAction(input: ApplyAutomationActionInput): Promise<GranotAutomationActionReceipt | null> {
  let id = input.existing_receipt?.lifecycle_receipt_id;
  if (!id) {
    const model = getGranotObservationReceiptModel();
    const row = await model.findOne({ observation_channel: "granot_http_automation",
      channel_operation_id: input.lifecycle_apply.operation_id }).select("_id channel_operation_kind payload_sha256").lean()
      ?? await readRetiredOperation(model.db.db!, "granot_http_automation", input.lifecycle_apply.operation_id);
    if (!row) return null;
    if (row.channel_operation_kind !== input.lifecycle_apply.operation_kind ||
        row.payload_sha256 !== hashCredentialRedactedPayload(input.lifecycle_apply).payload_sha256)
      throw new OperationIdempotencyConflictError(input.request_id);
    id = String(row._id);
  }
  return translateClaimResult(input.action_id, id, await claimAndProcessOrPoll(id, { syncPollDeadlineMs: 0 }));
}

/** The run worker has checked the active lease, expiry, and closed-run fence for this batch. */
export async function applyOpenAutomationPlanAction(input: ApplyAutomationActionInput, deps: AutomationApplyDeps = {}) {
  if (input.existing_receipt && isTerminalStoredReceipt(input.existing_receipt)) return input.existing_receipt;
  const capture = deps.capture ?? captureChannelOperationReceipt;
  const claimAndProcess = deps.claimAndProcess ?? ((id: string) =>
    claimAndProcessOrPoll(id, { syncPollDeadlineMs: input.existing_receipt ? 0 : undefined }));
  if (input.existing_receipt) {
    // The durable receipt already owns its original captured_at and operation.
    // Poll it directly; legacy plans need no reconstructed observation time.
    const claimed = await claimAndProcess(input.existing_receipt.lifecycle_receipt_id);
    return translateClaimResult(input.action_id, input.existing_receipt.lifecycle_receipt_id, claimed);
  }
  const item = input.lifecycle_apply;
  const captured = await capture({
    observation_channel: "granot_http_automation",
    authentication_method: "automation_owner_approval",
    channel_operation_kind: item.operation_kind,
    channel_operation_id: item.operation_id,
    captured_at: input.captured_at ?? new Date(),
    headers: {},
    payload: item,
    initiator: input.initiator,
    request_id: input.request_id,
    payload_schema_hint: AUTOMATION_APPLY_ITEM_SCHEMA_HINT,
  });

  const claimed = await claimAndProcess(captured.receipt_id);
  return translateClaimResult(input.action_id, captured.receipt_id, claimed);
}

export function translateAutomationClaimResult(
  actionId: string,
  lifecycleReceiptId: string,
  claimed: SyncClaimResult,
): GranotAutomationActionReceipt {
  return translateClaimResult(actionId, lifecycleReceiptId, claimed);
}

function translateClaimResult(
  actionId: string,
  lifecycleReceiptId: string,
  claimed: SyncClaimResult,
): GranotAutomationActionReceipt {
  if (claimed.status === "processed") {
    const outcome = claimed.result.outcome;
    if (isPendingAutomationActionOutcome(outcome)) {
      return {
        action_id: actionId,
        lifecycle_receipt_id: lifecycleReceiptId,
        observation_id: claimed.result.observation_id,
        decision_id: claimed.result.decision_id,
        outcome: "accepted_for_processing",
        applied_at: new Date(),
      };
    }
    return {
      action_id: actionId,
      lifecycle_receipt_id: lifecycleReceiptId,
      observation_id: claimed.result.observation_id,
      decision_id: claimed.result.decision_id,
      outcome,
      applied_at: new Date(),
    };
  }

  if (claimed.status === "accepted_for_processing") {
    if (claimed.state === "dead_letter") {
      return {
        action_id: actionId,
        lifecycle_receipt_id: lifecycleReceiptId,
        outcome: "technical_failure",
        applied_at: new Date(),
        error_code: "GRANOT_RECEIPT_DEAD_LETTER",
      };
    }
    return {
      action_id: actionId,
      lifecycle_receipt_id: lifecycleReceiptId,
      outcome: "accepted_for_processing",
      applied_at: new Date(),
    };
  }

  if (claimed.reason === "processing_disabled") {
    return {
      action_id: actionId,
      lifecycle_receipt_id: lifecycleReceiptId,
      outcome: "accepted_for_processing",
      applied_at: new Date(),
      error_code: "GRANOT_PROCESSING_DISABLED",
    };
  }

  return {
    action_id: actionId,
    lifecycle_receipt_id: lifecycleReceiptId,
    outcome: "accepted_for_processing",
    applied_at: new Date(),
    error_code: claimed.reason,
  };
}

function isTerminalStoredReceipt(
  receipt: GranotAutomationActionReceipt,
): boolean {
  return (
    receipt.outcome !== "accepted_for_processing" &&
    receipt.outcome !== "pending_match"
  );
}
