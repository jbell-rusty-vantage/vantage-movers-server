# Apply This Named Command Once — Refuse A Bad Speaker First, Then Replay The Stored Apply Or Run The Operation Inside One Mongo Write, Persist Applied, And After A First Successful Commit Tell The Rest Of The Company — Never Rewrite Stored Status To Already-Applied, Never Finalize A Replay Or A No-Op, Never Talk To Sheets Or CRM Inside The Transaction — operational story

- Status: recommended
- Service: `domainCommands` (Wave A, in-progress)
- Pass: 1 of this service — `idempotency.ts`
- Remaining in this service: `commandContext.ts`, `ringcentralProvenance.ts`, `entityChange.ts`, `existingWriteContext.ts`, `existingWrites.ts`, `bookings.ts`
- Target: `src/services/domainCommands/idempotency.ts`
- Knowledge: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) (`applies_to` names this file as `resource` / primary). Distinct from who may speak: later `commandContext.ts`. Distinct from trusted RingCentral telephony: later `ringcentralProvenance.ts`. Distinct from append-only Entity Change + revision stamp: later `entityChange.ts`. Distinct from HTTP → trusted context: later `existingWriteContext.ts`. Distinct from public Form/Call/Booking/Cancellation adapters: later `existingWrites.ts`. Distinct from exact `updateBooking` / attach: later `bookings.ts`. Distinct from the thin registry object: `index.ts` (skipped on open). Distinct from Sheet Sync persist / finalize: [recommendations/sheet-sync-coordinator.md](sheet-sync-coordinator.md) — this file only decides *when* finalize may run. Distinct from Form Lead begin / complete: [recommendations/form-lead.md](form-lead.md). Distinct from Granot create / sync / Owner Booking / Release / Referral / discrepancy commands — those call this **interface**; they are not this story. Checked-in Granot Lead-write / Booking / Release / Referral effect flags stay false — do not describe those Owner paths as live. This checkout’s `CONTEXT.md` is a pointer to a parent glossary that is not in this tree — do not invent “Domain Command” / “Entity Change” copies. `docs/adr/` is absent here — do not invent ADR-0001 copies.
- Callers: **two real execute seams, plus the injected factory for tests.** `executeCanonicalCommandWithPostCommit`: `existingWrites.ts` (every public create / correct / delete adapter), `bookings.ts` `attachBookingToLead`, `granotLifecycle/createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, `ringcentral/callLeadConvergence.service.ts`. `executeIdempotentCanonicalCommand` directly (they own their own after-commit): `bookings.ts` `updateBooking`, `granotLifecycle/bookingConfirmation.ts`, `bookingOwnerCommands.ts`, `connectBookingToLead.ts`, `referralBooking.ts`, `releaseOwnerCommands.ts`, `discrepancyOwnerCommands.ts`. Barrel `domainCommands/index.ts` re-exports this file. Routes and ingestion talk to adapters / `canonicalDomainCommands`, not this file. Tests: `domainCommands.test.ts` (AC-21 / AC-32 context fail-closed, exact replay, checksum conflict, failed op leaves no row, stable `now` + IDs on txn retry, compatibility `already_applied` is one-way). `idempotency.integration.test.ts` (opt-in replica: exact replay, same-key race one winner, persist failure rolls back Decision + aggregate + Command, post-commit finalize never runs on rollback). `entityChange.integration.test.ts` uses the post-commit wrapper as a harness. Not this **interface**: `assertCommandContext` rules, `existingWriteContextFromRequest`, `persistEntityChangeMutations`, `toCompatibilityCanonicalCommandResult` (lives on `types.ts`).
- Seams callers need: apply-or-replay vs apply-then-complete-after-commit; `operation({ session, now, command_execution_id })` before commit vs `finalize(pending)` after a successful **non-replay** when `pending` is defined; durable stored `{ status: "applied" }` vs compatibility `already_applied` (one-way, not stored); injected `{ store, connect, withTransaction, now, contextVerifier }` vs the default mongoose store. There is no Decision-ID **adapter**. There is no Sheet / CRM / email **adapter** inside the transaction.
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting (~291 lines). If it later splits: `applyThisNamedCommandOnce.ts` / `completeThePendingWorkAfterTheFirstApply.ts` — never `create.ts` / `update.ts` / `delete.ts` / `execute.ts`. Context origin rules, Entity Change, HTTP context, and public adapters stay siblings.

`executeIdempotentCanonicalCommand` / `executeCanonicalCommandWithPostCommit` / `createIdempotentCanonicalCommandExecutor` are executor mechanics. The owner question is: *Someone already named the command, already built a trusted context, and already wrote an operation that mutates inside one Mongo session. Refuse a bad speaker before connecting. Run the named command once. If this origin plus idempotency key already stored the same command name and checksum, hand back that stored applied result and do not run the operation again. If the key was used with a different name or checksum, refuse. Persist one DomainCommandExecution whose stored status is always applied. After commit, record a PII-safe applied or replayed event. Sheets, queue publish, email, and CRM stay out of the transaction. The post-commit wrapper runs those only after a successful first apply when the operation left a pending bag. A no-op returns `pending: undefined` so finalize is skipped. A failed write leaves no Decision, no aggregate delta, no command row. A duplicate-key race reloads the winner and treats it as replay when name and checksum agree.*

Who may speak, how HTTP builds context, how a Form Lead or Booking writes, and how Entity Change is appended already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “apply this named command once” story, not “an idempotency helper,” and not Form Lead Ingestion / Book The Job / confirm a Granot Booking:

1. **Apply this named command once, or hand back the stored apply** — refuse unless `assertCommandContext` accepts the speaker (sibling). Lowercase the SHA-256 checksum. Connect Mongo. Allocate logical `now` once. Keep the caller’s `command_id` as the execution `_id` when it is an ObjectId hex; otherwise mint `_id` and still persist the caller’s `command_id` string. Open one session/transaction. Session-scoped read of `(origin, idempotency_key)`. Exact stored result → `{ replayed: true }` and **do not** invoke `operation`. Name or checksum disagree → `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`. Else run `operation({ session, now, command_execution_id })`, persist one `DomainCommandExecution` with nested `result.status: "applied"` plus compatibility top-level `entity_refs` / `warnings`, commit once. Transaction-callback retries reuse the same clock and IDs. Duplicate-key `11000` after abort: reload without a session; return the stored result only when name and checksum agree; otherwise conflict. Any operation / persist / commit failure leaves no visible Decision, aggregate delta, or command row. After the transaction (apply **or** replay): PII-safe `domain_command.applied` / `domain_command.replayed`. This beat never generates a Decision ID. This beat never calls Sheets, CRM, email, or queue publish.

2. **After a first successful apply, complete the pending after-commit work** — wrap operation 1. The operation may return `pending`. Finalize runs only when the outcome is **not** a replay **and** `pending !== undefined` **and** a `finalize` was passed. A no-op adapter omits `pending` so finalize is skipped. Return `toCompatibilityCanonicalCommandResult` (sibling on `types.ts`): callers that still count `already_applied` see it only here; the durable row stays `applied`. This beat does not open a second transaction. This beat does not re-run `operation` on replay.

There is no third mutate operation. `createIdempotentCanonicalCommandExecutor` is the test / replica **adapter** (inject store, connect, transaction runner, clock, context verifier). `mongooseExecutionStore` is the default command-result **adapter**. `findExisting` is the replay-or-conflict **seam**, not a second story. `normalizeCommandContext` / `toStoredResult` / `isDuplicateKeyError` are folds.

## Organization

Keep one file. This is the screenplay for “apply this named command once.” Origin rules already live on later `commandContext.ts`. RingCentral telephony already lives on later `ringcentralProvenance.ts`. Entity Change + revision CAS already live on later `entityChange.ts`. HTTP context already lives on later `existingWriteContext.ts`. Public adapters already live on later `existingWrites.ts`. Compatibility `already_applied` already lives on `types.ts`. Sheet Sync persist / finalize already live on `sheetSync`. Do not pull those in. Do not invent a `DomainCommandExecutorService` class. Do not invent a Decision-ID **seam** — the executor never mints one. Do not invent a Sheet **adapter** here so “one command owns every side effect.”

Do not move `assertCommandContext` into this file so “the executor owns who may speak.” Do not move `persistEntityChangeMutations` here so “apply includes the Change.” Do not move `toCompatibilityCanonicalCommandResult` here so “stored status can be already_applied.” Do not move `updateBooking`’s after-commit `finalizeSheetSync` here so “every caller uses the wrapper.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createIdempotentCanonicalCommandExecutor` | `buildTheCommandApplyOnce` | tests and replica proof inject store / clock / txn / verifier |
| `executeIdempotentCanonicalCommand` | `applyThisNamedCommandOnce` | default apply-or-replay; Owner commands that own their own after-commit |
| `executeCanonicalCommandWithPostCommit` | `applyThisNamedCommandThenCompleteAfterCommit` | public adapters and Granot create/sync / RingCentral adopt; finalize only after first apply |
| `CanonicalCommandExecutionStore` | `theDurableCommandResultAdapter` | find `(origin, key)` / persist the applied row |
| `CanonicalCommandTransactionRunner` | `theOneMongoWrite` | default `withTransaction`; tests inject a fake session |

