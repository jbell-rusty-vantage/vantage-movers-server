# Unit 10 completion — Transaction-owning canonical command executor and idempotent replay

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 23.1–23.2, 24 common owner-command envelope through line 1445, 25, 27, 28.4, 34.7, 35–36, 37.1–37.2, 38/S07, and 39–41
- **Acceptance ownership:** executor/revision/replay foundation of AC-21 and Receipt/Observation/Decision/Command causal foundation of AC-32. Units 11, 18, 24–25, and 27 complete Change/outbox/no-op and case-specific production proofs.
- **Applicable invariants preserved:** 1 (Mongo is SoR for command identity/result), 2 (Granot provenance grants no automatic Booking/Cancellation command), 5 (executor is the atomic command boundary; remaining direct writes stay until Unit 11), 6 (transaction + Decision/Command/revision atomicity only; Change/outbox not claimed), 7 (replay does not rerun the operation; full desired-state no-op remains later), 8 (origin, channel, actor, initiator, receipt, and connection stay independent), 9 (conflicts/replay retain the original execution)
- **Runtime posture:** no new flag, caller, route, or effect. Unit 07 defaults remain: processing true, shadow true, all eight effect flags false. No Granot/RingCentral lifecycle caller is live.

## Files added or changed

### Context / model

- `src/services/domainCommands/types.ts` — four `CommandOrigin`s, causal provenance, stored `applied` result, compatibility adapter, `{ session, now }` operation types, owner key helper, revision/conflict errors
- `src/services/domainCommands/commandContext.ts` — fail-closed four-origin validation
- `src/services/domainCommands/ringcentralProvenance.ts` — server-side telephony session lookup; never a client boolean
- `src/services/durableWork/types.ts` + `actors.ts` — system `granot_lifecycle` / `ringcentral`; human `browser_extension`; fixed processor/webhook/RC factories
- `src/models/DomainCommandExecution.ts` — four-origin enum, optional nested `result`, compatibility top-level refs/warnings, `readStoredCanonicalCommandResult`

### Executor

- `src/services/domainCommands/idempotency.ts` — transaction-owning executor; ALS / `persistActiveCanonicalCommandExecution` removed; post-commit telemetry; `executeCanonicalCommandWithPostCommit`
- `src/services/sheetSync/sheetSyncCoordinator.ts` — no longer persists command executions; public `runSheetSyncWrite` remains for legacy services only

### Transaction-bound internals / adapters

- `src/services/leads/formLead.service.ts`, `callLead.service.ts`
- `src/services/bookings/bookedLead.service.ts`, `leadlessBooking.service.ts`
- `src/services/cancellations/cancelledLead.service.ts`
- `src/services/employeeBookings/bookingLeadReconciliation.service.ts`
- `src/services/domainCommands/leads.ts`, `bookings.ts`, `cancellations.ts`
- `src/services/ingestion/applyPlan.ts` — one-way `CompatibilityCanonicalCommandResult` for existing `already_applied` counters

### Tests

- `src/models/DomainCommandExecution.test.ts`
- `src/services/domainCommands/domainCommands.test.ts`
- `src/services/domainCommands/idempotency.integration.test.ts`
- `scripts/test-granot-lifecycle-replica.ts` — unit `10` registration

### Docs

- `.cursor/businesslogic/domainCommands.service.md` (new)
- `.cursor/businesslogic/sheetSync.service.md`, `form-lead.service.md`, `call-lead.service.md`, `bookings.service.md`, `cancelledLead.service.md`
- `.cursor/index.md`
- `.cursor/rules/project-organization.mdc`, `schema-and-crud-inputs.mdc`, `business-logic.mdc`, `sheet-sync-process.mdc`
- `.cursor/agents/docs-keeper.md` — glob map row for `domainCommands/`

## Exact contracts landed

### Origins and provenance (23.1 / Invariant 8)

| Origin | Validation |
| --- | --- |
| `external_sheet_ingestion` | Existing dedicated ingestion actor + trusted human initiator + run/receipt/connection |
| `vantage_admin` | Trusted owner/admin actor and initiator |
| `granot_lifecycle` | Fixed processor `granot-lifecycle-processor`; webhook initiator `granot-webhook` or server-authenticated Owner; nonblank receipt/Observation/Decision; `source_receipt_id` === processor `request_id`; `observation_channel` agrees with the initiator path |
| `ringcentral` | Fixed `ringcentral-call-ingest` actor and initiator plus `findRingCentralCallSession` server verification |

`browser_extension` is an Observation Channel / DurableActor origin, not a `CommandOrigin`. The executor never generates a Decision ID. Automation initiator remains unspecified and is rejected.

