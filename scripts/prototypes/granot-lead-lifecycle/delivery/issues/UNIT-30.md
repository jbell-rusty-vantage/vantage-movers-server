# Unit 30 — Operational events, metrics, health projection, and rollout alerts

> **Contract maturity: implementation-ready; implementation remains blocked by applicable Units 01–29.** This is the operational half of S21 only. It makes the completed lifecycle observable and Owner-usable without enabling a business effect, running certification migrations, or processing historical data.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 26–29, 33, 35–41; especially Section 28.2 health, all Section 33 events/metrics/health/thresholds, operational portions of AC-31/35/37/38, and Section 38/S21.
- **Acceptance ownership:** Unit 30 owns complete PII-safe operational instrumentation, bounded metric labels, health projection, initial threshold evaluation, and Owner-safe health UI. Unit 31 owns migration/historical-shadow/security/runbook certification of those surfaces.
- **Approved split:** Unit 30 in `specs/lead_lifecycle_issue_breakdown_reccomendation.md`; do not absorb the Unit 31 fixed migration package, shadow processor, audit artifacts, or complete certification report.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`, server/Admin instructions and observability/lifecycle rules, every applicable Unit 01–29 completion report, and current repository/index/flag state.

The final specification wins. Operational Events are durable workflow evidence; metrics and health are bounded operational projections. None is business authority for a Lead, Booking, Cancellation, Record Link, case, or discrepancy.

## 2. Objective

Complete operational visibility across capture, durable processing, reconciliation/discrepancy work, Owner commands, activation, and RingCentral convergence. Every required transition emits a safe Operational Event and updates the exact Section 33 metric. `GET /operations/health` becomes a truthful bounded projection of flags, activation, queue work, 24-hour outcomes, cases/discrepancies, run state, and RingCentral lease/cursor telemetry. Initial rollout thresholds produce deduplicated operational alert state. Vantage Admin exposes an accessible Owner-safe health view with no raw payload or customer data and no policy logic.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`. Server health/threshold/event contracts are authoritative. No extension work.
- **Prerequisites:** all applicable Units 01–29 complete. Reverify capture/queue/processor/case/discrepancy/command event seams; actual models/indexes; Unit 21 RingCentral state/metrics; Unit 29 resolution behavior; and Owner/Admin read trust boundaries.
- As of 2026-08-19, implementation is blocked at Unit 26. Existing Unit 30 evidence therefore reflects code through Unit 25 plus completed Unit 21 telemetry; the implementing agent must refresh it after Units 26–29 land.
- Runtime verification uses synthetic fixtures, `TEST_MODE=true`, confirmed test collections/replica set, disabled external delivery, and test clocks. No commit, push, deploy, production query/mutation, live payload read, flag enablement, or external notification/send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-19:

- `src/services/granotLifecycle/metrics.ts` has process-local receipt, capture/queue failure, Decision latency/outcome, due/oldest, recovery/retry/dead-letter, activation, and Booking-case helpers. It lacks decision-to-effect, Release/discrepancy/command metrics and a complete named export surface.
- `src/services/ringcentral/ringcentral-metrics.ts` already provides the three exact Section 33 names with a closed adoption outcome set. Call Log state persists bounded lease/cursor/run telemetry. Unit 30 must project and alert from those facts rather than duplicate RingCentral policy.
- `projectGranotLifecycleHealth()` already returns flags, activation, receipt state/due/expired/dead-letter counts, 24-hour Decision groups, active/disputed links, and last queue/cron runs. It does not yet include open Booking/Release cases, discrepancies, command conflicts, RingCentral lease/cursor summary, threshold status, or all required accuracy tests.
- The protected `GET /api/v1/admin/granot-lifecycle/operations/health` route exists and is Owner/Admin-readable. Vantage Admin has lifecycle pages/query reservations but no dedicated lifecycle health client/view.
- Operational Events already exist for several queue, case, activation, and requeue paths, but naming/details are not complete across every required success/failure/replay/conflict. Some direct logger calls still need bounded-field review.
- The existing observability service is best-effort and owns durable events/incidents/notification policy. Unit 30 must reuse that public surface and configuration; operational instrumentation failure must not roll back business transactions. `GRANOT_LIFECYCLE_EMAIL_ENABLED` remains unrelated optional case-email delivery and false.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo durable work/current models provide health counts; process counters and Admin cache cannot override them.
- **Invariants 2–5:** observation/health/alert code is read/instrumentation only and may not create a business mutation or lifecycle enum.
- **Invariant 6:** event emission observes a committed causal transaction. It never substitutes for a missing Decision/Command/Change/revision/outbox fact and never runs inside a way that can break the transaction.
- **Invariant 7:** replay/no-op metrics/events must describe zero Change/Sheet work accurately and cannot cause work themselves.
- **Invariants 8–10:** labels/details preserve provenance axes and contain no payload, credential, contact/address, free-form provider error, unbounded Job/source/actor ID, or customer identifier.
- **Invariant 12:** counts distinguish open versus resolved sequences; observability never reopens/closes cases or discrepancies.

