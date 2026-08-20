# Unit 34 — Final current-Granot-webhook-payload application-logic certification

> **Contract maturity: implementation-ready; implementation remains blocked by Units 31 and 33.** Unit 32 is intentionally skipped and is not a prerequisite. This mandatory final unit certifies current Granot webhook payload **shapes** through completed production interfaces under strict isolation. It introduces no domain behavior, authorizes no production mutation or rollout, and never exposes raw current payloads to the repository, issue, report, model, hook, or subagent.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 9–18, 26–28, 33–36, 39, and 41; read every Section 36 AC row touched by the replay matrix in full.
- **Approved split/protocol:** Unit 34 and Section 8 of `specs/lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 34 samples completed behavior and does not replace Unit 33's AC-01–AC-40 automated regression.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`, Unit 31 certification/runbooks, Unit 33 cleanup inventory and AC ledger, all applicable completion reports, current code/index/flag/Registry state, and secure-data policy supplied at execution time.
- **Production seams:** authenticated webhook routes/middleware; `GranotObservationReceipt` capture; receipt-ID queue publisher/consumer/cron/drainer; `GranotObservationProcessor`; source policy/identity/desired state; canonical commands/outbox; masked projections/health.

The final specification wins. An unexpected payload is evidence of drift or an undecided domain gap, never permission to weaken auth, normalization, source policy, identity, authority, idempotency, privacy, or fail-closed behavior.

## 2. Objective

Obtain current payloads only from an explicitly user-approved secure location, transform them locally into PII-safe structural derivatives, and replay every available family plus required sanitized variants through the authenticated webhook/capture/queue/processor/application path in an isolated replica-set environment. Produce a signed and dated certification matrix from payload family → Receipt → Observation → Decision → permitted effect/no-effect, including Best Relocation creation policy, Referral, queue recovery, canonical Lead/Booking/Cancellation mutations, exact Master Leads/Master Booked Sheet Sync intent, masking, observability, and full-regression results. End with a clear application-logic go/no-go recommendation; this is not production rollout approval.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** primarily `vantage-main-server` / `granot-lead-lifecycle`; observe `vantage-admin` / `granot-lead-lifecycle` and `granot_sync_extensions_and_services` / `main` only when a cross-channel/projection assertion requires them.
- **Prerequisites:** Units 01–31 and 33 complete; Unit 32 skipped; Unit 31 migration/index/security certification green; Unit 33 AC-01–AC-40 ledger and full checks green; no unresolved source-policy, queue, Sheet Sync, migration/index, privacy, or security failure.
- Verify exact reviewed Registry posture: Best Relocation Forms aliases and Best Relocation Inbounds aliases are enabled source-scoped families with `lead_created_policy:"create_if_missing"`; applicable other sources retain reviewed `link_only`/evidence policy; Referral is `referral_booking` plus `observation_only`; Paid Overflow and Auto are disabled/deferred. Never infer source identity from payload `type=AUTO`.
- A current-payload secure location, access window, custodian, retention/deletion decision, and allowed operators must be explicitly approved by the user before any raw read. If not approved, stop before access; synthetic work cannot falsely complete Unit 34.
- Assignment does not authorize commit, push, deploy, production database/API access, retrieval from an unapproved location, production secret use, external send, flag/Registry mutation, migration/index apply, or rollout.

## 4. Current-state evidence to verify

Observed on 2026-08-19; refresh at execution time:

