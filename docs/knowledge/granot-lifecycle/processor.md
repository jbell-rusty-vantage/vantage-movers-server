---
type: Service
title: "Granot lifecycle processor (`granotLifecycle/processor`)"
description: Channel-neutral orchestration from receipt to Decision and gated Lead writes. No official Booking or Cancellation writes.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/processor.ts
applies_to:
  - src/services/granotLifecycle/processor.ts
  - src/services/granotLifecycle/synchronizeLeadFromGranot.ts
  - src/services/granotLifecycle/createLeadFromGranot.ts
  - src/services/granotLifecycle/discrepancies.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/processor.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-09-01T18:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority (Release routing):** [`release-into-booking-intake.md`](./release-into-booking-intake.md). FINAL SPEC still wins on uniqueness, revisions, Referral, official-field blankness, and identity-conflict discrepancies.  
**Primary code:** `src/services/granotLifecycle/processor.ts`, `src/services/granotLifecycle/bookingReconciliation.ts`, `src/services/granotLifecycle/createLeadFromGranot.ts`, `src/services/granotLifecycle/synchronizeLeadFromGranot.ts`, `src/services/granotLifecycle/leadDesiredState.ts`, `src/services/granotLifecycle/granotTemporal.ts`, `src/config/domain/granotLifecycle.ts`, `src/models/SynchronizationDecision.ts`, `src/models/GranotLifecycleActivation.ts`, `src/models/GranotRecordLink.ts`, `src/models/GranotBookingReconciliationCase.ts`
**Domain terms used:** [Synchronization Decision](../../../../CONTEXT.md), [Granot Record Link](../../../../CONTEXT.md), [Granot Observation](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Granot lifecycle processor (`granotLifecycle/processor`)

**Role:** Channel-neutral production orchestrator. One receipt becomes one Observation, one Unit 14 identity result, one desired-state plan, and one Synchronization Decision. Historical shadow may establish or confirm a **job-level** Granot Record Link. Authorized live matched-Lead writes enter `synchronizeLeadFromGranot` only. Authorized live `create_if_missing` Lead Created with no eligible match enters `createLeadFromGranot` only. This module never patches a Lead or official Booking/Cancellation fact itself. // pragma: allowlist secret

**Stack:** callable module `processor.ts`. Capture does not invoke it. Queue, cron, and the synchronous claim-and-poll seam invoke it only after a fenced receipt claim (`drainer.ts`). Routes pass receipt identity (and optional initiator); they do not plan patches.

## Orchestration

```text
load receipt -> upsert/reuse Observation -> classify stored execution mode
-> terminal normalization -> resolve Registry policy -> Unit 14 identity
-> temporal compare -> desired-state plan -> evaluate exact gates
-> live+Booked-or-Release evidence+booking-case gate -> Booking case open/refresh/already-current/delegation/discrepancy
-> live+creation+all gates+eligible no-match -> createLeadFromGranot
-> else live+writes+all gates+matched Lead -> synchronizeLeadFromGranot
   (or already_current exact-link Decision + metadata-only temporal CAS)
-> otherwise persist one Decision / historical job-level link
-> finalize through Unit 08 fence
```

The processor actor is always `{ actor_type:"system", actor_id:"granot-lifecycle-processor" }`. Receipt `initiator` is threaded in module context for later commands; a webhook may omit it. Clients never supply the processor actor.

Same observation/attempt with identical causal meaning replays the stored Decision. After a committed live mutation, the same Observation+attempt re-plans as `already_current` or `stale`; the stored `applied`/`linked` Decision remains the replay result. A stored `applied` Decision against current historical-link classification is still `DecisionIntegrityError`. Technical dependency failures create no Decision.

## Temporal tuple

Ordering is latest accepted Vantage `captured_at`; equal times use the lexicographically greater lowercase 24-character Observation ObjectId hex. No source, channel, or Priority outranks that tuple. Missing stored winner is newer. Exact same tuple is replay/`already_current`. Older is `stale` / `older_than_temporal_winner` with no desired-state effect or winner advance.

## Desired-state planner

`leadDesiredState.ts` returns a plan, not a database patch and never contact values inside a Decision. Rules:

- every temporally accepted valid Priority plans `granot_priority`; only `1`/`5` plan broad enrichment and `quoted=true`; no Priority plans false
- malformed Priority Update is `invalid` / `invalid_priority_update`; the same issue on Lead Created/Booked/Release skips Priority and continues
- WordPress primary contact and both ingested snapshots never enter `changed_paths`; qualified Granot contact stays on `granot_contact_snapshot`; qualified move may plan current location/date/cubic feet and derived `local`; Vantage `move_size` is never planned
- RingCentral-created and Granot-created qualified contact/move plan current fields plus a bounded `last_granot_contact_change.changed_paths` summary; no Entity Change is claimed
- one Unit 14 Agent suggestion may fill an empty receiver at any valid Priority via `granot_username_match`; conflicts and existing receivers never overwrite. `synchronizeLeadFromGranot` stamps `receiver_agent_name_snapshot` from the loaded Agent catalog name and `receiver_agent_set_at`; sheet SalesRep reads that snapshot, not a live Agent join
- Duplicate Form has no target; Bad exact Form is Priority plus safe link evidence only
- `link_only` no-match is `pending_match` until the Unit 08 24h clock, then `unmatched` / `match_window_expired`; incomplete creation data is terminal `insufficient_creation_data` (`missing_creation_job_number`, `missing_creation_contact`, or `missing_creation_route_data`) and is never pending
- `create_if_missing` with complete minimum data plans immediately `created` / `lead_created_authorized`. The processor invokes `createLeadFromGranot` only when execution is `live`, `lead_creation_enabled` is true, and every creation gate is allowed. Shadow and gated-off live persist the suppressed/disabled Decision and create nothing

Source Company, Source Granularity, Ingestion Origin, CPL, Booking/Cancellation refs, and official money never enter `desired_values`.

## Shadow and effects

Unit 31 adds the operator-only `granot:lifecycle:shadow` adapter. It selects
pre-activation receipt IDs in ascending order and calls this exact processor
interface; it owns no normalization, matching, or policy. Its private
checkpoint is resumable, while public output contains masked IDs and bounded
distributions. Before/after collection fingerprints make any forbidden effect
or activation drift a failing certification.

- Pre-activation and `captured_at < activated_at` stay `historical_shadow` forever. Live-shadow Decisions are never promoted.
- Historical shadow may create safe job-level Record Link evidence when Job/scope agree. It does not add `lead_ref`, `booking_ref`, source scope, or disputed state.
- Live shadow persists Decisions only. Eligible matched writes become `shadow_effect_suppressed`.
- Live + `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED` + all creation gates + an eligible no-match `lead_created` plan invoke `createLeadFromGranot` once. Live + `GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED` + all eight gates + a matched eligible Lead invoke `synchronizeLeadFromGranot` for an `applied` plan or for `already_current` that still needs a lead-attached Record Link. Exact current links stay on the Decision-only / metadata CAS path.
- A failed gate records that gate's outcome/reason and performs no command. Creation race losers (identity, policy, active-link duplicate-key) abort the proposed transaction, reload policy and the full identity ladder, and replan. A now-eligible matched Lead flows through `synchronizeLeadFromGranot`; a pre-existing lead-less active reservation becomes `conflict` / `record_link_conflict`; the processor never retries blind creation. A route/minimum-data race persists `insufficient_creation_data` / `missing_creation_route_data`. Matched-write race losers reload and replan; if the replan is still an authorized write, the command retries with the current revision (max 3). Classification outcomes persist Decision-only. Never persist `applied` against a lost claim.
- Production starting/ending flags stay processing true, shadow true, and all eight effect flags false. Unit 19 adds no migration or index. // pragma: allowlist secret

## Booking reconciliation cases

Post-activation `live` actual Booked **or** Release evidence (`booking_action.normalized` is `booked` or `release`) enters `bookingReconciliation.ts` only when all Booking-case gates pass. Priority `5` is not booking evidence: that Observation continues through lead desired-state (`maybeCreateLead` / `maybeSynchronizeMatchedLead`) and never calls Booking reconciliation. The processor preallocates the Decision ID; the service rereads the immutable Observation, active link, source-scoped identity, deterministic Booking/Cancellation facts, and existing employee reconciliation work. One transaction opens or refreshes the single open `{normalized_job_no, action_kind:"booked"}` case and inserts the causal Decision. A bounded one-retry path resolves open/sequence unique races. Locked Release routing: [`release-into-booking-intake.md`](./release-into-booking-intake.md).

Actual Booked or Release with no Booking opens create-missing even when Lead identity is ambiguous or Priority is missing/invalid/non-`5`; one active Booking opens `review_existing_booking`. Booking-without-Lead delegates to its existing employee reconciliation case. Officially cancelled Booking + Release is `already_current` / `booking_already_cancelled` (Decision only; no case, no discrepancy). Officially cancelled Booking + Booked still returns `booked_after_official_cancellation`. Identity conflicts return typed `booking_discrepancy_required` with existing `booked_*` or `release_*` reasons. Missing Booking + Release is not `release_without_vantage_booking`. The processor **persists** those discrepancies via `persistProcessorDiscrepancy` → `createGranotDiscrepancies` (`discrepancies.ts`). There is no standalone discrepancy Service file in this cluster. Referral Booked or Release evidence can open `create_referral_booking`. A booking-case Decision (open, refresh, or `already_current`) **returns before** lead desired-state on that same Observation — no `synchronizeLeadFromGranot` or `createLeadFromGranot` on that receipt. Case open/refresh writes no Lead, Booking, Cancellation, Record Link, Command, Change, outbox, notification, or email.

New evidence appends once by Observation ID and increments only `evidence_revision`; owner-relevant suggestion changes increment `case_revision`. Resolved rows are immutable and later evidence gets `max(sequence)+1`. Suggested/candidate Leads use only canonical Unit 14 identity evidence, exclude Duplicate/Bad Form Leads, and may be refreshed without attachment for 24 hours. Operational events mask identifiers and the open-case gauge is recomputed from current cardinality. Protected reads already exist. Checked-in `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` remains false; official Booking writes stay on separately gated Owner commands.

## Release reconciliation cases

The processor **does not** call `maybeReconcileRelease` (removed, not shimmed). `createGranotReleaseReconciliation` is not invoked from this module. New Release evidence is booking-case work above. Historical Granot Release Reconciliation Cases stay readable; see [`release-reconciliation.md`](./release-reconciliation.md). Checked-in Release case/command flags remain false. Do not enable them to route new owner work.

Identity `release_*` discrepancies still open through the booking classifier: `persistProcessorDiscrepancy` sets `discrepancy_kind` to `"release"` when `reason_code` starts with `release_`. Missing Booking is not one of those reasons.

## Temporal compare-and-swap seam

For a newer Observation whose authorized desired state **and** exact lead-attached link are already current, injected **`live` + Lead-writes-enabled test posture** inserts `already_current` / `desired_state_already_current` and may atomically advance `last_accepted_granot_observation` with a filter that accepts only an older `(captured_at, observation_id)` tuple. That write does not increment `domain_revision`, write `last_change_*`, create Entity Change, request Sheet Sync, or emit `lead_updated`. Zero matched rows abort the proposed Decision, reload, and re-evaluate; the loser is normally `stale`. Production shadow never invokes this Lead write. Reportable matched-Lead or Record-Link association mutations use `synchronizeLeadFromGranot`. // pragma: allowlist secret

## Authorized Lead creation (`createLeadFromGranot`)

The processor is the only caller. Routes, clients, and payloads may not supply a Lead patch, Job Number, Ingestion Origin, CPL, convergence state, or `post_to_granot`. Command input is exactly `{ lead_model, source_scope, observation_id, context }`. Idempotency key is `granot:create-lead:<observation_id>`. Checksum covers Observation ID, Job, selected model, source-scope IDs/policy version, and normalized contact/move semantics — never a raw payload.

**Live invocation requires all of:** `route_event_class:"lead_created"`; execution mode `live`; `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=true`; every Unit 15/18 creation gate allowed (global creation flag, post-activation, operational + lifecycle enabled, disposition `source_scoped_lead`, active Source Company and Source Granularity, current reviewed policy `create_if_missing`); the complete identity ladder found no eligible target/ambiguity/conflict/Duplicate-or-Bad restriction; `evaluateMinimumCreationData` is `eligible`; the selected Form/Call route is deterministic and agrees with the command model. Incomplete immutable data is terminal for this Observation (`insufficient_creation_data` with the exact missing-data reason) and creates no Lead, link, Command, Change, or outbox. `link_only` keeps the Unit 08 pending/unmatched clock. A later complete Observation may still create.

Inside one executor transaction the command reloads Observation, Registry, gates, route, and identity, then commits atomically: the preallocated Decision (`created` / `lead_created_authorized` with bounded effects `lead_created`, `record_link_established`, `sheet_sync_requested`); exactly one Form/Call Lead (`ingestion_origin:"granot_lead_created"`, `post_to_granot:false`, immutable creation snapshots, `domain_revision` after the creation Change); exactly one newly created active `GranotRecordLink` for `provider:"granot"` + normalized Job Number (existing Unit 07 unique partial index is the reservation fence); append-only `EntityChange` rows for Lead and link; one `DomainCommandExecution` whose refs include both; and one queued `form_lead.create` or `call_lead.create` Sheet Sync intent. Creation never attaches or fills a pre-existing active link, including a historical lead-less reservation: that aborts the proposed transaction and replans to `conflict` / `record_link_conflict` when no eligible Lead emerges. Exact replay returns the stored refs. Same key/different checksum is `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`. Duplicate-key or competing identity aborts the whole proposed chain.

Form creation requires a name component, normalized phone, valid origin/destination USPS state and five-digit ZIP, and the exact selected Local/long-distance Form Granularity (same two valid states → Local; differing valid states → long-distance). It derives persisted `local` from those accepted states and leaves `move_date` absent when the Observation omits it. Call Job-only creation is legal here; `ringcentral_convergence.state` is `pending` when a normalized phone exists and `not_applicable` when Job-only. The command stores available Granot facts only and fabricates no `local`, duration, start/end time, RingCentral session/call-log IDs, qualification, assignment, target number, or transport source. RingCentral assignment validation is configured-only: when any assignment row exists for the exact Call Source Company + Granularity, exactly one must be active/effective and point to an active, valid route; otherwise creation becomes `insufficient_creation_data` / `missing_creation_route_data`. Zero assignment rows means the route remains Granot-only and no assignment is invented. WordPress-created Form Leads that later match stay on `synchronizeLeadFromGranot` and never mint a second Lead.

After commit, `finalize` may send one Granot create-if-missing confirmation Lead Message through `sendGranotCreatedLeadConfirmation`. `evaluateGranotLeadSmsGates` requires all of: `LEAD_MESSAGING_MODE !== "disabled"`, `GRANOT_LEAD_CREATED_SMS_ENABLED`, CRM Source `outbound_sms` enabled, `lead_created_policy=create_if_missing`, a recorded consent basis (not `not_attested`), and a destination. A failed or blocked text never changes the Lead, Record Link, Decision, or Sheet Sync job. Quiet hours stay off unless `LEAD_MESSAGING_QUIET_HOURS_ENABLED=true`; then `resolveLeadSmsQuietHoursDeferral` applies (midnight–6:59 AM America/New_York held until 8:00 AM). Details: [`lead-messaging.md`](../services/lead-messaging.md).

Creation never opens a Booking/Release case, writes a Booking or Cancellation, sends email, or invokes RingCentral adoption. Checked-in flags stay processing true, shadow true, Lead writes/creation false. Unit 19 adds no migration, backfill, or index.

## Flags

Ten centralized flags (`src/config/domain/granotLifecycle.ts`): `GRANOT_LIFECYCLE_PROCESSING_ENABLED` and `GRANOT_LIFECYCLE_SHADOW_MODE` default true; the eight effect flags (`LEAD_WRITES`, `LEAD_CREATION`, `BOOKING_CASES`, `BOOKING_COMMANDS`, `RELEASE_CASES`, `RELEASE_COMMANDS`, `REFERRAL_BOOKING`, `EMAIL`) default false. Booking-case path also snapshots `referral_booking_enabled`. Processing false refuses this module unless a test supplies config.

## Out of scope here

Official Booking Owner commands (including Confirm Granot Cancellation on a booking case) live in [`booking-reconciliation.md`](./booking-reconciliation.md). Historical Release-case HTTP routes remain in [`release-reconciliation.md`](./release-reconciliation.md). Admin reads live in [`projections.md`](./projections.md). Discrepancy persistence is `discrepancies.ts` (no Service file in this cluster). Public Lead Zod / `updateSourceOwnedLead` are not a lifecycle write path. This module does not rewrite Registry rows. Current reviewed policies live in [`source-policy.md`](./source-policy.md) and [`operations-registry.md`](../services/operations-registry.md). `claimAndProcessOrPoll` lives in [`drainer.md`](./drainer.md), not `operations.ts`.

## Related

- Identity: [`identity.md`](./identity.md)
- Desired-state planner: [`desired-state.md`](./desired-state.md)
- Policy/gates: [`source-policy.md`](./source-policy.md)
- Drain/pending clock: [`drainer.md`](./drainer.md)
- Booking cases: [`booking-reconciliation.md`](./booking-reconciliation.md)
- Release cases: [`release-reconciliation.md`](./release-reconciliation.md)
- Executor / command registry: [`domain-commands.md`](../services/domain-commands.md)
- Software map: [`granot-lifecycle-capture.mdc`](../../../.cursor/rules/granot-lifecycle-capture.mdc)
