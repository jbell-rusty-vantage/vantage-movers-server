# Granot Lead Lifecycle — final implementation specification

Date: 2026-08-14  
Status: final specification; ready for review and conversion into sequential issues  
Primary repository: `vantage-main-server`  
Participating repositories: `vantage-admin`, `granot_sync_extensions_and_services`

## 1. Purpose and authority

This document is the implementation contract for the Granot webhook-supported Lead, Booking, and Cancellation lifecycle. It is organized in delivery order so that each section can be converted into tracer-bullet issues without another product interview.

The decisions in `FINAL-PRE-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md` are locked and are incorporated here. That document supersedes older prototype assumptions; this specification supersedes older implementation sketches where names or behavior differ. In particular:

- `FormLead.ref_no` remains the value posted to Granot as `leadno`; Mongo `_id` is compatibility identity only.
- `lead_created` is controlled by Registry source policy and may create a Lead immediately when authorized.
- all valid Granot Priority values are stored; only `1` and `5` authorize broad enrichment and set `quoted = true`.
- `Booked` and `Release` are repeatable Granot Booking Actions, not Vantage state transitions.
- Booking Intake and Cancellation Intake are replaced by Booking Reconciliation and Release Reconciliation.
- an actual Booked action against an existing Booking opens review work.
- Granot never automatically creates, updates, cancels, or un-cancels a Booking.
- the RingCentral Call Log schedule becomes every 30 minutes only after lease and convergence protections are live.

No issue may reinterpret these decisions. A discovered code contradiction must be handled as an explicit compatibility migration, not as a reason to revert the domain decision.

## 2. Outcome, scope, and non-goals

### 2.1 Required outcome

Every accepted Granot webhook delivery, approved browser-extension apply operation, and approved HTTP-automation apply action must create a credential-redacted `GranotObservationReceipt` and pass through one channel-neutral processor. The processor preserves evidence, resolves Registry policy and identity, applies only authorized Lead changes through canonical commands, and promotes Booked/Release evidence into explicit, idempotent owner reconciliation.

### 2.2 In scope

- Granot webhook authentication, capture, normalization, durable processing, retry, dead-letter, and manual requeue.
- Granot source classification and deterministic Source Scope routing in the Operations Registry.
- Form and Call Lead identity, linking, Priority, authorized enrichment, Granot-created Lead creation, and provenance.
- RingCentral adoption of a qualifying call into a Granot-created Call Lead.
- Booking and Release reconciliation cases, discrepancies, owner commands, and current-state concurrency.
- Job Number and Lead lifecycle timelines in Vantage Admin.
- convergence of extension and HTTP-automation apply paths through the same receipt processor.
- extension version `0.2.8`.
- migrations, shadow processing, activation, feature gates, metrics, acceptance tests, rollout, and rollback.

### 2.3 Explicit non-goals

- full event sourcing or full Lead snapshots per change;
- a mutable lifecycle-status enum or generic lifecycle engine;
- automatic Booking, Booking update, Cancellation, or un-cancellation from Granot;
- a generic Intake Case or generic reconciliation model;
- a physical rename of `granot_webhook_receipts`;
- a new WordPress-submission collection;
- application-level field encryption or a raw-receipt purge policy;
- Paid Overflow effects or classification of a future real source named Auto;
- synchronous RingCentral API lookup during Granot processing;
- email in the initial owner workflow;
- parallel Mongoose models in `vantage-admin`.

### 2.4 Verified current-state migrations

| Current implementation | Required migration |
| --- | --- |
| `GranotWebhookReceipt` stores route payload/header evidence with legacy processing fields | evolve in place to the channel-neutral receipt and nested work state |
| webhook middleware removes body secret but capture has no payload hash/auth-method context | complete the security/evidence contract before processing |
| `GranotCrmSource` and `GranotAutomationSource` independently carry labels | make `GranotCrmSource` semantic authority and reference it from automation |
| `FormLead` has no Job Number, Ingestion Origin, immutable snapshots, Priority, or lifecycle revision | add fields/contextual validation and explicit backfills |
| `CallLead` has Job Number/RingCentral metadata but no persistent origin, Priority, Quoted, snapshots, or convergence state | add parity and adoption state without fabricating telephony evidence |
| extension and HTTP automation final apply mutate through patch/enrichment services | capture channel receipts and invoke the common processor |
| canonical commands have only sheet/admin origins and no Booking update command | extend command/provenance vocabulary and transaction ownership |
| Referral Booking cancellation is explicitly rejected | allow verified active Referral Booking cancellation without a Lead mirror |
| RingCentral Call Log cron is every two hours and state has no execution lease | add adoption/lease/telemetry, prove overlap safety, then move to 30 minutes |
| Admin has Granot Automation and Employee Booking reconciliation, but no Granot lifecycle queue/timeline | add distinct server projections and lifecycle UI |

## 3. Repository and branch contract

The delivery rule in `.cursor/rules/lead-lifecycle-delivery.mdc` is mandatory.

| Repository | Branch | Ownership |
| --- | --- | --- |
| `vantage-main-server` | one `lead-lifecycle` branch from current `main` | models, migrations, Registry, processor, queues/crons, canonical commands, admin routes |
| `vantage-admin` | one `lead-lifecycle` branch from current `main` | lifecycle timelines, case queues/details, owner forms, Registry UI |
| `granot_sync_extensions_and_services` | `main` | receipt-based apply integration and extension version `0.2.8` |

Do not create later per-slice feature branches. Check `git status --short` before the first edit in each repository. Do not commit, push, deploy, run production mutations, or send live customer payloads without separate user authorization.

## 4. Non-negotiable invariants

1. MongoDB is the System of Record.
2. A Granot Observation is evidence, not authority for official Booking or Cancellation facts.
3. Lead Lifecycle is composed from current facts; it is not stored as a lifecycle enum.
4. At most one Vantage Booking exists per normalized Job Number.
5. Only canonical domain commands mutate Leads, Bookings, or Cancellations.
6. Every post-activation aggregate mutation records causal provenance, an idempotent `DomainCommandExecution`, an `EntityChange`, an aggregate revision transition, and any Sheet Sync outbox intent in the same Mongo transaction.
7. No-op desired-state comparisons create neither `EntityChange` nor Sheet Sync work.
8. Source System, Observation Channel, Ingestion Origin, actor, and initiator are independent provenance axes.
9. Immutable creation/submission evidence is never overwritten by later Granot or RingCentral evidence.
10. Identity conflict never reassigns Source Company, Source Granularity, Ingestion Origin, or CPL.
11. Duplicate Form Leads are ineligible lifecycle targets. Bad Form Leads cannot be contact-matched, enriched, suggested, or booked by Granot; exact identity may only link evidence and store Priority.
12. A resolved reconciliation case is immutable and never reopened. A later same-kind Granot action creates the next sequence-numbered case.

## 5. Canonical language and aggregate boundaries

The canonical glossary is `C:/Users/Pinda/Proyectos/vantage/CONTEXT.md`. Implementation uses these exact terms:

- `GranotObservationReceipt`: durable, credential-redacted transport envelope.
- `GranotObservation`: one normalized point-in-time Granot statement.
- `SynchronizationDecision`: one explainable business decision for a processing attempt.
- `GranotRecordLink`: current normalized Job Number association to a Lead and Booking context.
- `GranotBookingAction`: normalized repeatable `booked` or `release` action.
- `GranotBookingReconciliationCase`: owner work to create a missing Booking or review the one existing Booking.
- `GranotReleaseReconciliationCase`: owner work for an active Booking offering Cancellation, Booking update, or No Action.
- `GranotBookingDiscrepancy` / `GranotReleaseDiscrepancy`: conflicting evidence requiring explicit review.
- `No Action`: case resolution without a Lead, Booking, or Cancellation mutation.
- `Ingestion Origin`: immutable server-assigned workflow that first created a Lead.

The new runtime module lives under `src/services/granotLifecycle/`. Routes pass IDs and commands into that module; they do not normalize payloads, select candidates, or build patches.

## 6. End-to-end architecture

```text
authenticated webhook | approved extension apply | approved automation action
        |
        v
GranotObservationReceipt (capture commits first)
        |
        +--> best-effort queue wake-up (receipt ID only)
        |
        v
GranotObservationProcessor
  normalize -> Registry policy -> identity -> temporal order -> desired state
        |
        +--> SynchronizationDecision (business outcome)
        +--> GranotRecordLink (safe identity evidence)
        +--> canonical Lead command -> EntityChange -> Sheet Sync outbox
        +--> Booking/Release reconciliation or discrepancy
```

Mongo is the durable work source. Queue delivery is only a wake-up. A queue consumer and a five-minute cron call the same drainer. Technical failures update receipt attempt state and do not fabricate business Decisions.

## 7. Shared TypeScript contracts

Place shared types in `src/services/granotLifecycle/types.ts` and shared Mongoose sub-schemas in `src/models/granotLifecycleSchemas.ts`.

```ts
export type ObservationChannel =
  | "granot_webhook"
  | "browser_extension"
  | "granot_http_automation";

export type GranotRouteEventClass =
  | "lead_created"
  | "priority_updated"
  | "booking_status_changed";

export type ChannelOperationKind =
  | "lead_snapshot_apply"
  | "booking_action_apply";

export type GranotObservationKind =
  | "lead_snapshot"
  | "booking_action_snapshot";

export type ReceiptWorkState =
  | "pending"
  | "claimed"
  | "retry_scheduled"
  | "completed"
  | "dead_letter";

export type NormalizationResult =
  | "valid"
  | "valid_with_issues"
  | "invalid"
  | "unsupported";

export type NormalizationIssueCode =
  | "payload_not_object"
  | "route_payload_event_conflict"
  | "missing_payload_event_type"
  | "unsupported_booking_action"
  | "invalid_source_label"
  | "missing_job_number"
  | "invalid_form_reference"
  | "invalid_phone"
  | "invalid_email"
  | "invalid_move_date"
  | "invalid_state"
  | "invalid_cubic_feet"
  | "invalid_priority"
  | "invalid_money"
  | "granot_agent_identity_conflict";

export type SynchronizationOutcome =
  | "created"
  | "applied"
  | "linked"
  | "already_current"
  | "stale"
  | "pending_match"
  | "unmatched"
  | "ambiguous"
  | "conflict"
  | "deferred"
  | "policy_blocked"
  | "insufficient_creation_data"
  | "invalid"
  | "unsupported";

export type SynchronizationReasonCode =
  | "lead_created_authorized"
  | "lead_state_changed"
  | "record_link_established"
  | "record_link_confirmed"
  | "desired_state_already_current"
  | "older_than_temporal_winner"
  | "pending_source_scoped_match"
  | "match_window_expired"
  | "multiple_eligible_matches"
  | "source_scope_conflict"
  | "job_number_conflict"
  | "record_link_conflict"
  | "duplicate_form_lead_ineligible"
  | "bad_form_lead_priority_only"
  | "source_unclassified"
  | "source_deferred"
  | "source_disabled"
  | "target_source_company_inactive"
  | "target_source_granularity_inactive"
  | "global_effect_disabled"
  | "shadow_effect_suppressed"
  | "creation_policy_link_only"
  | "creation_policy_observation_only"
  | "missing_creation_job_number"
  | "missing_creation_contact"
  | "missing_creation_route_data"
  | "invalid_payload"
  | "invalid_priority_update"
  | "unsupported_booking_action"
  | "booking_case_opened"
  | "booking_case_refreshed"
  | "release_case_opened"
  | "release_case_refreshed"
  | "booking_discrepancy_opened"
  | "booking_discrepancy_refreshed"
  | "release_discrepancy_opened"
  | "release_discrepancy_refreshed"
  | "booking_already_cancelled"
  | "historical_shadow";

export type ExecutionMode = "historical_shadow" | "live_shadow" | "live";
export type GranotBookingAction = "booked" | "release";
export type LeadModel = "FormLead" | "CallLead";

export type EntityRef = {
  model:
    | LeadModel
    | "BookedLead"
    | "CancelledLead"
    | "GranotRecordLink"
    | "GranotBookingReconciliationCase"
    | "GranotReleaseReconciliationCase";
  id: string;
};

export type GranotLifecycleDisposition =
  | "source_scoped_lead"
  | "referral_booking"
  | "deferred";

export type GranotLeadCreatedPolicy =
  | "link_only"
  | "create_if_missing"
  | "observation_only";

export type GranotDiscrepancyReasonCode =
  | "booked_record_link_conflict"
  | "booked_booking_lead_conflict"
  | "booked_job_number_conflict"
  | "booked_source_scope_conflict"
  | "booked_after_official_cancellation"
  | "release_without_vantage_booking"
  | "release_record_link_conflict"
  | "release_job_number_conflict"
  | "release_source_scope_conflict";
```

`DurableActor` gains system origins `granot_lifecycle` and `ringcentral`, and human origin `browser_extension` in addition to `vantage_admin`. Human actors remain server-authenticated Owner/Admin snapshots; extension data apply permits only an authenticated Owner. A webhook processor uses a system actor and system initiator. Extension and automation receipts preserve the authenticated human as initiator while the processor remains the command actor.

The processor actor is `{ actor_type:"system", actor_id:"granot-lifecycle-processor", actor_label:"Granot Lifecycle Processor", actor_role:"system", origin:"granot_lifecycle", request_id:<receipt id> }`. A webhook system initiator uses actor ID `granot-webhook`; RingCentral adoption uses `ringcentral-call-ingest`. No client supplies these snapshots.

## 8. Authoritative Granot source registry

### 8.1 `GranotCrmSource` additions

`GranotCrmSource` becomes the only semantic registry for a Granot source label. Add these fields to `src/models/GranotCrmSource.ts`:

```ts
normalized_granot_label: string; // NFKC, trim, collapse whitespace, lowercase
lifecycle_enabled: boolean;      // default false
lifecycle_disposition:
  | "source_scoped_lead"
  | "referral_booking"
  | "deferred";                  // default deferred
lead_created_policy:
  | "link_only"
  | "create_if_missing"
  | "observation_only";          // default observation_only
lead_source_company?: ObjectId;
lifecycle_routes: Array<{
  route_key: string;              // stable unique key inside the source
  lead_model: "FormLead" | "CallLead";
  move_type: "local" | "long_distance" | "any";
  source_granularity_id: ObjectId;
}>;
lifecycle_policy_version: string; // required when enabled
```

Required indexes:

```ts
{ normalized_granot_label: 1 } unique
{ lifecycle_enabled: 1, lifecycle_disposition: 1, normalized_granot_label: 1 }
{ "lifecycle_routes.source_granularity_id": 1 }
```

Validation rules:

- normalized labels cannot be empty or contain control/bidirectional characters;
- route keys are unique within a source;
- `source_scoped_lead` requires an active Source Company reference and at least one route;
- Call routing has exactly one `CallLead + any` route;
- Form routing is either one `FormLead + any` route or exactly one local plus one long-distance route;
- `referral_booking` and `deferred` have no Lead routes and use `observation_only`;
- `create_if_missing` is legal only for `source_scoped_lead`;
- ambiguous active route definitions fail validation and runtime resolution.

All writes go through trusted Operations Registry commands in `src/services/operationsRegistry/granotCrmSources.ts`. Add `granot_crm_source` to `OperationsRegistryChange.entity_type`. Registry mutation and audit insert share one transaction; cache invalidation occurs after commit.

### 8.2 Automation compatibility record

Add `granot_crm_source: ObjectId` to `GranotAutomationSource`. Existing label and supported-operation APIs remain during migration, but all semantic reads dereference `GranotCrmSource`. A missing/inactive/ambiguous reference makes the automation source unavailable for apply and visible with a compatibility error.

### 8.3 Initial classifications

Migration resolves by exact normalized label and reviewed aliases; it never guesses IDs.

| External label family | Disposition | Policy/routing |
| --- | --- | --- |
| `BestRelocation Inbounds` / reviewed spacing alias | `source_scoped_lead` | Call Lead; exact Best Relocation Call Granularity; `link_only` at migration, then audited `create_if_missing` at S13 |
| `BestRelocation Forms` / reviewed spacing alias | `source_scoped_lead` | Form Lead; same valid state -> Local Forms, different valid states -> long-distance Forms, invalid/missing states -> insufficient data; same policy rollout |
| `Referral` | `referral_booking` | no Lead creation or Lead selection |
| `Paid Overflow` | `deferred` | evidence only |
| payload `type = AUTO` | not a source | provider context only |
| future source label `Auto` | `deferred` | evidence only until separately approved |

The migration-safe initial `lead_created_policy` for both Best Relocation source families is `link_only`. S13 changes a reviewed route to `create_if_missing` through an audited Registry command immediately before that route's creation rollout; migration never silently enables creation.

The migration report must enumerate every unmatched or multiply matched `GranotCrmSource`, `GranotAutomationSource`, and active Source Granularity. Unmatched/ambiguous rows remain disabled/deferred.

### 8.4 Layered effect gates

An effect is allowed only when every applicable gate is true:

1. global feature flag for the effect;
2. receipt is post-activation and processor mode is `live`;
3. `GranotCrmSource.enabled` and `GranotCrmSource.lifecycle_enabled` are true;
4. disposition permits the effect;
5. Source Company is active;
6. selected Source Granularity is active;
7. Lead-created or reconciliation policy permits the effect.

Decisions persist a snapshot of all evaluated gate names and booleans. A disabled gate yields `policy_blocked`; deferred disposition yields `deferred`.

## 9. Receipt capture and security contract

### 9.1 In-place model evolution

Rename the application model/file to `GranotObservationReceipt` while retaining collection `granot_webhook_receipts`. During one compatibility release, export `getGranotWebhookReceiptModel` as a deprecated alias so current capture/tests do not break.

```ts
type GranotObservationReceiptDocument = {
  _id: ObjectId;
  source_system: "granot";
  observation_channel: ObservationChannel;
  captured_at: Date;
  route_event_class?: GranotRouteEventClass;
  channel_operation_kind?: ChannelOperationKind;
  authentication_method:
    | "body_secret"
    | "header_secret"
    | "extension_session"
    | "automation_owner_approval"
    | "legacy_unknown";              // backfilled historical receipts only
  evidence_version: 2;
  payload_kind: "object" | "array" | "null" | "primitive";
  payload_schema_hint?: string;
  headers: Record<string, string | string[]>;
  payload: unknown;                  // credential-redacted
  payload_sha256: string;            // lowercase 64-char hex
  channel_operation_id?: string;
  initiator?: DurableActor;
  processing: {
    state: ReceiptWorkState;
    technical_attempts: number;
    match_attempt: number;
    next_attempt_at: Date;
    lease_owner?: string;
    leased_until?: Date;
    last_started_at?: Date;
    last_error?: {
      code: string;
      message: string;               // PII-safe, max 500 chars
      failed_at: Date;
    };
    completed_at?: Date;
    latest_decision_id?: ObjectId;
    manual_requeue_count: number;
  };
  createdAt: Date;
  updatedAt: Date;
};
```

Indexes:

```ts
{ observation_channel: 1, channel_operation_id: 1 }
  unique, partialFilterExpression: { channel_operation_id: { $type: "string" } }
{ "processing.state": 1, "processing.next_attempt_at": 1, captured_at: 1 }
{ "processing.leased_until": 1 }
{ route_event_class: 1, captured_at: -1 }
{ payload_sha256: 1, captured_at: -1 } // diagnostic only, never unique
```

Evidence fields are write-once. Processing code uses allowlisted `$set/$inc/$unset` operations under `processing.*`; a model save must reject changes to evidence fields after insert.

`channel_operation_id`, when present, is 1-300 trimmed printable characters with no control/bidirectional characters. Extension values must be lowercase UUID v4; automation values must exactly equal `${run_id}:${action_id}`.

Receipt validation requires `route_event_class` and forbids `channel_operation_kind` for `granot_webhook`. It requires both `channel_operation_kind` and `channel_operation_id` for extension/automation receipts; those channels do not pretend to be webhook route deliveries.

### 9.2 Webhook authentication

The three existing webhook routes remain unchanged. `requireGranotWebhookSecret` must:

1. read `x-api-secret` from a header and/or scalar body field;
2. reject missing configuration with `500` and no receipt;
3. if both forms are present, require both to be equal and valid;
4. compare SHA-256 digests with `timingSafeEqual`;
5. delete the body credential before any capture, hash, log, error detail, or fixture;
6. attach only `body_secret` or `header_secret` to the request auth context;
7. return `401 { ok:false, code:"GRANOT_WEBHOOK_UNAUTHORIZED", error:"Unauthorized" }` on failure and create no receipt.

The exact stored header allowlist is `content-type`, `content-length`, `user-agent`, `x-request-id`, and `x-vercel-id`. Each value is truncated to 1,024 characters. Never store authorization, cookie, forwarding, API-secret, or arbitrary headers.

Hash the canonical credential-redacted JSON value using the existing `canonicalJson` helper and SHA-256. Identical webhook payloads remain distinct receipts.

### 9.3 Capture response

Capture must commit before returning:

```json
{
  "ok": true,
  "accepted": true,
  "event_type": "lead_created",
  "receipt_id": "..."
}
```

Return `202` after commit and attempt a best-effort queue publish containing only `{ "receipt_id": "..." }`. Publish failure is logged/metriced but does not change `202`. Capture failure returns `503` and creates no partial receipt.

### 9.4 Retention and reads

- no TTL in this release;
- no general raw-payload admin endpoint;
- lifecycle list/detail projections never include raw payloads or raw headers;
- normalized contact fields are masked in lists and role-gated in owner details;
- database-platform encryption at rest is assumed; app field encryption is deferred.

## 10. Observation normalization contract

`src/services/granotLifecycle/normalization.ts` owns all normalization. One receipt creates exactly one Observation using an upsert on `receipt_id`; reprocessing reuses it.

```ts
type GranotObservationDocument = {
  _id: ObjectId;
  receipt_id: ObjectId;              // unique
  schema_version: 1;
  kind: GranotObservationKind;
  normalization_result: NormalizationResult;
  route_event_class?: GranotRouteEventClass;
  payload_event_type_raw?: string;
  source_label_raw?: string;
  normalized_source_label?: string;
  granot_crm_source_id?: ObjectId;
  captured_at: Date;
  identity: {
    job_no_raw?: string;
    normalized_job_no?: string;
    form_ref_raw?: string;
    normalized_form_ref?: string;
  };
  contact: {
    first_name?: string;
    last_name?: string;
    display_name?: string;
    phone_raw?: string;
    normalized_phone?: string;
    email_raw?: string;
    normalized_email?: string;
  };
  move: {
    move_date_raw?: string;
    move_date?: Date;
    service_type_raw?: string;
    granot_move_size_raw?: string;
    estimated_cubic_feet_raw?: string;
    estimated_cubic_feet?: number;
    origin?: { city?: string; state?: string; zip?: string };
    destination?: { city?: string; state?: string; zip?: string };
  };
  priority: {
    raw?: unknown;
    canonical?: string;
    valid: boolean;
  };
  booking_action: {
    raw?: string;
    normalized?: GranotBookingAction;
  };
  display_money: {
    estimate?: { raw: string; canonical?: string };
    payment?: { raw: string; canonical?: string };
    balance?: { raw: string; canonical?: string };
  };
  agent_identity: { user_raw?: string; rep_raw?: string };
  provider_context: { type_raw?: string };
  issues: Array<{
    code: NormalizationIssueCode;
    path?: string;
    severity: "warning" | "error";
  }>;
  createdAt: Date;
  updatedAt: Date;
};
```

Indexes:

```ts
{ receipt_id: 1 } unique
{ kind: 1, captured_at: -1 }
{ "identity.normalized_job_no": 1, captured_at: -1 }
{ normalized_source_label: 1, route_event_class: 1, captured_at: -1 }
{ "identity.normalized_form_ref": 1, captured_at: -1 }
{ "contact.normalized_phone": 1, captured_at: -1 }
```

### 10.1 Normalization rules

- strings are Unicode NFKC, trimmed, and bounded; source labels additionally collapse internal whitespace and lowercase for lookup;
- Job Number uses the existing `normalizeJobNo`: Unicode NFKC, trim, replace each non-letter/digit run with one space, collapse whitespace, uppercase, and treat empty as absent;
- Form reference is trimmed; blank, `not provided`, and `not_provided` (case-insensitive) become absent and are never queried as exact identities;
- phone uses `normalizePhoneNumberForMatch`; email is trimmed/lowercased; state is an uppercase two-letter code or absent;
- move date accepts strict `MM/DD/YYYY` in the Vantage business timezone and is stored as the corresponding date; impossible dates add an error issue;
- cubic feet accepts a nonnegative finite integer; invalid values are omitted with an issue;
- display money accepts a nonnegative decimal with at most two fractional digits and stores a canonical decimal string; it is never domain input;
- raw `user` and `rep` values are preserved; normalization for Agent lookup occurs during policy evaluation.

### 10.2 Route/payload event rules

- non-object payload -> `invalid`;
- webhook routes derive Observation kind from route class; extension/automation receipts must provide a channel operation kind, where `lead_snapshot_apply` never authorizes create-if-missing and rejects a Booked/Release payload event, while `booking_action_apply` requires a supported Booking Action;
- `lead_created` route accepts absent or `lead_created` payload event type; absence is a warning; incompatible nonempty value is `invalid`;
- `priority_updated` route accepts absent, `priority_update`, or `priority_updated`; absence is a warning; incompatible nonempty value is `invalid`;
- `booking_status_changed` requires a supported action in payload `event_type`;
- case-insensitive `Booked` -> `booked`;
- case-insensitive exact `Releas` or `Release` -> `release`;
- all other well-formed booking action values, including `Released`, are `unsupported`; never infer by prefix.

### 10.3 Priority rules

Priority accepts either a JSON safe integer or a trimmed string matching `^[0-9]{1,12}$`. JSON numbers must be nonnegative safe integers. Canonical storage strips leading zeroes (`"05" -> "5"`, all-zero -> `"0"`). The exact raw value remains evidence.

- every valid canonical value is eligible to update `granot_priority`;
- only `1` and `5` authorize broad enrichment and set `quoted = true`;
- Granot never sets `quoted = false`;
- Priority Update with missing/malformed Priority is `invalid` and mutates nothing;
- Lead Created/Booked/Release with malformed Priority skips Priority effects but continues the independent event behavior with `valid_with_issues`.

## 11. Ordering, idempotency, and processing decisions

Granot supplies no trusted occurrence timestamp or revision. Ordering is therefore latest accepted Vantage `captured_at`; when times are equal, the lexicographically greater 24-character Observation ObjectId hex string wins as a stable tie-breaker. Store the winner on the Lead:

```ts
last_accepted_granot_observation: {
  observation_id: ObjectId;
  captured_at: Date;
}
```

An Observation older than the current winner is `stale` and cannot overwrite state. No channel outranks another.

The temporal winner is synchronization metadata, not a reportable domain fact. For a newer Observation whose authorized desired state is otherwise already current, insert the `already_current` Decision and atomically advance `last_accepted_granot_observation` in one transaction using a filter that accepts only an older `(captured_at, observation_id)` tuple; do not increment `domain_revision`, create `EntityChange`, or request Sheet Sync. When domain fields do change, advance the winner inside the canonical command transaction. This metadata rule reconciles stale-write protection with no-op desired-state idempotency.

If the temporal compare-and-swap matches zero rows, abort that proposed Decision/effect, reload the Lead, and re-evaluate; the losing Observation normally becomes `stale`. Never persist `applied` or `already_current` against a temporal claim it did not win.

Idempotency identities are:

- webhook: receipt identity only; identical deliveries are distinct evidence;
- extension: stable client-generated operation ID retained across retries;
- HTTP automation: `${run_id}:${action_id}`;
- operation ID reused with a different payload hash: `409 GRANOT_OPERATION_IDEMPOTENCY_CONFLICT` and no second receipt/effect;
- desired-state replay with a new receipt may yield `already_current` while preserving the Observation and Decision.

