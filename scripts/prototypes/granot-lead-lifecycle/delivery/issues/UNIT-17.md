# Unit 17 — HTTP automation receipt convergence and resumable lifecycle outcomes

> **Contract maturity: implementation-ready; implementation is ready after repository re-verification.** This is S11. It converts every approved HTTP-automation action from a patch-authoritative write into one durable `granot_http_automation` receipt and the common processor while preserving immutable-plan approval, checksum, drift, lease, and continuation protections. Unit 16 is not a prerequisite; if it has landed, reuse its channel-operation capture/envelope seam rather than introducing a parallel contract.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–11, 25, 27–28.1, 31, 35–37, 38/S11, and 39–41. Section 31 and S11 control this unit; Section 8.2 controls automation-to-Registry compatibility.
- **Acceptance ownership:** automation portion/completion of AC-02 and automation half of AC-33. Unit 18 completes AC-33 at the live matched-write boundary.
- **Approved split:** Unit 17 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Units 02–04 own receipt/normalization foundations; Units 14–15 own policy, identity, desired state, processor, and durable processing. Unit 16 independently converges the browser extension. Unit 18 owns accepted three-channel parity and live matched writes.
- **Execution:** the delivery runbook; server and Admin repository instructions; applicable lifecycle/HTTP-automation rules; verified predecessor reports/code/indexes; the current `granotHttpCollector` plan/apply/lease path; lifecycle receipt/normalization/drainer/processor code; and the existing Admin Automation display.

The final specification wins on conflict. The locked automation plan remains approval evidence, but it is not Lead identity or patch authority. The server lifecycle Module is authoritative for normalization, Registry policy, source-scoped identity, temporal ordering, desired state, and outcome.

## 2. Objective

For each selected action in an Owner-approved, checksum-locked Granot HTTP Automation plan, derive a complete bounded Granot statement from the immutable row, capture or replay exactly one `granot_http_automation` receipt under `${run_id}:${action_id}`, preserve the approving Owner as initiator, enter through Unit 08's fenced claim/process-or-poll seam, and store the lifecycle receipt/Observation/Decision/outcome on the existing run action receipt. A nonterminal lifecycle receipt must cause the automation worker to checkpoint that action as `accepted_for_processing`, yield its lease, and resume the same operation identity later. No approved action may reach the legacy Form patch, Call enrichment sync, or Booked reconciliation mutation path after cutover.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle`; `vantage-admin` / `granot-lead-lifecycle` only for the existing Granot Automation run-receipt display and API adapter.
- **Prerequisites:** Units 02–04 and 14–15. Verify their completion reports against current models, unique indexes, normalization, Registry compatibility, `claimAndProcessOrPoll`, stored-result replay, processor behavior, and flags. Unit 16 may be absent, active, or complete and is not allowed to block this unit.
- Before edits in each affected repository, run branch/status/recent-change checks. If Unit 16 is active on the same shared branch, identify one integration owner and avoid overlapping edits to the shared operation-capture/envelope seam.
- Confirm `TEST_MODE=true`, a disposable replica set, `SHEET_SYNC_MODE=disabled`, no live provider target, `GRANOT_AUTOMATION_APPLY_ENABLED` posture, and all lifecycle effect flags before any runtime write.
- Preserve unrelated/user changes. No commit, push, deploy, production apply, live payload inspection, provider request, current-customer plan, flag enablement, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-18; the implementing agent must reverify rather than treating these statements as permanent:

- `src/services/granotHttpCollector/runWorkflow.ts` still sends approved Form actions to `updateFormLead` and Call actions to `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`. Those functions are the bypass this unit removes from apply, while preview use remains.
- Current Form plan actions retain patch/expected state but not the original row or its section. Current Call plan actions retain a legacy row DTO, but `buildGranotOperationPayloads` collapses `user || rep` into `granot_crm_username`. Neither shape can prove a full channel-neutral statement, raw `Booked` evidence, or separate `user`/`rep`; the immutable plan schema must evolve before checksum lock.
- `GranotAutomationRun.plan_snapshot`, `approval`, and `receipts` are mixed subdocuments. The run has a 24-hour plan expiry, seven-day TTL, checksum lock, per-run lease/fence, and current `{action_id,outcome,applied_at}` receipts. No data/index migration is required to extend these shapes.
- `GranotObservationReceipt` already accepts `granot_http_automation`, requires a channel operation kind/ID, validates the 1–300 printable `${run_id}:${action_id}` form, and has the unique partial `{observation_channel,channel_operation_id}` index. `capture.ts` is webhook-specific; a shared channel-operation capture seam may exist if Unit 16 landed.
- Unit 08 exposes `claimAndProcessOrPoll`. It is the synchronous adapter around the same Mongo claim/fence used by queue/cron work and returns either a stored processed result or durable `accepted_for_processing`; automation must not invoke an unfenced second processor directly.
- `normalization.ts` currently reads a flat receipt payload. If Unit 16 has not already landed the apply-item evidence envelope, this unit must add one shared envelope extractor and keep webhook normalization unchanged.
- Existing run approval requires `GRANOT_AUTOMATION_APPLY_ENABLED`, an exact checksum, selected immutable action IDs, and Owner authentication. Existing run recovery prioritizes approved work and fences plan/apply checkpoints.
- The Admin Automation page polls nonterminal runs and displays plan actions plus simple application receipts. Its API type/adapter does not yet preserve lifecycle Observation/Decision IDs or distinguish durable pending from terminal failure.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo receipts, run state, and stored Decisions—not worker memory or Admin state—are the durable truth.
- **Invariants 2–3:** `Booked` is repeatable Granot evidence, not an official Booking or lifecycle enum. Automation cannot create/update a Booking or create a Cancellation.
- **Invariant 5:** the legacy apply functions must become preview-only in this path; no direct Lead/Booking model or legacy mutation service is a valid final-apply destination.
- **Invariant 7:** S11 runs in shadow; no `EntityChange` or Sheet Sync job may appear.
- **Invariant 8:** Source System=`granot`, Observation Channel=`granot_http_automation`, authenticated Owner initiator=`vantage_admin`, processor actor=`granot_lifecycle`, and immutable Lead Ingestion Origin remain separate.
- **Invariants 9–10:** the locked row and protected receipt preserve evidence, while preview target bindings never authorize snapshot/source/origin/CPL reassignment.
- **Invariant 11:** old Form fallback or Call preview matches cannot bypass the lifecycle processor's Duplicate/Bad and Source Scope rules.

## 6. Deliverables and exact contract

### 6.1 Immutable plan schema v2 and full statements

Before computing `plan_checksum`, evolve every action selected for possible apply to contain this server-owned block:

```ts
type GranotAutomationLifecycleApply = {
  operation_id: string; // exact `${run_id}:${action_id}`
  operation_kind: "lead_snapshot_apply" | "booking_action_apply";
  granot_statement: Record<string, string | number | null>;
  expected_target?: { model: "FormLead" | "CallLead"; id: string };
};
```

- Bump the locked plan `schema_version` to `2`. An approved schema-v1 plan does not contain enough immutable evidence and must fail closed as `RUN_REPLAN_REQUIRED`; never reconstruct its statement from a patch/preview during apply.
- Preserve the collected row's bounded flat scalar values in `granot_statement`. Add only deterministic aliases consumed by Unit 04: `source` from the row or selected source label; `priority` from raw `prior`; `customer_name` from raw `customer`; `job_no`, `ref_no`, phone/email, move/service/size/cubic/money/type fields; and parsed `from_city|state|zip` / `to_city|state|zip` using the existing Granot location helpers. Never map `book_date` or observed money into an official Vantage field.
- Preserve `user` and `rep` separately. Do not store only `granot_crm_username`, turn Priority into Boolean, preselect the Lead as authority, or retain only a patch.
- Follow Up Form and Call enrichment rows use `lead_snapshot_apply`. Every Booked Jobs row—including Form-plan rows—uses `booking_action_apply` and includes exact raw `event_type:"Booked"` evidence derived from the locked table section. Do not infer Release or another action from this collector.
- `expected_target` is optional drift evidence derived from the locked preview binding. The processor must independently agree before an effect can ever be authorized. Mismatch yields `conflict` / `record_link_conflict`; it never retargets, skips receipt capture, or restores a legacy write.
- `operation_id` must satisfy the existing receipt limit before plan lock. Reject unsafe/over-300 `${run_id}:${action_id}` values during planning; do not shorten or hash the specified identity.
- The plan remains immutable after checksum lock. Continuation reads this exact block and never recollects/rebuilds it from current Granot HTML.

