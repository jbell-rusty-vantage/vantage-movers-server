# Unit 19 — Authorized Granot Lead creation and atomic link reservation

**Status:** Complete  
**Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`

## Authority and acceptance

Implemented final-spec Sections 1–2, 4–8.4, 9.4, 11–17, 23.1–23.4, 25, 27, 34.7, 35–37, 38/S13, and 39–41; Invariants 1–11; and Unit 19 ownership of AC-07, AC-08, and AC-09.

## Behavior delivered

- Added the internal canonical `createLeadFromGranot` command and registered it in the domain-command surface. Its only payload is `{ lead_model, source_scope, observation_id, context }`; caller Job Numbers, patches, and caller-owned provenance/CPL fields are rejected.
- The processor now sends a live, post-activation, temporally accepted, complete `create_if_missing` `lead_created` no-match to that command. Matched Leads continue through Unit 18. Shadow, disabled, invalid, incomplete, and conflict outcomes create nothing.
- The command revalidates current activation, flags, Registry policy/route, full identity, Source Company/Granularity, CPL, and any configured RingCentral-facilitated Call route assignment inside the transaction.
- One transaction creates the Form/Call Lead, reserves the active Granot Record Link, inserts the preallocated Decision and command execution, appends Lead/link `EntityChange` rows with revision `0 -> 1`, and queues the correct Sheet Sync outbox intent.
- Created Leads use `ingestion_origin:"granot_lead_created"`, immutable accepted snapshots, exact route/source/CPL snapshots, and `post_to_granot:false`. Form `local` is derived only from accepted origin/destination states and an absent `move_date` remains absent. Call creation is sparse: normalized phone means convergence `pending`; Job-only means `not_applicable`; no local, RingCentral, duration, or session evidence is fabricated.
- Duplicate-key and identity/policy races abort and replan. A concurrent winner is reused through Unit 18; a pre-existing lead-less active reservation is classified as `record_link_conflict`; blind second creation and mutation of an existing active link are forbidden.
- Decision effects are bounded to `lead_created`, `record_link_established`, and `sheet_sync_requested`. No Booking, Cancellation, reconciliation case, notification, email, or RingCentral effect was added.

## Files

### Production and model behavior

- `src/services/granotLifecycle/createLeadFromGranot.ts`
- `src/services/granotLifecycle/processor.ts`
- `src/services/granotLifecycle/leadDesiredState.ts`
- `src/services/granotLifecycle/identity.ts`
- `src/services/granotLifecycle/sourcePolicy.ts`
- `src/services/domainCommands/index.ts`
- `src/services/domainCommands/types.ts`
- `src/services/domainCommands/entityChange.ts`
- `src/services/crm/formLeadPayload.ts`
- `src/models/FormLead.ts`
- `src/models/CallLead.ts`

### Tests and harness

- `src/services/granotLifecycle/createLeadFromGranot.test.ts`
- `src/services/granotLifecycle/createLeadFromGranot.replica.test.ts`
- `src/services/granotLifecycle/processor.test.ts`
- `src/services/granotLifecycle/leadDesiredState.test.ts`
- `src/models/FormLead.test.ts`
- `src/models/CallLead.test.ts`
- `src/services/crm/formLeadPayload.test.ts`
- `src/services/ingestion/ingestion.test.ts`
- `src/services/granotLifecycle/authorizedDesiredState.test.ts` — replaced a probabilistic three-hex-character assertion with the complete synthetic phone value.
- `scripts/test-granot-lifecycle-replica.ts`

### Behavior documentation

- `.cursor/businesslogic/call-lead.service.md`
- `.cursor/businesslogic/domainCommands.service.md`
- `.cursor/businesslogic/form-lead.service.md`
- `.cursor/businesslogic/granotLifecycle.desiredState.md`
- `.cursor/businesslogic/granotLifecycle.processor.md`
- `.cursor/businesslogic/granotLifecycle.revisions.md`
- `.cursor/index.md`
- `.cursor/rules/business-logic.mdc`
- `.cursor/rules/granot-lifecycle-capture.mdc`
- `.cursor/rules/owner-lead-workflow.mdc`
- `.cursor/rules/project-organization.mdc`

## AC and interface proof

- **AC-07:** identity/model tests prove exact matched-Lead selection and Duplicate/Bad Form restrictions; processor tests prove matched Leads never call creation and race losers enter Unit 18; replica concurrency proves one Lead, one active link, and one creation causal chain for two distinct same-Job Observations.
- **AC-08:** planner/processor tests prove immediate authorization and every no-command gate; canonical tests prove strict input, checksum, and idempotency; replica tests prove exact Form/Call persistence, replay/conflict, Call assignment failures, active-link race behavior, privacy, forbidden-effect absence, and rollback after Lead, link, Change, Decision, Command, and outbox stages.
- **AC-09:** pure tests prove same-state Local, differing-state long-distance, and missing/invalid route data; replica Form creation proves exact selected Local route, scope, and snapshots. No Registry source was changed from `link_only`.

## Migration and index decision

- No migration or new index was added or applied.
- `CallLead.post_to_granot` is additive and optional with default `false`; the false-only invariant is scoped to `granot_lead_created`, so existing rows (including historical ordinary rows with `true`) remain saveable without a backfill.
- The existing Unit 07 active-link unique partial index remains the race authority. The disposable test database initially contained two stale synthetic duplicate groups (four test links); those synthetic fixtures were removed, the exact declared index was synchronized in test mode, and the final read-only report returned `active_link_collision_groups: 0`.
- No production collision report, index apply, migration apply, Registry mutation, or backfill was run.

## Flags and effects

Checked-in posture remains processing true, shadow true, and all eight effect flags false, including Lead writes and Lead creation. Replica proof injected live/creation flags only with `TEST_MODE=true` and `SHEET_SYNC_MODE=disabled`. Booking/Release/Referral/email effects remain disabled.

## Verification

Focused:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/leadDesiredState.test.ts" "src/services/granotLifecycle/identity.test.ts" "src/services/granotLifecycle/processor.test.ts" "src/services/granotLifecycle/createLeadFromGranot.test.ts" "src/services/domainCommands/domainCommands.test.ts" "src/models/FormLead.test.ts" "src/models/CallLead.test.ts" "src/services/crm/formLeadPayload.test.ts"
```