`SynchronizationDecision` uses one row per business attempt:

```ts
type SynchronizationDecisionDocument = {
  _id: ObjectId;
  observation_id: ObjectId;
  attempt: number;                    // unique per observation
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?:
    | "granot_record_link"
    | "form_ref_no_exact"
    | "form_mongo_id_compatibility"
    | "call_job_no_exact"
    | "booking_job_no_exact"
    | "source_scoped_contact";
  target?: EntityRef;
  source_scope?: {
    granot_crm_source_id: ObjectId;
    lead_source_company: ObjectId;
    source_granularity_id: ObjectId;
    disposition: GranotLifecycleDisposition;
    policy_version: string;
  };
  candidates: Array<{ target: EntityRef; reason_codes: string[] }>;
  evaluated_gates: Array<{ gate: string; allowed: boolean }>;
  effects: Array<{
    kind:
      | "record_link_established"
      | "record_link_confirmed"
      | "lead_created"
      | "lead_updated"
      | "booking_case_opened"
      | "booking_case_refreshed"
      | "release_case_opened"
      | "release_case_refreshed"
      | "discrepancy_opened"
      | "discrepancy_refreshed"
      | "sheet_sync_requested";
    ref?: EntityRef;
    changed_paths?: string[];
  }>;
  next_match_attempt_at?: Date;
  decided_at: Date;
};
```

Indexes:

```ts
{ observation_id: 1, attempt: 1 } unique
{ outcome: 1, decided_at: -1 }
{ "target.model": 1, "target.id": 1, decided_at: -1 }
{ "source_scope.granot_crm_source_id": 1, decided_at: -1 }
```

Candidate evidence contains IDs and reason codes only, not copied PII. Technical dependency failures remain receipt attempt errors and create no Decision.

## 12. Identity and Source Scope

Resolve source policy before contact fallback. Any exact identity that conflicts with known Source Scope is a hard `conflict`; it never becomes a warning or reassignment.

### 12.1 Form Lead ladder

1. active `GranotRecordLink` by normalized Job Number;
2. exact eligible non-duplicate `FormLead.ref_no` using Granot `ref_no`;
3. if that value is a valid ObjectId, exact eligible non-duplicate `FormLead._id` compatibility lookup;
4. exact Source Scope contact match using both submitted and accepted Granot contact states;
5. otherwise `pending_match`, `ambiguous`, `conflict`, or `unmatched`.

Exact `ref_no` or ObjectId resolution must still verify Source Company/Granularity eligibility. Duplicate Leads are excluded. Bad Leads are excluded except that strong exact identity may establish evidence and store Priority without clearing `bad_lead`; this exception does not authorize broad enrichment, a Booking suggestion, a Booking case, or Booking creation.

### 12.2 Call Lead ladder

1. active Record Link by normalized Job Number;
2. exact eligible `CallLead.normalized_job_no` in the resolved Source Granularity;
3. exact Source Granularity plus normalized phone using current phone and immutable original caller/ingestion phone;
4. otherwise pending/ambiguous/conflict/unmatched.

Never perform global contact matching across Source Scope.

### 12.3 Booking identity

Resolve the one Booking using normalized Job Number and the active Record Link. An existing Booking's Lead is deterministic owner context. If an existing Booking lacks a Lead, use the current `BookingLeadReconciliationCase`; do not duplicate that workflow. Referral Bookings are intentionally leadless.

## 13. Granot Record Link

`GranotRecordLink` is a current aggregate plus `EntityChange` history; it does not carry an unbounded correction array.

```ts
type GranotRecordLinkDocument = {
  _id: ObjectId;
  provider: "granot";
  normalized_job_no: string;
  job_no_snapshot: string;
  state: "active" | "superseded";
  lead_ref?: { model: LeadModel; id: ObjectId };
  booking_ref?: ObjectId;
  source_scope?: {
    lead_source_company: ObjectId;
    source_granularity_id: ObjectId;
  };
  disputed: boolean;
  dispute_reason?: string;
  established_by_decision_id: ObjectId;
  established_at: Date;
  last_observation_id: ObjectId;
  last_observed_at: Date;
  domain_revision: number;
  last_change_id?: ObjectId;
  last_changed_at?: Date;
  superseded_by?: ObjectId;
};
```

Indexes:

```ts
{ provider: 1, normalized_job_no: 1 }
  unique, partialFilterExpression: { state: "active" }
{ "lead_ref.model": 1, "lead_ref.id": 1, state: 1 }
{ booking_ref: 1, state: 1 }
```

Conflicting evidence marks the active link disputed but does not remove it from lookup. Owner correction requires a discrepancy/case ID, expected link revision, selected eligible Lead, reason text, idempotency key, and durable Owner actor. In one transaction it supersedes the old link, creates the replacement active link, records Entity Changes, and re-evaluates the discrepancy. It never changes the selected Lead's Source Scope.

## 14. Existing aggregate additions and provenance

### 14.1 Shared aggregate revision fields

Add to `FormLead`, `CallLead`, `BookedLead`, and `CancelledLead`:

```ts
domain_revision: number;              // required, default 0, min 0
last_change_id?: ObjectId;            // ref EntityChange
last_changed_at?: Date;
change_history_started_at?: Date;     // deployment boundary, not fabricated history
```

Every post-migration authoritative mutation uses a compare-and-swap filter on `domain_revision` and increments it once. `__v` may remain for Mongoose compatibility but is not the lifecycle API contract.

### 14.2 Ingestion Origin

Add immutable, server-assigned `ingestion_origin`:

```ts
type FormLeadIngestionOrigin =
  | "wordpress_form"
  | "granot_lead_created"
  | "best_relocation_sheet"
  | "vantage_admin"
  | "legacy_unknown";

type CallLeadIngestionOrigin =
  | "ringcentral"
  | "granot_lead_created"
  | "best_relocation_sheet"
  | "vantage_admin"
  | "legacy_import"
  | "legacy_unknown";
```

Clients cannot set this field on public create/patch schemas. Canonical create commands derive it from trusted command provenance. Existing trusted DTO fields named `ingestion_source` remain temporary compatibility input and are translated. Nested `ringcentral.ingestion_source = webhook | call_log_sync | manual` remains transport provenance.

Backfill only deterministic origins. Anything not provable becomes `legacy_unknown` and appears in a migration report. Later RingCentral adoption never changes `granot_lead_created`.

### 14.3 Lead field additions

Add to both Lead kinds unless stated otherwise:

```ts
job_no?: string;                      // add to FormLead; already on CallLead
normalized_job_no?: string;
granot_priority?: string;
granot_move_size?: string;
granot_service_type?: string;
ingested_contact_snapshot?: {
  first_name?: string;
  last_name?: string;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  email?: string;
  captured_at: Date;
  evidence_status: "captured_at_ingestion" | "legacy_baseline";
};
granot_contact_snapshot?: {
  first_name?: string;
  last_name?: string;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  email?: string;
  differs_from_ingested: boolean;
  observation_id: ObjectId;
  captured_at: Date;
};
current_contact_provenance?: {
  source_system: "vantage" | "granot" | "ringcentral";
  observation_id?: ObjectId;
  changed_at: Date;
};
current_move_provenance?: {
  source_system: "wordpress" | "granot" | "ringcentral" | "admin" | "legacy";
  observation_id?: ObjectId;
  changed_at: Date;
};
last_accepted_granot_observation?: {
  observation_id: ObjectId;
  captured_at: Date;
};
granot_contact_revision: number;       // default 0
last_granot_contact_change?: {
  observation_id: ObjectId;
  changed_at: Date;
  changed_paths: string[];             // bounded to the contact allowlist
  before_hash: string;
  after_hash: string;
};
```

Add `quoted: boolean` with default `false` to `CallLead`; Priority `1`/`5` then applies the same one-way Quoted rule to both Lead kinds.

Add to Form Lead only:

```ts
ingested_move_snapshot?: {
  pickup_city?: string;
  pickup_zip?: string;
  pickup_state?: string;
  delivery_city?: string;
  destination_zip?: string;
  delivery_state?: string;
  move_date?: Date;
  move_size?: string;
  captured_at: Date;
  evidence_status: "captured_at_ingestion" | "legacy_baseline";
};
```

Add to Call Lead only:

```ts
ringcentral_convergence?: {
  state: "pending" | "adopted" | "conflict" | "not_applicable";
  candidate_window_started_at?: Date;
  adopted_at?: Date;
  conflict_reason?: string;
  observation_id?: ObjectId;
};
```

Add `granot_username_match` to the receiver-agent source enum. Existing `extension_crm_username_match` remains readable but is not written by new lifecycle code.

Required Lead indexes:

```ts
// FormLead
{ normalized_job_no: 1 }
{ source_granularity_id: 1, normalized_job_no: 1 }
{ source_granularity_id: 1, normalized_phone_number: 1, duplicate: 1 }
{ ref_no: 1, duplicate: 1 }

// CallLead
{ source_granularity_id: 1, normalized_job_no: 1 }
{ source_granularity_id: 1, normalized_phone_number: 1, createdAt: -1 }
{ ingestion_origin: 1, source_granularity_id: 1,
  "ingested_contact_snapshot.normalized_phone_number": 1, createdAt: -1 }
```

Do not make Lead Job Number globally unique. The active Record Link and existing Booking unique index are the authoritative Job Number constraints.

### 14.4 Contextual validation

- ordinary WordPress Form Lead creation keeps its current required fields;
- make the persisted Form `move_size` path optional; ordinary WordPress/Admin/import Zod schemas still require it, while canonical `granot_lead_created` Form creation may omit it only when the Granot minimum-data contract below passes;
- ordinary RingCentral Call creation keeps phone/qualification requirements;
- canonical Granot Call creation may use Job Number without phone only when Registry policy and command provenance authorize it;
- public/admin patch schemas cannot modify snapshots, origin, Priority provenance, temporal winner, revision metadata, or convergence state;
- `post_to_granot = false` is mandatory for all Granot-created Leads.

## 15. Field authority and desired-state rules

| Field group | Granot authority |
| --- | --- |
| Job Number | fill missing and establish link; conflict never overwrites |
| `granot_priority` | every temporally accepted valid Priority |
| `receiver_agent` | any accepted Observation may fill empty through one active Agent username match |
| `quoted` | Priority `1`/`5` may set true; never false |
| Granot/current contact | Priority `1`/`5`, subject to origin policy |
| current location, move date, cubic feet | Priority `1`/`5`, subject to origin policy |
| `granot_move_size`, `granot_service_type` | Priority `1`/`5`; never overwrite Vantage `move_size` |
| Source Company, Source Granularity, Ingestion Origin, CPL | never reassigned after creation |
| Booking/Cancellation refs and official monetary/date facts | canonical owner commands only |
| Granot estimate/payment/balance | Observation/case display only |

### 15.1 WordPress-created Form Lead

- primary name/phone/email remain the submitted values;
- `ingested_contact_snapshot` and `ingested_move_snapshot` are captured in the original create transaction for all new Leads;
- qualified Granot contact is written only to `granot_contact_snapshot`;
- matching, search, and Booking Reconciliation show both submitted and Granot states;
- qualified Granot location/move date/cubic feet may become current operational fields while the immutable submission remains unchanged;
- derive `local` from the accepted current states;
- `move_size` remains the WordPress/Vantage value.

### 15.2 RingCentral-created Call Lead

- creation contact is immutable evidence and original caller phone remains in RingCentral metadata;
- qualified Granot contact and move facts become the current operational values;
- search/matching uses both current and immutable original contact;
- contact revision summary is bounded; complete history lives in `EntityChange`.

### 15.3 Granot-created Form or Call Lead

The creation snapshot is immutable, but no WordPress contact authority exists. Later qualified Granot contact/move statements may update current operational fields using the Call Lead policy.

### 15.4 Agent identity

- preserve raw `user` and `rep` in the Observation;
- equal normalized nonempty values are one assertion;
- different nonempty values yield `granot_agent_identity_conflict` and no assignment;
- a single username may fill an empty receiver at any valid Priority only when exactly one active Agent matches;
- never overwrite a receiver or create an Agent;
- the matched Agent is a display-only suggestion for Booking; official allocations require owner confirmation.

## 16. Lead Created policy

### 16.1 Matched-existing path

For an existing eligible Lead, Lead Created:

1. persists Receipt, Observation, and Decision;
2. resolves source/identity and establishes or confirms the Record Link;
3. fills a missing Lead Job Number; conflicting Job Number is `conflict`;
4. applies temporal, Priority, enrichment, and Agent rules;
5. requests Sheet Sync only when reportable Lead state changed;
6. never creates a second Lead.

Valid outcomes include `linked`, `applied`, `already_current`, `stale`, `ambiguous`, and `conflict`. Priority `5` also invokes Booking Reconciliation.

### 16.2 No-match behavior

| Registry policy | Behavior |
| --- | --- |
| `create_if_missing` | run the full identity ladder once; if no match, deterministic route, gates, and minimum data pass, create immediately |
| `link_only` | retry matching through 24 hours; never create; terminal `unmatched` |
| `observation_only`, deferred, or disabled | evidence only |
| missing immutable creation data | terminal `insufficient_creation_data`; a later complete Observation may create |
| transient dependency failure | technical retry; no business Decision |

Creation atomically reserves the active Record Link and uses command idempotency `granot:create-lead:<observation_id>`.

### 16.3 Minimum creation data

All Granot-created Leads require normalized Job Number, an enabled deterministic Registry route, and an active target scope.

Form Lead additionally requires:

- at least one of first name, last name, or display name;
- normalized phone;
- valid origin and destination state/ZIP sufficient to derive Move Type and exact Form Granularity.

Call Lead may be created from Job Number alone only through this authorized command. Store available facts without fabricating RingCentral duration, qualification, route, or session metadata.

## 17. RingCentral convergence and duplicate safety

