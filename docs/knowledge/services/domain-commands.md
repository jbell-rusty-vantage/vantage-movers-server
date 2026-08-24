---
type: Service
title: "Domain Commands (`domainCommands/`)"
description: "Canonical idempotent write surface: one Mongo transaction, EntityChange rows, and post-commit finalize."
tags: [domain-commands, system-of-record]
status: draft
stale_after: 2026-11-20
resource: src/services/domainCommands/idempotency.ts
applies_to:
  - src/services/domainCommands/idempotency.ts
  - src/services/domainCommands/existingWrites.ts
  - src/services/domainCommands/existingWriteContext.ts
  - src/services/domainCommands/commandContext.ts
  - src/services/domainCommands/entityChange.ts
  - src/services/domainCommands/index.ts
  - src/models/EntityChange.ts
  - src/models/DomainCommandExecution.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/domainCommands/idempotency.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-08-24T18:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)
**Authority:** [Final Granot Lead Lifecycle specification](../../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) Sections 23.1–23.4, 34.5, 35.1, 38/S07
**Primary code:** `src/services/domainCommands/`, `src/models/EntityChange.ts`
**Domain terms used:** [System of Record](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Observation Channel](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Entity Change](../../../../CONTEXT.md)

# Domain Commands (`domainCommands/`)

Canonical idempotent write surface for ingest and existing v1 write adapters. Mongo is the System of Record. The executor owns one Mongo transaction, the durable `DomainCommandExecution` result, append-only `EntityChange` rows, aggregate revision stamps, queued Sheet Sync outbox intent, and the replay/conflict decision. Sheet Sync does **not** complete commands.

Public v1 mutating routes derive trusted context via `existingWriteContextFromRequest` and enter `runExisting*` adapters. Those adapters call `executeCanonicalCommandWithPostCommit` once. Granot / RingCentral modules may call the executor directly without going through `canonicalDomainCommands`.

**Gap (labeled):** Checked-in Granot Lead-write / Booking-command / Release-command / Referral-command effect flags stay false. Registry entries and Owner command modules exist; HTTP/processor gates keep them off. Do not describe those Owner paths as live owner operations.

## Registry vs executor callers

`canonicalDomainCommands` (`index.ts`) currently exports:

| Name | Module |
|------|--------|
| `createFormLead` / `createCallLead` / `updateSourceOwnedLead` | `leads.ts` → `existingWrites` |
| `createBookingFromLead` / `createLeadlessBooking` / `attachBookingToLead` | `bookings.ts` |
| `createCancellation` | `cancellations.ts` → public/import adapter (not the gated Release command) |
| `createLeadFromGranot` / `synchronizeLeadFromGranot` | `granotLifecycle/` |
| `updateBooking` | exact aggregate primitive in `bookings.ts` |
| `createReferralBooking` | Granot `referralBooking.ts` (`createReferralBookingCanonical`) |
| `adoptRingCentralCall` / `markRingCentralConvergenceConflict` | `ringcentral/callLeadConvergence.service.ts` |
| `reEvaluateGranotDiscrepancy` / `correctGranotRecordLink` / `resolveGranotDiscrepancyNoAction` | `discrepancyOwnerCommands.ts` |

`existingWriteCanonicalCommands` adds public update/delete + `createExistingReferralBooking`.

**Not on the registry object** (they still call the executor when invoked): `confirmGranotBooking`, Owner Booking No Action, and Owner Release commands in `bookingConfirmation.ts` / `bookingOwnerCommands.ts` / `releaseOwnerCommands.ts`.

## Executor sequence

`executeIdempotentCanonicalCommand`:

1. Fail-closed `assertCommandContext`, lowercase SHA-256 checksum, `connectMongo`, allocate logical `now` once, keep caller-preallocated `command_id` when it is an ObjectId hex (otherwise mint one).
2. Open one Mongo session/transaction. Callback retries reuse the same clock and IDs (tested).
3. Session-scoped read of `(origin, idempotency_key)`. Exact stored result replay, or `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` when name/checksum disagree. Replay does **not** invoke the operation.
4. Invoke `operation({ session, now, command_execution_id })`. The operation may persist a preallocated Decision, expected-`domain_revision` aggregate change, one append-only `EntityChange` per changed aggregate, and queued Sheet Sync outbox intent.
5. Persist one `DomainCommandExecution` with nested `result.status: "applied"` plus compatibility top-level `entity_refs` / `warnings`. Commit once. Failure at aggregate, Change, Command, outbox, or commit leaves none of the proposed chain visible.
6. After commit only: PII-safe operational telemetry (`domain_command.applied` or `domain_command.replayed`). Sheets, queue publish, email, CRM, and other network calls are forbidden inside the transaction.
7. Duplicate-key 11000: reload durable execution; return it only when name/checksum agree; otherwise conflict.
8. Any operation/persist/commit failure leaves no visible Decision, aggregate delta, or command row.

`executeCanonicalCommandWithPostCommit` wraps the executor and runs existing adapter finalizers (`finalizeSheetSync`, form/booking after-commit hooks) **only** after a successful **non-replay** commit when `pending` is defined. A no-op adapter returns `pending: undefined` so finalize is skipped.

The executor **never** generates a Decision ID.

## Stored result vs compatibility adapter

