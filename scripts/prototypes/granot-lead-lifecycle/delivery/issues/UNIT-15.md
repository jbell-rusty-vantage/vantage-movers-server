# Unit 15 — Temporal ordering, desired-state planning, and shadow processor orchestration

> **Contract maturity: implementation-ready; implementation remains blocked by Unit 14 and the shared-branch sequence.** This is the planning/processor half of S09. It makes the production processor channel-neutral and decision-complete in historical/live shadow while every domain effect remains disabled.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 8.4, 10.3, 11–16, 25–27, 34.6, 35–37, 38/S09, and 39–41.
- **Acceptance ownership:** shadow/planning proof for AC-05–AC-13, AC-30, AC-31, and AC-32. Unit 18 owns live matched-write completion; Unit 19 owns creation; Units 22+ own Booking/Release behavior.
- **Approved split:** Unit 15 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Consume Unit 14 identity without duplicating it. Preserve Unit 07 Decision/activation/job-link evidence and Unit 08 drainer/lease/retry contracts. Unit 18 later invokes canonical matched-Lead effects.
- **Execution:** delivery runbook, verified Unit 07–08/12–14 handoffs, current processor/drainer/source-policy code, Lead provenance schemas, actual flags/indexes, and applicable repository rules/docs.

The final specification wins. Shadow Decisions describe the result the common processor reached; they are never promoted into later effects. No channel outranks another.

## 2. Objective

Implement origin-specific desired-state planning, exact temporal ordering, Priority/Agent/minimum-data behavior, no-op comparison, pending/unmatched classification, gate snapshots, and Unit 14 identity integration through `GranotObservationProcessor`. Prove stale/CAS/replay behavior and a live-capable temporal-metadata-only `already_current` seam, while the deployed starting/ending posture remains shadow with Lead writes/creation/cases false and zero reportable aggregate effects.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** Units 07–08 and 14. Unit 14 is itself blocked through Unit 13; verify the complete chain rather than relying on the ledger.
- Reverify Unit 07 Decision/Activation/Record Link models and processor replay, Unit 08 claim/fence/schedules, Unit 12 provenance fields, Unit 13 index/migration state, and Unit 14 result/query contract.
- A local mutation/concurrency proof requires `TEST_MODE=true`, an explicit disposable replica-set database, lifecycle test flags only, and disabled external effects. Do not activate production, enable flags, apply migrations, commit, push, deploy, inspect live payloads, or send external work.

## 4. Current-state evidence to verify

Observed on 2026-08-17; reverify after prerequisites:

- `processor.ts` currently normalizes, resolves source policy, snapshots a Lead-link gate, and may establish/refresh job-level Record Link evidence in historical shadow. It does not resolve a Lead, plan desired state, compare temporal winners, or use `initiator`.
- Current shadow outcomes collapse eligible work to `historical_shadow`/`shadow_effect_suppressed`; candidate/target/match reasoning is incomplete.
- `sourcePolicy.ts` already emits the ordered eight-name gate snapshot. Preserve its vocabulary/order and pass real policy/scope facts rather than Boolean presence approximations.
- Unit 08 owns the exact immediate→24h schedule and fenced synchronous/drainer entry. Its handoff identifies a known gap: terminal pending match can complete without an `unmatched` Decision. This unit closes that gap in processor business classification, not by rewriting lease code.
- No `leadDesiredState.ts` exists at this checkpoint. Lead provenance/temporal fields are Unit 12 prerequisites.
- Unit 07 job-level historical links may lack `lead_ref`; do not mutate them into target links in this unit. Unit 18 owns target link establish/confirm with canonical Lead effects.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo current state and revisions drive comparison.
- **Invariant 2–3:** Granot evidence does not create official Booking/Cancellation facts or a lifecycle enum.
- **Invariant 5–6:** any future reportable mutation is canonical and causally atomic; this unit invokes none.
- **Invariant 7:** no-op desired state creates no `EntityChange` or Sheet Sync.
- **Invariant 8–10:** provenance remains separate, immutable snapshots survive, and source/origin/CPL never change.
- **Invariant 11:** Duplicate Form is ineligible; Bad exact identity is Priority/link evidence only.
- **Invariant 12:** this unit never opens/refreshes reconciliation cases.

