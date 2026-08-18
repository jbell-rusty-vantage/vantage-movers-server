# Unit 14 completion — Source policy resolution and source-scoped identity ladders

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–8.4, 10–16 (identity and Agent portions), 25, 27, 35–37, 38/S09 identity allocation, and 39–41
- **Acceptance ownership:** complete identity proof for AC-03, AC-04, and the identity portions of AC-07, AC-09, AC-13, AC-29, and AC-39. Desired-state/live-effect proof remains Units 15, 18, 19, 22, and 23.
- **Applicable invariants preserved:** 1 (candidates from current Mongo aggregates/Registry/links), 2 (Booking context cannot change official Booking/Cancellation), 4 (multiple current Bookings are a hard conflict), 5 (this unit is read-only), 8 (source/channel/origin/actor/initiator never substitute), 9 (current and immutable contact may both match without rewrite), 10 (no Source Company/Granularity/origin/CPL reassignment), 11 (Duplicate Form ineligible; Bad Form `priority_only` from strong exact identity only)
- **Runtime posture:** callable `resolveLeadIdentity` returns candidates/explanations only. The Unit 07 processor is unchanged and does not invoke identity. Capture does not invoke identity. All eight effect flags stay false.

## Files added or changed

### Identity / policy

- `src/services/granotLifecycle/identity.ts` — production read-only Form/Call ladders, Agent assertion, Booking delegation context
- `src/services/granotLifecycle/sourcePolicy.ts` — additive `selected_lead_model` on a successful route snapshot so identity does not re-resolve Registry semantics
- `src/services/granotLifecycle/sourcePolicy.test.ts` — AC-09 snapshot now asserts `selected_lead_model: "FormLead"`

### Agent / Booking (consume only)

- `src/services/agents/receiverAgentCrmUsername.test.ts` — rerun only; identity uses `normalizeGranotCrmUsername` and never calls `applyGranotCrmUsernameReceiverMatch`
- Existing `BookedLead` / `BookingLeadReconciliationCase` remain the Booking-without-Lead workflow; this unit writes no case

### Tests

- `src/services/granotLifecycle/identity.test.ts` — pure policy-before-identity, ladder order, ObjectId compatibility, scope/job conflicts, current+immutable dedupe, no global query, Agent assertion, Referral leadless
- `src/services/granotLifecycle/identity.module.test.ts` — production interface with synthetic store rows for link/Lead/Booking contradictions, restrictions, multiple candidates, Booking-without-Lead
- `src/services/granotLifecycle/identity.replica.test.ts` — disposable replica zero-write, scoped Call Job, Agent cross-field contradiction, Booking-without-Lead
- `scripts/test-granot-lifecycle-replica.ts` — `--unit=14` registration

### Docs

- `.cursor/businesslogic/granotLifecycle.identity.md` — new
- `.cursor/businesslogic/granotLifecycle.sourcePolicy.md`
- `.cursor/businesslogic/granotLifecycle.processor.md`
- `.cursor/businesslogic/form-lead.service.md`
- `.cursor/businesslogic/call-lead.service.md`
- `.cursor/index.md`
- `.cursor/rules/granot-lifecycle-capture.mdc`
- `.cursor/rules/project-organization.mdc`

## Exact contracts landed

### Result contract

`resolveLeadIdentity({ observation, policy, policy_failure? }, store?)` returns in-memory:

| Field | Meaning |
| --- | --- |
| `outcome` / `reason_code` | Spec `SynchronizationOutcome` / `SynchronizationReasonCode` |
| `match_method` | `granot_record_link` \| `form_ref_no_exact` \| `form_mongo_id_compatibility` \| `call_job_no_exact` \| `booking_job_no_exact` \| `source_scoped_contact` |
| `target` | `FormLead` or `CallLead` `EntityRef` only |
| `candidates` | IDs and reason codes only |
| `target_eligibility` | `full` or `priority_only` (not persisted) |
| `agent` | in-memory `{ model: "Agent"; id }` plus normalized username; not an `EntityRef` |
| `booking_context` | Booking ref, owner Lead, `booking_lead_reconciliation_required`, `referral_leadless` |

