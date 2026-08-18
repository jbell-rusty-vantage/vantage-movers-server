# Unit 15 completion — Temporal ordering, desired-state planning, and shadow processor orchestration

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 8.4, 10.3, 11–16, 25–27, 34.6, 35–37, 38/S09 planning/processor allocation, and 39–41
- **Acceptance ownership:** shadow/planning proof for AC-05–AC-13, AC-30, AC-31, and AC-32. Unit 18 owns live matched-write completion; Unit 19 owns creation; Units 22+ own Booking/Release behavior.
- **Applicable invariants preserved:** 1 (Mongo current state and revisions drive comparison), 2–3 (Granot evidence is not official Booking/Cancellation authority and creates no lifecycle enum), 5–6 (no reportable mutation / no causal command chain), 7 (no-op creates no `EntityChange` or Sheet Sync), 8–10 (provenance axes stay separate; immutable snapshots survive; source/origin/CPL never reassigned), 11 (Duplicate Form ineligible; Bad exact identity is Priority/link only), 12 (no reconciliation case open/refresh)
- **Runtime posture:** `PROCESSING=true`, `SHADOW=true`, all eight effect flags false. The processor consumes `resolveLeadIdentity`, plans desired state, and persists Receipt→Observation→Decision refs. Production never writes Lead business fields. Historical shadow may still create job-level Record Link evidence only.

## Files added or changed

### Temporal

- `src/services/granotLifecycle/granotTemporal.ts` — `compareGranotTemporal` and `olderTemporalWinnerFilter`
- `src/services/granotLifecycle/granotTemporal.test.ts`

### Planner

- `src/services/granotLifecycle/leadDesiredState.ts` — `planLeadDesiredState`, `evaluateMinimumCreationData`
- `src/services/granotLifecycle/leadDesiredState.test.ts`

### Processor / persistence

- `src/services/granotLifecycle/processor.ts` — identity → temporal → planner → eight-name gates → Decision; historical job-level Record Link preserved; injected-test metadata-only CAS
- `src/services/granotLifecycle/processor.test.ts`
- `src/services/granotLifecycle/processor.replica.test.ts`
- `src/services/granotLifecycle/sourcePolicy.ts` — gate snapshot uses real `operational_enabled` / `lifecycle_enabled` / `source_company_active` / `source_granularity_active`
- `scripts/test-granot-lifecycle-replica.ts` — `--unit=15` registration

### Docs / ledger

- `.cursor/businesslogic/granotLifecycle.desiredState.md` — new
- `.cursor/businesslogic/granotLifecycle.processor.md`
- `.cursor/businesslogic/granotLifecycle.sourcePolicy.md`
- `.cursor/businesslogic/granotLifecycle.identity.md`
- `.cursor/businesslogic/granotLifecycle.drainer.md`
- `.cursor/index.md`
- `.cursor/rules/granot-lifecycle-capture.mdc`
- `.cursor/rules/project-organization.mdc`
- `.cursor/rules/business-logic.mdc`
- `scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md`

`scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-17.md` was restored after an accidental working-tree delete; it is not a Unit 15 contract change.

## Exact contracts landed

### Temporal comparator

`GranotTemporalTuple = { captured_at, observation_id }`. Compare `captured_at` first. Equal times compare lowercase 24-character Observation ObjectId hex; greater wins. Missing stored winner is `newer`. Exact same tuple is `same`. Older is `stale` / `older_than_temporal_winner`. No source, channel, or Priority is encoded in the tuple.

`olderTemporalWinnerFilter` accepts **only an older stored tuple**. It does not invent `$or: [field missing]`. Tests seed an existing older winner before CAS.

### Desired-state planner

`planLeadDesiredState` returns a deterministic in-memory plan. Routes and clients never supply it. Decisions persist target/candidates, reason, gate snapshot, and allowed effect summaries — never contact values.

| Rule | Behavior |
| --- | --- |
| Job Number | fill missing when normalized values agree; conflict never overwrites |
| Priority | every temporally accepted valid Priority plans `granot_priority`; only `1`/`5` plan broad enrichment and `quoted=true`; never `quoted=false` |
| Malformed Priority Update | `invalid` / `invalid_priority_update` and plans nothing |
| Malformed Priority on Lead Created/Booked/Release | skip Priority and continue independent action |
| Agent | fill empty receiver at any valid Priority from one Unit 14 Agent via `granot_username_match`; check `identity.agent` presence (assertion `"single"` without an Agent does not fill); conflicts/existing receiver never overwrite |
| WordPress Form | primary contact + ingested snapshots never enter `changed_paths`; Granot contact → `granot_contact_snapshot` only; qualified move plans current fields + derived `local`; never `move_size` |
| RingCentral / Granot-created | qualified contact/move become current + bounded `last_granot_contact_change.changed_paths`; no EntityChange claimed |
| Duplicate Form | no target |
| Bad Form | Priority only |
| Forbidden paths | source/origin/CPL/booking/cancel/`move_size`/ingested snapshots/money never enter `desired_values` |

### No-match and minimum data

