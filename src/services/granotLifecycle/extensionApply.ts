import type { IncomingHttpHeaders } from "node:http";
import type { DurableActor } from "../durableWork/types";
import {
  EXTENSION_APPLY_ITEM_SCHEMA_HINT,
  type GranotApplyItem,
} from "./applyItem";
import {
  captureChannelOperationReceipt,
  type CaptureChannelOperationResult,
} from "./capture";
import { claimAndProcessOrPoll, type SyncClaimResult } from "./drainer";
import type { EntityRef, SynchronizationOutcome } from "./types";

export type ExtensionGranotApplyItem = GranotApplyItem;

export type ExtensionGranotApplyResult = {
  operation_id: string;
  receipt_id: string;
  processing_state: "completed" | "accepted_for_processing";
  observation_id?: string;
  decision_id?: string;
  outcome?: SynchronizationOutcome;
  target?: EntityRef;
  changed_paths: string[];
  message: string;
};

export type ApplyExtensionGranotItemInput = {
  item: ExtensionGranotApplyItem;
  initiator: DurableActor;
  headers: IncomingHttpHeaders | Record<string, unknown>;
  captured_at?: Date;
  request_id?: string;
};

export type ExtensionApplyDeps = {
  capture?: (
    input: Parameters<typeof captureChannelOperationReceipt>[0],
  ) => Promise<CaptureChannelOperationResult>;
  claimAndProcess?: (
    receiptId: string,
    initiator: DurableActor,
  ) => Promise<SyncClaimResult>;
};

const UPDATED_OUTCOMES = new Set<SynchronizationOutcome>([
  "created",
  "applied",
  "linked",
]);
const UNCHANGED_OUTCOMES = new Set<SynchronizationOutcome>([
  "already_current",
  "stale",
]);

const SAFE_MESSAGES: Record<SynchronizationOutcome | "accepted_for_processing", string> = {
  created: "Lead created from Granot evidence",
  applied: "Lead updated from Granot evidence",
  linked: "Lead linked from Granot evidence",
  already_current: "Already current",
  stale: "Older than accepted Granot evidence",
  pending_match: "Pending source-scoped match",
  unmatched: "No source-scoped match",
  ambiguous: "Ambiguous source-scoped match",
  conflict: "Non-syncable identity or evidence conflict",
  policy_blocked: "Blocked by source policy",
  deferred: "Deferred by source policy",
  insufficient_creation_data: "Insufficient data to create a Lead",
  invalid: "Invalid Granot statement",
  unsupported: "Unsupported Granot statement",
  accepted_for_processing: "Accepted for processing",
};

export function mapSynchronizationOutcomeMessage(
  outcome: SynchronizationOutcome | "accepted_for_processing",
): string {
  return SAFE_MESSAGES[outcome];
}

export function classifyCompatibilityFamily(
  outcome: SynchronizationOutcome,
): "updated" | "unchanged" | "review" {
  if (UPDATED_OUTCOMES.has(outcome)) return "updated";
  if (UNCHANGED_OUTCOMES.has(outcome)) return "unchanged";
  return "review";
}

export async function applyExtensionGranotItem(
  input: ApplyExtensionGranotItemInput,
  deps: ExtensionApplyDeps = {},
): Promise<ExtensionGranotApplyResult> {
  const capture = deps.capture ?? captureChannelOperationReceipt;
  const claimAndProcess =
    deps.claimAndProcess ??
    ((receiptId: string) => claimAndProcessOrPoll(receiptId));

  const captured = await capture({
    observation_channel: "browser_extension",
    authentication_method: "extension_session",
    channel_operation_kind: input.item.operation_kind,
    channel_operation_id: input.item.operation_id,
    captured_at: input.captured_at ?? new Date(),
    headers: input.headers,
    payload: input.item,
    initiator: input.initiator,
    request_id: input.request_id,
    payload_schema_hint: EXTENSION_APPLY_ITEM_SCHEMA_HINT,
  });

  const claimed = await claimAndProcess(captured.receipt_id, input.initiator);
  return translateClaimResult(input.item, captured.receipt_id, claimed);
}

function translateClaimResult(
  item: ExtensionGranotApplyItem,
  receiptId: string,
  claimed: SyncClaimResult,
): ExtensionGranotApplyResult {
  if (claimed.status === "processed") {
    const outcome = maybeConflictOutcome(item.expected_target, claimed.result.target, claimed.result.outcome);
    const changed_paths =
      outcome === claimed.result.outcome
        ? claimed.result.effects.flatMap((effect) => effect.changed_paths ?? [])
        : [];
    return {
      operation_id: item.operation_id,
      receipt_id: receiptId,
      processing_state: "completed",
      observation_id: claimed.result.observation_id,
      decision_id: claimed.result.decision_id,
      outcome,
      target: claimed.result.target,
      changed_paths,
      message: mapSynchronizationOutcomeMessage(outcome),
    };
  }

  return {
    operation_id: item.operation_id,
    receipt_id: receiptId,
    processing_state: "accepted_for_processing",
    changed_paths: [],
    message: mapSynchronizationOutcomeMessage("accepted_for_processing"),
  };
}

function maybeConflictOutcome(
  expected: ExtensionGranotApplyItem["expected_target"],
  actual: EntityRef | undefined,
  outcome: SynchronizationOutcome,
): SynchronizationOutcome {
  if (!expected || !actual) {
    return outcome;
  }
  if (
    (actual.model === "FormLead" || actual.model === "CallLead") &&
    (actual.model !== expected.model || actual.id !== expected.id)
  ) {
    return "conflict";
  }
  return outcome;
}