## 6. Deliverables and exact contract

### 6.1 Required Operational Events

Centralize Granot lifecycle emission under the lifecycle operations/observability boundary while using `src/services/observability/index.ts`. Section 33 fixes the transitions but not literal event-key strings; use this **issue-author catalog**, preserving already-landed compatible keys through a one-way normalization rather than double emission:

```text
granot_lifecycle.capture.failed
granot_lifecycle.queue.publish_failed
granot_lifecycle.processing.completed
granot_lifecycle.technical_retry.scheduled
granot_lifecycle.dead_letter.entered
granot_lifecycle.manual_requeue
granot_lifecycle.booking_case.opened|refreshed|resolved
granot_lifecycle.release_case.opened|refreshed|resolved
granot_lifecycle.booking_discrepancy.opened|refreshed|resolved
granot_lifecycle.release_discrepancy.opened|refreshed|resolved
granot_lifecycle.owner_command.applied|replayed|conflict
granot_lifecycle.activation.committed
ringcentral.granot_adoption.adopted|conflict
```

Where landed keys encode an exact reason such as `granot_lifecycle.booking_case_opened`, keep a one-way compatibility alias or normalize at the shared emitter; do not double-count one transition. Freeze the resulting catalog in tests and documentation.

Emit only after the relevant durable commit, except capture failure/queue publish failure/technical retry/dead letter which report the failure transition itself. Event write/incident/notification failures are best-effort and cannot change receipt/case/command/aggregate outcomes. Apply/replay/conflict must be distinguishable; replay emits no false apply. Case/discrepancy refresh is not an open. Queue and cron run events remain the health source for last-run status.

Allowed event details are bounded enums, booleans, counts, durations, revisions, masked IDs, route templates, outcome/reason/error codes, execution mode, channel, case/discrepancy kind/mode, and trigger. Reject/raw-scan payload, headers, secrets, contact/address, Job Number, source label, actor label/email, command body, reason/notes text, money, catalog IDs, provider body/message, stack, and unbounded exception text. Use `pii_policy:"none"` or `"masked"` truthfully; do not populate legacy lead/contact columns for lifecycle events.

### 6.2 Exact metrics and bounded labels

Expose/update the exact Section 33 names:

```text
granot_lifecycle_receipts_total{channel,event_class}
granot_lifecycle_queue_due
granot_lifecycle_oldest_due_seconds
granot_lifecycle_claim_recoveries_total
granot_lifecycle_technical_retries_total{code}
granot_lifecycle_dead_letters_total{code}
granot_lifecycle_decisions_total{outcome,reason_code,channel}
granot_lifecycle_capture_to_decision_ms
granot_lifecycle_decision_to_effect_ms
granot_lifecycle_open_cases{kind,mode}
granot_lifecycle_open_discrepancies{kind,reason_code}
granot_lifecycle_command_conflicts_total{code}
ringcentral_call_log_runtime_ms
ringcentral_adoptions_total{outcome}
ringcentral_call_log_lease_contention_total
```

`channel`, event class, outcome, reason, case/discrepancy kind/mode, adoption outcome, and conflict/error code come from closed program vocabularies. **Issue-author label guidance:** use `event_class="none"` when a valid extension/automation receipt has no route event class; never use a payload value as a label. Other unknown/unbounded labels are rejected or mapped to one bounded documented code, never passed through. No label contains IDs, Job, source/customer/actor text, URL, error message, or payload-derived free text.

Counters increment exactly once per committed semantic transition; replay has its own event but does not increment an applied effect twice. `open_cases` and `open_discrepancies` are current-cardinality gauges recomputed from Mongo, not evidence counters. Queue gauges derive from current due work. Histograms accept finite nonnegative durations and are recorded at the actual capture/Decision/effect boundaries. Keep the existing process-local test adapter if no shared exporter exists; the durable health projection must never depend solely on process-local memory.

### 6.3 Complete health projection

Extend the existing protected endpoint, not a second route:

```text
GET /api/v1/admin/granot-lifecycle/operations/health
```

Return `{ ok:true,data }` with this bounded contract:

```ts
type GranotLifecycleHealthProjection = {
  generated_at: string;
  flags: Record<GranotLifecycleFlagName, boolean>;
  activation: { present: boolean; id?: string; activated_at?: string; processor_version?: string };
  receipts: {
    by_work_state: Record<ReceiptWorkState, number>;
    due_count: number;
    oldest_due_at: string | null;
    oldest_due_age_ms: number | null;
    claimed_count: number;
    expired_claim_count: number;
    dead_letter_count: number;
  };
  decisions_last_24h: Array<{ execution_mode: ExecutionMode; outcome: SynchronizationOutcome; reason_code: SynchronizationReasonCode; count: number }>;
  open_cases: Array<{ kind: "booking" | "release"; mode: string; count: number }>;
  open_discrepancies: Array<{ kind: "booking" | "release"; reason_code: GranotDiscrepancyReasonCode; count: number }>;
  command_conflicts_last_24h: Array<{ code: string; count: number }>;
  record_links: { active: number; disputed: number };
  last_queue_run: { at: string; status: "completed" | "failed" } | null;
  last_cron_run: { at: string; status: "completed" | "failed" } | null;
  ringcentral: {
    state_present: boolean;
    last_run_at: string | null;
    last_run_status: "success" | "error" | null;
    cursor_to: string | null;
    lease: { held: boolean; acquired_at: string | null; expires_at: string | null; age_ms: number | null; expired: boolean };
    last_runtime_ms: number | null;
    last_adopted_count: number | null;
    last_adoption_conflict_count: number | null;
    last_throttled_count: number | null;
  };
  alerts: Array<{ code: string; scope_ref?: string; state: "ok" | "firing" | "insufficient_data"; observed_value: number | null; threshold: number; unit: "count" | "milliseconds" | "ratio"; since?: string }>;
};
```

Sort grouped arrays deterministically. Query counts in a bounded parallel read snapshot where practical and define due exactly as eligible pending/retry/expired-claimed work with `next_attempt_at <= now`; claimed/expired/dead-letter counts must not overlap incorrectly. RingCentral owner/phone/provider content never leaves its service; project only safe state fields. Read authorization remains Owner/Admin and raw operational mutations remain Owner.

### 6.4 Initial rollout alerts

Centralize fixed initial thresholds in lifecycle operations configuration and evaluate with injected clocks/windows:

- oldest due `> 15 minutes` continuously for `10 minutes`;
- any dead letter;
- capture `503` count `> 0`;
- claim recovery `> 5/hour`;
- p95 capture-to-decision `> 10 minutes`;
- RingCentral lease held `> 10 minutes`;
- source ambiguity/policy-blocked rate `> 5%` for an enabled source.

Use bounded alert codes. Persist a deduplicated Operational Event/Incident on transition into firing and a recovery event/auto-resolution when the condition clears; repeated evaluation updates current evidence without incident fan-out. **Issue-author window guidance where Section 33 gives no window:** evaluate capture `503`, p95 latency, and enabled-source ambiguity/policy-blocked rate over the rolling 24-hour health window; use the explicit one-hour window for claim recovery, current durable count for dead letters, and current lease/due state for the other conditions. Empty latency/rate samples yield `insufficient_data`, not success/firing. The source rate may group internally by Registry ID but public output uses only a masked source reference and bounded numerator/denominator/rate. p95 uses deterministic nearest-rank calculation.

Alert evaluation is best-effort and cannot pause capture/processing by itself. Stop conditions remain human rollout gates from Section 39. Existing observability notification delivery may consume alert incidents only under its independently enabled/sandboxed policy. This unit does not enable external email and does not use `GRANOT_LIFECYCLE_EMAIL_ENABLED`.

### 6.5 Owner-safe Admin health view

Add a stable health query key/client and an Owner/Admin read view under Granot Lifecycle (linkable from the lifecycle dashboard and Workflow Observational). Show generated time, activation/processor version, all ten flags, due/oldest/expired/dead-letter work, 24-hour outcomes, open case/discrepancy counts, queue/cron runs, RingCentral lease/cursor summary, and every alert state/threshold.

Use explicit labels, units, UTC timestamps, accessible tables/status text, non-color-only severity, loading/empty/error/stale states, refresh control, and keyboard/focus behavior. Never render raw IDs except masked operational references, raw payload/contact/source label/error text, or action controls that mutate lifecycle state. Admin consumes the server result and does not recompute due logic, rates, p95, activation mode, or alerts.

## 7. Explicitly out of scope

- Unit 31 migration/index cycles, historical shadow runner/report, security/log certification artifact, rollout/rollback runbooks, and final certification assertion.
- Discrepancy or reconciliation behavior changes, official mutations, new effect flags, activation, source policy changes, and production rollout.
- Optional case email (Unit 32), notification template/dedupe changes, prototype cleanup (Unit 33), and current-payload certification (Unit 34).
- A new metrics vendor/stack, unbounded labels, business analytics, raw logs/payload browsing, or Admin-owned threshold logic.
- Production queries, alert sends, deploys, flag changes, live data/payload inspection, or external communication.