Keep the old names as one-line aliases until `existingWrites`, Granot Owner modules, and RingCentral adopt migrate. Do not make callers learn `execute` / `withPostCommit` as the domain language.

`CanonicalCommandExecutionOutcome` is the handoff bag (`result` + `replayed`). Keep the old type name as an alias. Do not add `status: "already_applied"` on the stored result so “replay is visible in Mongo.”

The one type that earns a name is the pending after-commit bag the wrapper already threads:

```ts
type CommandApplyInProgress<TPending> = {
  evidence: { entity_refs; warnings? }
  pending?: TPending
}
```

That is today’s operation return plus optional `pending`. Do not add `decision_id` so “the executor can mint.” Do not add `finalizeInsideTransaction` so “sheets are safer.”

Leave origin asserts on `commandContext.ts`. Leave `toCompatibilityCanonicalCommandResult` on `types.ts`. Leave Entity Change on `entityChange.ts`. Leave HTTP context on `existingWriteContext.ts`. Leave public adapters on `existingWrites.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// idempotency.ts
// Someone already named the command and brought a trusted context.
// Refuse a bad speaker before connecting.
// Run the named command once.
// Same origin + key + name + checksum → hand back the stored apply.
// Different name or checksum on that key → refuse.
// Stored status is always applied.
// After commit, record applied or replayed.
// Sheets, CRM, email, and queue publish stay out of the write.
// Finalize the pending bag only after a first successful apply.

// ── 1. Apply this named command once ──────────────────────

export function buildTheCommandApplyOnce({ store, connect, withTransaction, now, contextVerifier })
export const applyThisNamedCommandOnce = buildTheCommandApplyOnce({
  store: theMongoCommandResultStore,
  connect: connectMongo,
})

async function applyOrReplayTheStoredResult(command)
  await refuseUnlessThisSpeakerMayIssueThisCommand(command.context) // sibling
  const context = rememberTheChecksumInLowercase(command.context)
  await connectMongo()
  const now = theClockForThisAttempt()                 // once; retries reuse it
  const executionId = keepTheCallerCommandIdWhenItIsAnObjectIdHex(context.command_id)
  try
    return await openTheOneMongoWrite(async (session) => {
      const stored = await loadTheStoredApplyOrRefuseAKeyFight(store, command.command_name, context, session)
      if (stored) return { result: stored, replayed: true }   // do not run operation
      const evidence = await command.operation({ session, now, command_execution_id: executionId })
      const result = rememberTheApply({ status: "applied", ...evidence })
      await persistTheCommandRow({ executionId, context, result, now, session })
      return { result, replayed: false }
    })
  catch (error)
    if (!thisWasADuplicateKeyRace(error)) throw error
    const winner = await loadTheStoredApplyOrRefuseAKeyFight(store, command.command_name, context) // no session
    if (!winner) throw error
    return { result: winner, replayed: true }
  await recordWhetherThisWasAnApplyOrAReplay(command.command_name, context, outcome)

async function loadTheStoredApplyOrRefuseAKeyFight(store, commandName, context, session?)
  // missing → null
  // same name + checksum → stored applied (copied)
  // else DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT

// ── 2. After a first successful apply, complete ───────────

export async function applyThisNamedCommandThenCompleteAfterCommit({ command_name, context, operation, finalize })
  let pending
  const outcome = await applyThisNamedCommandOnce({
    command_name,
    context,
    operation: async (tx) => {
      const evidence = await operation(tx)
      pending = evidence.pending
      return { entity_refs: evidence.entity_refs, warnings: evidence.warnings }
    },
  })
  if (!outcome.replayed && pending !== undefined && finalize)
    await finalize(pending)
  return theCompatibilityCount(outcome)                // sibling; already_applied only here
```

