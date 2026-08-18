# Unit 20 — RingCentral adoption/convergence and duplicate correctness

> **Contract maturity: implementation-ready; implementation remains blocked by Units 12 and 19.** This is the convergence half of S14. It makes the shared qualified-call ingest adopt one exact Granot-created Call Lead before business duplicate classification, preserves Granot creation origin/evidence, records durable non-guessing conflicts, and prevents the adopted physical call from becoming a second Lead. Lease, run telemetry, cursor hardening, and the 30-minute cron remain Unit 21.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 12.2, 14.2–14.4, 15.2–15.3, 16.2–16.3, 17, 23.1–23.3, 25–27, 33, 34.7, 35–37, 38/S14, and 39–41.
- **Acceptance ownership:** full AC-14, AC-15, and AC-16. Unit 21 owns AC-17 and the lease/schedule proof.
- **Approved split:** Unit 20 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 12 owns persisted provenance/convergence fields and indexes; Unit 19 owns Granot Call creation and initial `pending`/`not_applicable`; this unit owns adoption/conflict and duplicate ordering; Unit 21 alone owns Call Log lease, overlap telemetry, cursor advancement proof, and `vercel.json` cadence.
- **Execution:** delivery runbook; repository instructions/rules/docs; verified Unit 12 and Unit 19 completion evidence; current `ringcentral-call-lead-ingest.service.ts`, duplicate guard, processed-call store, Call Lead schema, route resolution, RingCentral provenance/context validation, canonical executor, `EntityChange`, and Sheet Sync outbox.

The final specification wins on conflict. Both webhook and Call Log qualified calls must enter the same convergence service. Routes, session aggregation, cron code, and clients may not select an adoption candidate, set convergence state, or classify business duplicates.

## 2. Objective

Implement `src/services/ringcentral/callLeadConvergence.service.ts` and insert it into the shared qualified-call ingest after telephony idempotency but before business duplicate classification. For one exact eligible Granot-created candidate, atomically attach complete verified RingCentral evidence, preserve immutable Granot origin/snapshots, mark convergence adopted, write canonical causal history and the processed-call ledger, then classify duplicates while excluding that adopted physical call. For zero, multiple, out-of-window, wrong-scope, already-attached, or Job-number-only candidates, never guess; preserve a durable conflict where required and continue the qualified call through normal RingCentral duplicate/create/shadow/dry-run behavior.

## 3. Repository, branch, and prerequisites

- **Repository/branch:** `vantage-main-server` / `granot-lead-lifecycle` only.
- **Blocked by:** Unit 12 and completed Unit 19. Unit 12 is recorded complete; reverify its schema/index/migration evidence. Unit 19 must be implemented with creation/race tests green and must produce exact `granot_lead_created` Call Leads with convergence `pending` or `not_applicable`.
- Verify Unit 10–11 canonical executor/Change/outbox behavior because adoption/conflict mutates a Lead. Verify trusted RingCentral context accepts only fixed `ringcentral-call-ingest` actor/initiator with proven telephony provenance.
- Verify current webhook session and Call Log paths both call `ingestRingCentralQualifiedCall` with the same complete `RingCentralQualifiedCall` descriptor and exact active route resolution.
- Before any runtime write, require `TEST_MODE=true`, disposable replica-set/database, `RINGCENTRAL_COLLECTION_MODE=test`, disabled external Sheet/CRM effects, synthetic route/call fixtures, and explicit RingCentral write/adoption posture. No provider request, production collection, flag enablement, or schedule change is authorized.
- Preserve unrelated/user changes. No commit, push, deploy, production mutation/migration, live call/payload inspection, provider send, or external action.

## 4. Current-state evidence to verify

Observed on 2026-08-18; reverify at implementation start:

- `ingestRingCentralQualifiedCall` currently does telephony ledger lookup → duplicate classification → create/shadow/dry-run → ledger upsert. It has no adoption step and can therefore classify an unresolved Granot-created Lead as a prior duplicate or create another physical-call Lead.
- The current ingest creates real Leads through `createRingCentralCallLead` outside a single adoption/ledger command transaction. Existing behavior and current write-mode gates must remain compatible for the non-adoption path.
- `ringcentral-duplicate-guard.ts` uses exact Source Granularity, normalized phone, an earlier-only 90-day window, and telephony-session exclusion, but queries all non-duplicate Call Leads. It does not exclude unresolved Granot-created `pending`/`conflict` candidates or an adopted target by explicit Lead ID.
- `processed-calls-store.ts` is shared by webhook/cron, has unique sparse telephony-session identity, and accepts call-log identity. Its writes do not accept a Mongo session, so adoption plus ledger is not currently atomic.
- `CallLead` already has the Unit 12 `ringcentral_convergence` subdocument (`pending | adopted | conflict | not_applicable`), immutable `ingestion_origin`, ingested contact snapshot, revisions, and candidate index on origin + Source Granularity + immutable normalized phone + `createdAt`.
- The current RingCentral metadata subdocument has session/call-log/route/qualification/timing fields but no explicit immutable original-caller snapshot field. Top-level phone alone cannot serve as immutable RingCentral evidence after later Granot updates.
- `CanonicalDomainCommands` has no convergence/adoption operation, although command-context validation already recognizes trusted RingCentral provenance. Direct model mutation would violate Invariants 5–6.
- Call Log sync still uses the existing state/cursor and `vercel.json` schedule. Those files are not changed in this unit except imports required to call the shared ingest; Unit 21 owns their behavior.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo Call Lead, RingCentral processed ledger, Command, Change, revision, and outbox are authoritative; webhook memory, a cron window, or provider response is not.
- **Invariants 2–3:** convergence changes Lead telephony evidence only. It creates no lifecycle enum and no Booking/Cancellation authority.
- **Invariant 5:** adoption and durable conflict state changes run through canonical transaction operations; the ingest service and duplicate guard do not patch Leads directly.
- **Invariant 6:** every adopted/conflicted Lead mutation records trusted RingCentral provenance, idempotent Command, `EntityChange`, revision transition, applicable Sheet outbox, and—in successful adoption—the processed-call ledger in one Mongo transaction.
- **Invariant 7:** an idempotent processed call, zero candidate, or already-current adoption creates no duplicate Change/revision/outbox; replay returns the stored result.
- **Invariant 8:** RingCentral source/transport provenance remains separate from immutable `ingestion_origin:"granot_lead_created"`, actor, initiator, and any earlier Granot Observation provenance.
- **Invariant 9:** Granot creation snapshots and original RingCentral caller evidence are immutable and never overwrite one another.
- **Invariant 10:** adoption requires exact Source Granularity and never reassigns Source Company, Source Granularity, Ingestion Origin, or CPL. Duplicate classification may apply the established duplicate/CPL rule but cannot use a source conflict as a match.

## 6. Deliverables and exact contract

### 6.1 Shared convergence interface and ingest order

Create `src/services/ringcentral/callLeadConvergence.service.ts` as the only owner of candidate selection and adoption/conflict decisions. It is called only by Unit 19's trusted Granot Call creation seam (for pre-creation exact-phone convergence checks) and `ingestRingCentralQualifiedCall` (for qualified-call adoption). Both webhook and Call Log paths reach it through the latter.

The qualified-call order is exact:

```text
telephony idempotency
  -> Granot-created Lead adoption attempt
  -> business duplicate classification (excluding adopted/unresolved candidates)
  -> create only if adoption did not succeed
  -> persist the normal non-adoption ledger result
```

- Telephony idempotency checks both nonempty session and call-log identity before candidate work. A stored terminal result returns without mutating a Lead.
- A successful adoption is the materialization result: do not create another Call Lead.
- Zero/multiple/ineligible candidates continue through the existing write mode (`create | shadow | dry_run`) and are not discarded.
- Adoption/convergence never changes call qualification. Only an already-qualified `RingCentralQualifiedCall` reaches this service.