### 6.2 Shared channel-operation evidence envelope and capture

Use the shared apply envelope so extension and automation normalize identically:

```ts
type GranotApplyEvidenceV1 = {
  operation_id: string;
  operation_kind: "lead_snapshot_apply" | "booking_action_apply";
  granot_statement: Record<string, string | number | null>;
  expected_target?: { model: "FormLead" | "CallLead"; id: string };
};
```

This envelope and `payload_schema_hint:"granot_apply_item_v1"` are **issue-author compatibility guidance** required because current flat automation plans cannot durably preserve kind/target drift evidence. If Unit 16 has already established an equivalent final-spec-compliant envelope, reuse its exact name/shape rather than duplicating it.

- A shared lifecycle capture service receives only trusted server values and inserts `source_system:"granot"`, `observation_channel:"granot_http_automation"`, `authentication_method:"automation_owner_approval"`, channel kind/ID, approving Owner initiator, `captured_at`, evidence version 2, `{}` headers, redacted evidence/hash, and pending work defaults.
- Hash the complete credential-redacted envelope, not merely a derived patch. Reject nested statement values, unsafe/unbounded keys/strings, credential-like keys, and a Booking Action missing `Booked` evidence before insert.
- Normalization unwraps `granot_statement` only for the recognized schema hint, verifies envelope kind/operation fields agree with immutable receipt fields, and then uses the existing Unit 04 normalizer. Webhook payload behavior remains flat and unchanged.
- First channel/operation ID inserts one receipt. Same ID plus same hash/kind reuses the winner and stored work/result. Same ID with a different hash or kind raises `GRANOT_OPERATION_IDEMPOTENCY_CONFLICT`, creates no second receipt/effect, and becomes a safe run error.
- Resolve duplicate-key races by reloading the unique-index winner and repeating the hash/kind check. Never process twice.

### 6.3 Approval, initiator, and drift protections

- Preserve Owner-only plan creation/approval, `GRANOT_AUTOMATION_APPLY_ENABLED`, selected-action validation, plan TTL, exact checksum, source compatibility, and run lease/fence behavior.
- The receipt initiator is the immutable `approval.approved_by` Owner snapshot, not the original preview requester when they differ. The processor actor remains the fixed Granot Lifecycle Processor system actor.
- Validate the plan checksum and schema before every continuation. Revalidate the existing preview target binding as a second safety signal, but express disagreement through the captured `expected_target`/processor conflict path; it may not mutate, skip evidence, or override processor identity/policy.
- Each selected action captures its receipt before processing. Unselected or non-approved actions create no lifecycle receipt.

### 6.4 Fenced processing, pending continuation, and terminal results

After capture/replay call `claimAndProcessOrPoll(lifecycle_receipt_id)`; do not call `GranotObservationProcessor.process` directly outside Unit 08's claim ownership.

Store exactly one current action receipt per `action_id`:

```ts
type GranotAutomationActionReceipt = {
  action_id: string;
  lifecycle_receipt_id: string;
  observation_id?: string;
  decision_id?: string;
  outcome:
    | SynchronizationOutcome
    | "accepted_for_processing"
    | "technical_failure";
  applied_at: Date;
};
```

- A processed result stores the lifecycle IDs/outcome and terminally checkpoints that action. Exact worker/run replay returns the stored result without another receipt or Decision.
- `pending`, `claimed`, or `retry_scheduled` stores/updates `accepted_for_processing`, does **not** increment completed-action progress, keeps the run `applying`, yields the run/global lease, and publishes or leaves recoverable continuation work. The next worker reloads the same plan, action receipt, and operation ID.
- A lifecycle `pending_match` remains nonterminal under Unit 08's business retry schedule and therefore appears as `accepted_for_processing` until a terminal Decision is available.
- A dead-lettered receipt or exhausted bounded technical failure becomes `technical_failure`; a safe error code may be recorded separately, but never raw provider/payload/contact detail. Processing disabled leaves the durable receipt pending/recoverable rather than fabricating a terminal business outcome.
- Pending action receipts are retried; only terminal lifecycle outcomes/technical failure enter the set skipped on worker restart. Replace/upsert by `action_id`; never push duplicate action-receipt rows.
- The run ends `completed_with_errors` only when a terminal `technical_failure` or idempotency/checksum error exists; otherwise all selected actions must have terminal lifecycle outcomes before `completed`.

