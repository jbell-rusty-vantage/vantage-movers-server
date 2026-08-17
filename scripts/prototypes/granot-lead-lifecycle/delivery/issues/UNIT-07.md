# Unit 07 — Decision, activation, Record Link, execution mode, and safe operational skeleton

> **Contract maturity: implementation-ready once Units 04–06 are complete.** This is S05. It adds explainable Decisions, write-once activation, job-level Record Link evidence, execution-mode classification, a deliberately narrow historical-shadow processor foundation, and raw-free Job/health reads. It does not match or mutate a Lead, run durable claims/retries, open cases, or create official facts.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 11, 13, 25, 27, 28.2 plus activation/error portions of 28.3–28.4, 33–36, 37.1–37.2, 38/S05, and 39–40.
- **Acceptance ownership:** Decision-causality portion of AC-02; execution-mode/activation foundation of AC-31; Record Link causal/absence-of-forbidden-effect portion of AC-32; model, route, projection, log, and audit privacy portion of AC-35. AC-02 cross-channel replay, AC-31 certification, AC-32 canonical mutation chain, and later full timelines remain owned by later units.
- **Approved split:** Unit 07 entry in `lead_lifecycle_issue_breakdown_reccomendation.md`; do not pull Unit 08 durable work or Units 14–15 identity/desired-state behavior forward.
- **Predecessors:** verified Unit 04 Observation/normalization, Unit 05 source-policy/gate service, and Unit 06 reviewed source data/automation compatibility completion reports plus repository state.
- **Canonical language/execution:** workspace `CONTEXT.md`, repository instructions, and delivery runbook.

The final specification wins. This unit may persist safe job-level evidence only within the explicit boundary below. It cannot invent a Lead target, Source Scope, desired state, provider occurrence time, or official Booking/Cancellation fact.

## 2. Objective

Introduce the durable evidence and operational foundation required to explain processing before effects: exact `SynchronizationDecision`, `GranotLifecycleActivation`, and `GranotRecordLink` models/indexes; deterministic historical/live-shadow/live classification; an Owner-only write-once activation command; a narrow processor that turns normalized/reviewed evidence into one causal shadow Decision and, only when safe, one job-level Record Link; and protected raw-free Job/health projections that make flags, activation, evidence, and outcomes inspectable.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** Units 04–06.
- Verify predecessor completion reports against current models, index catalog, tests, migration status, flags, and source classifications. In particular, prove one Observation per receipt and Unit 05/06 fail-closed exact source policy before processing any receipt.
- Reverify `GranotObservationReceipt.processing`, `GranotObservation`, shared lifecycle unions, Unit 03 capture/queue wake-up seam, Operations Registry trusted actor parsing, observability service, API guard/mount patterns, and current index migration helpers.
- Confirm local writes use `TEST_MODE=true`, the test database, replica-set Mongo, and disabled external Sheet/CRM effects before integration tests.
- No commit, push, deploy, production activation, production index apply, current payload inspection, Granot call, or external send without separate authorization.

## 4. Current-state evidence to verify

Observed on 2026-08-17; implementation must reverify after Units 04–06 land:

