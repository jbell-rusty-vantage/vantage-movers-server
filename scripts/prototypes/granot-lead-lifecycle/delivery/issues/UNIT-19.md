# Unit 19 — Authorized Granot Lead creation and atomic link reservation

> **Contract maturity: implementation-ready; implementation remains blocked by Unit 18.** This is S13. It converts an authorized, complete, post-activation `lead_created` Observation with no eligible match into exactly one canonical Form or Call Lead plus its active Granot Record Link. RingCentral adoption, reconciliation, and every Booking/Cancellation effect remain later work.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–8.4, 9.4, 11–17, 23.1–23.4, 25, 27, 34.7, 35–37, 38/S13, and 39–41.
- **Acceptance ownership:** creation/no-second-Lead completion for AC-07, full AC-08, and creation/routing completion for AC-09.
- **Approved split:** Unit 19 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Units 12–15 own Lead fields/validators/indexes, policy, identity, temporal planning, and shadow orchestration. Unit 18 owns matched-Lead mutation and link attachment. Unit 20 owns qualified-call adoption and duplicate correctness.
- **Execution:** the delivery runbook; repository instructions/rules/docs; verified Unit 12–18 completion reports and current repository state; the current Registry, identity, planner, processor, trusted Lead creation validation, Record Link, command executor, `EntityChange`, and Sheet Sync outbox seams.

The final specification wins on conflict. The processor and canonical command may load an Observation and Registry policy by durable identity; routes, clients, and payloads may not supply a Lead patch, source attribution, Ingestion Origin, or effect authorization.

## 2. Objective

Implement and invoke canonical `createLeadFromGranot` only for a live, temporally accepted `lead_created` Observation when the full source-scoped identity ladder has found no eligible Lead, current reviewed Registry policy is `create_if_missing`, all effect gates pass, the deterministic route is active, and immutable minimum creation data is complete. In one Mongo transaction, create exactly one correctly routed Form/Call Lead, preserve its immutable creation evidence, reserve the active Record Link, insert the preallocated Decision, record one idempotent Command and append-only creation Changes/revisions, and queue the correct Sheet Sync intent. Concurrency, replay, incomplete data, invalid routing, or identity drift must never create an orphan or second Lead.

## 3. Repository, branch, and prerequisites

- **Repository/branch:** `vantage-main-server` / `granot-lead-lifecycle` only.
- **Blocked by:** completed Unit 18 with its focused/full/replica proof. Verify the completion report against the repository; do not rely on the status row.
- Reverify Unit 12–13 Lead provenance fields, contextual trusted validators, and seven Lead indexes; Unit 14 policy-before-identity ladders and deterministic route; Unit 15 minimum-data/planner/processor behavior; Unit 18 canonical effect orchestration and active-link transaction primitives; Unit 10–11 executor/Command/Change/outbox foundations; and the Unit 07 active Record-Link unique partial index.
- Confirm that Unit 18 did not expose a caller-supplied desired state or bypass command/context validation. Creation must compose the same processor, Decision, transaction, and post-commit outbox seams.
- Before runtime writes, require `TEST_MODE=true`, a disposable Mongo replica set, `SHEET_SYNC_MODE=disabled`, synthetic activation/source fixtures, and explicitly injected live/creation flags. No production Registry change, flag enablement, migration apply, or source rollout is authorized.
- Preserve unrelated/user changes. No commit, push, deploy, production mutation, live-payload inspection, Sheet/CRM send, or external action.

## 4. Current-state evidence to verify

Observed on 2026-08-18; reverify at implementation start:

- `leadDesiredState.ts` already returns terminal `insufficient_creation_data` with `missing_creation_job_number`, `missing_creation_contact`, or `missing_creation_route_data`. Eligible `create_if_missing` is intentionally `shadow_effect_suppressed`; it does not reserve or create anything.
- `processor.ts` already evaluates `lead_creation_enabled` for unmatched creation plans but has no production creation command path. Checked-in lifecycle defaults keep shadow true and creation false.
- `CanonicalDomainCommands` and `canonicalDomainCommands` do not expose `createLeadFromGranot`. Existing `createFormLead`/`createCallLead` use public compatibility DTOs and are not the trusted lifecycle creation contract.
- Unit 12 landed trusted contextual Lead creation parsing, `ingestion_origin`, immutable snapshots, Job parity, Call `quoted`, convergence state, revisions, and required indexes. `CallLead` permits Job Number without phone; ordinary public/RingCentral creation rules must remain stricter.
- The current Registry command already supports audited Owner mutation of `lead_created_policy`; migration left reviewed Best Relocation source families at `link_only`. Runtime creation must not silently rewrite Registry policy.
- The active Record-Link uniqueness contract is `{ provider:1, normalized_job_no:1 }` with partial `state:"active"`. It, not a globally unique Lead Job Number, is the final no-second-Lead race guard.
- Current source policy/identity code resolves a selected Lead model, active Source Company/Granularity, and exact Form Local/long-distance route before planning. RingCentral route resolution is a separate existing seam and must also prove one active assignment for a RingCentral-facilitated Call source. Reuse both seams; do not reconstruct route rules in the command.
- RingCentral qualified-call ingest still has no Granot adoption seam. This unit creates `ringcentral_convergence.state = "pending"` when an authorized Granot-created Call has a normalized phone and `"not_applicable"` when Job-only; Unit 20 owns later adoption.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo Registry, Lead, Record Link, Decision, Command, Change, and outbox state are authoritative; Granot, a client route, preview, or Sheet is not.
- **Invariants 2–3:** Lead Created evidence may create an authorized Lead, but creates no stored lifecycle enum and no official Booking/Cancellation fact.
- **Invariant 5:** only `createLeadFromGranot` through the canonical executor creates this Lead. The processor, routes, and legacy public create services may not write it directly.
- **Invariant 6:** Lead creation, active-link reservation, preallocated Decision, `DomainCommandExecution`, creation `EntityChange` rows/revision transitions, and Sheet outbox intent commit in one Mongo transaction.
- **Invariant 7:** replay, race loss, invalid/incomplete data, and an already-existing eligible Lead create no Change, revision, outbox, or second Lead.
- **Invariant 8:** source system, receipt channel, immutable `granot_lead_created` Ingestion Origin, fixed processor actor, and receipt initiator remain independent provenance axes.
- **Invariant 9:** the creation contact/move snapshot is immutable. Sparse Call creation fabricates no telephony, duration, qualification, session, route, or caller evidence.
- **Invariant 10:** policy/identity conflict never reassigns Source Company, Source Granularity, Ingestion Origin, or CPL.
- **Invariant 11:** Duplicate Form Leads are ineligible. A Bad Form exact match remains Unit 18's Priority/link-only path and never falls through to creation.

## 6. Deliverables and exact contract

### 6.1 Final authorization and ladder-before-create

The common processor may propose creation only when all are true:

1. the normalized event is `route_event_class:"lead_created"`;
2. execution mode is `live`, `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=true`, and all eight Unit 15/18 gates pass for creation;
3. the current reviewed Registry row is operationally and lifecycle enabled, disposition `source_scoped_lead`, policy `create_if_missing`, and its resolved Source Company/selected Granularity are active;
4. the complete Unit 14 identity ladder has run once against current state and returns no eligible target, ambiguity, conflict, Duplicate/Bad restriction, or pending `link_only` match;
5. the Observation is temporally eligible and `evaluateMinimumCreationData` returns `eligible`; and
6. the selected Form/Call route is deterministic and agrees exactly with the source scope passed to the command; a RingCentral-facilitated Call route also resolves exactly one active RingCentral assignment.

Reload Registry policy, active Record Link, and identity candidates immediately before command invocation. Inside the transaction, revalidate the active route/scope and rerun the race-sensitive exact lookups using the session. A source/policy/gate change fails closed with its existing exact outcome/reason; it never becomes a technical retry merely to force creation.

