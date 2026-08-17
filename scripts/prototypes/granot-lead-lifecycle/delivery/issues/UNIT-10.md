# Unit 10 — Transaction-owning canonical command executor and idempotent replay

> **Contract maturity: implementation-ready once Unit 09 is complete.** This is the transaction coordinator core of S07. It makes the canonical executor—not Sheet Sync or an ambient context—the owner of one Mongo transaction, durable command result, causal provenance, and replay/conflict decision. It does not add `EntityChange`, complete outbox atomicity, canonicalize every legacy write, or enable a lifecycle effect.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 23.1–23.2, only the common owner-command envelope in 24 through line 1445, 25, 27, 28.4, 34.7, 35–36, 37.1–37.2, 38/S07, and 39–41.
- **Acceptance ownership:** executor/revision/replay foundation of AC-21 and Receipt/Observation/Decision/Command causal foundation of AC-32. Units 11, 18, 24–25, and 27 complete the Change/outbox/no-op and case-specific production proofs.
- **Approved split:** Unit 10 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 09 owns aggregate fields/migrations; Unit 11 owns `EntityChange`, outbox completion, and wholesale adapter canonicalization.
- **Execution:** delivery runbook, repository instructions, domain-command/Sheet Sync/business-logic rules and docs, Unit 09 completion report, and verified repository state.

The final specification wins. “Preallocate causal IDs” means the caller/processor allocates its Decision ID before invocation and the executor preserves supplied causal IDs across transaction callback retries. It must not take ownership of Unit 07's processor/Decision model or invent a second ID contract.

## 2. Objective

Refactor `executeIdempotentCanonicalCommand` to own one Mongo transaction, call operations with a stable `{ session, now }`, persist an exact replayable `DomainCommandExecution` result, validate the four command origins and their trusted actor/initiator/provenance contexts, preserve preallocated causal IDs, and resolve same-key races as exact replay or `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` without partial Decisions or aggregate effects.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** verified Unit 09 implementation, migration/index evidence, and shared-branch sequencing.
- Reverify `domain_revision` on all four aggregates, Unit 09's boundary/compatibility posture, Unit 07's Decision type/model if it has landed, durable actor types, Mongo connection/session helpers, current domain command adapters, Sheet Sync coordinator, and every lower service that currently starts `runSheetSyncWrite`.
- Transaction/concurrency verification requires `TEST_MODE=true`, a verified disposable replica-set database, `SHEET_SYNC_MODE=disabled` or isolated fake adapter, and no live CRM/queue/email/provider target.
- No commit, push, deploy, production mutation/index sync, activation, current-payload inspection, or external send without separate authorization.

## 4. Current-state evidence to verify

Observed on 2026-08-17; implementation must reverify after Unit 09 lands:

- `src/services/domainCommands/idempotency.ts` uses `AsyncLocalStorage`. Its zero-argument operation starts lower-level work, and `persistActiveCanonicalCommandExecution` is called by `runSheetSyncWrite`; the executor itself owns no session or clock.
- `src/services/sheetSync/sheetSyncCoordinator.ts` currently owns `withTransaction`, invokes the service callback, persists active command evidence, and performs external finalization after commit. Transaction ownership must be inverted without moving external calls inside the transaction.
- Lead/Booking/Cancellation services call `runSheetSyncWrite` internally. Current canonical adapters in `src/services/domainCommands/{leads,bookings,cancellations}.ts` pass zero-argument operations. Only the internal seams needed by existing canonical callers should accept the executor's session/clock now; Unit 11 owns complete adapter canonicalization.
- `CanonicalCommandContext.provenance.origin` and the Mongoose enum accept only `external_sheet_ingestion | vantage_admin`. Granot/RingCentral causal fields and trusted actors are absent.
- `DomainCommandExecution` stores top-level `entity_refs`/`warnings`, not the exact nested `result`; current replay synthesizes `status:"already_applied"` instead of returning stored result.
- Unique `(origin,idempotency_key)` and unique `command_id` already exist. Preserve them; no second idempotency collection/index is permitted.
- Existing domain-command tests manually trigger ambient persistence and are memory/fake level. They do not prove a real Mongo transaction, commit race, revision CAS, or rollback.
- `src/db.ts` already exposes transaction handling and warns callbacks can retry; transaction code must be deterministic and contain no external effects.

## 5. Locked decisions and invariants at risk

