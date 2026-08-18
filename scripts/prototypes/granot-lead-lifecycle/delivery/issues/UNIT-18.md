# Unit 18 — Safe matched-Lead synchronization effects

> **Contract maturity: implementation-ready; implementation remains blocked by Units 16–17 and accepted cross-channel shadow parity.** This is S12 and the first live lifecycle effect slice. It turns Unit 15's authorized matched-Lead plan into one canonical, revision-guarded Mongo transaction. Lead creation and every Booking/Release effect remain disabled.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 8.4, 9.4, 11–16.1, 23, 25, 27, 34.7, 35–37, 38/S12, and 39–41.
- **Acceptance ownership:** live matched-write completion for AC-05, AC-07, AC-10, AC-11, AC-12, AC-13, AC-32, and AC-33. Unit 19 retains creation/no-second-Lead completion for AC-07–09.
- **Approved split:** Unit 18 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Units 10–11 own the executor/Command/Change/outbox foundation; Units 12–15 own fields, indexes, identity, temporal order, desired-state planning, and shadow orchestration; Units 16–17 own channel convergence. Unit 19 alone owns `createLeadFromGranot` and creation reservation.
- **Execution:** the delivery runbook; server instructions/rules/docs; verified completion reports and repository state for Units 10–17; accepted cross-channel parity evidence; current processor/planner, Lead/Record-Link models, canonical executor, `EntityChange`, and Sheet Sync outbox code.

The final specification wins on conflict. `LeadDesiredStatePlan` is an internal semantic plan, not a public patch. All effect authorization and mutation stay inside `src/services/granotLifecycle/` plus the canonical `domainCommands` transaction boundary.

## 2. Objective

Implement canonical `synchronizeLeadFromGranot` and invoke it from the common processor only when a post-activation live Observation, all eight persisted gates, source-scoped identity, temporal order, and a matched existing eligible Lead authorize the effect. In one Mongo transaction, atomically establish/confirm the active Record Link as needed, apply only the allowlisted desired state, advance the temporal winner, insert the preallocated Decision, record one idempotent Command and append-only `EntityChange`/revision transition for reportable mutations, and enqueue the correct Lead Sheet Sync intent. Desired-state no-op and race losers must remain effect-free and causally truthful.

## 3. Repository, branch, and prerequisites

- **Repository/branch:** `vantage-main-server` / `granot-lead-lifecycle` only.
- **Blocked by:** Units 10–17 plus an accepted combined webhook/extension/automation shadow parity report. Verify Unit 16 and Unit 17 completion reports, the operation-envelope/capture adapters, and parity tests against repository state. A prose claim or status row is insufficient.
- Reverify Unit 10 executor/context/idempotency behavior, Unit 11 Change/outbox atomicity, Unit 12–13 Lead fields/indexes/migrations, Unit 14 identity/Agent/eligibility results, Unit 15 planner/temporal/processor contracts, active Record-Link uniqueness, and ending flags.
- Before runtime writes, confirm `TEST_MODE=true`, a disposable replica set, `SHEET_SYNC_MODE=disabled`, activation fixture/posture, source/Registry fixtures, and all lifecycle flags. No live source or production flag change is authorized by implementation work.
- Preserve unrelated/user changes. No commit, push, deploy, production mutation/migration, live payload inspection, flag enablement, Sheet/CRM send, or external action.

## 4. Current-state evidence to verify

Observed on 2026-08-18; reverify at implementation start:

- Unit 15's `processor.ts` resolves policy/identity/temporal order and plans desired state, but production paths persist only Decisions and historical job-level Record Links. Its only Lead write is a deliberately narrow metadata CAS reachable in explicit live test posture; it does not invoke a canonical lifecycle command.
- The processor already preallocates Decision IDs, stores eight ordered gate names, can reload/re-evaluate after a lost temporal CAS, and exposes dependency seams. Live preparation currently suppresses effect outcomes rather than executing them; the implementation must honor `EffectGateEvaluation.allowed`, not merely persist its snapshot.
- `leadDesiredState.ts` emits semantic `desired_values`, sorted `changed_paths`, Agent paths, and temporal-winner intent. It correctly excludes source/origin/CPL/Booking/Cancellation/`move_size`/ingested snapshots/money, but its contact values do not contain required server-stamped Observation/time/hash/provenance metadata.
- `CanonicalDomainCommands` and `canonicalDomainCommands` do not yet expose `synchronizeLeadFromGranot`. The transaction-owning executor, Granot lifecycle command-context validation, stored-result replay, `EntityChange`, revision stamping, and post-commit Sheet Sync finalizer already exist.
- Granot command context already requires the fixed processor actor, receipt/Observation/Decision IDs, channel, and either webhook system initiator or authenticated Owner initiator. Unit 16/17 must supply the latter consistently.
- Form/Call schemas already contain origin, immutable snapshots, Granot/current provenance, temporal winner, contact revision/summary, Priority, Quoted, Job parity, and `domain_revision`. Existing `FORM_LEAD_CHANGE_PATHS` / `CALL_LEAD_CHANGE_PATHS` do not yet cover all lifecycle-owned fields.
- The active `{provider,normalized_job_no}` Record-Link unique partial index and `domain_revision` exist. Historical shadow links may be job-only and require safe attachment of `lead_ref`; exact links may already contain the target.
- Checked-in lifecycle defaults remain processing/shadow true and every effect false. Unit 15 reports no production apply and no live effect activation.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo Lead/Record-Link state and revisions are authoritative; channel targets, preview bindings, and Sheets never are.
- **Invariants 2–4:** this unit changes Leads/links only. It stores no lifecycle enum and never creates/updates a Booking or creates/reverses a Cancellation.
- **Invariant 5:** only `synchronizeLeadFromGranot` through the canonical executor may mutate a matched Lead; processor/routes/clients never apply a patch directly.
- **Invariant 6:** every reportable post-activation Lead or Record-Link association mutation commits Decision, one `DomainCommandExecution`, `EntityChange`, revision transition, and applicable Sheet outbox intent together.
- **Invariant 7:** an already-current desired state produces no reportable `EntityChange`, revision increment, or Sheet Sync work; only atomic temporal/link evidence metadata may advance.
- **Invariant 8:** receipt channel, source system, immutable Ingestion Origin, fixed processor actor, and receipt initiator remain independent in Command/Change provenance.
- **Invariant 9:** WordPress submitted contact/move and every ingested snapshot are immutable. Granot contact is separate for WordPress Leads.
- **Invariant 10:** conflict or enrichment never rewrites Source Company, Source Granularity, Ingestion Origin, or CPL.
- **Invariant 11:** Duplicate Forms never become targets. Bad Forms allow strong exact Priority/link evidence only and never broad enrichment or Booking work.

## 6. Deliverables and exact contract

### 6.1 Canonical command and allowlisted desired state

Add the final-spec command to `CanonicalDomainCommands` and the production command registry:

```ts
synchronizeLeadFromGranot(input: {
  lead_ref: { model: "FormLead" | "CallLead"; id: string };
  expected_domain_revision: number;
  desired_state: GranotAuthorizedLeadDesiredState;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult>;
```

Use this **issue-author concrete allocation** for the otherwise unnamed `GranotAuthorizedLeadDesiredState`:

```ts
type GranotAuthorizedLeadDesiredState = {
  set: Partial<Record<GranotLeadWritePath, unknown>>;
  changed_paths: GranotLeadWritePath[];       // sorted, unique, exact keys of set
  contact_changed_paths: GranotContactPath[]; // current-contact leaves only
  move_changed_paths: GranotMovePath[];       // qualified move/Granot leaves only
  temporal_winner: { observation_id: string; captured_at: Date };
};

type GranotContactPath =
  | "name" | "first_name" | "last_name"
  | "phone_number" | "normalized_phone_number" | "email";

type GranotMovePath =
  | "pickup_city" | "pickup_zip" | "pickup_state"
  | "delivery_city" | "destination_zip" | "delivery_zip"
  | "delivery_state" | "move_date" | "cubic_feet" | "local"
  | "granot_move_size" | "granot_service_type";
```

