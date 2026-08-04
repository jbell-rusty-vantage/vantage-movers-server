import type { DurableActor, LeaseStore, LeaseToken } from "../durableWork";
import type { CanonicalDomainCommands } from "../domainCommands";

export type IngestionRunStatus =
  | "queued"
  | "inspecting"
  | "planning"
  | "awaiting_approval"
  | "applying"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "skipped";

export type IngestionRunTrigger =
  | "bootstrap"
  | "preview"
  | "manual"
  | "schedule"
  | "retry";

export const INGESTION_STATUS_GRAPH: Readonly<
  Record<IngestionRunStatus, readonly IngestionRunStatus[]>
> = Object.freeze({
  queued: ["inspecting", "failed", "skipped"],
  inspecting: ["planning", "failed", "skipped"],
  planning: ["awaiting_approval", "applying", "completed", "failed"],
  awaiting_approval: ["applying", "failed"],
  applying: ["completed", "completed_with_errors", "failed"],
  completed: [],
  completed_with_errors: [],
  failed: [],
  skipped: [],
});

export type IngestionClassification =
  | "unchanged"
  | "create"
  | "safe_update"
  | "leadless_booking"
  | "conflict"
  | "invalid"
  | "retryable_failure";

export type IngestionInspectionCheck = {
  key: string;
  status: "healthy" | "warning" | "blocking";
  summary: string;
  details?: Record<string, unknown>;
};

export type IngestionInspection = {
  healthy: boolean;
  checked_at: string;
  sources: Array<{
    role: "leads" | "booked";
    title: string;
    masked_id: string;
  }>;
  checks: IngestionInspectionCheck[];
};

export type IngestionInspectInput = {
  source_read_through: Date;
  repair_identity: boolean;
  lease?: LeaseToken;
};

export type IngestionReadInput = {
  source_read_through: Date;
  cutoff: Date;
  preview: boolean;
  lease?: LeaseToken;
};

export type IngestionPlanInput<TObservation> = {
  observations: readonly TObservation[];
  source_read_through: Date;
  cutoff: Date;
  run_id: string;
  trigger: IngestionRunTrigger;
};

export type IngestionApplyInput<TPlan> = {
  plan: TPlan;
  plan_checksum: string;
  run_id: string;
  connection_id: string;
  actor: DurableActor;
  initiator: DurableActor;
  lease: LeaseToken;
  commands: CanonicalDomainCommands;
};

export type IngestionApplyResult = {
  applied: number;
  already_applied: number;
  conflicts: number;
  failures: number;
};

export interface IngestionAdapter<TObservation, TPlan> {
  readonly key: string;
  readonly schemaVersion: number;
  inspect(input: IngestionInspectInput): Promise<IngestionInspection>;
  read(input: IngestionReadInput): AsyncIterable<TObservation>;
  plan(input: IngestionPlanInput<TObservation>): Promise<TPlan>;
  apply(input: IngestionApplyInput<TPlan>): Promise<IngestionApplyResult>;
}

export type IngestionKernelDependencies<TObservation, TPlan> = {
  adapter: IngestionAdapter<TObservation, TPlan>;
  leaseStore: LeaseStore;
  commands: CanonicalDomainCommands;
  now?: () => Date;
};
