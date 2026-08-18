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
| 14 | Source policy resolution and source-scoped identity ladders | 04–07, 12–13 | ready | complete | — |
| 15 | Temporal ordering, desired-state planning, and shadow processor orchestration | 07–08, 14 | blocked | complete | — |
| 16 | Browser extension receipt apply and version 0.2.8 | 02–04, 14–15 | blocked | complete | — |
| 17 | HTTP automation receipt convergence and resumable lifecycle outcomes | 02–04, 14–15 | blocked | scaffold | — |
| 18 | Safe matched-Lead synchronization effects | 10–17, parity approval | blocked | scaffold | — |
| 19 | Authorized Granot Lead creation and atomic link reservation | 18 | blocked | scaffold | — |
| 20 | RingCentral adoption/convergence and duplicate correctness | 12, 19 | blocked | scaffold | — |
| 21 | RingCentral Call Log lease, telemetry, overlap safety, and 30-minute cadence | 20 | blocked | scaffold | — |
| 22 | Booking Reconciliation persistence, sequencing, and read-only reconciliation service | 07, 14–15, 18 | blocked | scaffold | — |
| 23 | Booking lifecycle reads, Admin queue/detail, candidate browser, and Job/Lead timeline | 22 | blocked | scaffold | — |
| 24 | Confirm missing standard Booking owner workflow | 10–11, 22–23, Owner review | blocked | scaffold | — |
| 25 | Existing Booking update and Booking No Action workflows | 24 | blocked | scaffold | — |
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
- Units 04–13 are complete on `granot-lead-lifecycle`. Re-verify `UNIT-13-COMPLETION.md` and repository state before starting Unit 14.
- Unit 08 completes S06 and removes Unit 15's durable-work prerequisite. Unit 15 still waits for Unit 14 and its other approved prerequisites.
- Unit 09 lands aggregate revision tokens, the CAS primitive, and revision-only Lead/Booking/Cancellation backfill. Units 12–13 must preserve those revisions and the persisted history boundary.
- Unit 10 lands the transaction-owning canonical executor, four-origin validation, stored `applied` replay, and Decision/revision/Command rollback.
- Unit 11 completes S07: append-only `EntityChange`, queued outbox atomicity, and canonicalization of existing write adapters. Later lifecycle/owner commands remain disabled.
- Unit 12 completes the S08 schema/runtime half: Ingestion Origin, immutable ingested snapshots, Form Job parity, Call `quoted` default false, trusted/public validator separation, and seven Lead index declarations. Lead writes/creation remain false.
- Unit 13 completes S08: fail-closed origin/Job/`legacy_baseline` backfill on the fixed Lead command, PII-safe dual manifests, and the seven non-unique Lead indexes. Unit 09 revisions/history boundary are preserved. Lead writes/creation remain false. No production apply.
- Unit 14 is implementation-ready and is the next sequential shared-branch implementation target. Re-verify `UNIT-13-COMPLETION.md` before starting it. It must consume origin/snapshot fields read-only and must not reinterpret `legacy_unknown` or `legacy_baseline`.
- Unit 15's contract is complete. It remains blocked until Unit 14 is implemented and verified; Units 07–08 are already complete.
- Unit 16's contract is complete. It remains blocked until Units 14–15 are implemented and verified. It must remain in shadow and cannot provide the parity approval required by Unit 18 until its server/extension implementation and cross-channel proof are complete.
