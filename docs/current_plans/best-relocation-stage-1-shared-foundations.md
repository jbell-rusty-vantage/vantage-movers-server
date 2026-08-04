# Best Relocation and Reporting — Stage 1 Shared Foundations

Status: implementation plan  
Source of truth: `docs/current_plans/best-relocation-ingestion-and-reporting-projection-spec.md`  
Default business timezone: `America/New_York`

Related implementation documents:

1. this document, `best-relocation-stage-1-shared-foundations.md`;
2. `best-relocation-stage-2-ingestion.md`;
3. `best-relocation-stage-3-reporting-core.md`;
4. `best-relocation-stage-4-google-delivery-and-rollout.md`.

These are exactly four implementation documents. If a later implementation discovery changes a source requirement, update the source specification and the affected document deliberately; do not create a fifth plan that silently supersedes one of these.

## 1. Objective

Build the shared implementation foundations that let Best Relocation ingestion and Reporting Projection execute as separate, durable Modules while using the same proven conventions for runs, leases, immutable checksums, checkpoints, actors, audits, queue wake-ups, and provider retries.

Stage 1 also extracts the canonical in-process domain-command seam required by ingestion and creates the operational-workbook safety registry required by reporting. It must leave two independently testable trust domains:

- ingestion reads non-canonical external observations with the operational Google service account and may mutate canonical Mongo data only through canonical commands;
- reporting reads canonical production Mongo data with owner-authorized permissions and writes non-canonical Google projections using owner OAuth.

The outcome is executable infrastructure and command interfaces, not merely shared types. Stages 2 and 3 must be able to consume the Stage 1 interfaces without recreating their own run lifecycle, actor, checksum, retry, workbook-safety, or canonical-write rules.

## 2. Dependency graph and concurrency rules

```text
Stage 1: shared foundations and canonical command seams
    ├──> Stage 2: Best Relocation ingestion
    └──> Stage 3: reporting core

Stage 2 workbook-safety registration ──┐
                                      ├──> Stage 4: Google delivery and rollout
Stage 3 reporting core ────────────────┘
```

Rules:

1. Stage 1 is merged before implementation begins on Stages 2 or 3.
2. Stages 2 and 3 may proceed in parallel after the Stage 1 handoff is accepted.
3. Stage 2 does not wait for reporting.
4. Stage 3 does not wait for Best Relocation activation or production dry runs.
5. Stage 4 requires:
   - the Stage 3 immutable definition/run/query interfaces; and
   - Stage 2's implemented registration of both Best Relocation input workbook IDs in the operational-workbook safety registry.
6. Stage 4 does not require scheduled ingestion to be activated. Workbook safety is a code/configuration contract, not an activation-state check.
7. No stage may begin the deferred historical/production database merge.

## 3. Scope

Stage 1 owns:

- shared vocabulary and reusable helpers for durable runs without combining ingestion and reporting records;
- atomic lease acquisition, renewal, ownership checks, expiry, and release conventions;
- canonical serialization and SHA-256 checksums for immutable plans, definition snapshots, previews, and output data;
- monotonic checkpoint and retry/resume rules;
- trusted owner/admin actor intake, dedicated system actors, initiator/executor snapshots, and audit envelopes;
- queue-as-wake-up behavior with Mongo as the durable source of work;
- provider error classification, bounded retry, quota deferral, and sanitized attempt accounting;
- the environment-gate versus mutable-owner-intent resolver contract;
- the operational-workbook registration and fail-closed reporting denylist interface;
- extraction of reusable in-process lead, booking, cancellation, and booking-reconciliation commands from the current v1/service implementation;
- preservation of request/domain validation, Operations Registry attribution and snapshots, booking import guards, transaction/outbox behavior, operational audit events, and Sheet Sync effects behind those commands;
- shared tests, fakes, and contract evidence needed by Stages 2–4.

## 4. Non-goals

Stage 1 does not implement:

- Best Relocation workbook parsing, cutoff enforcement, stable source-row IDs, receipts, matching, collapse, conflicts, bootstrap, dry-run planning, scheduling, ingestion persistence, or ingestion UI; those belong to Stage 2;
- reporting datasets, Mongo aggregations, definition/revision persistence, preview semantics, report-run persistence, or reporting UI; those belong to Stage 3;
- OAuth/Picker changes, reporting destinations, Google write/verify/promote behavior, replace-tab or snapshot delivery, live Google CI, or rollout; those belong to Stage 4;
- a generic ingestion designer, arbitrary schema mapper, arbitrary Mongo/query builder, or general workflow engine;
- a single shared run collection, source/destination record, permission model, credential, Google client, or worker for ingestion and reporting;
- historical database access, database union, pre-cutoff recurring ingestion, the future `2026-04-30` dashboard suppression default, or any part of the coordinated historical merge.

