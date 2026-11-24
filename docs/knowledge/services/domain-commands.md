---
type: Service
title: "Domain Commands (`domainCommands/`)"
description: "Canonical idempotent write surface: one Mongo transaction, a compact durable command receipt, append-only EntityChange rows, and post-commit finalize."
tags: [domain-commands, system-of-record]
status: draft
stale_after: 2026-12-19
resource: src/services/domainCommands/idempotency.ts
applies_to:
  - src/services/domainCommands/idempotency.ts
  - src/services/domainCommands/existingWrites.ts
  - src/services/domainCommands/existingWriteContext.ts
  - src/services/domainCommands/commandContext.ts
  - src/services/domainCommands/entityChange.ts
  - src/services/domainCommands/leadChangeEmission.ts
  - src/services/domainCommands/ringcentralFinalResult.ts
  - src/services/domainCommands/callFormFillBackfill.ts
  - src/services/domainCommands/index.ts
  - src/services/domainCommands/retirement/shared.ts
  - src/services/domainCommands/retirement/entityChanges.ts
  - src/services/domainCommands/retirement/archivedEntityChanges.ts
  - src/services/domainCommands/retirement/commandExecutions.ts
  - src/models/EntityChange.ts
  - src/models/DomainCommandExecution.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/domainCommands/idempotency.ts
  - id: release-2026-11-19
    resource: docs/operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md
    title: Daily Operations, canonical commands and Master Sheets release (2026-11-19)
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
**Authority:** Final Granot Lead Lifecycle specification, Sections 23.1–23.4, 34.5, 35.1, 38/S07 (`scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`; `scripts/` is local-only, so it is not in a clean checkout)
**Latest release record:** [2026-11-19 release, "Lead, Booking and Cancellation commands"](../../operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md)
**Primary code:** `src/services/domainCommands/`, `src/models/DomainCommandExecution.ts`, `src/models/EntityChange.ts`
**Domain terms used:** [System of Record](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Observation Channel](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Entity Change](../../../../CONTEXT.md)

# Domain Commands (`domainCommands/`)

Canonical idempotent write surface for ingest and existing v1 write adapters. Mongo is the System of Record. The executor owns one Mongo transaction, the durable `DomainCommandExecution` receipt, append-only `EntityChange` rows, aggregate revision stamps, queued Sheet Sync outbox intent, and the replay/conflict decision. Sheet Sync does **not** complete commands.

Public v1 mutating routes derive trusted context via `existingWriteContextFromRequest` and enter `runExisting*` adapters. Those adapters call `executeCanonicalCommandWithPostCommit` once. Granot / RingCentral modules may call the executor directly without going through `canonicalDomainCommands`.

**Gap (labeled):** Checked-in Granot Lead-write / Booking-command / Release-command / Referral-command effect flags default to false (`config/domain/granotLifecycle.ts`). Registry entries and Owner command modules exist; HTTP/processor gates keep them off unless enabled. Do not describe those Owner paths as live owner operations.

## Registry vs executor callers

`canonicalDomainCommands` (`index.ts`) exports:

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

`existingWriteCanonicalCommands` adds `updateBookedLead`, `updateCancelledLead`, `createExistingReferralBooking` and the four `delete*` adapters.

**Not on the registry object** (they still call the executor): `confirmGranotBooking`, Connect Booking to Lead (`connectBookingToLead.ts`), Owner Booking No Action and Owner Release commands (`bookingConfirmation.ts` / `bookingOwnerCommands.ts` / `releaseOwnerCommands.ts`), `recordRingCentralFinalCallLogResult` (`ringcentralFinalResult.ts`) and `repairCallFormFillForReporting` (`callFormFillBackfill.ts`).

## Executor sequence

`executeIdempotentCanonicalCommand` ([`idempotency.ts`](../../../src/services/domainCommands/idempotency.ts)):

