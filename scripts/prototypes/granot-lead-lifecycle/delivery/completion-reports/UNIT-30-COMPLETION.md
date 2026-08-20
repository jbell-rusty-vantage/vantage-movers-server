# Unit 30 — Operational events, metrics, health projection, and rollout alerts

**Status:** Complete  
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`

## Authority and readiness

Implemented final-spec S21 operational half and the Unit 30 portions of AC-31/35/37/38 under `delivery/issues/UNIT-30.md`. Units 01–29 and their completion reports were treated as navigation and re-verified against landed server/Admin code, checked-in flags, and the existing disposable `testvantagemovers` replica/index posture before implementation. Both worktrees began on the required branches. Existing predecessor edits were preserved.

No production metadata or payload access was needed. RingCentral independently production-enabled/create-capable posture was left untouched. Unit 30 adds no flag and no migration.

## Exact operational contract

- Centralized the issue-author Section 33 event catalog in `src/services/granotLifecycle/observability.ts`. Landed underscore keys normalize one-way (`booking_case_opened` → `booking_case.opened`, `dead_letter` → `dead_letter.entered`, `technical_retry` → `technical_retry.scheduled`, RingCentral `call_lead.adopted` / `adopted_duplicate` / `convergence_conflict` → `granot_adoption.adopted|conflict`). One transition emits one canonical key.
- `emitGranotLifecycleEvent` is best-effort, after-commit except failure transitions, never throws, never populates lead/contact columns, and sanitizes details to bounded enums/booleans/counts/durations/revisions/masked IDs/codes. Payload, credentials, contact, Job Number, source/actor labels, command body, reason/notes, money, provider bodies, and stacks are dropped.
- Exact Section 33 metric names are exported. Receipt `event_class` is a route class or `"none"` for extension/automation. `decision_to_effect_ms`, `open_cases{kind,mode}`, `open_discrepancies{kind,reason_code}`, and `command_conflicts_total{code}` are present. Open-case/discrepancy gauges are current Mongo cardinality, not evidence counters. Unknown labels are rejected.
- `GET /api/v1/admin/granot-lifecycle/operations/health` now returns `generated_at`, flags, activation (masked id), due/claim/dead-letter counts, 24-hour Decision groups with execution mode, open cases/discrepancies, command conflicts, last queue/cron runs, RingCentral lease/cursor telemetry, and the seven alerts. Due work matches Section 26: pending/retry plus claimed only when the lease has expired. Health is Mongo-backed and never depends solely on process memory.
- Seven frozen alert codes: `oldest_due_exceeded` tracks when the current oldest work crossed the 15-minute threshold and fires after 10 continuous minutes, `dead_letter_present`, `capture_unavailable` (24h), `claim_recovery_rate` (1h > 5), `capture_to_decision_p95` (24h, nearest-rank, empty → `insufficient_data`), `ringcentral_lease_held` (> 10 minutes), `source_ambiguity_policy_blocked_rate` (operationally enabled and lifecycle-enabled sources, 24h > 5%, empty → `insufficient_data`, public `scope_ref` masked). `insufficient_data` never recovers an open alert; only a measured `ok` does. Firing/recovery persist a deduplicated incident transition only.
- Vantage Admin adds a policy-free Owner/Admin health page at `/ingestion/granot/lifecycle/health`, linked from the lifecycle dashboard, Granot Health tab, and Workflow Observational. It renders the server DTO with units, UTC timestamps, non-color-only alert state, loading/empty/error/stale/refresh, and no mutation controls or raw payload/contact.
- Activation and manual-requeue business writes commit before their best-effort audit writes. Audit failure cannot abort either mutation, and legacy audit/log identifiers are masked. Lifecycle detail sanitization masks identifier keys case-insensitively and retains bounded conflict codes.
- The Admin health client rejects malformed required DTO structure instead of fabricating healthy-looking defaults. The view exposes claimed/work-state counts, oldest-due time, command conflicts, record-link counts, and the complete bounded RingCentral run/lease/adoption/throttle telemetry; refresh progress is announced through an accessible live status.

## Acceptance and invariant proof

| Acceptance / invariant | Proof |
| --- | --- |
| AC-31 operational | Health shows all ten flags, activation/processor version, and `decisions_last_24h.execution_mode`. Shadow/historical counts are labeled and Admin copy states they are not promoted effects. |
| AC-35 operational | Event sanitizer, metric label gates, health `assertProjectionSafe`, masked activation/scope refs, Admin parser dropping `payload`, and static UI scans reject raw contact/credentials. |
| AC-37 operational | Dead-letter/retry emit `dead_letter.entered` / `technical_retry.scheduled` and increment closed codes. Health dead-letter/due counts come from current Mongo. Observation itself creates no official Booking/Cancellation mutation (replica booked/cancelled counts unchanged). |
| AC-38 operational | Ambiguous/policy-blocked outcomes remain in 24-hour Decision groups and the enabled-source rate alert. Fail-closed Registry disposition `deferred` is excluded from the rate numerator/denominator set. |
| Invariants 1, 6–10, 12 | Mongo is the health SoR; emission is after-commit/best-effort; replay emits `owner_command.replayed` without a false apply/resolve; labels stay closed; gauges do not reopen work. |

## Migration, indexes, flags, and privacy

**Migration:** none. No schema/backfill and no index create/alter. `TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify` exited 0 read-only against disposable `testvantagemovers`. Unit 31 still owns the complete report/apply/verify cycle.

Checked-in defaults are unchanged:

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

`GRANOT_LIFECYCLE_EMAIL_ENABLED` remains unrelated optional case-email and false. Observability notification delivery was not enabled.

## Verification

Main server:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/services/granotLifecycle/metrics.test.ts src/services/granotLifecycle/operations.test.ts src/services/granotLifecycle/projections.test.ts src/services/granotLifecycle/observability.test.ts src/services/granotLifecycle/alerts.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/ringcentral/ringcentral-metrics.test.ts src/services/observability/operationalEventSanitizer.test.ts
TEST_MODE=true pnpm test:granot-lifecycle:replica -- --unit=30
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
GRANOT_LIFECYCLE_REPLICA_TESTS=false pnpm test
pnpm typecheck
```