- Production code exposes three Granot webhook routes for `lead_created`, `priority_updated`, and `booking_status_changed`. Middleware accepts configured body/header secrets, strips credentials before capture/hash/logging, and capture returns `202` before best-effort queue publish.
- Webhook capture publishes only `{ receipt_id }`; queue consumer, five-minute cron, synchronous extension/automation apply, and manual requeue enter the same fenced drainer. Certification needs queue success, publish-loss/cron recovery, duplicate wake-up, and lease-loss evidence.
- Normalization, source policy, identity, planner, canonical Lead effects, Booking/Release/Referral cases and commands, discrepancies, metrics, and protected projections exist under production modules. Unit 34 adds a harness/report only; a behavior defect returns to its earlier contract.
- Checked-in flags default to processing/shadow true and all effects false. Isolated fixtures inject explicit per-case postures rather than changing repository/production defaults.
- Canonical Lead create/update commands enqueue Sheet Sync transactionally; Owner Booking/Release/Referral commands use the canonical outbox. The matrix must assert `master_leads` and `master_booked` at correct mutations and zero jobs for no-effect outcomes.
- Current raw payloads have not been inspected by issue authorship. Availability, encodings, schema fingerprints, and drift are deliberately unknown until approved custody begins.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** isolated Mongo state is replay authority; reports/current payloads are evidence only.
- **Invariants 2–4:** Granot never automatically creates/updates a Booking or creates/changes a Cancellation; lifecycle remains composed rather than stored; one Booking per normalized Job remains enforced.
- **Invariants 5–7:** authorized aggregate mutation uses a canonical command and atomic Receipt/Observation/Decision/Command/Change/revision/outbox chain; no-op creates no Change or Sheet work.
- **Invariants 8–10:** source system, channel, origin, actor, and initiator stay separate; immutable snapshots are not overwritten; identity conflict never changes Source Company, Source Granularity, Ingestion Origin, or CPL.
- **Invariant 11:** Duplicate and Bad Form Lead restrictions remain exact even if a current payload suggests otherwise.
- **Invariant 12:** resolved cases never reopen; later same-kind action allocates the next sequence.
- Shape drift fails closed. Do not invent occurrence time/revision, source labels/routes, aliases, mappings, meanings, or authority.
- Queue delivery is only a wake-up. A lost/duplicate message cannot lose durable work or cause a second unfenced effect.
- Best Relocation Forms/Inbounds use reviewed `create_if_missing` only after identity/gates; Referral never creates a Lead and only an explicit Owner command can create its leadless Booking.

## 6. Deliverables and exact contract

### 6.1 Raw-input custody and sanitizer

Before reading a current payload:

1. record approval, custodian, secure source category, access-limited gitignored temp directory outside the repository, retention/deletion instruction, and operators without printing secret paths/values;
2. verify no raw content can enter terminal capture, shell history, logs, screenshots, issue/handoff text, test names, model/hook/subagent input, repository files, or reports;
3. strip `x-api-secret` and every credential/authorization/cookie field before hashing, saving, displaying, or transforming;
4. inventory families using schema-only facts: route class, content type/body encoding, event/source-label family, and presence/type/shape of identity/contact/move/Priority/user/rep/action fields;
5. use a deterministic local sanitizer that replaces names, phones, emails, addresses, Job/reference IDs, free text, and linked values while preserving field presence/type, aliases, Unicode/whitespace, numeric formatting, encoding, and cross-field identity relationships;
6. scan derivatives for credentials, customer values, realistic contact/address patterns, and custody-path leakage. Only scanner-green derivatives may enter durable fixtures.

Raw deletion/retention follows explicit user/data policy; do not delete merely because replay completed. Certification stores schema fingerprints/counts, never raw/body hashes that could identify a customer externally.

### 6.2 Environment gate

The harness refuses replay unless it records:

```text
approved local or staging target
TEST_MODE=true (or equivalent isolated posture)
disposable non-production Mongo database on a replica set
SHEET_SYNC_MODE=disabled or fully isolated fake adapter
no live Granot CRM, RingCentral, queue, email, notification, or Google target
test webhook secret only
bounded observable queue/cron execution
all ten lifecycle flags explicitly captured
reviewed synthetic Registry, Source Company, Granularity, Agent, Merchant,
Lead, Booking, Cancellation, link, and case fixtures
complete migration/index verify green
```

Use a fake/in-memory queue unless an approved isolated namespace exists. Any queue/provider ambiguity stops replay. Never connect to production to make fixtures realistic.

### 6.3 Required replay matrix

Cover every current family available and construct scanner-green variants for required gaps:

1. JSON body-secret, form body-secret, and header-secret auth where supported/current; missing, wrong, and conflicting dual credentials create no receipt.
2. `lead_created`, `priority_updated`, `booking_status_changed`; absent compatible payload event and incompatible route/event conflict.
3. observed Priority values plus `0`, `1`, `5`, `05`, another non-1/5 valid value, maximum allowed format, malformed, and missing.
4. exact case-insensitive `Booked`, `Releas`, `Release`; unsupported `Released` and near matches.
5. Form `ref_no`, valid Mongo ObjectId compatibility, Call Job, Record Link, source-scoped submitted/current contact, pending, ambiguous, Duplicate, Bad, and hard Source/Job/link conflict.
6. Best Relocation Forms same valid states → Local; differing valid states → long-distance; invalid/missing state → no creation. Best Relocation Inbounds → Call. Both use `create_if_missing`, match before create, require active scope/minimum data, and reserve one link/Lead under races.
7. reviewed `link_only` source follows exact pending schedule and never creates; Referral stays leadless/special; Paid Overflow/Auto stay deferred; `type=AUTO` never chooses source policy.
8. matched Lead link/update, already-current, stale/tie-break, source conflict, incomplete creation, authorized create-if-missing, and concurrent no-second-Lead.
9. WordPress immutable/current contact/move authority; Call/Granot-created authority; Agent single-match/conflict/existing receiver.
10. Priority-5 and Booked case modes, refresh/next sequence, existing Booking review, Release active/already-cancelled/no-Booking/conflict, Booked-after-cancellation discrepancy, Referral, and simultaneous Booking/Release cases—with no automatic official mutation.
11. isolated explicit Owner commands for Lead update/create, standard Booking create/update, Referral Booking, Cancellation/update, No Action, replay, already-satisfied, stale revision, and one-winner races. Webhook evidence supplies the case, never official input values.
12. identical webhook deliveries create distinct Receipts/Observations while desired-state replay is idempotent; operation-ID replay/conflict remains covered by Unit 33 cross-channel tests.
13. queue publish success, publish failure plus cron recovery, duplicate wake-ups, queue/cron overlap, expired claim recovery, lease loss, technical retry/dead letter/requeue, and pending-match scheduling.
14. malformed/extra/nested fields cannot inject internal metadata, actor/initiator, Source Scope, official Booking/Cancellation values, raw headers, command data, or logs/projections.

An absent current family is `not_observed`; its synthetic AC fixture remains mandatory and cannot be removed or called current-shape proof.

### 6.4 Assertions per replay

For every case retain masked IDs only and assert:

- exact HTTP status/safe envelope and one credential-redacted Receipt with channel/auth/hash/work facts;
- one Observation per receipt with exact normalization result/issues and normalized evidence shapes;
- exact Registry policy/version, Source Scope/disposition, identity method/outcome, gates, ID/reason-only candidates, and one Decision per business attempt;
- queue claim/lease/attempt/final state, recovery source, and no second unfenced processor/effect;
- permitted link/Lead/case/discrepancy/command/effect or exact forbidden-effect absence;
- mutation transaction contains Decision → Command → revision → Entity Change → outbox references and rolls back together on injected failure;
- changed Lead create/update queues the authoritative `master_leads` intent; standard/Referral Booking and Cancellation-related official mutations queue the authoritative `master_booked` intent set; Referral queues only `master_booked`; no Google delivery occurs;
- already-current, stale, shadow, invalid, unsupported, deferred, policy-blocked, conflict, No Action, failed command, and unprocessed dead-letter work create no forbidden mutation, Change, or Sheet job;
- masked timelines/projections/health contain no raw payload/headers/contact; events/metrics use bounded values and occur once per semantic transition.

### 6.5 Harness, defect routing, and report

Implement only the minimum access-limited harness/sanitizer/scanner/report generator. It calls production routes/modules and does not copy normalization, source policy, identity, desired-state, queue, command, or Sheet-target logic. Raw paths/derivatives are gitignored; only scanner-green fixtures and a PII-safe summary may persist.

