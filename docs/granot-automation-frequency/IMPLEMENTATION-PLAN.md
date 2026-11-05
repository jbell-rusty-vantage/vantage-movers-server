# One-session implementation plan

Status: implemented as an uncommitted server patch on November 4, 2026. Local targeted unit/replica proofs and owning docs are complete; broad-suite exceptions are disclosed in [IMPLEMENTATION-LEDGER.md](IMPLEMENTATION-LEDGER.md). Deployment and measured live capacity remain outstanding. Owner accepted the direction November 4, 2026 and requested deeper Outreach/RingCentral cross-references. [SPECIFICATION.md](SPECIFICATION.md) is the behavior contract; [README](README.md) is the packet entry point. This file retains the original work contract; the ledger and [RELEASE-HANDOFF.md](RELEASE-HANDOFF.md) are the implementation evidence.

## Agent brief

Implement faster Granot reconciliation with correct downstream Lead/Desk/Sheet behavior. Complete a reviewable server patch, meaningful unit and disposable Mongo proofs, updated owning documentation and release handoff in one session. Do not stop after editing the hour list. Do not deploy, rerun imports, broaden the completed November 1 backfill or mutate production while executing this engineering plan.

Work only in `vantage-main-server`, remote `jbell-rusty-vantage/vantage-movers-server`. Baseline inspected: `d63e512d`, with `190be6fa` and the completed final import integrated. Read root/server AGENTS and matching rules first; verify the live HEAD, working tree and relevant behavior rather than resetting or copying from an old checkout. Preserve unrelated changes. Read the Service links in specification §2 before implementing.

Accepted schedule: hourly 08:00–20:00 New York inclusive, and overnight 22:00/00:00/02:00/04:00/06:00. Keep RC schedules/coverage controls independent. Preserve Form-first verified pairs, new Call qualification, approved historical admission and existing temporal/period authority. No new environment names, production migration or collection is expected. The optional additive manifest scheduled instant does not require backfilling old documents.

## G0 — Pin the baseline and execution evidence

1. Confirm remote, branch, HEAD, existing work, package scripts and current Service docs. Read environment **inventories**, not credential files, to identify names. Run tests without production `.env` or provider credentials.
2. Confirm the current code still has the three targeted gaps: old 08/13/18 gate and latest-slot-age freshness; related Form not refreshed from sibling marker EntityChange; sibling Sheet nomination recognizing only `master_calls`.
3. Record a short implementation ledger in this pack with baseline SHA, scope, validation commands/results and remaining qualification. The prior inventory is supporting context; do not import restricted per-ID evidence into Git.

Done when: each targeted defect has a concrete synthetic reproducer/test seam; the agent knows the correct integrated baseline and has not changed production.

## G1 — Shared schedule and hourly-safe freshness

Primary modules:

- [estimatesCron.ts](../../src/services/granotHttpCollector/estimatesCron.ts)
- [poolCron.ts](../../src/services/granotHttpCollector/poolCron.ts)
- [cron route](../../src/routes/granot-automation-cron.routes.ts)
- [runWorkflow.ts](../../src/services/granotHttpCollector/runWorkflow.ts)
- [manifest model](../../src/models/GranotEstimatesScheduleSlot.ts)
- [vercel.json](../../vercel.json)

Implement the exact slot contract in specification §3. Keep pure clock/window calculations together behind a small schedule interface. Reuse them in admission, freshness and Pool readers. Keep existing ALL slot keys and deterministic child identity. If adding an optional immutable `scheduled_at`, handle old manifests explicitly without runtime reads that mutate them.

Refactor Pool duty selection so 06:00 can express ALL + correlated refresh + discovery. There must be one refresh manifest per ALL slot and one daily discovery; ordinary and recovery paths must use identical keys. Preserve frozen scopes, dependencies, disabled-Pool behavior and least-recent-attempt fairness. Do not reimplement collection or remove older verified Open Dates.

Replace the resetting 90-minute latest-slot-age test with the grace-elapsed scheduled-slot comparison in specification §8. Keep collection and synchronization separate, including suppressed/held/failed action diagnostics. Preserve existing API fields; add timing fields only where required to prove the schedule. Do not modify Admin unless its existing parser actually rejects additive fields; if it does, report and make only the compatibility change needed within explicit repository instructions.