- Focused contract suite: 55 passed, 1 expected opt-in replica skip, 0 failed.
- Unit 30 replica: 1/1 passed. Mongo due/claim/dead-letter/case/discrepancy/conflict deltas, dead-letter alert firing, and unchanged `booked_leads` / `cancelled_leads` counts.
- Aggregate index verification exited 0.
- Repository-wide ordinary suite after blocker fixes: 1,520 total; 1,434 passed, 86 expected opt-in replica skips, 0 failed.
- Typecheck passed.
- `git diff --check` passed after one trailing-whitespace fix.

Admin:

```text
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

- Full tests: 233/233 passed.
- Lint and typecheck passed.
- Production build passed and generated the new `/ingestion/granot/lifecycle/health` route.

## Remaining gates and external actions

Unit 30 completes the operational half of S21 and unblocks **Unit 31** after repository verification. Unit 31 still owns migration/index certification, historical-shadow runner, security/log certification, and rollout/rollback runbooks. This completion does not authorize rollout, production indexes, optional email, cleanup, or current-payload certification.

Known residual: health/alert evaluation in a shared disposable replica can see leftover receipts/decisions from earlier units; Unit 30 replica proof therefore asserts deltas plus bounded alert presence, not exclusive global emptiness. Process-local metrics remain a test adapter; durable health is the SoR.

**No commit, push, merge, deploy, production/staging mutation, production migration/index apply, flag enablement, live payload/customer inspection, external Sheet/CRM/provider request or send, notification, or email occurred.** Database writes were redacted synthetic fixtures plus cleanup in the configured disposable `testvantagemovers` replica.