Classify mismatch as `payload_shape_drift`, `sanitizer_fixture_defect`, `implementation_defect`, `environment_defect`, or `true_domain_gap`. Fix harness defects locally. Implementation defects return to the owning unit with focused/full regression. A domain gap stays fail-closed and needs Owner/specification decision; Unit 34 cannot complete unresolved. Re-run the affected family and all checks after an approved fix.

Produce dated Markdown/JSON artifacts containing custody category; family counts/schema fingerprints; sanitizer/scanner result; environment/flags/Registry/index posture; masked matrix; expected/actual Receipt/Observation/Decision/effect/no-effect; queue and Sheet evidence; AC IDs touched; defects/owner/resolution/rerun; full checks; zero-secret/PII/external-effect assertions; and go/no-go. Use established completion-report sign/date convention; do not invent cryptographic signing.

## 7. Explicitly out of scope

- New behavior, source policy/alias/route, normalization rule, enum/reason/result, identity ladder, effect, command, case mode, queue algorithm, Sheet optimization, UI, notification, or migration/index definition.
- Optional Unit 32 email; email stays false and providers disabled.
- Raw content as an ad hoc fixture, weakening tests to accept drift, or treating sample absence as permission to remove a contract.
- Production replay/database read-write, production secret, live queue/provider/Google delivery, flag/Registry mutation, deployment, rollout, customer contact validation, or external communication.
- Automatic Booking/Booking-update/Cancellation/un-cancellation from Granot evidence.
- Reopening Unit 33 cleanup without a classified defect and rerun evidence.

## 8. Flags and runtime posture

Checked-in and production values remain unchanged:

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

The isolated harness explicitly injects historical-shadow, live-shadow, and narrowly live cases. Effects are enabled only inside scoped synthetic fixtures after controlled activation/cutoff. Provider/Sheet delivery stays disabled/faked. A shadow Decision is never replay-promoted; a new post-cutoff receipt is required.

## 9. Migration and indexes

**None.** Unit 34 is certification-only. Before replay run read-only verification:

```text
TEST_MODE=true pnpm migration:granot-lifecycle:receipts -- --verify
TEST_MODE=true pnpm migration:granot-lifecycle:sources -- --verify
TEST_MODE=true pnpm migration:granot-lifecycle:leads -- --verify
TEST_MODE=true pnpm migration:granot-lifecycle:revisions -- --verify
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
```

Any mismatch blocks replay and returns to Unit 31/owning predecessor. Unit 34 does not report/apply/repair production data or create/drop runtime indexes.

## 10. Acceptance criteria

Unit 34 samples the completed behavior against current shapes while Unit 33 remains the full automated proof. The matrix must explicitly map every touched family to its applicable IDs from this complete set: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-38, AC-39, and AC-40. Their exact assertions are retained in Unit 33 and final-spec Section 36 and may not be weakened by sample availability.

- [ ] Section 8 custody/environment protocol is exact; raw payloads/secrets/customer values never enter tracked files, logs, reports, terminal capture, issue/handoff text, or model/hook/subagent output.
- [ ] Every available family has a schema fingerprint/masked row; every required absent family is `not_observed` and remains covered synthetically.
- [ ] **AC-01–AC-09 sampled:** auth/credential absence, receipt identity, Form round-trip, Source Scope conflict, Priority/action independence, matched no-duplicate, authorized `create_if_missing`, and Best Relocation routing match the final contract.
- [ ] **AC-10–AC-17 sampled:** immutable/current authority, Agent rules, and applicable RingCentral convergence remain correct; Unit 33's RingCentral regression stays green when current webhooks cannot exercise call ingestion.
- [ ] **AC-18–AC-28 sampled:** Booking/Release/Referral evidence routes to exact cases/discrepancies and explicit Owner commands only; no webhook automatically mutates official facts; concurrency and Sheet targets are exact.
- [ ] **AC-29–AC-40 sampled:** deferred sources, pending schedule, execution mode, causal/no-op behavior, parity baseline, privacy, index races, requeue/dead letter, Registry ambiguity, Booking-lead delegation, and coexisting cases remain green. Unit 33's automated ledger is complete proof.
- [ ] Best Relocation Forms/Inbounds are verified `create_if_missing`; applicable other sources remain `link_only`; Referral remains leadless/special; Paid Overflow/Auto fail closed.
- [ ] Queue success/loss/duplication/cron overlap/lease loss/retry/dead-letter preserves durable work and produces at most one fenced effect.
- [ ] Every reportable Lead mutation creates exact `master_leads` intent; Booking/Referral/Cancellation-related official mutations create exact `master_booked` intent; no-effect paths create none; no Google delivery occurs.
- [ ] Every defect is classified/routed/rerun; no unresolved implementation defect or domain gap remains.
- [ ] Dated PII-safe artifacts and full checks are green; recommendation is explicit `go` or `no-go`. `go` means isolated application logic certified, not rollout authorized.