- `link_only` no-match: `pending_match` / `pending_source_scoped_match` with `next_match_attempt_at` until the Unit 08 24h clock, then `unmatched` / `match_window_expired`
- Incomplete immutable creation data: terminal `insufficient_creation_data` with exact `missing_creation_job_number`, `missing_creation_contact`, or `missing_creation_route_data`; never pending
- Form minimum data: normalized Job, deterministic route, name component, normalized phone, valid origin/destination state and 5-digit ZIP
- Call may be Job-only for future authorized creation; telephony fields are never fabricated
- `create_if_missing` eligible stays `shadow_effect_suppressed` with no `created` claim
- `observation_only` stays `creation_policy_observation_only`

### Processor orchestration

```text
load receipt -> upsert/reuse Observation -> classify stored execution mode
-> terminal normalization -> resolve Registry policy -> Unit 14 identity
-> temporal compare -> desired-state plan -> evaluate exact gates
-> persist one Decision for observation/attempt -> finalize through Unit 08 fence
```

- Receipt `initiator` is threaded; webhook may omit it. Processor actor is always `{ actor_type:"system", actor_id:"granot-lifecycle-processor", origin:"granot_lifecycle", request_id: receiptId }`. Clients never supply it.
- Historical shadow + agreeing Job/scope still establishes/confirms **job-level** Record Link. It does not add `lead_ref`, `booking_ref`, source scope, or disputed state.
- Live shadow persists Decisions only. No-match is `pending_match`. Matched effect-bearing plans become `shadow_effect_suppressed`.
- Same observation/attempt with identical causal meaning replays. Different meaning is `DecisionIntegrityError`.
- Technical dependency failures create no Decision.
- `applied` / `created` are never persisted from this unit.

### Temporal compare-and-swap seam

Invoked only when `execution_mode === "live"` **and** `lead_writes_enabled` **and** the plan is `already_current` with `temporal_winner_should_advance`. Metadata-only `$set last_accepted_granot_observation`. No `domain_revision` increment, no `last_change_*`, no EntityChange, no Sheet Sync, no `lead_updated`. Zero matched rows abort the proposed Decision, reload the Lead, re-evaluate, and persist the loser (normally `stale`). Production shadow never invokes this write.

### Gate snapshot

Eight names, stable order, real policy facts (not Boolean id-presence approximations):

```text
global_effect_flag
post_activation_live_mode
operational_enabled
lifecycle_enabled
disposition_permits_effect
source_company_active
source_granularity_active
policy_permits_effect
```

### Shadow zero-effect inventory

| Effect | Historical shadow | Live shadow | Production flags |
| --- | --- | --- | --- |
| Receipt / Observation / Decision | yes | yes | yes |
| Job-level Record Link establish/confirm | yes, Job/scope agree | no | historical only |
| `lead_ref` / target-link mutation | no | no | no |
| Lead business fields | no | no | no |
| Temporal winner metadata | no | no (test `live` + writes only) | no |
| EntityChange / Sheet Sync / Command | no | no | no |
| Booking / Cancellation / cases | no | no | no |
| Notifications / external send | no | no | no |

## Prerequisite migration / index verification

**None applied by this unit.** Consume verified Unit 07/12/13 contracts:

- Seven non-unique Lead S08 indexes remain declared
- Unit 07 active Record Link unique index remains the job-level lookup contract
- Unit 12 origin/snapshot/temporal-winner fields are consumed; this unit adds no persistent field

Replica proofs used `testvantagemovers` (`TEST_MODE=true` and `SHEET_SYNC_MODE=disabled` in the process environment only; `.env` was not edited). No production report/apply/index create.

## Flags before / after

`.env` does not set the ten Unit 07 lifecycle flags (only `GRANOT_LIFECYCLE_REPLICA_TESTS=true`). Effective defaults, unchanged:

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

No activation write. No later effect enabled. Historical receipts remain historical forever; live-shadow Decisions are never replay-promoted.

## Verification

### Focused

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/granotTemporal.test.ts" "src/services/granotLifecycle/leadDesiredState.test.ts" "src/services/granotLifecycle/processor.test.ts" "src/services/granotLifecycle/schedules.test.ts" "src/config/domain/granotLifecycle.test.ts"
```

**51 pass / 0 fail / 1 skipped** (opt-in replica inside `processor.test.ts`).

### Replica

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=15
```

**2 pass / 0 fail.** Disposable replica `testvantagemovers`. One winner advances `last_accepted_granot_observation` without `domain_revision` / EntityChange / Sheet outbox. Concurrent equal-time race keeps one Lead winner (greater ObjectId); a sequential older observation is `stale`. Zero-write collections checked: `entity_changes`, `sheet_sync_jobs`, `domain_command_executions`, `booked_leads`, `cancelled_leads`. Results recorded outcome/reason and masked IDs only.

### Typecheck and whitespace

```text
pnpm typecheck
git diff --check
```

- `pnpm typecheck`: pass
- `git diff --check`: pass after removing one trailing-whitespace line in `granotLifecycle.processor.md`

### Full repository

```text
NODE_OPTIONS=--max-old-space-size=8192 pnpm test
```