For a RingCentral-facilitated source, Granot pre-creation must resolve one active Call Granularity and active RingCentral route assignment. Before creating, search exact Granularity + normalized phone:

- one eligible Lead -> link it;
- multiple -> `ringcentral_convergence_conflict`;
- none -> create and set convergence `pending` when phone exists, otherwise `not_applicable`.

The shared qualified-call ingest order becomes:

```text
telephony idempotency
  -> Granot-created Lead adoption
  -> business duplicate classification
  -> create only if adoption did not succeed
```

Adoption requires all of:

- exact Source Granularity;
- same normalized caller phone;
- `ingestion_origin = granot_lead_created`;
- no RingCentral session identity attached;
- Lead creation within 12 hours before or after the call start;
- exactly one candidate.

Successful adoption atomically attaches complete verified RingCentral metadata, immutable original caller evidence, qualification facts, processed-call ledger identity, and `state = adopted`. It retains Ingestion Origin and is not a business duplicate merely because the same physical call was adopted.

Duplicate classification then excludes the adopted Lead itself but may still mark it duplicate when a different qualifying Call Lead exists under the normal exact-Granularity, phone, and 90-day rule. Multiple candidates set convergence `conflict`; the qualified call continues through normal RingCentral duplicate classification/creation and is not discarded. Unresolved candidates alone cannot cause a false duplicate. Job-number-only Leads cannot be adopted.

Refactor the behavior behind `src/services/ringcentral/callLeadConvergence.service.ts`, called only by Granot canonical creation and `ringcentral-call-lead-ingest.service.ts`.

The Call Log state document gains a five-minute renewable lease:

```ts
lease_owner?: string;
leased_until?: Date;
lease_acquired_at?: Date;
last_runtime_ms?: number;
last_adopted_count?: number;
last_adoption_conflict_count?: number;
last_throttled_count?: number;
```

Claim filter is `key = account AND (leased_until missing OR <= now)`. Cursor advances only after full success. Keep the 12-hour rolling lookback. Change `vercel.json` to `*/30 * * * *` only after adoption, duplicate, overlap, and lease tests pass.

## 18. Booking and Release action semantics

- `booked` means a Rep performed Granot's Book action.
- `release` means a Rep released the job either to edit it or because the customer cancelled.
- one Job Number may have many Booked and Release actions.
- Priority is independent of Booking Action.
- Booking and Release cases may both be open and never auto-close each other.
- one open case exists per normalized Job Number and action kind; repeated same-kind actions refresh evidence, and a later action after resolution creates the next sequence.

## 19. Booking Reconciliation

Booking Reconciliation triggers from:

- Priority `5` on an eligible matched Lead; or
- an actual `booked` action.

Modes:

| Mode | Starting state | Owner paths |
| --- | --- | --- |
| `create_missing_booking` | no Booking; non-Referral | Confirm Granot Booking, No Action |
| `review_existing_booking` | actual Booked action and one Booking | Update Existing Booking, No Action |
| `create_referral_booking` | Referral Booked action and no Booking | Create Referral Booking, No Action |

Priority `5` alone does not open `review_existing_booking`. An existing Booking with official Cancellation produces a Booking Discrepancy for a Booked action.

Suggested Lead rules:

- Record Link, exact Form reference/ObjectId compatibility, or exact Call Job Number -> high confidence and may be preselected;
- Source Scope contact -> medium confidence, display only;
- ambiguity -> no suggestion;
- default search is Source Scope; Owner may search all eligible Leads;
- out-of-scope selection requires warning and nonempty override reason;
- explicit successful selection may correct the Record Link but never the Lead's Source Scope;
- background refresh may run for 24 hours but never selects or attaches.

Create-missing official fields start blank. Existing review starts from live Booking values. Granot move date, estimate, payment, balance, contact, source, or suggested Agent never prefill authoritative Booking fields.

## 20. Release Reconciliation

For an active matching Booking, a Release opens a case offering:

- Confirm Granot Cancellation;
- Update Existing Booking;
- No Action.

No Booking or conflicting link/Job/Source opens a Release Discrepancy. An already officially cancelled Booking yields `already_current` and no case. Granot never auto-cancels, reverses a Cancellation, or makes a Booking active again.

## 21. Reconciliation persistence contracts

### 21.1 Shared case subdocuments

```ts
type CaseState = "open" | "resolved";
type ActionKind = "booked" | "release";

type CaseEvidence = {
  observation_id: ObjectId;
  decision_id: ObjectId;
  captured_at: Date;
  action: "priority_5" | ActionKind;
};

type NoActionReasonCode =
  | "already_handled_elsewhere"
  | "granot_action_not_authoritative"
  | "wrong_customer_or_job"
  | "duplicate_granot_action"
  | "booking_still_valid"
  | "granot_change_only"
  | "insufficient_information"
  | "legacy_data"
  | "other";
```

`reason_code` and `reason_text` are independently optional, additive presentation/analytics metadata, and never business decision logic.

### 21.2 `GranotBookingReconciliationCase`

```ts
type GranotBookingReconciliationCaseDocument = {
  _id: ObjectId;
  normalized_job_no: string;
  job_no_snapshot: string;
  action_kind: "booked";
  sequence_number: number;
  mode:
    | "create_missing_booking"
    | "review_existing_booking"
    | "create_referral_booking";
  state: CaseState;
  case_revision: number;              // owner-relevant state/resolution
  evidence_revision: number;          // evidence refresh only
  source_scope?: {
    granot_crm_source_id: ObjectId;
    lead_source_company: ObjectId;
    source_granularity_id: ObjectId;
  };
  record_link_id?: ObjectId;
  deterministic_booking_id?: ObjectId;
  evidence: CaseEvidence[];           // append-only Observation/Decision refs
  observed_context: {
    contact?: { name?: string; phone_number?: string; email?: string };
    move_date?: Date;
    estimated_cubic_feet?: number;
    estimate?: string;
    payment?: string;
    balance?: string;
    granot_priority?: string;
    granot_username?: string;
  };
  suggested_lead?: {
    lead_ref: { model: LeadModel; id: ObjectId };
    confidence: "high" | "medium";
    match_method: string;
    reason_codes: string[];
  };
  resolution?: {
    outcome:
      | "booking_created"
      | "booking_updated"
      | "referral_booking_created"
      | "no_action"
      | "already_satisfied"
      | "superseded_by_current_state";
    command_execution_id: ObjectId;
    actor: DurableActor;
    reason_code?: NoActionReasonCode;
    reason_text?: string;
    resolved_at: Date;
    entity_ref?: EntityRef;
  };
  opened_at: Date;
  last_evidence_at: Date;
  resolved_at?: Date;
};
```

Indexes:

```ts
{ normalized_job_no: 1, action_kind: 1 }
  unique, partialFilterExpression: { state: "open" }
{ normalized_job_no: 1, action_kind: 1, sequence_number: 1 } unique
{ state: 1, last_evidence_at: -1 }
{ deterministic_booking_id: 1, state: 1 }
{ "suggested_lead.lead_ref.model": 1, "suggested_lead.lead_ref.id": 1, state: 1 }
```

### 21.3 `GranotReleaseReconciliationCase`

Use the same common fields and indexes, with:

```ts
action_kind: "release";
deterministic_booking_id: ObjectId;   // required
booking_revision_at_open: number;
resolution.outcome:
  | "cancellation_created"
  | "booking_updated"
  | "no_action"
  | "already_satisfied"
  | "superseded_by_current_state";
```

The Booking is never an owner-selectable dropdown.

### 21.4 Evidence refresh and revisions

Opening a case sets both revisions to `1`. A repeated same-kind action against an open case appends/deduplicates evidence by Observation ID, refreshes observed display context, increments `evidence_revision`, and does not change `case_revision`. Owner-relevant background changes increment `case_revision`. Owner forms submit only `expected_case_revision`; evidence arriving while the form is open does not stale it.

Case evidence IDs are append-only and deduplicated by Observation ID. They contain no copied payload/contact values. Complete normalized evidence remains in Observations/Decisions; do not remove earlier case trigger IDs.

### 21.5 Sequence allocation

Within a transaction, calculate `sequence_number = max(existing sequence for job+kind) + 1` and insert. Races are resolved by the unique index and one bounded retry. Resolved rows never return to open.

## 22. Discrepancies

Keep separate models with a shared shape:

```ts
type GranotDiscrepancyDocument = {
  _id: ObjectId;
  normalized_job_no: string;
  discrepancy_kind: "booking" | "release";
  reason_code: GranotDiscrepancyReasonCode;
  reason_fingerprint: string;         // SHA-256 of stable non-PII identity tuple
  state: "open" | "resolved";
  record_link_id?: ObjectId;
  lead_ref?: { model: LeadModel; id: ObjectId };
  booking_id?: ObjectId;
  cancellation_id?: ObjectId;
  evidence: CaseEvidence[];           // append-only Observation/Decision refs
  evidence_revision: number;
  revision: number;
  resolution?: {
    outcome: "re_evaluated" | "record_link_corrected" | "no_action";
    command_execution_id: ObjectId;
    actor: DurableActor;
    reason_code?: NoActionReasonCode;
    reason_text?: string;
    resolved_at: Date;
  };
  opened_at: Date;
  last_evidence_at: Date;
};
```

Indexes on each collection:

```ts
{ normalized_job_no: 1, discrepancy_kind: 1, reason_fingerprint: 1 }
  unique, partialFilterExpression: { state: "open" }
{ state: 1, last_evidence_at: -1 }
```

Booking reasons initially include:

```text
booked_record_link_conflict
booked_booking_lead_conflict
booked_job_number_conflict
booked_source_scope_conflict
booked_after_official_cancellation
```

Release reasons initially include:

```text
release_without_vantage_booking
release_record_link_conflict
release_job_number_conflict
release_source_scope_conflict
```

Do not create a discrepancy for a normal missing Booking under Priority 5/Booked, pending/ambiguous Lead matching, deferred policy, an already-cancelled Release, or a Booking missing its Lead. Discrepancies never mutate a Booking/Cancellation. Re-evaluation may resolve the discrepancy and open normal reconciliation.

## 23. Canonical commands, provenance, and transactions

### 23.1 `DomainCommandExecution` evolution

Extend `CanonicalCommandContext.provenance.origin` and the Mongoose enum to:

```ts
type CommandOrigin =
  | "external_sheet_ingestion"
  | "vantage_admin"
  | "granot_lifecycle"
  | "ringcentral";
```

Add typed causal fields while retaining existing compatibility fields:

```ts
provenance: {
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
result: {
  status: "applied";
  entity_refs: Array<{ model: string; id: string }>;
  warnings: string[];
};
```

The existing unique `(origin, idempotency_key)` remains. Replaying the same command name and payload checksum returns the stored result. A different checksum or command name yields `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`.

Context validation for `granot_lifecycle` requires the fixed processor system actor, complete receipt/Observation/Decision provenance, and either the fixed webhook system initiator or a trusted authenticated Owner from `browser_extension`/`vantage_admin`. Context validation for `ringcentral` requires the fixed RingCentral system actor/initiator and verified telephony provenance. Existing external-ingestion/admin rules remain unchanged.

### 23.2 Command executor transaction contract

Refactor `executeIdempotentCanonicalCommand` so it owns one Mongo transaction and passes `{ session, now }` into the operation. The operation must persist:

1. the preallocated `SynchronizationDecision` carrying this effect;
2. aggregate changes guarded by expected `domain_revision`;
3. `EntityChange` rows;
4. `DomainCommandExecution`;
5. reconciliation/discrepancy/link resolution state, when applicable;
6. Sheet Sync outbox intent.

External Sheets, queue publish, email, and CRM calls run only after commit. Existing domain services must expose transaction-bound internal functions rather than starting nested transactions. Current public routes continue through canonical adapters; no direct route/model mutation remains after the canonicalization slice.

The processor allocates the Decision ObjectId before invoking a command so every causal reference is stable. An effect-bearing Decision is inserted in the same transaction as its effect. A no-effect business outcome inserts its Decision alone. A dependency/transaction failure inserts no business Decision and remains a technical receipt attempt failure.

All Mongo effects summarized by one Observation attempt—Record Link change, Lead command, case/discrepancy open or refresh, Decision, Entity Change, command evidence, and outbox intent—commit atomically as one lifecycle transaction. The implementation may compose internal services, but it must not expose a partially applied Decision whose later listed effect failed.

One concurrent owner command wins because the case update filter includes `_id`, `state:"open"`, and `case_revision`, while the aggregate update includes `domain_revision`. A losing request returns `409 GRANOT_CASE_REVISION_CONFLICT` or `409 DOMAIN_REVISION_CONFLICT`. If current live state already satisfies the winning intent, the transaction resolves the case as `already_satisfied` without another domain mutation.

Required compare-and-swap filters are explicit:

```ts
// Lead synchronization
{ _id: lead_id, domain_revision: expected_lead_revision }

// Existing Booking update/review
{
  _id: booking_id,
  domain_revision: expected_booking_revision,
  normalized_job_no: case.normalized_job_no,
  $or: [{ cancelled: null }, { cancelled: { $exists: false } }],
}

// Cancellation creation first claims the active Booking
{
  _id: booking_id,
  domain_revision: expected_booking_revision,
  normalized_job_no: case.normalized_job_no,
  $or: [{ cancelled: null }, { cancelled: { $exists: false } }],
}

// Case resolution
{
  _id: case_id,
  state: "open",
  case_revision: expected_case_revision,
}
```

Creation commands rely on the active Record Link and Booking normalized-Job unique indexes as final race guards. A duplicate-key race is re-read: identical desired state returns the stored/idempotent result; different identity becomes a conflict.

### 23.3 `EntityChange`