- Shared `SynchronizationOutcome`, `SynchronizationReasonCode`, `ExecutionMode`, `EntityRef`, source disposition, and Booking Action unions are frozen in `src/services/granotLifecycle/types.ts`.
- Unit 02 supplies channel-neutral receipt work state and shared named index report/apply/verify tooling; Unit 03 is landing authenticated capture and receipt-ID-only queue wake-up; no lifecycle consumer/drainer exists yet.
- No production `SynchronizationDecision`, `GranotLifecycleActivation`, or `GranotRecordLink` model exists.
- No `src/config/domain/granotLifecycle.ts`, `processor.ts`, lifecycle Admin router/validation module, Job projection, or lifecycle health projection exists.
- `metrics.ts` currently covers only the capture seam; full Section 33 metrics/alerts are Unit 30, but this unit must add bounded Decision/activation evidence needed by its own safe health skeleton.
- `src/app.ts` mounts separate protected operational routers and `v1.routes.ts`; keep the new lifecycle Admin router focused and behind the existing `/api/v1` guard.
- The lifecycle index tool currently starts from receipt indexes and is designed to be extended; all new unique indexes need collision reports before create.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** MongoDB is System of Record for Decisions, activation, and Record Links.
- **Invariant 2:** Observations/Decisions/Record Links are evidence, not authority for official Booking/Cancellation facts.
- **Invariant 3:** execution mode is per-attempt operational state; do not create a Lead lifecycle enum.
- **Invariant 4:** a job-level link cannot create or imply a second Booking; official Booking identity remains later work.
- **Invariant 5:** no Lead/Booking/Cancellation mutation or canonical business command occurs in this unit.
- **Invariant 6:** no post-activation aggregate effect may bypass Command/Change/revision/outbox foundations. Therefore Unit 07 persists Record Link establishment/refresh only for permanently `historical_shadow` evidence; post-cutoff `live_shadow`/`live` attempts record a Decision but do not mutate a Record Link until later foundations are present.
- **Invariant 7:** every accepted no-op/shadow path creates no `EntityChange` or Sheet Sync intent.
- **Invariant 8:** receipt channel, source system, execution mode, processor actor, and initiator remain separate.
- **Invariant 9:** Decisions and links reference immutable evidence; projections never overwrite or expose it.
- **Invariant 10:** a Record Link never changes a Lead's Source Company, Source Granularity, Ingestion Origin, or CPL.
- **Invariant 11:** this skeleton performs no contact matching and cannot select Duplicate/Bad Form Leads.
- **Invariant 12:** no reconciliation case exists in this unit.

## 6. Deliverables and exact contract

### 6.1 `SynchronizationDecision`

Add `src/models/SynchronizationDecision.ts` with the exact Section 11 shape:

```ts
type SynchronizationDecisionDocument = {
  _id: ObjectId;
  observation_id: ObjectId;
  attempt: number;
  execution_mode: ExecutionMode;
  outcome: SynchronizationOutcome;
  reason_code: SynchronizationReasonCode;
  match_method?:
    | "granot_record_link"
    | "form_ref_no_exact"
    | "form_mongo_id_compatibility"
    | "call_job_no_exact"
    | "booking_job_no_exact"
    | "source_scoped_contact";
  target?: EntityRef;
  source_scope?: {
    granot_crm_source_id: ObjectId;
    lead_source_company: ObjectId;
    source_granularity_id: ObjectId;
    disposition: GranotLifecycleDisposition;
    policy_version: string;
  };
  candidates: Array<{ target: EntityRef; reason_codes: string[] }>;
  evaluated_gates: Array<{ gate: string; allowed: boolean }>;
  effects: Array<{
    kind:
      | "record_link_established"
      | "record_link_confirmed"
      | "lead_created"
      | "lead_updated"
      | "booking_case_opened"
      | "booking_case_refreshed"
      | "release_case_opened"
      | "release_case_refreshed"
      | "discrepancy_opened"
      | "discrepancy_refreshed"
      | "sheet_sync_requested";
    ref?: EntityRef;
    changed_paths?: string[];
  }>;
  next_match_attempt_at?: Date;
  decided_at: Date;
};
```

Validation and persistence rules:

- `attempt` is an integer >= 1. Unit 07 uses the current receipt business attempt (`processing.match_attempt + 1`); Unit 08 later owns advancing it.
- Defaults are explicit empty arrays for `candidates`, `evaluated_gates`, and `effects`; never store copied contact/source payload values.
- `target` and candidate refs validate against frozen `EntityRef`. Unit 07 never emits a Lead/Booking/case target or candidate because matching is later.
- `effects` may contain only causal `record_link_established`/`record_link_confirmed` in this unit; every other effect kind must remain absent.
- Insert is immutable in business meaning. Repeating the same observation/attempt returns the existing Decision only when its causal inputs/result agree; a differing candidate is an integrity failure, not an overwrite.
- A technical dependency/database failure creates no Decision. Invalid/unsupported normalization is a business Decision only when normalization already persisted successfully.

