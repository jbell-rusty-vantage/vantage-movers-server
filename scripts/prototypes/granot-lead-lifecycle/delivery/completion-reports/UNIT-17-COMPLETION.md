# Unit 17 completion — HTTP automation receipt convergence and resumable lifecycle outcomes

## Status and scope

- **Status:** complete
- **Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle`; `vantage-admin` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–11, 25, 27–28.1, 31, 35–37, 38/S11, and 39–41
- **Acceptance ownership:** automation portion of AC-02; automation half of AC-33. Unit 18 completes AC-33 at the live matched-write boundary.
- **Applicable invariants preserved:** 1 (Mongo is System of Record), 2–3 (Granot evidence is not official Booking/Cancellation authority and creates no lifecycle enum), 5 (no legacy Lead/Booking mutation from apply), 7 (no EntityChange or Sheet Sync in shadow), 8 (Owner initiator, processor system actor, `granot_http_automation` channel), 9–11 (locked statement; preview target is not identity authority; Duplicate/Bad rules stay in the processor)
- **Runtime posture (start and end):** `PROCESSING=true`, `SHADOW=true`, all eight effect flags false. `GRANOT_AUTOMATION_APPLY_ENABLED` remains the preexisting Owner apply gate and was not enabled.

## Files added or changed

### Server plan / apply

- `src/services/granotHttpCollector/lifecycleStatement.ts` — schema-v2 statement builder, seal, fail-closed v1, run-completion helpers
- `src/services/granotHttpCollector/errors.ts` — extracted `GranotRunConflict`
- `src/services/granotHttpCollector/formWorkflow.ts` — `table_section` on Form actions
- `src/services/granotHttpCollector/runWorkflow.ts` — seal before checksum; apply captures/processes; yields lease on pending; redacts plan statements and receipt payloads
- `src/services/granotLifecycle/applyItem.ts` — shared apply envelope + recognized schema hints
- `src/services/granotLifecycle/automationApply.ts` — capture + `claimAndProcessOrPoll` + run-action receipt
- `src/services/granotLifecycle/extensionApply.ts` — reuse shared `GranotApplyItem` / hint constant
- `src/services/granotLifecycle/capture.ts` — automation initiator/auth pairing; kind mismatch is idempotency conflict
- `src/services/granotLifecycle/normalization.ts` — unwrap recognized apply envelopes; webhook stays flat

### Server tests

- `src/services/granotHttpCollector/lifecycleStatement.test.ts`
- `src/services/granotHttpCollector/formWorkflow.test.ts`
- `src/services/granotHttpCollector/runWorkflow.test.ts`
- `src/services/granotLifecycle/automationApply.test.ts`
- `src/services/granotLifecycle/automationApply.replica.test.ts`
- `src/services/granotLifecycle/capture.test.ts`
- `src/services/granotLifecycle/crossChannel.test.ts`
- `src/routes/granot-automation.routes.test.ts`
- `scripts/test-granot-lifecycle-replica.ts` — `--unit=17`

### Admin display / adapter

- `lib/api/granotAutomation.ts` — lifecycle IDs, pending, no payload projection
- `lib/api/granotAutomation.test.ts`
- `components/ingestion/granot-automation-dashboard.tsx` — pending vs terminal IDs/outcome

### Docs / ledger

- `.cursor/businesslogic/granotLifecycle.automationApply.md`
- `.cursor/businesslogic/granotHttpCollector.service.md`
- `.cursor/businesslogic/granotLifecycle.capture.md`
- `.cursor/businesslogic/enrichment.service.md`
- `.cursor/businesslogic/bookedCallLeadReconciliation.service.md`
- `.cursor/businesslogic/form-lead.service.md`
- `.cursor/businesslogic/granotLifecycle.normalization.md`
- `.cursor/index.md`
- `.cursor/rules/granot-http-automation.mdc`
- `.cursor/rules/granot-lifecycle-capture.mdc`
- `.cursor/rules/owner-lead-workflow.mdc`
- `.cursor/rules/business-logic.mdc`
- `.cursor/rules/project-organization.mdc`
- `vantage-admin/.cursor/rules/project-organization.mdc`
- `scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md`

## Exact contracts landed

### Locked plan / envelope

```ts
type GranotAutomationLifecycleApply = {
  operation_id: string; // exact `${run_id}:${action_id}`
  operation_kind: "lead_snapshot_apply" | "booking_action_apply";
  granot_statement: Record<string, string | number | null>;
  expected_target?: { model: "FormLead" | "CallLead"; id: string };
};
```

- Locked plan `schema_version` is `2`. Schema-v1 apply/approval fails `RUN_REPLAN_REQUIRED`.
- Follow Up Form and Call enrichment → `lead_snapshot_apply`.
- Every Booked Jobs row, including Form-plan Booked rows → `booking_action_apply` with raw `event_type: "Booked"`.
- `user` and `rep` remain separate. Raw Priority remains canonicalizable.
- `payload_schema_hint` is `granot_apply_item_v1`. Normalization also recognizes Unit 16 `extension_granot_apply_item_v1`.

### Run action receipt

```ts
{
  action_id: string;
  lifecycle_receipt_id: string;
  observation_id?: string;
  decision_id?: string;
  outcome: SynchronizationOutcome | "accepted_for_processing" | "technical_failure";
  applied_at: Date;
}
```

| Case | Result |
| --- | --- |
| Selected approved action | one `granot_http_automation` receipt before process |
| Unselected action | no lifecycle receipt |
| Same ID + same hash | replay stored receipt/result |
| Same ID + different hash or kind | `GRANOT_OPERATION_IDEMPOTENCY_CONFLICT`, no second receipt |
| `pending` / `claimed` / `retry_scheduled` / `pending_match` / processing disabled | `accepted_for_processing`, no completed increment, yield run lease |
| Dead letter | bounded `technical_failure` |
| Terminal replay | stored lifecycle IDs/outcome |

Initiator is `approval.approved_by` (`origin: "vantage_admin"`). Processor actor remains `granot_lifecycle`.

### Legacy-bypass search

`runWorkflow.ts` has no runtime import/call of `updateFormLead`, `syncCallLeadEnrichment`, or `syncBookedCallLeadReconciliation`. Preview still uses `previewCallLeadEnrichment` / `previewBookedCallLeadReconciliation`.

## Flags

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

`GRANOT_AUTOMATION_APPLY_ENABLED` was not enabled. No later effect was enabled.

## Migration / indexes

**None.** Existing receipt unique partial `{ observation_channel, channel_operation_id }` and run TTL/plan-checksum indexes remain the concurrency/identity owners. Schema-v1 plans are not backfilled. No production report/apply/index creation.

Replica `Model.syncIndexes()` plus concurrent capture proves one-receipt / 409 uniqueness on disposable `testvantagemovers`.

## Verification

### Focused server

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/granotHttpCollector/runWorkflow.test.ts \
  src/services/granotLifecycle/capture.test.ts \
  src/services/granotLifecycle/normalization.test.ts \
  src/services/granotLifecycle/processor.test.ts \
  src/services/granotLifecycle/drainer.test.ts \
  src/routes/granot-automation.routes.test.ts \
  src/services/granotHttpCollector/lifecycleStatement.test.ts \
  src/services/granotLifecycle/automationApply.test.ts \
  src/services/granotLifecycle/crossChannel.test.ts \
  src/services/granotHttpCollector/formWorkflow.test.ts
```

