import type {
  CreateBookedLeadInput,
  CreateCallLeadInput,
  CreateCancelledLeadInput,
  CreateFormLeadInput,
  CreateLeadlessBookingInput,
} from "../../validation/v1.validation";
import type { GranotAuthorizedLeadDesiredState } from "../granotLifecycle/authorizedDesiredState";
import type { CreateLeadFromGranotInput } from "../granotLifecycle/createLeadFromGranot";
import type { SynchronizeLeadExecution } from "../granotLifecycle/synchronizeLeadTypes";
import type { ObservationChannel } from "../granotLifecycle/types";
import type { DurableActor } from "../durableWork";

export type CommandOrigin =
  | "external_sheet_ingestion"
  | "vantage_admin"
  | "granot_lifecycle"
  | "ringcentral";

export type CanonicalCommandProvenance = {
  origin: CommandOrigin;
  run_id: string | null;
  source_receipt_id: string | null;
  source_connection_key: string | null;
  observation_id?: string | null;
  decision_id?: string | null;
  case_id?: string | null;
  discrepancy_id?: string | null;
  observation_channel?: ObservationChannel | null;
};

export type CanonicalCommandContext = {
  command_id: string;
  idempotency_key: string;
  payload_checksum: string;
  actor: DurableActor;
  initiator: DurableActor;
  provenance: CanonicalCommandProvenance;
};

export type CanonicalEntityReference = {
  model: string;
  id: string;
};

export type StoredCanonicalCommandResult = {
  status: "applied";
  entity_refs: readonly CanonicalEntityReference[];
  warnings: readonly string[];
};

export type CompatibilityCanonicalCommandResult = {
  status: "applied" | "already_applied";
  entity_refs: readonly CanonicalEntityReference[];
  warnings: readonly string[];
};

/** New executor semantics: stored/domain result is always `applied`. */
export type CanonicalCommandResult = StoredCanonicalCommandResult;

export type CanonicalCommandExecutionOutcome = {
  result: StoredCanonicalCommandResult;
  replayed: boolean;
};

export const VANTAGE_API_SECRET_ACTOR_ID = "vantage-api-secret";
export const VANTAGE_SCOPED_API_KEY_ACTOR_PREFIX = "vantage-scoped-api-key:";

export type CanonicalCommandOperationInput = {
  session: import("mongoose").ClientSession;
  now: Date;
  command_execution_id: import("mongoose").Types.ObjectId;
};

export type CanonicalCommandOperationEvidence = {
  entity_refs: Array<{ model: string; id: string }>;
  warnings?: string[];
};

export interface CanonicalDomainCommands {
  createFormLead(input: {
    data: CreateFormLeadInput;
    context: CanonicalCommandContext;
  }): Promise<CompatibilityCanonicalCommandResult>;
  createCallLead(input: {
    data: CreateCallLeadInput;
    context: CanonicalCommandContext;
  }): Promise<CompatibilityCanonicalCommandResult>;
  updateSourceOwnedLead(input: {
    lead_model: "FormLead" | "CallLead";
    lead_id: string;
    patch: Record<string, unknown>;
    context: CanonicalCommandContext;
  }): Promise<CompatibilityCanonicalCommandResult>;
  createBookingFromLead(input: {
    data: CreateBookedLeadInput;
    context: CanonicalCommandContext;
  }): Promise<CompatibilityCanonicalCommandResult>;
  createLeadlessBooking(input: {
    data: CreateLeadlessBookingInput;
    context: CanonicalCommandContext;
  }): Promise<CompatibilityCanonicalCommandResult>;
  attachBookingToLead(input: {
    booking_id: string;
    lead_model: "FormLead" | "CallLead";
    lead_id: string;
    expected_revision: number;
    context: CanonicalCommandContext;
  }): Promise<CompatibilityCanonicalCommandResult>;
  createCancellation(input: {
    data: CreateCancelledLeadInput;
    context: CanonicalCommandContext;
  }): Promise<CompatibilityCanonicalCommandResult>;
  createLeadFromGranot(
    input: CreateLeadFromGranotInput,
  ): Promise<CanonicalCommandResult>;
  synchronizeLeadFromGranot(input: {
    lead_ref: { model: "FormLead" | "CallLead"; id: string };
    expected_domain_revision: number;
    desired_state: GranotAuthorizedLeadDesiredState;
    context: CanonicalCommandContext;
    execution: SynchronizeLeadExecution;
  }): Promise<CanonicalCommandResult>;
}

export class DomainCommandIdempotencyConflictError extends Error {
  readonly code = "DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT";

  constructor() {
    super(
      "The idempotency key has already been used with a different command payload.",
    );
    this.name = "DomainCommandIdempotencyConflictError";
  }
}

export class DomainCommandContextError extends Error {
  readonly code = "INVALID_DOMAIN_COMMAND_CONTEXT";

  constructor(message: string) {
    super(message);
    this.name = "DomainCommandContextError";
  }
}

export class DomainRevisionConflictError extends Error {
  readonly code = "DOMAIN_REVISION_CONFLICT";

  constructor(message = "The expected domain revision no longer matches.") {
    super(message);
    this.name = "DomainRevisionConflictError";
  }
}

export const GRANOT_LIFECYCLE_PROCESSOR_ACTOR_ID =
  "granot-lifecycle-processor";
export const GRANOT_LIFECYCLE_PROCESSOR_ACTOR_LABEL =
  "Granot Lifecycle Processor";
export const GRANOT_WEBHOOK_INITIATOR_ID = "granot-webhook";
export const RINGCENTRAL_CALL_INGEST_ACTOR_ID = "ringcentral-call-ingest";

export const OWNER_COMMAND_IDEMPOTENCY_KEY_PATTERN =
  /^[\x21-\x7E]{8,200}$/;

export function assertOwnerCommandIdempotencyKey(value: string): void {
  if (value !== value.trim() || !OWNER_COMMAND_IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new DomainCommandContextError(
      "Idempotency-Key must be 8-200 printable characters with no leading or trailing whitespace.",
    );
  }
}

export function toCompatibilityCanonicalCommandResult(
  outcome: CanonicalCommandExecutionOutcome,
): CompatibilityCanonicalCommandResult {
  return {
    status: outcome.replayed ? "already_applied" : "applied",
    entity_refs: outcome.result.entity_refs,
    warnings: outcome.result.warnings,
  };
}