## 6. Deliverables and exact contract

### 6.1 Pure temporal comparator

Add a shared pure comparator in the lifecycle domain:

```ts
type GranotTemporalTuple = { captured_at: Date; observation_id: string };
type GranotTemporalOrder = "newer" | "same" | "older";
```

- Compare `captured_at` first. Equal times compare lowercase 24-character Observation ObjectId hex lexicographically; greater wins.
- Missing stored winner means `newer`. Exact same tuple is `same`/replay, never a second effect.
- Older yields `stale/older_than_temporal_winner`, no desired-state effect, winner update, revision, Change, outbox, link target update, case, or notification.
- No source/channel/Priority outranks the tuple.

### 6.2 Desired-state planner

Create `src/services/granotLifecycle/leadDesiredState.ts`. It accepts persisted Observation, Unit 14 result, current Lead projection, policy/origin, and temporal order. It returns a deterministic plan—not a database patch supplied by a route/client—with:

```ts
type LeadDesiredStatePlan = {
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  target?: EntityRef;
  desired_values: Record<string, unknown>;
  changed_paths: string[];
  agent_changed_paths: string[];
  temporal_winner_should_advance: boolean;
  creation_eligibility?: "not_applicable" | "eligible" | "insufficient";
};
```

This shape is **issue-author internal-interface guidance**; never persist contact values inside a Decision. Persist only target/candidates, reason, gate snapshot, and effect summaries allowed by Section 11.

Planner rules:

- Fill missing Job Number and establish identity only when normalized values agree; conflict never overwrites.
- Every temporally accepted valid Priority plans `granot_priority`. Only canonical `1`/`5` plans broad enrichment and `quoted=true`; no Priority plans false.
- Missing/malformed Priority Update is `invalid/invalid_priority_update` and plans nothing. The same issue on Lead Created/Booked/Release skips Priority but continues its independent action. Unit 15 does not open action cases.
- A Unit 14 Agent suggestion may fill only an empty receiver at any valid Priority, using `granot_username_match`; differing `user`/`rep`, zero/multiple Agent, or existing receiver produces no receiver change.
- WordPress Form: primary submitted name/phone/email and both ingestion snapshots are immutable; qualified Granot contact updates `granot_contact_snapshot` only; qualified move/location/date/cubic feet may update current operational fields and derived `local`; never overwrite Vantage `move_size`.
- RingCentral-created Call and Granot-created Form/Call: qualified contact/move becomes current; preserve creation snapshots and RingCentral original caller evidence; maintain bounded contact revision summary while full later history belongs to Unit 18 `EntityChange`.
- `granot_move_size`/`granot_service_type` are separate from Vantage `move_size`. Source Company, Source Granularity, Ingestion Origin, CPL, Booking/Cancellation refs, and official facts never enter `desired_values`.
- Bad exact Form target permits only valid Priority plus safe link evidence; Duplicate Form has no target/effect plan.
- Sort/deduplicate `changed_paths` deterministically. Compare canonical semantic values so equivalent formatting does not manufacture a change.

### 6.3 Lead Created/no-match planning

- Matched eligible Lead Created follows the same planner and can describe link/enrichment without creating a second Lead.
- `link_only`: no match is `pending_match/pending_source_scoped_match` until the exact Unit 08 schedule reaches 24h; persist `next_match_attempt_at`. At/after 24h return `unmatched/match_window_expired` and complete.
- Incomplete immutable creation data is terminal `insufficient_creation_data` with exact `missing_creation_job_number`, `missing_creation_contact`, or `missing_creation_route_data`; never schedule pending match for incompleteness.
- `create_if_missing`: evaluate the Section 16.3 minimum-data contract and route/gates in shadow. Eligible creation remains suppressed (`shadow_effect_suppressed`) with no `created` claim/effect; Unit 19 owns creation. Incomplete data returns the terminal insufficient result above.
- `observation_only`, deferred, disabled, or invalid policy stays evidence-only using exact policy outcome/reason.
- Minimum Form creation facts: normalized Job, active deterministic route, name/display component, normalized phone, and valid origin/destination state/ZIP sufficient for exact Form Granularity. Call may be Job-only only as future authorized canonical creation; do not fabricate telephony fields.