## 8. Flags and runtime posture

Checked-in lifecycle defaults remain exactly:

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

Unit 30 introduces no flag and changes no value. Health displays actual evaluated values, including malformed configuration failing closed through the existing parser.

Synthetic tests may exercise every posture without enabling domain effects. `GRANOT_LIFECYCLE_EMAIL_ENABLED=false` throughout. Observability write/notification modes remain independently configured and disabled/sandboxed during ordinary proof. Metrics/events/health remain available in historical/live shadow and after effect rollback.

## 9. Migration and indexes

**None.** Reuse existing lifecycle models/indexes, RingCentral singleton state/index, and Operational Event/Incident indexes. Unit 30 adds no persistent schema/backfill and does not apply or alter indexes. Run the read-only lifecycle index verifier before staging proof:

```text
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
```

Any missing/mismatched prerequisite index blocks operational certification; do not create it at runtime or hide verifier failure. Unit 31 owns the complete report/apply/verify cycle.

## 10. Acceptance criteria

- [ ] **AC-31 operational portion:** health truthfully shows activation/execution posture and proves historical/live-shadow counts are not represented as promoted effects.
- [ ] **AC-35 operational portion:** no raw payload/customer/credential/free-form sensitive data appears in events, metric labels, health/Admin, logs, incidents, or alerts; list-like fields remain masked/bounded.
- [ ] **AC-37 operational portion:** requeue/dead-letter transitions emit exact safe events/metrics, health counts are current, and dead-letter work shows no mutation until successful reprocessing.
- [ ] **AC-38 operational portion:** ambiguous/unmatched/deferred Registry posture and runtime policy-blocked outcomes remain visible in bounded health/alerts while continuing to fail closed.
- [ ] Every required event emits on the correct success/failure/replay/conflict transition; every exact metric updates once with closed labels; all health counts and seven thresholds are deterministically correct.
- [ ] Admin is truthful, accessible, read-only, stale/error-safe, and policy-free.

## 11. Required tests and commands

Name focused tests with AC-31/35/37/38. Test the complete event catalog and after-commit/best-effort behavior; metric names/labels/cardinality/timing/replay; Mongo-derived health counts; all threshold boundary/window/recovery/dedupe cases; RingCentral projection; route auth/envelope/masking; and static/logger scans. Admin tests health parsing/rendering, units/states, refresh/staleness/error, accessibility, URL/nav, and absence of mutations/raw data.

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/services/granotLifecycle/metrics.test.ts src/services/granotLifecycle/operations.test.ts src/services/granotLifecycle/projections.test.ts src/services/granotLifecycle/observability.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/ringcentral/ringcentral-metrics.test.ts src/services/observability/operationalEventSanitizer.test.ts
TEST_MODE=true pnpm test:granot-lifecycle:replica -- --unit=30
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use landed filenames if different. Run with injected clocks and redacted fixtures; no external provider is required. Update lifecycle/RingCentral/observability behavior docs and applicable rules.

## 12. Live/staging verification

In a disposable synthetic environment, generate capture/queue/processing/case/discrepancy/command/activation/RingCentral transitions and assert each event, metric, health count, alert boundary/recovery, masked UI, and zero domain side effect from observation itself. Test alert delivery only with observability notifications disabled or provider sandbox/test recipient under separate authorization. Inspect bounded counts/codes/masked IDs—never payload/contact.

S21 operational live verification is read-only until separately approved: compare health to bounded Mongo counts and one normal operating interval. Stop on missing/double events, unbounded labels, inaccurate due/case/discrepancy count, false alert/recovery, lease exposure, sensitive text, instrumentation-caused failure, or any effect/email enablement.

## 13. Rollback

Disable the faulty event/alert evaluator or hide the Admin health view first; lifecycle capture/processing and committed work continue. Revert to the prior safe health projection if necessary. Do not disable capture to silence alerts and do not mutate operational/business history. Keep all lifecycle effect flags at their prior values; returning effects to shadow/off is the broader Section 39 fallback.

Preserve Operational Events/Incidents, receipts, Observations, Decisions, activation, links, cases/discrepancies, Commands, Changes, revisions, outbox, RingCentral state, and official facts. Never delete evidence or auto-resolve business work to make health green.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-30-COMPLETION.md` using Runbook Section 13. Include verified Units 01–29; both repos/branches; event catalog/metric labels/health DTO/threshold semantics/Admin files; ACs/invariants; migration `none` plus index verify; flags; exact focused/full/replica/Admin results; masked event/metric/alert/recovery/privacy/best-effort proof; final Git statuses; and external-action statement.

Successful implementation completes the operational half of S21 and unblocks Unit 31 after repository verification. It does not certify migrations/history/security, authorize rollout, or include optional email.
