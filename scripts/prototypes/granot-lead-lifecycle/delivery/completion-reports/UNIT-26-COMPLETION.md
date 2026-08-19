# Unit 26 — Release Reconciliation persistence, projections, and read-only Admin workflow

**Status:** Complete  
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` (`cd72051` base) and `vantage-admin` / `granot-lead-lifecycle` (`18b368d` base)

## Authority and prerequisites

Implemented S17 and the Release portions of AC-25, AC-26, AC-27, AC-35, AC-36, and AC-40 from `UNIT-26.md` and the final specification. Units 22–23 were reverified through their replica proof before implementation; stable Unit 14 identity and deterministic Booking read seams remain authoritative. Both repositories were clean at start. Checked-in posture began and ends with processing/shadow true and all eight effect flags false.

## Behavior delivered

### Model, indexes, and migration

- Added the separate `GranotReleaseReconciliationCase` collection. It fixes `action_kind:"release"`, persists no mode, requires deterministic Booking ID plus immutable opening `domain_revision`, and stores only four-field Release evidence plus bounded observed context.
- Added resolved-row immutability, append-only evidence identity, open-state query guards, replacement/removal refusal, runtime `autoIndex:false`, and five exact named indexes: partial-open job/action uniqueness, job/action/sequence uniqueness, state/evidence time, Booking/state, and optional suggested-Lead/state.
- Extended the deterministic report/apply/verify migration library and CLI with Release collision reporting and ordered non-unique-before-unique definitions. Script version advanced additively. No apply ran.

### Reconciliation and processor routing

- Added the `GranotReleaseReconciliation.reconcileObservation({ observation_id, decision_id })` interface and Mongo persistence store. The processor is the only automatic caller and invokes it only for actual Release, post-activation `live`, all reviewed gates allowed, and the injected Release-case flag.
- A compatible active Booking opens or refreshes one Release case, including a Booking without a Lead. Malformed Priority is independent and does not suppress Release. Exact replay deduplicates by Observation ID.
- An officially cancelled Booking writes only `already_current` / `booking_already_cancelled` with the existing Booking/Cancellation target. No Booking and the three exact identity conflicts return typed Unit 29 reason seams and persist no discrepancy.
- Case and Decision commit atomically. Sequence allocation is inside the transaction; one bounded retry converges open/sequence races. Evidence changes increment `evidence_revision`; owner-relevant current Booking/link changes increment `case_revision` while `booking_revision_at_open` remains unchanged. Retargeting is refused.
- Release performs no contact Booking lookup, Lead attachment, official Booking/Cancellation/Record Link change, command, `EntityChange`, Sheet intent, discrepancy persistence, notification, or email.

### Protected reads and Admin

- Default case reads now merge Booking and Release collections under the same strict filters and stable selected timestamp plus ObjectId cursor. `kind=booking` remains isolated; `kind=release` returns projection mode `release`.
- Detail resolves either case model. Release detail returns immutable evidence, the exact non-official warning, current link, deterministic live Booking and current Cancellation, but no suggestion, employee-reconciliation substitution, candidate browser, or command capability.
- Job/Lead timelines project Booking and Release case events separately while retaining Observation, actual booking action, Decision, sequence, and official facts as distinct entries.
- Existing Admin DTO/filter/queue foundations now have explicit Release read-only proof. `BookingOwnerActions` rejects every non-Booking kind even under an inconsistent capability payload. Release detail renders evidence/current state and no candidate or mutation control.

## Behavior-grouped files

- Release domain and tests: `src/models/GranotReleaseReconciliationCase.ts`, `src/models/GranotReleaseReconciliationCase.test.ts`, `src/models/granotLifecycleSchemas.ts`.
- Reconciliation/processor and tests: `src/services/granotLifecycle/releaseReconciliation.ts`, `.test.ts`, `.replica.test.ts`, `processor.ts`, `processor.test.ts`, replica runner registration.
- Reads/routes/contracts: `src/services/granotLifecycle/projections.ts`, projection/route/validation tests.
- Migration: `scripts/migrations/granot-lifecycle-indexes.lib.ts`, CLI, and tests.
- Admin: `components/granot-lifecycle/booking-owner-actions.tsx`, mixed queue/detail/timeline component tests, project rule.
- Authorities: new Release business-logic document; processor/projection/index/rules/activation guide updates; this ledger and report.

## AC and invariant proof

| Acceptance / invariant | Proof |
| --- | --- |
| AC-25 | Active deterministic Booking, including without Lead, opens/refreshes a read-only Release case with fixed Booking ID and opening revision; no command is exposed. |
| AC-26 | Officially cancelled is a no-effect `already_current` Decision with existing target and no case/discrepancy/mutation. |
| AC-27 | Missing Booking and record-link/Job/source conflicts return the exact typed Unit 29 reason only. |
| AC-35 | Strict model and recursive projection guards omit payload/headers/credentials/addresses; lists mask contact and Booking references. |
| AC-36 | Real replica unique indexes converge simultaneous first open, replay, resolved next sequence, and transaction rollback; resolved/evidence guards are model-tested. |
| AC-40 | A Booking case and Release case coexist open for one Job, project in the same cursor stream and timeline as separate rows, and do not close/rewrite each other. |
| Revision split | Replica proof keeps opening Booking revision immutable while owner-state refresh increments case revision separately from evidence revision. |
| Zero effects | Before/after counts are unchanged for Bookings, Cancellations, Record Links, Commands, Changes, Sheet intents, and notifications; Unit 29 storage is never called. |

## Migration, indexes, flags, and external posture

`TEST_MODE=true` report and verify manifests targeted `testvantagemovers`. Report result: zero total collisions, zero Release open-job collisions, and zero Release sequence collisions. Verify result: all five Release definitions present and exact, with no missing or mismatched names. The replica suite creates the required definitions only in the disposable test database as test setup; the migration `--apply` mode was not invoked.

Flags before and after are unchanged:

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

## Verification

Main server:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/models/GranotReleaseReconciliationCase.test.ts src/services/granotLifecycle/releaseReconciliation.test.ts src/services/granotLifecycle/projections.test.ts src/routes/granot-lifecycle-admin.routes.test.ts scripts/migrations/granot-lifecycle-indexes.test.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=26
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --report
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck
```

