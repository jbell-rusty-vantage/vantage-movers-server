# Granot Lead Lifecycle — unit status ledger

This ledger is a navigation aid. Repository state, migrations/indexes, flags, and test output are authoritative. A primary agent must verify predecessor evidence rather than trusting this file alone.

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `rejected`, `optional`. `Contract` distinguishes the fully authored next unit from later scaffolds.

| Unit | Title | Prerequisites | Status | Contract | Completion report |
| --- | --- | --- | --- | --- | --- |
| 01 | Contract freeze, redacted synthetic fixtures, and quality guardrails | none | complete | complete | [UNIT-01-COMPLETION.md](completion-reports/UNIT-01-COMPLETION.md) |
| 02 | Channel-neutral receipt model, evidence immutability, and receipt migration | 01 | complete | complete | [UNIT-02-COMPLETION.md](completion-reports/UNIT-02-COMPLETION.md) |
| 03 | Webhook authentication, secure capture, response, and queue wake-up seam | 01–02 | complete | complete | [UNIT-03-COMPLETION.md](completion-reports/UNIT-03-COMPLETION.md) |
| 04 | Observation persistence and exact normalization vocabulary | 01–03 | complete | complete | [UNIT-04-COMPLETION.md](completion-reports/UNIT-04-COMPLETION.md) |
| 05 | Audited Granot CRM source Registry domain | 01 | complete | complete | [UNIT-05-COMPLETION.md](completion-reports/UNIT-05-COMPLETION.md) |
| 06 | Registry migration, automation compatibility link, and reviewed Registry UI | 05 | complete | complete | [UNIT-06-COMPLETION.md](completion-reports/UNIT-06-COMPLETION.md) |
| 07 | Decision, activation, Record Link, execution mode, and safe operational skeleton | 04–06 | complete | complete | [UNIT-07-COMPLETION.md](completion-reports/UNIT-07-COMPLETION.md) |
| 08 | Durable claim service, drainer, queue/cron, retries, dead letter, and manual requeue | 04, 07 | complete | complete | [UNIT-08-COMPLETION.md](completion-reports/UNIT-08-COMPLETION.md) |
| 09 | Aggregate revision fields and additive revision migrations | 01 | complete | complete | [UNIT-09-COMPLETION.md](completion-reports/UNIT-09-COMPLETION.md) |
| 10 | Transaction-owning canonical command executor and idempotent replay | 09 | complete | complete | [UNIT-10-COMPLETION.md](completion-reports/UNIT-10-COMPLETION.md) |
| 11 | Entity Change, outbox atomicity, and canonicalization of existing write adapters | 09–10 | complete | complete | [UNIT-11-COMPLETION.md](completion-reports/UNIT-11-COMPLETION.md) |
| 12 | Lead provenance schema parity, immutable snapshots, and trusted validators | 05, 09–11 | complete | complete | [UNIT-12-COMPLETION.md](completion-reports/UNIT-12-COMPLETION.md) |
| 13 | Lead provenance and index migration suite | 12 | complete | complete | [UNIT-13-COMPLETION.md](completion-reports/UNIT-13-COMPLETION.md) |
| 14 | Source policy resolution and source-scoped identity ladders | 04–07, 12–13 | complete | complete | [UNIT-14-COMPLETION.md](completion-reports/UNIT-14-COMPLETION.md) |
| 15 | Temporal ordering, desired-state planning, and shadow processor orchestration | 07–08, 14 | complete | complete | [UNIT-15-COMPLETION.md](completion-reports/UNIT-15-COMPLETION.md) |
| 16 | Browser extension receipt apply and version 0.2.8 | 02–04, 14–15 | complete | complete | [UNIT-16-COMPLETION.md](completion-reports/UNIT-16-COMPLETION.md) |
| 17 | HTTP automation receipt convergence and resumable lifecycle outcomes | 02–04, 14–15 | complete | complete | [UNIT-17-COMPLETION.md](completion-reports/UNIT-17-COMPLETION.md) |
| 18 | Safe matched-Lead synchronization effects | 10–17, parity approval | complete | complete | [UNIT-18-COMPLETION.md](completion-reports/UNIT-18-COMPLETION.md) |
| 19 | Authorized Granot Lead creation and atomic link reservation | 18 | complete | complete | [UNIT-19-COMPLETION.md](completion-reports/UNIT-19-COMPLETION.md) |
| 20 | RingCentral adoption/convergence and duplicate correctness | 12, 19 | complete | complete | [UNIT-20-COMPLETION.md](completion-reports/UNIT-20-COMPLETION.md) |
| 21 | RingCentral Call Log lease, telemetry, overlap safety, and 30-minute cadence | 20 | complete | complete | [UNIT-21-COMPLETION.md](completion-reports/UNIT-21-COMPLETION.md) |
| 22 | Booking Reconciliation persistence, sequencing, and read-only reconciliation service | 07, 14–15, 18 | ready | complete | — |
| 23 | Booking lifecycle reads, Admin queue/detail, candidate browser, and Job/Lead timeline | 22 | blocked | complete | — |
| 24 | Confirm missing standard Booking owner workflow | 10–11, 22–23, Owner review | blocked | complete | — |
| 25 | Existing Booking update and Booking No Action workflows | 24 | blocked | complete | — |
| 26 | Release Reconciliation persistence, projections, and read-only Admin workflow | 22–23 | blocked | scaffold | — |
| 27 | Release owner commands: cancellation, Booking update, and No Action | 10–11, 26, Owner review | blocked | scaffold | — |
| 28 | Referral Booking case and leadless canonical owner workflow | 24–25, reviewed Referral classification | blocked | scaffold | — |
| 29 | Booking/Release discrepancies, re-evaluation, and Record Link correction | 24–27 | blocked | scaffold | — |
| 30 | Operational events, metrics, health projection, and rollout alerts | applicable 01–29 | blocked | scaffold | — |
| 31 | Migration/index verification, historical shadow certification, security audit, and runbooks | applicable 01–30 | blocked | scaffold | — |
| 32 | Optional new-case email notifications | accepted case workflows, explicit inclusion approval | optional | scaffold | — |
| 33 | Prototype retirement, compatibility cleanup, and complete synthetic regression | 01–31; 32 if included | blocked | scaffold | — |
| 34 | Final current-Granot-webhook-payload application-logic certification | 01–31, 33; 32 if included | blocked | scaffold | — |