Read the apply path out loud: *refuse a bad speaker, remember the checksum in lowercase, connect, pick one clock, keep the caller’s command id when it is an ObjectId hex, open one Mongo write, look up origin plus key, hand back the stored apply when name and checksum match, refuse when they fight, otherwise run the operation, persist applied, commit. After that write, record applied or replayed. If this was a first apply and the operation left a pending bag, then tell the sheets or the rest of the company. A replay or a no-op does not finalize. A failed write leaves nothing.*

That is the operation. `createIdempotentCanonicalCommandExecutor` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file is named idempotency.** It owns the transaction, the durable command row, the replay/conflict decision, after-commit telemetry, and the post-commit finalize gate. Idempotency is one beat inside “apply once.” The file name should say the story (`applyThisNamedCommandOnce` / keep the path and alias the old file name until callers move).

2. **`findExisting` lies.** It is not a read. It is “load the stored apply, or refuse a key fight.” Callers of the store `find` still need a raw read; the name/checksum fight belongs on the story function.

3. **`updateBooking` and the gated Owner commands re-implement after-commit.** They call `applyThisNamedCommandOnce` and then `finalizeSheetSync` themselves. That is the same **seam** as `applyThisNamedCommandThenCompleteAfterCommit`. Do not pull those siblings into this file. Do not silently migrate them in this pass. A later `bookings.ts` / Owner-command pass should say the wrapper out loud, not invent a second finalize.

