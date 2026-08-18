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

export type GranotAutomationActionReceipt = {
  action_id: string;
  lifecycle_receipt_id: string;
  observation_id?: string;
  decision_id?: string;
  outcome: SynchronizationOutcome | "accepted_for_processing" | "technical_failure";
  applied_at: Date;
  error_code?: string;
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

  const capture = deps.capture ?? captureChannelOperationReceipt;
  const claimAndProcess = deps.claimAndProcess ?? claimAndProcessOrPoll;
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