`link_only` retains the Unit 08 pending schedule and terminal `unmatched`. `observation_only`, deferred, disabled, inactive, shadow, or globally gated sources remain evidence-only. Missing immutable data is terminal for this Observation; a later complete Observation may create.

#### 6.1.1 WordPress/Vantage Form submission versus Granot-originated creation

Do not treat every Form-shaped `lead_created` Observation as authority to ingest a Form Lead. There are two distinct arrival paths:

1. **Vantage/WordPress Form submission already created the Lead.** Form Lead Ingestion remains the creation authority and stores `ingestion_origin:"wordpress_form"` plus immutable submitted contact/move snapshots. Its later Granot `lead_created` delivery must run the complete Form identity ladder and flow through Unit 18: prefer an existing active Record Link, then exact Granot `ref_no` to `FormLead.ref_no`, ObjectId compatibility, and finally exact Source Scope contact evidence. On one eligible match, establish or confirm the active Granot Record Link, preserve the WordPress origin and submitted snapshots, store the Receipt/Observation/Decision, and apply only Unit 18-authorized Granot snapshot/enrichment fields. Never create a second Form Lead.
2. **Granot is the reviewed creation authority for this source.** Only a current audited Registry policy of `create_if_missing`, after the full ladder returns no eligible Lead and all minimum-data/route/effect gates pass, may create the Form Lead through this unit with `ingestion_origin:"granot_lead_created"`.

A WordPress-backed Form route whose normal authority is Form Lead Ingestion must remain `link_only` (or more restrictive) during rollout. This prevents a Granot webhook that wins the delivery race against the original Form Lead transaction from minting a second Lead; the existing 24-hour match retry absorbs that race. `create_if_missing` is enabled only for a separately reviewed Granot-originated route, never merely because the payload is Form-shaped.

For the matched WordPress path, “store a snapshot” means preserving the credential-redacted Receipt and normalized Granot Observation as evidence and, when Unit 18 authorizes the mutation, storing Granot contact/current-fact provenance separately. It does not replace the immutable submitted snapshots, change Ingestion Origin, or copy the raw webhook payload onto the Lead.

### 6.2 Canonical command

Add the final-spec command to `CanonicalDomainCommands` and the production command registry:

```ts
createLeadFromGranot(input: {
  lead_model: "FormLead" | "CallLead";
  source_scope: {
    lead_source_company: string;
    source_granularity_id: string;
  };
  observation_id: string;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult>;
```

- The command loads the immutable Observation and current Registry route; it accepts no `data`, patch, Job Number, contact, route label, origin, CPL, convergence state, or `post_to_granot` value from a caller.
- Require command name `createLeadFromGranot`, fixed Granot lifecycle processor actor, complete receipt/Observation/preallocated Decision/channel provenance, and idempotency key `granot:create-lead:<observation_id>`.
- The checksum covers the Observation ID, selected Lead model, exact source-scope IDs, current policy/route version, and normalized creation semantics; it never includes a raw payload or secret-bearing transport envelope.
- Reject a context Observation mismatch, a non-ObjectId scope/Observation, a model/route mismatch, an inactive route, a non-`create_if_missing` current policy, or a non-Lead-Created Observation.
- Use transaction-bound internal creation primitives and the Unit 12 trusted lifecycle validator. Do not pass through public/admin Zod create schemas or start a nested transaction/command.

### 6.3 Deterministic Lead creation mapping

For both Lead models:

- derive Source Company, Source Granularity, source labels/snapshots, and route attribution only from the current resolved Registry route;
- set `ingestion_origin:"granot_lead_created"`, `post_to_granot:false`, normalized/raw Job Number, available normalized contact/move facts, initial temporal winner, creation evidence snapshots, and server-derived provenance;
- initialize aggregate history through the canonical creation Change (`revision_before:0`, `revision_after:1`); never accept a client revision;
- resolve CPL only through the existing exact source/rate policy. Missing-rate behavior follows the current canonical Lead contract; never invent or inherit CPL from a conflicting Lead;
- use the Observation capture time for evidence and the transaction `now` for mutation/change timestamps.

