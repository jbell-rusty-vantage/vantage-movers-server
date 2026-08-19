# Unit 27 — Release Owner commands

**Status:** Complete  
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` (`c3885d3` base) and `vantage-admin` / `granot-lead-lifecycle` (`478afe5` base)

## Authority and readiness

Implemented final-spec S18 and AC-21, AC-25, AC-26, and AC-32 under `UNIT-27.md`. The Owner explicitly accepted Unit 26's read-only Release cases on 2026-08-19. Unit 26 model/projection/report evidence, Unit 24–25 canonical command primitives, current branches, clean starting worktrees, test-database identity, and unchanged checked-in flags were reverified before implementation.

## Behavior delivered

### Server commands and routes

- Added the exact Owner-only, `Idempotency-Key`-required routes `POST /api/v1/admin/granot-lifecycle/release-cases/:id/confirm-cancellation`, `/update-booking`, and `/no-action`.
- Added strict bodies for both expected revisions and complete official Cancellation/Booking inputs. Unknown keys, invalid calendar dates, imprecise money, duplicate allocations, and inactive catalog rows fail closed.
- Registered exact canonical names `createCancellation`, `updateBooking`, and `resolveGranotReleaseCaseNoAction`. Results always carry a Booking ref and optionally a Cancellation ref, with outcomes `cancellation_created`, `booking_updated`, `no_action`, or `already_satisfied`.
- Each attempt revalidates Owner authority, command gate, reviewed live source policy, open case revision, immutable Job/Booking identity, active Record Link, Booking revision/state, optional Lead identity/revision, and—on Booking replacement—active Agent/Merchant rows. Stable failures include `OWNER_REQUIRED`, `CASE_NOT_FOUND`, `CASE_REVISION_CONFLICT`, `DOMAIN_REVISION_CONFLICT`, `IDENTITY_CONFLICT`, `POLICY_BLOCKED`, and `VALIDATION_FAILED`.

### Atomic domain effects

- Added a transaction-aware cancellation primitive under the existing cancellation service; it does not open a nested transaction, resolve a case, write a Command, enqueue independently, or publish before commit.
- Create Cancellation CASes the active Booking, inserts exactly one complete `CancelledLead`, optionally mirrors a still-matching Lead, appends adjacent `EntityChange` rows, resolves the Release case, persists the canonical result, and enqueues exactly one `cancellation_chain` Sheet intent in one transaction.
- A verified matching Cancellation resolves `already_satisfied` with no aggregate, Change, or Sheet write. Referral Bookings cancel without fabricating a Lead mirror.
- Update Booking fully replaces official date, allocations, binder, deposit, merchant, and optional Lead threshold mirror, then enqueues one `booking_chain` intent atomically. Same-state resolution is no-effect.
- No Action changes only the case and Command. Exact retries replay the stored result; same-key/different-checksum reuse conflicts. Pairwise command races have one case-revision winner. Post-commit Sheet finalization never runs on rollback.

### Admin

- Added explicit Release Owner actions: blank Create Cancellation, full Booking replacement initialized only from live official values, and No Action. Every mutation has an edit/review/final-submit flow, stable per-body idempotency key, disabled pending state, accessible labels/error summary, and no auto-submit.
- A 409 refreshes all affected lifecycle/Booking/Cancellation/Lead views while preserving unsent fields for explicit rereview. Granot evidence never pre-fills official inputs.
- The authenticated proxy forwards idempotency keys only for exact Booking/Release command routes. Admin role remains denied; Owner is allowed. Audit payloads retain bounded operation/revision/count/presence metadata and exclude money, catalog IDs, notes, reasons, contact data, and raw official values.

## Behavior-grouped files

- Server validation/routes: `src/validation/v1/granotLifecycle.validation.ts`, validation tests, `src/routes/granot-lifecycle-admin.routes.ts`, route tests.
- Server domain: new `src/services/granotLifecycle/releaseOwnerCommands.ts` and replica test; `releaseReconciliation.ts`; `projections.ts`; `src/services/cancellations/cancelledLead.service.ts`; replica runner registration.
- Admin client/UI: `lib/api/granotLifecycle.ts`, new `cancellation-command-form.tsx` and `release-owner-actions.tsx`, shared update/No Action forms, and case detail wiring.
- Admin trust/audit/tests: proxy header forwarding, authorization, bounded audit payloads, API and component tests.
- Documentation: Release reconciliation, canonical command, software-map/index/project rules, delivery ledger, and this report.

## Acceptance and invariant proof

| Acceptance / invariant | Proof |
| --- | --- |
| AC-21 | Canonical idempotency replay, checksum conflict, exact revisions, adjacent Changes, pairwise one-winner races, and transaction rollback are replica-proven. |
| AC-25 | Strict Release routes, live source/link/Booking revalidation, three explicit actions, and full current-value Booking replacement are tested. |
| AC-26 | Verified already-cancelled state produces one no-effect `already_satisfied` resolution; no duplicate Cancellation/Change/Sheet work. |
| AC-32 | Complete causal refs, transaction-owned effects, queued outbox, post-commit publish boundary, bounded audit metadata, Owner-only trust, and raw-value exclusion are tested. |
| No-Lead / Referral | Referral Booking cancellation creates no Lead; standard no-Lead Booking remains supported without invented state. |
| Privacy | Synthetic `.example.invalid` fixtures only; no payload/header/credential/contact persistence in Commands, Changes, Admin audit, or completion evidence. |

## Migration, indexes, flags, and external posture

Migration: **none**. No model/index definition changed. `TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify` targeted `testvantagemovers` read-only and exited 0. No report/apply was required or run.

Checked-in flags remain unchanged: processing/shadow true; Lead writes, Lead creation, Booking cases, Booking commands, Release cases, Release commands, Referral Booking, and email all false. Test-only Release command injection did not change repository defaults or deployment posture.

## Verification

Main server:

```text
pnpm typecheck
focused validation + route tests
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=27
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
repository-wide non-cron suite with replica opt-ins false
five cron route files as one ordinary Node test invocation
```

- Typecheck passed.
- Focused validation: 13/13; focused routes: 16/16.
- Unit 27 replica: 7/7 passed (37.2s), including exact replay, full replacement, complete cancellation chain, already-satisfied, Referral/no-Lead, all pairwise races, and every write-boundary rollback.
- Index verify exited 0 against the disposable test database.
- Repository-wide coverage: 1,471/1,471 executable ordinary tests passed across two invocations; 74 opt-in replica tests skipped in the non-replica run. The non-cron runner reported 1,377 passed / 0 failed / 74 skipped; the five cron route files reported 20/20 passed. On this Windows Node runtime, the literal all-at-once runner either retains a worker handle or, with `--test-force-exit`, hits Node's `uv_async` teardown assertion in those five otherwise-green cron workers; no test assertion failed in the split run.

Admin:

```text
pnpm test
pnpm lint
pnpm typecheck
NODE_OPTIONS=--max-old-space-size=4096 pnpm build
```

- Full tests: 223/223 passed.
- Lint and typecheck passed.
- Production build passed and generated all 39 routes/pages. An initial concurrent build exhausted the default local heap; the isolated build with an explicit 4 GiB allowance passed.

`git diff --check` is required in the final status check. Worktrees contain only uncommitted Unit 27 implementation/documentation.

## Remaining gates

Unit 28 remains separately gated by reviewed Referral classification. Unit 27 does not authorize deployment, merge, production index work, Registry changes, effect-flag enablement, current live-payload inspection, or any external send.

## Repository state and external actions

Both repositories remain on `granot-lead-lifecycle`; all Unit 27 changes are uncommitted and no unrelated user edit was overwritten.

**No commit, push, merge, deploy, production mutation, production/live payload or customer read, production/staging migration or index apply, Registry change, flag enablement, external Sheet/CRM/provider send, notification, or email occurred.** The only database writes were bounded synthetic transaction fixtures and cleanup in the configured disposable `testvantagemovers` replica. Sheet queue publishing was disabled; only queued test outbox rows were asserted and cleaned up.
