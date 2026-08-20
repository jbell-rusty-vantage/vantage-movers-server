# Unit 33 — Prototype retirement, compatibility cleanup, and complete synthetic regression

> **Contract maturity: implementation-ready; implementation remains blocked by Unit 31 completion and compatibility-removal evidence.** Unit 32 is intentionally skipped and is not a prerequisite. This unit removes only superseded runtime/compatibility surfaces after their replacements are proven, reconciles documentation, and certifies the complete system with redacted synthetic evidence. It introduces no new lifecycle behavior and does not use current customer webhook payloads.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 9.1, 27–28, 33–37, 38/S23, 39, and 41, plus every Section 36 AC row.
- **Approved split:** Unit 33 in `specs/lead_lifecycle_issue_breakdown_reccomendation.md`, including the AC-01–AC-40 ownership ledger. Unit 34 alone owns current-payload-shape certification.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`, Unit 31 issue/completion report and certification artifacts, all applicable Unit 01–30 completion reports, current code/index/flag state, and instructions for all three repositories.
- **Production behavior authorities:** current `src/services/granotLifecycle/` modules and canonical commands, protected server routes, Admin clients/views, extension `0.2.8`, and the final migration/index inventory.

The final specification wins. Cleanup follows proven replacement usage; it may not reinterpret source policy, normalization, identity, desired state, queueing, canonical mutations, Sheet Sync, Booking/Release authority, or rollout posture.

## 2. Objective

Retire the disposable runtime prototype, Intake/generic lifecycle vocabulary, obsolete receipt compatibility fields and aliases, unreachable direct Granot patch/apply bypasses, and automation-owned synchronization semantics only after evidence proves no supported caller depends on them. Preserve the production receipt-to-processor architecture and all durable evidence. Finish with one dated, PII-safe acceptance ledger showing AC-01 through AC-40 green at their prescribed production interfaces across server, Admin, and extension, including queue/cron overlap, reviewed source policy, canonical mutation/outbox behavior, and exact Master Leads/Master Booked Sheet Sync intent.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle`, `vantage-admin` / `granot-lead-lifecycle`, and `granot_sync_extensions_and_services` / `main` when extension compatibility is retired or verified. Server contracts remain authoritative.
- **Prerequisites:** Units 01–31 complete with focused/full checks green; Unit 31 migration/index, historical-shadow, privacy/security, and runbook certification green; Unit 32 is skipped; all migration/index/security failures resolved; rollout/caller evidence sufficient for each proposed compatibility removal.
- Before editing, verify all three branches/worktrees and predecessor reports against code. Confirm the complete index verifier is green and checked-in flags retain the Section 27.2 defaults.
- Confirm the reviewed Registry state and migration manifest use canonical `create_if_missing` for both Best Relocation source-scoped families: normalized Best Relocation Forms labels and normalized Best Relocation Inbounds labels. Other source-scoped families remain their reviewed policy; Referral remains `lifecycle_disposition:"referral_booking"` with `lead_created_policy:"observation_only"`; Paid Overflow and Auto remain disabled/deferred/evidence-only. If Unit 31 has not landed and verified this exact policy, Unit 33 remains blocked rather than changing policy as cleanup.
- Use redacted synthetic fixtures, `TEST_MODE=true`, a disposable Mongo replica set, `SHEET_SYNC_MODE=disabled` or a fully isolated outbox/delivery fake, disabled provider/notification targets, and injected clocks. No commit, push, deploy, production mutation, live payload read, flag/Registry enablement, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-19; refresh after Unit 31 lands:

- `scripts/prototypes/granot-lead-lifecycle/` still contains executable `cli.ts`, `domain.ts`, `fixtures.ts`, `scenarios.ts`, Intake-era prototype documents, and dry-run helpers. `package.json` still exposes `prototype:granot-lifecycle`, `granot:lifecycle:dry-run`, and `granot:lifecycle:seed-official-sources`. The final specification, delivery pack, completion reports, and issue files in the same tree are authoritative records and are not disposable.
- `src/models/GranotObservationReceipt.ts` still declares legacy `event_type`, `received_at`, `schema_version`, `processing_status`, `processing_attempts`, `processed_at`, and `processing_error`, legacy indexes, the `GranotWebhookReceipt` export, and `getGranotWebhookReceiptModel()`. `capture.ts`, receipt migration helpers, tests, and one inventory script still consume compatibility names.
- The three extension apply URLs already capture channel-neutral receipts and invoke `claimAndProcessOrPoll`; Unit 16 reported that legacy patch handlers are unreachable there. Unit 17 reported `applyRun` no longer invokes direct Form/Call/Booked mutation services. Cleanup must prove this again before deleting old services or translations.
- The extension package is `0.2.8`; current apply calls use the three Section 28.1 URLs and stable operation IDs. Old installed-client absence has not been certified by repository state alone.
- Webhook capture publishes only `{ receipt_id }`; queue, cron, synchronous apply, and requeue converge on the fenced drainer. Existing tests cover pieces, but Unit 33 must run the complete overlap/retry/dead-letter regression through production entry points.
- Canonical Granot Lead mutations enqueue Sheet Sync in the same transaction; Booking/Release/Referral commands use the domain-command outbox. Unit 33 must prove changed Leads target `master_leads`, created/updated/cancelled Bookings target the applicable `master_booked` projection, Referral queues only `master_booked`, and no-op/shadow/invalid/unsupported/deferred/policy-blocked evidence queues neither.
- The checked-in source migration manifest currently says `link_only` for Best Relocation Call/Form. That contradicts the approved target for this final delivery and must be corrected, reviewed, applied where authorized, and verified by Unit 31/predecessor work before Unit 33 certification; cleanup must not conceal the mismatch.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** removing helpers, aliases, or prototype code never changes MongoDB authority or makes an artifact/report authoritative.
- **Invariants 2–4:** cleanup cannot introduce a lifecycle enum, make Granot evidence official Booking/Cancellation authority, or weaken one-Booking-per-normalized-Job enforcement.
- **Invariants 5–7:** every effect still enters a canonical command with atomic Decision/Command/Change/revision/outbox evidence; a no-op still creates no Change or Sheet work. Compatibility deletion may not reconnect a direct patch path.
- **Invariants 8–10:** removal preserves separate source/channel/origin/actor/initiator axes, immutable submission/creation evidence, Source Scope, Ingestion Origin, and CPL.
- **Invariant 11:** Duplicate and Bad Form Lead restrictions remain exact through the final production interfaces.
- **Invariant 12:** cleanup cannot collapse case kinds/sequences or reopen resolved work.
- Exact source-policy posture is a release contract: Best Relocation Forms and Inbounds are reviewed `create_if_missing`; Referral is leadless and special; deferred/unclassified sources fail closed.
- Queue delivery remains a wake-up only. Mongo due work, leases, fencing, retries, and dead-letter state remain authoritative.

## 6. Deliverables and exact contract

### 6.1 Classify and retire prototype artifacts

Create a checked-in, PII-safe cleanup inventory with `remove`, `retain_authority`, `retain_operations`, or `replace_reference` for every item under `scripts/prototypes/granot-lead-lifecycle/`.

- Remove executable prototype behavior (`cli.ts`, `domain.ts`, `fixtures.ts`, `scenarios.ts`) and the `prototype:granot-lifecycle` package command once every represented scenario maps to the AC ledger.
- Remove or clearly archive superseded Intake-era prototype/handoff documents so repository search cannot present them as current behavior. No active rule, business-logic doc, package command, test, import, or user-facing text may use Booking Intake, Cancellation Intake, dismiss, generic lifecycle engine/status, or old link-only plan vocabulary.
- Retain the final specification/index/traceability, approved issue breakdown, delivery issues/status/runbook, completion reports, warnings, and Unit 31/34 certification protocol as delivery authority/history.
- Remove the old prototype dry-run/official-source seed commands only when Unit 31's fixed migration/report/verify commands fully replace them. Operational migration sources under `scripts/migrations/` remain.
- Do not delete output/evidence by broad directory removal. Gitignored artifacts follow their custody policy and durable Mongo evidence is never deleted.

### 6.2 Retire receipt compatibility safely