### Implemented ladder

| Rung | Form | Call |
| --- | --- | --- |
| 1 | Active Record Link by normalized Job | Active Record Link by normalized Job |
| 2 | Exact non-duplicate `ref_no` | Exact `normalized_job_no` inside Source Granularity |
| 3 | 24-hex ObjectId `_id` compatibility | Source Granularity + current/ingested phone |
| 4 | Source Company **and** Granularity contact (current + ingested + Granot snapshots) | pending/ambiguous/conflict/unmatched |
| 5 | pending/ambiguous/conflict/unmatched | — |

Job-only links continue. Usable `lead_ref` requires model, existence, restrictions, Job, and Source Scope agreement. Strong exact scope/job/link conflicts stop and do not fall through to contact. Blank/`not provided` Form references are never queried. Duplicate Form Leads are `duplicate_form_lead_ineligible`. Bad Form Leads are `priority_only` from Record Link/ref/ObjectId only and are excluded from contact matching and Agent suggestion. Duplicate Call Leads remain readable. Same Lead via current and immutable contact is one candidate.

### Query scope

- Deferred / missing route / inactive or missing company / missing `selected_lead_model` / `policy_failure`: no Lead query
- Referral: no Lead ladder or Lead search; `referral_leadless=true`
- Form contact queries always include Source Company and Source Granularity
- Call Job/phone queries always include `source_granularity_id`
- `provider_context.type_raw` / payload `type=AUTO` is ignored
- `legacy_unknown` is not a match signal

### Restriction matrix

| Restriction | Exact Record Link / ref / ObjectId | Contact fallback |
| --- | --- | --- |
| Form `duplicate=true` | ineligible, explained | excluded |
| Form `bad_lead` set | `priority_only` | excluded |
| Call `duplicate=true` | readable | readable |
| Missing/conflicting canonical scope | `source_scope_conflict`, stop | not queried globally |
| Conflicting nonempty Jobs | `job_number_conflict`, stop | `job_number_conflict` |

### Agent conflict behavior

Equal normalized nonempty `user`/`rep` are one assertion. Different nonempty values set `agent_assertion: "conflict"` and return no Agent without blocking Lead identity. Exactly one active Agent across `granot_identity.username` plus `granot_crm_username` may be suggested. Zero or more than one distinct Agent returns none.

### Booking delegation

Unique current Booking by shared `normalizeJobNo`. Multiple current Bookings → `conflict` / `job_number_conflict`. Owner Lead is deterministic context; disagreement with a ladder candidate is conflict evidence. Booking without a Lead → `booking_lead_reconciliation_required=true`; existing `BookingLeadReconciliationCase` is not opened or duplicated.

## Prerequisite migration / index verification

**None applied by this unit.** Reverified from Unit 13 completion and repository state:

- Seven non-unique Lead S08 indexes remain declared; no global unique Lead Job/contact index was added
- Unit 07 active Record Link unique index remains the job-level lookup contract
- Booked Lead unique `{ normalized_job_no: 1 }` remains the Booking constraint
- Unit 12 origin/snapshot fields are consumed read-only; `legacy_unknown` / `legacy_baseline` are not reinterpreted

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

Identity is read-only. No activation write. No later effect enabled.

## Verification

### Focused

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/sourcePolicy.test.ts" "src/services/granotLifecycle/identity.test.ts" "src/services/granotLifecycle/identity.module.test.ts" "src/services/agents/receiverAgentCrmUsername.test.ts"
```

**40 pass / 0 fail** (includes existing source-policy and receiver-agent tests).

### Replica

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=14
```

**5 pass / 0 fail.** Database before/after equality held for `form_leads`, `call_leads`, `booked_leads`, `agents`, `granot_record_links`, `granot_observations`, `granot_webhook_receipts`, `synchronization_decisions`, `entity_changes`, `domain_command_executions`, `sheet_sync_jobs`, and `booking_lead_reconciliation_cases`. Results recorded outcome/match-method and masked IDs only.