**99 pass / 0 fail / 1 skipped** (skipped is the existing processor replica-opt-in test).

### Replica

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=17
```

**3 pass / 0 fail** on disposable replica `testvantagemovers`. Same `${run_id}:${action_id}` + same hash → one receipt. Same ID + different hash → one winner and `GRANOT_OPERATION_IDEMPOTENCY_CONFLICT`. Apply capture + stored replay writes zero `entity_changes` / `sheet_sync_jobs` / `domain_command_executions` / `booked_leads` / `cancelled_leads`.

### Full server

```text
pnpm test
pnpm typecheck
```

- `pnpm typecheck`: pass
- `pnpm test`: **1267 pass / 0 fail / 33 skipped** (1300 tests)

### Admin

```text
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

- `pnpm test`: **181 pass / 0 fail / 0 skipped**
- `pnpm lint`: pass
- `pnpm typecheck`: pass
- `pnpm build`: pass (Next.js 16.2.6)

### Cross-channel masked comparison

`crossChannel.test.ts` compares an equivalent redacted webhook statement with a `granot_http_automation` apply envelope. Observation identity, Priority, separate `user`/`rep`, and shadow desired-state outcome match. Channel, initiator, and receipt identity may differ. No live/customer payload was inspected.

### `git diff --check`

Pass in both repositories after stripping two accidental EOF blank lines.

## AC-to-proof coverage