### 6.2 Exact candidate query and boundary

Use call start as `call.startTime`; if the provider-qualified descriptor lacks it, fail the adoption attempt closed and continue normal ingest rather than substituting ingestion `now`. Candidate adoption requires all of:

- exact `source_granularity_id` from the verified active RingCentral route;
- exact normalized caller phone against `ingested_contact_snapshot.normalized_phone_number` (the Granot creation phone), with a defensive equality check after load;
- `ingestion_origin:"granot_lead_created"`;
- `ringcentral_convergence.state:"pending"`;
- no attached `ringcentral.telephony_session_id`, `session_id`, or `call_log_id`;
- a real immutable phone (therefore never Job-number-only); and
- Lead `createdAt` inclusively within `call.startTime - 12 hours` through `call.startTime + 12 hours`.

Sort only for deterministic evidence; sorting never selects among multiple candidates. Exactly one candidate is adoptable. Zero returns `not_found`. More than one returns `conflict` and no candidate is adopted. Boundary tests cover one millisecond outside and exactly ±12 hours.

Unit 19's pre-creation call uses the same exact Granularity + normalized-phone rules against eligible Leads: one links/replans, multiple fail with `multiple_eligible_matches`, none creates `pending`. It does not call the qualified-call adoption transaction because no verified call exists yet.

### 6.3 Canonical adoption and conflict operations

Section 17 requires canonical, atomic Lead mutation but Section 23.4 does not name a public adoption signature. Use this narrow **issue-author allocation** inside the domain-command boundary; it is not an HTTP API:

```ts
adoptRingCentralCall(input: {
  call_lead_id: string;
  expected_domain_revision: number;
  qualified_call: RingCentralQualifiedCallIdentity;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult>;

markRingCentralConvergenceConflict(input: {
  call_lead_ids: string[];
  expected_domain_revisions: Array<{ call_lead_id: string; domain_revision: number }>;
  conflict_reason: "multiple_adoption_candidates";
  qualified_call: RingCentralQualifiedCallIdentity;
  context: CanonicalCommandContext;
}): Promise<CanonicalCommandResult>;
```

`RingCentralQualifiedCallIdentity` contains the verified bounded session/call-log/route/timing/qualification fields needed to re-load or verify the trusted call; it must not accept arbitrary Lead fields. Command context uses origin `ringcentral`, fixed actor and initiator ID `ringcentral-call-ingest`, proven source receipt/session identity, command-specific deterministic idempotency, and a checksum over target revision plus bounded verified call identity. No client or route can construct it.

Use `ringcentral:adopt:<telephony-session-or-call-log-id>` and `ringcentral:convergence-conflict:<telephony-session-or-call-log-id>` as issue-author idempotency keys. Reject a descriptor with neither stable identity, mismatched proven session, inactive/wrong route, target scope/phone/window drift, or changed candidate count.

### 6.4 Successful adoption transaction

Within one executor-owned Mongo transaction, re-read the sole candidate with its expected revision and eligibility filter, then:

1. attach the complete verified existing RingCentral metadata: telephony/session/party/call-log IDs, transport ingestion source, qualification reason, answered/terminal/start/end/duration, route/assignment/target identity, and source label snapshots;
2. add immutable `ringcentral.original_caller` evidence `{ phone_number, normalized_phone_number, captured_at }` inside the RingCentral subdocument. This is **issue-author schema guidance** required to make Section 17's “immutable original caller evidence” concrete; schema guards reject later overwrite;
3. set `ringcentral_convergence.state:"adopted"`, `adopted_at:now`, and retain the originating Granot `observation_id`; clear no prior evidence and write no conflict reason;
4. preserve `ingestion_origin:"granot_lead_created"`, ingested Granot snapshots, Source Company/Granularity, Job Number, CPL provenance, and current Granot facts;
5. perform business duplicate classification against other qualifying Leads only, excluding the adopted Lead ID and same physical-call identities, then set `duplicate`/duplicate-CPL behavior exactly as the existing 90-day rule requires;
6. insert one `EntityChange`, increment the Lead revision once, insert one `DomainCommandExecution`, and enqueue one `call_lead.update` Sheet Sync intent; and
7. upsert the processed-call ledger with the adopted Lead ID and terminal adoption/duplicate result using the same Mongo session before commit.