### Stored result / replay / conflict (23.2 / Invariant 9)

```ts
result: { status: "applied"; entity_refs; warnings }
```

- Same origin/key + same name + same lowercase SHA-256 checksum returns the stored result and does not call the operation.
- Same origin/key with a different name or checksum throws `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` and creates no row/effect.
- Replay is `outcome.replayed` plus PII-safe `domain_command.replayed` telemetry. Stored status stays `applied`.
- `toCompatibilityCanonicalCommandResult` is the one-way ingestion adapter (`already_applied` only for callers that still count it).
- Legacy rows without `result` derive the stored shape from top-level refs/warnings and are not rewritten.
- Unique `(origin, idempotency_key)` and unique `command_id` remain the only replay authority.

### Transaction sequence (S07 partial / Invariant 6 foundation)

1. Validate → normalize checksum → connect → allocate `now` once → preserve preallocated IDs.
2. Executor starts one Mongo transaction. Callback retries reuse the same clock and IDs.
3. Session-scoped `(origin, idempotency_key)` read → replay or conflict without invoking the operation.
4. `operation({ session, now })` may persist a preallocated Decision and expected-`domain_revision` CAS.
5. Persist `DomainCommandExecution` in the same session. Commit once.
6. Telemetry and existing adapter finalizers run only after a successful non-replay commit. Sheets/queue/email/CRM are forbidden inside the transaction.
7. Duplicate-key 11000 reloads the durable row and returns it only when name/checksum agree.
8. Failure before/after the operation or during persist/commit leaves zero Decision, aggregate delta, or command row.

Sheet Sync no longer owns command transaction completion. Public legacy paths still use `runSheetSyncWrite`. `*InTransaction` internals do not open nested transactions or finalize Sheets.

### Common owner envelope (Section 24 through line 1445)

`assertOwnerCommandIdempotencyKey` preserves 8–200 printable characters with no edge whitespace. Owner HTTP parsing, case commands, and `already_satisfied` remain later units.

## Migrations / indexes / database mode

- **Data migration: none.** Additive optional `result` / causal provenance fields. Legacy command rows unread-rewritten.
- **Index migration: none.** Existing unique `(origin, idempotency_key)` and `command_id` retained and model-tested. No second idempotency collection.
- **Database:** disposable replica-set `testvantagemovers` (`database_category: test`). `TEST_MODE=true` and `SHEET_SYNC_MODE=disabled` were set only in the process environment for replica proof. `.env` was not edited.
- **No production report/apply/index create.**

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
node --import tsx --import ./scripts/test-setup.ts --test "src/models/DomainCommandExecution.test.ts" "src/services/domainCommands/domainCommands.test.ts" "src/services/domainCommands/idempotency.integration.test.ts"
```

**16 pass / 0 fail / 8 skipped** (replica file skips unless `GRANOT_LIFECYCLE_REPLICA_TESTS=true`).

### Replica-set

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=10
```

**8 pass / 0 fail** on disposable replica-set `testvantagemovers`:

- exact stored-result replay + checksum conflict + no second mutation
- same-key commit race: one winner, exact replay of the stored result
- expected-revision loser is `DOMAIN_REVISION_CONFLICT` with no Decision/Command
- rollback after operation writes leaves zero Decision/Lead/Command/`EntityChange`
- stable `now` and preallocated Decision/Command IDs across abort+retry
- persist failure rolls back Decision, aggregate, and Command
- post-commit finalize never runs on rollback
- no Sheet/queue/email/CRM call before commit; operation receives a live in-transaction session

### Full repository

```text
pnpm test
```

**1139 tests; 1122 pass / 0 fail / 17 skipped.**

```text
pnpm typecheck
```

**pass** (`tsc --noEmit` exit 0).

```text
git diff --check
```

**pass** (CRLF conversion warnings only on preserved UNIT-STATUS / UNIT-14–16 issue files; no whitespace errors).

## AC-to-proof coverage

| AC / checklist | Proof |
| --- | --- |
| AC-21 foundation (generic winner, stored-result replay, conflict, no second mutation) | `domainCommands.test.ts`; replica replay/conflict/race/CAS |
| AC-21 case-specific / `already_satisfied` | Deferred to Units 24–25/27 |
| AC-32 foundation (Receipt/Observation/Decision IDs on Command; atomic rollback/replay) | replica causal-ID + rollback + persist-failure tests; stored provenance on Command |
| AC-32 Change / outbox / complete no-op | Deferred to Unit 11 and later effect units |
| Four origins; Granot/RC identities cannot be client-forged | `domainCommands.test.ts` + `commandContext.ts` |
| Nested result; legacy top-level rows replay without mutation | `DomainCommandExecution.test.ts` |
| Stable IDs/`now` across callback retry | unit fake-retry + replica abort+retry |
| Failure before/after operation and during persist/commit | replica rollback / persist-failure / finalize-on-rollback |
| No external call before commit | replica boundary + `executeCanonicalCommandWithPostCommit` |
| Internals do not open nested transactions | source-inspection of `*InTransaction` functions |
| Forbidden effects: zero `EntityChange`, case/discrepancy/notification, auto Booking/Cancellation | replica Change count 0; no new case/notification/Booking-from-Granot code |