| AC / checklist | Proof |
| --- | --- |
| AC-02 automation | capture replay/409; kind mismatch; replica concurrent same-hash / different-hash; unique `{channel,operation_id}` |
| AC-33 automation | statement aliases; webhook vs automation Observation + shadow desired-state fingerprint |
| Selected vs unselected | apply iterates only approval `selected_action_ids` |
| Form/Call kinds | lifecycleStatement + formWorkflow section tests |
| Schema-v1 fail-closed | `RUN_REPLAN_REQUIRED` |
| Pending continuation | `accepted_for_processing` / `pending_match` / processing-disabled / dead-letter tests |
| Legacy bypass | static search of `runWorkflow.ts` |
| Shadow zero effects | replica forbidden-collection counts; processor shadow tests unchanged |
| Admin safety | adapter drops payload/statement; dashboard shows IDs + pending only |

## Joint cross-channel parity ledger (automation half)

| Fixture | Interface | Result |
| --- | --- | --- |
| Redacted statement `{ source, job_no, ref_no, priority:"1", user, rep, phone, from_*/to_* }` | Observation (`crossChannel.test.ts`) | webhook = automation identity/Priority/agent |
| Same statement | Unit 15 desired-state / processor | same shadow outcome, zero `changed_paths` |
| Envelope hash | `hashCredentialRedactedPayload` | `expected_target` drift changes hash |

Unit 17 records only the automation half. Combined webhook/extension/automation parity acceptance remains an integration-owner decision before Unit 18.

## Known risks / deferred work

- Live `claimAndProcessOrPoll` against a freshly inserted receipt can still hit the existing receipt-update allowlist (`$setOnInsert`) in this Mongo/Mongoose pairing. Unit 16 recorded the same claim path for extension apply. Replica proof for this unit uses real capture uniqueness plus injected claim translation; do not treat that as a new Unit 17 receipt-model change.
- Full index `--verify` on disposable `testvantagemovers` still fails predecessor CRM-source / Decision / activation / Record Link / EntityChange / Lead S08 indexes. Same class of gap Units 11–16 recorded. Production apply was **not** run.
- Unit 18 is **not** unblocked. It still waits for designated integration-owner acceptance of combined webhook/extension/automation shadow parity.
- Staging/live synthetic approved-plan verification was not run. Required proof here is redacted module/replica/Admin tests.
- Existing Admin plan details still show pre-existing preview/row fields from older Call plans; new `granot_statement` is redacted from GET details.

## Newly unblocked

- Unit 17 alone unblocks **no later implementation**.
- Unit 18 remains blocked until a designated integration owner accepts the combined shadow parity report.

## Final `git status --short`

### `vantage-main-server` / `granot-lead-lifecycle`

```text
 M .cursor/businesslogic/bookedCallLeadReconciliation.service.md
 M .cursor/businesslogic/enrichment.service.md
 M .cursor/businesslogic/form-lead.service.md
 M .cursor/businesslogic/granotHttpCollector.service.md
 M .cursor/businesslogic/granotLifecycle.capture.md
 M .cursor/businesslogic/granotLifecycle.normalization.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/granot-http-automation.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/owner-lead-workflow.mdc
 M .cursor/rules/project-organization.mdc
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/routes/granot-automation.routes.test.ts
 M src/services/granotHttpCollector/formWorkflow.test.ts
 M src/services/granotHttpCollector/formWorkflow.ts
 M src/services/granotHttpCollector/runWorkflow.test.ts
 M src/services/granotHttpCollector/runWorkflow.ts
 M src/services/granotLifecycle/capture.test.ts
 M src/services/granotLifecycle/capture.ts
 M src/services/granotLifecycle/crossChannel.test.ts
 M src/services/granotLifecycle/extensionApply.ts
 M src/services/granotLifecycle/normalization.ts
?? .cursor/businesslogic/granotLifecycle.automationApply.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-17-COMPLETION.md
?? src/services/granotHttpCollector/errors.ts
?? src/services/granotHttpCollector/lifecycleStatement.test.ts
?? src/services/granotHttpCollector/lifecycleStatement.ts
?? src/services/granotLifecycle/applyItem.ts
?? src/services/granotLifecycle/automationApply.replica.test.ts
?? src/services/granotLifecycle/automationApply.test.ts
?? src/services/granotLifecycle/automationApply.ts
```

### `vantage-admin` / `granot-lead-lifecycle`

```text
 M .cursor/rules/project-organization.mdc
 M components/ingestion/granot-automation-dashboard.tsx
 M lib/api/granotAutomation.test.ts
 M lib/api/granotAutomation.ts
```

## External-action statement

No commit, push, deploy, production mutation, production index apply, live-payload access, or external send occurred.