Exact named indexes:

```ts
{ observation_id: 1, attempt: 1 } unique // synchronization_decision_observation_attempt_unique
{ outcome: 1, decided_at: -1 }          // synchronization_decision_outcome_decided
{ "target.model": 1, "target.id": 1, decided_at: -1 } // synchronization_decision_target_decided
{ "source_scope.granot_crm_source_id": 1, decided_at: -1 } // synchronization_decision_source_decided
```

### 6.2 `GranotLifecycleActivation` and execution mode

Add `src/models/GranotLifecycleActivation.ts` exactly:

```ts
type GranotLifecycleActivationDocument = {
  _id: ObjectId;
  key: "granot_lifecycle";
  activated_at: Date;
  activated_by: DurableActor;
  reason: string;
  processor_version: string;
  createdAt: Date;
};
```

Index `{ key: 1 }` is unique and named `granot_lifecycle_activation_key_unique`. The document is write-once: model/query guards reject update, replace, delete, and upsert-after-existence; no API delete/edit exists.

Add a pure execution-mode classifier that receives `captured_at`, optional activation, and current shadow flag:

- no activation -> `historical_shadow`;
- `captured_at < activated_at` -> permanently `historical_shadow` under every reprocessing/config state;
- `captured_at >= activated_at` and shadow true -> `live_shadow`;
- `captured_at >= activated_at` and shadow false -> `live`.

Equal timestamp is post-cutoff. Channel never affects mode. A stored Decision's mode is immutable and is never recomputed/promoted. A `live_shadow` Decision cannot later be replayed into effects; a new live Observation is required.

### 6.3 Owner-only activation command

Expose `POST /api/v1/admin/granot-lifecycle/activation` in a focused protected router. Strict input:

```ts
{
  reason: string;            // trim, 10..1000
  processor_version: string; // trim, 1..100, bounded safe identifier
}
```

The bounds are narrow **issue-author guidance** because the final specification requires both values but does not publish HTTP bounds.

- Require Owner plus trusted signed Admin actor. Server supplies `activated_at` from one injected clock and maps the verified actor to `DurableActor`; body cannot supply key/time/actor.
- In one replica-set transaction insert exactly one activation and one PII-safe activation Operational Event/audit record. Audit failure aborts activation.
- Return `201 { ok:true, data }` with safe activation projection. Any existing row, including concurrent/same-request retry, returns `409 GRANOT_ALREADY_ACTIVATED`; never edit/reuse/delete it.
- Emit bounded activation metric/event only after commit. Logs contain activation ID/time/version/request ID, not headers, reason text, payload, or actor email.
- Implement the command but do not invoke it outside local synthetic tests unless rollout activation is separately approved.

### 6.4 Central lifecycle flags

Add and barrel-export `src/config/domain/granotLifecycle.ts`. Parse only explicit boolean vocabulary using existing config conventions; malformed configured values fail startup/validation closed. Defaults and Unit 07 ending posture are exactly:

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

Capture ignores these flags. Processing false makes the later claimant/drainer unavailable without changing due work. Unit 07 direct module invocation also refuses processing when false unless a pure test explicitly supplies config. No effect flag may be set true.

### 6.5 `GranotRecordLink`

Add `src/models/GranotRecordLink.ts` with the exact Section 13 shape:

```ts
type GranotRecordLinkDocument = {
  _id: ObjectId;
  provider: "granot";
  normalized_job_no: string;
  job_no_snapshot: string;
  state: "active" | "superseded";
  lead_ref?: { model: LeadModel; id: ObjectId };
  booking_ref?: ObjectId;
  source_scope?: { lead_source_company: ObjectId; source_granularity_id: ObjectId };
  disputed: boolean;
  dispute_reason?: string;
  established_by_decision_id: ObjectId;
  established_at: Date;
  last_observation_id: ObjectId;
  last_observed_at: Date;
  domain_revision: number;
  last_change_id?: ObjectId;
  last_changed_at?: Date;
  superseded_by?: ObjectId;
};
```