The existing Best Relocation migration pre-service remains intact until Stage 2 adapts it. Stage 1 may only change it where needed to call an extracted canonical command without importing adapter-specific policy into that command.

## 5. Architectural decisions

### 5.1 Separate Modules, shared conventions

Shared code is permitted; shared trust state is not.

- `IngestionRun`, ingestion leases/checkpoints, `SourceRowReceipt`, `IngestionConflict`, and `ExternalDataConnection` remain ingestion records.
- `ReportingRun`, reporting leases/checkpoints, `ReportingDefinitionRevision`, `ReportingDestination`, and `ReportingDelivery` remain reporting records.
- Each Module uses a dedicated queue consumer and queue topic.
- Each Module constructs its own Google client from its own identity:
  - ingestion: operational service account, narrowly scoped Sheets access to registered input workbooks;
  - reporting delivery: encrypted owner OAuth refresh token and least-privilege `drive.file` access.
- Google clients, tokens, workbook access grants, record repositories, and authorization middleware must not cross the Module seam.
- The shared foundation exports pure conventions and storage interfaces. Each Module supplies its own model-backed adapter.

Canonical-role classification is fixed:

- canonical: production Mongo business records and the domain invariants that mutate them;
- non-canonical evidence: external ingestion workbooks and their observations;
- non-canonical projections: generated reporting workbooks/tabs and operational Sheet Sync workbooks/tabs.

Neither a source workbook nor any Google projection may become business storage or a recovery source for canonical state.

### 5.2 Durable-run control interface

Stage-specific run models retain their own status enums and business counters. They embed the following shared control shape:

```ts
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
```

The shared transition helper has this interface:

```ts
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

export interface DurableRunStore<TStatus extends string> {
  transition(input: RunTransitionInput<TStatus>): Promise<
    | { applied: true }
    | { applied: false; reason: "status_mismatch" | "lease_lost" | "run_missing" }
  >;
}
```

Invariants:

1. Run creation and every status transition are durable.
2. The run status graph is declared by the owning Module and tested; callers cannot assign arbitrary statuses.
3. A transition out of a write phase requires the current lease token.
4. Terminal states are immutable except for append-only operational/audit metadata.
5. Counters are monotonic. A retry may continue counters; it may not reset evidence from prior attempts.
6. `source_read_through` is captured once per execution snapshot and never moves during resume.
7. Preview is read-only. A preview that needs to repair an ingestion identity is an inspection/write operation and must use the ingestion write lease.
8. Request handlers create/inspect runs and return promptly; workbook scans, canonical mutation, report queries, and Google deliveries execute in workers.

### 5.3 Lease interface and fencing

Reuse the atomic Mongo pattern in `SheetSyncLease` and `sheetSync/drainer/leases.ts`, adding renewal and fencing:

```ts
export type LeaseToken = {
  scope: string;
  owner: string;
  epoch: number;
  leased_until: Date;
};

export interface LeaseStore {
  acquire(input: {
    scope: string;
    owner: string;
    ttl_ms: number;
    now: Date;
  }): Promise<LeaseToken | null>;
  renew(input: {
    token: LeaseToken;
    ttl_ms: number;
    now: Date;
  }): Promise<LeaseToken | null>;
  release(input: { token: LeaseToken; now: Date }): Promise<boolean>;
  assertHeld(input: { token: LeaseToken; now: Date }): Promise<boolean>;
}
```

Invariants:

- acquisition is one atomic conditional upsert;
- `scope` has a unique index;
- acquisition of an expired lease increments `epoch`;
- renew/release/update filters include `scope`, `owner`, and `epoch`;
- a stale worker cannot checkpoint, transition, promote, or claim success after its lease is reclaimed;
- lease loss stops new side effects immediately and leaves the run resumable;
- lease TTL and renewal cadence are runtime guardrails, not owner-editable settings;
- ingestion and reporting use distinct scope namespaces and model-backed stores;
- only one applying Best Relocation run may hold the adapter write lease;
- reporting uses a run lease and a destination-scoped delivery lease so two runs cannot promote to the same managed destination concurrently.

### 5.4 Canonical checksum convention

All immutable checksums use:

```ts
export type ChecksumEnvelope<T> = {
  checksum_version: 1;
  artifact_kind:
    | "ingestion_plan"
    | "reporting_revision"
    | "reporting_preview"
    | "reporting_data";
  schema_version: number;
  payload: T;
};

export function canonicalJson(value: unknown): string;
export function computeChecksum<T>(envelope: ChecksumEnvelope<T>): string;
export function assertChecksum<T>(
  envelope: ChecksumEnvelope<T>,
  expected: string,
): void;
```

