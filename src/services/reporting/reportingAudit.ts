import type { DurableActor } from "../durableWork";
import { logger } from "../../logger";

export type ReportingAuditAction =
  | "preview"
  | "revision_create"
  | "archive"
  | "run_estimate"
  | "run_confirmation"
  | "run_queue"
  | "run_cancel"
  | "destination_create"
  | "destination_update"
  | "destination_verify"
  | "destination_archive"
  | "delivery_complete"
  | "delivery_failed"
  | "cleanup";

export type ReportingAuditInput = {
  action: ReportingAuditAction;
  outcome: "success" | "failure";
  actor: DurableActor;
  durationMs: number;
  definitionId?: string;
  revisionId?: string;
  runId?: string;
  destinationId?: string;
  datasetKey?: string;
  rowCount?: number;
  checksum?: string;
  reasonCode?: string;
};

export function buildReportingAuditDetails(
  input: ReportingAuditInput,
): Record<string, string | number> {
  const details: Record<string, string | number> = {
    action: input.action,
    outcome: input.outcome,
    actor_id: input.actor.actor_id,
    actor_type: input.actor.actor_type,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
  };
  for (const [key, value] of Object.entries({
    definition_id: input.definitionId,
    revision_id: input.revisionId,
    run_id: input.runId,
    destination_id: input.destinationId,
    dataset_key: input.datasetKey,
    row_count: input.rowCount,
    checksum: input.checksum,
    reason_code: input.reasonCode,
  })) {
    if (typeof value === "string" || typeof value === "number") {
      details[key] = value;
    }
  }
  return details;
}

export function recordReportingAudit(input: ReportingAuditInput): void {
  logger[input.outcome === "success" ? "info" : "warn"]({
    msg: `reporting.${input.action}.${input.outcome}`,
    workflow: "reporting_projection",
    ...buildReportingAuditDetails(input),
  });
}
