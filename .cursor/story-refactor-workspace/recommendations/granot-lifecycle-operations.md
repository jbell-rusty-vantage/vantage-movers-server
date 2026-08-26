# Start The Write-Once Clock, Or Put A Dead Letter Back On The Due List — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 14 of this service — `operations.ts`
- Remaining in this service: `projections.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/operations.ts`
- Knowledge: no dedicated `operations.md`. Requeue is listed as primary code on [`docs/knowledge/granot-lifecycle/drainer.md`](../../../docs/knowledge/granot-lifecycle/drainer.md) — that Service file also lists `drainer.ts`, the queue consumer, and the five-minute cron; they are siblings, not this pass. Activation lives on the owner cheat sheet [`docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md`](../../../docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md) (section “Activation is not an env var”), not in `src/config/domain/granotLifecycle.ts`. Processor orchestration says `claimAndProcessOrPoll` lives in [`drainer.md`](../../../docs/knowledge/granot-lifecycle/drainer.md), not this file. Distinct from receipt insert: [recommendations/granot-lifecycle-capture.md](granot-lifecycle-capture.md). Distinct from queue wake-up: [recommendations/granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md). Distinct from turning a claimed receipt into a Decision: [recommendations/granot-lifecycle-processor.md](granot-lifecycle-processor.md). Distinct from fenced claim / pending clock: next-but-drain `drainer.ts`. Distinct from Admin DTOs: next module `projections.ts`. Distinct from eight effect flags: `src/config/domain/granotLifecycle.ts`. Distinct from Owner Booking / Release commands: `bookingOwnerCommands.ts` / `releaseOwnerCommands.ts`. This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Synchronization Decision / Granot Lifecycle Activation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/granot-lifecycle-admin.routes.ts` (`POST .../activation` → `activateGranotLifecycle`; `POST .../receipts/:id/requeue` → `requeueDeadLetterReceipt`; both after `requireRegistryOwnerActor`). Zod: `validation/v1/granotLifecycle.validation.ts` imports `PROCESSOR_VERSION_PATTERN` only. Replica requeue proof: `drainer.replica.test.ts` (concurrent winner). Tests: `operations.test.ts` (AC-31 write-once / Admin refuse / audit cannot roll back / gated concurrent activate; AC-37 requeue / 409 / 404 / Admin refuse; AC-35 projection omits reason and actor). Not a caller of this story: `operations.replica.test.ts` (it seeds receipts and asserts `projectGranotLifecycleHealth`). Not callers: `processor.ts` (reads the activation row; never writes it), `drainer.ts` (claims / leases; never requeues), `queuePublisher.ts`, `capture.ts`, `extensionApply.ts`, `automationApply.ts`.
- Seams callers need: Owner actor vs Admin 403; write-once clock vs 409 already exists; after-commit best-effort audit that cannot roll back the business write; dead_letter-only transition vs 404 missing / 409 ineligible; injected persist / find / transaction for tests; bounded `processor_version` shared with Zod
- Split later (only if the file outgrows one sitting): keep one file — this ~519-line Owner-control screenplay is one sitting. If it later splits: `startTheWriteOnceGranotLifecycleClock.ts` / `putThisDeadLetterBackOnTheDueList.ts` — never `create.ts` / `update.ts` / `delete.ts`, and never `activate.ts` / `requeue.ts` as a CRUD pair

`activateGranotLifecycle` / `requeueDeadLetterReceipt` are executor mechanics. The owner question is: *The Owner may start the write-once clock that later receipts compare against. A second start is a conflict, never an edit. Rollback never deletes the clock; it only turns flags off. The Owner may put a dead-lettered receipt back on the due list without replacing its evidence, without claiming it, and without running the processor. The five-minute cron will find it. Neither command writes a Lead or Booking. This file does not flip effect flags. This file does not classify historical vs live.*

Claim/drain, Decision orchestration, queue wake-up, Admin health DTOs, and the eight effect flags already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one Owner-control story, not “an operations CRUD service,” and not the drain / the processor / the flag file:

1. **Start the write-once Granot lifecycle clock** — refuse unless the actor is Owner. Trim the reason (10–1000) and the processor version (bounded safe identifier). If a `key: "granot_lifecycle"` row already exists, throw `ALREADY_ACTIVATED` (409) before opening a transaction. Otherwise insert one row in a replica-set transaction; a raced find or duplicate-key 11000 is the same 409. After commit: best-effort Operational Event (`granot_lifecycle.activation.committed`), increment `granot_lifecycle` activations, log a masked id, optional `afterCommit`. Return id / key / `activated_at` / `processor_version` — never `reason`, never `activated_by`. This function does not enable Lead writes, Booking cases, or live mode. Later receipts still need flags + `captured_at >= activated_at`.

2. **Put this dead-lettered receipt back on the due list** — refuse unless Owner. Reject a bad ObjectId and a reason outside 10–500 trimmed characters. In one transaction, `findOneAndUpdate` only when `processing.state === "dead_letter"`: set `pending`, due now, `technical_attempts: 0`, clear lease / last error / completed_at, increment `manual_requeue_count`. Zero match: missing receipt is 404; any other state is 409 `REQUEUE_STATE_CONFLICT`. After commit: best-effort `granot_lifecycle.manual_requeue` event. Return pending state, due-now ISO, preserved `match_attempt` / `payload_sha256` / `channel_operation_id`, and the new count. This function does not publish a queue wake-up. This function does not call `claimAndProcessOrPoll`. This function does not increment `match_attempt` or touch `latest_decision_id`.

There is no third mutate operation. `durableActorFromOwnerActor` is the shared Owner door, not a public story. `projectActivation` is the safe clock card, not a second activate. `PROCESSOR_VERSION_PATTERN` is the identifier rule Zod already imports. `afterCommit` is a test **seam**, unused by the admin route.

## Organization

Keep one file. This is the screenplay for “the Owner starts the write-once clock, or puts a dead letter back on the due list.” Claim/lease, Decision orchestration, queue wake-up, Admin health, and effect flags already live in deeper **modules**. Do not pull those in. Do not invent a `GranotLifecycleOperationsService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — the admin route calls the whole story; after-commit audit is internal and must stay outside the Mongo write. Do not invent a drain **seam** that has only one **adapter** here — requeue writes `pending`; someone else claims.