## 11. Required tests and commands

The implementation may add a deterministic harness command, but it must default to dry validation, require an explicit approved raw-input path outside the repository, refuse unsafe posture, and emit only PII-safe artifacts. Record no secret/protected path in `package.json` or runbook.

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/middleware/requireGranotWebhookSecret.test.ts src/routes/granot-webhook.routes.test.ts src/services/granotLifecycle/normalization.test.ts src/services/granotLifecycle/sourcePolicy.test.ts src/services/granotLifecycle/identity.test.ts src/services/granotLifecycle/processor.test.ts src/services/granotLifecycle/drainer.test.ts src/services/granotLifecycle/crossChannel.test.ts src/services/granotLifecycle/operations.test.ts src/services/granotLifecycle/projections.test.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=34
TEST_MODE=true pnpm migration:granot-lifecycle:receipts -- --verify
TEST_MODE=true pnpm migration:granot-lifecycle:sources -- --verify
TEST_MODE=true pnpm migration:granot-lifecycle:leads -- --verify
TEST_MODE=true pnpm migration:granot-lifecycle:revisions -- --verify
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck

# vantage-admin, when projections are asserted or an approved fix touches it
pnpm test
pnpm lint
pnpm typecheck
pnpm build

# granot_sync_extensions_and_services, when parity is asserted or a fix touches it
pnpm test
pnpm compile
pnpm build
pnpm build:firefox
```

Use Vercel preview/dev only for isolated queue/webhook routing. Scanner tests seed canaries and assert they appear only in protected evidence locations. Sanitize all command output entering reports.

## 12. Live/staging verification

Use only approved isolated local/staging. Replay sanitized derivatives through the real authenticated HTTP route, observe isolated queue/fake publisher and cron fallback, and inspect masked causal IDs, bounded health/events/metrics, revisions, Commands, Changes, and outbox target names. Admin observation is read-only and never reveals raw payload/headers/contact.

No production replay/mutation is allowed. A separately authorized read-only production comparison may inspect only approved schema/count/version/index/metric projections—never raw payload/contact. Unit 34 `go` does not enable flags or begin Section 39 rollout.

## 13. Rollback

Stop the harness and disable its isolated caller first. Restore test flags to checked-in shadow/effects-off and dispose of fixtures per approved test-data policy. Preserve certification evidence, Receipts, Observations, Decisions, Commands, Changes, revisions, cases, discrepancies, outbox facts, and official test facts needed for diagnosis. Delete raw inputs only under explicit custody instruction. Revert an approved defect fix through its owning unit rollback; never weaken policy or reintroduce a bypass.

## 14. Required completion handoff

Use Runbook Section 13 and link the dated PII-safe Markdown/JSON report, sanitized fixture inventory, schema fingerprints, replay matrix, environment/flag/Registry/index posture, queue and Sheet-target proof, sampled AC IDs, defect routing/reruns, full results, go/no-go, final Git status, and raw-input retention/deletion disposition without protected paths/values.

State Unit 32 was skipped, no email behavior was added, no domain behavior was introduced, and no rollout is authorized. Explicitly disclose any commit, push, deploy, production access/mutation, payload exposure outside approved custody, flag/Registry change, migration/index apply, or external send; none is authorized. Unit 34 is final and unblocks no later implementation unit.