`GranotLeadWritePath` is limited to:

```text
job_no, normalized_job_no, granot_priority, quoted,
receiver_agent, receiver_agent_source, receiver_agent_source_value,
granot_contact_snapshot,
name, first_name, last_name, phone_number, normalized_phone_number, email,
pickup_city, pickup_zip, pickup_state, delivery_city,
destination_zip, delivery_zip, delivery_state, move_date, cubic_feet, local,
granot_move_size, granot_service_type
```

- The processor converts Unit 15's plan to this type; no caller supplies it. Reject an extra/missing/duplicate path, a path/value mismatch, forbidden metadata, `quoted:false`, malformed target/revision/temporal tuple, or model-inapplicable ZIP field.
- `last_accepted_granot_observation`, current contact/move provenance, contact revision, contact-change hashes/timestamps, aggregate revision, and Change IDs are server-derived inside the command and may not arrive in `set`.
- The command context uses the fixed processor actor and receipt initiator, complete receipt/Observation/preallocated Decision/channel provenance, command name `synchronizeLeadFromGranot`, and **issue-author idempotency guidance** `granot:synchronize-lead:<observation_id>`. The payload checksum covers target, expected revision, normalized desired state, and temporal tuple, never raw receipt payload.
- Do not route this through public Lead update Zod or `updateSourceOwnedLead`; lifecycle fields require the trusted command contract.

### 6.2 Final authorization and current-state revalidation

Immediately before command invocation and again inside the transaction where state can race:

- require `execution_mode:"live"`, `GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED=true`, and all eight evaluated gates true. A failed gate records its exact `EffectGateEvaluation.outcome/reason` and performs no command;
- require a matched existing eligible `FormLead`/`CallLead`, source-scope agreement, non-Duplicate target, and current `domain_revision === expected_domain_revision`;
- for Bad Form exact identity, retain only allowed Priority/link work and reject every broad/contact/move/Agent path;
- require the incoming temporal tuple to be newer than the stored winner. A same tuple is replay/already-current; an older tuple is `stale`;
- revalidate empty receiver and the single active Agent chosen by Unit 14 before setting it; never overwrite a receiver or create an Agent;
- reject any attempt to alter source ownership, origin, CPL, immutable snapshots, `move_size`, Booking/Cancellation refs/facts, money, or RingCentral evidence.

A `DOMAIN_REVISION_CONFLICT`, temporal zero-match, link duplicate-key race, or eligibility drift aborts the proposed transaction/Decision, reloads current Lead/link state, reruns policy/identity/temporal/planning, and then persists only the truthful winner/loser outcome. Never persist `applied` against a lost claim.

### 6.3 Record-Link establish, attach, confirm, and conflict behavior

When the accepted Observation has a normalized Job Number:

- no active link: create one active link with Job snapshot, matched `lead_ref`, resolved source scope, non-disputed state, preallocated Decision reference, and last-observation metadata;
- existing historical job-only link with agreeing Job/source: attach the matched `lead_ref`;
- existing exact lead/source link: confirm it and advance only `last_observation_id` / `last_observed_at`;
- different lead, Job, or Source Scope: outcome `conflict` with `record_link_conflict` / `job_number_conflict` / `source_scope_conflict`, no Lead mutation, and mark the current link disputed with a bounded reason when not already disputed. Never replace/supersede it in this unit.

