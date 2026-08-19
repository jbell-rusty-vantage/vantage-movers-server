# Unit 24 — Confirm missing standard Booking owner workflow

**Status:** Complete  
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` (`16d4374` base) and `vantage-admin` / `granot-lead-lifecycle` (`9c6ab54` base)

## Authority and prerequisites

Implemented Unit 24's confirm-missing portion of S16 and the owner-command portions of AC-20, AC-21, AC-22, AC-23, and AC-32. Units 10–11 and 22–23 were reverified from code and tests before implementation. Unit 23's read-only Preview Owner review was accepted on 2026-08-19. Checked-in Booking command defaults remained false throughout.

## Behavior delivered

### Main server

- Added the exact strict confirm body: case revision, explicit Form/Call Lead ObjectId, optional bounded out-of-scope reason, calendar-valid Book Date, 1–20 unique active Agent IDs, exact nonnegative two-decimal allocation/total/deposit money, and an active Merchant ID. Unknown keys and client-owned case/provenance/Job/source fields are rejected.
- Added Owner-only `POST /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking`. It requires exactly one 8–200 character `Idempotency-Key`, derives trusted Owner/processor provenance and a stable SHA-256 checksum, and returns `201` for creation or `200` for replay/already-satisfied.
- Added `GranotBookingReconciliation.confirmBooking`. One canonical executor transaction revalidates the open create-missing case, unchanged case revision, enabled injected command posture, active reviewed Registry scope, current eligible Lead, override policy, current active Record Link, normalized-Job uniqueness, conflicting Lead bookings, and active catalogs.
- The transaction creates one standard non-Referral/non-leadless Booking from reviewed case/source plus explicitly submitted official fields; mirrors only Booking relationship/deposit thresholds to the selected Lead; preserves Lead source, source granularity, ingestion origin, and CPL; establishes or case-specifically corrects the active Record Link through a command-owned revision CAS; records exact aggregate Changes; resolves the case once; stores the command result; and queues one Booking Chain Sheet intent.
- Granot estimate/payment/balance/contact/move/source/Priority are never official defaults. Agent names and Merchant name are resolved from active IDs inside the transaction.
- Exact replay returns the durable result without another Change or Sheet intent. Same-state duplicate Job state resolves a new open sequence as `already_satisfied` without aggregate Changes/outbox. Different identity/state fails closed. Concurrent confirms produce one winner.
- Added stable safe mappings for command idempotency, case revision, aggregate revision, identity, policy, validation, Owner, and case-not-found failures.
- Case detail advertises the command only when the checked runtime flag is true and the case is open `create_missing_booking`; checked-in defaults remain false.

### Admin

- Added a typed confirm client that calls only the authenticated BFF proxy and forwards the single idempotency header. Lifecycle error codes now survive backend parsing and the proxy envelope.
- Added an Owner review form with blank official fields, explicit radio Lead selection, active-ID Agent/Merchant controls, exact decimal checks, allocation equality, conditional all-scope warning/reason, labeled error summary, a separate review step, and final `Create Booking` action.
- Evidence-only detail refresh does not initialize or clear form state. A `409` refreshes case/candidate/current projections, preserves every entered value, explains the stable conflict code, and never auto-resubmits. Stable request bodies reuse their idempotency key; edited bodies receive a new key.
- Success invalidates lifecycle case list/detail/candidates, Job timeline, selected and previously linked Lead detail/timeline, Booking lists/detail, Cancellation lists, analytics, and catalogs.
- The BFF forwards `Idempotency-Key` only on the exact confirm path, strips browser authority through the existing trusted-header boundary, allows Owner, denies Admin, and writes a bounded audit record without money, catalog IDs, or override prose.

## Files added or changed

Main server behavior groups:

- `src/services/granotLifecycle/bookingConfirmation.ts`, `bookingReconciliation.ts`, and `bookingConfirmation.replica.test.ts` — command, transaction, replay/race/rollback proof.
- `src/validation/v1/granotLifecycle.validation.ts` and `.test.ts` — strict body, calendar, cents, uniqueness, and bounds.
- `src/routes/granot-lifecycle-admin.routes.ts` and `.test.ts` — Owner route/header/status/error contract.
- `src/services/domainCommands/entityChange.ts`, `src/services/granotLifecycle/errors.ts`, and `projections.ts` — Record Link changed path, stable codes, and capability projection.
- `scripts/test-granot-lifecycle-replica.ts` — Unit 24 registration.
- `scripts/prototypes/granot-lead-lifecycle/dry-runs/run.ts` — type-compatible legacy dry-run query/exhaustive fallback; read-only behavior unchanged.

Admin behavior groups:

- `components/granot-lifecycle/booking-command-form.tsx`, `case-detail.tsx`, and `lead-candidate-browser.tsx` — explicit selection, blank form, review, conflict preservation.
- `lib/api/granotLifecycle.ts` and tests; `lib/query/granotLifecycle.ts` and tests — command DTO/client and exact invalidation families.
- `app/api/proxy/[...path]/route.ts`, `server/auth/authorization.test.ts`, `server/vantage-api/response.ts`, and tests — exact Owner BFF/header/error boundary.
- `server/audit/proxyAuditPayload.ts` and tests — bounded mutation audit.
- `tests/granot-lifecycle-components.test.ts` — blank/labeled form, capability switch, and review-step proof.

## AC and invariant proof

| Acceptance / invariant | Proof |
| --- | --- |
| AC-20 | Form state is owned below the refetching detail query; evidence revision is excluded from command checksum/body. Resolved cases fail the open case-revision CAS. |
| AC-21 | Replica proof covers simultaneous confirms, one Booking/Command/effect chain, exact replay, checksum conflict, and same-state `already_satisfied`. |
| AC-22 | Zod tests cover valid/invalid calendar dates, fractional cents, sum mismatch, duplicate IDs, and 20/21 allocations. Replica proof covers active snapshots and inactive-catalog atomic rollback. Admin uses blank active-ID controls. |
| AC-23 | Server recomputes Source Scope, requires a 10–500 reason when outside it, and preserves Lead source company/granularity/origin/CPL. Record Link correction is command-owned and revision guarded. |
| AC-32 | Replica proof observes Receipt → Observation → Decision → Command → three Changes, one Booking/Lead/Link/case result, and one queued Sheet intent. Replay/already-satisfied add no aggregate Change/outbox. |
| Forbidden effects | No Referral, Release, Cancellation, discrepancy, email, notification, automatic Booking, second Booking, external Sheet publish, or Granot official default is reachable. |

## Migration, indexes, flags, and external posture

Unit 24 adds **no migration, model, index, or backfill**. Read-only aggregate index verification passed against the disposable `testvantagemovers` replica database; no `--apply` ran. Checked-in lifecycle defaults began and end with processing/shadow `true/true` and Lead writes/creation, Booking cases/commands, Release cases/commands, Referral Booking, and email effects false. Tests inject only `booking_commands_enabled:true` and queued Sheet mode.

No deployment, production command, live payload/customer read, Registry mutation, production migration/index apply, effect-flag enablement, external provider call, Sheet publish, notification, or email occurred. Synthetic replica data was bounded to Unit 24 prefixes and cleaned by the harness.

## Verification

Main server:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/validation/v1/granotLifecycle.validation.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/granotLifecycle/projections.test.ts src/services/domainCommands/domainCommands.test.ts
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=24
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test
pnpm exec tsc --noEmit
```

- Focused: 44/44 passed.
- Unit 24 replica: 3/3 passed, including replay, already-satisfied, inactive-catalog rollback, source preservation, and simultaneous confirms.
- Full: 1,442 tests; 1,386 passed, 0 failed, 56 opt-in skipped.
- Typecheck and read-only index verification passed.

Admin:

```text
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

- Full: 214/214 passed.
- Lint, typecheck, and production build passed; Next generated the lifecycle queue/detail/Job routes and proxy.

## Remaining gates

Unit 24 is complete and makes Unit 25 contract-permitted after its own repository re-verification. Unit 25 owns existing-Booking update and Booking No Action and must not infer operational flag enablement from this completion. Production merge, deployment, test/staging Owner exercise, and any narrow Booking-command rollout remain separately authorized gates.

## Repository state and external actions

Both repositories remain on `granot-lead-lifecycle` with the Unit 24 working changes uncommitted. No unrelated user edits were overwritten.

**No commit, push, deploy, production mutation, production/live payload read, production migration/index apply, Registry change, external Sheet/CRM send, notification, email, or flag enablement occurred.** The only database writes were synthetic transaction tests in the configured disposable test replica; queue publishing was explicitly skipped.