Use the existing `migration:granot-lifecycle:receipts` report → separately reviewed apply → verify flow. Extend its deterministic PII-safe report to prove every row has the complete v2 evidence/work contract and inventory all remaining consumers before removal.

After a documented one-release compatibility window and zero supported consumers:

- stop writing/reading legacy `event_type`, `received_at`, `schema_version`, `processing_status`, `processing_attempts`, `processed_at`, and `processing_error`;
- remove their schema paths and legacy indexes;
- remove `GranotWebhookReceipt`, `GranotWebhookReceiptDocument`, `getGranotWebhookReceiptModel()`, legacy insert/fill helpers, and old capture names only after imports use `GranotObservationReceipt` equivalents;
- apply unsets only through the guarded receipts migration with exact production confirmation and separate authorization; report is default, verify is read-only/nonzero on missing v2 facts or remaining legacy fields/indexes;
- preserve collection `granot_webhook_receipts`, `_id`, payload evidence, hashes, capture time, Observations, Decisions, work state, activation, and every causal reference.

Do not silently translate a non-v2/refused row during cleanup. A failed report blocks alias/field/index removal.

### 6.3 Remove bypasses and semantic duplication

- Prove the three extension final-apply URLs accept strict statement items, capture `browser_extension` receipts, and invoke the shared claim/processor path; then delete unreachable Granot-specific direct patch/enrichment/reconciliation adapters used only by superseded clients. Ordinary non-Granot Lead editing routes stay intact.
- Prove HTTP automation schema-v2 actions store `${run_id}:${action_id}`, capture `granot_http_automation` receipts, and call `applyAutomationPlanAction`; automation may retain preview/approval/collection but cannot normalize, match, choose source policy, build authoritative patches, or own desired-state semantics.
- Preserve one-way compatibility result translation only while a confirmed supported `0.2.8` client needs it. Before endpoint/response cleanup, obtain approved deployment telemetry or an Owner-signed inventory proving no older extension version is active. Repository/package version alone is insufficient.
- Routes, Admin, extension, queue consumers, scripts, and migrations pass validated statements or receipt IDs; only `src/services/granotLifecycle/` owns lifecycle policy.

### 6.4 Complete AC ledger and synthetic regression

Create/update one checked-in ledger mapping AC-01–AC-40 to owning production test file/name, test level, repository, latest result, and live/staged observation still pending. Prototype-only tests do not satisfy an AC. The regression must explicitly cover:

- authenticated webhook capture → best-effort receipt-ID publish → queue consumer, cron fallback, synchronous extension/automation apply, manual requeue, claim loss, renewal, retry, pending-match schedule, dead letter, and replay without a second unfenced processor;
- Best Relocation Forms/Inbounds `create_if_missing`, same/different/invalid Form-state routing, match-before-create, minimum data, no-second-Lead race, and other reviewed `link_only` policies; Referral's leadless special path and deferred Paid Overflow/Auto;
- matched Lead update and creation causal chains with exactly one `master_leads` outbox intent when reportable Lead state changes;
- Booking create/update and Cancellation effects with exact `master_booked` intent, Referral with only `master_booked`, and no forbidden target;
- no Change/Sheet job for already-current, stale, shadow, invalid, unsupported, deferred, policy-blocked, conflict, or No Action; no automatic official Booking/Cancellation effect from webhook evidence;
- index-backed uniqueness/concurrency, masking, events/metrics/health, Admin accessibility/conflict preservation, cross-channel equivalence, extension operation-ID/version, and RingCentral adoption/lease/cursor.

### 6.5 Documentation reconciliation

Update applicable `.cursor/businesslogic/`, `.cursor/rules/`, migration README, server/Admin/extension rules, and operator runbooks to describe only the landed production design. Preserve `FormLead.ref_no -> leadno`, canonical vocabulary, Section 27.2 defaults, source-policy values, receipt-only apply paths, queue wake-up semantics, and current Sheet Sync targets. Keep `CONTEXT.md` implementation-free unless a genuinely new domain term was separately approved.

## 7. Explicitly out of scope

