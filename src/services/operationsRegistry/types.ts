import type { ClientSession } from "mongoose";
import type {
  RegistryChangeAction,
  RegistryChangeActorType,
  RegistryChangeEntityType,
} from "../../models/OperationsRegistryChange";
import type { ApprovedRegistryReadRole } from "./trustedActorCanonical";
import type { RegistryRuntimeTelemetry } from "./runtimeTelemetry";

export type RegistryActorContext = {
  actorType: RegistryChangeActorType;
  actorId: string;
  actorLabel: string;
  actorRole: ApprovedRegistryReadRole;
  requestId: string;
};

export type RegistryAuditInput = {
  entityType: RegistryChangeEntityType;
  entityId: string;
  action: RegistryChangeAction;
  reason?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
};

export type RegistryMutationInput<T> = {
  actor: RegistryActorContext;
  audit: RegistryAuditInput;
  mutate: (session: ClientSession) => Promise<T>;
  invalidateKeys?: string[];
};

export type RegistryOverviewCounts = {
  agents_total: number;
  agents_active: number;
  merchants_total: number;
  merchants_active: number;
  source_companies_total: number;
  source_companies_active: number;
  source_granularities_total: number;
  source_granularities_active: number;
  ringcentral_routes_total: number;
  ringcentral_routes_active: number;
  registry_changes_total: number;
};

export type RegistryOverviewResult = {
  generated_at: string;
  counts: RegistryOverviewCounts;
  signing: {
    secret_configured: boolean;
    preview_unsigned_allowed: boolean;
    signature_max_age_ms: number;
  };
  runtime: RegistryRuntimeTelemetry;
};

export type RegistryHealthSeverity = "info" | "warn" | "error";

export type RegistryHealthFinding = {
  code: string;
  severity: RegistryHealthSeverity;
  summary: string;
  entity_type?: string;
  entity_id?: string;
  first_observed_at: string;
  last_observed_at: string;
  actionable: boolean;
  evidence?: Record<string, string | number | boolean | null>;
  remediation?: {
    summary: string;
    action?: string;
  };
};

export type RegistryHealthResult = {
  generated_at: string;
  findings: RegistryHealthFinding[];
};

export type RegistryChangeListItem = {
  id: string;
  entity_type: RegistryChangeEntityType;
  entity_id: string;
  action: RegistryChangeAction;
  actor_type: RegistryChangeActorType;
  actor_id: string;
  actor_label: string;
  actor_role: string;
  request_id: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ListRegistryChangesResult = {
  items: RegistryChangeListItem[];
  page: number;
  limit: number;
  total: number;
  has_next_page: boolean;
};

export type ListRegistryChangesQuery = {
  entity_type?: RegistryChangeEntityType;
  entity_id?: string;
  actor_id?: string;
  action?: RegistryChangeAction;
  request_id?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
};

export type TransactionRunner = <T>(
  fn: (session: ClientSession) => Promise<T>,
) => Promise<T>;