1. Fail-closed `assertCommandContext`, lowercase SHA-256 checksum, `connectMongo`, allocate logical `now` once, keep a caller-preallocated `command_id` when it is an ObjectId hex (otherwise mint one).
2. Open one Mongo session/transaction. Callback retries reuse the same clock and IDs.
3. Session-scoped read of `(origin, idempotency_key)`. An exact stored receipt replays; a different name or checksum raises `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`. Replay does **not** invoke the operation.
4. Origin `external_sheet_ingestion` stops here with "External sheet ingestion is permanently retired" (226dba24). Its stored receipts still replay in step 3.
5. Invoke `operation({ session, now, command_execution_id })`. The operation may persist a preallocated Decision, an expected-`domain_revision` aggregate change, one append-only `EntityChange` per changed aggregate, and queued Sheet Sync outbox intent.
6. Persist one `DomainCommandExecution` with top-level `entity_refs` and `warnings`. Since 49f9d8d5 no nested `result` is written. Commit once. A failure at aggregate, Change, receipt, outbox or commit leaves none of the chain visible.
7. After commit only: PII-safe telemetry (`domain_command.applied` or `domain_command.replayed`). Sheets, queue publish, email, CRM and other network calls are forbidden inside the transaction.
8. Duplicate key 11000: reload the durable receipt; return it only when name/checksum agree; otherwise conflict.

`executeCanonicalCommandWithPostCommit` runs the adapter finalizer (`finalizeSheetSync`, form/booking after-commit hooks) **only** after a successful **non-replay** commit when `pending` is defined. A no-op adapter returns `pending: undefined`, so finalize is skipped.

The executor **never** generates a Decision ID.

## Stored receipt vs compatibility adapter

- The applied outcome is `{ status: "applied", entity_refs, warnings }`. New receipts store it as top-level `entity_refs` and `warnings` only.
- `readStoredCanonicalCommandResult` (`DomainCommandExecution.ts`) reads a legacy nested `result` when present, otherwise the top-level fields. Both shapes replay identically.
- The 2026-11-19 maintenance removed the redundant nested `result` from 165,835 receipts, plus 546 in a second pass, where it exactly equalled the top-level fields for an allowlisted command/origin set ([`ops/capacity/compact-service-fields.cjs`](../../../ops/capacity/compact-service-fields.cjs)). 2,219 receipts keep their nested shape (external historical admission, RingCentral final-log recording, Granot case, discrepancy and Record Link reconciliation). A read-only replay of 78 compacted receipts across 13 command names returned 78 originals, rejected 78 changed payloads and ran zero operations (release record).
- Replay is identified by `outcome.replayed` and post-commit telemetry, not by rewriting the stored status to `already_applied`.
- `toCompatibilityCanonicalCommandResult` is a one-way adapter for existing ingestion counters that still count `already_applied`.
- Unique `(origin, idempotency_key)` and unique `command_id` remain the only replay authority.

## Command origins (`commandContext.ts`)

| Origin | Actor / initiator | Required provenance |
| --- | --- | --- |
| `external_sheet_ingestion` | System `best-relocation-ingestion` + trusted human initiator | run/receipt/connection. Context still validates; the executor rejects new operations (retired) and replays stored receipts |
| `vantage_admin` | Trusted owner/admin actor **and** initiator, **or** the two compatibility system IDs `vantage-api-secret` and `vantage-scoped-api-key:<fingerprint>` (same id + request_id) | existing admin rules; clients cannot supply context fields |
| `granot_lifecycle` | Fixed processor `{ actor_id: "granot-lifecycle-processor" }` | nonblank receipt/Observation/Decision; `source_receipt_id` === processor `request_id`; `observation_channel` ∈ `{granot_webhook, browser_extension, granot_http_automation}` and agrees with webhook or extension initiator. A `vantage_admin` Owner initiator is also accepted after those checks. |
| `ringcentral` | Fixed `ringcentral-call-ingest` actor **and** initiator | `verifyTrustedRingCentralTelephonyProvenance` — never a client boolean |

`browser_extension` is an Observation Channel / DurableActor origin, not a `CommandOrigin`. Unsupported origin → `INVALID_DOMAIN_COMMAND_CONTEXT`. Employee extension users cannot build existing-write context.

## Public / existing-write adapters

