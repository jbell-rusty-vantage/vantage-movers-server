# Unit 14 — Source policy resolution and source-scoped identity ladders

> **Contract maturity: implementation-ready; implementation remains blocked by Units 10–13 and the shared-branch sequence.** This is the identity half of S09. It resolves reviewed Registry policy before identity and returns deterministic candidates, conflicts, Agent assertions, and Booking context. It does not plan or mutate desired Lead state.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–8.4, 10–16 (identity and Agent portions), 25, 27, 35–37, 38/S09, and 39–41.
- **Acceptance ownership:** complete identity proof for AC-03, AC-04, and the identity portions of AC-07, AC-09, AC-13, AC-29, and AC-39. Desired-state/live-effect proof remains Units 15, 18, 19, 22, and 23.
- **Approved split:** Unit 14 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 13 supplies the Lead provenance/index fields this unit reads. Unit 15 owns temporal order, desired-state planning, pending scheduling, gate snapshots, and processor orchestration. Unit 18 owns matched Lead writes.
- **Execution:** delivery runbook, repository instructions, verified Unit 04–07 and Unit 12–13 completion reports, current source-policy/processor/Lead/Agent/Booking code, and actual deployed indexes.

The final specification wins. Identity must not fall back across Source Scope, reinterpret `legacy_unknown`, turn payload `type=AUTO` into source identity, or mutate a Lead to make a match succeed.

## 2. Objective

Add the production `identity.ts` boundary under `src/services/granotLifecycle/` and prove the complete Form, Call, Agent, Record Link, and Booking identity rules after reviewed Registry policy resolution. Return only stable entity references, match method, candidates/reason codes, eligibility/explanation, and deterministic Booking context for Unit 15; create no Decision, desired state, Lead/Booking/Cancellation write, case, discrepancy, command, Change, outbox item, or notification.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** verified Units 04–07 and 12–13, plus the shared-branch sequence through Unit 13. Units 10–11 are indirect prerequisites through Unit 12.
- Before editing, reverify the exact Unit 12 Lead fields/validators/indexes and Unit 13 migration/index results; Unit 05–06 Registry semantics and routes; Unit 07 Decision/Record Link contracts; Form/Call model collection and source fields; active Agent lookup; the Booked Lead normalized-Job unique index; and the existing `BookingLeadReconciliationCase` service/model.
- Do not commit, push, deploy, inspect current payload/customer values, apply migrations, enable flags, mutate production, or send external work.

## 4. Current-state evidence to verify

Observed on 2026-08-17; reverify after Units 10–13 because this contract intentionally depends on their finished shapes:

- `sourcePolicy.ts` already performs exact normalized Registry lookup, fail-closed zero/multiple handling, Form route selection, active Source Company/Granularity checks, and provider-type non-use. Consume that boundary; do not copy policy into identity queries.
- `processor.ts` currently stops after normalization/policy and optional job-level historical Record Link evidence. It does not select a Lead; `input.initiator` is currently ignored. Unit 15, not this unit, replaces that orchestration.
- No production `src/services/granotLifecycle/identity.ts` exists.
- At this checkpoint Form has `ref_no`, `duplicate`, `bad_lead`, current contact, and Source Scope but no Unit 12 Job/origin/snapshot fields; Call has Job/current contact/RingCentral transport and Source Scope but no Unit 12 origin/snapshot fields. Consume the verified Unit 12 result, not a workaround for a missing prerequisite.
- `GranotRecordLink` has the unique active normalized-Job lookup and may contain `lead_ref`, `booking_ref`, and `source_scope`. Unit 07 historical rows may be job-level links without a Lead; absence of `lead_ref` is evidence, not a target.
- `receiverAgentCrmUsername.ts` currently contains a mutating extension-era helper and writes `extension_crm_username_match`. Identity may reuse a pure catalog lookup/normalizer, but must not call that mutator. Unit 12 must have added canonical `granot_username_match` provenance.
- Agent identity may exist in `granot_identity.username` and compatibility `granot_crm_username`. A cross-field lookup can expose contradictory rows despite individual indexes; exactly one active Agent is required.
- `BookingLeadReconciliationCase` is an existing separate workflow. A Booking without a Lead delegates there; do not invent a Granot case or candidate search.

## 5. Locked decisions and invariants at risk