- Unit 34 current webhook payload access, sanitization, replay, certification artifact, or final go/no-go.
- New domain behavior, enums, reason codes, source labels/routes/policy, case/discrepancy semantics, commands, UI redesign, queue algorithm, Sheet Sync optimization, or notification behavior.
- Optional Unit 32 email; email remains false and no email code is pulled forward.
- Production rollout, migration/index apply, Registry mutation, flag enablement, deployment, external delivery, live customer-data query, or old-client telemetry access without separate authorization.
- Deleting durable Receipts, Observations, Decisions, links, activation, cases, discrepancies, Commands, Changes, outbox jobs, audits, or committed official facts.

## 8. Flags and runtime posture

Unit 33 introduces no flag and changes no checked-in or production value:

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

Tests may inject historical shadow, live shadow, and narrowly live postures against synthetic fixtures with external delivery disabled. Cleanup cannot be justified by enabling an effect. Capture stays active; compatibility removal does not rewrite activation.

## 9. Migration and indexes

The only Unit 33 data/index work is guarded legacy-receipt cleanup through:

```text
pnpm migration:granot-lifecycle:receipts -- --report
pnpm migration:granot-lifecycle:receipts -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:receipts -- --verify
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --verify
```

Report is default and non-mutating. Production apply requires separate authorization; ordinary proof uses a confirmed disposable replica set. The receipt report must show v2-complete rows, zero refused rows, zero supported legacy consumers, and the legacy field/index removal plan before apply. The full index verifier must stay green after legacy index removal. No other schema/index/backfill is owned here; missing source/Lead/case/discrepancy/RingCentral indexes return to Unit 31 or their predecessor.

## 10. Acceptance criteria

The acceptance ledger must retain these exact release assertions; cleanup may change their production test locations but not their meaning:

| ID | Required assertion |
| --- | --- |
| AC-01 | JSON body, form body, and header webhook secrets authenticate; credential is absent from payload, hash input, headers, logs, errors, and fixtures; unauthorized request creates no receipt. |
| AC-02 | Identical webhook deliveries create distinct receipts/Observations; same extension/automation operation ID replays one result; same ID with different hash conflicts. |
| AC-03 | Form CRM Posting sends `FormLead.ref_no` as `leadno`; Granot `ref_no` round-trips to exact Form Lead; valid Mongo ID fallback remains compatible. |
| AC-04 | Exact identity with conflicting Source Scope yields conflict and no mutation/reassignment. |
| AC-05 | Valid Priority `0`, `1`, `5`, `8`, `05`, and a large allowed value are canonicalized/stored; only `1`/`5` broadly enrich and set Quoted true; no value sets false. |
| AC-06 | Missing/malformed Priority invalidates Priority Update; the same malformed field on Lead Created/Booked/Release skips Priority but preserves the independent action. |
| AC-07 | Matched-existing Lead Created links/enriches without creating a second Lead. |
| AC-08 | Authorized `create_if_missing` Lead Created creates immediately once with an active Record Link; incomplete immutable data returns `insufficient_creation_data`. |
| AC-09 | Best Relocation Form same valid state routes Local; differing valid states route long-distance; invalid/missing states do not create. |
| AC-10 | WordPress Form primary contact and immutable submitted snapshot stay unchanged while qualified Granot contact is stored separately and displayed. |
| AC-11 | WordPress immutable move snapshot stays unchanged while qualified Granot current location/move date/cubic feet and Move Type update. |
| AC-12 | Call/Granot-created Form qualified contact becomes current; bounded Lead summary changes while full history appears in Entity Change. |
| AC-13 | Receiver Agent fills at a non-1/5 Priority through one active username match; differing `user`/`rep` blocks assignment; existing receiver is never overwritten. |
| AC-14 | Granot-created Call Lead is adopted by the matching RingCentral call and preserves Granot Ingestion Origin. |
| AC-15 | Adopted physical call is not a false duplicate; a different prior qualifying Call Lead still causes normal duplicate classification. |
| AC-16 | Zero/multiple phone adoption candidates or Job-number-only candidate do not guess; conflict is durable and qualified call is preserved. |
| AC-17 | Overlapping RingCentral cron runs produce one lease winner; cursor advances only after complete success; rolling lookback remains 12 hours. |
| AC-18 | Priority 5 with no Booking opens/refreshes create-missing Booking case; Priority 5 alone with existing Booking opens no review case. |
| AC-19 | Actual Booked with no Booking opens create-missing; actual Booked with one active Booking opens review-existing; never creates a second Booking. |
| AC-20 | Repeated same-kind action while open refreshes evidence only; after resolution, later action creates next sequence; evidence revision does not stale owner form. |
| AC-21 | Two concurrent owner commands with one case revision have one winner; replay of winner returns stored result; loser conflicts or resolves already-satisfied without second mutation. |
| AC-22 | Confirm Booking requires explicit eligible Lead, Book Date, allocations, exact Binder sum, nonnegative Deposit, and active Merchant; Granot display fields never default official fields. |
| AC-23 | Out-of-scope Lead selection requires reason and corrects Record Link with owner evidence but not Lead Source Scope. |
| AC-24 | Existing Booking review performs full official update on that Booking and preserves one-Booking-per-Job. |
| AC-25 | Release with active Booking supports Confirm Cancellation, Update Booking, and No Action; none happens automatically. |
| AC-26 | Already officially cancelled Release yields already-current and no case; Booked after Cancellation opens Booking Discrepancy. |
| AC-27 | Release without Booking or with conflicting link/Job/Source opens/refreshed Release Discrepancy and never creates/cancels anything. |
| AC-28 | Referral Booked creates a leadless referral case/Booking; no Lead search appears and only appropriate Master Booked projection syncs. |
| AC-29 | Paid Overflow and source Auto remain deferred/evidence-only; payload `type=AUTO` does not alter source classification. |
| AC-30 | `link_only` pending match follows the exact schedule and becomes unmatched at 24 hours; incomplete data is not retried as pending match. |
| AC-31 | Pre-activation receipts remain historical shadow under reprocessing and create no live effects; live-shadow Decisions are never replay-promoted. |
| AC-32 | No-op accepted Observation creates neither Entity Change nor Sheet Sync; every mutation has Receipt -> Observation -> Decision -> Command -> Change refs. |
| AC-33 | Extension and HTTP automation final apply produce channel-neutral receipts and the same desired-state outcome as equivalent webhook evidence. |
| AC-34 | Extension retains an operation ID across retry/auth refresh and reports version `0.2.8`. |
| AC-35 | Raw payload is absent from all lifecycle list/detail/admin projections and logs; list contact is masked. |
| AC-36 | Case/discrepancy open uniqueness and sequence indexes hold under concurrent evidence. |
| AC-37 | Manual requeue requires Owner reason/audit, respects payload identity, and dead-letter work does not mutate until reprocessed successfully. |
| AC-38 | Registry ambiguous/unmatched migration rows remain disabled/deferred; runtime ambiguity fails closed and audit/cache rules hold. |
| AC-39 | Booking missing its Lead uses existing Booking Lead Reconciliation, not a Granot discrepancy or duplicate workflow. |
| AC-40 | Actual Booked and Release may both have open cases for one Job; neither auto-closes the other. |

- [ ] **AC-01–AC-04:** all three webhook secret forms are credential-safe; operation identities replay/conflict correctly; Form `ref_no` remains `leadno`/exact identity with ObjectId compatibility; Source Scope conflict mutates nothing.
- [ ] **AC-05–AC-09:** exact Priority and independent-action rules hold; matched Lead Created never duplicates; reviewed `create_if_missing` creates once with complete data; Best Relocation state routing is exact.
- [ ] **AC-10–AC-13:** immutable Form contact/move evidence is preserved; authorized current contact/move changes are causally recorded; Agent assignment rules remain exact.
- [ ] **AC-14–AC-17:** RingCentral adoption, duplicate correctness, conflict preservation, lease, cursor, and 12-hour lookback pass production integration tests.
- [ ] **AC-18–AC-24:** Booking case modes/sequences/concurrency, strict official input, link correction, one-Booking-per-Job, and full existing-Booking replacement pass without automatic Booking creation.
- [ ] **AC-25–AC-28:** Release commands remain explicit; already-cancelled/conflict behavior is safe; Referral is leadless and queues only Master Booked.
- [ ] **AC-29–AC-34:** Paid Overflow/Auto stay deferred; pending clock is exact; historical/live shadow never promotes; mutation/no-op causal chains and Sheet targets are exact; extension/automation converge and extension remains `0.2.8` with stable operation IDs.
- [ ] **AC-35–AC-40:** projections/logs are payload-free/masked; uniqueness holds under Mongo races; requeue/dead-letter is safe; Registry ambiguity fails closed; missing Booking Lead delegates correctly; Booking and Release cases coexist.
- [ ] Every AC-01–AC-40 row identifies a production-interface automated test and is green; no claim depends only on the deleted prototype.
- [ ] Searches show no active Intake/generic-engine vocabulary, disposable runtime, receipt alias/legacy consumer, or direct Granot apply bypass. Retained historical authority is allowlisted.
- [ ] Queue/cron/synchronous/requeue overlap proves one fenced processor; each mutation proves exact Master Leads/Master Booked outbox intent; every no-effect path proves zero Sheet work.
- [ ] Old-client evidence is sufficient before endpoint/result compatibility removal; otherwise that cleanup is retained and Unit 33 stays incomplete.