Association changes (`lead_ref`, source scope, disputed state) are reportable Record-Link mutations: increment link revision once and append a reference-safe `EntityChange` in the same lifecycle transaction. Exact confirmation metadata is evidence-only: it may advance with the Decision but creates no link revision/Change. The active-link unique index is the final race guard. A duplicate-key abort is re-read/replanned in a fresh transaction; do not continue in an already-aborted Mongo transaction.

If the Observation has no normalized Job Number, matched Priority/enrichment may still apply when otherwise authorized, but no link is invented.

### 6.4 Lead mutation and provenance expansion

- Fill missing Job fields only when normalized values agree; conflict never overwrites.
- Store every temporally accepted valid `granot_priority`. Only canonical `1`/`5` may set `quoted:true` and broad enrichment; no code path sets it false.
- **WordPress Form:** primary contact and both ingested snapshots stay unchanged. Stamp a complete `granot_contact_snapshot` with semantic contact, `differs_from_ingested`, Observation ID, and Observation capture time. Qualified current location/move date/cubic/Move Type may change; `move_size` does not.
- Preserve a role-safe server projection in which the submitted primary contact and qualified `granot_contact_snapshot` are separately identifiable for authorized display; list surfaces remain masked and no projection exposes raw receipt evidence.
- **RingCentral-created Call / Granot-created Form or Call:** qualified contact becomes current. Stamp `current_contact_provenance:{source_system:"granot",observation_id,changed_at}`, increment `granot_contact_revision` once when contact leaves change, and write bounded `last_granot_contact_change` with Observation ID, transaction time, sorted changed contact paths, and deterministic before/after hashes. Contact values themselves never enter the summary.
- When current move fields change, stamp `current_move_provenance:{source_system:"granot",observation_id,changed_at}`. Use `destination_zip` for Form and `delivery_zip` for Call.
- Preserve the immutable Granot creation snapshot for Granot-created Leads and RingCentral original caller evidence for Call Leads.
- Advance `last_accepted_granot_observation` inside the same command transaction for a reportable mutation.

### 6.5 One transaction and causal evidence

The processor preallocates Decision ID and calls the transaction-owning canonical executor once. Its operation composes internal Lead/Record-Link primitives; it must not start a nested command/transaction. Commit atomically:

1. the effect-bearing `SynchronizationDecision` with final outcome/reason/gates/target/effects;
2. Record-Link association/evidence changes, when applicable;
3. the Lead CAS mutation and temporal winner;
4. append-only `EntityChange` rows for each reportable mutated aggregate;
5. exactly one `DomainCommandExecution` and stored result;
6. one queued Sheet Sync intent for a changed Lead (`form_lead.update` or `call_lead.update`).

`EntityChange.changed_paths` reflects the actual reportable Lead/link paths, not planner claims. Contact/address values use `reference_only`; low-risk Priority/Quoted/Job/cubic/Agent/relationship values may use `stored`. Extend the current Lead change-path ownership accordingly without copying raw payloads/full documents. The Decision effects are:

- changed Lead: `lead_updated` with actual sorted paths plus `sheet_sync_requested`;
- new/attached link: `record_link_established`; exact link evidence: `record_link_confirmed`;
- include both link and Lead effects when both occur.

Post-commit Sheet dispatch remains the existing finalizer; a publish failure leaves durable queued outbox work and does not roll back Mongo truth.

### 6.6 Outcome and no-op matrix

- authorized changed Lead → `applied` / `lead_state_changed`;
- no Lead field change but a new/attached association → `linked` / `record_link_established` or `record_link_confirmed`;
- desired state and exact link already current → `already_current` / `desired_state_already_current`;
- older temporal tuple → `stale` / `older_than_temporal_winner`;
- identity/link/Job/source disagreement → `conflict` with the exact conflict reason;
- shadow/flag/source/policy failure → exact gate outcome/reason, no command.

For `already_current`, atomically insert the no-effect Decision and advance the temporal winner only if its older-tuple filter wins; exact link evidence may confirm in that transaction. Do not increment Lead/link `domain_revision`, create any `EntityChange`/Command/Sheet work, or claim `lead_updated`. If the temporal CAS loses, abort, reload, replan, and normally persist `stale`.