- **Invariant 1 — MongoDB is the System of Record:** candidates come from current Mongo aggregates/Registry/links, never Sheet labels or client-selected targets.
- **Invariant 2 — Observation is evidence:** Booking context cannot change an official Booking/Cancellation.
- **Invariant 4 — one Booking per normalized Job:** multiple current rows/index contradiction is a hard conflict and operational blocker.
- **Invariant 5 — canonical commands own mutations:** this unit is read-only.
- **Invariant 8 — provenance axes stay independent:** source label/policy, channel, origin, actor, and initiator never substitute for one another.
- **Invariant 9 — immutable evidence survives:** current and immutable contact states may both match without rewriting either.
- **Invariant 10 — identity conflict never reassigns Source Company, Source Granularity, Ingestion Origin, or CPL.**
- **Invariant 11 — Duplicate/Bad Form rules remain exact:** Duplicate is never eligible; Bad is exact-identity evidence/Priority-only and never contact matched or suggested.

## 6. Deliverables and exact contract

### 6.1 Production boundary and result

Create `src/services/granotLifecycle/identity.ts` and export it through the lifecycle module boundary. The production interface accepts a persisted Observation plus the already-resolved `SourcePolicySnapshot` and returns a read-only result equivalent to:

```ts
type LeadIdentityResult = {
  outcome: "linked" | "pending_match" | "unmatched" | "ambiguous" | "conflict";
  reason_code: SynchronizationReasonCode;
  match_method?:
    | "granot_record_link"
    | "form_ref_no_exact"
    | "form_mongo_id_compatibility"
    | "call_job_no_exact"
    | "booking_job_no_exact"
    | "source_scoped_contact";
  target?: EntityRef; // FormLead or CallLead only
  candidates: Array<{ target: EntityRef; reason_codes: string[] }>;
  target_eligibility?: "full" | "priority_only";
  agent?: { target: { model: "Agent"; id: string }; normalized_username: string };
  booking_context?: {
    booking?: { model: "BookedLead"; id: string };
    owner_lead?: EntityRef;
    booking_lead_reconciliation_required: boolean;
    referral_leadless: boolean;
  };
};
```

`target_eligibility` and the Agent/Booking wrappers are **issue-author interface guidance**: the final specification fixes their meaning but not a transport type. Keep them internal/non-persistent unless a later authoritative model owns them. Persisted Decision `match_method`, `target`, and `candidates` use final-spec fields/vocabulary only.

The resolver must:

1. receive successful `source_scoped_lead` policy before any Lead lookup;
2. reject missing/invalid/inactive scope without querying globally;
3. execute one model-specific ladder in order and stop on a strong exact conflict;
4. deduplicate the same Lead found through multiple immutable/current contact values;
5. return candidate IDs/reason codes only—no copied name, phone, email, address, Job, or payload values.

### 6.2 Form Lead ladder

Execute in this exact order:

1. active `GranotRecordLink` by normalized Job Number;
2. exact eligible non-duplicate `FormLead.ref_no` using `Observation.identity.normalized_form_ref`;
3. if that value is a valid 24-character Mongo ObjectId, exact eligible non-duplicate `FormLead._id` compatibility lookup;
4. exact resolved Source Company **and** Source Granularity contact match across current submitted contact, `ingested_contact_snapshot`, and accepted `granot_contact_snapshot` normalized phone/email values;
5. otherwise pending/ambiguous/conflict/unmatched explanation for Unit 15.

Rules:

- Blank/`not provided`/`not_provided` references normalized absent by Unit 04 are never queried.
- A Record Link with `lead_ref` is usable only when model, existence, restrictions, normalized Job, and Source Scope agree. A job-only link does not become a Lead target; retain it as evidence and continue.
- Exact ref/ObjectId matches verify canonical `lead_source_company` and `source_granularity_id`. Compatibility strings/labels cannot override missing/conflicting canonical scope.
- Any exact candidate with conflicting known scope returns `conflict/source_scope_conflict`; do not continue to contact fallback.
- Conflicting nonempty Lead Job and Observation Job returns `conflict/job_number_conflict`; never overwrite or search globally for another candidate.
- `duplicate=true` is always excluded and explained with `duplicate_form_lead_ineligible`.
- A Bad Form Lead may be returned only from Record Link/ref/ObjectId strong exact identity with `priority_only`; it may later store valid Priority/link evidence only. Exclude it from contact matching, Agent suggestion, enrichment, Booking suggestion/case, and creation. Never clear `bad_lead`.
- Zero eligible contact candidates does not guess. More than one distinct eligible candidate is `ambiguous/multiple_eligible_matches`.