`*InTransaction` helpers accept `{ session, now, ingestion_origin? }` and must not call `withTransaction`, `runSheetSyncWrite`, or `finalizeSheetSync` (enforced by a `domainCommands.test.ts` source scan). They persist Sheet Sync intent / tombstones inside the executor session.

Form/Call create adapters derive Ingestion Origin from command origin/actor via `leadIngestionProvenance`; clients cannot supply `ingestion_origin`. Authorized Granot create does **not** use those public adapters: `createLeadFromGranot` loads the Observation, runs trusted `granot_lead_created` validators (`post_to_granot=false`), and writes the Lead plus active Record Link inside the same executor transaction.

Compatibility context (`existingWriteContextFromRequest`):

- Command ID is a server ObjectId hex.
- Idempotency is `existing:{command_name}:{submission_id}` when `submission_id` is a non-empty string; otherwise `request:{command_name}:{requestId}`.
- Payload checksum is SHA-256 of the canonicalized `{command_name, resource_id, payload}` (sorted keys, dates as ISO, `undefined` omitted).
- Actor: owner user from extension JWT; or `x-vantage-admin-*` plus API secret; or scoped-key fingerprint; or `vantage-api-secret`. Employee role throws.
- Provenance origin is always `vantage_admin` on this helper. No credential or key value is persisted.

Update adapters skip `EntityChange` + outbox + finalize when `collectDocumentFieldChanges` is empty (`pending` omitted). `updateSourceOwnedLead` `FORM_LEAD_CHANGE_PATHS` / `CALL_LEAD_CHANGE_PATHS` include `no_sync`; empty or same-value still no-ops. Create-from-lead duplicate outcome skips mutations but still finalizes the existing booking after-commit hook.

`updateBooking` (exact aggregate): CAS on `{ _id, domain_revision, not cancelled }`. Inactive agent/merchant → `GRANOT_VALIDATION_FAILED`. Empty field diff → no Change, no outbox, no finalize. Non-replay + mutated → `finalizeSheetSync` `booking_chain` / `booked_lead.update`.

Owner Booking commands use `assertOwnerCommandIdempotencyKey` (8–200 printable, no leading/trailing whitespace). Official details are one Binder plus `primary_agent_id` / optional `secondary_agent_id`; `bookings.ts` persists `officialBookingAllocations` (even-cent split), not client per-agent amounts. Booking No Action uses workflow-specific `resolveGranotBookingCaseNoAction`. Already-satisfied, No Action, and replay create no aggregate Change or Sheet work.

Owner Release commands (gated) use the same executor and envelope. Exact names in that module are `createCancellation`, `updateBooking`, and `resolveGranotReleaseCaseNoAction`. Public `POST /api/v1/cancelled-leads` is a different `createCancellation` adapter and still 409s Referral Bookings — see CONTRADICTIONS `public-v1-referral-cancel-vs-gated-release`.

## RingCentral final result and Form Fill repair

`persistRingCentralFinalCallLogResult` ([`ringcentralFinalResult.ts`](../../../src/services/domainCommands/ringcentralFinalResult.ts)) records or corrects the final Call Log result as `recordRingCentralFinalCallLogResult`. Qualification is preserved. Since f28048cf (2026-11-17) a repeated observation of unchanged facts only advances `ringcentral.final_result_observed_at` in its own transaction, after `assertCommandContext`. It writes no receipt, Entity Change or outbox intent; the watermark on the qualified Call Lead is the replay fence.

`repairCallFormFillForReporting` ([`callFormFillBackfill.ts`](../../../src/services/domainCommands/callFormFillBackfill.ts)) is an Owner/Admin-only `vantage_admin` command. It rechecks the eligible same-company, same-phone non-duplicate Form Lead inside the transaction, CAS-checks `domain_revision`, and writes the Lead change and Sheet intent together.

