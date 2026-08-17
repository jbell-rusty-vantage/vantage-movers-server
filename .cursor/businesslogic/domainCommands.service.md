**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Authority:** [Final Granot Lead Lifecycle specification](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) Sections 23.1–23.2, 24 common envelope, 25, 27, 38/S07  
**Primary code:** `src/services/domainCommands/`  
**Domain terms used:** System of Record, Sheet Sync, Observation Channel, Booking, Cancellation

# Domain Commands (`domainCommands/`)

Canonical idempotent write surface for ingest and (later) lifecycle/owner commands. Mongo is the System of Record. The executor owns one Mongo transaction, the durable `DomainCommandExecution` result, and the replay/conflict decision. Sheet Sync does **not** complete commands.

**Unit 11 still owns** `EntityChange`, complete outbox atomicity, and wholesale adapter canonicalization. This module does not enable Granot/RingCentral lifecycle callers or any lifecycle effect flag.

## Executor sequence

`executeIdempotentCanonicalCommand`:

1. Fail-closed context validation, lowercase SHA-256 checksum, connect, allocate logical `now` once, preserve caller-preallocated command/causal IDs.
2. Open one Mongo session/transaction. Callback retries reuse the same clock and IDs.
3. Session-scoped read of `(origin, idempotency_key)`. Exact stored result replay, or `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` when name/checksum disagree. Replay does not invoke the operation.
4. Invoke `operation({ session, now })`. The operation may persist a preallocated Decision and expected-`domain_revision` aggregate change.
5. Persist one `DomainCommandExecution` with nested `result.status: "applied"` plus compatibility top-level `entity_refs` / `warnings`. Commit once.
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
| `vantage_admin` | Trusted owner/admin actor and initiator | existing admin rules |
| `granot_lifecycle` | Fixed processor `{ actor_id: "granot-lifecycle-processor" }`; webhook initiator `granot-webhook` or a server-authenticated Owner | nonblank receipt/Observation/Decision; `source_receipt_id` === processor `request_id`; `observation_channel` agrees with the initiator path |
| `ringcentral` | Fixed `ringcentral-call-ingest` actor and initiator | server-verified telephony provenance — never a client boolean |

`browser_extension` is an Observation Channel / DurableActor origin, not a `CommandOrigin`. The executor never generates a Decision ID.

## Transaction-bound internals

Current canonical adapters call `*InTransaction` helpers that accept `{ session, now }`. Those internals must not call `withTransaction`, `runSheetSyncWrite`, or `finalizeSheetSync`. Public noncanonical service paths still own their existing `runSheetSyncWrite` + finalize loop until Unit 11.

Owner HTTP `Idempotency-Key` parsing, Booking/Cancellation case commands, and `already_satisfied` remain later units. The helper `assertOwnerCommandIdempotencyKey` preserves the 8–200 printable envelope.
