# Unit 18 completion — Safe matched-Lead synchronization effects

## Status and scope

- **Status:** complete
- **Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` only
- **Authoritative contract:** final specification Sections 1–2, 4–7, 8.4, 9.4, 11–16.1, 23, 25, 27, 34.7, 35–37, 38/S12, and 39–41
- **Acceptance ownership:** live matched-write completion for AC-05, AC-07 (matched-write portion), AC-10, AC-11, AC-12, AC-13, AC-32, and AC-33. Unit 19 retains creation/no-second-Lead completion for AC-07–09.
- **Applicable invariants preserved:** 1 (Mongo is System of Record), 2–4 (no Booking/Cancellation/lifecycle-enum writes), 5 (only `synchronizeLeadFromGranot` mutates a matched Lead), 6 (Decision + Command + Change + revision + outbox together), 7 (already-current creates no Change/Command/Sheet), 8 (channel/initiator/processor stay independent), 9–11 (WordPress snapshots, source/CPL immutability, Bad/Duplicate rules)
- **Runtime posture (start and end):** processing true, shadow true, all eight effect flags false. Focused/replica tests inject `shadow_mode=false` and `lead_writes_enabled=true` only.

## Prerequisite / parity acceptance

Units 10–17 completion reports and landed code were re-verified before this unit: executor/idempotency, EntityChange/outbox, Lead fields/indexes, identity, planner/temporal/processor, and Units 16–17 channel adapters. Combined webhook/extension/automation live desired-state parity is proven in `crossChannel.test.ts` (`[AC-33] equivalent live webhook, extension, and automation desired states match`). The user-assigned Unit 18 mission is the designated integration-owner authorization to proceed.

## Files added or changed

### Canonical command and allowlist

- `src/services/granotLifecycle/authorizedDesiredState.ts` — `GranotAuthorizedLeadDesiredState`, path allowlists, planner conversion, contact hashes, idempotency key/checksum
- `src/services/granotLifecycle/leadContactProjection.ts` — role-safe WordPress submitted vs Granot snapshot; phones/emails masked
- `src/services/granotLifecycle/synchronizeLeadTypes.ts` — processor-only `execution` bag
- `src/services/granotLifecycle/synchronizeLeadFromGranot.ts` — command implementation
- `src/services/domainCommands/types.ts` — `synchronizeLeadFromGranot` on `CanonicalDomainCommands`
- `src/services/domainCommands/index.ts` — registry entry
- `src/services/domainCommands/entityChange.ts` — Form/Call lifecycle paths + `RECORD_LINK_CHANGE_PATHS`; `GranotRecordLink` is a writable aggregate
- `src/models/GranotRecordLink.ts` — allowlist `lead_ref`, `source_scope`, `disputed`, `dispute_reason`, `last_change_*`

### Processor

- `src/services/granotLifecycle/processor.ts` — live authorized invocation; `already_current` exact-link stays Decision/temporal-CAS only; post-apply Decision replay; race reload/replan/retry (max 3); receipt `processing.latest_decision_id` via `collection.updateOne`

### Tests

- `src/services/granotLifecycle/authorizedDesiredState.test.ts`
- `src/services/granotLifecycle/leadContactProjection.test.ts`
- `src/services/granotLifecycle/synchronizeLeadFromGranot.test.ts`
- `src/services/granotLifecycle/synchronizeLead.replica.test.ts`
- `src/services/granotLifecycle/processor.test.ts`
- `src/services/granotLifecycle/processor.replica.test.ts`
- `src/services/granotLifecycle/crossChannel.test.ts`
- `src/services/domainCommands/entityChange.test.ts`
- `src/services/domainCommands/domainCommands.test.ts`
- `src/services/ingestion/ingestion.test.ts`
- `src/models/GranotRecordLink.test.ts`
- `scripts/test-granot-lifecycle-replica.ts` — `--unit=18`

### Docs / ledger

- `.cursor/businesslogic/granotLifecycle.processor.md`
- `.cursor/businesslogic/granotLifecycle.desiredState.md`
- `.cursor/businesslogic/domainCommands.service.md`
- `.cursor/rules/granot-lifecycle-capture.mdc`
- `.cursor/rules/business-logic.mdc`
- `.cursor/index.md`
- `scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md`

## Exact contracts landed

### Command

```ts
synchronizeLeadFromGranot(input: {
  lead_ref: { model: "FormLead" | "CallLead"; id: string };
  expected_domain_revision: number;
  desired_state: GranotAuthorizedLeadDesiredState;
  context: CanonicalCommandContext;
  execution: SynchronizeLeadExecution; // processor-only
}): Promise<CanonicalCommandResult>;
```

- Idempotency: `granot:synchronize-lead:<observation_id>`
- Checksum covers target, expected revision, normalized desired state, temporal tuple — never raw receipt payload
- Context: fixed processor actor, webhook or Owner initiator, receipt/Observation/Decision/channel
- Public Lead Zod / `updateSourceOwnedLead` are not used

### One transaction

1. effect-bearing `SynchronizationDecision`
2. Record-Link establish/attach/confirm or bounded dispute
3. Lead CAS + temporal winner
4. append-only `EntityChange` for reportable aggregates
5. one `DomainCommandExecution`
6. queued Sheet Sync `form_lead.update` / `call_lead.update` when the Lead changed

`already_current` never enters the executor. Exact link confirm is evidence-only (no link revision/Change). Contact/address/`granot_contact_snapshot` are `reference_only`; Priority/Quoted/Job/Agent/relationship values may be `stored`.

### Outcome matrix

| Case | Outcome / reason |
| --- | --- |
| Changed Lead | `applied` / `lead_state_changed` |
| Association only | `linked` / `record_link_established` |
| Desired + exact link current | `already_current` / `desired_state_already_current` |
| Older temporal | `stale` / `older_than_temporal_winner` |
| Lead/Job/source disagreement | `conflict` + exact reason |
| Shadow/flag/gate failure | exact gate outcome, no command |

Race losers reload and replan. Still-authorized writes retry the command. Classification outcomes persist Decision-only. Never persist `applied` on a lost claim.

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

Checked-in defaults were not changed. Creation and every case/command/referral/email flag remain false.

## Migration / indexes

**None.** Consumes Units 07 and 09–13 Lead fields/revisions, Command/Change/outbox indexes, seven non-unique Lead indexes, and the active Record-Link unique partial `{provider,normalized_job_no}`. No production report/apply/index creation.

## Verification

### Focused server

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/granotLifecycle/leadDesiredState.test.ts \
  src/services/granotLifecycle/granotTemporal.test.ts \
  src/services/granotLifecycle/processor.test.ts \
  src/services/domainCommands/domainCommands.test.ts \
  src/services/domainCommands/entityChange.test.ts \
  src/services/granotLifecycle/authorizedDesiredState.test.ts \
  src/services/granotLifecycle/leadContactProjection.test.ts \
  src/services/granotLifecycle/synchronizeLeadFromGranot.test.ts \
  src/services/granotLifecycle/crossChannel.test.ts
```