- Durable/domain result is always `{ status: "applied", entity_refs, warnings }`.
- Replay is identified by `outcome.replayed` and post-commit telemetry, not by rewriting the stored status to `already_applied`.
- `toCompatibilityCanonicalCommandResult` is a one-way adapter for existing ingestion counters that still count `already_applied`.
- Legacy rows without `result` derive the same stored shape from top-level refs/warnings. They are not backfilled or rewritten.
- Unique `(origin, idempotency_key)` and unique `command_id` remain the only replay authority.

## Command origins (`commandContext.ts`)

| Origin | Actor / initiator | Required provenance |
| --- | --- | --- |
| `external_sheet_ingestion` | System `best-relocation-ingestion` + trusted human initiator | run/receipt/connection; Best Relocation import guard on create/update |
| `vantage_admin` | Trusted owner/admin actor **and** initiator, **or** the two compatibility system IDs `vantage-api-secret` and `vantage-scoped-api-key:<fingerprint>` (same id + request_id) | existing admin rules; clients cannot supply context fields |
| `granot_lifecycle` | Fixed processor `{ actor_id: "granot-lifecycle-processor" }` | nonblank receipt/Observation/Decision; `source_receipt_id` === processor `request_id`; `observation_channel` ∈ `{granot_webhook, browser_extension, granot_http_automation}` and agrees with webhook or extension initiator. A `vantage_admin` Owner initiator is also accepted after those checks. |
| `ringcentral` | Fixed `ringcentral-call-ingest` actor **and** initiator | `verifyTrustedRingCentralTelephonyProvenance` — never a client boolean |

`browser_extension` is an Observation Channel / DurableActor origin, not a `CommandOrigin`. Unsupported origin → `INVALID_DOMAIN_COMMAND_CONTEXT`. Employee extension users cannot build existing-write context.

## Public / existing-write adapters

`*InTransaction` helpers accept `{ session, now, ingestion_origin? }` and must not call `withTransaction`, `runSheetSyncWrite`, or `finalizeSheetSync` (enforced by `domainCommands.test.ts` source scan). They persist Sheet Sync intent / tombstones inside the executor session. Public noncanonical service functions may still wrap `runSheetSyncWrite` for non-route callers.

Form/Call create adapters derive Ingestion Origin from command origin/actor via `leadIngestionProvenance`; clients cannot supply `ingestion_origin`. Best Relocation sheet origin injects `ingestion_source: "best_relocation_sheet"` and requires the BR source company. Authorized Granot create does **not** use those public adapters: `createLeadFromGranot` loads the Observation, runs trusted `granot_lead_created` validators (`post_to_granot=false`), and writes the Lead plus active Record Link inside the same executor transaction.

Compatibility context (`existingWriteContextFromRequest`):

- Command ID is a server ObjectId hex.
- Idempotency is `existing:{command_name}:{submission_id}` when `submission_id` is a non-empty string; otherwise `request:{command_name}:{requestId}`.
- Payload checksum is SHA-256 of the canonicalized `{command_name, resource_id, payload}` (sorted keys, dates as ISO, `undefined` omitted).
- Actor: owner user from extension JWT; or `x-vantage-admin-*` plus API secret; or scoped-key fingerprint; or `vantage-api-secret`. Employee role throws.
- Provenance origin is always `vantage_admin` on this helper. No credential or key value is persisted.

Update adapters skip `EntityChange` + outbox + finalize when `collectDocumentFieldChanges` is empty (`pending` omitted). Create-from-lead duplicate outcome skips mutations but still finalizes the existing booking after-commit hook.

`updateBooking` (exact aggregate): CAS on `{ _id, domain_revision, not cancelled }`. Inactive agent/merchant → `GRANOT_VALIDATION_FAILED`. Empty field diff → no Change, no outbox, no finalize. Non-replay + mutated → `finalizeSheetSync` `booking_chain` / `booked_lead.update`.

Owner Booking commands use `assertOwnerCommandIdempotencyKey` (8–200 printable, no leading/trailing whitespace). Exact registered name for the aggregate replace is `updateBooking`. Official details are one Binder plus `primary_agent_id` / optional `secondary_agent_id`; `bookings.ts` persists `officialBookingAllocations` (even-cent split), not client per-agent amounts. Booking No Action uses workflow-specific `resolveGranotBookingCaseNoAction` (not on the thin registry). Already-satisfied, No Action, and replay create no aggregate Change or Sheet work.

Owner Release commands (gated) use the same executor and envelope. Exact names in that module are `createCancellation`, `updateBooking`, and `resolveGranotReleaseCaseNoAction`. Public `POST /api/v1/cancelled-leads` is a different `createCancellation` adapter and still 409s Referral Bookings — see CONTRADICTIONS `public-v1-referral-cancel-vs-gated-release`.

## EntityChange

`entity_changes` is append-only. `revision_after === revision_before + 1`. Contact/address/`$deleted` fields are `reference_only` with **no** raw values or hashes (`classifyEntityChangePath`). Low-risk relationship/lifecycle values may be `stored`. Unknown future paths are `reference_only`. Hashed mode is reserved and is not invented for contact. Surviving aggregates receive `last_change_id` / `last_changed_at` / `domain_revision` via CAS (`DOMAIN_REVISION_CONFLICT` on miss). Deletes persist the Change then **skip** the revision stamp and remove the aggregate; no missing document retains `last_change_id`.

A semantic no-op performs no aggregate save, revision increment, Change, or outbox write. Exact replay never re-enters the operation.

`sourceSystemForOrigin`: `granot_lifecycle` → `granot`; `ringcentral` → `ringcentral`; else `vantage`.