Public payloads cannot supply RingCentral/review/import automation suppression fields. Canonical billing policy: [Call Lead billing](../../call-lead-billing.md#form-fill-convergence-and-final-evidence-ordering); [November 4 review](../../call-billing-review-2026-11-04.md).

The Best Relocation review command (`externalSheetReview.ts`) and the final-reconciliation fence (`ingestion/finalReconciliationFence.ts`) were removed with external sheet ingestion (226dba24).

## EntityChange

`entity_changes` is append-only. `revision_after === revision_before + 1`. Contact/address/`$deleted` fields are `reference_only` with **no** raw values or hashes (`classifyEntityChangePath`). Low-risk relationship/lifecycle values, including `job_no` and `normalized_job_no`, may be `stored`. Unknown future paths are `reference_only`. Hashed mode is reserved. Surviving aggregates receive `last_change_id` / `last_changed_at` / `domain_revision` via CAS (`DOMAIN_REVISION_CONFLICT` on miss). Deletes persist the Change, then **skip** the revision stamp and remove the aggregate.

A semantic no-op performs no aggregate save, revision increment, Change or outbox write. Exact replay never re-enters the operation.

`sourceSystemForOrigin`: `granot_lifecycle` → `granot`; `ringcentral` → `ringcentral`; else `vantage`.

## Non-canonical Lead change emission (LP-03, 2026-09-22)

`leadChangeEmission.ts` lets Lead writers outside the executor persist the same append-only Lead `EntityChange` and `domain_revision` CAS in their own session: `emitLeadChange` (one Lead, before/after diff, optional `paths`), `LeadChangeRecorder` (`track` before the first write, `trackCreated` after an insert, `flush` before commit; one change per Lead, one shared `command_execution_id`), and `applyLeadChangeStamp`. A Lead with no stored `domain_revision` is initialized to `0` in the same session before the stamp.

These rows have **no** `DomainCommandExecution`; `command_execution_id` is freshly minted, and the owning workflow keeps its own idempotency. Contexts record who wrote; they are not authorization claims and are never passed to `assertCommandContext`:

- **RingCentral Call Lead create (E3):** `beginRingCentralCallLeadIngestion` emits `createCallLead` (`revision_before: 0`) with origin `ringcentral`, the fixed `ringcentral-call-ingest` actor/initiator, `source_receipt_id` = telephony session id (else Call Log id) and `source_connection_key` = `ringcentral:<ingestion_source>:<id>`. Idempotency stays with `upsertProcessedCall`.
- **Fixed `vantage_admin`-origin system actors:** `employee-booking-submission`, `booking-reconciliation-rematch`, `booking-lead-mirror`, `booking-source-resolver`, `form-fill-detector`. Owner reconciliation uses a trusted Owner actor.
- **`form_fill` flip (E13):** `markMatchingCallLeadsWithFormFill` emits `markCallLeadFormFill` with `changed_paths: ["form_fill"]` per flipped Call Lead, in the Form Lead create session.

## Storage, indexes and read paths

### `domain_command_executions`

Indexes declared in [`DomainCommandExecution.ts`](../../../src/models/DomainCommandExecution.ts) (`DOMAIN_COMMAND_EXECUTION_INDEXES`):

| Name | Key | Options | Main code query |
| --- | --- | --- | --- |
| `domain_command_origin_idempotency_unique` | `{ origin: 1, idempotency_key: 1 }` | unique | Executor replay `findOne({ origin, idempotency_key })` in the session; post-commit reloads in `bookingConfirmation.ts`, `referralBooking.ts`, `connectBookingToLead.ts` (`{ origin, command_name, idempotency_key }`) |
| `domain_command_command_id_unique` | `{ command_id: 1 }` | unique | Write constraint only |
| `domain_command_origin` | `{ origin: 1 }` | | `bookings.ts` and `cancelledLead.service.ts` external-ingestion ownership checks (`origin: "external_sheet_ingestion"`, `command_name`, `provenance.source_connection_key`, `entity_refs` `$elemMatch`) |
| `domain_command_applied_at` | `{ applied_at: -1 }` | | None found in `src/` |

Writers: the executor, and `granotLifecycle/operations.ts` `defaultPersistRequeueProvenance`, which inserts a receipt directly (origin `granot_lifecycle`) for a manual receipt requeue.

Retention: a receipt stays for the lifetime of possible retries: its origin, key, checksum, command identity, provenance and outcome are the replay fence. The release record rejected an age-only deletion or cold archive: either would need a permanent hot uniqueness fence plus a verified synchronous lookup.

**Validated retirement, phase 2 (Owner decision 5, 2026-11-23; off until enabled).** [Proposal §5](../../operations/VALIDATED-RETIREMENT-PROPOSALS-2026-11-23.md#domain_command_executions). A receipt leaves only when no producer can generate its `{origin, idempotency_key}` again, so **no compact fence row stays**. Code: `domainCommands/retirement/commandExecutions.ts`; cron `/api/cron/command-execution-retirement` every 10 minutes; operator `pnpm domain:command-execution-retirement` (`status`, `dry-run`, `install`, `enable`, `disable`, `run`, `lookup --id=<receipt>`); replica proof `ops/domain-commands/command-execution-retirement.replica.ts`.
- **Phase 1 held: `external_sheet_ingestion` stays (lead decision, 2026-11-24).** These 819 receipts could never replay (the origin is retired, 226dba24; the ownership checks in `bookings.ts` and `cancelledLead.service.ts` are unreachable), but they are the Best Relocation final reconciliation (run `6aea79aa80506078c37279fe`) and back billing evidence, which must outlive a 90-day archive. The worker reads them and holds them as `billing_evidence_best_relocation`.
- **Fresh-`command_id` keys.** The keys that embed a fresh `command_id` (`leadChangeEmission.ts`: `<actor>:<command>:<command_id>`, `owner:<command>:<command_id>`) write no receipt: production holds none (2026-11-24 count). Nothing to retire.
- **Phase 2, Granot processor receipts.** Only keys `granot:synchronize-lead:<Observation>` and `granot:create-lead:<Observation>` with the fixed `granot-lifecycle-processor` actor and that Observation in `provenance`. The processor builds them only from a hot receipt (`defaultLoadReceipt`) and the Observation upserted from it; the row leaves once Granot retention has removed both from `granot_webhook_receipts` and `granot_observations` (nothing restores them hot; a redelivery meets the retired-operation fence or becomes a new receipt with a new Observation, so a new key).
- **Held, by design.** Other `granot_lifecycle` keys (`key_not_receipt_bound`): scheduled-estimate keys are deterministic on the scheduled run; Form-sibling keys on the Lead revision and an Owner backfill can re-run them; Owner booking, release and discrepancy commands carry client-supplied keys. `vantage_admin` and `ringcentral` receipts are not read.
- **Every retired receipt:** each `entity_refs` record (Form Lead, Call Lead, Record Link; a receipt's reference to itself is ignored) must exist; any other model holds. Five-minute settle.
- **Archive.** Proven receipts are packed (exact BSON) to GCS (`domain-records-retirement`, 90 days), read back byte for byte, catalogued in `domain_command_execution_archive_packs` (TTL 89 days, `_id` range), then deleted in a snapshot transaction that rechecks their exact bytes. Held receipts stay and are re-reviewed a day after each full pass (`_id` order).
- **Dry run, production, 2026-11-24 01:17 UTC** (read-only, secondary): 164,809 receipts of the two origins reviewed; **162,370 Granot processor receipts retirable, 196.2 MB logical**. Held: 1,020 `key_not_receipt_bound`, 819 `billing_evidence_best_relocation` (1.1 MB), 463 `source_observation_hot`, 129 `entity_ref_missing`, 8 `source_receipt_hot`.
- **Next step, phases 3–4 (not built).** The Owner approved a 30-day bound (2026-11-23) for RingCentral keys (sync re-reads 12 hours in steady state; the 90-day duplicate guard is the backstop) and for Admin client keys, which keep a compact fence `{origin, key, command_name, checksum, entity_refs, warnings}`.

Measured baseline (release record; [`operations-command-sheets-final-stock.json`](../../operations/evidence/operations-command-sheets-final-stock.json)):

- Stock after compaction, 2026-11-19: 168,378 receipts, 193.79 MiB logical, 75.43 MiB allocated data, 13.88 MiB indexes.
- November 18 (New York day): 244 receipts, 332,878 BSON bytes, peak 28 at 11:00.
- The origin/key point lookup examined 1 key and 1 document.
- Index access counters on the primary, 2026-11-18T20:50Z to 2026-11-19T23:13Z: `domain_command_origin_idempotency_unique` 377, `domain_command_applied_at` 238, `domain_command_origin` 8, `domain_command_command_id_unique` 0, `_id_` 696. Counters reset on restart and include measurement queries.

### `entity_changes`

Indexes declared in [`EntityChange.ts`](../../../src/models/EntityChange.ts) (`ENTITY_CHANGE_INDEXES`, `autoIndex: false`):

| Name | Key | Options | Main code query |
| --- | --- | --- | --- |
| `entity_change_entity_revision_unique` | `{ entity.model: 1, entity.id: 1, revision_after: 1 }` | unique | Write constraint; entity-prefix reads |
| `entity_change_entity_applied` | `{ entity.model: 1, entity.id: 1, applied_at: -1 }` | | Per-entity history: Sales Intelligence history (sort `applied_at -1`), Granot lifecycle projections, Outreach assignment history (`changed_paths: "receiver_agent"`), Number Activity wakes (`provenance.observation_id` or `_id $in`), job timeline |
| `entity_change_command_execution_id` | `{ command_execution_id: 1 }` | | None found in `src/` |
| `entity_change_changed_paths_applied` | `{ changed_paths: 1, applied_at: -1 }` | | None found in `src/`; every `changed_paths` filter also names the entity |

Indexes present in production but not declared in code ([final stock evidence](../../operations/evidence/operations-command-sheets-final-stock.json)):

| Name | Key | Main code query |
| --- | --- | --- |
| `entity_change_applied_scan` | `{ applied_at: 1, _id: 1 }` | Outreach feed tail and overlap (`salesOutreach/subjects/feed.ts`) and Number Activity lead-link recovery (`numberActivity/leadLinkJobs.ts`): `{ entity.model: $in Leads, (applied_at, _id) > cursor }` sorted `applied_at 1, _id 1` |
| `entity_change_granot_observation_ref_v1` | `{ provenance.observation_id: 1 }`, sparse | Granot history retention references (`granotHistory/retentionReferences.ts`) |
| `entity_change_granot_decision_ref_v1` | `{ provenance.decision_id: 1 }`, sparse | Same |
| `entity_change_granot_receipt_ref_v1` | `{ provenance.receipt_id: 1 }`, sparse | Same |

The three provenance indexes were installed in production on 2026-11-18 ([Granot hot storage record](../../operations/GRANOT-HOT-STORAGE-2026-11-18.md)). The origin of `entity_change_applied_scan` is not recorded in code.

Other readers: the Outreach live stream watches `entity_changes` inserts for metric models (change stream, not a query; `salesOutreach/live/stream.ts`).

Retention: no expiry. Granot history and reference protection, the detailed timeline, Sales Intelligence history, Desk evaluation, assignment reconstruction, the Outreach `(applied_at, _id)` tail and Number Activity lead-link recovery read them. Advancing one reader's checkpoint cannot release evidence another reader needs (release record).

**Validated retirement of the Granot incident revisions (Owner decision 5, 2026-11-23; off until enabled).** The narrow rule of [proposal §5](../../operations/VALIDATED-RETIREMENT-PROPOSALS-2026-11-23.md#5-entity_changes-and-domain_command_executions-decision-7-after-the-reader-inventory). Code: `domainCommands/retirement/entityChanges.ts`; cron `/api/cron/entity-change-retirement` every 10 minutes; operator `pnpm domain:entity-change-retirement` (`status`, `dry-run`, `install`, `enable`, `disable`, `run`, `lookup --id=<change>` or `--entity=<CallLead id>`); replica proof `ops/domain-commands/entity-change-retirement.replica.ts`.
- **Reviewed rows.** Only a Call Lead row from `synchronizeLeadFromGranot` with `revision_before > 0` whose `changed_paths` are only `last_accepted_granot_observation` and/or `current_move_provenance`. Such a row is never a creation, job-number or `receiver_agent` row. Every other row is never read by the worker.
- **Proof, per row:** a later revision exists; both lead-change tails (`outreach_entity_changes`, `lead_link_entity_changes` in `sales_intelligence_sync_state`) are past its `applied_at` by more than the larger of their overlaps (120 s each), and a missing tail cursor makes nothing reviewable; it is strictly older than the Lead's 50th newest row by `applied_at` (the Sales Intelligence history reads those 50, sorted the same way); no receipt, Observation or Decision named in `provenance` is hot.
- **Archive.** Proven rows only are packed (exact BSON) to GCS (`domain-records-retirement`, 90 days), read back byte for byte, catalogued in `entity_change_archive_packs` (TTL 89 days; `_id` range and `entity_ids`), then deleted in a snapshot transaction that rechecks their exact bytes. A held row needs no copy: it stays in MongoDB. The scan walks `entity_change_entity_revision_unique` in Lead order, so one Lead's rows share few packs; a finished pass rests a day, then re-reviews the holds.
- **Readers after retirement.** The Granot lead and job timelines (`projections.ts`) and the Job Number Timeline (`mongo-evidence-loader.ts`) display every Entity Change of their entities, unfiltered, so they read retired rows back by entity (`readArchivedEntityChanges`: one catalog query, a GCS read only for a Lead with retired rows). The read is bounded before any GCS read by the catalog's per-Lead counts (`entity_rows`; the Job Number Timeline's `maxRowsPerQuery`, otherwise 2,000), reads three packs at a time under a 20 s deadline, and fails closed: an unreadable pack, or one missing before its catalog row's `expires_at`, fails the read. A pack reused by a retry keeps its catalog expiry on that object's own recovery clock. Sales Intelligence history (newest 50), assignment reconstruction (`receiver_agent` rows), both tails (cursors past) and the Granot reference holds (records already retired) lose nothing. A retired row leaves the archive after 90 days; the revision chain then has gaps, which no reader checks.
- **Dry run, production, 2026-11-24 00:50 UTC** (read-only, secondary): 142,658 incident rows reviewed; **111,426 retirable (126.0 MB logical) on 621 Call Leads**; held 30,641 newest-50 and 591 latest-revision rows; none held for a tail or a hot Granot record.

Measured baseline:

- Stock, 2026-11-19: 178,766 changes, 215.68 MiB logical, 33.84 MiB allocated data, 35.19 MiB indexes. No change was compacted.
- November 18: 374 changes, 758,733 BSON bytes, peak 50 at 22:00.
- An earlier active-traffic study measured 75.8 entity-change reads/second over two minutes ([2026-11-19 study](../../../../storage-capacity-analysis-2026-11-17/post-granot-2026-11-19/REPORT.md)).
- The entity-history sample examined 5 keys and 5 documents on `entity_change_entity_applied`. The tail cursor chose `entity_change_applied_scan`.
- Index access counters on the primary, 2026-11-18T20:50Z to 2026-11-19T23:13Z: `entity_change_granot_observation_ref_v1` 58,127, `entity_change_entity_revision_unique` 26,324, `entity_change_applied_scan` 6,306, `entity_change_granot_receipt_ref_v1` 1,342, `entity_change_granot_decision_ref_v1` 1,342, `entity_change_command_execution_id` 12, `entity_change_entity_applied` 4, `entity_change_changed_paths_applied` 0.
- On 2026-11-17, `entity_change_changed_paths_applied` was the largest index on the collection (9,461,760 bytes) ([index sizing](../../capacity-review-2026-11-16/evidence/w4-index-sizing-owner-run-2026-11-17.json)).

### Observations for the index phase

- `entity_change_applied_scan` serves the two most frequent tails but is not declared in `ENTITY_CHANGE_INDEXES`. A database built from code would lack it.
- The three Granot provenance indexes are also undeclared in code.
- `entity_change_changed_paths_applied` has no code query, recorded 0 accesses and was the largest index.
- `entity_change_command_execution_id` and `domain_command_applied_at` have no code query in `src/`. They recorded 12 and 238 accesses; the source of those accesses is unmeasured.
- Per-entity history reads chose `entity_change_entity_revision_unique` far more often (26,324) than `entity_change_entity_applied` (4). Which queries chose which index is unmeasured.
- `domain_command_origin` serves only retired external-ingestion checks.