4. **Telemetry is after commit and can fail after a successful apply.** Knowledge already places `domain_command.applied` / `domain_command.replayed` after commit. Do not move the event inside the transaction so “we never lose the log.” Rename the beat (`recordWhetherThisWasAnApplyOrAReplay`) so the order is visible.

5. **Minted `_id` vs caller `command_id`.** When the caller’s `command_id` is not an ObjectId hex, `_id` is minted and `command_id` stays the caller string. That is load-bearing for Granot / test prefixes. Do not silently require every `command_id` to be hex so “the two ids match.”

6. **Leave sibling modules alone.** `assertCommandContext`, `persistEntityChangeMutations`, `existingWriteContextFromRequest`, `toCompatibilityCanonicalCommandResult`, and `finalizeSheetSync` are already the right **depth**. This file orchestrates the first and the last; it does not own them.

7. **Do not silently rewrite stored `already_applied`.** Durable/domain result is always `applied`. Replay is `outcome.replayed` plus telemetry. The compatibility adapter is one-way for leftover ingestion counters. Knowledge already says legacy rows without `result` derive the stored shape and are not backfilled.

## Testing

The **interface** is the test surface: `buildTheCommandApplyOnce` (injected store / clock / txn), `applyThisNamedCommandOnce` (default), `applyThisNamedCommandThenCompleteAfterCommit` (post-commit **seam**).

Today’s `domainCommands.test.ts` and `idempotency.integration.test.ts` already name AC-21 / AC-32. Keep proving the operations, not the helpers:

**Apply once**
- Invalid context fails **before** `connect` / store access.
- First apply persists `{ status: "applied" }` and `replayed: false`.
- Exact origin + key + name + checksum returns the stored refs/warnings, `replayed: true`, and does **not** invoke `operation` a second time.
- Same key with a different checksum or command name → `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`; no second row.
- Thrown `operation` leaves no command row (and on replica: no Decision, no aggregate).
- Transaction-callback retry reuses the same `now` and the same command / Decision ids; the executor does not mint a Decision ID.
- Duplicate-key `11000` after commit race: one winner, the other is exact stored-result replay.

**After-commit complete**
- Finalize runs once after a successful first apply when `pending` is defined.
- Replay does not finalize.
- `pending: undefined` (no-op / empty field diff) does not finalize even on a first apply.
- Rollback / persist failure: finalize never runs; Decision, aggregate, and command row stay invisible.
- Compatibility return is `already_applied` only when `replayed`; stored row stays `applied`.

**Do not add**
- A test per helper (`rememberTheChecksumInLowercase`, `thisWasADuplicateKeyRace`, `rememberTheApply`).
- A test that `recordOperationalEvent` was called with a specific summary string unless a later observability pass owns that contract.
- A helper-unit test that has to change when `loadTheStoredApplyOrRefuseAKeyFight` is inlined.

`buildTheCommandApplyOnce` stays exported because replica proof and AC-21 memory-store tests are a second real **adapter**, not a test leak.

## What I would not do

- A `DomainCommandService` / `IdempotencyService` class with `create` / `update` / `delete` / `execute`.
- Thirty two-line functions that only wrap `withTransaction` or `store.find`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or an `execute.ts` “for cleanliness.”
- Breaking the before-commit / after-commit **seam**. Sheets, queue publish, email, and CRM must not sit inside the Mongo write.
- Treating Form Lead Ingestion, Book The Job, Granot create-if-missing, Owner confirm, or RingCentral adopt as this story. Those are callers.
- Inventing a Decision-ID **seam** that has only one **adapter** (this file must not mint one).
- Silently rewriting stored status to `already_applied`, silently requiring hex `command_id`, or silently moving telemetry inside the transaction.
- Writing a whole-folder recommendation for `domainCommands`.
- Jumping to `durableWork` while this checklist still has unchecked modules.