**86 pass / 0 fail / 1 skipped** (skipped is the existing processor replica-opt-in test).

### Replica

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=18
```

**8 pass / 0 fail** on disposable replica `testvantagemovers`. `SHEET_SYNC_MODE=disabled` suppressed external Sheet delivery and still created durable `sheet_sync_jobs`.

Masked WordPress causal chain from the passing replica run: Lead `6a84b6f114f821801019fa1b`, receipt `6a84b6f114f821801019fa1d`, Observation `6a84b6f114f821801019fa1c`, Decision `6a84b6f214f821801019fa20`. Replay returned the same Decision; a later equivalent Observation was `already_current` with no second Command/Change. Booking/Cancellation/case collections were unchanged.

### Full server

```text
pnpm typecheck
pnpm test
git diff --check
```

- `pnpm typecheck`: pass
- `git diff --check`: pass
- `pnpm test`: **1285 pass / 0 fail / 41 skipped** (1326 tests)

## AC-to-proof coverage

| AC / checklist | Proof |
| --- | --- |
| AC-05 | planner + authorizedDesiredState + replica WordPress/Bad Form Priority/Quoted |
| AC-07 matched write | processor live invoke; replica establish/attach/confirm; no second Lead |
| AC-10 | replica WordPress snapshot + `projectRoleSafeLeadContacts` |
| AC-11 | replica WordPress `move_size` unchanged; current ZIP/city update |
| AC-12 | replica Call + Granot-created Form; EntityChange `reference_only` |
| AC-13 | replica Agent fill at Priority 8; Quoted stays false |
| AC-32 | replica causal chain, no-op, revision/tie-break/link races; processor replay + race replan |
| AC-33 live | `crossChannel.test.ts` equivalent webhook/extension/automation desired state/outcome |
| Bad/Duplicate | replica Priority-only Bad Form; Duplicate unmatched, zero Command |
| Forbidden effects | replica collection counts for Booking/Cancellation/case names |
| Privacy | Decision/Command/Change/outbox must not contain raw phone/email |

## Known risks / deferred work

- Receipt `processing.latest_decision_id` updates use `collection.updateOne` so Mongoose timestamps cannot inject `$setOnInsert`. Historical job-level persist uses the same pattern.
- Two temporally distinct Observations against one Lead may both apply when they serialize (newer tuple wins). Same-revision CAS still admits one winner; the loser replans to `stale`/`already_current` or retries if still authorized.
- Unit 19 creation, Unit 22 Booking-case persistence, and every later effect remain unimplemented. No later flag was enabled.
- Staging/live synthetic verification against a reviewed Registry source was not run. Required proof here is redacted module/replica tests.
- Predecessor disposable-index `--verify` gaps recorded by Units 11–17 remain. Production apply was **not** run.

## Newly unblocked

- **Unit 19** — authorized Granot Lead creation (next sequential shared-branch owner)
- **Unit 22** — read-only Booking Reconciliation persistence (spec-unblocked; do not start in parallel with Unit 19 unless a designated integration owner assigns non-overlapping files)

Neither creation nor Booking-case behavior was pulled into this unit.

## Final `git status --short`

### `vantage-main-server` / `granot-lead-lifecycle`

```text
 M .cursor/businesslogic/domainCommands.service.md
 M .cursor/businesslogic/granotLifecycle.desiredState.md
 M .cursor/businesslogic/granotLifecycle.processor.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/models/GranotRecordLink.test.ts
 M src/models/GranotRecordLink.ts
 M src/services/domainCommands/entityChange.test.ts
 M src/services/domainCommands/entityChange.ts
 M src/services/domainCommands/index.ts
 M src/services/domainCommands/types.ts
 M src/services/granotLifecycle/crossChannel.test.ts
 M src/services/granotLifecycle/processor.replica.test.ts
 M src/services/granotLifecycle/processor.test.ts
 M src/services/granotLifecycle/processor.ts
 M src/services/ingestion/ingestion.test.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-18-COMPLETION.md
?? src/services/granotLifecycle/authorizedDesiredState.test.ts
?? src/services/granotLifecycle/authorizedDesiredState.ts
?? src/services/granotLifecycle/leadContactProjection.test.ts
?? src/services/granotLifecycle/leadContactProjection.ts
?? src/services/granotLifecycle/synchronizeLead.replica.test.ts
?? src/services/granotLifecycle/synchronizeLeadFromGranot.test.ts
?? src/services/granotLifecycle/synchronizeLeadFromGranot.ts
?? src/services/granotLifecycle/synchronizeLeadTypes.ts
```

## External-action statement

No commit, push, deploy, production mutation, production index apply, live-payload access, or external send occurred.
