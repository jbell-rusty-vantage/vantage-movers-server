# Unit 11 — Entity Change, outbox atomicity, and canonicalization of existing write adapters

> **Contract maturity: implementation-ready; implementation remains blocked by Units 09–10 and the shared-branch sequence.** This is the remainder of S07. It completes the canonical mutation foundation for existing write adapters without enabling a Granot lifecycle caller or inventing later owner/lifecycle commands.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 14.1, 23.1–23.4, 27, 34.5 and 34.7, 35–37, 38/S07, and 39–41.
- **Acceptance ownership:** Change/outbox/revision foundation of AC-21 and AC-32. Units 24–25/27 own case-command races; Units 18/24–25/27 complete accepted-Observation causal/no-op proof at their production effects.
- **Approved split:** Unit 11 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 09 owns aggregate revision fields/migrations; Unit 10 owns the transaction-owning executor, trusted contexts, exact stored-result replay, and generic revision race.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`, repository instructions, lifecycle/schema/Sheet Sync rules, affected business-logic docs, and verified Unit 09–10 completion reports.

The final specification wins. Section 23.4 names later lifecycle/owner commands, but this unit supplies their atomic foundation and canonicalizes existing adapters only. It must not make later lifecycle or owner commands live early.

## 2. Objective

Add the append-only, privacy-safe `EntityChange` model and indexes; make every real mutation performed by an affected existing canonical adapter commit its Command, Change, aggregate revision transition, and Sheet Sync outbox intent atomically; make no-op/replay create none of those effects; and refactor affected Lead, Booking, Cancellation, leadless, and Referral write seams so routes and models are no longer mutation authorities within this boundary.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** verified Units 09 and 10, including revision prerequisites, the explicit `{ session, now }` operation boundary, and real replica-set replay/rollback proof.
- Reverify aggregate revision fields, `DomainCommandExecution`, command context/result compatibility, route-to-service adapters, every `runSheetSyncWrite` caller, Sheet Sync outbox behavior, and actual index state before editing.
- Transaction proof requires `TEST_MODE=true`, a disposable replica-set database, `SHEET_SYNC_MODE=queued`, and disabled/fake Sheets, queue, CRM, email, and provider adapters.
- No commit, push, deploy, production mutation/index apply, activation, current-payload inspection, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-17; reverify after Units 09–10 land:

- `src/models/EntityChange.ts` does not exist. Current aggregate models also lack Unit 09 revision metadata, so implementation cannot start from today's tree.
- The current executor is pre-Unit-10: `AsyncLocalStorage`, zero-argument operations, two command origins, and replay status `already_applied`. `sheetSyncCoordinator.ts` currently owns transaction-time Command persistence.
- Existing `CanonicalDomainCommands` covers Form/Call creation, source-owned Lead update, Booking-from-Lead, leadless Booking, Booking attachment, and Cancellation creation. Those wrappers call public services, which open their own `runSheetSyncWrite` boundary.
- Form/Call, Booking, leadless Booking, Cancellation, and Referral services persist outbox intent in their own transaction and finalize after return. Referral creation is not in the canonical registry.
- Normal v1 routes still call Lead/Booking/Referral/Cancellation services directly. Preserve validation and envelopes while routing affected non-delete writes through trusted adapters.
- `SheetSyncJob` and `enqueueSheetSyncJob(..., { session })` already provide a durable outbox. `persistSheetSyncIntent` only persists in `queued` mode; tests must select that safe mode explicitly.
- Existing routes include hard deletes, while the final specification does not print a delete-specific Change shape. This unit resolves that compatibility gap narrowly under invariants 5–7; deletes may not remain a direct model-write bypass.

## 5. Locked decisions and invariants at risk

- **Invariant 1 — MongoDB is the System of Record:** Command, Change, revision, and outbox truth commits in Mongo.
- **Invariant 2 — Granot evidence is not Booking/Cancellation authority:** canonicalization grants no new automatic official-fact effect.
- **Invariant 4 — one Booking per normalized Job Number:** existing Booking/Referral uniqueness remains intact.
- **Invariant 5 — only canonical commands mutate aggregates:** affected paths enter the executor once; no direct model write or nested transaction remains.
- **Invariant 6 — complete atomic mutation chain:** every changed aggregate has causal Command/Change/revision linkage and applicable outbox intent in the same transaction.
- **Invariant 7 — no-op has no Change/Sheet work:** replay and already-current operations cannot increment revisions or enqueue work.
- **Invariant 8 — provenance axes remain independent:** source system, channel, actor, initiator, receipt, Observation, Decision, case, discrepancy, run, and request retain distinct meanings.
- **Invariant 9 — immutable evidence is never overwritten:** Changes are append-only and rollback never rewrites them.
- **Invariant 10 — identity conflict never reassigns ownership/CPL:** refactoring preserves current source/CPL guards.

## 6. Deliverables and exact contract

### 6.1 `EntityChange`

Add `src/models/EntityChange.ts` with exactly:

```ts
type EntityChangeDocument = {
  _id: ObjectId;
  entity: EntityRef;
  command_execution_id: ObjectId;
  command_name: string;
  provenance: {
    source_system: "vantage" | "granot" | "ringcentral";
    observation_channel?: ObservationChannel;
    actor: DurableActor;
    initiator: DurableActor;
    receipt_id?: ObjectId;
    observation_id?: ObjectId;
    decision_id?: ObjectId;
    case_id?: ObjectId;
    discrepancy_id?: ObjectId;
    run_id?: string;
    request_id?: string;
  };
  changed_paths: string[];
  fields: Array<{
    path: string;
    value_mode: "stored" | "hashed" | "reference_only";
    before?: unknown;
    after?: unknown;
    before_hash?: string;
    after_hash?: string;
  }>;
  revision_before: number;
  revision_after: number;
  applied_at: Date;
};
```

- `entity` uses the Section 7 `EntityRef` model union. As narrow **issue-author guidance**, emit `changed_paths` deterministically, without duplicates, and keep each entry represented by a `fields.path`; this prevents unstable audit/replay output without changing the specification's field vocabulary.
- `revision_after === revision_before + 1`; both are nonnegative integers. The aggregate atomically sets `last_change_id`, `last_changed_at = applied_at`, and `domain_revision = revision_after`.
- Low-risk relationship/lifecycle values may use `stored`: quoted, Priority, cubic feet, Agent ID, Booking/Cancellation refs, and official amounts/dates.
- Contact/address paths are `reference_only` in this release with no raw before/after value. Do not invent a contact/address hashing policy; hash fields are used only for a separately classified `hashed` field.
- Never copy full documents, raw payload/headers, secrets, credentials, or unmasked contact/address values into Changes, logs, tests, or reports. Reject application updates/deletes: Changes are append-only.

Declare exact indexes:

```ts
{ "entity.model": 1, "entity.id": 1, revision_after: 1 } // unique
{ command_execution_id: 1 }
{ "entity.model": 1, "entity.id": 1, applied_at: -1 }
{ changed_paths: 1, applied_at: -1 }
```

### 6.2 Atomic mutation chain

Extend Unit 10's executor operation so one transaction persists, as applicable:

1. the preallocated effect-bearing `SynchronizationDecision`;
2. every expected-`domain_revision` aggregate mutation;
3. one `EntityChange` per changed aggregate;
4. one immutable `DomainCommandExecution` with exact stored result;
5. applicable link/reconciliation state owned by the caller; and
6. the correct durable Sheet Sync outbox intent.

- Preallocate Command/Change/Decision IDs and logical `now` outside the retryable callback; retries reuse them.
- Each Change references the committed Command, and each aggregate references its Change. A multi-aggregate command records coherent per-aggregate revision transitions.
- Failure at aggregate, Change, Command, outbox, or commit leaves none of the proposed chain visible. Duplicate/race behavior uses Unit 10's durable replay/conflict rules.
- A semantic no-op performs no aggregate save, revision increment, Change, or outbox write. Replay never re-enters the operation.
- External Sheets, queue publish, email, CRM, and provider calls are forbidden inside the transaction. Only post-commit finalization may publish a wake-up.

### 6.3 Existing adapter canonicalization

- Refactor transaction-bound internals for existing adapters: `createFormLead`, `createCallLead`, `updateSourceOwnedLead`, `createBookingFromLead`, `createLeadlessBooking`, `attachBookingToLead`, and `createCancellation`.
- Add compatibility canonical adapters for the existing `updateBookedLead` and `updateCancelledLead` routes/services. These preserve their current patch semantics; they are not the later Granot owner `updateBooking` command and do not gain case/Observation authority.
- Add an existing-service canonical adapter for Referral Booking creation so it no longer owns an independent transaction authority. Preserve leadless semantics and its `booked_lead` Sheet job; do not enable the later Granot Referral workflow.
- Preserve route validation, auth, envelopes, duplicate/Form Fill/CPL/source/agent/merchant/customer/mirror rules, and post-commit behavior. Routes derive trusted context and call adapters; they do not construct Changes or patch models.
- Existing routes do not acquire Unit 24's required `Idempotency-Key` header. Narrow **issue-author guidance** for compatibility is: a server-only context factory canonicalizes/hashes the validated request and preallocates Command ID plus an opaque request-scoped idempotency key from the server request ID; an existing durable business key such as `submission_id` replaces it. Human Owner/Admin auth retains Unit 10's trusted snapshots. API-secret callers use fixed non-forgeable system actor/initiator ID `vantage-api-secret`; scoped-key callers use `vantage-scoped-api-key:<server-side-key-fingerprint>`. These compatibility system snapshots use command origin and actor origin `vantage_admin` without pretending to be human; extend `DurableActor` and Unit 10 context validation only for those two exact server-built IDs, while retaining all human validation. No credential/key value is persisted. Reuse within one request/retry replays; a later request without a durable key is a new command, matching current semantics. Clients cannot supply any context field.
- Transaction-bound internals accept the executor's `{ session, now }`, never open `withTransaction`/`runSheetSyncWrite`, and return deterministic changed-field/entity/outbox descriptors. Existing helpers remain authoritative.
- Add compatibility canonical delete adapters for current Form Lead, Call Lead, Booking, and Cancellation delete routes, including existing cascade rules. Narrow **issue-author guidance** is to record one final Change per deleted aggregate with `changed_paths:["$deleted"]`, one `reference_only` field descriptor with no raw values/hashes, and `revision_before = current domain_revision`, `revision_after = revision_before + 1`; then delete the aggregate and persist Command plus applicable Sheet Sync tombstone/outbox work in the same transaction. Surviving mirrored aggregates receive their normal Change/revision linkage. The durable Change/Command is the post-delete evidence; no nonexistent aggregate can retain `last_change_id`. Replay returns the stored result, and any cascade failure rolls back all deletes, survivor mutations, Changes, Command, and outbox work.
- Remove every direct route/model mutation in the affected create/update/delete boundary. Any remaining bypass is a blocking contradiction.
- Do not implement or activate `synchronizeLeadFromGranot`, `createLeadFromGranot`, owner `updateBooking`, lifecycle `createReferralBooking`, `establishGranotRecordLink`, or `correctGranotRecordLink`; later units own their policies and callers.

### 6.4 Documentation

Update domain-command, Sheet Sync, project/schema rules, and affected Lead/Booking/Cancellation docs for executor-owned transactions, append-only Changes, queued outbox atomicity, and post-commit finalization. State that lifecycle callers and later owner commands remain disabled.

## 7. Explicitly out of scope

- Unit 09 revisions/migrations or Unit 10 executor/provenance/replay implementation.
- Lead provenance/migration (Units 12–13), identity/planning (Units 14–15), matched Lead effects (Unit 18), or Lead creation (Unit 19).
- Booking/Release cases and owner commands, Granot Referral workflow, discrepancies, and link correction (Units 22–29).
- Historical Change backfill, fabricated history, full event sourcing, Admin/extension work, RingCentral, notifications, rollout, compatibility removal, flag enablement, production apply, or current payload access.

## 8. Flags and runtime posture

Starting and ending posture are identical:

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

No activation changes. Historical shadow cannot invoke business commands or create Sheet work. Existing non-lifecycle callers remain functional through adapters; no lifecycle caller becomes live.

## 9. Migration and indexes

- **Data migration: none.** Never backfill Changes or modify predeployment facts. Unit 09 owns revision/history migration.
- Add the four exact indexes to `migration:granot-lifecycle:indexes` without weakening existing checks.
- Use report -> reviewed apply -> verify. Omitted mode is report; modes are exclusive; unknown/historical databases are rejected; verify is read-only/nonzero; production apply requires separate approval and exact `--apply --confirm-production=<database-name>`.
- Create nonunique indexes first and the unique entity/revision index only after zero collisions. Manifests contain counts, definitions, and masked IDs only.

## 10. Acceptance criteria

- [ ] **AC-21 exact release assertion (foundation/partial here):** “Two concurrent owner commands with one case revision have one winner; replay of winner returns stored result; loser conflicts or resolves already-satisfied without second mutation.” Unit 11 proves generic Command/Change/revision/outbox single-winner and replay/no-second-mutation; owner-case behavior remains Units 24–25/27.
- [ ] **AC-32 exact release assertion (foundation/partial here):** “No-op accepted Observation creates neither Entity Change nor Sheet Sync; every mutation has Receipt -> Observation -> Decision -> Command -> Change refs.” Unit 11 proves Change/outbox and causal-reference foundation; accepted-Observation effects remain later.
- [ ] One real synthetic mutation commits exact Command, per-aggregate Change/revision linkage, and applicable outbox intent; every injected failure commits zero partial chain.
- [ ] No-op and exact replay create no Change, revision increment, outbox intent, or external finalization.
- [ ] Contact/address fields are reference-only and no forbidden value appears in serialization, logs, manifests, or fixtures.
- [ ] Existing Lead/Booking/Cancellation/leadless/Referral behavior and envelopes remain compatible, including Booking uniqueness and domain helpers.
- [ ] No external call occurs inside the transaction; only committed outbox work triggers post-commit wake-up.

## 11. Required tests and commands

- Model tests: exact fields, validators, immutability/privacy, revision adjacency, and index definitions.
- Replica-set tests: mutation/no-op, replay/race, expected-revision race, callback retry, and rollback injection at every chain stage.
- Adapter tests across Form/Call, Booking, leadless, Referral, Cancellation, and cascade-delete seams; route tests for adapter entry and unchanged envelopes/auth access.
- Forbidden-effect assertions: no lifecycle Lead/create, case/discrepancy, notification, or network call inside the transaction.

Run exactly:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/EntityChange.test.ts" "src/services/domainCommands/domainCommands.test.ts" "src/services/domainCommands/idempotency.integration.test.ts" "src/services/sheetSync/sheetSyncOutbox.service.test.ts"
pnpm test:granot-lifecycle:replica -- --unit=11
pnpm test
pnpm typecheck
```

