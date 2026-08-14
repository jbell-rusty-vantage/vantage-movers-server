Granot Lead Lifecycle — 34-Unit Issue-Authoring Handoff

Date prepared: 2026-08-14  
Purpose: companion document for converting the final specification into 30–34 agent-ready implementation issues  
Issue-authoring target: 34 numbered units maximum, including one optional email unit and one mandatory final real-shape webhook certification unit

## 1. Authority and how to use this document

The implementation contract remains:

- [`FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md)
- Canonical terminology: [`CONTEXT.md`](C:/Users/Pinda/Proyectos/vantage/CONTEXT.md)
- Delivery/branch rule: [`lead-lifecycle-delivery.mdc`](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.cursor/rules/lead-lifecycle-delivery.mdc)
- Server agent/runtime guidance: [`AGENTS.md`](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/AGENTS.md) and [`CLOUD_AGENTS.md`](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/CLOUD_AGENTS.md)

This handoff does **not** replace or reinterpret the specification. It recommends how to split the specification’s S01–S23 milestones into agent-sized units while preserving delivery order, tracer-bullet behavior, migrations, flags, tests, verification, and rollback. If this handoff conflicts with the final specification, the final specification wins.

The issue author should use the unit titles below as the issue spine, then copy the exact applicable contracts, acceptance language, flags, migration flow, live verification, and rollback language from the cited specification sections. Do not rely on this handoff as a substitute for reading those sections.

### Count and optionality

- Maximum plan: **34 units**.
- Units 01–31 and 33–34 are required to complete the currently specified release.
- Unit 32, optional email notifications, is conditional on separate Owner acceptance as required by specification Sections 32 and S22.
- If Unit 32 is omitted, the plan contains **33 units**.
- Unit 34 is mandatory and must remain the final unit. It uses current Granot webhook payload shapes in a controlled test harness only after all implementation, cleanup, and ordinary regression work is complete.

### Non-negotiable planning interpretation

The original S01–S23 slices in specification Section 38 remain the program milestones and rollout ordering authority. The units below only subdivide oversized milestones. They must not be regrouped into horizontal batches such as “all models,” “all routes,” or “all UI.” Each issue must prove an independently safe increment through production-facing module boundaries where those boundaries exist.

## 2. Program-wide constraints

Every issue must preserve the invariants in specification Section 4 and the architecture in Sections 5–6. In particular:

1. MongoDB remains the system of record.
2. Granot observations are evidence, not authority for official Booking or Cancellation facts.
3. Only canonical domain commands mutate Leads, Bookings, or Cancellations.
4. Effect-bearing processing is transactional and causally traceable through Receipt → Observation → Decision → Command → Entity Change/outbox as required by Section 23.
5. Source System, Observation Channel, Ingestion Origin, actor, and initiator remain separate provenance axes.
6. Immutable submission/creation evidence is never overwritten.
7. Identity conflict never reassigns source ownership or CPL.
8. Resolved reconciliation cases never reopen; later actions receive the next sequence.
9. No issue may automatically create/update/cancel/un-cancel a Booking based only on Granot evidence.
10. Raw payloads, credentials, and unmasked contact data must not appear in lifecycle admin projections, logs, hook output, issue comments, test names, or generated reports.

### Repository and branch contract

Follow specification Section 3 and the delivery rule exactly:

| Repository                            | Branch                                                  | Ownership                                                                              |
| ------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `vantage-main-server`                 | one `lead-lifecycle` branch created from current `main` | runtime models/services, migrations, processor, queues/crons, canonical commands, APIs |
| `vantage-admin`                       | one `lead-lifecycle` branch created from current `main` | queues, details, timelines, Registry UI, owner forms                                   |
| `granot_sync_extensions_and_services` | `main`                                                  | receipt-based extension apply and version `0.2.8`                                      |

At handoff preparation time all three repositories were on `main` and had no reported short-status changes. Every implementing agent must independently run `git status --short` and `git branch --show-current` before editing; this observation is not durable evidence for a later session.

Do not create per-unit feature branches. Do not commit, push, deploy, apply production migrations, enable production effects, or send live customer payloads without separate user authorization.

## 3. Recommended 34-unit delivery map

Dependencies below are delivery dependencies, not merely suggested reading order. “Original slice” refers to Section 38 of the final specification.

### Unit 01 — Contract freeze, redacted synthetic fixtures, and quality guardrails

- **Original slice:** S01.
- **Specification:** Sections 4–7, 10, 35–36, 37.2; especially AC-03, normalization portions of AC-05/06, and AC-29.
- **Repos:** server.
- **Prerequisites:** none.
- **Outcome:** establish shared lifecycle vocabulary/types, Zod fixture contract, redacted synthetic fixtures for all three channels, AC-ID test naming convention, and fixture secret/PII scanning.
- **Required doc correction:** update the stale statement in `.cursor/rules/owner-lead-workflow.mdc`; `FormLead.ref_no`, not Mongo `_id`, is posted as Granot `leadno`. Preserve Mongo `_id` compatibility lookup only as specified.
- **Optional hook foundation:** add only non-mutating local review hooks if desired. Hook policy is in Section 6 of this handoff. Hook setup must not delay contract tests.
- **Proof:** focused unit tests; fixture scanner proves no credentials/PII; test names include applicable AC IDs.
- **Boundary:** no runtime persistence changes.

### Unit 02 — Channel-neutral receipt model, evidence immutability, and receipt migration

- **Original slice:** first half of S02.
- **Specification:** Sections 9.1, 9.4, 34.1, 34.5; AC-02 identity foundation and AC-35.
- **Repos:** server.
- **Prerequisites:** Unit 01.
- **Outcome:** evolve `GranotWebhookReceipt` in place into `GranotObservationReceipt`, retain collection name, add compatibility model alias, evidence/work-state validation and indexes, write-once evidence enforcement, and dry-run/report/apply/verify migration tooling.
- **Proof:** model tests for evidence immutability, channel-specific required fields, operation-ID validation, indexes, historical translation, credential-key removal, deterministic canonical hash, and idempotent migration rerun.
- **Boundary:** processing remains off; no domain effects.

### Unit 03 — Webhook authentication, secure capture, response, and queue wake-up seam

- **Original slice:** second half of S02.
- **Specification:** Sections 9.2–9.3, 28.1, 33; AC-01, webhook portion of AC-02, AC-35.
- **Repos:** server.
- **Prerequisites:** Units 01–02.
- **Outcome:** implement header/body-secret rules, timing-safe comparison, credential deletion before all downstream handling, exact header allowlist, capture-before-202 behavior, safe 401/500/503 envelopes, and best-effort receipt-ID-only queue publish.
- **Proof:** route/service tests for JSON/form/header auth permutations, both-secret agreement, missing configuration, unauthorized no-row behavior, payload hashing after credential stripping, publish failure preserving `202`, capture failure returning `503`, and no sensitive output.
- **Boundary:** queue publishing is a wake-up only; no processing implementation yet.

### Unit 04 — Observation persistence and exact normalization vocabulary

- **Original slice:** S03.
- **Specification:** Sections 7 and 10; AC-05/06 and action aliases from AC-25/29.
- **Repos:** server.
- **Prerequisites:** Units 01–03.
- **Outcome:** one Observation per receipt; exact scalar, source, identity, contact, move, Priority, money, Agent, and Booking Action normalization; invalid/unsupported completion vocabulary.
- **Proof:** pure and model tests across webhook encodings and extension/automation operation kinds; exact `Booked`, `Releas`, and `Release` handling; explicit rejection of `Released`; Priority edge cases including `0`, `05`, large allowed values, malformed/missing values, and safe raw preservation.
- **Boundary:** shadow-safe normalization only; no target matching or aggregate mutation.

### Unit 05 — Audited Granot CRM source Registry domain

- **Original slice:** server-domain portion of S04.
- **Specification:** Sections 8.1 and 8.4, plus Section 23 provenance expectations; AC-04/09/29/38.
- **Repos:** server.
- **Prerequisites:** Unit 01.
- **Outcome:** `GranotCrmSource` semantic fields, strict route/disposition/policy validation, trusted Registry commands, transactionally paired audit, cache invalidation after commit, layered effect-gate evaluation, and runtime fail-closed resolution.
- **Proof:** model/service tests for normalized labels, illegal/ambiguous routes, inactive scopes, legal creation policy combinations, audit atomicity, cache invalidation ordering, and gate snapshots.
- **Boundary:** all lifecycle rows remain disabled/deferred by default.

### Unit 06 — Registry migration, automation compatibility link, and reviewed Registry UI

- **Original slice:** migration/UI portion of S04.
- **Specification:** Sections 8.2–8.3, 29 as applicable, 34.2, 38/S04; AC-09/29/38.
- **Repos:** server; admin only for the minimum reviewed mutation/display surface needed.
- **Prerequisites:** Unit 05.
- **Outcome:** exact-normalized source inventory/join, `GranotAutomationSource` reference adapter, locked initial classifications, unmatched/ambiguous report, audited enable/edit UX where needed, and PII-safe report/apply/verify commands.
- **Proof:** migration tests demonstrate no guessed IDs, disabled/deferred ambiguous rows, exact Best Relocation Form/Call routing, Referral/Paid Overflow/Auto behavior, compatible automation reads, and visible compatibility errors.
- **Boundary:** migration must leave `lead_created_policy=link_only`; creation is enabled only later in Unit 19.

### Unit 07 — Decision, activation, Record Link, execution mode, and safe operational skeleton

- **Original slice:** S05.
- **Specification:** Sections 11, 13, 27.1, 28.2 read skeleton, 33; AC-02 decision evidence, AC-31, Record Link portions of AC-32/35.
- **Repos:** server.
- **Prerequisites:** Units 04–06.
- **Outcome:** persistence models/indexes for Synchronization Decision, Lifecycle Activation, and Granot Record Link; historical/live-shadow/live classification; safe link-only evidence; activation command; initial health/Job projections without raw payloads.
- **Proof:** model/module tests for unique attempts, active Job link uniqueness, disputed-link lookup, write-once activation, historical cutoff permanence, safe projections, and historical processing producing no forbidden effects.
- **Boundary:** shadow on; all mutation/case flags off.

### Unit 08 — Durable claim service, drainer, queue/cron, retries, dead letter, and manual requeue

- **Original slice:** S06.
- **Specification:** Sections 26, 28.3 requeue, 33; AC-30/37 plus lease recovery.
- **Repos:** server.
- **Prerequisites:** Units 04 and 07.
- **Outcome:** atomic claim/fencing, renew/recover, queue consumer registration, five-minute cron drainer, synchronous claimant polling, technical retry schedule, business pending-match schedule, dead letter, Owner-only audited manual requeue, and safe operational metrics.
- **Proof:** fake-clock and integration tests for single claimant, lost lease, expired recovery, technical attempt 10, exact match schedule through 24 hours, dependency failure creating no Decision, payload identity protection, and manual-requeue audit/reason.
- **Boundary:** processor runs only in historical/live shadow.

### Unit 09 — Aggregate revision fields and additive revision migrations

- **Original slice:** first foundation of S07 plus revision portions of S08.
- **Specification:** Sections 14.1, 23.2 compare-and-swap requirements, 34.3–34.5; AC-21/32 prerequisites.
- **Repos:** server.
- **Prerequisites:** Unit 01.
- **Outcome:** revision/history-boundary fields on Form Lead, Call Lead, Booking, and Cancellation; report/apply/verify migrations; index collision reporting; no fabricated historical changes.
- **Proof:** model/migration tests for defaults, monotonic nonnegative revisions, deterministic idempotent backfill, history boundary semantics, and failure on one-Booking-per-normalized-Job collisions.
- **Boundary:** do not yet route every write through the new executor; legacy compatibility must remain readable.

### Unit 10 — Transaction-owning canonical command executor and idempotent replay

- **Original slice:** core of S07.
- **Specification:** Sections 23.1–23.2 and 24 common command envelope; AC-21/32.
- **Repos:** server.
- **Prerequisites:** Unit 09.
- **Outcome:** refactor `executeIdempotentCanonicalCommand` to own one Mongo transaction, pass session/clock to operations, validate Granot/RingCentral provenance contexts, preallocate causal IDs, persist replayable result, and enforce command/payload checksum conflicts.
- **Proof:** Mongo replica-set transaction tests for exact replay, checksum/name conflict, rollback on any effect failure, no partially visible Decision, and one winner under expected-revision races.
- **Boundary:** external calls occur only after commit; nested service transactions must be exposed as transaction-bound internals.

### Unit 11 — Entity Change, outbox atomicity, and canonicalization of existing write adapters

- **Original slice:** remainder of S07.
- **Specification:** Sections 23.2–23.4, 35.1; AC-21/32.
- **Repos:** server.
- **Prerequisites:** Units 09–10.
- **Outcome:** Entity Change model/privacy policy/indexes; revision transition linkage; Sheet Sync outbox atomicity; canonical adapters for existing Lead/Booking/Cancellation/referral write paths; removal of direct route/model mutations within affected paths.
- **Proof:** transaction integration tests show one Command/Change/revision/outbox chain, no Change/outbox for no-op, contact/address values stored only as references/hashes as specified, and no external side effect before commit.
- **Boundary:** lifecycle callers still disabled.

### Unit 12 — Lead provenance schema parity, immutable snapshots, and trusted validators

- **Original slice:** schema/runtime half of S08.
- **Specification:** Sections 14.2–14.4 and 15; field prerequisites for AC-03/07/10/11/12.
- **Repos:** server.
- **Prerequisites:** Units 05 and 09–11.
- **Outcome:** immutable Ingestion Origin, Form Job Number parity, normalized Job fields, Priority/Granot fields, immutable contact/move snapshots, provenance summaries, temporal winner, convergence state, indexes, creation-path snapshot capture, and strict public/admin write exclusions.
- **Proof:** model/service tests for origin derivation, immutable fields, WordPress snapshot transaction, Granot/RingCentral-specific creation permissions, `post_to_granot=false`, Call `quoted` parity, and no public mutation of internal metadata.
- **Boundary:** Lead lifecycle writes and creation remain disabled.

### Unit 13 — Lead provenance and index migration suite

- **Original slice:** migration half of S08.
- **Specification:** Sections 14 and 34.3/34.5; AC-10/11/12 prerequisites.
- **Repos:** server.
- **Prerequisites:** Unit 12.
- **Outcome:** deterministic/unknown ingestion-origin report, normalized Job backfill, honest `legacy_baseline` snapshots, duplicate/bad/collision inventory, indexes, and verify commands.
- **Proof:** idempotent migration tests; dry-run changes no documents; apply on disposable fixtures changes only approved metadata; unknown evidence is never mislabeled original; output is PII-safe.
- **Boundary:** no business values may be rewritten by provenance migration.

### Unit 14 — Source policy resolution and source-scoped identity ladders

- **Original slice:** identity half of S09.
- **Specification:** Sections 8.4, 12–13, 15.4, 16 identity portions; AC-04/07/09/13/29.
- **Repos:** server.
- **Prerequisites:** Units 04–07 and 12–13.
- **Outcome:** resolve Registry policy before identity; Form and Call ladders; exact-identity source checks; Record Link lookup; Bad/Duplicate eligibility; source-scoped current+immutable contact matching; Agent assertion/match; deterministic Booking identity context.
- **Proof:** pure/module tests for every ladder rung, ambiguity, conflicts, bad/duplicate rules, ObjectId compatibility, no global contact match, exact Source Scope enforcement, `user`/`rep` conflict, and Booking-missing-Lead delegation to existing reconciliation.
- **Boundary:** returns candidates/explanations only; no desired-state mutation.

### Unit 15 — Temporal ordering, desired-state planning, and shadow processor orchestration

- **Original slice:** planning/processor half of S09.
- **Specification:** Sections 11 and 15–16, deep interface Section 25, activation Section 27; AC-05–13, AC-30–32 in shadow.
- **Repos:** server.
- **Prerequisites:** Units 07–08 and 14.
- **Outcome:** origin-specific field authority, Priority behavior, temporal winner/tie-breaker, desired-state/no-op comparison, matched/no-match outcomes, pending scheduling decision, gate snapshot, and channel-neutral processor orchestration in historical/live shadow.
- **Proof:** production-module tests for stale races, compare-and-swap loss/re-evaluation, already-current temporal advancement without revision/Change/outbox, malformed Priority independent-action behavior, minimum-data outcome, and zero forbidden shadow effects.
- **Boundary:** all effect flags remain false.

### Unit 16 — Browser extension receipt apply and version 0.2.8

- **Original slice:** S10.
- **Specification:** Sections 9 operation identity, 28.1, 30; extension AC-02/33/34.
- **Repos:** server and extension `main`.
- **Prerequisites:** Units 02–04 and 14–15.
- **Outcome:** full-statement apply adapters, stable UUID operation records, pending storage bounds, initiator preservation, server capture/process compatibility mapping, removal of authoritative patch semantics from final apply, and package/generated manifest version `0.2.8`.
- **Proof:** server contract tests plus extension Vitest/compile/build for retry/auth ID retention, deliberate-new ID, batch item IDs, raw Priority/user/rep, no client quoted/patch derivation, pending result refresh, storage limits, and manifest/package version.
- **Boundary:** preview remains read-only; shadow parity only.

### Unit 17 — HTTP automation receipt convergence and resumable lifecycle outcomes

- **Original slice:** S11.
- **Specification:** Sections 28.1 and 31; automation portions of AC-02/33.
- **Repos:** server and existing admin automation display only as required.
- **Prerequisites:** Units 02–04 and 14–15.
- **Outcome:** `${run_id}:${action_id}` receipt identity, statement construction from locked plan, Owner initiator, processor invocation, lifecycle refs/outcome on run action receipt, accepted-for-processing lease yielding, exact replay/conflict behavior, and preserved preview/approval/checksum protections.
- **Proof:** module/run-workflow/route tests for one lifecycle receipt per action, continuation using same operation ID, non-terminal checkpoint behavior, terminal replay, hash mismatch, immutable plan preservation, and equivalent shadow desired state to webhook evidence.
- **Boundary:** no legacy apply path may bypass receipt processing.

### Unit 18 — Safe matched-Lead synchronization effects

- **Original slice:** S12.
- **Specification:** Sections 11, 13, 15–16.1, 23.4, 27.2; live behavior AC-05/07/10–13/32/33.
- **Repos:** server.
- **Prerequisites:** Units 10–17 and accepted cross-channel shadow parity report.
- **Outcome:** canonical `synchronizeLeadFromGranot`, atomic Record Link establish/confirm, authorized state mutation, Entity Change and Sheet Sync intent, temporal-winner transaction ownership, and desired-state idempotency.
- **Proof:** replica-set module tests for applied/linked/already-current/stale/conflict, one atomic causal chain, no-op suppression, Record Link races, immutable WordPress evidence, source immutability, one-way Quoted, and safe Agent assignment.
- **Rollout boundary:** enable only for one reviewed source after synthetic/staging proof; creation and cases remain false.

### Unit 19 — Authorized Granot Lead creation and atomic link reservation

- **Original slice:** S13.
- **Specification:** Sections 16.2–16.3, 17 creation seam, 23.4, 27.2; AC-07–09 and no-second-Lead race.
- **Repos:** server.
- **Prerequisites:** Unit 18.
- **Outcome:** canonical Form/Call `createLeadFromGranot`, full ladder-before-create, deterministic route/minimum data, active-link reservation, source-specific creation policy, safe sparse Call creation, `post_to_granot=false`, and immediate rather than retrying creation where authorized.
- **Proof:** transaction/module tests for one created Lead under concurrency, incomplete-data terminal outcome, missing/invalid route, Job-only Call rule, Form state/ZIP routing, exact existing match, duplicate key re-read, and no fabricated telephony evidence.
- **Rollout boundary:** audited Registry change to `create_if_missing` one source at a time; migration never enables it.

### Unit 20 — RingCentral adoption/convergence and duplicate correctness

- **Original slice:** convergence half of S14.
- **Specification:** Section 17 and RingCentral guidance; AC-14–16.
- **Repos:** server.
- **Prerequisites:** Units 12 and 19.
- **Outcome:** shared convergence service, adoption-before-duplicate ordering, exact adoption criteria, atomic verified metadata + processed ledger, preserved Granot origin, durable pending/adopted/conflict states, and no false duplicate from the adopted physical call.
- **Proof:** RingCentral integration tests for one/zero/multiple candidates, ±12-hour boundary, Job-only exclusion, prior distinct qualifying Lead duplicate, complete ledger atomicity, and continued normal ingest on conflict.
- **Boundary:** do not change cron cadence in this unit.

### Unit 21 — RingCentral Call Log lease, telemetry, overlap safety, and 30-minute cadence

- **Original slice:** lease/schedule half of S14.
- **Specification:** Section 17 lease contract, Section 33 metrics, Section 39 rollout order; AC-17.
- **Repos:** server.
- **Prerequisites:** Unit 20 with adoption/duplicate tests green.
- **Outcome:** renewable five-minute state lease, one winner, full-success-only cursor advancement, adoption/conflict/throttle/runtime telemetry, retained 12-hour lookback, updated config/rules/runbook, and finally `*/30 * * * *` schedule.
- **Proof:** fake-clock/integration tests for overlap, expiry/recovery, renewal, failed-run cursor, rolling lookback, and one lease winner; `vercel.json` changes only after these pass.
- **Rollback:** restore two-hour schedule and disable adoption flag; never detach verified metadata.

### Unit 22 — Booking Reconciliation persistence, sequencing, and read-only reconciliation service

- **Original slice:** server-domain half of S15.
- **Specification:** Sections 18–19 and 21; read behavior AC-18–20/36/39/40.
- **Repos:** server.
- **Prerequisites:** Units 07, 14–15, and 18.
- **Outcome:** Booking case model/indexes, create-missing/review-existing modes, Priority-5 vs actual-Booked distinction, open-or-refresh, evidence/case revisions, sequence allocation, safe suggestions/candidates, existing Booking/Cancellation routing, and no command execution.
- **Proof:** transaction/module tests for concurrent open uniqueness, bounded sequence retry, evidence dedupe/refresh, resolved immutability, next sequence, both action kinds coexisting, Priority-5 existing Booking no-case, actual Booked review case, and Booking-without-Lead delegation.
- **Boundary:** no Booking is created or updated.

### Unit 23 — Booking lifecycle reads, Admin queue/detail, candidate browser, and Job/Lead timeline

- **Original slice:** API/admin half of S15.
- **Specification:** Sections 28.2 and 29; AC-18–20/35/36/39/40.
- **Repos:** server and admin.
- **Prerequisites:** Unit 22.
- **Outcome:** masked cursor-based case list/detail, Job Number and Lead timeline projections, lifecycle navigation, URL-backed filters, evidence/current-state separation, contact labeling, candidate browsing, existing Booking read-only display, and query keys/invalidation foundation.
- **Proof:** route tests for auth/filter/cursor/masking/no raw payload; admin component tests for default queue, filters, Referral-safe no-Lead rendering foundation, evidence refresh preserving in-progress form state, accessibility, and timeline non-collapse.
- **Boundary:** deploy/read-enable before Booking commands.

### Unit 24 — Confirm missing standard Booking owner workflow

- **Original slice:** confirm-booking portion of S16.
- **Specification:** Sections 23–24.2 excluding update path, Sections 28.3/29; AC-20–23/32.
- **Repos:** server and admin.
- **Prerequisites:** Units 10–11 and 22–23; Owner review of read-only cases.
- **Outcome:** strict owner command envelope/idempotency, eligible explicit Lead selection, active catalog validation, exact decimal/cents validation, full official blank-by-default form, out-of-scope warning/reason, atomic Booking/create/link/case resolution/Change/outbox effects, and 409 form preservation.
- **Proof:** replica-set race/replay tests, Binder sum in cents, active Agent/Merchant validation, no Granot display-field defaulting, one Booking per Job, selected-Lead/current-link revalidation, out-of-scope correction evidence, and admin accessibility/conflict tests.

### Unit 25 — Existing Booking update and Booking No Action workflows

- **Original slice:** remaining S16.
- **Specification:** Sections 24.2 and 24.5, Sections 28.3/29; AC-20/21/24/32.
- **Repos:** server and admin.
- **Prerequisites:** Unit 24.
- **Outcome:** full official replacement update on deterministic Booking, expected Booking/case revisions, No Action Domain Command without Entity Change/outbox, current-state revalidation, case resolution, admin update/no-action forms, and correct query invalidation.
- **Proof:** concurrency/replay/already-satisfied tests; cannot change Job/Lead/source identity; cannot create second Booking; no-action leaves aggregates/outbox untouched; 409 refresh preserves unsent input.

### Unit 26 — Release Reconciliation persistence, projections, and read-only Admin workflow

- **Original slice:** S17.
- **Specification:** Sections 18, 20–21, 28.2, 29; read portions AC-25–27/35/36/40.
- **Repos:** server and admin.
- **Prerequisites:** Units 22–23 and stable Booking reads/identity.
- **Outcome:** Release case model/open-refresh/sequence, deterministic active Booking projection, already-cancelled behavior, no-Booking/conflict discrepancy routing seam, list/detail/timeline, current Booking display, and zero mutation commands.
- **Proof:** concurrent uniqueness/sequence tests; active/already-cancelled/no-Booking distributions; Booked and Release cases coexist; masked APIs; admin detail with no automatic cancellation/update.

### Unit 27 — Release owner commands: cancellation, Booking update, and No Action

- **Original slice:** S18.
- **Specification:** Sections 23–25, 28.3, 29; AC-21/25/26/32.
- **Repos:** server and admin.
- **Prerequisites:** Units 10–11 and 26; Owner review of read-only release cases.
- **Outcome:** strict cancellation details, verified active deterministic Booking claim, official Cancellation chain/mirrors/outbox, existing Booking update reuse, No Action, expected revisions, referral-cancellation compatibility, admin forms/review/actions, and current-state conflict behavior.
- **Proof:** transaction tests for one cancellation, concurrent winner, replay, already-satisfied, referral without Lead mirror, exact cents/dates, full causal refs, Sheet chain, no automatic reversal; component tests for explicit review and preserved form input.

### Unit 28 — Referral Booking case and leadless canonical owner workflow

- **Original slice:** S19.
- **Specification:** Sections 8 Referral policy, 19 mode, 24.3, 29; AC-28.
- **Repos:** server and admin.
- **Prerequisites:** Units 24–25 and reviewed Referral Registry classification.
- **Outcome:** Referral Booked action case mode, no Lead search/selector, contact/Job from accepted Observation, leadless canonical referral Booking, active Record Link booking ref without lead ref, and only the correct Master Booked projection.
- **Proof:** module/route/component tests for disabled flag, no Lead requirement, one Booking, no source guessing, correct projection/outbox, referral detail/timeline, and explicit Owner action.

### Unit 29 — Booking/Release discrepancies, re-evaluation, and Record Link correction

- **Original slice:** S20.
- **Specification:** Sections 13 correction, 22, 24.5, 28–29; AC-23/26/27/35/36.
- **Repos:** server and admin.
- **Prerequisites:** Units 24–27.
- **Outcome:** separate discrepancy models, stable non-PII fingerprints, open/refresh uniqueness, read projections, re-evaluate, no-action, Owner correction with expected link revision, old-link supersession/history, and discrepancy UI/timeline.
- **Proof:** transaction/module tests for exact reason routing, concurrent refresh, correction race, selected eligible Lead, unchanged Lead Source Scope, re-evaluation opening normal reconciliation where appropriate, and no direct Booking/Cancellation mutation.

### Unit 30 — Operational events, metrics, health projection, and rollout alerts

- **Original slice:** operational half of S21.
- **Specification:** Sections 28.2 health and 33; AC-31/35/37/38 operational portions.
- **Repos:** server and admin health view.
- **Prerequisites:** applicable Units 01–29.
- **Outcome:** all required PII-safe Operational Events and metrics, flags/activation/queue/case/discrepancy/RingCentral health projection, initial alert thresholds, and Owner-safe health UI.
- **Proof:** tests for event emission on success/failure/replay/conflict, metric labels without unbounded/PII values, accurate due/expired/dead-letter counts, flag/activation display, and raw-data masking.

### Unit 31 — Migration/index verification, historical shadow certification, security audit, and runbooks

- **Original slice:** certification half of S21.
- **Specification:** Sections 27, 33–35, 37.2, 39–40; AC-31/35/37/38 plus zero-forbidden-effects assertion.
- **Repos:** server; admin only for documentation/health corrections.
- **Prerequisites:** Units 01–30 applicable code complete.
- **Outcome:** finish fixed migration package commands, index verifier, resumable historical shadow processor, PII-safe certification report, raw-data masking/log audit, migration invariant verification, staged flags/threshold documentation, rollback artifacts, and required service/rule/runbook updates.
- **Proof:** disposable/local report→apply→verify cycles; historical shadow against redacted fixtures; zero Leads/Bookings/Cancellations/cases/discrepancies/notifications/Sheet jobs; all manifests PII-safe; full mandatory repository checks.
- **Boundary:** this is synthetic/redacted and historical certification, not the current-payload final test.

### Unit 32 — Optional new-case email notifications

- **Original slice:** S22.
- **Specification:** Section 32 and S22.
- **Repos:** server.
- **Prerequisites:** all case workflows accepted by Owner; explicit approval to include email in the release.
- **Outcome:** typed Notification Delivery purpose/case reference, new-sequence-only dedupe, templates, provider-safe failure behavior, and delivery metrics.
- **Proof:** one email per newly opened sequence; none on evidence refresh; provider failure cannot alter/block a case; sandbox/test recipient only until separately approved.
- **Rollback:** email flag off leaves dashboard/cases unaffected.
- **Optionality:** omitting this unit produces a 33-unit program.

### Unit 33 — Prototype retirement, compatibility cleanup, and complete synthetic regression

- **Original slice:** S23.
- **Specification:** Sections 37.2, 38/S23, 39, and 41.
- **Repos:** server, admin, extension as applicable.
- **Prerequisites:** Units 01–31; Unit 32 only if included; all relevant ACs represented at production module/route/UI/extension interfaces; rollout stable enough for approved compatibility removal.
- **Outcome:** remove disposable prototype and deprecated Intake/generic names, retire old patch/apply bypasses and automation semantic ownership, remove legacy receipt fields only after compatibility window, update docs, and run full synthetic/redacted regression across all repositories.
- **Proof:** repository searches find no active legacy Intake/generic lifecycle-engine assumptions or bypass routes; all AC-01–AC-40 automated tests expected at this stage are green; server test/typecheck, admin test/lint/typecheck/build, extension test/compile/build; old extension versions confirmed absent before endpoint cleanup.
- **Rollback:** delay cleanup if compatibility evidence is insufficient; never delete durable lifecycle evidence.
- **Boundary:** Unit 34 has not yet used current webhook payloads.

### Unit 34 — Final current-Granot-webhook-payload application-logic certification

- **Original slice:** new final standalone verification unit requested by the Owner. It certifies Sections 9–18, 26–28, 33–36, 39, and 41 through the completed production interfaces; it must not introduce new domain behavior.
- **Repos:** primarily server, with admin/extension observation only if an asserted cross-channel result requires it.
- **Prerequisites:** Units 01–31 and 33 complete; Unit 32 complete only if included; ordinary full regression green; no unresolved migration/index/security failures.
- **Outcome:** replay **current Granot webhook payload shapes** through the completed authenticated webhook/capture/processor/application-logic path in an isolated local/staging test environment, produce a PII-safe certification report, and make the final go/no-go decision.
- **Why separate:** real payloads introduce privacy, schema-drift, and environment risks. They must validate the completed design, not become undeclared fixtures that shape implementation piecemeal.
- **Detailed protocol:** see Section 8 of this handoff. Raw current payloads must never be committed or included in hook/subagent/model output. Use sanitized structural derivatives for durable regression fixtures.
- **Failure rule:** any mismatch creates a follow-up defect against the owning earlier unit/contract. Do not weaken normalization, identity, source policy, authority, or invariants merely to accept an unexpected payload.
- **Completion evidence:** signed/dated PII-safe matrix of payload family → Receipt → Observation → Decision → permitted effect/no-effect, all expected assertions, no leaked credentials/contact, no external effects, and full regression still green after any approved fixes.

## 4. Dependency and milestone map

Use the original rollout order in specification Section 39. The following compact map helps issue authors retain prerequisites:

```text
01
├─ 02 ─ 03 ─ 04 ───────────────┐
├─ 05 ─ 06 ────────────────────┤
└─ 09 ─ 10 ─ 11 ─ 12 ─ 13 ───┤
          04+06 ─ 07 ─ 08      │
04+06+07+12+13 ─ 14 ─ 15 ─────┤
15 ─ 16 (extension)            │
15 ─ 17 (automation)           │
10–17 + parity approval ─ 18 ─ 19 ─ 20 ─ 21
07+14+15+18 ─ 22 ─ 23 ─ 24 ─ 25
22+23 ─ 26 ─ 27
24+25 ─ 28
24–27 ─ 29
01–29 ─ 30 ─ 31
accepted case flows ─ 32 (optional)
01–31 (+32 if used) ─ 33 ─ 34 FINAL
```

Parallel implementation is permitted only where dependencies genuinely permit it, for example Units 05–06 versus 09–11, or Units 16 and 17 after Unit 15. Parallel work must still land on the fixed repository branches and must not create overlapping edits without an explicit integration owner.

## 5. Issue handoff rules

Each issue must leave the next issue a verifiable repository state. “Code written” is not a handoff condition.

### 5.1 Required issue body fields

Every generated issue should contain:

1. **Title and unit number.** Preserve the numbering above so dependencies are searchable.
2. **Authoritative references.** Link the final specification and name exact section numbers, original S slice, and AC IDs.
3. **Objective.** One observable end state, written in domain language.
4. **Repositories and branch.** Name every affected repo; restate the fixed branch rule.
5. **Prerequisites.** Name required earlier units and the evidence expected from them.
6. **In scope / explicitly out of scope.** Prevent the agent from prematurely enabling a later effect.
7. **Invariants at risk.** Quote only the relevant invariant numbers from specification Section 4.
8. **Deliverables.** Models/services/routes/UI/migration/tests/docs, expressed as coherent behavior rather than a file checklist.
9. **Flags and starting/ending posture.** State exact flags that must remain false or may be enabled.
10. **Migration/dry run.** Use `none` or the exact report → reviewed apply → verify contract from Section 34. Production apply is never implied.
11. **Acceptance criteria.** Retain every applicable AC ID and add unit-specific assertions without weakening the original.
12. **Testing commands and required levels.** Follow Section 7 below and specification Section 35.
13. **Live/staging verification.** Redacted synthetic evidence first; production read-only unless separately approved.
14. **Rollback.** Disable the narrowest caller/flag first and preserve durable evidence/committed official facts.
15. **Handoff artifact.** Require the completion report described below.

### 5.2 Start-of-issue protocol

The primary agent must:

1. Read the cited final-specification sections in full, plus Section 4 invariants and the applicable Section 38 slice.
2. Read `AGENTS.md`, `CLOUD_AGENTS.md`, and applicable `.cursor/rules/*.mdc` before edits.
3. Inspect `git status --short`, current branch, and recent relevant changes in every affected repo.
4. Confirm environment posture before any runtime write: `TEST_MODE`, selected Mongo database, replica-set availability, Sheet Sync mode, lifecycle flags, RingCentral collection/write mode, and any external credentials/targets.
5. Identify the existing production boundary to extend; do not implement business logic in routes, scripts, broad barrels, Admin, or extension clients.
6. Map each listed AC to a concrete test location before implementation.
7. If the issue spans repositories, designate one API contract as authoritative and land/test server compatibility before depending UI/client work on it.

### 5.3 During-issue rules

- Keep routes thin: authentication → strict Zod → service/module → safe response.
- Runtime logic belongs under the focused domain service; migration scripts call runtime services rather than reimplementing policy.
- Do not invent missing source IDs, source mappings, payload meanings, occurrence times, or business authority.
- Do not broaden an effect gate to make a test pass.
- Do not write raw payload/contact/address values into Decisions, cases, discrepancies, Entity Changes, logs, hook prompts, or reports beyond the exact protected evidence locations permitted by the specification.
- Every effect-bearing test must assert causal references and transaction atomicity, not only final aggregate values.
- Every no-op/shadow test must assert absence of forbidden `EntityChange`, Sheet Sync, case, discrepancy, notification, or aggregate mutation as applicable.
- Keep compatibility adapters one-way toward the common processor; never allow the old extension/automation patch path to bypass receipts.
- Treat duplicate-key, lease, and compare-and-swap behavior as first-class acceptance paths, not incidental error handling.
- Update applicable behavior docs/rules in the same unit that changes the behavior; do not defer all documentation to Unit 33.

### 5.4 Completion/handoff report required from every issue

The implementing agent must leave a concise report containing:

- repositories and branch names actually used;
- files added/changed, grouped by behavior;
- authoritative spec sections and AC IDs implemented;
- migrations/indexes added, with report/apply/verify status and database mode used;
- flags before/after and confirmation that later effects remain disabled;
- focused and full commands run, with pass/fail counts;
- manual/staging verification performed and identifiers used, all masked;
- concurrency/idempotency/no-op/security assertions proven;
- known risks, deferred work, compatibility left in place, and the exact next unit unblocked;
- `git status --short` at handoff;
- explicit statement that no commit/push/deploy/production mutation occurred unless separately authorized.

The next agent must verify this evidence against the repository; it must not trust the prose report alone.

### 5.5 Handoff rejection conditions

Do not mark a unit complete if any of the following is true:

- required focused tests or repository checks are failing;
- an AC is claimed without a test at the prescribed interface level;
- a migration exists without dry-run/report and verify coverage;
- a mutation lacks Decision/Command/Change/revision/outbox causal proof;
- no-op behavior produces Change or Sheet work;
- raw payload/credentials/PII appear outside approved evidence storage;
- a later effect was enabled prematurely;
- old extension/automation paths can still bypass receipt processing after their cutover unit;
- a concurrency test is mocked at a level that cannot prove Mongo uniqueness/transaction behavior;
- docs/rules contradict runtime behavior;
- the working tree contains unexplained overlapping changes.

## 6. Subagent and optional `.cursor/hooks` recommendations

The cap assumes frontier-level primary agents can use subagents for bounded parallel research/review. Subagents increase review depth; they do not change ownership, prerequisites, or completion evidence.

### 6.1 Primary-agent ownership

The primary agent owns:

- reading and interpreting the authoritative specification;
- choosing the integration design inside the specified architecture;
- assigning non-overlapping subagent tasks;
- all final edits that cross module or transaction boundaries;
- reconciling conflicting reviews;
- running/inspecting authoritative tests;
- the final completion audit and handoff report.

Do not delegate interpretation of the specification or skill/rule instructions. Subagents may inspect existing code, propose focused tests, review a bounded diff, or implement a clearly isolated repo surface after the primary establishes the contract.

### 6.2 Good subagent assignments

- inspect existing service/model/test patterns and report extension points;
- independently map listed ACs to missing tests;
- review one bounded concern: transaction atomicity, PII/security, migrations/indexes, RingCentral duplicates, accessibility, or API compatibility;
- implement an isolated Admin component or extension storage adapter after the server contract is fixed;
- run a focused regression suite and investigate failures without changing unrelated code;
- perform post-implementation adversarial review against exact spec sections.

### 6.3 Bad subagent assignments

- “implement the entire issue” with no file/contract boundary;
- two agents editing the same transaction coordinator, model, migration, or route concurrently;
- asking a subagent to summarize the spec instead of the primary reading it;
- delegating live database access, production flag changes, deployment, or current raw webhook payload inspection without explicit authorization and privacy controls;
- accepting a subagent’s test summary without inspecting command output/coverage.

### 6.4 Required subagent return format

Each subagent should report:

1. bounded task and files inspected/changed;
2. findings tied to specification sections/ACs;
3. tests run and exact outcome;
4. risks or contradictions;
5. whether changes overlap another agent;
6. no claims of whole-unit completion.

### 6.5 Optional hook suite

Hooks should be advisory, deterministic where possible, local by default, and incapable of production mutation. Suggested checks:

1. **Spec-reference check:** changed lifecycle tests must include applicable `AC-xx` identifiers; issue/PR summary includes cited sections.
2. **Secret/PII scanner:** reject fixtures/log snapshots/reports containing secret header names/values, authorization/cookies, realistic emails/phones/addresses, or raw payload dumps.
3. **Direct-mutation scanner:** flag lifecycle code importing Lead/Booking/Cancellation models outside approved canonical-command/internal transaction modules.
4. **Route-thinness review:** flag normalization, matching, patch construction, or source routing in HTTP routes.
5. **Transaction review model:** inspect effect-bearing diffs for Decision/effect atomicity, expected revisions, idempotency key/checksum, outbox timing, and nested transactions.
6. **Schema/migration pairing:** flag new persisted fields/indexes without a corresponding migration/report/verify decision.
7. **Projection privacy review:** inspect lifecycle API/Admin fields for raw payload/header/contact leaks and list masking.
8. **Cross-channel contract check:** compare webhook, extension, and automation fixtures for equivalent normalized Observation/desired-state results.
9. **Concurrency regression selector:** when case/link/revision/lease code changes, automatically run the relevant replica-set race tests.
10. **Repo check selector:** run focused tests during iteration and mandatory test/typecheck/lint/build at the pre-handoff checkpoint.

If hooks invoke review models, prompts must contain diffs and synthetic/redacted fixtures only. Never send `.env`, credentials, database exports, raw current webhook payloads, raw receipts, customer contact, or addresses. Model findings remain advisory until the primary agent verifies them. Hooks must never auto-fix source policy, authority rules, migrations, or transaction code without primary review.

## 7. Testing strategy by unit

Specification Section 35 is authoritative. The following makes its application explicit for issue authors.

### 7.1 Test pyramid and ownership

| Test level                                | Required for                                                                | What it must prove                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pure unit                                 | normalization, routing, Priority, desired state, fingerprints, retry clocks | exact deterministic vocabulary and edge cases without DB                                                     |
| Model                                     | every schema/index/immutable field unit                                     | validators, partial/unique index definitions, evidence immutability                                          |
| Mongo replica-set transaction integration | Units 08–11, 18–29                                                          | real transactions, unique-index races, leases, idempotency, revision/case/link concurrency, outbox atomicity |
| Production Module                         | processor/reconciliation units                                              | behavior through `GranotObservationProcessor` and reconciliation interfaces, not prototype shortcuts         |
| Route                                     | capture/admin/apply/owner units                                             | auth, strict Zod, safe envelopes, error mapping, masking, idempotency headers                                |
| Cross-channel contract                    | Units 16–18 and final regression                                            | same normalized statement/desired state for webhook, extension, automation                                   |
| RingCentral integration                   | Units 20–21                                                                 | adoption, duplicate order, ledger atomicity, lease/cursor/lookback                                           |
| Admin component                           | Units 06, 23–30                                                             | filters, blank official values, revision conflicts, form preservation, no-Lead Referral, accessibility       |
| Extension Vitest                          | Unit 16                                                                     | stable IDs, storage bounds, raw statement fidelity, result mapping/version                                   |
| Vercel smoke                              | webhook/queue/cron changes                                                  | deployed-style routing/consumer registration differs correctly from direct Express                           |

### 7.2 Per-issue test sequence

1. Add or identify failing focused tests for every assigned AC before relying on implementation.
2. Run focused pure/model tests during iteration.
3. Run replica-set integration tests for transactional/concurrency behavior; mocks are insufficient for unique indexes and transactions.
4. Run Module tests through production interfaces.
5. Run route/component/extension tests for affected external contracts.
6. Run applicable full repository checks before handoff.
7. Run secret/PII and legacy-bypass searches.
8. Record exact commands and results in the handoff report.

### 7.3 Mandatory repository checks

From the relevant repository root:

```text
# vantage-main-server
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build

# granot_sync_extensions_and_services
pnpm test
pnpm compile
pnpm build
```

Use focused subsets before these full commands. Use `vercel dev` smoke tests when webhook, cron, queue, or Vercel routing differs from direct Express. Keep `TEST_MODE=true`, use a local/disposable replica-set database, and keep `SHEET_SYNC_MODE=disabled` unless an explicitly isolated Sheet Sync adapter test is required.

### 7.4 Required assertion families

Every issue should select all applicable families:

- **Security:** no credential persisted/hashed/logged; unauthorized creates no receipt; projections exclude raw evidence.
- **Identity:** exact methods and source checks; no global contact match; conflicts never reassign source.
- **Ordering:** stable captured-time/ObjectId winner; losing compare-and-swap re-evaluates; stale cannot mutate.
- **Idempotency:** receipt/operation/command identities behave differently as specified; checksum mismatch conflicts.
- **No-op:** no revision, Entity Change, or Sheet work for reportable no-op; allowed temporal metadata advancement only.
- **Atomicity:** Decision and every listed effect commit together; failure leaves no partial business Decision/effect.
- **Concurrency:** one winner for link/Booking/case/discrepancy/lease; bounded retry where specified.
- **Authority:** Granot display evidence never fills official Booking/Cancellation inputs or mutates official facts automatically.
- **Shadow/gates:** historical/live shadow has zero forbidden effects; every applicable gate is persisted in the Decision.
- **Privacy:** only protected receipt/Observation evidence stores raw allowed values; lists are masked; reports/logs are PII-safe.
- **Rollback:** disabling the narrow flag/caller stops future effects without deleting evidence or reversing official facts.

### 7.5 Migration testing

Every persistent-data/index issue must implement the Section 34 posture:

1. dry-run/report is default;
2. reject unknown/historical database targets;
3. explicit `--apply --confirm-production=<database-name>` for mutation;
4. deterministic gitignored PII-safe manifest;
5. idempotent rerun;
6. read-only verify exits nonzero on mismatch;
7. unique indexes only after zero-collision report;
8. no production apply as part of ordinary issue assignment.

For local evidence, use disposable fixture databases and record only the database mode/name category, counts, and masked IDs—never customer values.

### 7.6 Acceptance coverage ledger

Maintain a simple checked-in or issue-linked ledger mapping AC-01–AC-40 to:

- owning unit(s);
- test file/test name;
- test level required by Section 35;
- current result;
- any staged/live verification still pending.

An AC may be introduced in a foundation unit and completed later at a live effect/UI boundary. Do not mark it fully complete at the foundation stage. Unit 33 must show every AC covered at its prescribed production interface before Unit 34 begins.

### 7.7 Recommended AC ownership map

This map prevents acceptance scenarios from disappearing between subdivided original slices. The last listed unit is generally the point at which the scenario can be proven through its complete production interface; earlier units own foundations or partial proofs. Unit 34 samples the completed behavior with current payload shapes but does not replace any listed automated test.

| AC    | Owning unit(s)                 | Primary proof                                                           |
| ----- | ------------------------------ | ----------------------------------------------------------------------- |
| AC-01 | 03                             | Webhook auth/capture route tests and credential-absence scan            |
| AC-02 | 02, 03, 16, 17                 | Receipt/operation identity model, route, and cross-channel replay tests |
| AC-03 | 01, 14                         | Outbound `leadno` contract plus exact Form identity Module test         |
| AC-04 | 05, 14                         | Runtime source-policy and exact-identity conflict tests                 |
| AC-05 | 04, 15, 18                     | Normalization, desired-state, and live matched-write tests              |
| AC-06 | 04, 15                         | Normalization plus independent-action processor tests                   |
| AC-07 | 14, 15, 18, 19                 | Identity, planner, matched-write, and no-second-Lead tests              |
| AC-08 | 19                             | Authorized creation transaction/race tests                              |
| AC-09 | 06, 14, 19                     | Registry migration/routing and creation tests                           |
| AC-10 | 12, 15, 18                     | Snapshot/model, planner, mutation, and projection tests                 |
| AC-11 | 12, 15, 18                     | Immutable move snapshot and authorized current-move tests               |
| AC-12 | 12, 15, 18                     | Call/Granot-created contact authority and Entity Change tests           |
| AC-13 | 14, 15, 18                     | Agent identity/matching and safe assignment tests                       |
| AC-14 | 20                             | RingCentral adoption integration tests                                  |
| AC-15 | 20                             | Adoption-before-duplicate integration tests                             |
| AC-16 | 20                             | Zero/multiple/Job-only convergence integration tests                    |
| AC-17 | 21                             | Real lease/cursor/lookback concurrency tests                            |
| AC-18 | 22, 23                         | Booking service plus read projection/UI tests                           |
| AC-19 | 22, 23                         | Actual Booked mode tests through service and UI                         |
| AC-20 | 22, 23, 24, 25                 | Sequence/evidence revision and owner-form concurrency tests             |
| AC-21 | 10, 24, 25, 27                 | Canonical executor and owner-command race/replay tests                  |
| AC-22 | 24                             | Strict official Booking input and create-command tests                  |
| AC-23 | 24, 29                         | Out-of-scope selection and Record Link correction tests                 |
| AC-24 | 25                             | Deterministic existing-Booking replacement tests                        |
| AC-25 | 26, 27                         | Release read and explicit owner-command tests                           |
| AC-26 | 26, 27, 29                     | Already-cancelled and Booked-after-cancellation tests                   |
| AC-27 | 26, 29                         | Release discrepancy routing/open-refresh tests                          |
| AC-28 | 28                             | Leadless Referral service, command, projection, and UI tests            |
| AC-29 | 04, 05, 06, 14                 | Normalization, Registry, migration, and runtime-policy tests            |
| AC-30 | 08, 15                         | Exact business retry clock and terminal planner tests                   |
| AC-31 | 07, 15, 31                     | Activation/execution-mode and historical-shadow certification           |
| AC-32 | 10, 11, 18, 24, 25, 27         | Canonical causal-chain/no-op tests at each mutation boundary            |
| AC-33 | 16, 17, 18                     | Extension/automation contract parity and live matched behavior          |
| AC-34 | 16                             | Extension storage/retry/version tests                                   |
| AC-35 | 02, 03, 07, 23, 26, 29, 30, 31 | Persistence, route, projection, UI, and audit privacy tests             |
| AC-36 | 22, 26, 29                     | Case/discrepancy real-index concurrency tests                           |
| AC-37 | 08, 30, 31                     | Requeue/dead-letter, events/metrics, and certification tests            |
| AC-38 | 05, 06, 30, 31                 | Registry fail-closed, migration, health, and certification tests        |
| AC-39 | 14, 22, 23                     | Booking identity/delegation service and UI tests                        |
| AC-40 | 22, 26                         | Coexisting Booking/Release case transaction/projection tests            |

## 8. Unit 34 protocol: current Granot webhook payload certification

This is application-logic certification using current payload **shapes**, not authorization to mutate production or expose customer data.

### 8.1 Inputs and custody

- Obtain current payloads only from the user-approved secure location at execution time.
- Inventory payload families without copying values into an issue: route class, content type/body encoding, event type, source-label family, presence/shape of identity/contact/move/Priority/user/rep/action fields.
- Strip webhook secrets before hashing, logging, saving, displaying, or passing content to any model/hook/subagent.
- Keep raw payloads in a gitignored, access-limited temporary location outside the repository. Delete or retain them only according to explicit user direction and existing data policy.
- Do not commit raw payloads, database receipts, screenshots, request dumps, or customer-derived fixture files.
- Prefer a local deterministic sanitizer that replaces contact/name/address/job/reference values while preserving field presence, type, Unicode/whitespace characteristics, alias spelling, numeric formatting, and cross-field identity relationships needed by the test.
- Only sanitized structural derivatives may become durable regression fixtures, after the scanner proves they contain no secret or customer PII.
- Do not send raw payload content to automated review models. If model review is useful, provide only sanitized derivatives or schema summaries.

### 8.2 Environment gate

Before replay, record and verify:

- local or explicitly approved staging environment;
- `TEST_MODE=true` or equivalent isolated database posture;
- MongoDB is a replica set;
- exact database is disposable/non-production;
- `SHEET_SYNC_MODE=disabled` or a fully isolated fake adapter;
- no live CRM, RingCentral, email, queue, or notification target can receive effects;
- lifecycle flags are explicitly captured;
- Registry, Source Company, Source Granularity, Agent, Merchant, and existing Lead/Booking fixtures are synthetic but sufficient for intended paths;
- webhook secret is a test secret, not production credential;
- queue/cron execution is bounded and observable.

If any boundary is uncertain, stop before replay. Unit 34 does not authorize production access.

### 8.3 Replay matrix

At minimum, cover every current payload family available plus constructed sanitized variants needed to prove:

1. JSON body-secret, form body-secret, and header-secret authentication where those forms are currently used/supported.
2. `lead_created`, `priority_updated`, and `booking_status_changed` route classes.
3. missing and compatible payload event types; route/event conflict.
4. Priority values currently observed plus canonical edge cases (`0`, `1`, `5`, `05`, non-1/5, malformed/missing).
5. Booked and both supported Release spellings; unsupported near-match such as `Released`.
6. exact Form `ref_no`, ObjectId compatibility where relevant, Call Job Number, source-scoped contact, pending, ambiguous, and hard conflict.
7. Best Relocation Call/Form routing; same/different/invalid states for Form creation routing.
8. deferred Referral/Paid Overflow/Auto classification behavior as applicable; payload `type=AUTO` must not become source identity.
9. matched Lead link/update, already-current replay, stale ordering, and authorized create-if-missing in isolated live-mode fixtures.
10. Priority-5 and Booked Booking-case semantics, Release semantics, already-cancelled behavior, Referral, and discrepancy routing without automatic official mutation.
11. identical webhook deliveries create distinct Receipts/Observations while desired-state replay remains idempotent.
12. malformed/extra fields cannot inject internal metadata, actor, initiator, source scope, official Booking/Cancellation values, or raw headers.

If current production traffic does not naturally contain a required acceptance family, keep the synthetic AC fixture; absence from the current sample is not proof that the contract can be removed.

### 8.4 Assertions per replay

For each case, capture only masked IDs and assert:

- HTTP status and safe envelope;
- one committed credential-redacted Receipt with correct channel/auth/hash/work state;
- one normalized Observation with exact result/issues;
- source policy and identity outcome;
- one appropriate Decision per business attempt with evaluated gates and candidate IDs/reasons only;
- expected target/effect or expected absence of effect;
- for mutations, complete same-transaction causal chain, expected revision increment, Entity Change privacy, and Sheet Sync intent against the isolated adapter;
- for no-op/stale/shadow/invalid/unsupported/deferred/policy-blocked, exact forbidden-effect absence;
- queue/lease/retry state reaches the expected terminal or scheduled condition;
- lifecycle reads/timeline expose normalized masked projections and never raw payload/headers;
- operational event/metric emitted without customer values.

### 8.5 Failure handling

Classify mismatches as:

- **payload-shape drift:** current Granot shape differs from documented normalization inputs;
- **fixture/sanitizer defect:** derivative did not preserve required semantics;
- **implementation defect:** code violates the final contract;
- **environment defect:** isolation, Registry seed, replica set, queue, or adapter is invalid;
- **true domain gap:** payload carries a meaning not decided in the specification.

Implementation defects go back to the owning unit and require focused regression plus full checks. A true domain gap must fail closed and be escalated as a specification/domain decision; do not guess behavior during final testing. Re-run the entire affected payload family after fixes, then all repository checks.

### 8.6 Final certification artifact

Produce a dated, PII-safe report containing:

- source and custody method without secret/path values that expose protected storage;
- payload-family counts and schema fingerprints, not raw bodies;
- sanitizer/scanner result;
- environment/flag/external-side-effect posture;
- replay matrix with masked case IDs;
- expected vs actual Receipt/Observation/Decision/effect outcomes;
- AC coverage touched by each family;
- defects found, owning unit, resolution, and rerun evidence;
- full repository command results;
- zero-secret/PII-leak assertion;
- zero-unapproved-external-effect assertion;
- final go/no-go recommendation.

Unit 34 completes only when this artifact is green and the full regression remains green. It is the final unit, not a substitute for production rollout approval.

## 9. Rollout and production-approval handoff

Specification Section 39 fixes rollout order. Issue completion does not imply permission to execute rollout. Where the issue tracker needs operational tickets, they may be created outside the 34 implementation-unit cap, but must not merge implementation slices or bypass approvals.

At every effect enablement:

1. migrations/index verification green;
2. current flags and Registry policy recorded;
3. read/processing capability deployed before effect flag;
4. one source/effect enabled at a time;
5. causal chain inspected using masked IDs and metrics;
6. observe for at least one normal operating interval;
7. rollback by narrow flag/shadow posture;
8. preserve Receipts, Activation, Observations, Decisions, Commands, Changes, cases, discrepancies, links, and committed official facts.

Stop on every condition listed in Section 39: secret persistence, source reassignment, duplicate Booking, unexplained mutation, missing causal reference, queue-age breach, repeated dead letter, false RingCentral duplicate, or case concurrency violation.

## 10. Suggested skills for implementing agents

Use only when the unit matches the skill trigger and read the skill instructions before acting:

- **`tdd`** — recommended for transaction/concurrency, processor, reconciliation, and bug-fix units where red-green-refactor discipline will reduce regressions.
- **`diagnosing-bugs`** or **`Error Resolver`** — for unexpected failures or performance regressions; diagnose before changing behavior.
- **`codebase-design`** — for the deep `granotLifecycle` module interfaces and transaction/internal-service seams; the final specification remains authoritative.
- **`domain-modeling`** — only if implementation reveals a genuinely new domain term or contradiction; do not casually reopen locked decisions.
- **`e2e-testing`** or **`playwright-generate-test`** — for Admin owner workflows after stable APIs exist, especially review forms, 409 preservation, navigation, and accessibility paths.
- **`handoff`** — for session-to-session continuation reports when an issue cannot finish in one session.
- **`grilling` / `grill-with-docs`** — only before implementing a newly discovered ambiguous design; locked decisions in the final specification are not candidates for re-litigation.

## 11. Issue-authoring checklist

Before publishing the 30–34 issues, verify:

- [ ] The issue count is 34 with Unit 32, or 33 without it.
- [ ] Unit 34 is final and dedicated to current Granot webhook payload certification.
- [ ] Every issue cites final-spec sections, original S slice, and AC IDs.
- [ ] S01–S23 ordering is preserved even where subdivided.
- [ ] Every persistent change has migration/dry-run/verify treatment or explicitly says `none`.
- [ ] Every issue names starting/ending flags and forbids premature effects.
- [ ] Transaction/concurrency claims require replica-set integration tests.
- [ ] Cross-repo units name one authoritative server contract and all repo checks.
- [ ] Read-only Booking/Release units precede owner-command units.
- [ ] Booking precedes Release; Referral follows standard Booking; discrepancies follow both.
- [ ] RingCentral cadence changes only after convergence and lease proof.
- [ ] Optional email remains gated and removable without renumbering dependencies.
- [ ] Prototype cleanup follows production-interface test coverage.
- [ ] No issue authorizes production mutations, deployment, live customer sends, or raw-payload publication.
- [ ] Every issue requires a completion/handoff report and rejects weak evidence.
- [ ] Unit 33 proves synthetic/redacted full regression before Unit 34 touches current payload shapes.
- [ ] Unit 34’s certification report is PII-safe and is the final go/no-go evidence, not rollout authorization.

## 12. Final recommendation

Create the issues at the **34-unit maximum** unless optional email is intentionally excluded, in which case use 33. This preserves the user’s cap while splitting the highest-risk work—receipt security, canonical transactions, provenance migration, identity/desired-state planning, RingCentral convergence/lease, and owner reconciliation—at boundaries a frontier primary agent can own with bounded subagent reviews.

Do not collapse Units 09–11, 14–15, 20–21, or 22–29. Those boundaries isolate the transaction engine from aggregate migrations, identity from effect planning, RingCentral domain convergence from cron activation, and read-only reconciliation from official owner mutations. These are the places where an oversized issue is most likely to produce shallow verification or unsafe coupling.

Keep Unit 34 independent and last. Current Granot webhook payloads should certify the completed application logic under isolation; they should not be used as ad hoc implementation inputs throughout the program.