## Current ready queue

- Open review findings live in [`warnings/`](warnings/README.md). They do not block the next sequential unit unless repository re-verification shows an applicable finding has become material.
- Units 04–18 are complete on `granot-lead-lifecycle`. Re-verify the matching completion report before depending on a later unit.
- Unit 08 completes S06 and removes Unit 15's durable-work prerequisite. Unit 14 now supplies the identity resolver Unit 15 must consume.
- Unit 09 lands aggregate revision tokens, the CAS primitive, and revision-only Lead/Booking/Cancellation backfill. Units 12–13 must preserve those revisions and the persisted history boundary.
- Unit 10 lands the transaction-owning canonical executor, four-origin validation, stored `applied` replay, and Decision/revision/Command rollback.
- Unit 11 completes S07: append-only `EntityChange`, queued outbox atomicity, and canonicalization of existing write adapters. Later lifecycle/owner commands remain disabled.
- Unit 12 completes the S08 schema/runtime half: Ingestion Origin, immutable ingested snapshots, Form Job parity, Call `quoted` default false, trusted/public validator separation, and seven Lead index declarations. Lead writes/creation remain false.
- Unit 13 completes S08: fail-closed origin/Job/`legacy_baseline` backfill on the fixed Lead command, PII-safe dual manifests, and the seven non-unique Lead indexes. Unit 09 revisions/history boundary are preserved. Lead writes/creation remain false. No production apply.
- Unit 14 completes the identity half of S09: policy-before-identity, Form/Call ladders, Agent assertion, and Booking delegation context. It writes no data and does not invoke from the Unit 07 processor. Lead writes/creation remain false.
- Unit 15 completes S09: temporal compare, desired-state planning, and shadow processor orchestration. It consumes `resolveLeadIdentity`, persists Receipt→Observation→Decision refs, and keeps Lead writes/creation/cases false. Historical shadow may still create job-level Record Link evidence only.
- Unit 16 is complete on `granot-lead-lifecycle` plus `granot_sync_extensions_and_services/main` (`0.2.8`). Re-verify `UNIT-16-COMPLETION.md` before depending on extension receipt apply.
- Unit 17 is complete on `granot-lead-lifecycle` (server + Admin display/adapter). Re-verify `UNIT-17-COMPLETION.md` before depending on HTTP automation receipt apply. Schema-v1 plans fail closed. Checked-in defaults remain shadow true with Lead writes/creation/cases false.
- Unit 18 is complete on `granot-lead-lifecycle`. Re-verify `UNIT-18-COMPLETION.md` before depending on `synchronizeLeadFromGranot`. Checked-in defaults remain shadow true and every effect flag false; focused/replica tests inject live + Lead writes only.
- Unit 19 is complete on `granot-lead-lifecycle`. Unit 20 is complete with Granot-created CallLead adoption, ambiguity conflict evidence, earlier-only duplicate correctness, and the collision-audited processed-call `callLogId` unique sparse index path. Checked-in adoption remains disabled; only the disposable test database received the index. Unit 21 is complete and closes S14.
- Unit 21 is complete on `granot-lead-lifecycle`. It lands the `key:"account"` five-minute renewable Call Log state lease, owner-fenced renewal/finalization/release, cursor movement only on complete success, the locked 12-hour rolling floor, bounded runtime/adoption/conflict/throttle/contention telemetry with the exact Section 33 metric names, the `lease_held` cron skip, the collision-reported unique `ringcentral_call_log_sync_state_key_unique` index path, and the final `*/30 * * * *` cadence. Runtime fails closed when the singleton index is absent, so that index must be applied and verified in production **before** the lease code is enabled there; no apply was performed or authorized. Checked-in flags are unchanged: Call Log sync, Lead creation, shadow, and Unit 20 adoption all remain false. Unit 21 completes S14 and unblocks no further unit — Unit 22 was already spec-unblocked by Units 07/14–15/18.
- Unit 22 is spec-unblocked by Unit 18 (Units 07, 14, and 15 are already complete). Shared-branch sequencing: do not start Unit 22 in parallel with Unit 19 unless a designated integration owner assigns non-overlapping files. Unit 23 waits for Unit 22 and owns read/API/Admin deployment before any separately approved Booking-case enablement; Booking commands remain false.
- Units 24–25 now have complete implementation contracts but remain implementation-blocked. Unit 24 waits for verified Units 22–23 and Owner review of the deployed read-only Booking workflow (Units 10–11 are already complete); it lands confirm-missing capability with the shared Booking command flag still false. Unit 25 waits for verified Unit 24, owns existing-Booking update and standard Booking No Action, and completes S16 before any separately authorized narrow Booking-command rollout.
