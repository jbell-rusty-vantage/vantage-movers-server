# Unit 28 — Referral Booking case and leadless canonical owner workflow

**Status:** Complete  
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` (`0280ba4` base) and `vantage-admin` / `granot-lead-lifecycle` (`cbdf22a` base)

## Authority and readiness

Implemented final-spec S19 and AC-28, with the shared atomicity/privacy requirements of AC-32, under `delivery/issues/UNIT-28.md`. Units 24–25, their completion evidence, canonical Booking command primitives, current branches, clean starting worktrees, checked-in flag defaults, and disposable replica identity were reverified before implementation.

The separate Referral-classification gate was satisfied through a bounded read-only Operations Registry inspection against production metadata only. Database `vantagemovers` contained one enabled, lifecycle-enabled row for normalized label `referral`: source ID `6a85462a1ff601e1d4ab9638`, display label `Referral`, disposition `referral_booking`, `lead_created_policy:observation_only`, no Lead Source Company, zero lifecycle routes, policy version `granot-lifecycle-source-policy-v1`, updated `2026-08-19T05:59:06.853Z`. Its audit row `6a85462a1ff601e1d4ab9639` records action `create`, system actor with Owner role, reason `official Granot source seed`, request ID `official-granot-crm-sources:referral`, created `2026-08-19T05:59:06.884Z`. No payload, contact, customer, credential, or other operational row was inspected, and nothing was mutated.

## Behavior delivered

### Source policy, cases, and reads

- Exact reviewed `referral_booking` policy plus live actual `booked` evidence routes through the existing Booking reconciliation transaction. Priority `5` alone, source guesses, disabled gates, shadow/historical execution, and non-Referral policy do not enter the path.
- With no Booking, one lead-free `create_referral_booking` case opens or refreshes with no Source Scope, suggestion, candidate search, or deterministic Booking. The immutable Decision stores the exact reviewed source ID, disposition, and policy version used at first open; command execution fails closed if current policy drifts.
- The first Receipt → Observation → Decision evidence entry remains the accepted command provenance. Projections derive masked contact and Job evidence from that Observation while keeping Granot evidence distinct from official values.
- An existing active Referral Booking routes to `review_existing_booking`, still without candidate search or a Lead requirement. Incompatible source/Booking/link identity stays on the Unit 29 discrepancy seam; cancelled Booking behavior remains unchanged.

### Owner commands and atomic effects

- Added exact Owner-only `POST /api/v1/admin/granot-lifecycle/booking-cases/:id/create-referral-booking`, requiring one printable 8–200 character `Idempotency-Key` and a strict body containing only `expected_case_revision` plus complete `official_booking` details.
- Registered canonical command `createReferralBooking`. It reloads the accepted Observation, reviewed source policy, open case, normalized Job, Booking uniqueness, and active Record Link, and verifies both Booking-command and Referral gates before any write.
- One transaction creates exactly one `BookedLead` with canonical `source:"referral"`, `is_referral_booking:true`, `is_leadless_booking:false`, accepted Observation Job/contact, submitted official fields, and no Lead/source scope/origin/CPL fabrication; writes a Booking-only active Record Link; appends causal Booking and link Changes; resolves the case; persists the Command; and queues one `booked_lead` / `referral_booking.create` outbox intent.
- The outbox planner targets only `master_booked`. No source Form/Call projection, `booking_chain`, Lead mirror/Change, Cancellation, notification, or email is produced. External delivery remains post-commit and disabled in tests.
- Exact replay returns the stored result. A verified identical Booking/link state resolves `already_satisfied`; different identity fails closed. Competing create/create and create/No Action attempts have one case-revision winner. Every persisted-boundary failure rolls back all causal rows.
- Referral `create_referral_booking` No Action reuses the canonical zero-effect Booking command. Existing Referral Booking update and No Action are now Referral-safe only when both required gates pass; neither can attach or fabricate a Lead.

### Admin

- Added a blank official Referral Booking form with explicit edit → review → final `Create Booking`, accessible labels/error focus, stable per-body idempotency, pending double-submit protection, and no evidence-based official prefill.
- Case detail displays the reviewed source label and accepted masked evidence, exposes no Lead candidate/selector, and gates create/update/No Action capabilities on open state plus both server flags.
- A `409` preserves every unsent official field, refetches affected case/Booking/link views, explains the conflict, and never auto-resubmits.
- The authenticated BFF forwards `Idempotency-Key` only for the exact command route. Admin remains denied and Owner allowed. Audit metadata is bounded to operation/revision/count/presence facts and excludes money, catalog IDs, contact, Job, notes/reasons, and official field values.

## Behavior-grouped files

- Server policy/case/read model: `src/services/granotLifecycle/sourcePolicy.ts`, `bookingReconciliation.ts`, `processor.ts`, `projections.ts`, and additive `src/models/SynchronizationDecision.ts` source-policy evidence.
- Server command: new `src/services/granotLifecycle/referralBooking.ts`; domain command types/registration; Referral-safe Booking update/No Action; strict validation and Owner route.
- Server proof: focused policy/model/validation/route/reconciliation/command tests, new unit and replica Referral suites, ingestion mock parity, and Unit 28 replica-runner registration.
- Admin client/UI: `lib/api/granotLifecycle.ts`, new `referral-booking-form.tsx`, Booking Owner actions, case detail, and No Action copy.
- Admin trust/audit/proof: proxy header forwarding, authorization, bounded audit payloads, API tests, and component contract tests.
- Documentation: Booking/reconciliation/projection software maps, owner/capture/schema/project rules, `.cursor/index.md`, delivery ledger, and this report.

## Acceptance and invariant proof

| Acceptance / invariant | Proof |
| --- | --- |
| AC-28 case/read | Exact reviewed Referral actual-Booked evidence opens/refreshes one lead-free case; source policy is immutable in Decision evidence; candidates, suggestions, Source Scope, and Lead selectors are absent. |
| AC-28 command | Explicit Owner input creates one canonical Referral Booking and one Booking-only active Record Link; strict official details come only from the reviewed form and Job/contact only from accepted immutable evidence. |
| AC-28 projection | One queued `booked_lead` intent plans exactly `master_booked`; source projections, Lead work, Cancellation, notification, and email counts stay zero. |
| Existing Referral | Later actual-Booked evidence routes to review-existing; update/No Action remain lead-free and cannot create a second Booking. |
| Replay / concurrency | Stored replay, checksum conflict, same-state already-satisfied, create/create, create/No Action, Job uniqueness, and conflicting-link outcomes are unit- and replica-proven. |
| AC-32 atomicity | Booking, link, case, Command, Changes/revisions, and outbox commit together; injected failures after every persisted boundary leave no partial causal state. |
| Policy / gates | Live mode, both command flags, exact current Registry row/version, accepted evidence chain, case revision, and identity are revalidated server-side; policy drift fails closed. |
| Privacy | Synthetic `.example.invalid` fixtures only; raw payloads, secrets, unmasked contact/address, and official values do not enter logs, audit payloads, or this report. |

## Migration, indexes, flags, and external posture

Migration: **none**. Unit 28 consumes existing Booking-case, normalized-Job Booking, active Record Link, Command/Change, and outbox indexes. The additive immutable Decision `source_policy` subdocument requires no index or backfill. `TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify` targeted `testvantagemovers` read-only and exited 0; no apply was run.

Checked-in defaults are unchanged before/after: processing and shadow true; Lead writes, Lead creation, Booking cases, Booking commands, Release cases, Release commands, Referral Booking, and email false. Tests inject only disposable live/case/command/Referral gates.

## Verification

Main server:

```text
pnpm typecheck
focused Decision/source-policy/validation/routes/reconciliation/command/domain/outbox tests
pnpm test:granot-lifecycle:replica -- --unit=28
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
TEST_MODE=true GRANOT_LIFECYCLE_REPLICA_TESTS=false repository-wide non-cron suite
five cron route files as one ordinary Node test invocation
```

- Typecheck passed.
- Final focused suite: 81/81 passed, including the source-policy matrix and Decision serialization.
- Unit 28 serialized replica proof: 9/9 passed in 35.5s, covering simultaneous case open, inherited Unit 22 sequence/rollback behavior, exact create/replay/Master target, already-satisfied, existing Referral update/No Action, competing Owners, policy drift/conflicting link, and rollback after every persisted boundary.
- Index verification exited 0 against `testvantagemovers`.
- Repository-wide ordinary coverage: non-cron 1,384 passed / 0 failed / 80 opt-in replica tests skipped; five cron route files 20/20 passed. Total executable assertions across the split were 1,404/1,404. The literal Windows runner retains a worker handle; the explicit split and non-cron `--test-force-exit` provide clean exits. Because the local environment opts replica tests in, the authoritative non-replica command explicitly sets `GRANOT_LIFECYCLE_REPLICA_TESTS=false`; replica suites are run serially by the unit runner instead of concurrently against shared collections.

Admin:

```text
pnpm test
pnpm lint
pnpm typecheck
NODE_OPTIONS=--max-old-space-size=4096 pnpm build
```

- Full tests: 225/225 passed.
- Lint and typecheck passed.
- Production build passed and generated all 39 routes/pages.

Final `git diff --check`, current-tree typecheck, focused policy proof, and branch/status capture are required after this report is added.

## Remaining gates

Unit 28 completes S19. Unit 29 remains independently ready from Units 24–27; Unit 30 remains blocked until all applicable Units 01–29, including Unit 29, are complete. Completion does not authorize deployment, production Referral enablement, Registry mutation, migration/index apply, payload/customer inspection, or external delivery.

## Repository state and external actions

Both repositories remain on `granot-lead-lifecycle`; all Unit 28 implementation and documentation remains uncommitted. Starting worktrees were clean, and no unrelated user edit was overwritten.

**No commit, push, merge, deploy, production mutation, production/staging migration or index apply, Registry change, flag enablement, production/live payload or customer read, external Sheet/CRM/provider send, notification, or email occurred.** The only production access was the bounded read-only Referral Registry source/audit metadata verification described above. Database writes were synthetic fixtures and cleanup in the configured disposable `testvantagemovers` replica; Sheet publishing was disabled and only queued test outbox rows/target planning were asserted.