`computeChecksum` is lowercase hexadecimal SHA-256 over UTF-8 canonical JSON. Canonical JSON recursively sorts object keys, preserves array order, serializes dates as UTC ISO-8601 strings, rejects non-finite numbers/`undefined`/functions/symbols, and does not include volatile IDs, timestamps, lease fields, retries, or counters unless they are explicitly part of the immutable business artifact.

Rules:

- checksum version and owning schema version are always in the envelope;
- apply/run executes the exact persisted immutable artifact whose checksum was approved;
- checksum mismatch is structural and aborts before mutation or delivery;
- the reporting data checksum is calculated over deterministic ordered headers and normalized ordered rows;
- checksums are audit evidence, not authentication or authorization.

### 5.5 Checkpoints and exactly-once effects

Checkpoint updates use compare-and-set on `checkpoint.version` plus the active lease token.

1. A checkpoint version only increases.
2. A cursor describes the next unit of work, not merely the last unit read.
3. Canonical commands persist their idempotency outcome in the same transaction as the canonical mutation and outbox intents.
4. A worker checkpoints a canonical dependency unit only after the command transaction commits.
5. A reporting worker checkpoints a Google batch only after recording enough provider/artifact evidence to verify or safely replay it.
6. Resume re-reads the durable command/delivery outcome before attempting an effect.
7. Repeated triggers and queue messages are expected and harmless.
8. Row-level failures do not move a dependency cursor past work that has neither succeeded nor been durably classified.
9. Structural failure is fail-fast; isolated row failure may continue only where dependency ordering allows it.

### 5.6 Actor and audit conventions

Normalize all human and worker actions to:

```ts
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
```

The required ingestion executor is:

```text
actor_type: system
actor_id: best-relocation-ingestion
origin: external_sheet_ingestion
```

The reporting executor is a distinct system actor:

```text
actor_type: system
actor_id: reporting-projection
origin: reporting_projection
```

Rules:

- trusted owner/admin identity continues to come from signed admin proxy headers and existing authorization middleware;
- owner-only mutations remain owner-only; admins retain read-only visibility where the source specification grants it;
- a queued run snapshots the initiating human actor and later records the system executor; it never impersonates the owner;
- every mutation records actor, initiator, source/run provenance, timing, and outcome;
- business audit writes that are required for correctness share the domain transaction;
- operational events use `recordOperationalEvent` and are best-effort, sanitized, and non-transactional;
- credentials, secrets, tokens, raw source rows, report rows, and unrestricted PII never enter logs or audit metadata;
- retries reuse the original initiator snapshot and create a new attempt timestamp, not a fictional new owner action.

### 5.7 Queue and worker convention

Queue messages are wake-up signals:

```ts
export type DurableWorkWakeup = {
  kind: "ingestion_wakeup" | "reporting_wakeup";
  reason: "manual" | "schedule" | "retry" | "cron" | "recovery";
  run_hint: string | null;
};
```

- Mongo records own due state, idempotency, priority, leases, checkpoints, and outcomes.
- A queue payload never contains a plan, definition, credentials, row data, or authoritative status.
- Publishing uses an environment-scoped dedicated topic and idempotency key.
- Publishing is best-effort after durable work exists; failure is logged/observed but does not roll back committed business work.
- A cron heartbeat/safety net can wake due work after a lost publish.
- Consumers connect Mongo, acquire work through the owning repository, and ignore untrusted payload detail beyond the typed wake-up reason/hint.
- Ingestion and reporting have separate consumers/topics, guardrails, and leases.
- Workers stop before the serverless deadline, persist a checkpoint, release/defer, and issue a new wake-up rather than sleeping indefinitely.

### 5.8 Provider retry and quota convention

Expose one pure classifier and one policy calculator:

```ts
export type ProviderFailureClass =
  | "retryable_rate_limit"
  | "retryable_transient"
  | "authentication"
  | "authorization"
  | "not_found"
  | "invalid_request"
  | "structural"
  | "unknown";

export type RetryDecision =
  | { action: "retry"; delay_ms: number; failure_class: ProviderFailureClass }
  | { action: "defer"; not_before: Date; failure_class: ProviderFailureClass }
  | { action: "fail"; failure_class: ProviderFailureClass };

export function classifyGoogleFailure(error: unknown): ProviderFailureClass;
export function decideProviderRetry(input: {
  failure_class: ProviderFailureClass;
  attempt: number;
  retry_after_ms?: number;
  now: Date;
  deadline: Date;
  policy: ProviderRetryPolicy;
}): RetryDecision;
```

Policy:

- retry network interruptions, timeouts, HTTP `408`, `429`, and retryable `5xx`;
- honor a valid `Retry-After` value;
- otherwise use bounded exponential backoff with full jitter;
- cap attempts, individual delay, total elapsed time, and per-invocation work;
- defer instead of sleeping when quota or the invocation deadline would be exceeded;
- do not retry malformed requests, schema/capacity failures, forbidden access, or missing required files/tabs without an external state change;
- OAuth may refresh an expired access token once through the existing OAuth implementation; refresh-token failure is authentication failure, not an infinite retry;
- service-account and owner-OAuth quotas/counters are distinct;
- record request class, sanitized provider status, attempt count, delay/defer, and final classification, never token/body/row content;
- low-level quota/retry code may be reused from Sheet Sync, but neither ingestion nor reporting creates one `SheetSyncJob` per source/report row.

### 5.9 Environment gates versus mutable owner intent

Environment is for deployment capability, credentials, fixed code/config allowlists, and hard safety gates. Mongo application records are for mutable owner intent.

```ts
export type EffectiveCapability = {
  env_configured: boolean;
  env_enabled: boolean;
  owner_enabled: boolean;
  effective_enabled: boolean;
  reasons: readonly string[];
};

export function resolveEffectiveCapability(input: {
  required_configuration_present: boolean;
  deployment_gate: boolean;
  owner_intent: boolean;
}): EffectiveCapability;
```

Rules:

- `effective_enabled` is true only when required configuration is present, the deployment gate permits execution, and owner intent is active;
- owner/admin UI displays deployment state as read-only and cannot override a false gate;
- credentials and secrets are never copied to Mongo;
- ingestion cadence (`24 | 48` hours), active state, and `next_due_at` are application records;
- `BEST_RELOCATION_INGEST_ENABLED` defaults false and remains the ingestion hard gate;
- the Best Relocation cutoff is adapter code/version, not owner intent;
- reporting dataset contracts are code; `REPORTING_ENABLED_DATASETS` can only enable/disable code-defined contracts and cannot define joins, measures, columns, or filters;
- reporting definitions, revisions, and destination choices are owner intent;
- production-only restrictions and the historical-merge exclusion are code invariants, not dashboard toggles.

### 5.10 Operational-workbook registry and reporting denylist

Create one read-only code/config registry that answers whether a Google spreadsheet may be a reporting destination:

```ts
export type OperationalWorkbookPurpose =
  | "ingestion_source"
  | "sheet_sync_target"
  | "operational_projection";

export type OperationalWorkbookRegistration = {
  registration_key: string;
  purpose: OperationalWorkbookPurpose;
  env_key: string;
  required_in_production: boolean;
  owner_module: "best_relocation_ingestion" | "sheet_sync" | "operations";
  display_label: string;
};

export type ResolvedOperationalWorkbook = OperationalWorkbookRegistration & {
  spreadsheet_id: string;
};

export type DestinationSafetyResult =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | "OPERATIONAL_WORKBOOK"
        | "DENYLIST_INCOMPLETE"
        | "INVALID_SPREADSHEET_ID";
      matched_registration_key?: string;
      safe_message: string;
    };

export interface OperationalWorkbookRegistry {
  listResolved(): ResolvedOperationalWorkbook[];
  assertConfigurationComplete(): void;
  evaluateReportingDestination(spreadsheetId: string): DestinationSafetyResult;
}
```

Implementation rules:

1. Registrations are static code declarations that reference env-key names; Mongo and the dashboard cannot add an override.
2. Runtime resolution trims and normalizes exact Google spreadsheet IDs. Logs and health responses use labels and masked IDs.
3. Production fails closed with `DENYLIST_INCOMPLETE` when any required operational registration cannot be resolved.
4. Denylist matches are exact normalized file IDs, never names or URLs.
5. Stage 1 registers Master Leads, Master Booked, every configured source Sheet Sync target from `SHEET_CONTAINER_ENV_VARS`, and any other existing operational projection workbook.
6. Stage 2 contributes required registrations for:
   - `BEST_RELOCATION_SYNC_SHEET_ID`;
   - `BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID`.
7. `BACKFILL_*` aliases are never separate canonical registrations; Stage 2 resolves them only for deprecated CLI compatibility.
8. Stage 3 consumes the safety result in destination/revision validation contracts; Stage 4 rechecks it before destination save, preview confirmation, run creation, and each delivery.
9. There is no owner override in v1.
10. Ingestion activation state is irrelevant: a registered ingestion workbook is denied even when ingestion is disabled.

### 5.11 Canonical in-process domain-command seam

Workers must never call the deployment's public HTTP endpoints and must never write canonical Mongoose models directly.