### Full repository

```text
pnpm test
pnpm typecheck
git diff --check
```

- `pnpm test`: **1218 tests, 1192 pass, 0 fail, 26 skipped**
- `pnpm typecheck`: pass
- `git diff --check`: pass

## AC-to-proof coverage

| AC | Identity assertion | Proof |
| --- | --- | --- |
| AC-03 | `ref_no` exact + 24-hex ObjectId compatibility; blank never queried; no outbound posting change | `identity.test.ts` |
| AC-04 | Scope conflict on link, Form ref/ObjectId, Call Job, Booking owner; no mutation | `identity.test.ts`, `identity.module.test.ts`, `identity.replica.test.ts` |
| AC-07 | One deterministic eligible target; no global fallback; no second Lead | `identity.test.ts`, `identity.module.test.ts`, replica zero-write |
| AC-09 | Invalid/missing route yields no target/creation authority; consume Unit 05–06 routing first | `sourcePolicy.test.ts` + identity no-query test |
| AC-13 | Assertion/suggestion only; `user`/`rep` conflict; cross-field >1 Agent fails closed | `identity.test.ts`, replica Agent contradiction; existing receiver mutator tests unchanged |
| AC-29 | Deferred policy and provider `type=AUTO` do not enter a Lead ladder | `sourcePolicy.test.ts` + identity deferred no-query test |
| AC-39 | Booking without Lead returns delegation context only | `identity.module.test.ts`, replica |

## Privacy / zero-write / concurrency

- Candidate output and replica reports contain IDs/reason codes only
- Synthetic phones use the `555000xxxx` fixture range and never appear in resolver output
- Identity store methods are reads only; module tests assert no write helpers are invoked
- Replica uniqueness claim for this unit is Agent cross-field contradiction (two active Agents can exist despite per-field unique indexes). Record Link uniqueness remains Unit 07; this unit uses `findOne` and does not create that index
- Mongo uniqueness of Bookings is unchanged; identity treats multiple current Bookings as `conflict`

## Known risks / deferred compatibility

- `LeadIdentityResult` wrappers are issue-author transport; Unit 15 persists Decision fields only
- `linked` here means a deterministic eligible target, not a Record Link write
- Form contact matching uses scoped phone **or** email across current/ingested/Granot snapshots. The Form identity index remains phone+duplicate; email queries stay Source-scoped and are not a global fallback
- Disputed Record Links stay in lookup; they become a target only when model/existence/Job/scope/restrictions agree
- Username normalizer is the Operations Registry trim+uppercase helper, not a new algorithm
- Unit 07 processor still stops after policy/job-level link and does not call identity (compatible fallback until Unit 15)
- Shared-test-DB Lead S08 indexes may remain unapplied; identity does not require them

## Newly unblocked

**Unit 15** — Temporal ordering, desired-state planning, and shadow processor orchestration. Unit 15 must consume `resolveLeadIdentity` rather than reconstructing identity inside the processor.

Units 16–17 remain blocked until Unit 15 is complete.

## External-action statement

No commit, push, deploy, production mutation, live-payload inspection, migration apply, flag enablement, or external send occurred.

## Final `git status --short`

`vantage-main-server` / `granot-lead-lifecycle` only. Other program repositories were not touched.

```text
 M .cursor/businesslogic/call-lead.service.md
 M .cursor/businesslogic/form-lead.service.md
 M .cursor/businesslogic/granotLifecycle.processor.md
 M .cursor/businesslogic/granotLifecycle.sourcePolicy.md
 M .cursor/index.md
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/project-organization.mdc
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/services/granotLifecycle/sourcePolicy.test.ts
 M src/services/granotLifecycle/sourcePolicy.ts
?? .cursor/businesslogic/granotLifecycle.identity.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-14-COMPLETION.md
?? src/services/granotLifecycle/identity.module.test.ts
?? src/services/granotLifecycle/identity.replica.test.ts
?? src/services/granotLifecycle/identity.test.ts
?? src/services/granotLifecycle/identity.ts
```