Do not split this into `activate.ts` / `requeue.ts` so “each route owns a file.” Those are two beats of one Owner-control question. Do not move requeue into `drainer.ts` so “knowledge lists both as primary code.” Do not move activate into `processor.ts` so “the clock lives with classify.” Do not merge `projections.ts` here so “activation and health live together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `activateGranotLifecycle` | `startTheWriteOnceGranotLifecycleClock` | Owner admin POST; write-once 201 / 409 |
| `requeueDeadLetterReceipt` | `putThisDeadLetterBackOnTheDueList` | Owner admin POST; dead_letter → pending |
| `durableActorFromOwnerActor` | `refuseUnlessTheOwnerAsks` | shared Owner door; Admin 403 |
| `projectActivation` | `showTheClockWithoutTheReasonOrThePerson` | activate return + AC-35 PII |
| `PROCESSOR_VERSION_PATTERN` | `theBoundedProcessorVersionTheClockRemembers` | Zod + service re-check |
| `ActivationCommandDeps` | `StartTheClockSeamsForTests` | find / persist / audit / transaction |
| `RequeueCommandDeps` | `PutTheDeadLetterBackSeamsForTests` | transition / find / audit / transaction |

Keep the old names as one-line aliases until the admin router and Zod import migrate. Do not make callers learn `InTransaction` / `afterCommit` / `manual_requeue_count` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the write-once clock the later processor will compare:

```ts
type TheWriteOnceClock = {
  key: "granot_lifecycle"
  activated_at: Date
  processor_version: string
}
```

That is the handoff from “the Owner started the clock” to “a later receipt asks whether it is historical.” Do **not** add `lead_writes_enabled` or `shadow_mode` so “activation turns effects on,” and do **not** add `receipt_id` so “activate also drains.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// operations.ts
// The Owner may start the write-once clock later receipts compare against.
// A second start is a conflict, never an edit.
// Rollback never deletes the clock.
// The Owner may put a dead-lettered receipt back on the due list.
// That does not replace evidence and does not run the processor.
// The cron will find it.
// This file does not claim a receipt.
// This file does not write a Lead or Booking.
// This file does not flip effect flags.

// ── 1. Start the write-once Granot lifecycle clock ────────

export async function startTheWriteOnceGranotLifecycleClock(input, actor, deps?)
export function refuseUnlessTheOwnerAsks(actor)          // Owner door; Admin 403
export function showTheClockWithoutTheReasonOrThePerson(row)