```ts
type EntityChangeDocument = {
  _id: ObjectId;
  entity: EntityRef;
  command_execution_id: ObjectId;
  command_name: string;
  provenance: {
    source_system: "vantage" | "granot" | "ringcentral";
    observation_channel?: ObservationChannel;
    actor: DurableActor;
    initiator: DurableActor;
    receipt_id?: ObjectId;
    observation_id?: ObjectId;
    decision_id?: ObjectId;
    case_id?: ObjectId;
    discrepancy_id?: ObjectId;
    run_id?: string;
    request_id?: string;
  };
  changed_paths: string[];
  fields: Array<{
    path: string;
    value_mode: "stored" | "hashed" | "reference_only";
    before?: unknown;
    after?: unknown;
    before_hash?: string;
    after_hash?: string;
  }>;
  revision_before: number;
  revision_after: number;
  applied_at: Date;
};
```

Indexes:

```ts
{ "entity.model": 1, "entity.id": 1, revision_after: 1 } unique
{ command_execution_id: 1 }
{ "entity.model": 1, "entity.id": 1, applied_at: -1 }
{ changed_paths: 1, applied_at: -1 }
```

Store low-risk relationship/lifecycle values (`quoted`, Priority, cubic feet, Agent ID, Booking/Cancellation refs, official amounts/dates). Contact/address changes are `reference_only` in the first release; the Observation and current aggregate remain the protected evidence. Never copy full documents, raw payloads, secrets, or unmasked contact into `EntityChange`.

### 23.4 New/extended canonical commands

Add to `CanonicalDomainCommands`:

```ts
synchronizeLeadFromGranot(input: {
  lead_ref: { model: LeadModel; id: string };
  expected_domain_revision: number;
  desired_state: GranotAuthorizedLeadDesiredState;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult>;

createLeadFromGranot(input: {
  lead_model: LeadModel;
  source_scope: {
    lead_source_company: string;
    source_granularity_id: string;
  };
  observation_id: string;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult>;

updateBooking(input: {
  booking_id: string;
  expected_domain_revision: number;
  official_booking_details: OfficialBookingDetails;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult>;

createReferralBooking(input: {
  normalized_job_no: string;
  accepted_observation_id: string;
  official_booking_details: OfficialBookingDetails;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult>;

establishGranotRecordLink(...): Promise<CanonicalCommandResult>;
correctGranotRecordLink(...): Promise<CanonicalCommandResult>;
```

Canonicalize the existing referral service and all current Booking/Cancellation adapters. Granot reconciliation never calls `BookedLead`, `CancelledLead`, or Lead models directly.

## 24. Owner command input contracts

All owner command Zod schemas are strict and live in `src/validation/v1/granotLifecycle.validation.ts`. The service command always contains `case_id`; HTTP obtains it from the route parameter and rejects a conflicting body field rather than requiring clients to repeat it. Bodies require `expected_case_revision`, and every request requires an idempotency key header `Idempotency-Key` (8-200 printable characters with no leading/trailing whitespace). The server derives actor/initiator from trusted admin authentication and computes the payload checksum.

```ts
type OfficialBookingDetails = {
  book_date: string; // strict YYYY-MM-DD
  agent_allocations: Array<{
    agent_id: string;       // ObjectId; active Agent
    binder_amount: number;  // finite, >= 0, max 2 decimals
  }>;
  total_binder_amount: number;
  deposit_amount: number;   // finite, >= 0, max 2 decimals
  merchant_id: string;      // active Merchant catalog ID
};
```

Allocations contain 1-20 unique Agents. Validate every monetary input by converting its decimal representation to integer cents; reject more than two fractional digits and compare allocation sum to total Binder in cents. Existing Number fields may persist the converted amount for compatibility, but equality is never checked with floating-point addition. Booking persistence continues to snapshot Agent names and the Merchant owner label. Job Number and source are loaded from the case and cannot be supplied.

### 24.1 Confirm missing standard Booking

```ts
{
  case_id: string;
  expected_case_revision: number;
  selected_lead: { lead_model: LeadModel; lead_id: string };
  out_of_scope_override_reason?: string; // required, 10-500 chars when out of scope
  official_booking_details: OfficialBookingDetails;
}
```

Revalidate Lead eligibility, no existing Booking for Job Number, current Record Link, active Registry scope, and selected Lead revision. The command creates exactly one Booking and resolves the case.

The same transaction sets the active Record Link `booking_ref` and confirms/corrects `lead_ref` when the explicit selected Lead is permitted. Record Link revision/evidence is part of the command result.

### 24.2 Update existing Booking

```ts
{
  case_id: string;
  expected_case_revision: number;
  expected_booking_revision: number;
  official_booking_details: OfficialBookingDetails;
}
```

This is a full replacement of Book Date, allocations, Binder, Deposit, and Merchant on the deterministic Booking. It never creates another Booking or changes Lead/Job/source identity.

### 24.3 Create Referral Booking

Uses the same official Booking details with no Lead selector or Source Scope override. Contact and Job Number load from the accepted case Observation. The Booking sets `is_referral_booking = true`, has no Lead, and syncs only the appropriate Master Booked projection.

Referral creation establishes or updates the active Record Link with `booking_ref` and no `lead_ref`, preserving the accepted Observation/Decision as provenance.

### 24.4 Confirm Cancellation

```ts
{
  case_id: string;
  expected_case_revision: number;
  expected_booking_revision: number;
  official_cancellation_details: {
    cancel_date: string;    // strict YYYY-MM-DD
    refund_amount: number;  // finite, >= 0, max 2 decimals
    reason?: string;        // max 500
    notes?: string;         // max 2000
    cancelled_by?: string;  // max 200; business field, not durable actor
  };
}
```

The deterministic Booking must still be active. The command creates one Cancellation, mirrors it to Booking/Lead, creates changes, queues the Cancellation Chain, and resolves the case.

The canonical cancellation path must remove the current blanket rejection of Referral Bookings. A verified active Referral Booking may be cancelled without a Lead mirror; Booking and Cancellation revisions/evidence and the appropriate Sheet Sync chain still apply.

### 24.5 No Action

```ts
{
  case_id: string;
  expected_case_revision: number;
  reason_code?: NoActionReasonCode;
  reason_text?: string; // max 1000
}
```

No Action records a `DomainCommandExecution` and resolves the case but creates no `EntityChange` and no Sheet Sync work.

No owner command schema accepts Granot estimate, payment, balance, move date, source, contact, Job Number, suggested Agent, or replacement Booking identity.

## 25. Deep module interfaces

```ts
export interface GranotObservationProcessor {
  process(input: {
    receipt_id: string;
    initiator?: DurableActor;
  }): Promise<{
    observation_id: string;
    decision_id: string;
    outcome: SynchronizationOutcome;
    effects: SynchronizationEffectSummary[];
    target?: EntityRef;
  }>;
}

export interface GranotBookingReconciliation {
  reconcileObservation(input: {
    observation_id: string;
    decision_id: string;
  }): Promise<CaseEffectResult>;
  confirmBooking(input: ConfirmBookingCommand): Promise<OwnerCommandResult>;
  updateExistingBooking(input: UpdateBookingCommand): Promise<OwnerCommandResult>;
  createReferralBooking(input: ReferralBookingCommand): Promise<OwnerCommandResult>;
  noAction(input: NoActionCommand): Promise<OwnerCommandResult>;
}

export interface GranotReleaseReconciliation {
  reconcileObservation(input: {
    observation_id: string;
    decision_id: string;
  }): Promise<CaseEffectResult>;
  confirmCancellation(input: ConfirmCancellationCommand): Promise<OwnerCommandResult>;
  updateExistingBooking(input: UpdateBookingCommand): Promise<OwnerCommandResult>;
  noAction(input: NoActionCommand): Promise<OwnerCommandResult>;
}
```

Routes and consumers pass receipt/observation/case identities only. The processor owns normalization, Registry resolution, matching, ordering, desired state, persistence, idempotency, and command invocation.

## 26. Queue, lease, retry, and dead-letter contract

Add `api/queues/granot-lifecycle-consumer.ts`, `src/routes/granot-lifecycle-cron.routes.ts`, and `src/services/granotLifecycle/drainer.ts`. Register queue topic `granot-lifecycle-events*` in `vercel.json` and cron `/api/cron/granot-lifecycle-drain` every five minutes.

Queue, cron, extension synchronous apply, automation synchronous apply, and manual requeue all enter through the same atomic claim service. If a synchronous caller loses the claim race, it polls the receipt for up to five seconds with bounded backoff; completed work returns its stored result, while still-claimed/retry-scheduled work returns an accepted-for-processing response. It never runs an unfenced second processor.

Claim due work atomically:

```ts
filter: {
  "processing.state": { $in: ["pending", "retry_scheduled", "claimed"] },
  "processing.next_attempt_at": { $lte: now },
  $or: [
    { "processing.state": { $ne: "claimed" } },
    { "processing.leased_until": { $lte: now } },
  ],
}
update: {
  $set: {
    "processing.state": "claimed",
    "processing.lease_owner": owner,
    "processing.leased_until": now + 5 minutes,
    "processing.last_started_at": now,
  },
  $inc: { "processing.technical_attempts": 1 },
}
```

Lease renewal occurs before any potentially long phase and at least every two minutes. Initial batch size is 20 with bounded concurrency 4. Expired claims are recoverable by the same filter.

Renewal and finalization are fenced by `{ _id, "processing.state":"claimed", "processing.lease_owner":owner }`. If either update matches zero rows, the worker lost its lease and must stop without writing completion/dead-letter state; any already committed canonical command remains safely idempotent on retry.

Technical retry delay is `min(6h, 30s * 2^(attempt-1))` plus 0-25% jitter. Attempt 10 moves the receipt to `dead_letter`. Store only PII-safe error code/message. Authentication, invalid, unsupported, deferred, policy-blocked, insufficient-data, stale, already-current, and terminal unmatched outcomes complete the receipt.

Only `pending_match` uses the business schedule measured from first capture:

```text
immediate -> 1m -> 5m -> 15m -> 1h -> 2h -> 6h -> 12h -> 24h
```

At/after 24 hours, a failed match becomes `unmatched`. Each business attempt creates a new Decision and increments `processing.match_attempt`; it does not consume technical retry budget unless a dependency fails.

Manual requeue route is Owner-only, requires a 10-500 character reason, increments `manual_requeue_count`, clears lease/error, sets due now, and writes an audited Operational Event. An operation-id payload-hash conflict cannot be requeued into a different payload.

## 27. Historical shadow, activation, and feature flags

### 27.1 Activation model

```ts
type GranotLifecycleActivationDocument = {
  _id: ObjectId;
  key: "granot_lifecycle";           // unique
  activated_at: Date;
  activated_by: DurableActor;
  reason: string;
  processor_version: string;
  createdAt: Date;
};
```

Index `{ key: 1 }` is unique.

Activation is write-once through an Owner-only audited command. It is never edited or deleted.

Until an activation row exists, every processed receipt is forced to `historical_shadow`; no live effect is eligible. Activation must be recorded before the first intended post-cutoff live-shadow observation.

- `captured_at < activated_at` is permanently `historical_shadow`;
- historical shadow may normalize, decide, and create safe identity/link evidence only;
- it may not mutate/create Leads, open cases/discrepancies, notify, Sheet Sync, or invoke business commands;
- post-cutoff work is `live_shadow` while shadow flag is on, otherwise `live`;
- shadow Decisions are never promoted or replayed into effects; a new live Observation is required;
- rollback disables flags and never changes activation history.

### 27.2 Flags and defaults

Centralize in `src/config/domain/granotLifecycle.ts`:

```text
GRANOT_LIFECYCLE_PROCESSING_ENABLED=true
GRANOT_LIFECYCLE_SHADOW_MODE=true
GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED=false
GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=false
GRANOT_LIFECYCLE_EMAIL_ENABLED=false
```

Capture remains active even when processing/effects are off. Disabling an effect flag does not delete receipts/evidence or close cases. Case reads precede commands; Booking precedes Release; email is last.

## 28. Server HTTP API

Create a focused router `src/routes/granot-lifecycle-admin.routes.ts` mounted under the existing protected `/api/v1/admin` surface. Reads require Owner/Admin; mutations and raw operational actions require Owner and trusted signed admin actor. Extension apply uses existing extension Owner auth. Do not bypass the v1 guard.

### 28.1 Capture/apply compatibility endpoints

Existing webhook paths remain. Existing extension preview endpoints remain read-only. Replace only final apply behavior behind the existing URLs:

```text
PATCH /api/v1/form-leads/:id/granot-sync
POST  /api/v1/call-leads/enrichment/sync
POST  /api/v1/call-leads/booked-reconciliation/sync
```

Each apply item must include `operation_id` and a full Granot statement sufficient for channel-neutral normalization. The server captures `browser_extension` receipt(s), sets the authenticated extension Owner as initiator, invokes the processor, and translates processor outcomes into the current UI response vocabulary during compatibility. Clients may no longer submit arbitrary authoritative patches after the cutover.

HTTP automation `applyRun` captures one `granot_http_automation` receipt per selected action using `${run_id}:${action_id}`, invokes the processor, and stores the lifecycle receipt ID/Decision outcome in the existing run receipt. Preview/approval/checksum behavior remains.

### 28.2 Admin reads

```text
GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no
GET /api/v1/admin/granot-lifecycle/cases
GET /api/v1/admin/granot-lifecycle/cases/:case_id
GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle
GET /api/v1/admin/granot-lifecycle/discrepancies
GET /api/v1/admin/granot-lifecycle/discrepancies/:id
GET /api/v1/admin/granot-lifecycle/operations/health
```

Case list query:

```ts
{
  kind?: "booking" | "release";
  state?: "open" | "resolved";
  mode?: string;
  source_id?: string;
  normalized_job_no?: string;
  opened_from?: string; // ISO date
  opened_to?: string;
  sort?: "last_evidence_at" | "opened_at";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: 1..100;       // default 25
}
```

Lists are masked. Authorized detail returns normalized owner-work fields only, never raw receipt payload/headers. Referral detail works without a Lead.

The Job Number timeline is the primary view and contains every Observation, Decision, Priority effect, Booked/Release action, case sequence, discrepancy, Record Link change, Entity Change, and current Booking/Cancellation fact. Sort by `captured_at/occurred_at` plus type priority and stable ID; group visually but never collapse evidence.