For `FormLead`:

- require one name component, normalized phone, valid origin/destination USPS state and five-digit ZIP, and the exact selected Local/long-distance Form Granularity;
- same valid origin/destination state selects Local; differing valid states select long-distance; missing/invalid state or ZIP is `insufficient_creation_data / missing_creation_route_data`;
- populate both the immutable ingested contact/move snapshots and the current allowed Form fields from the same accepted creation facts; persisted `move_size` may be absent, while ordinary WordPress/Admin/import schemas remain unchanged.

For `CallLead`:

- Job Number alone is legal only through this trusted command and reviewed Call route;
- a RingCentral-facilitated source requires one active Call Granularity and one active RingCentral route assignment; zero/multiple/inactive assignment is `insufficient_creation_data / missing_creation_route_data` and creates nothing;
- store available Granot facts without inventing `duration`, `start_time`, `end_time`, RingCentral session/call-log IDs, qualification, assignment, target number, or transport source;
- when a normalized phone exists, first search exact active Source Granularity + normalized phone using current and immutable original contact. One eligible existing Lead aborts creation and replans to Unit 18; multiple eligible matches return `conflict / multiple_eligible_matches`; none creates with convergence `pending`;
- Job-only creation sets convergence `not_applicable` and is never eligible for later adoption.

Section 17 uses the phrase `ringcentral_convergence_conflict` for the multiple-candidate condition although it is not a member of the Section 7 Decision reason union. **Issue-author reconciliation:** persist that literal only as bounded convergence/candidate diagnostic metadata where applicable; the `SynchronizationDecision` remains `outcome:"conflict", reason_code:"multiple_eligible_matches"`. Do not silently extend the locked reason union.

### 6.4 One transaction and active-link reservation

The processor preallocates the Decision ID and calls the transaction-owning executor once. Commit atomically:

1. the effect-bearing `SynchronizationDecision` as `created / lead_created_authorized` with selected route/scope and bounded effects;
2. exactly one Form/Call Lead with immutable Granot creation evidence and `domain_revision:1` after its creation Change;
3. exactly one active `GranotRecordLink` for `provider:"granot"` + normalized Job Number, with the new `lead_ref`, exact source scope, non-disputed state, Decision/Observation evidence, and its creation revision/Change;
4. append-only `EntityChange` rows for the created Lead and Record Link, using reference-safe contact/address fields;
5. exactly one `DomainCommandExecution` whose stored entity refs include both Lead and Record Link; and
6. exactly one queued `form_lead.create` or `call_lead.create` Sheet Sync intent.

The Lead and link must never become visible separately. The active-link partial unique index is the final reservation fence; do not add global uniqueness to Lead Job Number. Post-commit Sheet wake-up uses the existing finalizer and cannot roll back Mongo truth.

### 6.5 Replay, duplicate-key, and competing identity behavior

- Exact command replay returns the stored Lead/link refs and creates nothing else.
- Same idempotency key with different checksum is `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` and creates no partial state.
- A Lead/link/Command duplicate-key or competing identity race aborts the entire proposed transaction. Re-read outside the aborted transaction, rerun policy and the full identity ladder, and persist only the truthful result.
- If the winner's active link/Lead is the now-eligible target, flow through Unit 18 matched-link/synchronization behavior for this Observation; never retry blind creation.
- If the winner conflicts in Source Scope, model, Job Number, or identity, persist the exact `conflict` reason and do not attach/reassign it.
- Two simultaneous complete Observations for the same normalized Job Number must expose one created Lead, one active link, one creation causal chain, and a non-creating loser outcome.

### 6.6 Decision effects and absence of forbidden effects