Create an in-process command Module:

```ts
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

export type CanonicalCommandResult = {
  status: "applied" | "already_applied";
  entity_refs: readonly { model: string; id: string }[];
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
```

The implementation may export named functions rather than instantiate an object, but this is the complete external seam. Adapter-specific observations, matching evidence, allowlists, and conflicts do not enter it.

Command invariants:

1. Validate canonical DTOs through the same v1/domain validators used by HTTP callers.
2. Preserve Operations Registry source resolution, stable attribution keys, and label snapshots.
3. Preserve `bestRelocationImportGuard` behavior and make ingestion origin explicit.
4. Preserve duplicate/business guards, booking identity, agent allocation, merchant resolution, customer linkage, cancellation resolution, and reconciliation rules.
5. Preserve Mongo transaction and outbox semantics, including Sheet Sync intent persistence in the transaction and post-commit wake-up/finalization.
6. Preserve operational audit events with the durable actor/provenance envelope.
7. Use the existing canonical booking-reconciliation command to attach a leadless booking; do not add an ingestion-only attachment mutation.
8. A command is idempotent by `(origin, idempotency_key)`. Reuse with the same payload checksum returns `already_applied` and the original entity references. Reuse with a different checksum rejects as an idempotency conflict.
9. Persist the command outcome in the same transaction as canonical mutation/outbox intents. Add a small `DomainCommandExecution` model if no existing durable command ledger can satisfy this atomically.
10. HTTP handlers become adapters: authenticate/authorize, build an actor/context, invoke the same command, and translate the result/error. Existing HTTP behavior and response contracts must remain covered by regression tests.
11. Command code must not import Best Relocation parser/planner types, reporting types, Express requests/responses, or Google clients.
12. Stage 2 decides safe-update allowlists and three-way comparison before calling `updateSourceOwnedLead`; the command still validates the resulting patch and protects canonical invariants.

## 6. Work packages and reviewable PR order

### PR S1.1 — Shared execution vocabulary and pure policies

Implement:

- canonical JSON/checksum functions;
- durable actor types and system-actor factories;
- effective-capability resolver;
- structured run failure and provider failure classification;
- retry decision policy with injected clock/randomness for deterministic tests;
- queue wake-up types.

Acceptance:

- no model or provider dependency in pure policy modules;
- checksum fixtures are stable across object key order;
- secrets/PII are absent from all policy outputs.

### PR S1.2 — Lease, transition, and checkpoint stores

Implement:

- fenced lease store contract and Mongo helper;
- compare-and-set checkpoint/transition helpers;
- model mixin/schema helper or field-builder consumed by separate Module models;
- in-memory fakes used by contract tests;
- lease-loss and stale-epoch tests.

Do not create a polymorphic ingestion/reporting run collection.

### PR S1.3 — Operational-workbook safety registry

Implement:

- static registration interface;
- current Sheet Sync/Master workbook registrations;
- exact ID normalization and masking;
- production completeness assertion;
- destination safety evaluation;
- test helpers that let Stages 2 and 4 contribute registrations without mutating global process state.

Stage 2's two Best Relocation registrations remain a required handoff item, not an excuse for Stage 1 to import the ingestion adapter.

### PR S1.4 — Lead canonical commands

Extract form-lead and call-lead create/update command cores from HTTP-oriented code.

Preserve:

- validation and normalization;
- Operations Registry source attribution/CPL snapshots;
- duplicate behavior;
- transaction/outbox/Sheet Sync behavior;
- CRM/messaging side-effect policy already associated with the command;
- operational events.

Add command idempotency/provenance and make existing HTTP entry points delegate to the commands.

### PR S1.5 — Booking, cancellation, and reconciliation canonical commands

Extract booking-from-lead, leadless booking, cancellation, and booking attachment/reconciliation command cores.

Preserve:

- Best Relocation import guards;
- job-number and duplicate guards;
- agent allocation, merchant, customer, and warning behavior;
- booking/cancellation chain transactions and Sheet Sync intents;
- leadless booking semantics;
- reconciliation revision/conflict checks;
- operational events.

Existing admin/employee reconciliation origins remain distinguishable from `external_sheet_ingestion`.

### PR S1.6 — Integration contracts and handoff evidence

Add:

- command seam contract tests through both direct and HTTP adapters;
- shared-foundation test fixtures/fakes;
- example skeleton adapters for an ingestion run store and reporting run store proving record separation;
- generated/checked interface exports;
- a handoff evidence note linking tests, indexes, status graphs, and workbook registrations.

No Stage 2 or Stage 3 feature behavior is implemented in this PR.

## 7. Likely files

New shared foundation files:

- `src/services/durableWork/types.ts`
- `src/services/durableWork/checksum.ts`
- `src/services/durableWork/leases.ts`
- `src/services/durableWork/checkpoints.ts`
- `src/services/durableWork/runTransitions.ts`
- `src/services/durableWork/providerRetry.ts`
- `src/services/durableWork/capability.ts`
- `src/services/durableWork/testing.ts`
- `src/services/durableWork/index.ts`
- `src/services/operationalWorkbooks/registry.ts`
- `src/services/operationalWorkbooks/registrations.ts`
- `src/services/operationalWorkbooks/index.ts`
- `src/services/domainCommands/types.ts`
- `src/services/domainCommands/leads.ts`
- `src/services/domainCommands/bookings.ts`
- `src/services/domainCommands/cancellations.ts`
- `src/services/domainCommands/reconciliation.ts`
- `src/services/domainCommands/idempotency.ts`
- `src/services/domainCommands/index.ts`
- `src/models/DomainCommandExecution.ts` if required by the idempotency decision.

Existing server files likely to change:

- `src/services/leads/formLead.service.ts`
- `src/services/leads/callLead.service.ts`
- booking Modules under `src/services/bookings/`
- cancellation Modules under `src/services/cancellations/`
- reconciliation Modules under `src/services/reconciliation/`
- `src/services/agents/agentAllocation.service.ts`
- `src/services/bookings/bestRelocationImportGuard.ts`
- `src/services/sheetSync/sheetSyncCoordinator.ts`
- `src/services/sheetSync/sheetSyncQueue.service.ts`
- `src/services/sheetSync/drainer/leases.ts`
- `src/services/operationsRegistry/`
- `src/services/observability/`
- `src/config/domain/sheets.ts`
- relevant v1 route/service adapters and exports.

Patterns to reuse, not duplicate:

- `src/models/SheetSyncLease.ts`
- `src/models/SheetSyncRun.ts`
- `src/services/sheetSync/drainer/runSheetSyncDrain.ts`
- `src/services/sheetSync/drainer/quotaLimiter.ts`
- `src/routes/sheet-sync-cron.routes.ts`
- `api/queues/sheet-sync-consumer.ts`
- `src/services/operationsRegistry/trustedActor.ts`
- `src/services/operationsRegistry/registryAudit.ts`
- `src/services/observability/recordOperationalEvent.ts`
- `src/services/googleDriveOAuth/` for token encryption/owner restriction patterns only.

Stage 1 should not add or implement `IngestionRun`, `SourceRowReceipt`, `IngestionConflict`, `ReportingDestination`, `ReportingDefinition`, `ReportingRun`, or `ReportingDelivery`; their owning stages create those records using the Stage 1 contracts.

## 8. Test plan

### Pure policy tests

- canonical JSON recursively sorts keys and rejects unsupported values;
- checksum changes for business payload/schema/checksum version changes but not object insertion order;
- capability remains false if configuration, env gate, or owner intent is false;
- provider classifier covers network, `408`, `429`, `5xx`, authentication, authorization, not-found, invalid request, and structural errors;
- retry honors `Retry-After`, bounds jitter/delay/attempts, and defers near deadline.

### Lease and checkpoint contract tests

- concurrent acquisition yields one owner;
- expired lease is reclaimable with a larger epoch;
- only the current token renews/releases;
- stale workers cannot transition or checkpoint;
- checkpoint versions and counters cannot decrease;
- duplicate wake-ups converge on one write owner;
- lease loss leaves a resumable non-terminal run.

Run the same contract suite against in-memory fakes and Mongo adapters.

### Actor/audit tests

- signed owner/admin headers map to the durable actor shape;
- owner-only mutation rejects admin;
- worker audit contains distinct initiator and system executor;
- ingestion and reporting system actors/origins cannot be confused;
- sensitive metadata is redacted and raw rows/tokens never reach events.

### Operational-workbook tests

- Master Leads, Master Booked, and every configured Sheet Sync source/target ID are denied;
- missing required production registration fails closed;
- exact ID normalization prevents URL/whitespace bypass;
- same workbook name with a different ID is not a match;
- no owner override exists;
- disabled ingestion workbooks remain denied;
- Stage 2 registrations can be composed without coupling reporting to ingestion code.

### Canonical command tests

- direct command and HTTP adapter produce equivalent canonical results/errors;
- same idempotency key and checksum returns the original result without duplicate records/outbox work;
- same key with different checksum rejects;
- command ledger, canonical mutation, audit-required state, and Sheet Sync intents commit atomically;
- failed transaction leaves no successful command outcome;
- Registry attribution and snapshots remain present;
- booking import guards remain active;
- leadless booking creation and later attachment use canonical reconciliation;
- cancellation preserves booking/lead relationships;
- command modules have no Express, Google client, Best Relocation planner, or reporting imports.

