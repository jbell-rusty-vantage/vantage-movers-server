**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)
**Authority:** [Final Granot Lead Lifecycle specification](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) Sections 23.1–23.4, 34.5, 35.1, 38/S07
**Primary code:** `src/services/domainCommands/`, `src/models/EntityChange.ts`
**Domain terms used:** System of Record, Sheet Sync, Observation Channel, Booking, Cancellation, Entity Change

# Domain Commands (`domainCommands/`)

Canonical idempotent write surface for ingest and existing v1 write adapters. Mongo is the System of Record. The executor owns one Mongo transaction, the durable `DomainCommandExecution` result, append-only `EntityChange` rows, aggregate revision stamps, queued Sheet Sync outbox intent, and the replay/conflict decision. Sheet Sync does **not** complete commands.

`synchronizeLeadFromGranot`, `createLeadFromGranot`, `confirmGranotBooking`, exact aggregate `updateBooking`, and `resolveGranotBookingCaseNoAction` are registered Granot lifecycle commands. Policy and case orchestration live in `granotLifecycle/`; this registry stays thin. Unit 25 composes the Booking replacement primitive with the case CAS so Booking/derived-Lead Changes, case resolution, Command, and queued Booking Chain intent commit atomically. Referral, Release, and Record Link correction commands remain disabled. Checked-in effect flags stay false.

## Executor sequence

`executeIdempotentCanonicalCommand`:

1. Fail-closed context validation, lowercase SHA-256 checksum, connect, allocate logical `now` once, preserve caller-preallocated command/causal IDs.
2. Open one Mongo session/transaction. Callback retries reuse the same clock and IDs.
3. Session-scoped read of `(origin, idempotency_key)`. Exact stored result replay, or `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` when name/checksum disagree. Replay does not invoke the operation.
4. Invoke `operation({ session, now, command_execution_id })`. The operation may persist a preallocated Decision, expected-`domain_revision` aggregate change, one append-only `EntityChange` per changed aggregate, and queued Sheet Sync outbox intent.
5. Persist one `DomainCommandExecution` with nested `result.status: "applied"` plus compatibility top-level `entity_refs` / `warnings`. Commit once. Failure at aggregate, Change, Command, outbox, or commit leaves none of the proposed chain visible.
6. After commit only: PII-safe operational telemetry (`domain_command.applied` or `domain_command.replayed`). Sheets, queue publish, email, CRM, and other network calls are forbidden inside the transaction.
7. Duplicate-key 11000: reload durable execution; return it only when name/checksum agree; otherwise conflict.
8. Any operation/persist/commit failure leaves no visible Decision, aggregate delta, or command row.

`executeCanonicalCommandWithPostCommit` wraps the executor and runs existing adapter finalizers only after a successful non-replay commit.

## Stored result vs compatibility adapter

- Durable/domain result is always `{ status: "applied", entity_refs, warnings }`.
- Replay is identified by `outcome.replayed` and post-commit telemetry, not by rewriting the stored status to `already_applied`.
- `toCompatibilityCanonicalCommandResult` is a one-way adapter for existing ingestion counters that still count `already_applied`.
- Legacy rows without `result` derive the same stored shape from top-level refs/warnings. They are not backfilled or rewritten.
- Unique `(origin, idempotency_key)` and unique `command_id` remain the only replay authority.

## Command origins

| Origin | Actor / initiator | Required provenance |
| --- | --- | --- |
| `external_sheet_ingestion` | System `best-relocation-ingestion` + trusted human initiator | run/receipt/connection |
| `vantage_admin` | Trusted owner/admin actor and initiator, or the two exact compatibility system IDs `vantage-api-secret` and `vantage-scoped-api-key:<fingerprint>` | existing admin rules; clients cannot supply context fields |
| `granot_lifecycle` | Fixed processor `{ actor_id: "granot-lifecycle-processor" }`; webhook initiator `granot-webhook` or a server-authenticated Owner | nonblank receipt/Observation/Decision; `source_receipt_id` === processor `request_id`; `observation_channel` agrees with the initiator path |
| `ringcentral` | Fixed `ringcentral-call-ingest` actor and initiator | server-verified telephony provenance — never a client boolean |

`browser_extension` is an Observation Channel / DurableActor origin, not a `CommandOrigin`. The executor never generates a Decision ID.

## Transaction-bound internals and existing adapters

Affected v1 create/update/delete routes derive trusted context via `existingWriteContextFromRequest` and call `runExisting*` adapters. Those adapters enter the executor once. Form/Call create adapters derive Ingestion Origin from command origin/actor via `leadIngestionProvenance` and pass it into the create transaction; clients cannot supply `ingestion_origin`. Authorized Granot create does not use those public adapters: `createLeadFromGranot` loads the Observation, runs trusted `granot_lead_created` validators (`post_to_granot=false`), and writes the Lead plus active Record Link inside the same executor transaction. Form/Call create `*InTransaction` helpers accept `{ session, now, ingestion_origin }` and must not call `withTransaction`, `runSheetSyncWrite`, or `finalizeSheetSync`. Public noncanonical service functions may still wrap `runSheetSyncWrite` for non-route callers.

Compatibility context: Command ID is a server ObjectId hex; idempotency is `submission_id` when present, otherwise `request:{command}:{requestId}`; payload checksum is SHA-256 of the canonicalized `{command_name, resource_id, payload}`. No credential or key value is persisted.

## EntityChange

`entity_changes` is append-only. `revision_after === revision_before + 1`. Contact/address/`$deleted` fields are `reference_only` with no raw values or hashes. Low-risk relationship/lifecycle values may be `stored`. Hashed mode is reserved and is not invented for contact. Surviving aggregates receive `last_change_id` / `last_changed_at` / `domain_revision`. Deletes persist the Change then remove the aggregate; no missing document retains `last_change_id`.

A semantic no-op performs no aggregate save, revision increment, Change, or outbox write. Exact replay never re-enters the operation.

Owner Booking commands use `assertOwnerCommandIdempotencyKey` for the 8–200 printable envelope. `updateBooking` persists the exact command name; Booking No Action uses workflow-specific `resolveGranotBookingCaseNoAction`. Already-satisfied, No Action, and replay create no aggregate Change or Sheet work.