- **Invariant 1 — MongoDB is the System of Record:** command identity/result and transaction outcome are durable; process memory and external systems cannot decide replay.
- **Invariant 2 — Granot evidence is not official-fact authority:** adding Granot command provenance grants no automatic Booking/Cancellation command.
- **Invariant 5 — only canonical commands mutate aggregates:** the executor is the atomic command boundary. Unit 11 later removes remaining direct mutation paths.
- **Invariant 6 — complete causal transaction:** this unit owns transaction ownership, Decision/Command/revision atomicity, and stable references; Unit 11 completes `EntityChange` and outbox linkage. Do not claim the full invariant early.
- **Invariant 7 — no-op creates no Change/Sheet work:** replay never reruns the operation or creates a second business mutation. Full desired-state no-op proof remains later.
- **Invariant 8 — provenance axes remain independent:** command origin, Observation Channel, actor, initiator, receipt, and source connection are not aliases.
- **Invariant 9 — immutable evidence is never overwritten:** conflicts and replay return/retain the original execution; they never rewrite its payload checksum, command name, provenance, or result.

## 6. Deliverables and exact contract

### 6.1 Command context and trusted provenance

Extend the shared type and Mongoose enum exactly:

```ts
type CommandOrigin =
  | "external_sheet_ingestion"
  | "vantage_admin"
  | "granot_lifecycle"
  | "ringcentral";

provenance: {
  origin: CommandOrigin;
  run_id: string | null;
  source_receipt_id: string | null;
  source_connection_key: string | null;
  observation_id?: string | null;
  decision_id?: string | null;
  case_id?: string | null;
  discrepancy_id?: string | null;
  observation_channel?: ObservationChannel | null;
};
```

Retain existing compatibility fields and rules. Context validation is fail-closed:

- `granot_lifecycle` requires the fixed processor actor `{ actor_type:"system", actor_id:"granot-lifecycle-processor", actor_label:"Granot Lifecycle Processor", actor_role:"system", origin:"granot_lifecycle", request_id:<receipt id> }`, nonblank receipt/Observation/Decision IDs, and matching `source_receipt_id`/request ID.
- A webhook command initiator is fixed system actor ID `granot-webhook`. Browser-extension or Vantage Admin initiated lifecycle commands require a server-authenticated Owner; no client-supplied system snapshot is accepted. `observation_channel` must agree with the initiator path.
- `ringcentral` requires fixed system actor/initiator ID `ringcentral-call-ingest` plus the existing trusted server telephony provenance seam. The final spec does not publish a client field shape; **issue-author guidance** is to reject the context unless repository code can verify it server-side—never accept a boolean assertion from a caller.
- Existing external-sheet-ingestion and Vantage Admin validations remain unchanged.
- Extend `DurableActor` origins compatibly with system `granot_lifecycle`/`ringcentral` and human `browser_extension`; do not weaken existing actor factories/validators.

### 6.2 Durable execution model and compatibility

New rows persist the exact result:

```ts
result: {
  status: "applied";
  entity_refs: Array<{ model: string; id: string }>;
  warnings: string[];
};
```

- Preserve existing top-level `origin`, `entity_refs`, `warnings`, actor/initiator/provenance, command name/checksum/ID, and `applied_at` compatibility fields while readers are migrated.
- Read legacy rows without `result` by deriving the same immutable stored result from top-level refs/warnings. Do not backfill or rewrite them in this unit.
- The existing unique `(origin,idempotency_key)` and `command_id` constraints remain.
- Same origin/key + same command name + same lowercase SHA-256 checksum returns the stored result exactly and does not call the operation.
- Same origin/key with a different command name or checksum throws exact `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` and creates no row/effect.
- A replay is identified in PII-safe post-commit telemetry, not by changing the stored/domain result to `already_applied`. Any existing caller that requires that old status gets an explicit one-way compatibility adapter; new executor semantics return stored `status:"applied"`.

### 6.3 Transaction-owning executor

Replace the ambient persistence contract with an explicit operation boundary:

```ts
operation(input: {
  session: ClientSession;
  now: Date;
}): Promise<{
  entity_refs: Array<{ model: string; id: string }>;
  warnings?: string[];
}>;
```

The implementation may name the result type differently but must preserve this information and explicit `{session,now}` ownership.

Required sequence:

1. Validate context, normalize checksum, connect, allocate the logical `now` once before the transaction, and preserve caller-preallocated command/causal IDs.
2. Start one Mongo session/transaction in the executor. Transaction callback retries reuse the same clock and IDs.
3. Read `(origin,idempotency_key)` through that session. Return exact existing result or throw conflict without invoking the operation.
4. Invoke the transaction-bound operation with `{session,now}`. It may persist the preallocated effect-bearing Decision and expected-`domain_revision` aggregate change applicable to the caller.
5. Persist one `DomainCommandExecution` with exact result and causal provenance in the same session. Commit once.
6. Only after commit emit operational telemetry. Sheets, queue publish, email, CRM, and other network calls are forbidden inside the transaction; existing command adapters may perform their current external finalization only after the executor returns successfully. Unit 11 owns durable outbox completion.
7. On duplicate-key/commit race, end/abort the losing transaction, reload durable execution, and return it only when command name/checksum agree; otherwise conflict.
8. On any dependency/operation/execution-persist/commit failure, no proposed Decision, aggregate change, or command execution may remain visible.

Remove `AsyncLocalStorage`/`persistActiveCanonicalCommandExecution` as the persistence authority. A temporary compatibility shim may call the new executor, but Sheet Sync must no longer own command transaction completion.

### 6.4 Transaction-bound service seam

- Split lower Lead/Booking/Cancellation write services into explicit transaction-bound internals only where current canonical command adapters require them. Internals accept the caller's session/clock and never call `withTransaction`, finalize Sheets, publish queues, or perform network I/O.
- Preserve current public noncanonical service behavior until Unit 11. Public legacy paths may continue owning their existing transaction/finalization; they must not be silently rerouted or disabled here.
- Adapt current canonical ingestion/admin command wrappers to the new operation signature while preserving validation and results. Unit 11 later adds Changes/outbox/revision linkage everywhere and removes remaining direct route/model mutation.
- Do not define Booking review/Cancellation case commands, owner routes, or `already_satisfied` case logic.

### 6.5 Causal IDs, Decisions, and revision races

- A lifecycle caller supplies its preallocated `decision_id`; the executor validates and persists it in provenance. It never generates a replacement Decision ID.
- When Unit 07's real `SynchronizationDecision` model is present, integration proof inserts the effect-bearing Decision in the same transaction. If Unit 07 is not yet implemented, use a test-only transactional collection/model; do not pull Unit 07 production work into this unit.
- Generic Lead CAS proof uses exactly `{ _id: lead_id, domain_revision: expected_lead_revision }` and increments once. A zero match is `DOMAIN_REVISION_CONFLICT` with no Decision/Command.
- Booking/Cancellation/case filters and owner HTTP `Idempotency-Key` parsing remain later-unit work. Preserve capability for the common envelope: service command contains `case_id`, expected case revision comes from strict body, route supplies case ID, server derives actor/initiator/checksum, and idempotency keys are 8–200 printable characters without edge whitespace.

### 6.6 Documentation

Update domain-command, Sheet Sync coordinator, project-organization, schema/testing, and applicable business-logic docs to record the executor-owned transaction and post-commit external-effect rule. State clearly that `EntityChange`, complete outbox linkage, and full write-path canonicalization remain Unit 11.

## 7. Explicitly out of scope

- Unit 09 aggregate migration/index work or changing the honest history boundary.
- `EntityChange`, privacy/change summaries/indexes, complete Sheet Sync outbox atomicity, full no-op chain, and removal of every direct write path (Unit 11).
- Unit 07 Decision/Activation/Record Link implementation, lifecycle processing/planning, Lead effects, reconciliation/cases, specific owner commands/routes/Zod/error mapping, UI, extension/automation cutover, or RingCentral adoption.
- Automatic Booking creation/update, Cancellation/un-cancellation, case resolution, or official-fact inference from Granot.
- New indexes, data backfill, production migration, activation, rollout, or effect enablement.

## 8. Flags and runtime posture

Unit 10 changes no lifecycle flag and enables no caller. If Unit 07 config exists, starting and ending values are exactly:

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

If Unit 07 has not landed the module, do not create it here merely to express posture.
- Capture remains independent. No activation is created. Existing external-ingestion/admin callers remain compatible, but no Granot/RingCentral lifecycle caller is made live here.
- Starting and ending effect posture is identical.

## 9. Migration and indexes

- **Data migration: none.** Additive optional causal/result fields and compatibility readers allow legacy command rows to remain untouched. A discovered required rewrite is a scope contradiction to report, not an implicit migration.
- **Index migration: none.** Retain and model-test existing unique `(origin,idempotency_key)` and `command_id` constraints; do not create another replay authority.
- Unit 09 owns S07 aggregate revision/index report/apply/verify. No production index sync/apply is authorized.

## 10. Acceptance criteria