### 28.3 Owner mutations

```text
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/update-booking
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/create-referral-booking
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/no-action
POST /api/v1/admin/granot-lifecycle/release-cases/:id/confirm-cancellation
POST /api/v1/admin/granot-lifecycle/release-cases/:id/update-booking
POST /api/v1/admin/granot-lifecycle/release-cases/:id/no-action
POST /api/v1/admin/granot-lifecycle/discrepancies/:id/re-evaluate
POST /api/v1/admin/granot-lifecycle/discrepancies/:id/correct-record-link
POST /api/v1/admin/granot-lifecycle/discrepancies/:id/no-action
POST /api/v1/admin/granot-lifecycle/receipts/:id/requeue
POST /api/v1/admin/granot-lifecycle/activation
```

Success envelopes use `{ ok:true, data }`. Create effects return `201`; updates/resolutions return `200`; idempotent replay returns the stored `200` result with `replayed:true`.

### 28.4 Error mapping

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `GRANOT_VALIDATION_FAILED` | strict Zod or business input failure |
| 401 | `GRANOT_WEBHOOK_UNAUTHORIZED` | webhook secret invalid/missing |
| 403 | `GRANOT_OWNER_REQUIRED` | actor lacks Owner authority |
| 404 | `GRANOT_RECEIPT_NOT_FOUND`, `GRANOT_CASE_NOT_FOUND`, `GRANOT_DISCREPANCY_NOT_FOUND` | target absent |
| 409 | `GRANOT_OPERATION_IDEMPOTENCY_CONFLICT` | same channel operation ID, different hash |
| 409 | `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` | same command key, different payload |
| 409 | `GRANOT_CASE_REVISION_CONFLICT` | stale case revision/resolved race |
| 409 | `DOMAIN_REVISION_CONFLICT` | stale Lead/Booking/Cancellation revision |
| 409 | `GRANOT_IDENTITY_CONFLICT` | link/Job/Source identity conflict |
| 409 | `GRANOT_ALREADY_ACTIVATED` | activation already exists |
| 422 | `GRANOT_POLICY_BLOCKED` | explicit command no longer allowed by Registry/flags |
| 503 | `GRANOT_CAPTURE_UNAVAILABLE` | receipt could not be committed |

Errors include `request_id` and safe structured issues; they never include raw payloads, secrets, full contact, or addresses.

## 29. Vantage Admin contract

### 29.1 Navigation and routes

Add Owner-only Granot lifecycle work under the existing Granot ingestion area, with direct links from Booking/Lead details:

```text
/ingestion/granot/lifecycle
/ingestion/granot/lifecycle/jobs/[jobNo]
/ingestion/granot/lifecycle/cases/[caseId]
/ingestion/granot/lifecycle/discrepancies/[id]
```

`/ingestion/granot` keeps HTTP automation. Add tabs `Automation` and `Lifecycle`. Do not mix Granot Booking Reconciliation with existing Employee Booking `BookingLeadReconciliationCase` UI.

### 29.2 Files

Add:

```text
lib/api/granotLifecycle.ts
components/granot-lifecycle/lifecycle-dashboard.tsx
components/granot-lifecycle/case-list.tsx
components/granot-lifecycle/case-detail.tsx
components/granot-lifecycle/job-timeline.tsx
components/granot-lifecycle/booking-command-form.tsx
components/granot-lifecycle/cancellation-command-form.tsx
components/granot-lifecycle/no-action-form.tsx
components/granot-lifecycle/discrepancy-detail.tsx
components/granot-lifecycle/lead-candidate-browser.tsx
```

Extend `lib/query/keys.ts` with stable keys for list, case detail, Job Number timeline, Lead timeline, discrepancies, and health.

### 29.3 List/detail behavior

- default queue shows open Booking and Release cases newest evidence first;
- filters mirror the server contract and remain in the URL;
- lists show masked customer/contact, Job Number, source, mode, latest action, evidence count, and age;
- detail shows immutable Granot evidence context separately from editable official fields;
- submitted contact and accepted Granot contact are visibly labeled;
- actual Booking/Release actions appear as individual timeline entries;
- a deterministic existing Booking is shown read-only above Update/Cancel actions;
- Referral mode shows no Lead selector;
- out-of-scope Lead selection shows the required warning/reason field;
- Granot estimate/payment/balance are labeled `Granot evidence — not official Vantage values`;
- form submission sends the currently loaded `case_revision` and aggregate revision;
- evidence-only refresh updates the timeline/count without clearing owner form fields;
- `409` refreshes detail, preserves unsent form values, and explains which revision changed;
- successful commands invalidate case list/detail, Job timeline, Lead detail, Booking/Cancellation lists, and relevant analytics queries.

### 29.4 Accessibility and safety

All actions require an explicit review screen and final labeled button (`Create Booking`, `Update Booking`, `Create Cancellation`, `Resolve — No Action`). No bulk confirm/cancel. Monetary values render as currency but remain exact decimal input. Dialog focus, labels, error summaries, and keyboard navigation follow existing Admin components.

The Admin app renders server projections and never reproduces source routing, matching, Priority, case-opening, or discrepancy rules.

## 30. Browser extension contract (`0.2.8`)

### 30.1 Version and branch

Work on `granot_sync_extensions_and_services/main`. Change `package.json` version from `0.2.7` to `0.2.8`; WXT-generated manifests must report `0.2.8`. Generated `.output` artifacts are not the version authority and need not be committed unless the repository's release process already does so.

### 30.2 Preview remains read-only

Current Form and Call preview/search UX may remain. Preview responses must identify the normalized statement the server expects and whether the row can be applied. Preview never creates lifecycle receipts and never mutates a Lead.

### 30.3 Final apply payload

Replace patch-oriented final apply payloads with a channel-neutral statement:

```ts
type ExtensionGranotApplyItem = {
  operation_id: string;
  operation_kind: "lead_snapshot_apply" | "booking_action_apply";
  granot_statement: Record<string, string | number | null>;
  expected_target?: { model: "FormLead" | "CallLead"; id: string };
};
```

`expected_target` is drift evidence, not authority; processor identity must agree. The statement must include source label, Job Number/reference/contact fields available in the parsed row, exact raw Priority, `user` and `rep` separately, and Booking Action when applicable. Do not pre-collapse `user`/`rep`, map Priority to a boolean, or send a Lead patch.

### 30.4 Stable operation IDs

Generate UUID v4 once when an owner/background action is queued. Store the ID with the local action state and retain it across network/auth refresh/retry. A deliberate new apply after a completed result receives a new ID. Batch Call items each have their own operation ID. Follow Up Form/Call enrichment uses `lead_snapshot_apply`; Booked Jobs work uses `booking_action_apply` with raw `Booked` evidence.

For background cycles, persist pending actions in `chrome.storage.local` before the request and remove only after a terminal server response. Cap pending storage to 500 entries/7 days and expose a PII-free diagnostic count. Operation records contain ID, row fingerprint, operation kind, created time, and attempt count—not raw customer data.

### 30.5 Compatibility response

The server returns per-item:

```ts
{
  operation_id: string;
  receipt_id: string;
  processing_state: "completed" | "accepted_for_processing";
  observation_id?: string;
  decision_id?: string;
  outcome?: SynchronizationOutcome;
  target?: EntityRef;
  changed_paths: string[];
  message: string;
}
```

Map `created/applied/linked` to updated success, `already_current/stale` to unchanged, `pending_match/unmatched/ambiguous/conflict/policy_blocked` to non-syncable review results, and `accepted_for_processing` to a durable pending result that can be refreshed with the same operation ID. A capture failure is retryable; a post-capture technical failure is owned by server retry state. The extension does not retry terminal business outcomes automatically.

### 30.6 Extension tests

Add tests proving ID retention across retry/auth refresh, different IDs for deliberate later actions, raw Priority/user/rep preservation, no patch/quoted derivation in final apply, per-item batch IDs, terminal outcome mapping, storage bounds, and manifest/package version `0.2.8`.

## 31. HTTP automation convergence

Keep collection, immutable plan, checksum, Owner approval, and selection UX. In `runWorkflow.ts`, replace `applyFormAction`/`applyCallAction` mutation calls with:

1. build the complete Granot statement from the locked action row;
2. capture a receipt with channel `granot_http_automation`, operation ID `${run_id}:${action_id}`, authentication method `automation_owner_approval`, and approved Owner initiator; Form and Call enrichment actions use `lead_snapshot_apply`, while Booked Jobs actions use `booking_action_apply` with raw `Booked` action evidence;
3. call `GranotObservationProcessor.process({ receipt_id, initiator })`;
4. store lifecycle IDs and outcome in the existing run's action receipt;
5. treat exact replay as the stored result and hash mismatch as run error.

If the lifecycle receipt remains claimed/retry-scheduled, the automation action is not checkpointed complete. The run stores `accepted_for_processing`, yields its lease, and a later continuation reloads the same receipt/operation ID until a terminal Decision or bounded technical failure is available.

The run receipt becomes:

```ts
{
  action_id: string;
  lifecycle_receipt_id: string;
  observation_id?: string;
  decision_id?: string;
  outcome: SynchronizationOutcome | "accepted_for_processing" | "technical_failure";
  applied_at: Date;
}
```

Current plan TTL may delete the automation run later; lifecycle receipt/observation/decision remain durable. Existing preview drift bindings remain a second safety check but do not bypass processor identity/policy.

## 32. Notification policy

Initial owner workflow is dashboard-only. Do not create Booking/Release notification domain models.

When `GRANOT_LIFECYCLE_EMAIL_ENABLED` is later enabled, extend `NotificationDelivery` with:

```ts
purpose: "granot_booking_case_opened" | "granot_release_case_opened";
granot_case_ref: { kind: "booking" | "release"; id: ObjectId; sequence_number: number };
```

Send only for a newly opened sequential case, never for evidence refresh. Dedupe by case ID + sequence + channel + purpose. Email failure cannot block or alter a case. No digest in this project.

## 33. Observability and operational health

Emit structured, PII-safe Operational Events for capture failure, queue publish failure, processing completion, technical retry, dead letter, manual requeue, case/discrepancy open/refresh/resolve, owner command apply/replay/conflict, activation, and RingCentral adoption/conflict.

Required metrics:

```text
granot_lifecycle_receipts_total{channel,event_class}
granot_lifecycle_queue_due
granot_lifecycle_oldest_due_seconds
granot_lifecycle_claim_recoveries_total
granot_lifecycle_technical_retries_total{code}
granot_lifecycle_dead_letters_total{code}
granot_lifecycle_decisions_total{outcome,reason_code,channel}
granot_lifecycle_capture_to_decision_ms
granot_lifecycle_decision_to_effect_ms
granot_lifecycle_open_cases{kind,mode}
granot_lifecycle_open_discrepancies{kind,reason_code}
granot_lifecycle_command_conflicts_total{code}
ringcentral_call_log_runtime_ms
ringcentral_adoptions_total{outcome}
ringcentral_call_log_lease_contention_total
```

Health projection shows flags, activation, due/oldest counts, claimed/expired claims, dead letters, 24-hour outcomes, open case/discrepancy counts, last queue/cron run, and RingCentral lease/cursor summary. It exposes no raw payload or customer data.

Alert thresholds for initial rollout:

- oldest due > 15 minutes for 10 minutes;
- any dead letter;
- capture `503` count > 0;
- claim recovery > 5/hour;
- p95 capture-to-decision > 10 minutes;
- RingCentral lease held > 10 minutes;
- source ambiguity/policy-blocked rate > 5% for an enabled source.

## 34. Migration scripts and commands

All scripts live in `scripts/migrations/`, are dry-run by default, reject historical/unknown databases, require explicit production confirmation, write deterministic PII-safe JSON manifests under a gitignored output directory, and support idempotent rerun. Add package scripts with the exact pattern below; `--apply --confirm-production=<database-name>` is required for mutation.

### 34.1 Receipt migration

`granot-lifecycle-receipts.ts`

- audit legacy row counts/status/event classes and forbidden credential keys;
- set channel `granot_webhook`, source system, capture time from `received_at || createdAt`, evidence version, redacted payload hash, auth method `legacy_unknown` when the historical method cannot be proven, and translated processing state;
- remove any persisted `x-api-secret` keys before hashing/backfill; report count only, never value;
- preserve legacy fields for one compatibility release, then remove in a later cleanup issue;
- never create effects.

Commands:

```text
pnpm migration:granot-lifecycle:receipts -- --report
pnpm migration:granot-lifecycle:receipts -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:receipts -- --verify
```

### 34.2 Source registry migration

`granot-lifecycle-source-registry.ts`

- inventory `GranotCrmSource`, `GranotAutomationSource`, Source Company, Granularity, and reviewed aliases;
- exact normalized join only;
- write automation references and locked initial classifications only for unique reviewed matches;
- leave all unmatched/ambiguous rows lifecycle-disabled/deferred;
- emit counts and IDs/labels safe for operations review.

### 34.3 Lead provenance migration

`granot-lifecycle-lead-provenance.ts`

- add deterministic Ingestion Origin or `legacy_unknown`;
- normalize existing Job Numbers and add Form parity;
- create `legacy_baseline` contact/move snapshot only when the current document is the sole available baseline, never label it original submission;
- set `domain_revision = 0` and common history boundary;
- report missing/invalid Job Numbers, origins, duplicate/bad counts, and normalization collisions.

### 34.4 Aggregate revision migration

`granot-lifecycle-aggregate-revisions.ts`

- backfill Booking/Cancellation revisions to 0 and `change_history_started_at`;
- do not create Entity Changes for predeployment state;
- audit one-Booking-per-normalized-Job index readiness and fail apply on collisions.

### 34.5 Index deployment

`granot-lifecycle-indexes.ts`

- report duplicate keys for every proposed unique/partial index;
- create non-unique indexes first;
- create unique indexes only after collision report is zero;
- verify index names/definitions against the model contract.

### 34.6 Historical shadow run