## 11. Required tests and commands

Name/retain AC identifiers in tests and record exact results. At minimum:

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/routes/granot-webhook.routes.test.ts src/routes/extension-granot-apply.test.ts src/services/granotLifecycle/crossChannel.test.ts src/services/granotLifecycle/drainer.test.ts src/services/granotLifecycle/processor.test.ts src/services/granotLifecycle/automationApply.test.ts src/services/granotLifecycle/synchronizeLeadFromGranot.test.ts src/services/granotLifecycle/createLeadFromGranot.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts src/services/granotLifecycle/releaseReconciliation.test.ts src/services/granotLifecycle/discrepancies.test.ts src/services/granotLifecycle/operations.test.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=33
TEST_MODE=true pnpm migration:granot-lifecycle:receipts -- --report
TEST_MODE=true pnpm migration:granot-lifecycle:receipts -- --verify
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
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
pnpm build:firefox
```

Add deterministic searches over tracked runtime/docs, excluding retained final specs/delivery history, for prototype imports/commands, Intake/generic names, legacy receipt symbols/fields, direct apply services, unsafe payload/header/contact logging, and extension versions below `0.2.8`. Use Vercel preview/dev smoke when queue routing differs from direct Express. Use redacted fixtures and isolated adapters only.

## 12. Live/staging verification

In approved preview/staging, use redacted synthetic statements only. Prove authenticated capture returns `202`, queue wake-up and cron converge through Mongo claims, publish failure leaves recoverable work, extension/automation reuse operation IDs, and health shows bounded outcomes. Exercise one synthetic mutation per permitted family with isolated Sheet delivery and inspect masked causal IDs for `master_leads`/`master_booked`; prove forbidden paths create none.

Before removing client compatibility, record approved version/deployment evidence showing no supported pre-`0.2.8` client. Production verification is otherwise read-only and inspects versions/counts/index names/metrics, never payload/contact. Unit 33 never accesses current webhook bodies.

## 13. Rollback

Delay or revert the narrow cleanup when compatibility evidence is insufficient. Restore a one-way alias/adapter only if it still feeds the receipt processor; never restore direct mutation or duplicated policy. Receipt restoration scripts require separate authorization and cannot recreate guessed legacy values. Disable the narrow caller/effect or return to shadow first. Preserve the collection, receipts, activation, Observations, Decisions, links, cases, discrepancies, Commands, Changes, revisions, audits, outbox jobs, and committed official facts.

## 14. Required completion handoff

Use Runbook Section 13. Include the cleanup inventory, removed/retained compatibility surfaces, old-client evidence, AC-01–AC-40 ledger, source-policy verification, receipt report/apply/verify and full-index results, flags before/after, queue overlap proof, exact Sheet target/no-op proof, repository command results, masked preview evidence, final Git status, risks/retained compatibility, and confirmation that Unit 34 is unblocked only when all gates are green.

State that Unit 32 was skipped and no email behavior was added. State whether any commit, push, deploy, production mutation, current-payload access, flag/Registry change, or external send occurred; none is authorized.