Extend the processed status/result vocabulary with bounded `lead_adopted` and `lead_adopted_duplicate`. Exact replay returns that result. The ledger store must accept the executor session and must not initialize indexes inside an active transaction. Keep its stable identity uniqueness as the final telephony race fence; a duplicate-key abort is re-read outside the aborted transaction.

Adoption `EntityChange` stores low-risk state/relationship IDs as allowed and treats caller/contact values as `reference_only`. It does not copy the whole RingCentral descriptor. Post-commit Sheet wake-up may fail without changing committed Mongo truth.

### 6.5 Duplicate correctness after adoption

Refactor `classifyRingCentralCallLeadDuplicate` so callers can exclude an adopted Lead ID in addition to the existing telephony-session exclusion. Preserve the normal rule: exact Source Granularity + normalized phone + a different qualifying Call Lead in the earlier-only 90-day window. The adopted Lead is duplicate only when that different prior qualifying Lead exists.

The duplicate query must exclude unresolved Granot-created Leads whose convergence state is `pending` or `conflict` and which have no RingCentral identity. Those rows alone cannot create a false duplicate. A resolved adopted Granot-created Lead from a different physical call is an ordinary qualifying prior Lead.

At exactly the 90-day boundary preserve the existing inclusive business rule; newer than the current call is never a prior duplicate. Do not weaken exact Granularity to legacy Source Company or global phone.

### 6.6 Zero, multiple, Job-only, and race outcomes

- **Zero candidate:** mutate no existing Lead and continue normal duplicate classification/create/shadow/dry-run.
- **Job-only / `not_applicable`:** never query it as a phone candidate, never mutate its convergence state, and continue normal ingest.
- **Multiple candidates:** atomically mark every still-eligible candidate `state:"conflict"` with bounded `conflict_reason:"multiple_adoption_candidates"`, source call identity hash/reference, and one revision/Change per changed Lead. Then continue the qualified call through normal ingest. If conflict persistence fails, treat it as a technical failure rather than silently losing durable ambiguity.
- **Candidate CAS/uniqueness race:** abort, re-read telephony ledger and candidates, and return replay/adopted/conflict/normal-ingest truth. Never attach the same call to two Leads.
- **Already attached same physical call:** idempotent replay/already-current; no new Change/outbox.
- **Attached different physical call or scope/phone/window drift:** ineligible/conflict; never detach or overwrite verified metadata.

The final-spec phrase `ringcentral_convergence_conflict` is not a Section 7 Decision reason member. Store bounded convergence reason `multiple_adoption_candidates`; operational result/event may use `ringcentral_convergence_conflict`. Do not add it to `SynchronizationReasonCode` or fabricate a Granot Decision for a RingCentral-only call.

### 6.7 Operational and privacy behavior

Add bounded metrics/events for adoption attempted/adopted/conflict/not-found/ineligible and duplicate-after-adoption, with source/route IDs and masked causal IDs only. Never log caller phone/name, raw call payload, credentials, tokens, or full metadata. Existing operational events that include `leadIdentity` must remain behind their established protected/masked handling; this unit adds no unmasked projection.

Update RingCentral behavior docs/rules to state adoption-before-duplicate, immutable origin/caller axes, ±12-hour inclusive window, and unresolved-candidate exclusion. Unit 21 will add lease/run telemetry and cadence documentation.

## 7. Explicitly out of scope