## Concurrency, idempotency, privacy

- Replica same-key race: exactly one non-replay winner; loser returns the stored result; one `DomainCommandExecution` row.
- Replica CAS: winner increments `domain_revision` 0→1; loser is `DOMAIN_REVISION_CONFLICT` with no Decision/Command.
- Replay never increments mutation counters or re-invokes the operation.
- Telemetry details are IDs, counts, actor types, and origin only. Replica fixtures use synthetic `55500000xx` phones and `U10 …` names. No raw customer/contact/payload/credential values in logs or this report.

## Masked verification

Disposable `testvantagemovers` only. Synthetic command through the production executor: one Decision + Lead revision + Command transaction; exact replay (`domain_command.replayed`); checksum conflict; rollback with zero partial rows. Masked entity ids `6a83…`; run ids `u10-replay-…` / `u10-race-…` / `u10-cas-…`. No HTTP/Admin/extension smoke. No current live payload inspection. Full Command → `EntityChange` → outbox chain is deferred to Unit 11.

## Known risks and deferred work

- Full AC-21 (owner-command / case revision / `already_satisfied`) remains Units 24–25/27.
- Full AC-32 / S07 certification remains blocked until Unit 11 lands `EntityChange`, complete outbox linkage, and wholesale adapter canonicalization, plus later effect-owning units.
- Public noncanonical Lead/Booking/Cancellation routes still own `runSheetSyncWrite`. They were not silently rerouted.
- Legacy `DomainCommandExecution` rows are read-compatible and not backfilled.
- RingCentral origin rejects unless `findRingCentralCallSession` finds the telephony session. No RC caller is wired.
- Granot lifecycle origin is validated but no processor/owner route invokes it yet.
- Automation initiator remains unspecified (fail closed).
- `docs-keeper.md` glob map now includes `domainCommands/`; no new always-apply rule.

## Newly unblocked

Successful verified implementation unblocks **Unit 11**. Full AC-32/S07 certification remains blocked until Unit 11 and later effect-owning units complete their interfaces. Units 12+ still wait for their listed prerequisites.

## Final `git status --short`

### vantage-main-server (`granot-lead-lifecycle`)

Preserved uncommitted predecessor/user work: `UNIT-STATUS.md` (updated only for Units 10–11), `delivery/issues/UNIT-14.md`, `UNIT-15.md`, `UNIT-16.md`.

```text
 M .cursor/agents/docs-keeper.md
 M .cursor/businesslogic/bookings.service.md
 M .cursor/businesslogic/call-lead.service.md
 M .cursor/businesslogic/cancelledLead.service.md
 M .cursor/businesslogic/form-lead.service.md
 M .cursor/businesslogic/sheetSync.service.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/schema-and-crud-inputs.mdc
 M .cursor/rules/sheet-sync-process.mdc
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-14.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-15.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-16.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/models/DomainCommandExecution.ts
 M src/services/bookings/bookedLead.service.ts
 M src/services/bookings/leadlessBooking.service.ts
 M src/services/cancellations/cancelledLead.service.ts
 M src/services/domainCommands/bookings.ts
 M src/services/domainCommands/cancellations.ts
 M src/services/domainCommands/domainCommands.test.ts
 M src/services/domainCommands/idempotency.ts
 M src/services/domainCommands/leads.ts
 M src/services/domainCommands/types.ts
 M src/services/durableWork/actors.ts
 M src/services/durableWork/types.ts
 M src/services/employeeBookings/bookingLeadReconciliation.service.ts
 M src/services/ingestion/applyPlan.ts
 M src/services/leads/callLead.service.ts
 M src/services/leads/formLead.service.ts
 M src/services/sheetSync/sheetSyncCoordinator.ts
?? .cursor/businesslogic/domainCommands.service.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-10-COMPLETION.md
?? src/models/DomainCommandExecution.test.ts
?? src/services/domainCommands/commandContext.ts
?? src/services/domainCommands/idempotency.integration.test.ts
?? src/services/domainCommands/ringcentralProvenance.ts
```

No commit, push, deploy, production mutation, production index apply, live-payload access, Granot call, or external send occurred.