The winning Decision contains bounded effects `lead_created`, `record_link_established`, and `sheet_sync_requested`, with entity IDs and safe changed-path summaries only. It contains no contact/address values or raw evidence. Incomplete/invalid/policy-blocked/shadow/conflict/race-loser Decisions claim none of those effects.

Creation never opens a Booking/Release case or discrepancy, creates/updates a Booking, creates/reverses a Cancellation, sends email, or invokes RingCentral. Priority `5` reconciliation remains disabled until Units 22+ even when the new Lead stores Priority.

## 7. Explicitly out of scope

- Matched-existing Lead mutation/link attachment already owned by Unit 18, except invoking that completed path after a creation race replan.
- RingCentral adoption, verified telephony metadata, adoption conflicts, duplicate classification changes, Call Log lease/telemetry, or cron cadence (Units 20–21).
- Booking/Release case/discrepancy models, owner commands/UI, Referral Booking, notifications, or email (Units 22–32); all related flags remain false.
- Registry migration or automatic policy enablement. A reviewed source changes `link_only` to `create_if_missing` only through the existing audited Owner command immediately before separately approved rollout.
- Historical shadow tool, production activation/rollout, legacy compatibility cleanup, or prototype retirement.
- Raw payloads, credentials, live customer data, or unmasked contact/address values in Decisions, Commands, Changes, links, outbox, logs, metrics, issue/handoff text, fixtures, or reports.

## 8. Flags and runtime posture

Starting and checked-in ending defaults remain:

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

Focused/replica tests may inject shadow false, Lead writes true, and Lead creation true with a synthetic post-activation receipt and reviewed `create_if_missing` source fixture. Implementation does not change checked-in defaults or Registry rows.

After separate rollout approval only: preserve Unit 18 Lead writes posture, set creation true, and change exactly one reviewed active Registry route from `link_only` to `create_if_missing` with an Owner reason/audit. All other sources and later effect flags remain disabled/fail-closed. Enable Form and Call routes independently when practical; never enable a later effect to prove creation.

## 9. Migration and indexes

**None.** Consume the verified Unit 12–13 Lead fields/non-unique indexes and Unit 07 active Record-Link unique partial index. Reverify their exact definitions and collision reports before rollout. This unit adds command/service code and tests only; it does not backfill Leads, create links for history, or apply production indexes.

The policy transition is not a migration. It is a separately authorized audited Registry mutation for one reviewed route after code/test/index verification.

## 10. Acceptance criteria

- [ ] **AC-07 (creation boundary):** after the full ladder finds an exact eligible Lead—including one created by a concurrent winner—the Observation links/enriches that Lead through Unit 18 and never creates a second Lead.
- [ ] **AC-08:** authorized `create_if_missing` Lead Created creates immediately exactly once with an active Record Link. Incomplete immutable data returns `insufficient_creation_data` with the exact missing-data reason and creates no Lead/link/Command/Change/outbox.
- [ ] **AC-09:** Best Relocation Form with the same two valid states selects Local; differing valid states select long-distance; missing/invalid state or ZIP creates nothing. Migration remains `link_only`; only an audited reviewed policy change authorizes creation.
- [ ] A WordPress/Vantage-created Form Lead receiving its later Granot `lead_created` event is matched and linked through Unit 18, retains `ingestion_origin:"wordpress_form"` and immutable submitted snapshots, and never creates a second Form Lead. WordPress-backed routes remain `link_only` or more restrictive; only separately reviewed Granot-originated routes may use `create_if_missing`.
- [ ] Form and Call creation use the exact active route/scope, immutable `granot_lead_created` evidence, `post_to_granot:false`, and one canonical transaction.
- [ ] Call Job-only creation is sparse and `not_applicable`; phone creation is `pending`; neither fabricates telephony evidence.
- [ ] Replica races prove one active link/one Lead, duplicate-key re-read/replan, exact replay, checksum conflict, and rollback with zero orphan/partial effects.
- [ ] Invalid/inactive/missing route, source conflict, multiple Call candidates, shadow/flag failure, Duplicate/Bad Form restrictions, and later-effect absence are explicitly asserted.