`granot-lifecycle-shadow-process.ts`

- processes selected/all existing receipts as `historical_shadow` through production Module interfaces;
- supports `--limit`, `--after-id`, and resumable checkpoint;
- outputs only counts by source/event/outcome/reason/match method and masked sample IDs;
- asserts zero Lead/Booking/Cancellation changes, cases, discrepancies, notifications, or Sheet Sync jobs.

### 34.7 Rollback artifacts

Schema changes are additive. Rollback disables flags and deploys prior code; it does not delete evidence. Migration manifests must record IDs changed so additive compatibility fields can be inspected or unset only by a separately authorized rollback script. Never roll back activation history, canonical aggregate revisions, Domain Command Executions, or Entity Changes.

The remaining package command names are fixed:

```text
pnpm migration:granot-lifecycle:sources -- --report|--verify
pnpm migration:granot-lifecycle:sources -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:leads -- --report|--verify
pnpm migration:granot-lifecycle:leads -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:revisions -- --report|--verify
pnpm migration:granot-lifecycle:revisions -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:indexes -- --report|--verify
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
pnpm granot:lifecycle:shadow -- --limit=<n> [--after-id=<id>]
```

Scripts reject combining `--report`, `--apply`, and `--verify`; an omitted mode means `--report`. Verify is read-only and exits nonzero on any invariant mismatch.

## 35. Verification strategy

### 35.1 Test levels

- pure unit tests: normalization, source routing, Priority, desired-state comparison, reason fingerprints, retry schedules;
- model tests: schema paths, validators, partial/unique indexes, immutable evidence;
- transaction integration tests with Mongo replica set: idempotency race, case race, aggregate revision, link reservation/correction, outbox atomicity;
- Module tests: processor and reconciliation interfaces with production adapters;
- route tests: auth, strict Zod, envelopes, error mapping, masking;
- cross-channel contract tests: webhook, extension, automation same normalized result;
- RingCentral integration tests: adoption/duplicate/lease/cursor;
- Admin component tests: filters, blank official fields, conflict preservation, Referral/no-Lead rendering;
- extension Vitest: operation IDs and response mapping.

Use redacted synthetic fixtures only. Never commit captured customer PII, secret-bearing payloads, or live database output.

### 35.2 Mandatory repository checks

Server issues run focused tests plus:

```text
pnpm test
pnpm typecheck
```

Admin issues run its configured unit/component tests, lint, and typecheck/build as appropriate. Extension issues run:

```text
pnpm test
pnpm compile
pnpm build
```

Use `vercel dev` smoke tests when webhook/cron/queue behavior differs from direct Express. Production-touching dry runs require separate approval and explicit DB/mode verification.

## 36. Acceptance scenario catalog

These are release obligations. Prototype scenarios must be rewritten through production Module/canonical-command interfaces; old prototype outcomes and Intake names are not copied blindly.

| ID | Scenario and required assertion |
| --- | --- |
| AC-01 | JSON body, form body, and header webhook secrets authenticate; credential is absent from payload, hash input, headers, logs, errors, and fixtures; unauthorized request creates no receipt. |
| AC-02 | Identical webhook deliveries create distinct receipts/Observations; same extension/automation operation ID replays one result; same ID with different hash conflicts. |
| AC-03 | Form CRM Posting sends `FormLead.ref_no` as `leadno`; Granot `ref_no` round-trips to exact Form Lead; valid Mongo ID fallback remains compatible. |
| AC-04 | Exact identity with conflicting Source Scope yields conflict and no mutation/reassignment. |
| AC-05 | Valid Priority `0`, `1`, `5`, `8`, `05`, and a large allowed value are canonicalized/stored; only `1`/`5` broadly enrich and set Quoted true; no value sets false. |
| AC-06 | Missing/malformed Priority invalidates Priority Update; the same malformed field on Lead Created/Booked/Release skips Priority but preserves the independent action. |
| AC-07 | Matched-existing Lead Created links/enriches without creating a second Lead. |
| AC-08 | Authorized `create_if_missing` Lead Created creates immediately once with an active Record Link; incomplete immutable data returns `insufficient_creation_data`. |
| AC-09 | Best Relocation Form same valid state routes Local; differing valid states route long-distance; invalid/missing states do not create. |
| AC-10 | WordPress Form primary contact and immutable submitted snapshot stay unchanged while qualified Granot contact is stored separately and displayed. |
| AC-11 | WordPress immutable move snapshot stays unchanged while qualified Granot current location/move date/cubic feet and Move Type update. |
| AC-12 | Call/Granot-created Form qualified contact becomes current; bounded Lead summary changes while full history appears in Entity Change. |
| AC-13 | Receiver Agent fills at a non-1/5 Priority through one active username match; differing `user`/`rep` blocks assignment; existing receiver is never overwritten. |
| AC-14 | Granot-created Call Lead is adopted by the matching RingCentral call and preserves Granot Ingestion Origin. |
| AC-15 | Adopted physical call is not a false duplicate; a different prior qualifying Call Lead still causes normal duplicate classification. |
| AC-16 | Zero/multiple phone adoption candidates or Job-number-only candidate do not guess; conflict is durable and qualified call is preserved. |
| AC-17 | Overlapping RingCentral cron runs produce one lease winner; cursor advances only after complete success; rolling lookback remains 12 hours. |
| AC-18 | Priority 5 with no Booking opens/refreshes create-missing Booking case; Priority 5 alone with existing Booking opens no review case. |
| AC-19 | Actual Booked with no Booking opens create-missing; actual Booked with one active Booking opens review-existing; never creates a second Booking. |
| AC-20 | Repeated same-kind action while open refreshes evidence only; after resolution, later action creates next sequence; evidence revision does not stale owner form. |
| AC-21 | Two concurrent owner commands with one case revision have one winner; replay of winner returns stored result; loser conflicts or resolves already-satisfied without second mutation. |
| AC-22 | Confirm Booking requires explicit eligible Lead, Book Date, allocations, exact Binder sum, nonnegative Deposit, and active Merchant; Granot display fields never default official fields. |
| AC-23 | Out-of-scope Lead selection requires reason and corrects Record Link with owner evidence but not Lead Source Scope. |
| AC-24 | Existing Booking review performs full official update on that Booking and preserves one-Booking-per-Job. |
| AC-25 | Release with active Booking supports Confirm Cancellation, Update Booking, and No Action; none happens automatically. |
| AC-26 | Already officially cancelled Release yields already-current and no case; Booked after Cancellation opens Booking Discrepancy. |
| AC-27 | Release without Booking or with conflicting link/Job/Source opens/refreshed Release Discrepancy and never creates/cancels anything. |
| AC-28 | Referral Booked creates a leadless referral case/Booking; no Lead search appears and only appropriate Master Booked projection syncs. |
| AC-29 | Paid Overflow and source Auto remain deferred/evidence-only; payload `type=AUTO` does not alter source classification. |
| AC-30 | `link_only` pending match follows the exact schedule and becomes unmatched at 24 hours; incomplete data is not retried as pending match. |
| AC-31 | Pre-activation receipts remain historical shadow under reprocessing and create no live effects; live-shadow Decisions are never replay-promoted. |
| AC-32 | No-op accepted Observation creates neither Entity Change nor Sheet Sync; every mutation has Receipt -> Observation -> Decision -> Command -> Change refs. |
| AC-33 | Extension and HTTP automation final apply produce channel-neutral receipts and the same desired-state outcome as equivalent webhook evidence. |
| AC-34 | Extension retains an operation ID across retry/auth refresh and reports version `0.2.8`. |
| AC-35 | Raw payload is absent from all lifecycle list/detail/admin projections and logs; list contact is masked. |
| AC-36 | Case/discrepancy open uniqueness and sequence indexes hold under concurrent evidence. |
| AC-37 | Manual requeue requires Owner reason/audit, respects payload identity, and dead-letter work does not mutate until reprocessed successfully. |
| AC-38 | Registry ambiguous/unmatched migration rows remain disabled/deferred; runtime ambiguity fails closed and audit/cache rules hold. |
| AC-39 | Booking missing its Lead uses existing Booking Lead Reconciliation, not a Granot discrepancy or duplicate workflow. |
| AC-40 | Actual Booked and Release may both have open cases for one Job; neither auto-closes the other. |

## 37. Production file map

The issue author may split files further inside the named domain, but must not move behavior into routes or broad legacy barrels.

### 37.1 `vantage-main-server`

```text
src/config/domain/granotLifecycle.ts
src/models/GranotObservationReceipt.ts
src/models/GranotObservation.ts
src/models/GranotRecordLink.ts
src/models/SynchronizationDecision.ts
src/models/EntityChange.ts
src/models/GranotLifecycleActivation.ts
src/models/GranotBookingReconciliationCase.ts
src/models/GranotReleaseReconciliationCase.ts
src/models/GranotBookingDiscrepancy.ts
src/models/GranotReleaseDiscrepancy.ts
src/models/granotLifecycleSchemas.ts
src/services/granotLifecycle/index.ts
src/services/granotLifecycle/types.ts
src/services/granotLifecycle/capture.ts
src/services/granotLifecycle/normalization.ts
src/services/granotLifecycle/sourcePolicy.ts
src/services/granotLifecycle/identity.ts
src/services/granotLifecycle/leadDesiredState.ts
src/services/granotLifecycle/processor.ts
src/services/granotLifecycle/bookingReconciliation.ts
src/services/granotLifecycle/releaseReconciliation.ts
src/services/granotLifecycle/discrepancies.ts
src/services/granotLifecycle/drainer.ts
src/services/granotLifecycle/projections.ts
src/services/granotLifecycle/operations.ts
src/routes/granot-lifecycle-admin.routes.ts
src/routes/granot-lifecycle-cron.routes.ts
src/validation/v1/granotLifecycle.validation.ts
api/queues/granot-lifecycle-consumer.ts
scripts/migrations/granot-lifecycle-*.ts
```

Evolve existing files explicitly named throughout this spec: webhook route/middleware/capture, models for Leads/Bookings/Cancellations/Registry/commands/notifications, domain commands, Granot automation, RingCentral ingest/config/state, `src/app.ts`, `vercel.json`, package scripts, rules/docs, and tests.

### 37.2 Documentation drift updates required during implementation

- correct `.cursor/rules/owner-lead-workflow.mdc` to preserve the `FormLead.ref_no -> leadno` contract;
- update `.cursor/rules/project-organization.mdc` when `granotLifecycle/`, routes, consumer, and models land;
- update `.cursor/rules/schema-and-crud-inputs.mdc`, `.cursor/rules/ringcentral-integration.mdc`, and the RingCentral production runbook when their behavior changes;
- add/update service behavior documentation under `.cursor/businesslogic/` for Granot lifecycle, Leads, Bookings, Cancellations, and RingCentral;
- keep `CONTEXT.md` implementation-free; it already contains the resolved terms and requires changes only if implementation discovers a genuinely new domain term.

## 38. Sequential issue slices

Each slice is independently reviewable and vertically proves a safe increment. Every issue copied from this list must retain its prerequisites, flags, migration/dry-run, tests, live verification, and rollback notes.

The following requirements are inherited by every slice and must be copied into every generated issue in addition to the slice-specific bullets:

- **Migration/dry run:** state `none` when the slice has no persistent-data or index change. Otherwise use the named Section 34 report -> reviewed apply -> verify command flow; production apply is separately approved and never implied by issue assignment.
- **Verify:** run focused tests for the slice plus the applicable repository checks in Section 35.2; name tests with every listed AC ID.
- **Live verify:** use redacted synthetic evidence in preview/staging first. Production verification is read-only unless that slice's rollout step has been separately approved, and must inspect causal IDs/metrics rather than raw payload/contact values.
- **Rollback:** disable the narrowest affected flag/caller first and preserve all durable evidence and already committed official facts. Any more specific rollback bullet below takes precedence.

### S01 — Freeze contracts and redacted fixtures

- **Repos:** server.
- **Prerequisites:** none.
- **Deliver:** shared enums/types/Zod normalization fixture contract; correct stale `leadno` docs; redacted webhook/extension/automation fixtures; acceptance test IDs wired into test names.
- **Flags:** none.
- **Acceptance:** AC-03, normalization portions of AC-05, AC-06, and AC-29.
- **Verify:** unit tests and fixture secret/PII scanner.
- **Rollback:** documentation/test-only revert; no data changes.

### S02 — Secure channel-neutral receipt capture

- **Repos:** server.
- **Prerequisites:** S01.
- **Deliver:** receipt in-place model evolution, webhook auth context, credential stripping, canonical hash, header allowlist, compatibility alias, capture queue publish seam.
- **Flags:** capture always active; processing may remain off.
- **Migration:** receipt report/apply/verify script, dry-run first.
- **Acceptance:** AC-01, webhook portion of AC-02, AC-35.
- **Live verify:** authorized synthetic redacted webhook returns `202`; unauthorized count creates no row; inspect stored keys only.
- **Rollback:** prior capture code can read compatibility fields; do not delete new evidence.

### S03 — Observation normalization and result vocabulary

- **Repos:** server.
- **Prerequisites:** S02.
- **Deliver:** Observation model, exact normalization/action/Priority rules, one Observation per receipt, invalid/unsupported completion.
- **Flags:** processing can run in shadow only.
- **Acceptance:** AC-05, AC-06, and the action-alias portions of AC-25 and AC-29.
- **Verify:** pure/model tests across webhook/body encodings and malformed values.
- **Rollback:** disable processing; captured receipts remain.

### S04 — Audited Granot source registry

- **Repos:** server, admin Registry UI only if needed for reviewed mutation.
- **Prerequisites:** S01.
- **Deliver:** `GranotCrmSource` semantic fields/commands/audit/cache, automation reference adapter, initial classification migration/report.
- **Flags:** all lifecycle rows default disabled/deferred until reviewed apply.
- **Migration:** source Registry report -> Owner review -> apply -> verify.
- **Acceptance:** AC-04, AC-09, AC-29, AC-38.
- **Live verify:** list reviewed sources/routes and prove ambiguous sample fails closed.
- **Rollback:** set lifecycle_enabled false through audited command; compatibility catalog remains.