### 6.3 Call Lead ladder

Execute in this exact order:

1. active Record Link by normalized Job Number;
2. exact `CallLead.normalized_job_no` inside the resolved Source Granularity;
3. resolved Source Granularity plus normalized phone across current phone, `ingested_contact_snapshot.normalized_phone_number`, and immutable original RingCentral caller/ingestion phone when present;
4. otherwise pending/ambiguous/conflict/unmatched explanation for Unit 15.

- Validate Record Link model/scope/Job exactly as for Form.
- Never query normalized Job or contact without the resolved `source_granularity_id` constraint.
- Duplicate Call Leads remain readable identity candidates because Invariant 11 excludes only Duplicate Form Leads; do not alter duplicate classification.
- Job/contact values pointing to different eligible Leads are `conflict`; retain both masked refs. Multiple same-rung candidates are `ambiguous`; never choose newest arbitrarily.
- Current and immutable values are alternative evidence for one Lead, not separate candidates.

### 6.4 Agent assertion and lookup

- Preserve `user_raw` and `rep_raw`; never rewrite Observation evidence.
- Normalize each nonempty value with the Operations Registry Granot username normalizer.
- Equal normalized nonempty values are one assertion. Different nonempty values preserve `granot_agent_identity_conflict`, return no Agent, and cannot block independent non-Agent behavior in Unit 15.
- Suggest an Agent only when exactly one active Agent matches across canonical `granot_identity.username` plus compatibility `granot_crm_username`. Zero returns no suggestion; more than one distinct Agent fails closed and returns none.
- Existing receiver state is not permission to overwrite: Unit 15 may plan a fill only when empty. Never create, activate, verify, or mutate an Agent.

### 6.5 Deterministic Booking context

- Normalize Job with shared `normalizeJobNo` and resolve the active Record Link plus unique current Booking.
- A Booking's existing Lead is deterministic owner context even when it differs from a contact candidate; disagreement is conflict evidence, not reassignment.
- If the Booking has no Lead, set `booking_lead_reconciliation_required=true` and delegate to existing `BookingLeadReconciliationCase`; do not open/duplicate that workflow.
- `referral_booking` is intentionally leadless: return `referral_leadless=true`, no Lead ladder, and no Lead search.
- No Booking case, Granot discrepancy, Booking suggestion, update, create, cancellation, or link correction occurs here.

### 6.6 Integration and documentation

- Keep `sourcePolicy.ts` the sole Registry semantic resolver. `identity.ts` consumes its snapshot and never treats client `expected_target` as authority.
- Unit 14 may expose direct production Module tests but must not replace Unit 07 orchestration; Unit 15 performs integration.
- Update lifecycle/Lead identity docs and applicable rules with ladder order, scope constraints, Bad/Duplicate behavior, Agent assertions, and Booking delegation.

## 7. Explicitly out of scope

- Temporal winner/tie-break, desired state, Priority planning, pending clock, gate orchestration, Decision integration, or compare-and-swap (Unit 15).
- Lead mutation/link confirmation with a target, `EntityChange`, Sheet Sync, matched writes (Unit 18), or Lead creation/link reservation (Unit 19).
- Unit 12 schema/snapshot/index work or Unit 13 migration/index apply.
- Booking/Release case creation, commands, discrepancies, correction, Referral Booking, Admin UI, extension/automation apply, RingCentral adoption, or cleanup.
- Global contact matching, source/CPL reassignment, Agent mutation, booking suggestion for a Bad Lead, or raw/PII projections.

## 8. Flags and runtime posture

Starting and ending posture remain:

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

Identity is read-only. Do not write activation or enable an effect.

## 9. Migration and indexes

**None.** Units 12–13 own Lead schema/index/migration prerequisites; Unit 07 owns Record Link indexes; Unit 06 owns Registry indexes. Re-run their read-only verifies when available. Do not add a global unique Lead Job/contact index or apply production indexes.

## 10. Acceptance criteria

