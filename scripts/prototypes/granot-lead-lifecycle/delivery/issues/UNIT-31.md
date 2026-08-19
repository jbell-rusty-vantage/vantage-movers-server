# Unit 31 — Migration/index verification, historical shadow certification, security audit, and runbooks

> **Contract maturity: implementation-ready; implementation remains blocked by applicable Units 01–30.** This is the certification half of S21 only. It proves the complete synthetic/historical system and operating package before cleanup or final current-payload certification. It is not a production rollout or a current-customer-payload test.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 9.4, 11, 13–14, 21–23, 26–29, 33–41; especially Sections 27, 33–35, 37.2, 39–40, certification portions of AC-31/35/37/38, and Section 38/S21.
- **Acceptance ownership:** Unit 31 certifies pre-activation/shadow immutability, privacy/security, requeue/dead-letter behavior, Registry fail-closed behavior, all fixed migrations/indexes, operational thresholds, and zero forbidden effects. It does not replace earlier interface tests.
- **Approved split:** Unit 31 in `specs/lead_lifecycle_issue_breakdown_reccomendation.md`; Unit 30 owns implementation of events/metrics/health/alerts. Unit 31 owns full migration package closure, index verifier, historical shadow tool/report, masking/log audit, staged runbooks, and certification evidence.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`, server/Admin instructions and applicable migration/security/observability/lifecycle rules, every applicable Unit 01–30 completion report, current code and manifests, and current repository/index/flag state.

The final specification wins. Use only redacted synthetic fixtures and protected historical receipt identities. Do not read/export raw historical payload/contact values to certify the system. Unit 34 alone performs isolated final certification against current Granot webhook payload shapes.

## 2. Objective

Finish and certify the deployable operating package: all fixed Section 34 report/apply/verify commands, an exact full index verifier, a resumable production-module historical-shadow runner, deterministic PII-safe manifests, zero-forbidden-effects assertions, a raw-data/log/security audit, full mandatory repository checks, and operator runbooks for staged flags/thresholds/live verification/rollback. Prove on a confirmed disposable database that migrations are idempotent and fail closed, historical work stays permanently shadow, all Admin/operational surfaces stay masked, and no Lead/Booking/Cancellation/case/discrepancy/notification/Sheet effect is created.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** primary work in `vantage-main-server` / `granot-lead-lifecycle`; `vantage-admin` / `granot-lead-lifecycle` only for documentation or health-view corrections discovered by certification. No extension behavior change.
- **Prerequisites:** all applicable Units 01–30 code complete, Owner review gates recorded, focused/replica/interface checks green, and actual flags/indexes/migration status independently reverified. Unit 32 remains optional and is not a prerequisite.
- Reverify each migration owner's completion report (02/06/09/13 plus later index additions), Unit 21 singleton-index warning, Unit 23 authorized disposable index apply, all Unit 26–30 collection definitions, Unit 30 health/threshold evidence, and checked-in defaults.
- Use `TEST_MODE=true`, an explicitly named disposable replica-set database, `SHEET_SYNC_MODE=disabled` or queued with delivery stubbed, test RingCentral collections/write gates, observability notifications disabled, and external CRM/queue/provider calls stubbed. Print/record the safe environment posture before any apply/shadow run.
- No commit, push, deploy, production report/apply/verify, production flag/Registry mutation, live payload inspection, current customer export, or external send is authorized by issue assignment.

## 4. Current-state evidence to verify

Observed on 2026-08-19; refresh after Units 26–30 land:

- Package commands already exist for receipts, sources, Leads, revisions, and indexes. Their shared guard defaults to report, requires production confirmation for mutation, masks IDs, and writes gitignored manifests. They were built incrementally and have not yet been certified together against one fully prepared database.
- The index catalog is versioned and verifies landed lifecycle/RingCentral definitions. Earlier completion evidence recorded missing predecessor indexes on one shared test database; Unit 23 later performed an explicitly authorized apply for 42 predecessor definitions on `testvantagemovers`. Production definitions remain unverified, and Unit 26/29 indexes are not yet landed.
- There is no `scripts/migrations/granot-lifecycle-shadow-process.ts` and no fixed `pnpm granot:lifecycle:shadow` package command. Historical behavior is covered piecemeal in processor tests, not by the required resumable production-module certification tool/report.
- Existing health projection/metrics/Operational Events are partial through Unit 25 and Unit 21. Unit 30 must complete them before this audit; Unit 31 corrects certification-discovered masking/health drift but does not redesign S21 operations.
- Lifecycle projection code has allowlists and security tests, yet no one consolidated artifact proves all list/detail/Admin/log/event/manifest surfaces exclude raw payload/headers/contact. Logger calls and Operational Event detail sanitization require a complete static plus synthetic runtime audit.
- Checked-in lifecycle defaults are processing/shadow true and all eight effects false. No production activation/index/migration/Registry posture is claimed by repository defaults.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** MongoDB and verified indexes—not manifests, process counters, or scripts—remain authoritative. Certification is observational and never promotes a report into state.
- **Invariant 2:** historical Granot evidence never gains official Booking/Cancellation authority.
- **Invariants 3–5:** shadow tooling uses production modules and canonical boundaries but invokes no business aggregate command/effect; it creates no lifecycle enum or duplicate Booking.
- **Invariants 6–7:** certification verifies complete causal chains for landed effect tests and zero Change/Sheet work for no-op/shadow. It never fabricates missing evidence.
- **Invariants 8–10:** migrations/shadow/reports preserve provenance axes, immutable evidence, Source Scope, Ingestion Origin, CPL, and submitted snapshots; unknown state fails closed.
- **Invariant 11:** shadow/certification never makes Duplicate/Bad Form Leads eligible.
- **Invariant 12:** historical processing opens no case/discrepancy and cannot reopen resolved work; migration verification preserves uniqueness/sequence definitions.

## 6. Deliverables and exact contract

### 6.1 Finish the fixed migration package

Keep all scripts in `scripts/migrations/`, use one shared guard/manifest implementation, and expose exactly:

```text
pnpm migration:granot-lifecycle:receipts -- --report
pnpm migration:granot-lifecycle:receipts -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:receipts -- --verify