Tests: ordinary/DST exact slot sets, local midnight/month/year boundaries, duplicate invocation, old-slot compatibility, scope freezing, interruption/recovery, disabled Pool, independent 06:00 duties, persistent hourly failure, missing manifest, partial/failed/held children, newer complete coverage superseding an old missed slot, and collection complete while effects remain pending.

Done when: A1–A2 pass and existing pending runs still resume under their original IDs. `vercel.json` retains the hourly Estimates trigger and all RC schedules.

## G2 — Correct paired Call delivery after tab migration

Primary modules:

- [callLeadFormSibling.ts](../../src/services/granotLifecycle/callLeadFormSibling.ts)
- [reporting decision](../../src/services/leads/callLeadReportingDisposition.ts)
- [reporting targets](../../src/services/googleSheets/leadReportingTargets.ts)
- [No-Sync policy](../../src/services/sheetSync/noSyncLead.ts)

Fix the previous-delivery eligibility helper/projection to recognize saved synced `master_calls`, `master_duplicate_calls` and `master_bad_calls` metadata with row numbers. Reuse admission, canonical reporting disposition and No-Sync policy; do not copy their invariants into the mirror. Add `form_fill` and `external_sheet_review` to `SiblingCallLead` and `SIBLING_CALL_PROJECTION`, preserving the existing ID/company/feed/RC/external-admission fields needed by the shared predicates.

For an actual exported Job/receiver change on an eligible previously delivered sibling, enqueue generic `call_lead.update` in the existing canonical transaction. The shared planner chooses the exclusive destination; destination-before-stale-delete recovery stays intact. Preserve the no-previous-delivery guard, no-change behavior, protected receivers and no fabricated admission. A saved Form Fill Call must never acquire a normal Calls append from this fix. No-Sync ordinary Calls remain hidden while exception rows retain their established delivery policy.

Tests: Duplicate-Calls-only and Bad-Call-Leads-only sync metadata, normal Calls, No-Sync for normal/exception dispositions, no metadata, unadmitted/anchor Call, unchanged pair, manual receiver, and Priority-only mirror. Use actual canonical intent/projection tests, not only a renamed boolean helper test.

Done when: A5 passes, including a disposable full mirror→outbox→synthetic Sheet planner journey. No historic bulk rerouting or new row admission is introduced.

## G3 — Durable related Form refresh after pair marking

Primary modules:

- [Outreach feed](../../src/services/salesOutreach/subjects/feed.ts)
- [Lead-change consumer](../../src/services/salesOutreach/subjects/leadChangeJob.ts)
- [subject sync](../../src/services/salesOutreach/subjects/sync.ts)
- [EntityChange semantics](../../src/services/domainCommands/entityChange.ts)

Extend the existing tail transaction and existing job stage; do not create a new cron/collection/provider chain. On the bounded page, collect Call changes touching `granot_form_sibling` from the canonical mirror command. Batch-load current Call→Form relations under that transaction. Do not expect full marker values in `fields.after`: it is a reference-only change.

Nominate a related-Form job with deterministic identity, for example:

`sod:lead-change:FormLead:<formId>:related:CallLead:<callId>:change:<entityChangeId>`.

A previously completed Form revision job must not suppress this wake. Store `input_refs: [formId, callId]`; the current consumer reads the first ref as the target, so add explicit validation of both refs and re-read the Call marker to confirm it still points to that Form. Do not recover relation authority by parsing a dedupe key. Persist jobs with cursor advancement; overlap/replay dedupes. The related trigger refreshes **only an existing active/review Form subject**. Check that guard before the consumer's otherwise unconditional Pool-refresh path. It must never run intake, expansion, Pool admission or closed-subject reopening.

Reuse current configuration, CAS, period planning and evaluator. Preserve ordinary self-Lead refreshes and the five-minute revision/held-subject recovery backstop. The mirror itself remains the existing best-effort post-commit operation; do not pretend the new tail wake guarantees a mirror that never committed.

Tests: force Form first refresh to observe ambiguous Job ownership; commit sibling marker; run tail/consumer and clear held Form before the 15-minute repair. Cover crash before/after cursor commit, overlap/replay, old Form revision job already completed, absent/closed Form, changed relation, active Form preserving period, batching and no N+1 reads per row.