## 7. Explicitly out of scope

- `createLeadFromGranot`, `create_if_missing`, sparse Call creation, or active-link creation reservation for a new Lead (Unit 19).
- RingCentral adoption/convergence/cadence (Units 20–21).
- Priority 5/Booked/Release case or discrepancy persistence, Booking/Cancellation/owner commands, referral, or email (Units 22–32). All case/command/referral/email flags remain false.
- Admin lifecycle UI, extension/automation contract redesign, source Registry reclassification, historical shadow tool, production rollout, and legacy compatibility cleanup.
- Automatic Booking create/update, Cancellation/un-cancellation, or any official money/date/allocation mutation.
- Raw payload, credentials, unmasked contact/address values in Decision, Command result, link, outbox, logs, metrics, issue/handoff text, or test/report output.

## 8. Flags and runtime posture

Starting checked-in/default posture:

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

Focused/replica tests may inject `SHADOW_MODE=false` and `LEAD_WRITES_ENABLED=true` with a synthetic post-activation receipt and reviewed active source fixture. Checked-in defaults and ordinary local/prod configuration remain shadow true / writes false.

After separate rollout approval only, set shadow false and Lead writes true for one reviewed Registry source while all non-reviewed sources remain disabled/fail-closed. Creation and every case/command/referral/email flag remain false. Historical receipts remain historical forever; shadow Decisions are never promoted.

## 9. Migration and indexes

**None.** This unit consumes the verified additive Lead fields/revisions, Command/Change/outbox indexes, seven non-unique Lead indexes, and active Record-Link unique partial index from Units 07 and 09–13. Reverify exact model/index definitions and zero known collision state before any rollout. Extending command types, trusted write paths, and `EntityChange` path ownership does not authorize a data migration or production index apply.

## 10. Acceptance criteria

- [ ] **AC-05:** Valid Priority `0`, `1`, `5`, `8`, `05`, and a large allowed value are canonicalized/stored; only `1`/`5` broadly enrich and set Quoted true; no value sets false.
- [ ] **AC-07 (matched-write portion):** Matched-existing Lead Created establishes/confirms its link and enriches the one eligible Lead without creating a second Lead. Unit 19 retains creation-race completion.
- [ ] **AC-10:** WordPress Form primary contact and immutable submitted snapshot stay unchanged while qualified Granot contact is stored separately and displayed. This unit proves the live mutation and role-safe server projection; later case UI consumes that projection without changing authority.
- [ ] **AC-11:** WordPress immutable move snapshot and Vantage `move_size` stay unchanged while qualified current location/move date/cubic feet and Move Type update.
- [ ] **AC-12:** Call/Granot-created Form qualified contact becomes current; bounded Lead summary changes while full history appears in `EntityChange`. Contact/address values remain `reference_only`.
- [ ] **AC-13:** Receiver Agent fills at a non-1/5 Priority through one active username match; differing `user`/`rep`, zero/multiple/inactive match, or an existing receiver blocks assignment/overwrite.
- [ ] **AC-32:** No-op accepted Observation creates neither `EntityChange` nor Sheet Sync; every mutation has Receipt → Observation → Decision → Command → Change references, one revision transition, and the matching outbox intent in one transaction.
- [ ] **AC-33 (live completion):** Equivalent webhook, extension, and HTTP automation statements reach the same matched Lead desired state, mutation, changed paths, and final outcome; only channel/operation/initiator provenance differs.
- [ ] Replica races prove one temporal/link/revision winner; loser re-evaluates to truthful `stale`, `already_current`, replay, or `conflict`, never a second effect.
- [ ] Exact link confirmation/no-op, Bad/Duplicate rules, source immutability, WordPress evidence immutability, one-way Quoted, and zero Booking/Cancellation/case/discrepancy/notification effects are asserted explicitly.