Exact named indexes:

```ts
{ provider: 1, normalized_job_no: 1 } unique partial { state:"active" }
  // granot_record_link_active_job_unique
{ "lead_ref.model": 1, "lead_ref.id": 1, state: 1 }
  // granot_record_link_lead_state
{ booking_ref: 1, state: 1 }
  // granot_record_link_booking_state
```

Model invariants:

- `provider="granot"`, `state="active"`, `disputed=false`, and `domain_revision=0` on establishment.
- Normalize Job Number with the existing canonical helper. `job_no_snapshot` is bounded point-in-time display evidence and must normalize back to `normalized_job_no`.
- `lead_ref`, `booking_ref`, `last_change_id`, `last_changed_at`, and `superseded_by` are absent in Unit 07. No Lead/Booking lookup occurs.
- `source_scope` is set only when Unit 05 returns one exact active company/granularity policy snapshot. Referral may establish a job-only link without Source Scope. Deferred, disabled, unclassified, ambiguous, or invalid policy establishes none.
- `disputed=true` remains findable by active Job lookup. Unit 07 proves model/query behavior with synthetic rows but does not mark/correct/supersede a conflict; Unit 29 owns correction and history.
- Never maintain an unbounded correction/history array.

### 6.6 Narrow processor foundation and causal persistence

Create `src/services/granotLifecycle/processor.ts` implementing the Section 25 `GranotObservationProcessor` interface and owning orchestration. Unit 07 behavior is intentionally limited:

1. Load receipt by ID and obtain/reuse its one Unit 04 Observation.
2. Determine attempt and immutable execution mode from receipt `captured_at`, activation, and flags.
3. Map persisted normalization terminal results exactly: an invalid Priority Update (`route_event_class="priority_updated"` with `invalid_priority`) -> `invalid`/`invalid_priority_update`; every other invalid Observation -> `invalid`/`invalid_payload`; unsupported Booking Action -> `unsupported`/`unsupported_booking_action`.
4. For valid evidence, call Unit 05 exact source-policy resolver. Persist `deferred`/`source_deferred` or `policy_blocked` with the exact applicable `source_unclassified`, `source_disabled`, inactive-target, or missing-route reason; never guess.
5. For eligible reviewed policy, snapshot every Unit 05 gate. With Unit 07 flags, the attempt remains non-effecting: historical mode uses outcome/reason `policy_blocked`/`historical_shadow`; post-cutoff shadow uses `policy_blocked`/`shadow_effect_suppressed`; an explicitly tested `live` configuration with all effects false uses `policy_blocked`/`global_effect_disabled`.
6. Only a valid, reviewed, `historical_shadow` Observation with a normalized Job Number may establish/confirm safe job-level Record Link evidence. Missing Job Number creates no link; later identity/creation logic owns its complete business outcome.
7. Persist Decision and a new historical link atomically with preallocated IDs so `established_by_decision_id`, Decision effect ref, receipt, and Observation form one causal chain. A duplicate-key race reloads the active link: compatible job/source evidence records `record_link_confirmed`; incompatible evidence records `conflict`/`record_link_conflict` and does not alter/mark/supersede the link.
8. A compatible existing historical link may atomically advance only `last_observation_id`, `last_observed_at`, and `domain_revision`; the paired Decision records `record_link_confirmed`. This pre-activation evidence refresh creates no `EntityChange`/Sheet work. No post-cutoff link mutation is permitted until later command/change foundations land.
9. A transaction/dependency failure creates neither partial Decision nor link and propagates as a technical failure for Unit 08.

The processor returns exact Section 25 fields. Unit 07 never returns a Lead/Booking target. Same observation/attempt replay returns the stored Decision/result and never duplicates a link. Distinct webhook receipts/Observations get distinct attempt-1 Decisions even when evidence hashes match; extension/automation operation identity replay remains Units 16–17.