Done when: A6 passes with real disposable transactions/outbox/cursor rollback proof. The Form domain revision is not manufactured just to trigger this refresh.

## G4 — Shared lifecycle and cross-order Outreach proof

Inspect/reuse rather than fork:

- [webhook route](../../src/routes/granot-webhook.routes.ts), [automation apply](../../src/services/granotLifecycle/automationApply.ts), [processor](../../src/services/granotLifecycle/processor.ts), [desired state](../../src/services/granotLifecycle/leadDesiredState.ts), [synchronize](../../src/services/granotLifecycle/synchronizeLeadFromGranot.ts).
- [accepted Estimates repair](../../src/services/granotHttpCollector/estimatesOutreachRefresh.ts), [period planner](../../src/services/salesOutreach/subjects/periodPlanner.ts), [subject builder](../../src/services/salesOutreach/subjects/subjectBuilder.ts).
- [contact wake](../../src/services/salesOutreach/capture/contactChangeWake.ts), [contact apply](../../src/services/salesOutreach/contacts/apply.ts), [contact sweep](../../src/services/salesOutreach/contacts/sweep.ts), [evaluation job](../../src/services/salesOutreach/evaluation/evaluateJob.ts), [coverage](../../src/services/salesOutreach/evidence/coverage.ts).

Add focused regression and integrated synthetic journeys for A3–A4 and A7–A10. Use existing fixtures/adapters; add one dedicated tracked cadence/convergence replica harness or test file only if existing seams do not cover the joined journey. Do not duplicate the runtime domain logic in a test that merely recomputes its implementation.

Prove both accepting-channel orders, stale-captured receipts, same-value next-slot updates, late answered/outbound/SMS evidence, contact derivation after evaluation, provider outage at a deadline, number-link changes, pair ownership and lost wake recovery. Same workflow—including 2↔3—keeps periods/deadlines. Pin both current-state 0→5→0 closure interleavings; do not silently change reopening or claim a lossless Priority history. Delayed earlier Form callback must read/mirror current Form state. Actual Booked/Release evidence remains case/Owner-command work rather than a forced snapshot update.

Do not alter RingCentral cron expressions, staffed windows, API reservations, coverage watermark ownership, settlement allowance, call goals, cadence map or human plans to make tests pass. If a required invariant fails, fix that proven causal seam with the smallest shared change and add the reproducer; report any broader product-policy issue separately rather than expanding the session into a new event-history design.

Done when: the synthetic end-to-end state converges in either input order, no false verified misses appear beyond coverage, no extra contact credit/messages/periods are created, and all existing business protection tests remain green.

## G5 — Verification, documentation and release handoff

Run focused tests as implementation develops. Finish with typecheck, applicable lint, and a bounded full unit run. Use actual runner file names discovered in the checkout; relevant existing files include:

- `src/services/granotHttpCollector/estimatesCron.test.ts`, `runWorkflow.test.ts`, `estimatesIdentityPlanning.test.ts`, `estimatesOutreachRefresh.test.ts`, `poolScheduling.replica.test.ts`, `pendingApply.replica.test.ts`.
- `src/services/granotLifecycle/automationApply.test.ts`, `processor.test.ts`, `leadDesiredState.test.ts`, `callLeadFormSibling.test.ts`, `granotTemporal.test.ts`, and matching replica tests.
- `src/services/salesOutreach/subjects/feed.test.ts`, `leadChangeJob.test.ts`, `eligibility.test.ts`, plus actual subject/period fixtures and contact/evaluation/coverage suites.
- Existing Call reporting/targets/No-Sync and RingCentral regression suites for touched seams.

Representative safe commands, **without loading `.env`**:

```powershell
pnpm typecheck
pnpm lint
node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=3 "src/**/*.test.ts" "api/queues/**/*.test.ts" "ops/lib/*.test.ts"
```

Default-suite replica skips are not passes. Use the documented isolated loopback runner in [ops/test-granot-lifecycle-replica.ts](../../ops/test-granot-lifecycle-replica.ts) where applicable, or a dedicated harness with equivalent hard guards: test database name, loopback replica URI only, no dotenv/provider credentials, synthetic Sheet targets, no queue/provider publication. Pair/feed tests need queued test intents, not disabled outbox effects. If the current runner excludes a new joined proof, run it explicitly and record its command. Do not run an operator backfill as a test.