- [ ] **AC-03 exact release assertion (identity completion):** “Form CRM Posting sends `FormLead.ref_no` as `leadno`; Granot `ref_no` round-trips to exact Form Lead; valid Mongo ID fallback remains compatible.” Prove the two exact rungs and scope eligibility; do not change outbound posting.
- [ ] **AC-04 exact release assertion:** “Exact identity with conflicting Source Scope yields conflict and no mutation/reassignment.” Prove for link, Form ref/ObjectId, Call Job, and Booking owner context.
- [ ] **AC-07 exact release assertion (identity portion):** “Matched-existing Lead Created links/enriches without creating a second Lead.” Prove one deterministic eligible target/no global fallback; Units 15/18 prove planning/live effects and Unit 19 creation races.
- [ ] **AC-09 exact release assertion (routing/identity portion):** “Best Relocation Form same valid state routes Local; differing valid states route long-distance; invalid/missing states do not create.” Consume Unit 05–06 routing before identity and prove invalid/missing route yields no target/creation authority.
- [ ] **AC-13 exact release assertion (identity portion):** “Receiver Agent fills at a non-1/5 Priority through one active username match; differing `user`/`rep` blocks assignment; existing receiver is never overwritten.” Prove assertion/suggestion only; Units 15/18 own plan/mutation.
- [ ] **AC-29 exact release assertion (identity portion):** “Paid Overflow and source Auto remain deferred/evidence-only; payload `type=AUTO` does not alter source classification.” Neither deferred policy nor provider context enters a Lead ladder.
- [ ] **AC-39 exact release assertion (identity foundation):** “Booking missing its Lead uses existing Booking Lead Reconciliation, not a Granot discrepancy or duplicate workflow.” Return delegation context only; Units 22–23 own service/UI proof.
- [ ] Every rung, zero/multiple candidate, same-candidate dedupe, strong conflict, Bad/Duplicate rule, and job-only link behavior is deterministic and read-only.
- [ ] Candidate output contains IDs/reason codes only and no raw contact, Job, source/customer value, payload, credential, or unmasked PII.

## 11. Required tests and commands

- Pure tests for policy-before-identity, ladder order, ObjectId compatibility, scope conflicts, current+immutable dedupe, no global query, Agent assertion, and Referral leadless behavior.
- Production Module/store tests with synthetic rows for link/Lead/Booking contradictions, restrictions, multiple candidates, and Booking-without-Lead delegation.
- Replica-set tests only for claims relying on Mongo uniqueness. Test names include owned AC IDs and assert zero writes to every lifecycle/aggregate/effect collection.

Run exactly:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/sourcePolicy.test.ts" "src/services/granotLifecycle/identity.test.ts" "src/services/granotLifecycle/identity.module.test.ts" "src/services/agents/receiverAgentCrmUsername.test.ts"
pnpm test:granot-lifecycle:replica -- --unit=14
pnpm test
pnpm typecheck
```

If conventions consolidate the new test files, record actual paths in the handoff without weakening test levels.

## 12. Live/staging verification

- In a disposable replica set, seed redacted synthetic rows for every rung, conflict, current/immutable match, restriction, Agent conflict, job-only/full link, unique Booking, Booking-without-Lead, and Referral policy.
- Run the production identity interface; record outcome/reason/match-method counts and masked IDs only. Assert database before/after equality for every collection.
- Production remains read-only and separately approved. Never inspect/report raw payload/contact/Job values.

## 13. Rollback

- Remove/disable the identity caller first; Unit 07 policy/job-link behavior remains the compatible fallback until Unit 15 lands.
- No data rollback exists because this unit writes no data. Preserve all receipts, Observations, Decisions, activation, links, aggregates, cases, Commands, Changes, and outbox evidence.
- Never loosen scope or use global/legacy matching as rollback.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-14-COMPLETION.md` per Runbook Section 13, including:

- files grouped by identity/policy/Agent/Booking/docs behavior;
- Sections 8.4/12–16/25, invariants 1–2/4–5/8–11, S09 identity allocation, and AC-03/04/07/09/13/29/39 mapping;
- implemented ladder table, result contract, query scope, restriction matrix, Agent conflict behavior, and Booking delegation;
- prerequisite migration/index verification, flags, focused/full/replica outcomes, privacy scan, and zero-write proof;
- contradictions/compatibility retained, final `git status --short`, and external-action statement.

Successful verified implementation completes the identity half of S09 and unblocks **Unit 15**. Unit 15 must consume this resolver rather than reconstructing identity inside the processor.
