# Unit 11 completion — Entity Change, outbox atomicity, and canonicalization of existing write adapters

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 14.1, 23.1–23.4, 27, 34.5 and 34.7, 35–37, 38/S07, and 39–41
- **Acceptance ownership:** Change/outbox/revision foundation of AC-21 and AC-32. Units 24–25/27 own case-command races; Units 18/24–25/27 complete accepted-Observation causal/no-op proof at their production effects.
- **Applicable invariants preserved:** 1 (Mongo is SoR for Command/Change/revision/outbox), 2 (canonicalization grants no automatic official Booking/Cancellation effect), 4 (Booking/Referral uniqueness unchanged), 5 (affected create/update/delete enter the executor once), 6 (Command + Change + revision + queued outbox in one transaction), 7 (no-op and replay create no Change/outbox/revision increment), 8 (source system, channel, actor, initiator, receipt, Observation, Decision, case, discrepancy, run, and request stay independent), 9 (Changes are append-only; rollback never rewrites them), 10 (source/CPL guards preserved)
- **Runtime posture:** no flag, caller, or later Section 23.4 command enabled. Unit 07 defaults remain: processing true, shadow true, all eight effect flags false.

## Files added or changed

### Model / indexes

- `src/models/EntityChange.ts` — exact Section 23.3 document; collection `entity_changes`; four named indexes; append-only hooks; privacy validators
- `src/models/EntityChange.test.ts`
- `scripts/migrations/granot-lifecycle-indexes.lib.ts`, `.ts`, `.test.ts` — catalog `granot-lifecycle-indexes/7`; non-unique EntityChange indexes first; unique entity/revision after zero collisions
- `scripts/test-granot-lifecycle-replica.ts` — unit `11` registration

### Change builder / executor / context

- `src/services/domainCommands/entityChange.ts` — path classification, field builders, delete descriptor, `persistEntityChangeMutations`
- `src/services/domainCommands/existingWriteContext.ts` — server-only context factory (ObjectId command id, `submission_id` or request-scoped idempotency, SHA-256 payload checksum)
- `src/services/domainCommands/idempotency.ts` — preallocated `now` + `command_execution_id` outside the retry callback
- `src/services/domainCommands/commandContext.ts` — compatibility system IDs `vantage-api-secret` and `vantage-scoped-api-key:<fingerprint>` with origin `vantage_admin`
- `src/services/domainCommands/types.ts`, `durableWork/types.ts` — `command_execution_id`; `vantage_admin` system origin
- `src/middleware/requireApiSecret.ts` — scoped-key fingerprint is a hash of the secret, never the secret

### Adapters / transaction-bound internals / routes

- `src/services/domainCommands/existingWrites.ts` — route-facing runners that persist Changes and return service envelopes
- `src/services/domainCommands/leads.ts`, `bookings.ts`, `cancellations.ts`, `index.ts`
- `src/services/leads/formLead.service.ts`, `callLead.service.ts`
- `src/services/bookings/bookedLead.service.ts`, `bookedLeadFromSource.service.ts`, `referralBooking.service.ts`
- `src/services/cancellations/cancelledLead.service.ts`
- `src/routes/v1.routes.ts` — affected Form/Call/Booking/from-source/Referral/leadless/Cancellation create/update/delete go through adapters + `existingWriteContextFromRequest`

### Tests

- `src/services/domainCommands/entityChange.test.ts`
- `src/services/domainCommands/entityChange.integration.test.ts`
- `src/services/domainCommands/domainCommands.test.ts`
- `src/services/leads/formLead.service.test.ts` — stub supports `.session()` on `findById`

### Docs

- `.cursor/businesslogic/domainCommands.service.md`, `sheetSync.service.md`, `form-lead.service.md`, `call-lead.service.md`, `bookings.service.md`, `cancelledLead.service.md`, `granotLifecycle.revisions.md`
- `.cursor/index.md`
- `.cursor/rules/project-organization.mdc`, `schema-and-crud-inputs.mdc`, `business-logic.mdc`, `sheet-sync-process.mdc`

## Exact contracts landed

### EntityChange (23.3 / AC-32 privacy)

Contact/address/`$deleted` are `reference_only` with no raw before/after values or hashes. Low-risk relationship/lifecycle values may be `stored`. Hashed mode is reserved and is not invented for contact. `changed_paths` is unique, sorted, and matches `fields.path`. `revision_after === revision_before + 1`. Application updates/deletes are rejected.

Indexes:

```text
{ "entity.model": 1, "entity.id": 1, revision_after: 1 } // unique; entity_change_entity_revision_unique
{ command_execution_id: 1 } // entity_change_command_execution_id
{ "entity.model": 1, "entity.id": 1, applied_at: -1 } // entity_change_entity_applied
{ changed_paths: 1, applied_at: -1 } // entity_change_changed_paths_applied
```

### Atomic mutation chain (23.2 / 35.1 / S07 / invariants 6–7)