Update these owning docs/rules to describe implemented behavior accurately:

- `docs/knowledge/services/granot-http-collector.md`, `docs/knowledge/estimates-in-process-update.md`, `docs/knowledge/granot-lifecycle/automation-apply.md` and `.cursor/rules/granot-http-automation.mdc` (schedule, scope, freshness).
- `docs/knowledge/granot-lifecycle/identity.md` / `processor.md` for precise pair/shared-channel cross-links; keep immutable creation and event-specific booking rules intact.
- `docs/knowledge/services/sales-outreach-desk.md` and `docs/knowledge/sales-outreach-lifecycle.md` for the related Form wake, current-state/coalescing and no-op timing semantics. Point to existing RC coverage authority rather than copying it.
- `docs/knowledge/services/call-lead.md` / billing documentation only for affected sibling delivery clarifications. Correct stale attribution-only/yesterday-through-today statements found in matching touched docs/rules.
- This packet's implementation ledger and `docs/index.md` pointers. Do not mark the proposed schedule as deployed from code/tests alone.

Create a release handoff recording exact patch SHA/files, test/replica evidence, API compatibility, no new environment requirement, optional additive manifest field and old-record compatibility, current deployment unknowns, and rollback. Check that all referenced paths and commands exist. Distinguish implemented/tested/integrated/deployed/qualified explicitly.

## Release observation and rollback

After a separately authorized deployment, inspect representative ALL slots, both day/overnight boundaries and the 06:00 Pool overlap. Record full declared collection, permitted effects and queued/held/failed work separately. Confirm related-Form hold release and current Duplicate Calls receiver/Job updates without reprocessing the whole historical sheet.

Measure slot duration, lease busy/expiry, oldest automation/Lead-change/contact/evaluation work, accepted Lead→subject→projection latency and RC capture/derivation coverage. Existing service timing expectations are not measurements. Require recurring batches to clear within the new interval with headroom; if not, report capacity unqualified and tune a demonstrated bottleneck in separate bounded work rather than shrink Open Date coverage or raise RC polling blindly.

Live qualification across real schedule boundaries may continue beyond the engineering session. This does not prevent completing the code/test/review handoff in one session, but it prevents describing production cadence as qualified before observing it. No recurring monitor is created by this plan.

Rollback the schedule admission to 08/13/18 while keeping readers/recovery compatible with already persisted newer-hour manifests. Retain accepted facts, queue jobs, receipts, related-refresh identities, pair markers, reporting admission and financial history. Do not drop collections, purge evidence, reset periods, delete historical Leads or rerun final ingestion as rollback.

## Completion checklist

- [x] G0: current owning baseline and concrete reproducers recorded.
- [x] G1: exact schedule, Pool duties, old-run recovery and hourly-safe freshness proven.
- [x] G2: permitted existing exception-row sibling updates nominate canonical delivery; no normal Calls append.
- [x] G3: durable related-Form refresh clears the held Form with correct no-admission/replay behavior.
- [x] G4: joined webhook/automation/RC/Desk permutation journeys, no-op stability and closure limitations proven.
- [x] G5: checks, real replica evidence, owning docs and exact review/release/rollback handoff complete.
- [x] No production mutation, broader historical backfill, financial change, qualification fabrication, import, unsolicited deployment or new monitor occurred.
- [x] Final report states the next proof still owed: deployment and measured live convergence/capacity, if not separately performed.

## Ready-to-use agent prompt

> In `vantage-main-server`, implement `docs/granot-automation-frequency/IMPLEMENTATION-PLAN.md` against its linked final specification. Work through G0–G5 in one session until the reviewable patch, focused and disposable transaction proofs, owning documentation and release handoff are complete. Preserve unrelated work and current Call admission, Form-first pair, financial and closed-period policies. Keep RingCentral schedules independent; implement the two pair-propagation fixes and schedule-aware freshness, not only the hour list. Use no production credentials for tests and make no production/Sheet/provider writes, imports, backfills or deployments. Report implemented/tested separately from deployed/qualified and identify the next remaining proof.