### 6.4 Processor orchestration and Decision

Replace the Unit 07 planning core, preserving its public Section 25 interface:

```text
load receipt -> upsert/reuse Observation -> classify stored execution mode
-> terminal normalization -> resolve Registry policy -> Unit 14 identity
-> temporal compare -> desired-state plan -> evaluate exact gates
-> persist one Decision for observation/attempt -> finalize through Unit 08 fence
```

- Pass receipt `initiator` through the Module context for later commands; webhook may omit it. Never let a client provide the processor system actor.
- Decision records exact match method, target/candidate refs, source scope, ordered gate snapshot, outcome/reason, `next_match_attempt_at`, and zero effect rows unless safe job-level Record Link establish/confirm actually occurs.
- Preserve Unit 07 safe job-level historical Record Link behavior only when Job/scope agree. Do not add/replace `lead_ref`, `booking_ref`, source scope, or disputed state here.
- Historical shadow may normalize, decide, and create that safe link evidence only. Live shadow creates Decisions only. Both forbid Lead/Booking/Cancellation mutation, target-link mutation, cases/discrepancies, Commands, Changes, outbox, notifications, and external sends.
- Same observation/attempt with identical causal meaning replays the stored result. Different meaning is `DecisionIntegrityError`; never overwrite.
- Technical dependency failures create no Decision and remain Unit 08 technical retries.

### 6.5 Temporal compare-and-swap seam

Implement/test the Section 11 transaction seam for a newer Observation whose authorized desired state is otherwise current:

- In injected `live` + Lead-writes-enabled test posture only, atomically insert `already_current/desired_state_already_current` Decision and advance `last_accepted_granot_observation` with a filter accepting only an older `(captured_at, observation_id)` tuple.
- This metadata-only write does **not** increment `domain_revision`, write `last_change_*`, create `EntityChange`, request Sheet Sync, or emit `lead_updated`.
- Zero matched rows aborts the proposed Decision, reloads, and re-evaluates; the loser normally becomes `stale`. Never persist `already_current`/`applied` for a claim it did not win.
- Production starting/ending shadow posture must never invoke this Lead write. Unit 18 later enables reviewed live matched effects and owns changed-field command transactions.

### 6.6 Documentation

Update processor/source-policy/Lead lifecycle docs and rules with temporal tuple, origin authority matrix, no-op semantics, pending terminal behavior, shadow forbidden effects, and Unit 18 handoff boundary.

## 7. Explicitly out of scope

- Mutating desired Lead fields, target Record Links, `EntityChange`, Sheet Sync, or enabling matched writes (Unit 18).
- Creating Leads or switching Registry to `create_if_missing` (Unit 19).
- Extension/automation adapters (Units 16–17), RingCentral adoption, Booking/Release cases or commands, Referral, discrepancies, Admin UI, notifications, rollout, or cleanup.
- Reimplementing Unit 14 identity, Unit 08 lease/retry machinery, Unit 12 schemas, or Unit 13 migrations.

## 8. Flags and runtime posture

Starting and ending values:

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

An activation row is not written by this issue. Historical receipts remain historical forever; live-shadow Decisions are never replay-promoted.

## 9. Migration and indexes

**None.** This unit adds no persistent field/index. Consume verified Unit 07/12/13 contracts. Historical shadow execution uses the existing fixed command:

```text
pnpm granot:lifecycle:shadow -- --limit=<n> [--after-id=<id>]
```

If Unit 31 has not yet implemented that CLI, prove the same bounded production-Module behavior with the Unit 15 test harness and state the deferred command; do not invent a migration or production run.

## 10. Acceptance criteria