One executor transaction persists, as applicable: preallocated Decision, expected-`domain_revision` aggregate mutation, one `EntityChange` per changed aggregate, one `DomainCommandExecution` with exact stored result, and queued Sheet Sync outbox intent. Command/Change IDs and logical `now` are allocated outside the retry callback. Failure at aggregate, Change, Command, outbox, or commit leaves none of the proposed chain visible. Semantic no-op performs no save, revision increment, Change, or outbox write. Replay never re-enters the operation. External Sheets/queue/email/CRM/provider calls stay out of the transaction; only post-commit finalize may publish a wake-up.

### Existing adapter canonicalization (23.4 existing only)

| Path | Adapter | Notes |
| --- | --- | --- |
| POST form/call lead | `runExistingCreateFormLead` / `runExistingCreateCallLead` | revision 0→1 + Change + outbox |
| PATCH form/call lead | `runExistingUpdateSourceOwnedLead` | no-op skips Change/outbox/revision |
| POST booked / from-source | `runExistingCreateBookingFromLead` / `runExistingCreateBookedLeadFromSource` | per-aggregate revisions from current `domain_revision` |
| POST leadless / referral | `runExistingCreateLeadlessBooking` / `runExistingCreateReferralBooking` | existing leadless/referral semantics; not Granot Referral |
| PATCH booked / cancelled | `runExistingUpdateBookedLead` / `runExistingUpdateCancelledLead` | current patch semantics; not owner `updateBooking` |
| POST cancellation | `runExistingCreateCancellation` | Cancellation + Booking + mirrored Lead Changes |
| DELETE form/call/booked/cancelled | `runExistingDelete*` | `$deleted` `reference_only` Change, then delete; cascade rolls back together |
| attach booking to lead | `attachBookingToLead` | Change persistence for booking + lead |

Routes derive trusted context; they do not construct Changes or patch models. Clients cannot supply context fields. Compatibility actors: human owner; API secret `vantage-api-secret`; scoped key `vantage-scoped-api-key:<sha256(secret).slice(0,32)>`. Those two system IDs use origin `vantage_admin` without pretending to be human.

Not implemented: `synchronizeLeadFromGranot`, `createLeadFromGranot`, owner `updateBooking`, lifecycle `createReferralBooking`, `establishGranotRecordLink`, `correctGranotRecordLink`.

## Migrations / indexes / database mode

- **Data migration: none.** No Change backfill. Unit 09 owns revision/history migration.
- **Index catalog:** `granot-lifecycle-indexes/7` adds the four EntityChange indexes. Non-unique first; unique after zero collisions.
- **Report** (`TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --report`): pass against disposable `testvantagemovers`. `entity_change_revision_collisions: []`. Manifest `scripts/output/granot-lifecycle-indexes/granot-lifecycle-indexes-report-1787006668252.json`.
- **Verify** (`--verify`): fail. Missing indexes include the four EntityChange names plus earlier Unit 07 unique/supporting indexes that were never applied to this disposable database. Same class of gap Unit 10 recorded.
- **Apply:** not run. Production apply remains separately authorized (`--apply --confirm-production=<database-name>`).
- Replica proof used `TEST_MODE=true` and `SHEET_SYNC_MODE=queued` in the process environment only. `.env` was not edited.

## Flags before / after

`.env` does not set the ten Unit 07 lifecycle flags. Effective defaults, unchanged:

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

No Granot/RingCentral caller or lifecycle effect was enabled.

## Verification commands