## 11. Required tests and commands

Map AC-07–09 into named tests before implementation. Required proof includes:

- pure/model tests for minimum data, same/different state routing, invalid state/ZIP, trusted Form optional `move_size`, sparse Call validation, immutable snapshots, origin, convergence state, and `post_to_granot:false`;
- canonical command tests for strict input/context/checksum/idempotency, current Registry/scope revalidation, exact DTO mapping, creation Change revisions, safe field modes, entity refs, and correct create outbox intent;
- processor/Module tests for authorized immediate Form/Call creation and every blocked/insufficient/conflict path;
- replica-set integration tests for simultaneous same-Observation replay, distinct Observations for one Job, active-link duplicate key, competing phone identity, rollback at Decision/Lead/link/Change/Command/outbox stages, and replan to Unit 18;
- privacy/collection assertions proving no raw/customer evidence and zero Booking/Cancellation/case/discrepancy/notification/RingCentral effects.

Run from `vantage-main-server` (extend focused filenames if implementation splits the module):

```text
node --import tsx --import ./scripts/test-setup.ts --test src/services/granotLifecycle/leadDesiredState.test.ts src/services/granotLifecycle/identity.test.ts src/services/granotLifecycle/processor.test.ts src/services/granotLifecycle/leadCreation.test.ts src/services/domainCommands/domainCommands.test.ts src/models/FormLead.test.ts src/models/CallLead.test.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=19
pnpm test
pnpm typecheck
```

Replica tests must use a disposable replica set; mocks cannot prove transaction/unique-index races. Report counts and masked IDs only. Disabled Sheet Sync suppresses external delivery, not the durable queued outbox assertion.

## 12. Live/staging verification

Use redacted synthetic post-activation evidence first. With test/staging flags injected and one reviewed synthetic Form route, prove Local and long-distance creation, incomplete-data terminal behavior, replay, and a two-writer Job race. With one reviewed synthetic Call route, prove phone `pending`, Job-only `not_applicable`, and no fabricated telephony fields. Compare bounded Receipt → Observation → Decision → Command → Lead/Link Change → outbox IDs and verify all later-effect collections are unchanged.

Production rollout requires separate authorization. Before it, verify migrations/indexes, record prior flags and Registry policy, enable creation for one reviewed source at a time, observe created/conflict/insufficient counts and causal completeness for at least one normal interval, and stop on any source reassignment, second Lead/link, orphan, missing causal ref, secret/PII exposure, unexplained mutation, dead letter, or Sheet queue breach. Production verification is read-only and never inspects raw payload/contact values.

## 13. Rollback

Set `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=false` first, then return the affected Registry source to `link_only` through an audited Owner command if source isolation is needed; returning to shadow is the broader safe fallback. Continue capture and configured matched-write/link behavior. Preserve receipts, Observations, Decisions, activation, created Leads, Record Links, Commands, Changes, revisions, and queued/completed outbox evidence. Never delete a created Lead/link, decrement revision, rewrite creation snapshots, detach evidence, or automatically reverse committed values.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-19-COMPLETION.md` using Runbook Section 13. Include verified Unit 18 prerequisite evidence; repository/branch; behavior-grouped files; exact command/mapping/reservation contract; invariants and AC-07–09; flags and Registry policy before/after; migration/index verification; focused/full/replica commands with counts; masked causal IDs; replay/race/rollback/orphan/no-second-Lead/privacy proof; Form route and sparse Call matrices; forbidden-effect proof; rollout actions (normally none); risks; and final Git status/external-action statement.

Successful implementation unblocks Unit 20 by specification dependency. Unit 20 must consume the `pending`/`not_applicable` convergence state and may not reinterpret creation policy or creation evidence. Unit 22 may already be unblocked by Unit 18 independently; no reconciliation behavior belongs here.