- **125 tests: 124 passed, 0 failed, 1 skipped** (the skip is the separate opt-in Unit 18 replica portion).

Replica:

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled npm run test:granot-lifecycle:replica -- --unit=19
```

- **9 passed, 0 failed, 0 skipped.**

Repository:

```text
npm test
npm run typecheck
git diff --check
```

- `npm test`: **1,349 tests; 1,299 passed, 0 failed, 50 skipped.**
- `npm run typecheck`: passed.
- `git diff --check`: passed.
- Final adversarial re-review: approved with no remaining findings.
- The repository defines no `lint`, `compile`, or `build` scripts; those script checks are not applicable.

## Staging, privacy, and security

No staging/live verification was authorized. Disposable replica-set tests used synthetic evidence and disabled Sheet Sync delivery. Decision, Command, Change, and outbox assertions contain no raw contact values; contact/address Change fields are `reference_only`. No current customer payload, credential, production row, or unmasked live identifier was inspected.

## Risks, deferred work, and next unit

- Runtime rollout still requires separate approval, one audited reviewed source-policy change, synthetic/staging verification, and operational monitoring. This implementation does not authorize that rollout.
- Unit 20 is newly unblocked for RingCentral adoption/convergence and duplicate correctness. Unit 19 intentionally leaves adoption and all Booking/Release work untouched.
- Missing synthetic CPL fixtures intentionally exercised the existing `missing_rate`/zero-CPL behavior and bounded operational log.

## Repository state and external actions

Final `git status --short`:

```text
 M .cursor/businesslogic/call-lead.service.md
 M .cursor/businesslogic/domainCommands.service.md
 M .cursor/businesslogic/form-lead.service.md
 M .cursor/businesslogic/granotLifecycle.desiredState.md
 M .cursor/businesslogic/granotLifecycle.processor.md
 M .cursor/businesslogic/granotLifecycle.revisions.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/owner-lead-workflow.mdc
 M .cursor/rules/project-organization.mdc
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/models/CallLead.test.ts
 M src/models/CallLead.ts
 M src/models/FormLead.test.ts
 M src/models/FormLead.ts
 M src/services/crm/formLeadPayload.test.ts
 M src/services/crm/formLeadPayload.ts
 M src/services/domainCommands/entityChange.ts
 M src/services/domainCommands/index.ts
 M src/services/domainCommands/types.ts
 M src/services/granotLifecycle/authorizedDesiredState.test.ts
 M src/services/granotLifecycle/identity.test.ts
 M src/services/granotLifecycle/identity.ts
 M src/services/granotLifecycle/leadDesiredState.test.ts
 M src/services/granotLifecycle/leadDesiredState.ts
 M src/services/granotLifecycle/processor.test.ts
 M src/services/granotLifecycle/processor.ts
 M src/services/granotLifecycle/sourcePolicy.ts
 M src/services/ingestion/ingestion.test.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-19-COMPLETION.md
?? src/services/granotLifecycle/createLeadFromGranot.replica.test.ts
?? src/services/granotLifecycle/createLeadFromGranot.test.ts
?? src/services/granotLifecycle/createLeadFromGranot.ts
```

No commit, push, deploy, production mutation, live payload exposure, production index/migration apply, Registry change, Sheet/CRM send, notification, email, or other external send occurred. Only disposable test-database fixture writes, cleanup, and index synchronization occurred.