### Focused (issue §11)

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/EntityChange.test.ts" "src/services/domainCommands/domainCommands.test.ts" "src/services/domainCommands/idempotency.integration.test.ts" "src/services/sheetSync/sheetSyncOutbox.service.test.ts"
```

**26 pass / 0 fail / 8 skipped** (replica file skips unless `GRANOT_LIFECYCLE_REPLICA_TESTS=true`).

Additional helper file `src/services/domainCommands/entityChange.test.ts` also passed (classification, builders, no-op field collection).

### Replica-set

```text
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=11
```

**9 pass / 0 fail** on disposable replica-set `testvantagemovers`:

- existing Lead update adapter: Command + Change + revision 0→1 + queued outbox; contact `5550000011` absent from Change serialization
- exact replay: `already_applied`, one Change, one Command, no second mutation
- semantic no-op update: Command only; no second Change; revision stays 1
- Booking update adapter: BookedLead Change + revision 0→1; contact absent from serialization
- injected failure after Change persist rolls back Change, revision, and Command
- Unit 10 executor replay/race/CAS/rollback/retry/finalize-boundary proofs remain green

### Full repository

```text
pnpm test
```

**1152 tests; 1134 pass / 0 fail / 18 skipped.**

```text
pnpm typecheck
```

**pass** (`tsc --noEmit` exit 0).

```text
git diff --check
```

**pass** (no whitespace errors).

## AC-to-proof coverage

| AC / checklist | Proof |
| --- | --- |
| AC-21 foundation (generic winner, stored-result replay, no second mutation) | Unit 10 replica retained; Unit 11 replica replay of existing update adapter |
| AC-21 owner-case / `already_satisfied` | Deferred to Units 24–25/27 |
| AC-32 Change/outbox/no-op foundation | `EntityChange.test.ts`; `entityChange.test.ts`; replica update/no-op/rollback; outbox service tests |
| AC-32 accepted-Observation causal chain | Deferred to Units 18/24–25/27 |
| One real mutation commits Command/Change/revision/outbox | replica Form Lead update + BookedLead update |
| Injected failure commits zero partial chain | replica throw after Change persist |
| Contact/address reference-only | model validators + replica serialization assertion |
| Existing envelopes/uniqueness | adapters return prior service envelopes; Booking uniqueness unchanged |
| No external call inside the transaction | InTransaction source inspection; replica finalize skipped on rollback; queue publish skipped in test env |
| Trusted human / API-secret / scoped-key context | `domainCommands.test.ts` compatibility actor validation; `existingWriteContext.ts` |
| Delete `$deleted` + tombstone atomicity | delete InTransaction mutations + adapter persist; source inspection of cascade/finalize |

## Concurrency, idempotency, privacy

- Replica same-key replay of an existing write returns the stored result and does not create a second Change.
- Semantic no-op (already-current `quoted`) creates no Change, revision increment, or extra outbox work.
- Rollback after Change persist leaves the prior Change count and `domain_revision` unchanged and writes no Command.
- Changes never store raw phone/email/address values. Replica fixtures use synthetic `5550000011` and `U11 Synthetic`. No credential or key value is persisted (scoped-key actor uses a 32-hex fingerprint).

## Masked verification

Disposable `testvantagemovers` only. `SHEET_SYNC_MODE=queued`. Synthetic Lead update and Booking update through production adapters. Masked entity/command ids `6a83…`; prefixes `u11-…`. Queue publish logged `sheet_sync.queue.publish_skipped`. No HTTP/Admin/extension smoke. No current live payload inspection. Create-FormLead adapter was not used on the replica because Registry source attribution and geocoding are live seams; update adapters proved the mutation chain without those provider calls.

## Known risks and deferred work

- Full AC-21 (owner-command / case revision / `already_satisfied`) remains Units 24–25/27.
- Full AC-32 accepted-Observation effects remain later units. This unit completes the Change/outbox/S07 foundation for existing writes.
- Public noncanonical service functions (`createFormLead`, etc.) still exist for non-route callers and may still wrap `runSheetSyncWrite`. Affected v1 routes no longer call them as mutation authorities.
- EntityChange indexes are catalogued but not applied. Disposable verify still reports them missing together with earlier Unit 07 indexes. Production apply is not authorized here.
- `attachBookingToLead` persists Changes from before/after snapshots; employee reconciliation case revision is not an `EntityChange` entity.
- Compatibility system actors are limited to the two exact server-built IDs. Forged system ids still fail closed.
- Later Section 23.4 lifecycle/owner commands remain disabled.

## Newly unblocked

Successful verified implementation completes S07 and unblocks **Unit 12**. Unit 12 still requires Unit 05 evidence (already complete) and must preserve this unit's canonical mutation boundary.

## Final `git status --short`

### vantage-main-server (`granot-lead-lifecycle`)

```text
 M .cursor/businesslogic/bookings.service.md
 M .cursor/businesslogic/call-lead.service.md
 M .cursor/businesslogic/cancelledLead.service.md
 M .cursor/businesslogic/domainCommands.service.md
 M .cursor/businesslogic/form-lead.service.md
 M .cursor/businesslogic/granotLifecycle.revisions.md
 M .cursor/businesslogic/sheetSync.service.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/schema-and-crud-inputs.mdc
 M .cursor/rules/sheet-sync-process.mdc
 M scripts/migrations/granot-lifecycle-indexes.lib.ts
 M scripts/migrations/granot-lifecycle-indexes.test.ts
 M scripts/migrations/granot-lifecycle-indexes.ts
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/middleware/requireApiSecret.ts
 M src/routes/v1.routes.ts
 M src/services/bookings/bookedLead.service.ts
 M src/services/bookings/bookedLeadFromSource.service.ts
 M src/services/bookings/referralBooking.service.ts
 M src/services/cancellations/cancelledLead.service.ts
 M src/services/domainCommands/bookings.ts
 M src/services/domainCommands/cancellations.ts
 M src/services/domainCommands/commandContext.ts
 M src/services/domainCommands/domainCommands.test.ts
 M src/services/domainCommands/idempotency.integration.test.ts
 M src/services/domainCommands/idempotency.ts
 M src/services/domainCommands/index.ts
 M src/services/domainCommands/leads.ts
 M src/services/domainCommands/types.ts
 M src/services/durableWork/types.ts
 M src/services/leads/callLead.service.ts
 M src/services/leads/formLead.service.test.ts
 M src/services/leads/formLead.service.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-11-COMPLETION.md
?? src/models/EntityChange.test.ts
?? src/models/EntityChange.ts
?? src/services/domainCommands/entityChange.integration.test.ts
?? src/services/domainCommands/entityChange.test.ts
?? src/services/domainCommands/entityChange.ts
?? src/services/domainCommands/existingWriteContext.ts
?? src/services/domainCommands/existingWrites.ts
```

No other repository was in scope.

No commit, push, deploy, production mutation, production index apply, live-payload access, Granot call, or external send occurred.