pnpm migration:granot-lifecycle:sources -- --report|--verify
pnpm migration:granot-lifecycle:sources -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:leads -- --report|--verify
pnpm migration:granot-lifecycle:leads -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:revisions -- --report|--verify
pnpm migration:granot-lifecycle:revisions -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:indexes -- --report|--verify
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
```

Omitted mode means report; modes are mutually exclusive; verify is read-only/nonzero on any mismatch. Every script rejects unknown/historical databases, checks selected database/mode before connection and before mutation, is deterministic/idempotent, requires exact production confirmation, writes only PII-safe JSON under the gitignored output root, and reports counts plus masked IDs/approved operational labels only.

Certify the exact Section 34 behavior: credential removal-before-hash and legacy receipt refusal; exact reviewed Registry joins with unmatched/ambiguous disabled/deferred; deterministic/`legacy_unknown` Lead provenance without invented facts; revision/history boundaries without predeployment Changes; and index collision-zero ordering. Do not silently repair a verifier mismatch or broaden a migration rule.

### 6.2 Complete index catalog and verifier

Make `granot-lifecycle-indexes` the one inventory for every final landed unique/partial/non-unique lifecycle definition, including receipts, Registry/automation, activation, Decisions, Record Links, Entity Changes, Lead provenance, normalized-Job Booking, Booking/Release cases, Booking/Release discrepancies, command/idempotency dependencies, and RingCentral singleton/processed-call identity indexes assigned to the program.

Report duplicate keys for every proposed unique/partial index using counts and masked IDs only. Create non-unique first; refuse each unique definition unless its collision group is zero. Verify name, ordered key, uniqueness, partial filter, collation/options where specified, collection, and absence of forbidden runtime auto-creation. An unexpected duplicate/missing/mismatch exits nonzero and appears in the certification report; never drop/replace an existing index automatically.

Run one complete report → reviewed apply → verify cycle on the confirmed disposable database, then rerun report/apply/verify to prove no-op idempotency. A test apply is allowed only after the runbook environment gate; no production apply is implied. Record script version, database mode/name, counts, masked manifest path/hash, zero collisions, exact created/already-current definitions, and both verify outcomes.

### 6.3 Resumable historical shadow runner

Add `scripts/migrations/granot-lifecycle-shadow-process.ts` and package command:

```text
pnpm granot:lifecycle:shadow -- --limit=<n> [--after-id=<id>]
```

The runner processes selected/all historically eligible receipt IDs in ascending `_id` order through the production `GranotObservationProcessor` interface and the same activation classifier. A selected receipt must classify `historical_shadow` because activation is absent or `captured_at < activated_at`; post-cutoff work is excluded/reported and never forced backward or replay-promoted. `--limit` is a positive bounded integer; `--after-id` is an exclusive valid ObjectId. Maintain a deterministic gitignored checkpoint containing the full last-completed receipt ObjectId needed for resume, but never print it; public console/certification output uses the standard masked ID. The checkpoint also stores script version, safe environment fingerprint, selection bounds, counts, and report hash. A restart resumes after the last committed receipt without replaying completed work; explicit `--after-id` cannot move behind an incompatible checkpoint.

The script passes receipt IDs only; it never reads/prints raw payload/headers/contact or reimplements normalization/policy/identity. It tolerates idempotent already-existing Observation/Decision evidence, records bounded failure codes, stops nonzero on a technical failure or forbidden effect, and never promotes a live-shadow Decision. Historical execution may create the safe Observation/Decision and permitted job-level Record Link evidence described by Section 27, but cannot invoke business commands/effects.

Before/after snapshots and per-checkpoint assertions prove zero changes to:

```text
FormLead / CallLead business documents and domain revisions
BookedLead
CancelledLead
GranotBookingReconciliationCase
GranotReleaseReconciliationCase
GranotBookingDiscrepancy
GranotReleaseDiscrepancy
DomainCommandExecution
EntityChange
SheetSyncJob / Sheet delivery
NotificationDelivery / email
Customer and Registry/audit policy
```

Also prove activation is unchanged, no official flag/Registry value changes, and no queue/provider/external send occurs. Report only counts by source-safe Registry reference/event/outcome/reason/match method and masked sample IDs. Do not include contact, Job Number, raw source label, payload hash if it can be correlated externally, or error text.

### 6.4 Certification report and zero-forbidden-effects proof

Generate a deterministic Markdown/JSON certification artifact under the gitignored output root plus a checked-in redacted summary/runbook record. It includes repository commit/dirty-state refs, tool/script versions, environment modes (never secrets), flags, activation presence/cutoff, migration/index manifest hashes/results, selected receipt count/range, bounded Decision distribution, health/alerts, before/after forbidden-effect counts, test results, and pass/fail findings.

The certification fails unless every selected pre-activation receipt remains `historical_shadow`; live-shadow Decisions are not replay-promoted; all forbidden counts/revisions/hashes remain identical; allowed evidence is causally linked; every migration verify is green; health thresholds are explained; and all outputs pass the privacy scanner. A failed assertion exits nonzero and leaves checkpoint/evidence for diagnosis without deleting or retry-promoting work.

### 6.5 Raw-data masking, credential, and security audit

Add an automated audit plus human checklist covering:

- webhook auth/capture: credential absent from payload/hash input/allowlisted headers/logs/errors/fixtures; unauthorized creates no receipt;
- every lifecycle list/detail/health/Job/Lead/case/discrepancy projection and Admin parser/component: no raw receipt payload/headers/address or unmasked contact;
- Operational Events/incidents/metrics/alerts/logger calls: closed keys/labels, masked IDs, bounded error codes, no reason/notes/provider/free-form text;
- `EntityChange`: contact/address reference-only and never full documents/raw evidence;
- migration/shadow/checkpoint/certification manifests and completion reports: counts/masked IDs only, gitignored raw artifacts, no customer-shaped fixtures;
- environment/command output: no secret values, connection strings, cookies, auth headers, live DB documents, or current payload content;
- routes/auth: v1 guard, Owner-only raw operational mutations, Owner/Admin safe reads, strict Zod/idempotency/error mapping, no browser-supplied actor/system snapshots.

Use redacted canary strings in synthetic inputs and assert they never appear outside the protected receipt/Observation locations. Scan tracked files and generated artifacts for credential keys, realistic contact patterns, and canaries. Do not scan/read real protected payload values to prove absence elsewhere; use schema projections, source inspection, and synthetic runtime evidence.

### 6.6 Staged activation, threshold, live-verification, and rollback runbooks

Create/update operator documentation under the existing Granot lifecycle docs/businesslogic/rules layout. It must record:

1. exact environment/database/replica/collection/Sheet/observability/provider preflight;
2. report → human review → separately authorized apply → verify order for every command;
3. index-before-runtime dependencies, especially RingCentral singleton and all case/discrepancy unique indexes;
4. activation write-once behavior and exact checked-in flags;
5. staged rollout order: processing shadow, reviewed matched writes, creation, RingCentral, Booking reads/commands, Release reads/commands, Referral, discrepancies/correction; email remains false;
6. the seven Unit 30 thresholds, observation interval, bounded evidence to inspect, and Section 39 stop conditions;
7. read-only production verification using causal IDs/metrics, never payload/contact;
8. narrow rollback order and preservation rules; and
9. explicit authority gates for production report/apply/deploy/flag/Registry/Owner command/external send/current-payload access.

Update `scripts/migrations/README.md`, relevant `.cursor/businesslogic/granotLifecycle*.md`, project/schema/owner/observability/RingCentral rules, and a dedicated production operator runbook. Keep `CONTEXT.md` implementation-free. Admin changes are limited to correcting any certified health masking/documentation drift.

## 7. Explicitly out of scope

- Current Granot webhook payload inspection/replay/certification (Unit 34), production go/no-go, rollout, effect enablement, Registry mutation, migration/index apply, deployment, or external send.
- Optional new-case email (Unit 32); `GRANOT_LIFECYCLE_EMAIL_ENABLED` stays false. Existing operational alert delivery remains disabled/sandboxed during proof.
- Prototype/compatibility deletion or complete AC-01–40 synthetic cleanup regression (Unit 33).
- New domain behavior, reason/enum/source policy, case/discrepancy/command semantics, Admin redesign, or fixes hidden in the certification tool. Defects return to their owning unit contract/code and the certification reruns.
- Raw payload export, customer/contact sampling, destructive rollback, evidence deletion, activation rewrite, revision decrement, or official-fact compensation.

## 8. Flags and runtime posture

Record and retain exact checked-in defaults:

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

Historical certification runs with every effect false and execution forced/verified as `historical_shadow`. It must not write activation. Runbooks document later staged values but no checked-in default or production value changes. Capture remains active if processing/effects roll back. Email remains false regardless of Unit 32's future include/exclude decision.

## 9. Migration and indexes

This section is the unit's primary deliverable. Execute all fixed commands in Section 6.1 against a confirmed disposable database in report → reviewed local apply → verify order, with idempotent second cycles. Record exact results and manifest hashes. Run the complete index collision/apply/verify flow only after all Unit 01–30 model definitions are landed.

Production report/apply/verify and any rollback script require separate authorization and exact target confirmation. Assignment authorizes no production access. Schema changes remain additive. Rollback artifacts identify changed IDs for inspection or a separately authorized unset script; they never automatically unset data.

## 10. Acceptance criteria

- [ ] **AC-31:** pre-activation receipts remain historical shadow on first run/resume/reprocess; live-shadow Decisions are never replay-promoted; zero forbidden effects are proven.
- [ ] **AC-35:** raw payload is absent from all lifecycle/Admin/operational projections/logs/events/metrics/alerts/manifests/reports; list contact is masked; canary/credential scans are green.
- [ ] **AC-37:** manual requeue remains Owner-reason/audit/payload-identity safe; dead-letter work mutates nothing until successful reprocessing; certification distinguishes technical failure from Decision.
- [ ] **AC-38:** unmatched/ambiguous Registry migration rows remain disabled/deferred; runtime ambiguity fails closed; audit/cache behavior and certification health evidence are green.
- [ ] Every fixed migration and full index catalog passes disposable report/apply/verify and idempotent rerun; verifier detects injected drift/collisions and exits nonzero.
- [ ] Historical shadow resume/checkpoint/report is deterministic, production-module based, PII-safe, and proves zero Leads/Bookings/Cancellations/cases/discrepancies/Commands/Changes/notifications/Sheet jobs.
- [ ] Full mandatory server/Admin checks and runbook/security/rollback audits pass with no unresolved gap.

## 11. Required tests and commands

Name focused tests with AC-31/35/37/38. Require CLI parser/DB guard/manifest/privacy/idempotency tests for every migration; injected collision/mismatch verifier tests; shadow ordering/checkpoint/resume/technical failure/allowed-evidence/zero-effect tests; replica migration and historical processing tests; route/projection/logger/canary scans; threshold/health regression; and rollback artifact checks.

Run at minimum:

```text
# focused migration/security/shadow tests
node --import tsx --import ./scripts/test-setup.ts --test scripts/migrations/granot-lifecycle-*.test.ts src/services/granotLifecycle/*.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/observability/operationalEventSanitizer.test.ts

# confirmed disposable replica/database only
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=31
pnpm migration:granot-lifecycle:receipts -- --report
pnpm migration:granot-lifecycle:receipts -- --apply --confirm-production=<confirmed-test-db>
pnpm migration:granot-lifecycle:receipts -- --verify
pnpm migration:granot-lifecycle:sources -- --report
pnpm migration:granot-lifecycle:sources -- --apply --confirm-production=<confirmed-test-db>
pnpm migration:granot-lifecycle:sources -- --verify
pnpm migration:granot-lifecycle:leads -- --report
pnpm migration:granot-lifecycle:leads -- --apply --confirm-production=<confirmed-test-db>
pnpm migration:granot-lifecycle:leads -- --verify
pnpm migration:granot-lifecycle:revisions -- --report
pnpm migration:granot-lifecycle:revisions -- --apply --confirm-production=<confirmed-test-db>
pnpm migration:granot-lifecycle:revisions -- --verify
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<confirmed-test-db>
pnpm migration:granot-lifecycle:indexes -- --verify
pnpm granot:lifecycle:shadow -- --limit=<synthetic-count>
pnpm granot:lifecycle:shadow -- --limit=<remaining-count> --after-id=<checkpoint-id>

# complete repositories
pnpm test
pnpm typecheck
git diff --check

# vantage-admin, even when only certification confirms no code drift
pnpm test
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

PowerShell/glob differences may require enumerating focused files explicitly; record actual commands. Repeat apply/verify to prove no-op idempotency. No runtime suite may use a non-test database or unstubbed external target.

## 12. Live/staging verification

First complete disposable migration cycles and a redacted synthetic historical-shadow run. Then, only under separate authorization, staging/read-only production verification may inspect migration/index status, bounded causal IDs, counts, metric/health/alert distributions, and masked manifests. It never reads raw payload/contact or executes an apply/effect.

S21 certification requires a complete PII-safe shadow report and explicit zero-forbidden-effects assertion. Stop/fail on any secret/raw-data finding, unknown DB, index drift/collision, non-idempotent migration, promoted shadow effect, aggregate revision/hash change, case/discrepancy/Command/Change/outbox/notification creation, missing causal ref, threshold breach without explanation, or external call.

## 13. Rollback

Set effect flags off and shadow true first; disable the historical runner/certification caller while capture remains active. Migration/index code rollback is additive prior-code compatibility plus separately reviewed artifacts—never automatic deletion. A faulty report is discarded/regenerated; durable Mongo evidence is not.

Preserve receipts, Observations, Decisions, activation, Registry/audits, links/history, cases/discrepancies, Bookings/Cancellations/Leads/Customers, Commands, Changes, revisions, outbox, RingCentral state, Operational Events/Incidents, manifests, and checkpoints. Never roll back activation history, canonical revisions, Commands/Changes, or committed official facts. Any field unset/index change/repair is a separate report-first authorized procedure.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-31-COMPLETION.md` using Runbook Section 13. Include verified Units 01–30; repos/branches; behavior-grouped migration/index/shadow/audit/runbook files; exact script versions/commands/manifest hashes; invariants/ACs; flags/activation; disposable database/replica/external-isolation posture; focused/full/replica/Admin outcomes; complete PII-safe zero-effect certification; unresolved findings routed to owners; final Git statuses; and explicit external-action statement.

Successful implementation completes mandatory S21 and establishes Gate H. It unblocks Unit 33 (subject to the explicit Unit 32 include/exclude decision) but does not authorize cleanup, production rollout, or Unit 34 current-payload access.