### 6.5 Remove the legacy apply bypass

- Replace `applyFormAction` / `applyCallAction` final mutation calls with the capture-and-process adapter above. They may be removed or retained only as non-production test history; no runtime selected-action branch may call `updateFormLead`, `syncCallLeadEnrichment`, or `syncBookedCallLeadReconciliation`.
- Preview/planning may continue using existing preview/matching services to construct owner guidance and drift bindings. Preview creates no lifecycle receipt and mutates nothing.
- Background queue consumer, local worker, heartbeat recovery, and Admin approval all converge on the same `applyRun` behavior. No route/script/consumer gets a compatibility bypass.

### 6.6 Existing Admin display

- Keep the existing `/ingestion/granot` Automation display and run endpoints. Do not build Lifecycle queues/timelines in this unit.
- Extend the Admin API adapter/receipt type to preserve `lifecycle_receipt_id`, optional Observation/Decision IDs, exact bounded outcome, and `applied_at`. Show durable pending distinctly and continue polling while the run is nonterminal.
- Show IDs and bounded outcome only. Do not expose the receipt payload/envelope, raw statement, contact/address values, headers, errors, or credentials through the new receipt display.
- Approval selection/checksum confirmation remains unchanged; the UI never constructs statements or lifecycle identities.

## 7. Explicitly out of scope

- Browser-extension payload/storage/version work (Unit 16), except reusing a shared server envelope/capture seam already landed.
- Live matched-Lead mutation, `synchronizeLeadFromGranot`, `EntityChange`, Sheet Sync intent, or turning shadow off (Unit 18).
- Granot-created Lead creation (Unit 19), RingCentral adoption/cadence (Units 20–21), Booking/Release cases or commands (Units 22–29), lifecycle health UI (Unit 30), migrations/shadow certification (Unit 31), email (optional Unit 32), and compatibility deletion beyond this automation bypass (Unit 33).
- Changes to plan collection source selection, provider login, preview scoring, Owner approval semantics, official Booking/Cancellation facts, or source Registry policy.
- Raw payload, credential, or unmasked customer data in logs, projections, tests, issue/handoff text, reports, or Admin lifecycle receipts. Existing protected immutable plans/receipts remain the only authorized evidence locations.

## 8. Flags and runtime posture

Starting and ending checked-in lifecycle defaults remain:

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

`GRANOT_AUTOMATION_APPLY_ENABLED` remains the preexisting Owner-approved automation apply gate; this unit does not silently enable it in any environment. With apply separately enabled, final apply captures/processes in historical or live shadow only. Unit 17 must produce zero Lead/Booking/Cancellation/case/discrepancy/notification/Sheet effects. Capture remains active and durable work remains recoverable if processing is disabled.

## 9. Migration and indexes

**None.** `GranotAutomationRun.plan_snapshot`/`receipts` are mixed shapes and the Unit 02 operation-identity unique index already owns concurrency. Plan schema v1 is not backfilled or mutated; it fails closed and requires a newly collected/approved schema-v2 run. Verify the receipt unique partial index definition and run TTL/plan-checksum indexes in model/replica tests. No production report/apply/index creation is authorized.

## 10. Acceptance criteria

- [ ] **AC-02:** Identical webhook deliveries create distinct receipts/Observations; the same automation `${run_id}:${action_id}` replays one receipt/result, while the same ID with a different complete-envelope hash or kind conflicts and produces no second receipt/effect.
- [ ] **AC-33 (automation half):** An equivalent redacted Granot statement through HTTP automation and webhook produces the same normalized Observation and shadow desired-state outcome; channel, initiator, receipt identity, and transport metadata may differ but policy/identity/desired state may not.
- [ ] Every selected approved action captures one lifecycle receipt before processing; unselected actions create none.
- [ ] Form and Call enrichment actions are `lead_snapshot_apply`; every Booked Jobs action is `booking_action_apply` with raw `Booked` evidence. `user` and `rep` remain separate and raw Priority remains canonicalizable.
- [ ] Immutable plan/checksum/approval/TTL/source-compatibility and preview drift protections survive cutover. Schema-v1 plans fail `RUN_REPLAN_REQUIRED` rather than being reconstructed from a patch.
- [ ] Losing capture/index races reuse the winner; exact replay does not add a run receipt, Observation, Decision, or domain effect.
- [ ] Nonterminal claim/retry/pending-match stores `accepted_for_processing`, does not checkpoint complete, yields the lease, and resumes the same operation ID. Terminal replay uses stored lifecycle IDs/outcome. Dead letter becomes bounded `technical_failure`.
- [ ] No apply branch calls legacy Form/Call/Booked mutation services. Shadow proof asserts zero Lead, Booking, Cancellation, Record-Link target mutation, `EntityChange`, Sheet Sync, case, discrepancy, notification, or external send.
- [ ] Admin shows only safe lifecycle IDs/outcome/pending state and never the receipt payload or new raw statement evidence.