### Separation tests

- ingestion and reporting stores use different model adapters/collections;
- ingestion and reporting queue message kinds/topics are not interchangeable;
- service-account factories are unavailable to reporting modules;
- owner-OAuth factories are unavailable to ingestion modules;
- report destinations cannot be accepted when operational-workbook configuration is incomplete.

## 9. Exit criteria

Stage 1 is complete only when:

1. all six work packages are merged in order;
2. the shared interfaces above are exported, documented, and contract-tested;
3. ingestion and reporting can each supply a distinct run/lease store adapter without sharing records;
4. checksum, checkpoint, lease fencing, queue wake-up, retry, actor, audit, and capability rules are executable code rather than conventions copied into later workers;
5. the operational-workbook registry denies all current operational workbooks and has an accepted extension contract for Stage 2's two inputs;
6. existing lead/booking/cancellation/reconciliation HTTP behavior passes regression tests through the extracted commands;
7. direct canonical commands are durably idempotent and preserve Registry, validation, import guard, transaction/outbox, audit, and Sheet Sync behavior;
8. no worker-facing command requires HTTP loopback or direct Mongoose access by its caller;
9. no ingestion/reporting Google identity, permission, token, record, queue, or client is shared;
10. lint, typecheck, focused tests, and the repository's relevant integration suite pass;
11. no historical database scope or pre-cutoff merge behavior has been introduced;
12. the Stage 1 handoff package below is accepted by the Stage 2 and Stage 3 implementers.

These criteria do not mean Part A or Part B is complete. Part A still requires Stage 2 ingestion activation evidence. Part B still requires Stages 3 and 4, including owner OAuth delivery and safe Google artifacts.

## 10. Explicit handoff contract

### 10.1 Artifacts Stage 2 must receive

- versioned exports for durable-run control, fenced leases, checkpoints, checksums, actors/audits, queue wake-ups, provider retry, and effective capability;
- direct canonical command exports and typed DTO/result contracts;
- idempotency behavior and test fixtures;
- operational-workbook registration interface;
- a required registration checklist for both Best Relocation workbook env keys;
- evidence that command execution preserves validation, Registry attribution, import guards, transactions/outbox, operational audit, and Sheet Sync.

Stage 2 accepts the handoff only if it can:

1. implement its own records and worker without altering shared semantics;
2. map a validated immutable plan to canonical commands without HTTP loopback/direct model writes;
3. retry a crash boundary without duplicate canonical effects;
4. register both input workbooks without granting reporting access to them.

Stage 2 rejects the handoff if any canonical mutation still requires an Express request, if command idempotency is non-durable, if source-specific policy leaked into shared commands, or if its workbook registrations can be owner-overridden.

### 10.2 Artifacts Stage 3 must receive

- immutable checksum/canonical-ordering utilities;
- separate reporting run-store adapter contract, checkpoint and lease contract, retry policy, queue convention, actor/audit envelope, and capability resolver;
- read-only operational-workbook safety interface and failure codes;
- proof that no ingestion record/client/permission is required to use these interfaces.

Stage 3 accepts the handoff only if it can model immutable definitions/runs and validate destination safety without importing the ingestion adapter or Google delivery implementation.

Stage 3 rejects the handoff if reporting must share ingestion records, queues, credentials, or service-account clients, or if workbook safety depends on ingestion being active.

### 10.3 Artifacts Stage 4 must receive

From Stage 1:

- provider retry/quota, lease/checkpoint, actor/audit, queue, and workbook-safety contracts.

Through Stage 2:

- executable registrations resolving both Best Relocation workbook IDs as `ingestion_source`;
- tests proving those IDs are denied whether ingestion is enabled or disabled.

Through Stage 3:

- immutable reporting revision/run contracts and production-only query output/checksum semantics.

Stage 4 rejects delivery enablement if any required operational registration is unresolved, if an owner can override the denylist, or if owner OAuth delivery can access ingestion service-account state.

### 10.4 Evidence package

The final Stage 1 PR links:

- public export paths and generated typecheck evidence;
- status-transition diagrams for the two example store adapters;
- lease/index definitions and concurrency test output;
- checksum fixtures;
- retry classification fixtures;
- command idempotency/transaction tests;
- HTTP-regression tests;
- resolved operational-workbook registration inventory with IDs masked;
- lint/typecheck/test commands and results.

### 10.5 Immutable after handoff

Later stages may extend stage-owned statuses, counters, adapter policies, datasets, and delivery details. They must not change these Stage 1 invariants without reopening this plan and the source specification:

- Mongo canonicality and production-only reporting scope;
- preview non-mutation;
- immutable approved artifact/checksum execution;
- actor/provenance/audit on every mutation;
- row number is not identity;
- retry/concurrency idempotency;
- separate source and destination records/permissions/Google identities;
- operational-workbook denylist with no owner override;
- leased durable background execution;
- env hard gates cannot be bypassed by owner intent;
- canonical writes use in-process domain commands, not HTTP loopback or caller-side Mongoose writes;
- historical/production merge remains deferred.

## 11. Source-section traceability

### Sections owned directly by Stage 1

- **§1 Purpose** — Objective and the ingestion/reporting trust split in §§1, 3, and 5.1.
- **§2 Explicitly deferred work** — Non-goals, dependency rules, exit criteria, and immutable handoff constraints in §§2, 4, 9, and 10.5.
- **§3 Shared architectural invariants** — Implemented across §§5.1–5.11 and locked in §10.5.
- **§4 Delivery sequence** — Converted into the four-stage dependency graph and concurrency rules in §2. Stage 2 may ship without reporting; Stages 2 and 3 run in parallel only after Stage 1.
- **§15 Canonical apply boundary** — Fully owned by §5.11 and PRs S1.4–S1.5, including validation, Registry, booking guards, transaction/outbox, audit, and Sheet Sync preservation.
- **§27 destination denylist portion** — The shared registration/evaluation interface is owned by §5.10; destination ownership and Google behavior remain Stage 4.
- **§29 durable execution conventions** — Shared lease/checkpoint/queue/retry/checksum behavior is owned by §§5.2–5.8; reporting query/write execution remains Stages 3–4.
- **§31 shared authorization/audit conventions** — Actor and audit foundations are owned by §5.6; reporting permissions/UI actions remain Stages 3–4.
- **§36 canonical command extraction and cross-Module server map** — Reflected in §§6–7.
- **§37 trusted admin actor/proxy patterns** — Reused in §§5.6 and 7; feature-specific admin files remain later stages.
- **§38 existing patterns** — Explicit reuse map in §7.
- **§39 global completion constraints** — Preserved in §9: Stage 1 is necessary but does not complete Part A or B, and authorizes no historical merge.

### Sections constrained by Stage 1 but implemented later

- **§5 current ingestion assets** — Stage 1 preserves the existing command behavior; Stage 2 retains/adapts parser, matching, planner, and CLI assets.
- **§6 source boundaries** — Stage 1 protects the fixed-cutoff-as-code rule; Stage 2 implements workbook/tab/cutoff/read-through behavior.
- **§7 environment contract** — Stage 1 owns env-versus-intent semantics and workbook registration; Stage 2 owns the exact ingestion env contract and service-account workbook access.
- **§8 generic ingestion kernel** — Stage 1 supplies shared execution primitives; Stage 2 implements the thin ingestion kernel and adapter.
- **§9 persistence model** — Stage 1 defines shared control contracts only; Stage 2 creates all ingestion records and indexes.
- **§§10–14 identity/bootstrap/planning/update/matching** — Entirely Stage 2, except that resulting writes must cross the Stage 1 command seam.
- **§§16–20 scheduler/failure/admin/alerts/tests** — Stage 2, using Stage 1 queue, retry, actor, audit, lease, and checkpoint conventions.
- **§21 reporting outcome** — Stages 3–4; Stage 1 enforces manual durable work and trust separation.
- **§22 Google identity/OAuth** — Stage 4; Stage 1 fixes owner OAuth versus ingestion service-account separation.
- **§§23–26 catalog/filter/timezone/persistence** — Stage 3; Stage 1 supplies immutable checksums, actors, runs, and production-only constraints.
- **§28 preview/revision workflow** — Stage 3 owns validation/revision/preview; Stage 4 owns Google destination verification/capacity details. Stage 1 guarantees preview non-mutation and checksum semantics.
- **§30 replace-tab staging/promotion** — Stage 4, guarded by Stage 1 destination leases, retry/checkpoint, and denylist conventions.
- **§32 reporting routes** — Stages 3–4, using Stage 1 actor/audit conventions.
- **§33 reporting admin UI** — Stages 3–4.
- **§34 alerts/retention** — Stages 3–4, using Stage 1 sanitized operational-event convention.
- **§35 reporting tests/acceptance** — Split between Stage 3 core semantics and Stage 4 Google delivery/live CI; Stage 1 supplies contract suites for lease/retry/checkpoint/checksum/authorization separation.

This traceability allocation is a scope boundary, not permission to weaken a later-stage requirement. The other three implementation documents must preserve every requirement delegated to them.