### S05 — Decision, activation, Record Link, and operational reads

- **Repos:** server.
- **Prerequisites:** S03, S04.
- **Deliver:** Decision/Activation/Record Link models, execution-mode classification, link-only safe evidence, health/Job read skeleton.
- **Flags:** processing true, shadow true, all effects false.
- **Migration:** create indexes after collision report; activation not yet written unless rollout is approved.
- **Acceptance:** AC-02 decision evidence, AC-31, and the Record Link portions of AC-32 and AC-35.
- **Live verify:** historical receipt dry run produces only Observation/Decision/safe link evidence.
- **Rollback:** disable processing; never delete activation/link evidence.

### S06 — Durable drainer, retries, dead letter, and manual requeue

- **Repos:** server.
- **Prerequisites:** S03, S05.
- **Deliver:** queue consumer, five-minute cron, claim/renew/recover, technical and business schedules, dead letter, audited requeue, metrics.
- **Flags:** processing true in shadow.
- **Acceptance:** AC-30, AC-37 plus lease recovery tests.
- **Live verify:** synthetic dependency failure retries without Decision; pending match follows test-clock schedule.
- **Rollback:** disable processing/consumer; capture continues and work remains due.

### S07 — Aggregate revisions, command executor, and Entity Change foundation

- **Repos:** server.
- **Prerequisites:** S01.
- **Deliver:** revision fields/migration, Entity Change, transaction-owning canonical executor, command result replay, outbox atomicity, adapters for existing writes.
- **Flags:** lifecycle effects still off.
- **Migration:** aggregate report/apply/verify; unique Booking Job collision must be zero.
- **Acceptance:** AC-21, AC-32 and command race/outbox tests.
- **Live verify:** synthetic test-mode write produces one command/change/revision/outbox chain.
- **Rollback:** retain additive revision/evidence; disable new callers; do not decrement revisions.

### S08 — Lead provenance and identity parity

- **Repos:** server.
- **Prerequisites:** S04, S07.
- **Deliver:** Ingestion Origin, snapshots, Form Job Number parity, temporal winner, Priority/provenance fields, indexes, contextual validators, migration.
- **Flags:** Lead writes/creation false.
- **Migration:** report deterministic/unknown origins and legacy baselines; apply idempotently.
- **Acceptance:** field prerequisites for AC-03, AC-07, AC-10, AC-11, and AC-12.
- **Live verify:** counts by origin/snapshot status; no Lead business values changed by dry run.
- **Rollback:** old code ignores additive fields; do not erase snapshots.

### S09 — Source-scoped identity and shadow Lead desired state

- **Repos:** server.
- **Prerequisites:** S03-S05, S08.
- **Deliver:** Form/Call ladders, Bad/Duplicate rules, temporal comparison, Agent identity, origin-specific desired-state planner; shadow Decisions only.
- **Flags:** processing true, shadow true, Lead writes false.
- **Acceptance:** AC-04, AC-05, AC-06, AC-07, AC-10, AC-11, AC-12, AC-13, and AC-30 in shadow.
- **Live verify:** PII-safe outcome/match/reason distribution from historical shadow.
- **Rollback:** disable processing; no domain mutations occurred.

### S10 — Cross-channel extension receipt apply (`0.2.8`)

- **Repos:** server and extension main.
- **Prerequisites:** S02, S03, S09.
- **Deliver:** extension operation IDs/storage, statement apply payload, server capture/process adapters, compatibility result mapping, version bump.
- **Flags:** shadow true; Lead writes false during parity proof.
- **Acceptance:** extension portion AC-02, AC-33, AC-34.
- **Live verify:** same redacted statement through webhook/extension yields equivalent shadow desired state.
- **Rollback:** disable lifecycle processing and restore old client endpoint adapter only if it cannot bypass receipts; keep version/evidence.

### S11 — Cross-channel HTTP automation receipt apply

- **Repos:** server and existing admin automation display.
- **Prerequisites:** S02, S03, S09.
- **Deliver:** `${run_id}:${action_id}` receipt identity, processor apply, lifecycle result stored on run receipt, preview/approval preserved.
- **Flags:** shadow true; Lead writes false.
- **Acceptance:** automation portions of AC-02 and AC-33.
- **Live verify:** approved synthetic plan creates one lifecycle receipt/action and exact replay.
- **Rollback:** disable automation apply flag/lifecycle processing; immutable plan and receipts remain.

### S12 — Enable safe matched-Lead writes

- **Repos:** server.
- **Prerequisites:** S07-S11 and cross-channel parity report accepted.
- **Deliver:** `synchronizeLeadFromGranot`, Record Link confirm/establish, Entity Change/Sheet Sync effects, desired-state idempotency.
- **Flags:** shadow false only for reviewed sources; Lead writes true; creation/cases false.
- **Acceptance:** live behavior for AC-05, AC-07, AC-10, AC-11, AC-12, AC-13, AC-32, and AC-33.
- **Live verify:** narrow Registry source, compare Decision/effect/Sheet Sync, monitor rollback thresholds.
- **Rollback:** set Lead writes false or shadow true; preserve evidence and current committed Lead values.

### S13 — Authorized Lead creation

- **Repos:** server.
- **Prerequisites:** S12.
- **Deliver:** immediate create-if-missing Form/Call commands, atomic link reservation, minimum-data outcomes, `post_to_granot=false`.
- **Flags:** creation enabled only for one reviewed Registry source at a time.
- **Acceptance:** AC-07, AC-08, and AC-09 plus the no-second-Lead race.
- **Live verify:** synthetic/test-mode first, then reviewed source counts for created/conflict/insufficient.
- **Rollback:** disable creation; never delete created Leads; continue link/write policy as configured.

### S14 — RingCentral adoption and 30-minute leased cron

- **Repos:** server.
- **Prerequisites:** S08, S13.
- **Deliver:** convergence seam, adoption-before-duplicate order, processed ledger atomicity, state lease/telemetry, schedule change after tests.
- **Flags:** preserve current RingCentral write-mode gates.
- **Acceptance:** AC-14, AC-15, AC-16, and AC-17.
- **Live verify:** dry-run/adoption metrics and one lease winner; change schedule last.
- **Rollback:** restore two-hour schedule and disable adoption flag; do not detach verified adopted metadata.

### S15 — Booking Reconciliation read-only

- **Repos:** server and admin.
- **Prerequisites:** S05, S09, S12.
- **Deliver:** Booking case model/open-refresh/sequence/candidates, projections, dashboard list/detail/Job timeline; no commands.
- **Flags:** Booking cases true only after read UI deployed; Booking commands false.
- **Acceptance:** read behavior for AC-18, AC-19, AC-20, AC-36, AC-39, and AC-40.
- **Live verify:** candidate quality/modes/evidence refresh and zero Bookings created.
- **Rollback:** disable Booking cases; existing cases stay readable.

### S16 — Booking owner commands

- **Repos:** server and admin.
- **Prerequisites:** S07, S15 and Owner review of read-only cases.
- **Deliver:** confirm/update/no-action forms and commands, active catalogs, out-of-scope correction, concurrent revision safety.
- **Flags:** Booking commands true for reviewed Owners; Referral false.
- **Acceptance:** AC-20, AC-21, AC-22, AC-23, AC-24, and AC-32.
- **Live verify:** test-mode command chain, then one reviewed case with Mongo/Sheet verification.
- **Rollback:** disable Booking commands; keep cases/read UI and committed Bookings.

### S17 — Release Reconciliation read-only

- **Repos:** server and admin.
- **Prerequisites:** S15; Booking reads/identity stable.
- **Deliver:** Release case model/open-refresh/sequence, deterministic Booking projection, dashboard detail/timeline; no commands.
- **Flags:** Release cases true; Release commands false.
- **Acceptance:** read portions of AC-25, AC-26, AC-27, AC-36, and AC-40.
- **Live verify:** active/already-cancelled/no-Booking distributions; zero cancellations/updates.
- **Rollback:** disable Release cases; existing cases stay readable.

### S18 — Release owner commands

- **Repos:** server and admin.
- **Prerequisites:** S07, S17 and Owner review.
- **Deliver:** Confirm Cancellation, Update Booking, No Action commands/forms, current-state revalidation and concurrency.
- **Flags:** Release commands true after test-mode proof.
- **Acceptance:** AC-21, AC-25, AC-26, and AC-32.
- **Live verify:** one reviewed case each for No Action and, when available, official mutation with Sheet chain verification.
- **Rollback:** disable Release commands; never reverse committed official facts automatically.

### S19 — Referral Booking

- **Repos:** server and admin.
- **Prerequisites:** S16 and reviewed Referral Registry classification.
- **Deliver:** Referral case mode, leadless canonical referral command, UI without Lead search, projection rules.
- **Flags:** Referral Booking true only after dedicated acceptance.
- **Acceptance:** AC-28.
- **Live verify:** test-mode referral and Master Booked target set.
- **Rollback:** disable Referral flag; preserve created official Booking.

### S20 — Discrepancies and Record Link correction

- **Repos:** server and admin.
- **Prerequisites:** S16-S18.
- **Deliver:** separate discrepancy models, fingerprints, re-evaluate/no-action/correction, owner UI/timeline.
- **Flags:** case flags control creation; correction requires Owner.
- **Acceptance:** AC-23, AC-26, AC-27, and AC-36.
- **Live verify:** synthetic conflicts refresh one discrepancy and correction preserves old link history.
- **Rollback:** disable correction mutation; discrepancies remain visible.

### S21 — Operational hardening and historical shadow certification

- **Repos:** server and admin health view.
- **Prerequisites:** S01-S20 applicable code complete.
- **Deliver:** full metrics/health/alerts, historical shadow tool, raw-data masking audit, migration verification, runbooks.
- **Flags:** staged values documented; email remains false.
- **Acceptance:** AC-31, AC-35, AC-37, and AC-38 plus all operational thresholds.
- **Live verify:** complete PII-safe shadow report and zero-forbidden-effects assertion.
- **Rollback:** flags to shadow/effects off; capture remains.

### S22 — Optional email notifications

- **Repos:** server.
- **Prerequisites:** all case workflows accepted by Owner.
- **Deliver:** typed Notification Delivery purpose/case ref, new-case-only dedupe, templates, delivery metrics.
- **Flags:** email false until separate Owner acceptance.
- **Acceptance:** one email per newly opened sequence, none on refresh, failure does not affect case.
- **Live verify:** test recipient/provider sandbox before any production enablement.
- **Rollback:** set email false; cases/dashboard unaffected.

### S23 — Prototype retirement and compatibility cleanup

- **Repos:** server, admin, extension as applicable.
- **Prerequisites:** production Module tests cover all ACs and rollout is stable.
- **Deliver:** remove disposable prototype and deprecated Intake/link-only names, retire old patch apply paths and automation semantic ownership, remove legacy receipt fields after compatibility window, update docs.
- **Flags:** no behavior enablement.
- **Acceptance:** all AC tests run at production interfaces; repository search finds no active Intake/generic lifecycle engine assumptions.
- **Live verify:** compile/test/build all repos and confirm no old client version in use before endpoint cleanup.
- **Rollback:** compatibility cleanup is delayed, not rushed; do not delete durable evidence.

## 39. Rollout and rollback sequence

The production order is fixed:

1. contracts/fixtures and secure capture;
2. receipt backfill and Observation/Decision/Registry foundations;
3. aggregate provenance/revision foundations;
4. processor in historical/live shadow;
5. extension and automation convergence in shadow;
6. matched safe Lead writes for one source;
7. authorized Lead creation source by source;
8. RingCentral adoption and then 30-minute cadence;
9. Booking cases read-only, then Booking commands;
10. Release cases read-only, then Release commands;
11. Referral;
12. discrepancies/correction;
13. optional email;
14. compatibility/prototype cleanup.

At each effect enablement:

- confirm migrations/index verification green;
- record current flags and Registry policy;
- deploy read/processing capability before enabling its flag;
- enable one source/effect at a time;
- compare receipt, decision, effect, aggregate, command, change, and Sheet Sync refs;
- watch stated metrics for at least one normal operating interval;
- rollback by disabling the narrow effect or returning to shadow;
- never delete/rewrite receipts, activation, Decisions, Commands, Changes, cases, or committed official facts.

Stop the rollout on any secret persistence, source reassignment, duplicate Booking, unexplained aggregate mutation, missing causal reference, queue age breach, repeated dead letter, false RingCentral duplicate, or case concurrency violation.

## 40. Deferred decisions and fail-closed behavior

The following are intentionally deferred and do not block issue creation:

- Paid Overflow business ownership/effects;
- classification of a future actual Auto source label;
- application field encryption beyond database encryption at rest;
- raw-receipt retention duration/purge;
- physical receipt collection rename;
- targeted asynchronous RingCentral lookup sooner than the 30-minute cron;
- provider occurrence/revision ordering until Granot supplies a trusted value.

Each remains visible as evidence and produces `deferred`/policy-blocked behavior, never guessed effects.

## 41. Definition of complete

The mission is complete only when:

- all S01-S21 slices required for the approved release are delivered in sequence;
- every AC-01 through AC-40 test passes at the prescribed interface level;
- the three channels converge through receipts and one processor;
- all live mutations are canonical, revision-guarded, causally traceable, and idempotent;
- owner reconciliation can safely create/update/no-action Booking work and cancel/update/no-action Release work;
- no Granot evidence automatically fabricates official Booking/Cancellation facts;
- RingCentral convergence prevents the same call from becoming two Leads;
- Admin timelines and queues are operationally usable without raw-payload exposure;
- migrations, flags, runbooks, verification, and rollback are proven;
- disposable prototype code is removed only after its relevant scenarios are represented by production-interface tests.

Issues should be created only after this final specification is reviewed and accepted. Use the slice titles and acceptance IDs as the issue spine; do not regroup them into horizontal “all models,” “all APIs,” or “all UI” work that postpones end-to-end proof.
