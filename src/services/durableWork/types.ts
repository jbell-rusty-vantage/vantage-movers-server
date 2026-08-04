export type DurableCheckpoint = {
  version: number;
  phase: string;
  cursor: Record<string, string | number | boolean | null>;
  completed_units: number;
  updated_at: Date;
};

export type StructuredRunFailure = {
  code: string;
  class: "structural" | "row" | "provider" | "lease" | "cancelled";
  retryable: boolean;
  summary: string;
  phase: string;
  provider_status?: number;
};

export type DurableRunControl = {
  lease_owner: string | null;
  leased_until: Date | null;
  lease_epoch: number;
  checkpoint: DurableCheckpoint | null;
  attempt_count: number;
  last_attempt_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  failure: StructuredRunFailure | null;
};

export type LeaseToken = {
  scope: string;
  owner: string;
  epoch: number;
  leased_until: Date;
};

export type LeaseAcquireInput = {
  scope: string;
  owner: string;
  ttl_ms: number;
  now: Date;
};

export interface LeaseStore {
  acquire(input: LeaseAcquireInput): Promise<LeaseToken | null>;
  renew(input: {
    token: LeaseToken;
    ttl_ms: number;
    now: Date;
  }): Promise<LeaseToken | null>;
  release(input: { token: LeaseToken; now: Date }): Promise<boolean>;
  assertHeld(input: { token: LeaseToken; now: Date }): Promise<boolean>;
}

export type RunTransitionInput<TStatus extends string> = {
  run_id: string;
  expected_statuses: readonly TStatus[];
  next_status: TStatus;
  lease: LeaseToken;
  checkpoint?: DurableCheckpoint;
  counters?: Record<string, number>;
  failure?: StructuredRunFailure | null;
  now: Date;
};

export type RunTransitionResult =
  | { applied: true }
  | {
      applied: false;
      reason: "status_mismatch" | "lease_lost" | "run_missing";
    };

export interface DurableRunStore<TStatus extends string> {
  transition(input: RunTransitionInput<TStatus>): Promise<RunTransitionResult>;
}

export type DurableActor =
  | {
      actor_type: "owner" | "admin";
      actor_id: string;
      actor_label: string;
      actor_role: "owner" | "admin";
      request_id: string;
      origin: "vantage_admin";
    }
  | {
      actor_type: "system";
      actor_id: string;
      actor_label: string;
      actor_role: "system";
      request_id: string;
      origin: "external_sheet_ingestion" | "reporting_projection";
    };

export type DurableAuditEnvelope = {
  actor: DurableActor;
  initiator: DurableActor;
  run_id: string | null;
  command_id: string | null;
  source_receipt_id: string | null;
  occurred_at: Date;
};

export type DurableWorkWakeup = {
  kind: "ingestion_wakeup" | "reporting_wakeup";
  reason: "manual" | "schedule" | "retry" | "cron" | "recovery";
  run_hint: string | null;
};

export type ChecksumArtifactKind =
  | "ingestion_plan"
  | "reporting_revision"
  | "reporting_preview"
  | "reporting_data"
  | "reporting_draft"
  | "reporting_sample"
  | "reporting_destination_snapshot"
  | "reporting_destination_stable_identity"
  | "reporting_query_input"
  | "reporting_query_plan"
  | "reporting_page";

export type ChecksumEnvelope<T> = {
  checksum_version: 1;
  artifact_kind: ChecksumArtifactKind;
  schema_version: number;
  payload: T;
};

export type EffectiveCapability = {
  env_configured: boolean;
  env_enabled: boolean;
  owner_enabled: boolean;
  effective_enabled: boolean;
  reasons: readonly string[];
};

export type ProviderFailureClass =
  | "retryable_rate_limit"
  | "retryable_transient"
  | "authentication"
  | "authorization"
  | "not_found"
  | "invalid_request"
  | "structural"
  | "unknown";

export type ProviderRetryPolicy = {
  max_attempts: number;
  base_delay_ms: number;
  max_delay_ms: number;
  max_elapsed_ms: number;
  defer_delay_ms: number;
  started_at: Date;
  random?: () => number;
};

export type RetryDecision =
  | {
      action: "retry";
      delay_ms: number;
      failure_class: ProviderFailureClass;
    }
  | {
      action: "defer";
      not_before: Date;
      failure_class: ProviderFailureClass;
    }
  | { action: "fail"; failure_class: ProviderFailureClass };
