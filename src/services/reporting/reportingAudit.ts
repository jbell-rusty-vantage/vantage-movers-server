import type { DurableActor } from "../durableWork";
import { recordOperationalEvent } from "../observability";

export type ReportingAuditAction =
  | "preview"
  | "revision_create"
  | "archive"
  | "run_estimate"
  | "run_confirmation"
  | "run_queue";

export type ReportingAuditInput = {
  action: ReportingAuditAction;
  outcome: "success" | "failure";
  actor: DurableActor;
  durationMs: number;
  definitionId?: string;
  revisionId?: string;
  runId?: string;
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

export async function recordReportingAudit(
  input: ReportingAuditInput,
): Promise<void> {
  await recordOperationalEvent({
    level: input.outcome === "success" ? "info" : "warn",
    eventKey: `reporting.${input.action}.${input.outcome}`,
    category: "admin",
    workflow: "reporting_projection",
    summary: `Reporting ${input.action} ${input.outcome}.`,
    details: buildReportingAuditDetails(input),
    runId: input.runId,
    entity: input.definitionId
      ? { type: "reporting_definition", id: input.definitionId }
      : undefined,
    notificationCandidate: false,
    reportable: false,
    ownerVisible: true,
    piiPolicy: "none",
  });
}