Also run lifecycle index report/verify against the disposable database. Fakes alone cannot prove atomicity or races.

## 12. Live/staging verification

- With `TEST_MODE=true`, a disposable replica set, `SHEET_SYNC_MODE=queued`, and all external targets disabled/faked, execute redacted synthetic writes through production canonical adapters.
- Inspect masked IDs only and prove one Command/Change/revision/outbox chain, exact replay, no-op absence, rollback absence, and no pre-commit external call.
- Exercise at least one Lead mutation and one Booking/Cancellation-chain adapter because their outbox descriptors differ. Do not use production data, live payloads, or provider calls.

## 13. Rollback

- Disable the affected write route/capability first. Deploy prior code only when it still enters the canonical executor and preserves post-boundary Command/Change/revision/outbox evidence; never restore a direct mutation bypass. Lifecycle effects should already be false.
- Retain additive schema/indexes, every committed Command/Change/outbox row, aggregate revision/last-change link, receipt/Observation/Decision, activation/link evidence, and official fact.
- Never decrement revisions, delete evidence, replay an uncommitted finalizer, or fabricate compensating history. Index rollback requires a separately reviewed manifest-backed action.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-11-COMPLETION.md` per Runbook Section 13, including:

- behavior-grouped model/executor/adapter/outbox/route/docs files;
- Sections 23.2–23.4/34.5/35.1, invariants 1–2/4–10 as applicable, S07, and partial AC-21/AC-32 mapping;
- exact privacy classifications/index definitions and report/verify status;
- flags before/after; focused/full/replica results with exact outcomes;
- masked mutation/no-op/replay/race/rollback proof and no external effect before commit;
- canonicalized create/update/delete path inventory, trusted human/API-secret/scoped-key context proof, and delete/tombstone atomicity evidence;
- final `git status --short` and explicit external-action statement.

Successful verified implementation completes S07 and unblocks **Unit 12**. Unit 12 still requires Unit 05 evidence and must preserve this unit's canonical mutation boundary.