## 11. Required tests and commands

Map every AC ID into concrete tests before implementation. Required proof includes:

- pure/type tests for the exact desired-state path allowlist, forbidden paths, model-specific ZIP, metadata derivation, hash stability, one-way Quoted, and planner-to-command conversion;
- canonical command tests for context/idempotency checksum, stored replay, source/eligibility/Agent revalidation, actual Change field modes, correct `form_lead.update` / `call_lead.update` outbox intent, and post-commit finalize;
- production Module tests through `GranotObservationProcessor` for `applied`, `linked`, `already_current`, `stale`, every conflict, and exact gate failure;
- replica-set tests for Lead revision races, equal-time Observation tie-break, active-link establish/attach/confirm/duplicate-key races, transaction rollback at each write stage, one causal chain, and no-op suppression;
- origin-matrix tests for WordPress Form, RingCentral Call, Granot-created Form/Call, Bad exact Form, and Duplicate Form;
- cross-channel tests using equivalent redacted webhook/extension/automation evidence and asserting identical live target/fields/effects;
- collection/secret/privacy searches proving zero forbidden effect and no raw/customer evidence in Decision/Command/Change/outbox/log output.

Run from `vantage-main-server`:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/services/granotLifecycle/leadDesiredState.test.ts src/services/granotLifecycle/granotTemporal.test.ts src/services/granotLifecycle/processor.test.ts src/services/domainCommands/domainCommands.test.ts src/services/domainCommands/entityChange.test.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=18
pnpm test
pnpm typecheck
```

The Unit 18 replica registration must execute against a disposable replica set; mocks cannot prove transaction, unique-index, outbox, revision, or tie-break races. Record exact pass/fail counts and masked IDs only. `SHEET_SYNC_MODE=disabled` must suppress external delivery, not durable outbox creation.

## 12. Live/staging verification

First use redacted synthetic post-activation evidence with one reviewed test/staging source: compare Decision gates, target, Record Link, Lead revision/fields, Command, Change, and queued Sheet Sync refs; repeat the same desired state to prove no-op suppression; race two temporal/link writers; and verify all Booking/Cancellation/case/discrepancy/notification collections remain unchanged.

A production rollout is a separate approval. If authorized, verify migrations/indexes green, record prior flags/Registry policy, narrow to one reviewed source, enable shadow false + Lead writes true, compare bounded causal IDs/metrics for at least one normal operating interval, and stop on any source reassignment, unexpected mutation, missing causal ref, secret/PII exposure, queue-age breach, dead letter, or duplicate effect. Never inspect raw payload/contact values for this verification.

## 13. Rollback

Set `GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED=false` first or return `GRANOT_LIFECYCLE_SHADOW_MODE=true`; disable the narrow source through an audited Registry command if source-specific isolation is required. Capture/processing may continue in shadow. Preserve receipts, Observations, Decisions, activation, Record Links, Commands, Changes, outbox jobs, revisions, and committed Lead values. Do not decrement revisions, delete evidence, cancel queued causal work, or automatically reverse a committed Lead update. Creation/case/command/referral/email flags remain false throughout.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-18-COMPLETION.md` using Runbook Section 13. Include prerequisite/parity acceptance evidence; repository/branch; behavior-grouped files; exact desired-state/command/link transaction contracts; invariants/ACs; flags before/after; migration/index verification; focused/full/replica commands with counts; masked causal IDs; transaction rollback, race, replay, no-op, privacy, source/snapshot immutability, and forbidden-effect proof; rollout actions (normally none); risks; and final Git status/external-action statement.

Successful Unit 18 implementation unblocks Units 19 and 22 by specification dependency, subject to the shared-branch sequencing policy. Unit 19 owns creation; Unit 22 owns read-only Booking Reconciliation. Neither behavior may be pulled into this unit, and the next agent must independently verify the handoff against repository state.