- Granot Lead creation, route/minimum-data policy, active-link reservation, or Registry `create_if_missing` enablement (Unit 19).
- Call Log lease fields/claim/renewal, overlap winner, cursor-on-success changes, run counters, `vercel.json`, or the 30-minute schedule (Unit 21).
- Changing the 12-hour rolling Call Log lookback; it remains intact.
- Booking/Release reconciliation, Booking/Cancellation commands, discrepancies, Admin UI, Referral Booking, notifications, or email.
- Changing RingCentral qualification thresholds, inbound route assignment semantics, provider subscription behavior, or the established 90-day duplicate business rule.
- Historical backfill/adoption of old Leads, production migration/apply, current live call inspection, or compatibility cleanup.
- Raw payloads, tokens, live caller/contact data, or unmasked values in logs, metrics, Commands, Changes, issue/handoff text, fixtures, or reports.

## 8. Flags and runtime posture

Preserve all current RingCentral write-mode gates and lifecycle defaults. In particular, `RINGCENTRAL_CREATE_CALL_LEADS=false` remains the default; shadow/dry-run behavior remains available, and lifecycle Lead creation/case/command flags are not broadened.

S14 rollback explicitly requires an adoption flag but the final specification does not name it. Add the narrow fail-closed **issue-author flag**:

```text
RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false
```

- `false`: skip adoption/conflict mutation and run the prior qualified-call path unchanged.
- `true`: attempt adoption before duplicate classification, still subject to the existing RingCentral write mode. In `dry_run`/shadow proof, compute bounded candidate/result metrics without mutating production Leads unless a synthetic test explicitly enables transaction writes.

Checked-in/default ending posture remains false. Focused/replica tests inject true against test collections. A separately approved rollout may enable it only after Unit 20 proofs while preserving the existing RingCentral call-lead write posture. This unit does not change lifecycle flags or cron cadence.

## 9. Migration and indexes

**None.** The original-caller and processed-status fields are additive. Consume the Unit 12 candidate index and existing telephony processed-ledger identity indexes; reverify their definitions and collision-free state. The session-aware ledger refactor must reuse established indexes and must not run `createIndex` inside an adoption transaction.

If implementation verification discovers that stable qualified calls can lack telephony session identity and the existing call-log index permits a real duplicate race, stop and report the contradiction; do not silently deploy a new unique index. Any strengthening must use Section 34.5 report → reviewed apply → verify under a separately refined/authorized index contract.

## 10. Acceptance criteria

- [ ] **AC-14:** one exact Granot-created Call Lead is adopted by the matching qualified RingCentral call; complete verified telephony/original-caller evidence and ledger identity commit atomically; Ingestion Origin remains `granot_lead_created`.
- [ ] **AC-15:** the adopted physical call is not its own business duplicate. A different prior qualifying Call Lead in exact Granularity/phone/90-day scope still marks the adopted Lead duplicate under normal rules.
- [ ] **AC-16:** zero or multiple phone candidates and Job-number-only candidates never guess. Multiple ambiguity is durable; unresolved candidates alone create no false duplicate; the qualified call continues through normal ingest and is preserved.
- [ ] Exactly ±12 hours is eligible; one millisecond outside is not. Current contact drift cannot replace the immutable Granot creation-phone criterion.
- [ ] Webhook and Call Log descriptors produce the same candidate/adoption/duplicate result; telephony replay and concurrent paths yield one ledger winner and at most one adopted Lead.
- [ ] Every adopted/conflict mutation is canonical, revision-guarded, causally traceable, privacy-safe, and outbox-atomic; no Booking/Cancellation/lifecycle-case effect occurs.
- [ ] Call Log cadence, cursor, lease, and rolling lookback are unchanged by this unit.

## 11. Required tests and commands

Name production-interface tests with AC-14, AC-15, and AC-16. Required proof includes:

- pure/service tests for zero/one/multiple candidates; exact Granularity/phone/origin/pending filters; inclusive ±12-hour boundaries; Job-only exclusion; missing call-start fail-closed; and deterministic non-selection;
- canonical command/model tests for trusted RingCentral context, immutable original caller, complete metadata, retained Granot origin/snapshots/scope/CPL, expected revision, idempotent replay/checksum conflict, Change privacy modes, and `call_lead.update` outbox;
- duplicate-guard tests for adopted-ID exclusion, same-session exclusion, unresolved pending/conflict exclusion, a different qualifying prior Lead, exact 90-day boundary, future exclusion, and exact Granularity;
- shared-ingest tests for webhook/Call Log parity, adoption-before-duplicate ordering, adoption suppressing create, zero/multiple continuing normal create/shadow/dry-run, and stable processed statuses;
- replica-set tests for adoption + ledger + Change + outbox atomicity, two-path telephony race, candidate revision race, multiple-candidate conflict atomicity, duplicate-key re-read, and rollback at every write stage;
- zero-forbidden-effect and log/fixture privacy searches.

Run from `vantage-main-server`:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/services/ringcentral/callLeadConvergence.test.ts src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts src/services/ringcentral/ringcentral-duplicate-guard.test.ts src/services/ringcentral/processed-calls-store.test.ts src/models/CallLead.test.ts src/services/domainCommands/domainCommands.test.ts
TEST_MODE=true SHEET_SYNC_MODE=disabled RINGCENTRAL_COLLECTION_MODE=test pnpm test:granot-lifecycle:replica -- --unit=20
pnpm test
pnpm typecheck
```

If current focused test filenames differ, use the landed equivalents and record them exactly. Mocks cannot prove atomic ledger/adoption or race behavior. Use synthetic `555000xxxx` callers and report only masked IDs/counts.

## 12. Live/staging verification

With redacted synthetic test/staging data and adoption enabled only in the isolated environment, exercise one exact candidate, zero candidates, multiple candidates, Job-only, exactly ±12 hours, and one millisecond outside. Verify bounded Lead revision/Change/Command/outbox/processed-ledger refs, preserved origin/snapshots, adopted metadata completeness, and normal-ingest continuation. Run equivalent webhook and Call Log descriptors and prove one idempotency winner. Confirm cadence/cursor/lease state is unchanged.

Production rollout requires separate authorization. Start in dry-run/adoption-metrics posture, record existing RingCentral write gates, enable only the adoption flag, observe at least one normal interval, and stop on any false duplicate, two adopted Leads for one call, second Lead for the adopted call, lost qualified call, scope/origin rewrite, missing causal ref, ledger mismatch, PII exposure, or queue failure. Production verification is read-only and does not inspect raw call/contact payloads.

## 13. Rollback

Set `RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false` first. The prior qualified-call path and current cron cadence continue under existing write-mode gates. Do not detach verified RingCentral metadata, restore convergence to pending, rewrite Granot origin/snapshots, delete conflict evidence, remove processed ledger rows, decrement revisions, or reverse an already-applied duplicate classification automatically. Preserve Commands, Changes, outbox evidence, and all committed Leads. If broader containment is separately required, use existing RingCentral create/shadow/dry-run gates without changing the schedule in this unit.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-20-COMPLETION.md` using Runbook Section 13. Include verified Unit 12/19 prerequisites; repository/branch; behavior-grouped files; exact candidate/adoption/conflict/duplicate contracts; issue-author flag/schema/command allocations; invariants and AC-14–16; migration/index verification; flags before/after; focused/full/replica commands and counts; masked adoption/ledger IDs; boundary, replay, race, rollback, atomicity, false-duplicate, continued-ingest, privacy, and forbidden-effect proof; unchanged cadence/cursor evidence; rollout actions (normally none); risks; and final Git status/external-action statement.

Successful implementation unblocks Unit 21. Unit 21 must preserve this convergence service and is the only unit authorized to add the five-minute renewable lease/telemetry, prove cursor/overlap safety, and change `vercel.json` to `*/30 * * * *` last.