- [ ] **AC-21 exact release assertion (foundation/partial here):** “Two concurrent owner commands with one case revision have one winner; replay of winner returns stored result; loser conflicts or resolves already-satisfied without second mutation.” Unit 10 proves the generic executor/revision winner, exact stored-result replay, conflict, and no second mutation; case-specific behavior remains Units 24–25/27.
- [ ] **AC-32 exact release assertion (foundation/partial here):** “No-op accepted Observation creates neither Entity Change nor Sheet Sync; every mutation has Receipt -> Observation -> Decision -> Command -> Change refs.” Unit 10 proves Receipt/Observation/Decision causal IDs on Command plus atomic Decision/revision/Command rollback and replay; Unit 11/later effects own Change, outbox, and complete no-op proof.
- [ ] All four origins validate exactly; Granot and RingCentral system identities cannot be client-forged; existing external/admin contexts still work.
- [ ] New rows store exact nested result; legacy top-level-result rows replay compatibly without mutation.
- [ ] Stable IDs and `now` survive driver transaction callback retry.
- [ ] Failure injected before/after operation and during command persistence/commit leaves zero partial Decision, aggregate delta, or execution.
- [ ] No external Sheet/queue/email/CRM call occurs before commit; executor emits only bounded PII-safe post-commit events.

## 11. Required tests and commands

Required focused coverage:

- model/type/context tests for four origins, exact actor/initiator/provenance combinations, legacy-row compatibility, nested result, and unchanged unique indexes;
- real disposable replica-set integration for exact replay, checksum/name conflict, same-key commit race, expected-revision race, stable callback-retry clock/IDs, and rollback at every stage;
- tests proving the operation receives the actual session and lower transaction-bound internals do not open nested transactions;
- post-commit boundary tests proving existing external finalization is absent on rollback and never runs inside the transaction;
- forbidden-effect assertions: zero `EntityChange`, case/discrepancy/notification, external publish/send, and automatic Booking/Cancellation fact.

Add or reuse the fixed safe package runner `test:granot-lifecycle:replica`. It must refuse non-test/historical/production databases, require a replica-set topology, and allocate a disposable database. This runner name is **issue-author guidance** so the transaction proof is reproducible instead of relying on an ambient `MONGO_URI`.

Use AC-21/AC-32 in test names and run exactly:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/DomainCommandExecution.test.ts" "src/services/domainCommands/domainCommands.test.ts" "src/services/domainCommands/idempotency.integration.test.ts"
pnpm test:granot-lifecycle:replica -- --unit=10
pnpm test
pnpm typecheck
```

Do not point transaction tests at an ambient or production URI. Fakes alone cannot prove transaction/race claims.

## 12. Live/staging verification

- In a disposable replica-set database, execute one synthetic command through the production executor with masked causal IDs. Prove exactly one Decision/aggregate revision/Command transaction, exact replay, conflict behavior, and rollback without partial rows.
- This is only Unit 10's partial S07 proof. The full Command -> `EntityChange` -> revision -> outbox chain is explicitly deferred to Unit 11.
- No new route exists, so no Vercel/Admin/client smoke is required. Production remains read-only and separately approved; inspect only counts and masked IDs, never payload/contact values.

## 13. Rollback

- Disable any new Granot/RingCentral caller first; none should be enabled by this unit. Preserve existing ingestion/admin compatibility while reverting the executor adapter if required.
- Retain additive command fields, all `DomainCommandExecution` rows, supplied Decisions, aggregate revisions, and committed official facts. Never delete command/Decision evidence or decrement revisions.
- External finalizers remain after-commit; rollback must not replay them from uncommitted/failed executions.
- Preserve receipts, activation, links, Changes, outbox work, cases, discrepancies, and audits that exist at rollback time.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-10-COMPLETION.md` per Runbook Section 13, including:

- files grouped by context/model, executor, transaction-bound internals/adapters, tests, and docs;
- Sections 23.1–23.2/24 common envelope, invariants 1/2/5/6/7/8/9, S07, and partial AC-21/AC-32 mapping;
- exact stored-result/replay/conflict contract, actor/provenance matrix, transaction sequence, and post-commit boundary;
- replica-set command output for replay/races/rollback/stable clock and masked causal-chain evidence;
- confirmation that no migration/index apply, `EntityChange`, full outbox canonicalization, lifecycle effect, or external send occurred;
- flags before/after, compatibility/deferred risks, final `git status --short`, and explicit external-action statement.

Successful verified implementation unblocks **Unit 11**. Full AC-32/S07 certification remains blocked until Unit 11 and later effect-owning units complete their interfaces.