function theReasonAndVersionAreSafeEnoughToStamp(reason, processor_version)
async function refuseIfTheClockAlreadyExists()           // 409 before the write
async function insertTheOnlyClockRow(row, session)       // raced find / 11000 → 409
async function rememberActivationAfterCommitWithoutRollingBack(row)
  // Operational Event + metric + masked log + optional afterCommit

// ── 2. Put this dead-lettered receipt back on the due list ─

export async function putThisDeadLetterBackOnTheDueList(input, actor, deps?)

function theReceiptIdAndReasonAreSafeEnoughToRequeue(id, reason)
async function moveOnlyADeadLetterToPendingDueNow(id, now, session)
  // pending, due now, technical_attempts 0, clear lease/error/completed
  // $inc manual_requeue_count; do not touch match_attempt / latest_decision_id
function sayWhetherTheReceiptIsMissingOrJustIneligible(existing)
  // 404 vs 409 REQUEUE_STATE_CONFLICT
async function rememberRequeueAfterCommitWithoutRollingBack(...)
  // Operational Event only; no queue publish; no claim
```

Read the primary path out loud: *The Owner types a reason and a processor version and starts the clock. If that row already exists, stop — 409 — do not edit it. If two Owners press at once, one winner, one 409. After the row commits, try to write the audit; if the audit dies the clock still stands. Later a receipt asks whether it arrived before that stamp. Separately, the Owner finds a dead-lettered receipt and puts it back on the due list. Only `dead_letter` moves. Evidence, match attempt, and the last Decision stay. The technical budget resets. Lease and last error go away. After commit, try to write the audit; if the audit dies the receipt is still pending. Do not wake the queue. Do not claim. Do not process. The cron will find due work. Someone else classifies historical vs live. Someone else flips flags. Someone else `$set`s a Lead.*

That is the operation. `activateGranotLifecycle` is not. `requeueDeadLetterReceipt` is not a drain story.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge lists this file as drainer primary code.** `drainer.md` names `operations.ts` for requeue beside `drainer.ts`, the consumer, and the cron. Requeue writes `pending` and stops. Do not move this function into `drainer.ts` so the Primary-code line “wins,” and do not call `claimAndProcessOrPoll` from here so “requeue includes drain.”

2. **`operations.replica.test.ts` does not test this file.** It seeds receipts / cases and asserts `projectGranotLifecycleHealth`. Concurrent activation lives gated inside `operations.test.ts`. Concurrent requeue lives in `drainer.replica.test.ts`. Do not move the health proof here so the filename “wins,” and do not move the requeue replica into a new `operations.replica.test.ts` so “each module owns its replica file.”

3. **Audit is after commit on both paths.** `persistAudit` / `persistRequeueAudit` run outside the transaction and swallow throws (AC-31 / AC-37). `persistRequeueAudit` accepts a `session` and is never given one. Do not put the Operational Event inside the business transaction so “one write wins,” and do not fail the command when the audit dies so “observability is authoritative.”

4. **The clock document is insert-only.** Schema uniqueness, model hooks, and this command's existence checks all refuse a second insert. The row already exists and stays. Turning flags off is the rollback. Do not add a delete-activation path, and do not drop the inner find.

5. **Starting the clock does not turn effects on.** Flags stay in `granotLifecycle.ts`. Processor `classifyExecutionMode` still needs `activated_at` plus shadow. A pre-activation receipt stays `historical_shadow` forever. Do not `$set` `GRANOT_LIFECYCLE_SHADOW_MODE` from this file so “activate means live,” and do not refuse activate when shadow is still true so “the clock waits for flags.”

6. **Requeue does not publish and does not process.** `queuePublisher.ts` is webhook-after-commit only. Channel apply claims directly. Cron scans due Mongo. Do not call `publishGranotLifecycleReceiptWakeup` so “the Owner should not wait five minutes,” and do not invoke the processor so “requeue should finish the receipt.”

7. **Requeue preserves evidence.** `$set` / `$unset` / `$inc` never touch `payload`, `payload_sha256`, `match_attempt`, or `latest_decision_id`. AC-37 locks the hash, channel operation id, and attempt. Do not increment `match_attempt` so “it is a new attempt now,” and do not clear `latest_decision_id` so “the next Decision starts clean.”

8. **Missing vs ineligible is two errors.** Transition returns null, then `findReceipt`: no row → 404 `RECEIPT_NOT_FOUND`; any other state → 409 `REQUEUE_STATE_CONFLICT`. Completed, claimed, and pending are all 409. Do not 404 an existing pending receipt so “it is not dead_letter,” and do not 200 a claimed receipt so “the Owner can steal the lease.”

9. **Reason bounds are two different doors.** Activate is 10–1000; requeue is 10–500. Zod already trims; the service trims again. Do not unify the maxima so “Owner reasons match,” and do not delete the service checks so “the route already validated.”

10. **Admin cannot start the clock or requeue.** The route uses `requireRegistryOwnerActor`; this file still runs `durableActorFromOwnerActor`. AC-31 / AC-37 lock Admin 403 here. Do not delete the service check so “the route already gated.”

11. **The safe clock card omits the person.** `projectActivation` drops `reason` and `activated_by` (AC-35). The stored row still has both. Do not return the reason so “the Owner can see why,” and do not delete `activated_by` from the document so “the projection is the schema.”

12. **`afterCommit` is activation-only and unused by the route.** Tests prove the write without it. Do not add a matching requeue hook so “the deps bags match,” and do not move the metric increment into `afterCommit` so “callers must remember.”

13. **Leave sibling modules alone.** Claim/lease stays in `drainer.ts`. Decision orchestration stays in `processor.ts`. Queue wake-up stays in `queuePublisher.ts`. Health / case DTOs stay in `projections.ts`. Effect flags stay in `config/domain/granotLifecycle.ts`. ObjectId construction stays in `utils/objectId.ts`. Masked ids stay in `observability.ts`.

14. **Do not treat drain, Decision, flag flip, or Owner confirm as this story.** Those claim the receipt, write the Decision, change env posture, or write the official Booking. This file only starts the clock or puts a dead letter back.

15. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `startTheWriteOnceGranotLifecycleClock` (today `activateGranotLifecycle`), `putThisDeadLetterBackOnTheDueList` (today `requeueDeadLetterReceipt`), `refuseUnlessTheOwnerAsks`, and `showTheClockWithoutTheReasonOrThePerson`. `TheWriteOnceClock` is not exported; prove it through the projection and the 409.

Today’s `operations.test.ts` already locks write-once 409, Admin 403, audit-cannot-roll-back on both paths, requeue preserves hash / attempt / channel id, completed/claimed/pending 409, missing 404, and projection PII. Gated concurrent activate lives in the same file. Concurrent requeue lives in `drainer.replica.test.ts`. Keep those. Add the gaps that name the operation:

**Start the write-once clock**
- First Owner write returns key / version / `activated_at` and omits reason / actor (already locked).
- Second write is 409 and does not edit the row (already locked).
- Audit throw leaves the stored clock (already locked).
- This function does not change effect flags — do not add a test that it writes `granotLifecycle.ts` env.
- This function does not classify a receipt — do not add a test that it returns `historical_shadow`.

**Put this dead letter back on the due list**
- Dead letter becomes `pending` with the same `match_attempt` and `payload_sha256` (already locked).
- Completed / claimed / pending conflict and write no audit (already locked).
- Missing receipt is 404 (already locked).
- Audit throw leaves the receipt `pending` (already locked).
- This function does not publish a wake-up and does not call `claimAndProcessOrPoll` (add this; today’s tests never assert those siblings stayed quiet).
- This function does not increment `match_attempt` or clear `latest_decision_id` (add the Decision-id half; attempt is already locked).

Do **not** add a test per helper (`theReasonAndVersionAreSafeEnoughToStamp`, `sayWhetherTheReceiptIsMissingOrJustIneligible`, `isDuplicateKeyError`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test drain leases, processor replay, or health counts here. Do not add a test that this file reads `writeGranotSourcePolicyCache`, `$set`s a Lead, or confirms an official Booking. Do not rewrite `operations.replica.test.ts` as if it covered this module.

## What I would not do

- A `GranotLifecycleOperationsService` class with `create` / `update` / `requeue`.
- Thirty two-line functions that only wrap `findOneAndUpdate`.
- Moving this into a CRUD folder, or into `drainer.ts` / `processor.ts` / `projections.ts` “for cleanliness.”
- Splitting `activate.ts` / `requeue.ts` so each admin route owns a file.
- Putting the Operational Event inside the business transaction.
- Calling `publishGranotLifecycleReceiptWakeup` or `claimAndProcessOrPoll` from requeue.
- Adding a deactivate / delete-activation command.
- Flipping `SHADOW_MODE` or any effect flag from this file.
- Incrementing `match_attempt` or clearing `latest_decision_id` on requeue.
- Treating Admin as Owner because the route already gated.
- Writing a whole-folder recommendation for `granotLifecycle`.
