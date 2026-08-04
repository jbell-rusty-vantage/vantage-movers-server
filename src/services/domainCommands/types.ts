import type {
  CreateBookedLeadInput,
  CreateCallLeadInput,
  CreateCancelledLeadInput,
  CreateFormLeadInput,
  CreateLeadlessBookingInput,
} from "../../validation/v1.validation";
import type { DurableActor } from "../durableWork";

export type CanonicalCommandContext = {
  command_id: string;
  idempotency_key: string;
  payload_checksum: string;
  actor: DurableActor;
  initiator: DurableActor;
  provenance: {
    origin: "external_sheet_ingestion" | "vantage_admin";
    run_id: string | null;
    source_receipt_id: string | null;
    source_connection_key: string | null;
  };
};

export type CanonicalEntityReference = {
  model: string;
  id: string;
};

export type CanonicalCommandResult = {
  status: "applied" | "already_applied";
  entity_refs: readonly CanonicalEntityReference[];
  warnings: readonly string[];
};

export interface CanonicalDomainCommands {
  createFormLead(input: {
    data: CreateFormLeadInput;
    context: CanonicalCommandContext;
  }): Promise<CanonicalCommandResult>;
  createCallLead(input: {
    data: CreateCallLeadInput;
    context: CanonicalCommandContext;
  }): Promise<CanonicalCommandResult>;
  updateSourceOwnedLead(input: {
    lead_model: "FormLead" | "CallLead";
    lead_id: string;
    patch: Record<string, unknown>;
    context: CanonicalCommandContext;
  }): Promise<CanonicalCommandResult>;
  createBookingFromLead(input: {
    data: CreateBookedLeadInput;
    context: CanonicalCommandContext;
  }): Promise<CanonicalCommandResult>;
  createLeadlessBooking(input: {
    data: CreateLeadlessBookingInput;
    context: CanonicalCommandContext;
  }): Promise<CanonicalCommandResult>;
  attachBookingToLead(input: {
    booking_id: string;
    lead_model: "FormLead" | "CallLead";
    lead_id: string;
    expected_revision: number;
    context: CanonicalCommandContext;
  }): Promise<CanonicalCommandResult>;
  createCancellation(input: {
    data: CreateCancelledLeadInput;
    context: CanonicalCommandContext;
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
