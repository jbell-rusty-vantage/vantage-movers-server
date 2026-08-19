# Unit 29 — Booking/Release discrepancies, re-evaluation, and Record Link correction

**Status:** Complete  
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` (`64ad26c` base) and `vantage-admin` / `granot-lead-lifecycle` (`aabcc70` base)

## Authority and readiness

Implemented final-spec S20 and the Unit 29 portions of AC-23/26/27/35/36 under `delivery/issues/UNIT-29.md`. Units 24–27 and their completion reports were repository-verified; Unit 27 records the accepted Owner review of Unit 26 read-only Release cases. Both worktrees began clean on the required branches. Checked-in flags, the disposable `testvantagemovers` identity/replica-set capability, queued Sheet posture, predecessor focused tests, Unit 26/27 replica proof, and prior index verification were checked before implementation.

No production metadata or payload access was needed. RingCentral's independently production-enabled/create-capable posture was noted and left untouched.

## Exact durable contract

- Added separate `GranotBookingDiscrepancy` and `GranotReleaseDiscrepancy` collections. Booking accepts only `booked_record_link_conflict`, `booked_booking_lead_conflict`, `booked_job_number_conflict`, `booked_source_scope_conflict`, and `booked_after_official_cancellation`; Release accepts only `release_without_vantage_booking`, `release_record_link_conflict`, `release_job_number_conflict`, and `release_source_scope_conflict`.
- The fingerprint is lowercase SHA-256 over versioned canonical JSON containing all null-preserving Job/kind/reason/current-reference identity keys. Golden-vector tests freeze the serialization. Contact, labels, raw Job text, evidence IDs, timestamps, and revisions are excluded.
- Both collections declare an exact partial unique open-fingerprint index and state/newest-evidence queue index. Evidence appends/deduplicates by Observation ID; resolved rows and earlier evidence are immutable.
- The processor consumes the Unit 22/26 typed conflict seams. The discrepancy module independently reloads protected current state, rejects normal/deferred/shadow/disabled paths, and atomically stores Decision plus open/refresh. Same-fingerprint races converge with the index and one retry; changed reasons get distinct rows.

## Reads, commands, and Admin

- Added signed Owner/Admin list/detail reads with bounded kind/state/reason/Job/source/date/cursor/sort filters. Lists mask contact; detail separates immutable evidence and current facts, returns revisions/capabilities, and supplies current server-derived eligible candidate suggestions. Job timelines include discrepancy events and advertise the landed capability.
- Added strict Owner-only `re-evaluate`, `correct-record-link`, and `no-action` routes with exactly one valid `Idempotency-Key`, route-owned identity, stable errors, canonical command registration, checksums, and full Receipt/Observation/Decision/discrepancy provenance.
- Re-evaluation leaves an unchanged conflict untouched except for its idempotent Command result. It may atomically resolve into a production Booking/Release case, resolve as satisfied, or open/refresh a new reason-specific discrepancy. It never re-normalizes raw payload or promotes shadow history.
- No Action writes only Command plus discrepancy resolution and increments the discrepancy revision once. It creates no Change, link, case, official aggregate mutation, Sheet work, notification, or email.
- Correction revalidates open discrepancy and active disputed Granot link revisions plus selected Lead eligibility. Duplicate/Bad Form Leads are rejected. One transaction supersedes and preserves the old link, creates the replacement with the selected Lead's unchanged authoritative Source Scope, appends exactly two link `EntityChange` rows, resolves the discrepancy, persists the Command, and opens/refreshes any now-valid normal case. No Lead attribution/business field or official Booking/Cancellation changes.
- Admin adds the discrepancy queue/detail routes, explicit candidate/manual selection, Re-evaluate/Correct/No Action actions, accessible labels/non-color status, stable query keys, and affected-view invalidation. A `409` refetches facts while preserving the Lead/reason draft and never auto-resubmits. BFF authorization and audits are exact; audits mask refs and omit Job/contact/reason/raw response.

## Acceptance and invariant proof

| Acceptance / invariant | Proof |
| --- | --- |
| AC-23 | Owner-selected eligible Lead atomically replaces the disputed active link; old history and two Changes persist while Lead Source Scope/Origin/CPL remain unchanged. |
| AC-26 | Booked after official Cancellation has the exact Booking reason; unchanged current conflict re-evaluation/replay is replica-proven; already-cancelled Release remains outside discrepancies. |
| AC-27 | Missing Booking and exact Release link/Job/source conflicts route only to separate Release discrepancy storage and produce no official effect. |
| AC-35 | Projection/UI/audit contracts expose masked contact and bounded refs only; raw payload/header/credential/address/reason prose are absent. |
| AC-36 | Real partial unique indexes allow one open kind/fingerprint while retaining resolved history; replay, revision race, refresh/dedupe, and rollback are proven. |
| Atomicity / zero effects | Decision+discrepancy and correction Command+links+Changes+resolution+optional case share transactions. Injected post-Change failure leaves no link/discrepancy/Command/Change partial state; official and Sheet counts remain zero. |

## Migration, indexes, flags, and privacy

Index catalog version 12 contains the four named definitions. Report/collision output is deterministic and PII-safe; non-unique definitions precede unique creation. The serialized Unit 29 replica proof created/used the definitions only in disposable `testvantagemovers`. `TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify` then exited 0 read-only. No `--apply`, backfill, or production index action ran; production posture remains unproven.

Checked-in defaults are unchanged: processing and shadow true; all eight Lead/Booking/Release/Referral/email effect flags false. There is no new discrepancy flag. Tests injected only applicable synthetic live gates. Raw/live payloads, customer data, credentials, addresses, and unmasked contact were not read or emitted.

## Verification

Main server:

```text
pnpm typecheck
focused Unit 29 command from the contract
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=29
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
GRANOT_LIFECYCLE_REPLICA_TESTS=false pnpm test
```

- Typecheck passed.
- Focused contract suite: 87/87 passed.
- Serialized Unit 29 replica proof: 5/5 passed, covering real unique-open history, No Action replay/race/zero effect, unchanged-conflict re-evaluation/replay, atomic correction/source preservation/two Changes/zero official-Sheet effect, and rollback after Change persistence.
- Aggregate index verification exited 0 against `testvantagemovers`.
- Repository-wide ordinary suite: 1,500 total; 1,415 passed, 85 expected opt-in replica skips, 0 failed.

Admin:

```text
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

- Full tests: 229/229 passed.
- Lint and typecheck passed.
- Production build passed and generated 40 routes/pages, including both discrepancy routes.

Final current-tree `git diff --check`, branch/status capture, and privacy scan passed after documentation. All implementation/documentation remains uncommitted in the two worktrees.

## Remaining gates and external actions

Unit 29 completes S20 and makes Unit 30 ready after applicable Units 01–29 were repository-verified. Unit 31 remains blocked on Unit 30. This completion does not authorize rollout, production indexes, optional email, cleanup, or current-payload certification.

**No commit, push, merge, deploy, production/staging mutation, production migration/index apply, flag enablement, live payload/customer inspection, external Sheet/CRM/provider request or send, notification, or email occurred.** Database writes were redacted synthetic fixtures plus cleanup in the configured disposable `testvantagemovers` replica; Sheet mode was queued and no external delivery ran.