### 6.7 Safe operational projections

Mount the focused router under the existing protected `/api/v1/admin` surface. Reads require Owner/Admin.

`GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no` normalizes/rejects the path and returns only:

```ts
{
  normalized_job_no: string;
  record_link?: {
    id: string; state: "active" | "superseded"; disputed: boolean;
    source_scope?: { lead_source_company:string; source_granularity_id:string };
    established_by_decision_id: string; established_at: string;
    last_observation_id: string; last_observed_at: string; domain_revision: number;
  };
  observations: Array<{
    id:string; receipt_id:string; kind:GranotObservationKind;
    normalization_result:NormalizationResult; captured_at:string;
    priority:{ canonical?:string; valid:boolean };
    booking_action?:GranotBookingAction; issue_codes:NormalizationIssueCode[];
  }>;
  decisions: Array<{
    id:string; observation_id:string; attempt:number; execution_mode:ExecutionMode;
    outcome:SynchronizationOutcome; reason_code:SynchronizationReasonCode;
    match_method?:string; target?:EntityRef; source_scope?:object;
    candidates:Array<{target:EntityRef;reason_codes:string[]}>;
    evaluated_gates:Array<{gate:string;allowed:boolean}>;
    effects:Array<{kind:string;ref?:EntityRef;changed_paths?:string[]}>;
    next_match_attempt_at?:string; decided_at:string;
  }>;
  capabilities: { complete_timeline:false; cases:false; official_facts:false };
}
```

`GET /api/v1/admin/granot-lifecycle/operations/health` initially returns:

- all ten flag names/booleans;
- safe activation presence/ID/time/processor version (no reason or actor PII);
- receipt counts by work state plus due/oldest-due timestamp/age using bounded aggregation;
- Decision counts by execution mode/outcome/reason for the last 24 hours;
- active/disputed Record Link counts; and
- `last_queue_run=null` and `last_cron_run=null` until Unit 08 owns them.

Both routes use `{ ok:true, data }`, bounded result limits/sorts, indexed queries, and strict Zod. Job observations contain no raw contact/move/source label/money/payload/header fields. No raw receipt endpoint is added. Unit 23 later expands the Job timeline with official facts/cases/changes; Unit 30 completes health/alerts.

### 6.8 Metrics, logging, and documentation

- Add bounded Decision counter labels exactly `{outcome,reason_code,channel}` and capture-to-decision timing; do not allow source label, Job Number, ObjectId, actor, or contact as metric labels.
- Emit PII-safe processing-completion and activation events. Unit 08 adds retry/dead-letter/requeue events; Unit 30 completes metrics/alerts.
- Log only causal IDs, modes, enum outcomes/reasons, attempts, and durations. No raw payload, normalized contact, source label, Job Number, activation reason, or signed headers.
- Update project organization and Granot lifecycle business documentation for model ownership, activation permanence, mode cutoff, historical-only safe links, projection masking, and later-unit boundaries.

## 7. Explicitly out of scope

- Unit 08 claim/fencing, consumer, cron, polling, retries, dead letter, manual requeue, queue/cron run telemetry.
- Unit 14 Form/Call/Booking identity ladders, contact matching, candidate lists, Bad/Duplicate rules, or target selection.
- Unit 15 temporal winner/desired-state planning and complete shadow processor; Units 16–17 extension/automation receipt apply.
- Unit 18+ Lead writes/creation, Record Link establishment in post-cutoff modes, canonical commands, Entity Changes, revisions, outbox/Sheet Sync, cases, discrepancies, corrections, or notifications.
- Lead/Booking/Cancellation lookup or mutation, official fact projection, full Job/Lead timeline, Admin lifecycle dashboard, or raw receipt/detail reads.
- Production activation/index apply, migration of existing receipts into Decisions/links, historical batch shadow command (Unit 31), or replay-promotion of shadow Decisions.
- Altering source policy/classifications from Unit 06 or widening frozen outcome/reason/effect vocabulary.