- [ ] **AC-05:** all listed Priority forms canonicalize/store in desired state; only 1/5 broadly enrich/set true; never false.
- [ ] **AC-06:** malformed Priority Update is invalid; independent Lead Created/Booked/Release behavior survives malformed Priority without Priority effects.
- [ ] **AC-07 (shadow/planner):** matched Lead Created selects one target, never plans a second Lead, and describes only authorized link/enrichment.
- [ ] **AC-08 (foundation):** eligible `create_if_missing` passes minimum data but remains shadow-suppressed; incomplete data is exact `insufficient_creation_data`; no Lead/link reservation occurs.
- [ ] **AC-09 (foundation):** Local/long-distance route result controls minimum-data eligibility; invalid/missing states never plan creation.
- [ ] **AC-10:** WordPress primary contact/immutable snapshot never enters changed paths; Granot contact stays separate.
- [ ] **AC-11:** immutable move snapshot/Vantage move size stay unchanged while qualified current move plan is exact.
- [ ] **AC-12 (planner):** Call/Granot-created qualified contact plans current/bounded summary; no Change is falsely claimed before Unit 18.
- [ ] **AC-13 (planner):** empty receiver fills from one active assertion at non-1/5; conflicts/existing receiver never overwrite.
- [ ] **AC-30:** exact schedule reaches terminal unmatched at 24h; incomplete creation data is not pending.
- [ ] **AC-31:** pre-activation stays historical with zero live effects; live-shadow is never promoted.
- [ ] **AC-32 (no-op/shadow):** no-op creates no Change/Sheet work; shadow produces Receipt→Observation→Decision refs and zero forbidden effects. Complete mutation chain remains Unit 18.
- [ ] Concurrent temporal losers re-evaluate; metadata-only already-current advances winner without revision/Change/outbox only in explicit live test posture.

## 11. Required tests and commands

- Pure tests: temporal comparator/tie, authority matrices, Priority, desired-state equality/paths, minimum data, and exact pending clock.
- Production Module tests: every origin, Bad/Duplicate, malformed Priority independent action, replay/integrity failure, historical/live shadow, candidate/gates, terminal unmatched, and zero forbidden effects.
- Replica-set tests: temporal CAS one-winner, reload/re-evaluate stale loser, atomic metadata-only Decision+winner, and no revision/Change/outbox.

Run exactly:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/leadDesiredState.test.ts" "src/services/granotLifecycle/processor.test.ts" "src/services/granotLifecycle/schedules.test.ts" "src/config/domain/granotLifecycle.test.ts"
pnpm test:granot-lifecycle:replica -- --unit=15
pnpm test
pnpm typecheck
```

## 12. Live/staging verification

- With redacted synthetic receipts and a disposable replica set, run bounded historical and live-shadow processing for all source/origin/event/outcome families.
- Record counts by source family/event/outcome/reason/match method, masked IDs, checkpoint, and exit results only.
- Prove zero Lead/Booking/Cancellation business-field changes, target-link changes, cases, discrepancies, Commands, Changes, outbox, notifications, or sends. Production remains read-only/separately approved.

## 13. Rollback

- Disable `GRANOT_LIFECYCLE_PROCESSING_ENABLED` first; capture continues and work remains durable. If only a new caller is faulty, remove that caller while keeping evidence.
- Preserve receipts, Observations, Decisions, activation, links, aggregates, and all official facts. Never delete shadow Decisions or reset temporal/revision history.
- Do not replay shadow into live or restore a legacy patch planner as rollback.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-15-COMPLETION.md` per Runbook Section 13 with:

- files grouped by temporal/planner/processor/persistence/docs;
- Sections 11/15–16/25–27, invariants 1–12 as applicable, S09 planning allocation, and AC-05–13/30–32 mapping;
- authority matrix, temporal/CAS contract, pending timeline, gate snapshot, outcomes, shadow zero-effect inventory, and partial/live AC labels;
- flags, migrations/index `none`, focused/full/replica results, masked shadow evidence, final status, and external-action statement.

Successful implementation completes S09 and unblocks **Units 16 and 17** for parallel contract-permitted implementation. Both must call this processor and may not reconstruct patches or desired state.