- `pnpm test`: **1253 tests, 1225 pass, 0 fail, 28 skipped** (ran with `NODE_OPTIONS=--max-old-space-size=8192` after an earlier default-heap OOM in unrelated files)

## AC-to-proof coverage

| AC | Assertion | Proof |
| --- | --- | --- |
| AC-05 | All listed Priority forms canonicalize; only 1/5 enrich and set `quoted=true`; never false | `leadDesiredState.test.ts` |
| AC-06 | Malformed Priority Update is invalid; Lead Created/Booked/Release skip Priority and continue | planner + `processor.test.ts` |
| AC-07 (shadow/planner) | Matched Lead Created selects one target and never plans a second Lead | planner + processor |
| AC-08 (foundation) | Eligible `create_if_missing` stays `shadow_effect_suppressed`; incomplete data is exact `insufficient_creation_data`; no reservation | planner + processor |
| AC-09 (foundation) | Local vs long-distance route result controls Form minimum-data eligibility; invalid/missing states never plan creation | `leadDesiredState.test.ts` (route facts from Unit 14/05) |
| AC-10 | WordPress primary contact and immutable snapshot never enter `changed_paths` | planner |
| AC-11 | Immutable move snapshot and Vantage `move_size` stay unchanged while qualified current move is planned | planner |
| AC-12 (planner) | Call/Granot-created qualified contact plans current fields + bounded summary; no Change claimed | planner |
| AC-13 (planner) | Empty receiver fills from one active Agent at non-1/5; conflicts/existing receiver never overwrite | planner |
| AC-30 | Exact schedule reaches terminal unmatched at 24h; incomplete creation data is not pending | planner + processor + existing `schedules.test.ts` |
| AC-31 | Pre-activation stays historical with zero live effects; live-shadow is never promoted | `processor.test.ts` + `granotLifecycle.test.ts` |
| AC-32 (no-op/shadow) | No-op creates no Change/Sheet; shadow produces Receipt→Observation→Decision and zero forbidden effects | temporal + planner + processor + replica CAS |
| Concurrent CAS | Loser re-evaluates; metadata-only winner advances without revision/Change/outbox only in explicit live test posture | `processor.test.ts` + `processor.replica.test.ts` |

## Privacy / concurrency / replay

- Decision metrics use bounded enum labels only (`AC-35` portion)
- Planner/processor tests use synthetic IDs and fixture phones; contact values are not persisted on Decisions
- Same observation/attempt replays; differing stored Decision is `DecisionIntegrityError`
- Replica uniqueness for this unit is temporal winner CAS, not a new index
- Memory processor tests inject `pending_match` identity by default so Unit 07 historical job-link proofs still pass; historical job-link takes precedence over pending/already_current/applied/shadow-suppressed and is refused for invalid/unsupported/conflict/ambiguous/deferred/source-disabled

## Known risks / deferred compatibility

- `pnpm granot:lifecycle:shadow -- --limit=<n> [--after-id=<id>]` is **Unit 31**. This unit proved the same bounded Module behavior in the Unit 15 harness and did not invent a migration or production run.
- `LeadDesiredStatePlan` is issue-author internal guidance and is not persisted.
- Concurrent equal-time CAS can yield two `already_current` Decisions if the greater ObjectId overwrites after the lesser already persisted; the Lead still has one winner, `domain_revision` is unchanged, and a later older observation is `stale`.
- Call destination zip is read from `delivery_zip`; Form uses `destination_zip`.
- `local` is `"local" | "long_distance"`, derived from accepted current USPS state codes.
- Units 16 and 17 must call this processor and must not reconstruct patches or desired state.
- Live matched writes, target-link mutation, and `applied` remain Unit 18. Authorized creation remains Unit 19.

## Newly unblocked

**Units 16 and 17** may proceed in parallel under their contracts. Unit 16's contract is complete. Unit 17 remains a scaffold. Neither can provide the parity approval required by Unit 18 until implementation and cross-channel proof are complete.

S09 is complete (Unit 14 identity + Unit 15 planning/processor).

## External-action statement

No commit, push, deploy, production mutation, live-payload inspection, migration apply, flag enablement, or external send occurred.

## Final `git status --short`

`vantage-main-server` / `granot-lead-lifecycle` only. Other program repositories were not touched.

```text
 M .cursor/businesslogic/granotLifecycle.drainer.md
 M .cursor/businesslogic/granotLifecycle.identity.md
 M .cursor/businesslogic/granotLifecycle.processor.md
 M .cursor/businesslogic/granotLifecycle.sourcePolicy.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/project-organization.mdc
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/services/granotLifecycle/processor.test.ts
 M src/services/granotLifecycle/processor.ts
 M src/services/granotLifecycle/sourcePolicy.ts
?? .cursor/businesslogic/granotLifecycle.desiredState.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-15-COMPLETION.md
?? src/services/granotLifecycle/granotTemporal.test.ts
?? src/services/granotLifecycle/granotTemporal.ts
?? src/services/granotLifecycle/leadDesiredState.test.ts
?? src/services/granotLifecycle/leadDesiredState.ts
?? src/services/granotLifecycle/processor.replica.test.ts
```
