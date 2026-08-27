# Claim This Due Receipt So Only One Worker Runs It — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 17 of this service — `drainer.ts`
- Remaining in this service: `aggregateRevision.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/drainer.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/drainer.md`](../../../docs/knowledge/granot-lifecycle/drainer.md). That Service file also lists `operations.ts` (requeue), `api/queues/granot-lifecycle-consumer.ts`, and `src/routes/granot-lifecycle-cron.routes.ts` as primary code — they are siblings, not this pass. Distinct from receipt insert: [recommendations/granot-lifecycle-capture.md](granot-lifecycle-capture.md). Distinct from queue wake-up: [recommendations/granot-lifecycle-queue-publisher.md](granot-lifecycle-queue-publisher.md). Distinct from Owner extension / HTTP apply (they call this file after capture): [recommendations/granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md), [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from turning a claimed receipt into a Decision: [recommendations/granot-lifecycle-processor.md](granot-lifecycle-processor.md). Distinct from Owner activate / requeue: [recommendations/granot-lifecycle-operations.md](granot-lifecycle-operations.md). Distinct from Admin health gauges: [recommendations/granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`applyDueGauges` only). Distinct from retry / pending-match clocks: `schedules.ts` (already skipped). Distinct from error sanitize: `lastError.ts` (already skipped). Distinct from metrics labels: next-but-later `metrics.ts`. Distinct from Operational Events: next-but-later `observability.ts`. Distinct from revision CAS: next module `aggregateRevision.ts`. Distinct from official Booking / Cancellation Owner commands: `bookingOwnerCommands.ts` / `releaseOwnerCommands.ts`. This checkout’s `CONTEXT.md` does not define Granot Observation Receipt / Synchronization Decision — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `api/queues/granot-lifecycle-consumer.ts` (`parseReceiptWakeup` → `drainRequestedReceipt(..., "queue")` → `emitDrainRunEvent`). `routes/granot-lifecycle-cron.routes.ts` (`drainDueReceipts("cron")` → `emitDrainRunEvent`; injected `drain` in tests). `extensionApply.ts` / `automationApply.ts` (default `claimAndProcessOrPoll(receiptId)` — initiator stays on the receipt). `projections.ts` (`applyDueGauges` after health due-count). Tests: `drainer.test.ts` (Section 26 predicate; AC-30 complete / pending_match / 24h complete / insufficient_creation_data / unknown outcome / dependency retry / attempt-10 dead-letter / one winner / expired recover / processing off / shadow no effects / sync poll / sync processed / wakeup parser). `drainer.replica.test.ts` (AC-30 two claimants; expired recover + stale cannot finalize; attempt-10 dead-letter; queue+cron share fence; AC-37 concurrent requeue lives here but calls `operations.ts`). Consumer: `granot-lifecycle-consumer.test.ts` (wakeup + vercel topic). Cron: `granot-lifecycle-cron.routes.test.ts` (secret / 200 bounded summary). Not callers: `capture.ts`, `queuePublisher.ts`, `operations.ts` (requeue writes `pending` and stops), `processor.ts` (this file calls it), webhook routes.
- Seams callers need: queue one-id drain vs cron due scan vs sync claim-or-poll; processing-off skip vs no claim; Section 26 claim predicate / lease stamp / fence; `{ process }` processor **adapter**; injected `DrainerDeps` for tests; wakeup is exactly `{ receipt_id }` (or Vercel `{ data: { receipt_id } }`)
- Split later (only if the file outgrows one sitting): this ~972-line file is one sitting if you read it as claim → fence → finish. If it later splits: `parseTheQueueWakeup.ts` / `drainThisRequestedReceipt.ts` / `drainTheDueReceipts.ts` / `claimThisReceiptOrWaitForTheWinner.ts` / `finishTheClaimedWorkBehindTheFence.ts` — never `claim.ts` / `process.ts` / `retry.ts` / `create.ts` / `update.ts` / `delete.ts`

`drainRequestedReceipt` / `drainDueReceipts` / `claimAndProcessOrPoll` / `buildClaimFilter` are executor mechanics. The owner question is: *Someone woke us — a queue message, the five-minute cron, or an Owner apply. If processing is off, claim nothing. If this receipt is due and nobody holds a live lease, take it, stamp a five-minute lease, and increment the technical budget. If the previous owner died, recover that claim. Renew the lease, then ask the processor what this Observation means. A known Decision besides pending_match completes the receipt and resets the technical budget. pending_match bumps the match clock from captured_at and comes back later — or completes after 24 hours without inventing unmatched. A throw or unknown outcome schedules a technical retry, and the tenth consecutive failure dead-letters with a safe error. If we lost the lease, stop — do not write a replacement state. An apply that cannot claim waits up to five seconds for the winner’s Decision. This file does not match Leads. This file does not invent pending_match. This file does not put a dead letter back on the due list.*

Receipt insert, queue publish, Decision orchestration, Owner requeue, retry clocks, and health DTOs already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one claim-and-drain story, not “a drainer CRUD service,” and not the processor / the requeue / the wakeup publish:

1. **Parse the queue wakeup** — accept only `{ receipt_id }` as a valid ObjectId string. A Vercel `{ data: { receipt_id } }` wrapper unwraps to the same shape. Extra keys, a missing id, a non-object, or a bad ObjectId throw. This function does not claim. This function does not connect Mongo.

2. **Drain this requested receipt** — the queue-consumer path. If processing is off, return a skipped summary and do not touch the row. Otherwise claim this id when it is due (`pending` / `retry_scheduled` / expired `claimed`). Recover an expired claimed lease and count that recovery. Run the fenced processor. One item becomes a scan/claimed/completed/retried/dead-lettered/recovered/lease-lost summary. This function does not scan other due work.

3. **Drain the due receipts** — the five-minute cron path. Same processing-off skip. Find up to 20 due ids, oldest `next_attempt_at` first, concurrency 4, each through the same requested-id claim. Queue and cron share the fence; Mongo elects the winner. This function does not publish a wakeup.

4. **Claim this receipt, or wait for whoever already has it** — the Owner-apply sync path. Processing off or a bad id is skipped. Try the same claim+fence with trigger `sync`. If this worker completed and a stored Decision exists, return `processed`. If the row is not claimable, the lease was lost, or complete has no Decision yet, poll up to five seconds with exponential backoff. Still no Decision → `accepted_for_processing` with the current state and next due. This function does not start a second processor when it lost. This function does not pass the Owner initiator as `DrainerDeps`.

5. **Finish the claimed work behind the fence** — renew the five-minute lease first (then every two minutes). Ask `processor.process({ receipt_id, initiator })`. A known terminal outcome `$set`s `completed`, stamps `latest_decision_id`, resets `technical_attempts` to 0, and clears lease / last error. `pending_match` increments `match_attempt` once and either schedules the next absolute offset from immutable `captured_at` or completes when the 24-hour window is closed — it does not write `unmatched`. A throw, `ProcessingDisabledError` mid-flight, or an unknown outcome is a technical failure: attempts 1–9 → `retry_scheduled` with exp backoff + jitter; attempt 10 → `dead_letter` with a sanitized `last_error`. Finalize and renew match `{_id, state:claimed, lease_owner}`. Zero match is lease lost: stop, write no final state, launch no replacement processor. This function does not `$set` a Lead. This function does not confirm a Booking.

There is no sixth mutate operation. `emitDrainRunEvent` / `applyDueGauges` are observability **adapters**, not public stories. `buildClaimFilter` / `buildClaimUpdate` / `buildFenceFilter` / `createLeaseOwner` are the Section 26 claim **seam**, not a second drain. `DrainerDeps` is the test **adapter**, not a second persistence. `mapLimit` / `toSnapshot` / `unwrapWakeup` are shared folds.

## Organization

Keep one file as the screenplay for “claim this due receipt so only one worker runs it.” Processor orchestration, Owner requeue, queue publish, retry clocks, credential sanitize, metrics, and health already live in deeper **modules**. Do not pull those in. Do not invent a `GranotLifecycleDrainerService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — the processor’s sibling commands own that **seam**. The drain **seam** is `{ process }` plus the Mongo fence, not a Domain Command. Do not invent a channel **seam** that has only one **adapter** here — webhook, extension, and HTTP automation already collapsed to `receipt_id`.

Do not move `requeueDeadLetterReceipt` here so “knowledge lists both as primary code.” Do not move `processGranotObservation` here so “claim includes Decision.” Do not move `publishGranotLifecycleReceiptWakeup` here so “wakeup lives with the consumer.” Do not merge `schedules.ts` here so “the clocks live with finalize.” Do not merge `operations.ts` here so “requeue and drain are one Owner file.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `parseReceiptWakeup` | `parseTheQueueWakeup` | consumer; only `{ receipt_id }` |
| `drainRequestedReceipt` | `drainThisRequestedReceipt` | queue consumer; one id |
| `drainDueReceipts` | `drainTheDueReceipts` | five-minute cron scan |
| `claimAndProcessOrPoll` | `claimThisReceiptOrWaitForTheWinner` | extension / automation apply |
| `buildClaimFilter` | `theDueReceiptClaimPredicate` | Section 26; due scan + requested id |
| `buildClaimUpdate` | `theClaimLeaseStamp` | claimed + lease + `$inc` attempts |
| `buildFenceFilter` | `theLeaseFence` | renew and every finalize |
| `createLeaseOwner` | `nameThisLeaseOwner` | `glc_${trigger}_${hex}` |
| `emitDrainRunEvent` | `rememberThisDrainRun` | consumer + cron completed / failed |
| `applyDueGauges` | `showHowMuchWorkIsDue` | health; not a drain |
| `DrainerDeps` | `DrainSeamsForTests` | claim / processor / clock / sleep |
| `DrainTrigger` | `HowWeWereWoken` | `queue` \| `cron` \| `sync` |

Keep the old names as one-line aliases until the consumer, cron router, extension apply, and automation apply migrate. Do not make callers learn `ClaimedReceiptSnapshot` / `technical_attempts` / `LEASE_DURATION_MS` as the domain language.

**No class for the workflow.** The `{ process }` object is the processor **adapter**, not a workflow class. The type that *does* earn a name is the claimed bag before the fence runs:

```ts
type ThisReceiptIsOursUntilTheLeaseDies = {
  /* today's ClaimResult + owner + trigger */
}
```

That is the handoff from “we won the claim” to “renew, process, finalize — or stop if the fence misses.” Do **not** add `desired_state` so “the drain already planned the Lead,” and do **not** add `official_booking_details` so “a booked Observation can confirm.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// drainer.ts
// Someone woke us — a queue message, the five-minute cron, or an Owner apply.
// If processing is off, claim nothing.
// If this receipt is due and nobody holds a live lease, take it.
// Hold a five-minute lease. Keep renewing it.
// Ask the processor what this Observation means.
// A known Decision besides pending_match completes the receipt.
// pending_match comes back later, or stops after 24 hours.
// A throw retries. The tenth failure dead-letters.
// If we lost the lease, stop.
// This file does not match Leads.
// This file does not invent pending_match.
// This file does not put a dead letter back on the due list.

// ── 1. Parse the queue wakeup ─────────────────────────────

export async function parseTheQueueWakeup(payload)
  // { receipt_id } or { data: { receipt_id } }
  // extra keys / bad id throw

// ── 2. Drain this requested receipt ───────────────────────

export async function drainThisRequestedReceipt(receiptId, trigger = "queue", deps?)
  // processing off → skipped summary
  // else claim this id and finish behind the fence

// ── 3. Drain the due receipts ─────────────────────────────

export async function drainTheDueReceipts(trigger = "cron", deps?)
  // up to 20 due ids, concurrency 4
  // same claim as requested-id

function theDueReceiptClaimPredicate(now, receiptId?)   // Section 26
function theClaimLeaseStamp(now, owner)
function theLeaseFence(id, owner)

async function claimThisDueReceiptForOneOwner(receiptId, trigger, deps)
  // recovered: previous.state === "claimed"

// ── 4. Claim this receipt, or wait for the winner ─────────

export async function claimThisReceiptOrWaitForTheWinner(receiptId, deps?)
  // trigger "sync"
  // completed + stored Decision → processed
  // not claimable / lease lost → poll ≤ 5s
  // else accepted_for_processing

async function waitUpToFiveSecondsForTheStoredDecision(receiptId, deps)

// ── 5. Finish the claimed work behind the fence ───────────

async function finishTheClaimedWorkBehindTheFence(claimed, owner, trigger, deps)
  // renew first; interval every 2 minutes
  // processor.process({ receipt_id, initiator })
  // terminal → completed + reset technical budget
  // pending_match → match clock or complete at 24h
  // throw / unknown → technical retry or dead letter
  // fence miss → lease_lost

async function comeBackLaterOrStopThePendingMatch(claimed, result)
async function retryOrDeadLetterTheTechnicalFailure(claimed, error)
```

Read the primary path out loud: *A webhook already saved the receipt and maybe published `{ receipt_id }`. The consumer parses that wakeup and asks to drain this one id. If processing is on and the row is due, this worker takes the claim, stamps `glc_queue_…`, and increments the technical budget. It renews the five-minute lease, then hands `{ receipt_id, initiator }` to the processor. When the processor returns `policy_blocked` — or any other known Decision except `pending_match` — the receipt becomes `completed`, the technical budget resets, and the lease clears. When the processor says `pending_match`, bump `match_attempt` and schedule the next offset from `captured_at` (1m, 5m, 15m, 1h, 2h, 6h, 12h, 24h). After 24 hours, complete that receipt; do not write `unmatched` here. If Mongo is down, schedule a technical retry. The tenth consecutive technical failure dead-letters with the password stripped from the message. If another worker already holds a live lease, this worker does not steal it. An Owner apply that lost the claim waits five seconds for the winner’s stored Decision, then returns `accepted_for_processing` rather than starting a second processor. The cron does the same work for the next twenty due rows. Owner requeue is a different file: it only writes `pending`. Capture never claims.*

That is the operation. `buildClaimFilter` is not. `claimAndProcessOrPoll` is not a process story.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge lists `operations.ts` as this Service’s primary code.** Requeue writes `pending` and stops. Do not move `requeueDeadLetterReceipt` into this file so the Primary-code line “wins,” and do not call `claimAndProcessOrPoll` from requeue so “requeue includes drain.” See [recommendations/granot-lifecycle-operations.md](granot-lifecycle-operations.md).

2. **`claimAndProcessOrPoll` reprints the completed-Decision load twice.** After `processRequestedReceipt`, two adjacent `if (item.status === "completed")` blocks both load the receipt and the stored Decision. The first also requires `item.outcome`. Collapse to one read. Do not add a third copy for `dead_letter`.

3. **`parseReceiptWakeup` is `async` and never awaits.** The consumer `await`s it. Keep the export; drop the fake Promise unless a later unwrap needs IO. Do not make the consumer parse JSON so “the queue owns the shape.”

4. **The Vercel `{ data: { receipt_id } }` unwrap is untested.** Knowledge and `unwrapWakeup` accept it. Unit tests only lock the bare object and reject extras / non-objects. Add the wrapper case. Do not accept `{ payload: { receipt_id } }` so “every envelope unwraps.”

5. **Recovery is counted at claim, not after a successful finalize.** The test title says “increments the recovery counter only after success.” The increment and `granot_lifecycle.claim.recovered` fire as soon as `previous.state === "claimed"`, before renew. A later `lease_lost` on renew still counted a recovery. Do not move the increment after `completed` so the title “wins,” and do not delete the event so “metrics stay cheap.”

6. **Knowledge says the processor emits `unmatched` / `match_window_expired` at 24 hours; the drain must not fabricate that Decision.** `leadDesiredState.ts` already does that. This file still completes a *still-`pending_match`* result when `shouldCompletePendingMatch` is true, stamping that Decision id. The AC-30 drain unit feeds `pending_match` at 24h and asserts `completed`. Do not have this file write `unmatched` so the knowledge sentence “wins,” and do not delete the 24h complete so “only the processor may finish.”

7. **`ProcessingDisabledError` mid-flight is a technical `dependency_failure`.** The public entries already skip when the flag is off. If the flag flips after claim, this path schedules a retry (or dead-letters at 10) instead of returning the skipped summary. Do not claim when processing is off so “the processor can throw,” and do not treat the mid-flight throw as `completed`.

8. **Technical budget increments on every claim, including a later successful Decision.** `$inc technical_attempts` is on the claim stamp. Complete and `pending_match` then `$set` it back to 0. Dead-letter compares the post-claim value. Do not `$inc` only on throw so “success never touches the budget,” and do not reset on `dead_letter`.

9. **`insufficient_creation_data` is terminal here; `pending_match` is the only non-terminal known outcome.** The unit locks that the drain does not convert insufficient creation into a match clock. Do not route that outcome through `finalizePendingMatch` so “no Lead means wait.”

10. **Unknown outcomes fail closed and write no Decision.** The processor result is rejected before finalize-complete. `deps.decisions` stays empty in the unit because this file does not persist Decisions. Do not persist a synthetic `unknown_outcome` Decision so “every finish has an id.”

11. **The sync loser must not start a second processor.** An unexpired foreign lease is `not_claimable` → poll → `accepted_for_processing` with zero `processor.process` calls. Do not steal the lease so “apply should be synchronous,” and do not pass the Owner initiator as the second argument so the extension deps type “wins.” See CONTRADICTIONS on `ExtensionApplyDeps.claimAndProcess`.

12. **Queue and cron share the fence; they are not two work sources.** The replica proof runs `drainRequestedReceipt` and `drainDueReceipts` together and expects one `claimed === 1`. Do not add a second due collection so “cron can be cheaper,” and do not import `publishGranotLifecycleReceiptWakeup` from the cron so “every drain publishes.”

13. **`applyDueGauges` is not a drain.** Health calls it after counting due work with the same Section 26 meaning. Do not call `drainDueReceipts` from health so “gauges should be live,” and do not copy a second due filter here.

14. **Leave sibling modules alone.** Decision orchestration stays in `processor.ts`. Requeue stays in `operations.ts`. Wakeup publish stays in `queuePublisher.ts`. Clock math stays in `schedules.ts`. Error sanitize stays in `lastError.ts`. Counters stay in `metrics.ts`. Events stay in `observability.ts`. This file orchestrates claim → fence → finish.

15. **Do not treat match, create-Lead, confirm, cancel, or requeue as this story.** Those write official facts or put a dead letter back on the list. This file only claims the receipt and finishes its work state.

16. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `drainThisRequestedReceipt` (today `drainRequestedReceipt`), `drainTheDueReceipts` (today `drainDueReceipts`), `claimThisReceiptOrWaitForTheWinner` (today `claimAndProcessOrPoll`), `parseTheQueueWakeup` (today `parseReceiptWakeup`), and the Section 26 claim **seam** (`buildClaimFilter` / `buildClaimUpdate` / `buildFenceFilter`).

Today’s `drainer.test.ts` already locks the Section 26 predicate, terminal complete + reset budget, `pending_match` match clock, 24h `pending_match` complete, `insufficient_creation_data` not converted, unknown outcome technical retry, dependency retry + event, attempt-10 dead-letter without Mongo URLs, one winner / unexpired lease, expired recover, processing-off skip, shadow no extra effects, sync poll ≤ 5s with zero processor, sync `processed` from a stored Decision, and bare `{ receipt_id }` wakeup. Replica already locks two claimants, stale cannot finalize, attempt-10 dead-letter, and queue+cron one winner. Keep those. Add the gaps that name the operation:

**Parse the wakeup**
- Bare `{ receipt_id }` (already locked).
- Extra keys reject (already locked).
- `{ data: { receipt_id } }` unwraps (add this).
- `{ data: { receipt_id, extra } }` still rejects (add this).

**Drain this requested receipt**
- Terminal Decision completes and resets `technical_attempts` (already locked).
- `pending_match` increments `match_attempt` once and does not consume the technical budget (already locked).
- 24h `pending_match` completes without writing `unmatched` (already locked — keep the outcome `pending_match`).
- Unknown outcome / throw → retry, no Decision (already locked).
- Attempt 10 → `dead_letter`, sanitized message (already locked).
- Processing off does not claim (already locked on the cron entry).
- This function does not `$set` a Lead — do not add a test that it writes `FormLead`.

**Drain the due receipts**
- Processing off skipped summary (already locked).
- Replica: queue + cron share the fence (already locked).
- Batch stays 20 / concurrency 4 — do not add a unit that drains 21 so “cron is thorough.”

**Claim or wait**
- Completed row returns stored Decision without calling process (already locked).
- Unexpired foreign lease polls ≤ 5s and does not process (already locked).
- Processing disabled → `skipped` / `processing_disabled` (add this; today’s skip test uses `drainDueReceipts`).
- Invalid id → `skipped` / `invalid_id` (add this).
- `retry_scheduled` / `dead_letter` after this worker finishes → `accepted_for_processing`, not a second process (add this).

**The fence**
- Stale owner cannot renew or finalize (already locked on the memory store; replica locks stale finalize).
- Recovery increments when an expired `claimed` is taken (already locked). Do not add a helper-unit for `applyClaimToSnapshot`.

Do **not** add a test per helper (`mapLimit`, `toSnapshot`, `unwrapWakeup`, `summarize`, `skippedSummary`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test Owner requeue, activation, Observation normalize, desired-state `unmatched`, or `processGranotObservation` here. Do not rewrite `drainer.replica.test.ts` AC-37 as if it covered this file — that proof calls `requeueDeadLetterReceipt`. Do not add a test that this file publishes a wakeup, `$set`s a Lead, or confirms an official Booking.

## What I would not do

- A `GranotLifecycleDrainerService` class with `claim` / `process` / `retry`.
- Thirty two-line functions that only wrap `findOneAndUpdate`.
- Moving this into a CRUD folder, or into `processor.ts` / `operations.ts` / `queuePublisher.ts` / `schedules.ts` “for cleanliness.”
- Splitting `claim.ts` / `retry.ts` / `complete.ts` so each work state owns a file.
- Moving `requeueDeadLetterReceipt` here so the `drainer.md` Primary-code line “wins.”
- Writing `unmatched` from this file so the 24-hour knowledge sentence “wins.”
- Stealing an unexpired lease so Owner apply “feels synchronous.”
- Passing the Owner initiator into `claimAndProcessOrPoll` as if it were `DrainerDeps`.
- Calling `publishGranotLifecycleReceiptWakeup` from cron or requeue.
- Calling `confirmBooking` or `createLeadFromGranot` from this file.
- Writing a whole-folder recommendation for `granotLifecycle`.