- Focused: 50/50 passed.
- Unit 26 replica: 3/3 passed with real transaction/unique-index, mixed cursor/timeline, coexistence, rollback, revision, replay, and zero-effect assertions.
- Index report/verify: passed; collision count 0; Release verify exact.
- Full: 1,462 tests; 1,395 passed, 0 failed, 67 opt-in skipped.
- Typecheck passed.

Admin:

```text
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

- Full: 219/219 passed.
- Lint, typecheck, and production build passed; 39 static/dynamic pages generated successfully.

`git diff --check` passed in both repositories (only line-ending normalization warnings). Final worktrees contain only the uncommitted Unit 26 implementation/documentation listed above.

## Remaining gates

Unit 27 is contract-permitted only after explicit Owner review accepts these read-only Release cases; that review did not occur in this run, so Unit 27 remains blocked. Unit 29 remains blocked until Unit 27 completes. Unit 26 does not authorize Release commands, production index apply, deployment, merge, source/effect enablement, or current live-payload inspection.

## Repository state and external actions

Both repositories remain on `granot-lead-lifecycle` with Unit 26 changes uncommitted. No unrelated user edits were overwritten.

**No commit, push, merge, deploy, production mutation, production/live payload or customer read, production/staging migration or index apply, Registry change, flag enablement, official Lead/Booking/Cancellation/Record Link mutation, external Sheet/CRM/provider send, notification, or email occurred.** The only database writes were bounded synthetic transaction/index setup and cleanup in the configured disposable test replica; external Sheet delivery was disabled.