## 8. Flags and runtime posture

- **Starting posture:** no centralized lifecycle config; capture active; no processor runtime caller.
- **Ending posture:** processing `true`, shadow `true`, all eight Lead/creation/case/command/referral/email effect flags `false` exactly as Section 6.4.
- Activation command exists but activation row remains absent unless separately approved. Without it every receipt is permanently/currently `historical_shadow`.
- Direct module and later Unit 08 callers may process only safe shadow behavior. No flag may be broadened to make a test pass.
- Capture remains active when processing is disabled. Disabling processing preserves pending work, Observations, Decisions, links, and activation.

## 9. Migration and indexes

- **Data migration:** none. Do not create activation, backfill Decisions, batch-process receipts, or synthesize links.
- Extend `migration:granot-lifecycle:indexes` with four Decision, one Activation, and three Record Link indexes using one shared model index catalog.
- Report duplicate `(observation_id, attempt)`, duplicate activation keys, and duplicate active `(provider, normalized_job_no)` groups with masked IDs only. Create non-unique indexes first; unique indexes only when collision reports are zero.
- Required flow:

```text
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:indexes -- --verify
```

- Local test DB index creation is allowed after explicit DB verification. Production apply and activation are separately authorized and not implied.

## 10. Acceptance criteria

- [ ] Exact Decision shape, frozen unions/defaults/immutability, and four named indexes are proven; one observation/attempt has one stable Decision.
- [ ] Technical failure creates no Decision; business invalid/unsupported/policy outcomes use only exact frozen reasons.
- [ ] **AC-02 Decision portion:** identical webhook evidence in two distinct receipts/Observations produces two distinct causal Decisions; same observation/attempt replay returns one Decision. No claim is made for extension/automation replay completion.
- [ ] Exact Activation shape/unique index/write-once guards hold; concurrent activation has one committed activation+audit and one `GRANOT_ALREADY_ACTIVATED` loser.
- [ ] Execution mode exactly handles absent activation, before/equal/after cutoff, shadow toggles, channel parity, reprocessing permanence, and no replay promotion.
- [ ] **AC-31 foundation:** pre-activation receipts always remain historical shadow and create no live effects; post-cutoff live-shadow Decisions cannot be promoted without a new Observation.
- [ ] Exact Record Link shape and three named indexes hold; one active link per provider/Job survives concurrency; disputed active links remain lookup-visible.
- [ ] Historical safe establishment/confirmation has Receipt -> Observation -> Decision -> Record Link causal refs and atomic rollback; conflicting evidence neither removes nor silently rewrites the active link.
- [ ] Post-cutoff live-shadow/live attempts mutate no Record Link in Unit 07.
- [ ] **AC-32 Record Link/no-op portion:** every Unit 07 link has causal Decision/Observation/receipt evidence; every shadow/no-op path creates zero Domain Commands, Entity Changes, Sheet Sync intents, Lead/Booking/Cancellation changes, cases, discrepancies, or notifications. Full mutation-chain AC remains later.
- [ ] All ten flags have exact defaults; capture is independent; no effect flag ends true.
- [ ] Job/health routes enforce Owner/Admin reads, strict validation, bounded indexed queries, safe envelopes, and accurately mark the projections incomplete.
- [ ] **AC-35 portion:** raw payload/headers and unmasked contact/address/money/source evidence are absent from models that should not copy them, projections, logs, metrics, events, fixtures, and errors.
- [ ] Metrics use bounded enum labels; source/Job/customer/actor IDs cannot become labels.
- [ ] Index report refuses unique create on collisions and verify matches exact names/definitions.

Name owned tests `[AC-02]`, `[AC-31]`, `[AC-32]`, and/or `[AC-35]`, with `foundation`/`portion` in descriptions where the complete AC belongs later.

## 11. Required tests and commands

Minimum locations/levels:

- model tests for all three models: paths, validators, immutable/write-once behavior, defaults, exact named indexes, forbidden fields;
- pure execution-mode/config tests with fake clock/env and before/equal/after cutoff matrix;
- activation command/route replica-set tests for Owner/Admin/auth, strict input, transaction/audit failure, concurrent one-winner, error mapping, masking;
- processor module tests using Unit 01 fixtures plus Unit 04/05/06 adapters: terminal mappings, gate snapshots, historical link establish/confirm/conflict, replay, distinct webhook receipts, and technical rollback;
- replica-set tests for Decision/link unique races and atomic Decision+link persistence;
- Job/health projection route tests for normalization, ordering/bounds, incomplete capability markers, masked schema, and explicit forbidden-key scan;
- index report/order/collision/verify tests and predecessor normalization/source-policy regressions.

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/SynchronizationDecision.test.ts" "src/models/GranotLifecycleActivation.test.ts" "src/models/GranotRecordLink.test.ts" "src/config/domain/granotLifecycle.test.ts" "src/services/granotLifecycle/processor.test.ts" "src/services/granotLifecycle/projections.test.ts" "src/services/granotLifecycle/operations.test.ts" "src/routes/granot-lifecycle-admin.routes.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"
pnpm test
pnpm typecheck
```

Adjust a filename only to the production seam that lands; do not omit a behavior group. Mongo transaction/unique-race claims require replica-set evidence. Run only redacted synthetic fixtures; failure output prints causal/masked IDs and enum codes, never fixture values.

## 12. Live/staging verification

No production activation or current-payload verification. In local test DB or explicitly approved staging:

- verify flags render processing true/shadow true/all effects false and activation absent;
- process redacted synthetic historical receipts through the production module and inspect only receipt/Observation/Decision/link IDs, modes, outcomes/reasons, gates, and counts;
- repeat one attempt, race two Job link establishments, exercise compatible confirmation and conflict, and verify one active link plus causal atomicity;
- create a synthetic activation only in disposable test/staging scope, prove before/equal/after classification, then retain it as immutable evidence rather than deleting it;
- call Job/health reads as Admin/Owner and run the forbidden-key/projection scanner; and
- assert zero Lead/Booking/Cancellation/Domain Command/Entity Change/Sheet Sync/case/discrepancy/notification deltas.

The later Section 34.6 historical shadow batch and production causal/metric verification remain Unit 31. Never inspect raw payload/contact values.

## 13. Rollback

Set `GRANOT_LIFECYCLE_PROCESSING_ENABLED=false` first; capture remains active and due work remains durable. Revert/disable the processor caller/router as needed while preserving receipts, Observations, Decisions, activation, Record Links, and activation audit. Never delete or edit activation/link evidence. Keep all effect flags false. Index or additive-field removal requires separately authorized Section 34.7 tooling; do not drop unique safeguards as routine rollback.

## 14. Required completion handoff

Use Runbook Section 13 and include:

- repository/branch and behavior-grouped models/config/services/routes/migrations/docs;
- exact model fields/index names, processor interface/boundary, mode classifier, activation input/actor/audit contract, and projection schemas;
- flags before/after with all ten exact values and explicit activation-row status;
- index report/apply/verify status and collision evidence; explicit no data migration/production apply;
- AC-tagged focused/full test commands, counts, replica-set transaction/concurrency/replay evidence;
- historical link establishment/confirmation/conflict and distinct-webhook Decision proof;
- privacy scan, bounded metrics/events, and zero-forbidden-effect proof;
- masked staging evidence or not-run reason, risks/deferred later-unit behavior, and final `git status --short`;
- explicit no commit/push/deploy/current-payload/external-send statement; and
- successful verification unblocking Unit 08 (which still separately requires Unit 04) and contributing its prerequisite to Units 14/22.

Do not complete Unit 07 with a mutable/deletable activation, unstable mode cutoff, duplicate active Job link, Decision without causal Observation, post-cutoff link mutation, raw projection/log data, enabled effect flag, failing command, or any Lead/Booking/Cancellation/case/Sheet effect.
