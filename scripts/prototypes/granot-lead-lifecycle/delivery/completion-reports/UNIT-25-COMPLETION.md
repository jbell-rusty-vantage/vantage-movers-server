# Unit 25 — Existing Booking update and Booking No Action workflows

**Status:** Complete
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` (`94d497c` base) and `vantage-admin` / `granot-lead-lifecycle` (`c6ea76c` base)

## Authority and prerequisites

Implemented the remaining S16 workflows and the applicable AC-20, AC-21, AC-24, and AC-32 requirements. Unit 24's command transaction, Owner boundary, idempotency, outbox, and read-only index evidence were reverified before implementation. Checked-in lifecycle posture began and ends with processing/shadow true and all eight effect flags false.

## Behavior delivered

### Main server

- Added strict complete-replacement update validation with exact case and Booking revisions, calendar-valid Book Date, unique active Agent IDs, exact two-decimal allocation/total/deposit money, and an active Merchant ID. Unknown or server-owned fields are rejected.
- Added Owner-only update and No Action routes. Both require exactly one bounded `Idempotency-Key`, use deterministic command checksums, and return durable replay results.
- Existing standard Booking update revalidates the open `review_existing_booking` case, reviewed source and link identity, current non-cancelled Booking/Lead revisions, normalized Job/source identity, policy posture, and active catalogs inside one transaction. It replaces only official Booking fields, recomputes thresholds, mirrors only thresholds to the linked Lead, appends adjacent Booking/Lead Changes, resolves the case, stores the command, and queues one Booking-chain intent. Identity, linkage, source, provenance, and CPL are preserved.
- Same official and derived state resolves as `already_satisfied` without aggregate Changes or outbox work. Replay is deterministic; stale revisions, cancelled/disappeared or conflicting identities, invalid policy/catalog state, and concurrent losers fail closed.
- Booking No Action is allowed only for open standard `create_missing_booking` or `review_existing_booking` cases. It accepts only the exact optional reason vocabulary and bounded optional note, increments the case revision once, and persists only the Command and case resolution—no Booking, Lead, Record Link, Change, or outbox row.
- Fault-injection replica proof covers rollback after every update write boundary and after No Action case mutation. Update-versus-No-Action concurrency produces one winner.

### Admin

- Added typed BFF clients and Owner actions for `Update Booking` and `Resolve — No Action`; referral cases expose neither action.
- The update form initializes once from live Booking values and active catalog IDs, validates the complete replacement locally, presents a separate review step, and prevents pending double submission. The No Action form provides the exact optional reason choices and a review step.
- A `409` refreshes projections while preserving local drafts and never auto-resubmits. Success invalidates the affected case, Booking, Lead, timeline, list, analytics, cancellation, and catalog query families.
- The proxy forwards `Idempotency-Key` only on the three exact Booking-owner paths. Owner is allowed and Admin denied. Audit metadata is bounded and excludes money, catalog IDs, and free-form reason text.

## AC and invariant proof

| Acceptance / invariant | Proof |
| --- | --- |
| AC-20 | Evidence refresh is separate from command revisions; both workflows require the open case revision CAS. No Action has exact reason validation and zero domain effects. |
| AC-21 | Replica tests prove durable replay, checksum conflict handling, update already-satisfied behavior, one-winner update/No-Action races, and transactional rollback. |
| AC-24 | Strict validation and replica proof cover full official-field replacement, exact Booking CAS, active catalogs, source/identity preservation, derived thresholds, linked-Lead mirroring, Changes, and queued intent. |
| AC-32 | Real updates persist Command plus adjacent Booking/Lead Changes and one queued Booking-chain intent atomically; No Action persists only Command plus case resolution. |
| Forbidden effects | No Booking creation, Referral, Release, Cancellation, discrepancy, Record Link rewrite, email, notification, automatic command, external Sheet publish, or Granot-derived official default is reachable. |

## Migration, indexes, flags, and external posture

Unit 25 adds no migration, model, index, or backfill. Read-only aggregate index verification passed against the disposable TEST_MODE database; no `--apply` ran. Tests injected only the Booking-command gate and queued Sheet mode. No deployment, production command, live payload/customer read, Registry mutation, production migration/index apply, effect-flag enablement, provider call, Sheet publish, notification, or email occurred.

## Verification

Main server:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/validation/v1/granotLifecycle.validation.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/granotLifecycle/projections.test.ts src/services/domainCommands/domainCommands.test.ts
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=25
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck
```

- Focused: 48/48 passed.
- Unit 25 replica: 7/7 passed, including predecessor confirmation, update replacement/replay/already-satisfied, No Action, race, and rollback boundaries.
- Full: 1,450 tests; 1,386 passed, 0 failed, 64 opt-in skipped.
- Typecheck and read-only index verification passed.

Admin:

```text
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

- Full: 218/218 passed.
- Lint, typecheck, and production build passed.

## Remaining gates

Unit 25 completes S16. It does not authorize merge, deployment, test/staging Owner exercise, production index application, or Booking-command enablement. Unit 28 also requires the separate reviewed Referral classification and therefore remains blocked.

## Repository state and external actions

Both repositories remain on `granot-lead-lifecycle` with Unit 25 changes uncommitted. No unrelated user edits were overwritten.

**No commit, push, deploy, production mutation, production/live payload read, production migration/index apply, Registry change, external Sheet/CRM send, notification, email, or flag enablement occurred.** The only database writes were bounded synthetic transaction tests in the configured disposable test replica; external queue publishing was disabled.