## 11. Required tests and commands

Map AC IDs into test names before implementation. At minimum add/run:

- pure plan/statement tests for Form Follow Up, Form Booked, Call enrichment, Call Booked, alias mapping, separate `user`/`rep`, raw Priority, raw `Booked`, unsafe/oversized operation identity, and schema-v1 fail-closed behavior;
- module/worker tests for approval/checksum retention, exactly one receipt/action, `claimAndProcessOrPoll` use, accepted-for-processing lease yield, same-ID continuation, terminal replay, hash/kind mismatch, and immutable plan preservation;
- route tests for Owner-only approve/display, safe errors, existing envelopes, and no raw lifecycle receipt payload projection;
- replica-set tests for concurrent same-operation capture, winner reload, one Receipt/Observation/Decision, and zero forbidden collections;
- cross-channel contract tests comparing equivalent webhook and automation statements at Observation and Unit 15 desired-state interfaces;
- Admin adapter/component tests for lifecycle IDs, pending polling, terminal outcome, safe rendering, and unchanged approval selection/checksum behavior;
- static searches proving `applyRun` has no runtime import/call path to the three legacy mutation functions and no new raw/credential logging.

Run from `vantage-main-server`:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/services/granotHttpCollector/runWorkflow.test.ts src/services/granotLifecycle/capture.test.ts src/services/granotLifecycle/normalization.test.ts src/services/granotLifecycle/processor.test.ts src/services/granotLifecycle/drainer.test.ts src/routes/granot-automation.routes.test.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=17
pnpm test
pnpm typecheck
```

Run from `vantage-admin` when its adapter/display changes:

```text
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use `vercel dev` smoke only if queue/cron/route registration differs from the tested direct Express path. Record exact pass/fail counts and the disposable database category; never record customer values.

## 12. Live/staging verification

With synthetic redacted rows, an Owner-approved schema-v2 plan must create exactly one lifecycle receipt per selected action, retain the approval/checksum, show `accepted_for_processing` while claimed/retry-scheduled, continue with the same operation ID, and return the stored terminal result on exact replay. Compare one equivalent webhook statement against the automation Observation/Decision/desired-state fingerprint and assert zero forbidden effects.

Production remains read-only unless a separate approval explicitly enables automation apply for this verification. If approved, inspect only masked run/action/receipt/Observation/Decision IDs, counts, states, and bounded outcomes—never raw plan rows, receipt payloads, contact values, headers, or provider credentials.

## 13. Rollback

Disable `GRANOT_AUTOMATION_APPLY_ENABLED` first; if lifecycle work itself is unhealthy, also disable processing. Capture/plan/approval evidence and already-created lifecycle receipts/Observations/Decisions remain immutable and pending work remains recoverable. Restore an old automation endpoint adapter only if it still captures and processes receipts; never restore a direct patch/enrichment/Booked mutation bypass. Do not delete plans, run receipts, lifecycle evidence, activation, or committed facts.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-17-COMPLETION.md` using Runbook Section 13. Include both repository branches/statuses, behavior-grouped files, exact plan/envelope/run-receipt shapes, legacy-bypass search, flags, index verification, focused/full command counts, replica race/replay/pending proof, masked cross-channel evidence, Admin safety proof, and external-action statement.

Record the automation portion of the joint cross-channel parity ledger with fixture/fingerprint/test references. Unit 17 alone unblocks no later implementation: Unit 18 becomes ready only after Unit 16 is complete and a designated integration owner accepts the combined webhook/extension/automation shadow parity report. The next agent must verify repository evidence rather than trust the handoff prose.
