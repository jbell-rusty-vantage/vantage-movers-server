# Count Only What This Process Already Saw — Using Names We Already Agreed On — Then Remember How Late The Queue Is — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 33 of this service — `metrics.ts`
- Remaining in this service: `alerts.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/metrics.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/observability.md`](../../../docs/knowledge/granot-lifecycle/observability.md) — Section 33 catalog, closed labels, rollout alerts, Owner/Admin health. Primary code also lists `observability.ts`, `alerts.ts`, and `projections.ts` (`projectGranotLifecycleHealth`). This file is the process-local Section 33 memory + closed-label gate. Distinct from named-transition emit + Owner-command watch: [recommendations/granot-lifecycle-observability.md](granot-lifecycle-observability.md). Distinct from the seven rollout alerts: `alerts.ts`. Distinct from Mongo-backed health: [recommendations/granot-lifecycle-projections.md](granot-lifecycle-projections.md). Distinct from due-gauge write wrapper living on the drain sibling: [recommendations/granot-lifecycle-drainer.md](granot-lifecycle-drainer.md) (`applyDueGauges`). Distinct from RingCentral’s three named counters: `src/services/ringcentral/ringcentral-metrics.ts`. Distinct from company-wide Operational Event write: `src/services/observability/recordOperationalEvent.ts`. Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`observability.ts` / `metrics.ts` / `alerts.ts` — best-effort; not business authority). This checkout’s `CONTEXT.md` does not define Operational Event / Section 33 metric — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **nine write sites + test readers.** After-commit count: `capture.ts` (webhook `granot_webhook` + route class; extension/automation `event_class: "none"`), `routes/granot-webhook.routes.ts` (capture 503), `queuePublisher.ts` (publish failed), `processor.ts` (`toProcessorResult`: Decision labels + capture-to-decision + decision-to-effect when effects exist), `operations.ts` (activation committed), `drainer.ts` (claim recovered, technical retry, dead letter), `observability.ts` (Owner-command fight). Replace-the-pile: `bookingReconciliation.ts` (`recomputeOpenCaseGauge` after case persist), `projections.ts` health (open cases + open discrepancies from Mongo; due/oldest via sibling `applyDueGauges`). Tests read: `metrics.test.ts` (Section 33 names, closed receipt labels, bounded error codes, gauge overwrite), plus capture / queue / processor / operations / drainer / observability / webhook-route tests via `reset` + one getter. Not callers: `alerts.ts` (no import), health DTO getters (health reads Mongo, then *writes* these maps), `releaseReconciliation.ts` / `discrepancies.ts` (no gauge refresh on persist), `ringcentral-metrics.ts` (owns the three RC names on this catalog).
- Seams callers need: frozen Section 33 names vs extra unlabeled totals this file also keeps; closed receipt/Decision/case/discrepancy/error-code labels vs silent drop; increment-after-commit vs replace-the-pile gauges; process-local memory vs Mongo health; this file’s catalog listing RingCentral names vs `ringcentral-metrics.ts` actually counting them; `setOpenBookingCases` wrapper vs health’s `setOpenCases`; sibling `applyDueGauges` as the only health-path due-gauge writer
- Split later (only if the file outgrows one sitting): keep one file — this ~339-line module is one screenplay for “count only what this process already saw, using names we already agreed on; then remember how late the queue is and how many open fights sit right now.” If it later splits: `countWhatThisProcessJustFinished.ts` / `replaceTheCurrentPile.ts` / `showOrForgetThisProcessMemory.ts` — story files, never `increment.ts` / `get.ts` / `set.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge emit, alerts, health, or RingCentral ingest into this file

`incrementGranotLifecycleReceiptsTotal` / `setGranotLifecycleOpenCases` / `getGranotLifecycleQueueDue` are executor mechanics. The owner question is: *Something already happened in this process — a receipt committed, a Decision landed, a claim was recovered, a case pile changed. Add one, or replace the current pile, using only the names and labels we already agreed on. If the channel, event class, outcome, reason, kind, mode, or error code is not on the closed list, add nothing. A pile is the number sitting now: writing 1 twice leaves 1. Negative time and junk counts disappear. This memory is not health. The Owner’s health page counts Mongo and then copies the piles here. If this process restarts, these maps are empty. RingCentral’s three names live on the frozen list so Unit 30 can lock them; their memory lives next door. This file does not emit. This file does not fire an alert. This file does not write a Lead, Booking, case, or discrepancy.*

Named-transition emit, rollout alerts, health projection, and RingCentral counters already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “this process’s memory” story, not “a metrics CRUD service,” and not the emit / alerts / health DTO:

1. **Count what this process just finished, using only closed labels** — after a sibling already committed or already failed. A receipt: `channel` must be an Observation channel and `event_class` a route class or `"none"`. A Decision: `outcome` + `reason_code` + `channel` must all be on the Synchronization lists. A technical retry, dead letter, or Owner-command fight: the code must match `^[a-zA-Z][a-z0-9_]{0,63}$` (letters, digits, underscore; first character a letter). Capture-store failure, wake-up publish failure, activation, and claim recovery have no labels — they add one to a single total. Capture-to-decision and decision-to-effect keep a finite non-negative millisecond. Unknown labels return without incrementing and without throwing. This function does not persist Mongo. This function does not emit an Operational Event.

2. **Replace the current pile** — queue due count, oldest-due seconds, open cases by `kind|mode`, open discrepancies by `kind|reason_code`. Last write wins. A non-finite or non-positive number becomes 0. Unknown kind / mode / reason is ignored. Booking persist refreshes the three Booking modes through `setGranotLifecycleOpenBookingCases`. Health later recounts every open case and discrepancy from Mongo and overwrites these maps. Due/oldest are written from health through sibling `applyDueGauges`, not from the drain pass itself. Setting `create_missing_booking` to 1 twice leaves 1.

3. **Show this process’s memory, or forget it** — every increment and every pile has a getter for tests. Unknown keys read as 0. `resetGranotLifecycleMetrics` clears every map, total, and sample array. The health projection does not read these getters. The alert module does not import this file.

There is no fourth mutate operation. `boundedErrorCode` / `isBoundedReceiptLabel` / `isBoundedDecisionLabel` / `receiptKey` / `decisionKey` / `caseKey` / `discrepancyKey` / `recordFiniteDuration` are folds, not public stories. `GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES` is the dictionary Unit 30 freezes — including three RingCentral names this file never increments. `GRANOT_LIFECYCLE_RECEIPT_EVENT_CLASSES` / `GRANOT_LIFECYCLE_CASE_KINDS` / `GRANOT_LIFECYCLE_CASE_MODES` / `GRANOT_LIFECYCLE_DISCREPANCY_REASON_CODES` are the closed label lists the first two operations read. Capture-failure / queue-publish-failure / activation totals are extra process-local memory; they are **not** on the Section 33 name list.

## Organization

Keep one file as the screenplay for “count only what this process already saw, using names we already agreed on; then remember how late the queue is.” Emit, alerts, health, and RingCentral counters already live in deeper **modules**. Do not pull those in. Do not invent a `GranotLifecycleMetricsService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — every write is after-commit (or the failure itself). Do not invent a scrape **seam** that has only one **adapter** here — there is no Prometheus export; tests read getters.

Do not move this into `src/services/observability/` so “every counter lives with Operational Events.” Do not move this into `observability.ts` so “Section 33 is one sitting.” Do not move this into `alerts.ts` so “firing can own the gauges.” Do not move the three RingCentral names’ implementations here so “the catalog file owns the counts.” Do not split `increment.ts` / `get.ts` / `set.ts` / `create.ts` / `update.ts`.

**External interface** stays small (this is the test surface). Increment and get are one story’s write and read, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `incrementGranotLifecycleReceiptsTotal` | `countAReceiptThatJustCommitted` | capture after persist; closed `{channel,event_class}` |
| `incrementGranotLifecycleCaptureFailures` | `countACaptureThatFailedToStore` | webhook 503; unlabeled |
| `incrementGranotLifecycleQueuePublishFailures` | `countAWakeUpThatFailedToPublish` | queue publisher catch |
| `incrementGranotLifecycleDecisionsTotal` | `countADecisionThatJustLanded` | processor after Decision; closed `{outcome,reason_code,channel}` |
| `recordGranotLifecycleCaptureToDecisionMs` | `rememberHowLongCaptureTookToDecide` | processor; finite ≥ 0 |
| `recordGranotLifecycleDecisionToEffectMs` | `rememberHowLongTheDecisionTookToTakeEffect` | processor only when effects exist |
| `incrementGranotLifecycleActivationsTotal` | `countAnActivationThatJustCommitted` | operations after-commit |
| `incrementGranotLifecycleClaimRecoveries` | `countARecoveredClaim` | drainer expired lease |
| `incrementGranotLifecycleTechnicalRetries` | `countATechnicalRetry` | drainer; bounded error code |
| `incrementGranotLifecycleDeadLetters` | `countADeadLetter` | drainer attempt 10; bounded error code |
| `incrementGranotLifecycleCommandConflicts` | `countAnOwnerCommandFight` | observability fight watch; bounded code |
| `setGranotLifecycleQueueDue` | `rememberHowManyReceiptsAreDue` | health via `applyDueGauges` |
| `setGranotLifecycleOldestDueSeconds` | `rememberHowOldTheOldestDueReceiptIs` | health via `applyDueGauges` |
| `setGranotLifecycleOpenCases` | `rememberHowManyOpenCasesSitRightNow` | health recount; `kind\|mode` |
| `setGranotLifecycleOpenBookingCases` | `rememberHowManyOpenBookingCasesSitRightNow` | Booking persist refresh |
| `setGranotLifecycleOpenDiscrepancies` | `rememberHowManyOpenFightsSitRightNow` | health recount; `kind\|reason_code` |
| `getGranotLifecycle*` / sample getters | `howManyThisProcessRemembered` | test read; the health projection does not |
| `resetGranotLifecycleMetrics` | `forgetThisProcessMemory` | test isolation |
| `GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES` | `TheSection33NamesWeAreAllowedToCount` | Unit 30 freeze; includes RC names this file does not count |

Keep the old names as one-line aliases until capture, the webhook route, queue publisher, processor, operations, drainer, observability, booking reconciliation, and health migrate. Do not make callers learn `receiptKey` / `boundedErrorCode` / `isBoundedReceiptLabel` as the domain language.

**Principle: old exports stay as aliases.** `incrementGranotLifecycleReceiptsTotal` and `setGranotLifecycleOpenCases` remain the imported names until those callers point at the story names.

**No class for the workflow.** The type that *does* earn a name is a closed receipt label pair:

```ts
type AClosedReceiptCount = {
  channel: ObservationChannel
  event_class: (typeof GRANOT_LIFECYCLE_RECEIPT_EVENT_CLASSES)[number]
}
```

That is the handoff from “capture just persisted” to “this process may add one.” Do **not** add `job_no` / `email` / `error.message` so “ops can find the row,” and do **not** add a Prometheus registry so “scrapers can see Granot.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// metrics.ts
// Something already happened in this process.
// Count it only if the name and labels are on the closed list.
// A pile is the number sitting now — writing 1 twice leaves 1.
// This memory is not health. Health counts Mongo, then copies the piles here.
// RingCentral’s three names live on the frozen list; their memory lives next door.
// This file does not emit. This file does not write a Lead, Booking, case, or discrepancy.

export const TheSection33NamesWeAreAllowedToCount = [
  "granot_lifecycle_receipts_total",
  // … queue due, oldest due, recoveries, retries, dead letters,
  // decisions, two durations, open cases, open discrepancies, command conflicts …
  "ringcentral_call_log_runtime_ms",
  "ringcentral_adoptions_total",
  "ringcentral_call_log_lease_contention_total",
] as const

// ── 1. Count what this process just finished ─────────────

export function countAReceiptThatJustCommitted(labels)
  ifTheChannelOrEventClassIsNotOnTheList, staySilent()

export function countACaptureThatFailedToStore()
export function countAWakeUpThatFailedToPublish()

export function countADecisionThatJustLanded(labels)
  ifTheOutcomeReasonOrChannelIsNotOnTheList, staySilent()

export function rememberHowLongCaptureTookToDecide(ms)
export function rememberHowLongTheDecisionTookToTakeEffect(ms)
  keepOnlyFiniteNonNegativeMilliseconds()

export function countAnActivationThatJustCommitted()
export function countARecoveredClaim()

export function countATechnicalRetry(code)
export function countADeadLetter(code)
export function countAnOwnerCommandFight(code)
  ifTheCodeIsNotABoundedErrorLabel, staySilent()

function ifTheCodeIsNotABoundedErrorLabel(code)
  // ^[a-zA-Z][a-zA-Z0-9_]{0,63}$
  // "dependency_failure" counts; "Job Number 100" and an email do not

// ── 2. Replace the current pile ──────────────────────────

export function rememberHowManyReceiptsAreDue(count)
export function rememberHowOldTheOldestDueReceiptIs(seconds)
  aNonPositiveNumberBecomesZero()

export function rememberHowManyOpenCasesSitRightNow(kind, mode, count)
export function rememberHowManyOpenBookingCasesSitRightNow(mode, count)
  rememberHowManyOpenCasesSitRightNow("booking", mode, count)

export function rememberHowManyOpenFightsSitRightNow(kind, reason, count)
  lastWriteWins()                                 // 1 then 1 is still 1

// ── 3. Show this process’s memory, or forget it ──────────

export function howManyReceiptsThisProcessRemembered(labels)
export function howManyDecisionsThisProcessRemembered(labels)
export function howManyOpenCasesThisProcessRemembered(kind, mode)
export function howLateTheQueueIsInThisProcess()
export function forgetThisProcessMemory()
```

Read the primary path out loud: *A webhook receipt just committed. We add one to `granot_webhook` + `lead_created`. If someone hands us `create_form_lead` or an email as the event class, we add nothing. Processing later lands a Decision; we add one to that outcome / reason / channel and remember how many milliseconds since this process started the claim. If the Decision carried effects, we also remember how long after `decided_at`. The drain recovered an expired lease; we add one recovery. A `dependency_failure` retried; we add one under that code. An email as the error code is ignored. Health later counts open cases from Mongo and replaces this process’s pile — setting `create_missing_booking` to 1 twice still leaves 1. The Owner’s health page does not read these maps. RingCentral’s three names sit on the frozen list so Unit 30 can lock them; their memory lives in `ringcentral-metrics.ts`.*

That is the operation. `incrementGranotLifecycleReceiptsTotal` is not a logger wrapper. `setGranotLifecycleOpenCases` is not an increment.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The Section 33 catalog lists three RingCentral names this file never counts.** `ringcentral_call_log_runtime_ms`, `ringcentral_adoptions_total`, and `ringcentral_call_log_lease_contention_total` are implemented in `ringcentral-metrics.ts`. Tests freeze the list here. Do not move those counters into this file so “the catalog owns the memory,” and do not drop the three names so “this file only exports what it increments.” Adoption is a later `ringcentral` pass.

2. **Capture-store failure, wake-up publish failure, and activation are process-local totals that are not on the Section 33 name list.** Knowledge says exact Section 33 names live in `GRANOT_LIFECYCLE_SECTION_33_METRIC_NAMES`. These three extras still have increment/get pairs. Do not add them to the frozen list in this rename so “the file is honest,” and do not delete the counters so “only Section 33 remains” — webhook 503 and publish-failed tests already lock them. Leave the extras as unlabeled supporting memory.

3. **Health never reads these getters.** `projectGranotLifecycleHealth` counts due work, open cases, open discrepancies, and 24-hour command conflicts from Mongo, then *writes* the piles here (`applyDueGauges`, `setGranotLifecycleOpenCases`, `setGranotLifecycleOpenDiscrepancies`). Knowledge: “Health never depends solely on process-local counters.” Do not make health return `getGranotLifecycleQueueDue()` so “one number,” and do not delete the maps so “health is enough.” Alerts evaluate Mongo / last-run, not this file.

4. **Due gauges are written from health, through a wrapper that lives on the drain sibling.** `applyDueGauges` is exported from `drainer.ts` and called only from `projections.ts`. The drain pass itself does not refresh `queue_due` / `oldest_due_seconds`. Do not move `applyDueGauges` into this file so “gauges live with set,” and do not call `setGranotLifecycleQueueDue` from `drainDueReceipts` in this rename so “drain owns due” — that is a sibling edit.

5. **Booking persist refreshes Booking-case piles; Release persist and discrepancy persist do not.** `bookingReconciliation.recomputeOpenCaseGauge` recounts the three Booking modes after commit (swallows throw). `releaseReconciliation.ts` and `discrepancies.ts` have no gauge call. Health later overwrites every kind. Do not add Release/discrepancy refresh here so “every persist matches Booking,” and do not delete the Booking refresh so “only health writes piles.”

6. **`setGranotLifecycleOpenBookingCases` is a typed wrapper, not a second memory.** It calls `setGranotLifecycleOpenCases("booking", mode, count)` and excludes `"release"`. Keep it as the Booking **seam**. Do not inline it at the Booking sibling so “one set function,” and do not add `setGranotLifecycleOpenReleaseCases` in this rename so “symmetry.”

7. **Error-code labels allow uppercase; an older Unit 08 note said lowercase-only.** Runtime is `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`. Tests lock `DOMAIN_REVISION_CONFLICT` and `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`. Do not tighten to `^[a-z]` so “the completion report wins,” and do not accept `"Job Number 100"` so “spaces are folded.”

8. **Unknown labels and unknown getter keys both look like zero.** A dropped increment and a never-seen key both read 0. Do not return `null` so “drop is visible,” and do not throw so “typos fail closed” — instrumentation must not fail capture or drain.

9. **Duration sample arrays grow for the life of the process.** There is no cap and no percentile helper here. Health / alerts compute p95 from Mongo Decisions, not from `captureToDecisionMs`. Do not add p95 in this file so “the name is `capture_to_decision_ms`,” and do not cap at 100 so “memory stays small” without a test that names a dropped sample.

10. **Replay must not increment an applied effect twice.** That rule lives in the processor / Owner-command watch. This file counts whatever a sibling asks. Do not inspect `outcome === replayed` here so “metrics know replay,” and do not skip `countADecisionThatJustLanded` on replay from this rename.

11. **`toProcessorResult` records decision-to-effect only when `effects.length > 0`.** Shadow / no-effect Decisions still count the Decision and capture-to-decision. Do not record 0 ms so “every Decision has a pair,” and do not skip the Decision count when effects are empty.

12. **Module-level Maps are the product, not a missing adapter.** One Node process, one memory. Serverless instances do not share it. Do not add Redis so “gauges survive,” and do not write these totals into Mongo so “health can read them.”

13. **Knowledge covers three files plus health.** `observability.md` Primary code includes `observability.ts`, `alerts.ts`, and `projectGranotLifecycleHealth`. That is not permission to write a whole-folder recommendation. This pass is process-local memory only.

14. **Leave sibling modules alone.** Emit stays in `observability.ts`. Alert evaluate/persist stays in `alerts.ts`. Health stays in `projections.ts`. `applyDueGauges` stays on `drainer.ts`. RingCentral counters stay in `ringcentral-metrics.ts`.

15. **Do not treat capture, drain, Owner Book / Cancel, or RingCentral ingest as this story.** Those write receipts, cases, `BookedLead`, or Call Leads. This file only counts what already happened.

16. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `countAReceiptThatJustCommitted` (today `incrementGranotLifecycleReceiptsTotal`), `countADecisionThatJustLanded`, `countATechnicalRetry` / `countADeadLetter` / `countAnOwnerCommandFight`, the replace-the-pile setters, and `TheSection33NamesWeAreAllowedToCount`. Getters exist so those writes can be proved. `forgetThisProcessMemory` is the test isolation **seam**.

Today’s `metrics.test.ts` already names the Section 33 freeze (including the three RingCentral names), closed receipt labels, bounded error-code drop, decision-to-effect negative drop, command-conflict drop, and gauge overwrite (Booking 1 then 1 stays 1; Release 4 then 3 is 3; bad discrepancy reason stays 0). Keep those. Add the gaps:

**Count what this process just finished**
- `granot_webhook` + `lead_created` and `browser_extension` + `none` each add one; `create_form_lead` and an email event class add nothing (already locked).
- `dependency_failure` / `transaction_failure` count; `Job Number 100` and an email do not (already locked).
- `DOMAIN_REVISION_CONFLICT` counts; `Job Number 100` does not (already locked).
- A Decision with a closed `{outcome,reason_code,channel}` adds one (add this; processor tests cover the sibling, not this **interface**).
- An unknown Decision `reason_code` adds nothing (add this).
- Capture-store failure and wake-up publish failure each add one unlabeled total (add this; route/publisher tests exist, lock it here too).
- Activation adds one (add this; operations test exists).
- Capture-to-decision keeps 12 and drops `-1` (add this; decision-to-effect already locked).
- Do not add a test that this path writes a receipt, case, Lead, or Booking.

**Replace the current pile**
- Booking `create_missing_booking` set to 1 twice stays 1 (already locked).
- Release `release` set to 4 then 3 is 3 (already locked).
- A discrepancy reason not on the closed list stays 0 (already locked).
- Queue due `3` and oldest-due `12` stick; a negative due becomes 0 (add the negative case).
- `rememberHowManyOpenBookingCasesSitRightNow("create_missing_booking", 2)` is readable via the Booking getter **and** via `howManyOpenCasesThisProcessRemembered("booking", "create_missing_booking")` (add this).
- Do not add a test that this path opens a Booking case.

**Show this process’s memory, or forget it**
- `forgetThisProcessMemory` after a receipt increment + a due-gauge write leaves both at 0 (add this).
- A getter for a never-seen Decision label returns 0 (add this).
- Do not add a test that health or alerts read these getters.

Do **not** add a test per helper (`ifTheCodeIsNotABoundedErrorLabel`, `receiptKey`, `isBoundedReceiptLabel`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test emit sanitizer, alert evaluate, health Mongo counts, drain claim, or RingCentral ingest here. Do not add a test that this file CRM-posts, `$set`s a Lead, or writes `BookedLead`.

## What I would not do

- A `GranotLifecycleMetricsService` class with `increment` / `get` / `set`.
- Thirty two-line functions that only wrap `Map.set`.
- Moving this into a CRUD folder (`increment.ts` / `get.ts` / `set.ts`), or into `observability.ts` / `alerts.ts` / `src/services/observability/` “for cleanliness.”
- Moving RingCentral’s three counters here so “the catalog file owns the counts.”
- Adding capture-failure / activation totals onto the frozen Section 33 list, or deleting those extras, in this rename.
- Making health return these getters so “one number.”
- Calling `setGranotLifecycleQueueDue` from the drain pass in this rename so “drain owns due.”
- Adding Release/discrepancy gauge refresh so “every persist matches Booking.”
- Tightening error-code labels to lowercase-only so “Unit 08 wins.”
- Throwing or logging on an unknown label so “typos fail closed.”
- Adding `job_no` / email / `error.message` as a label so “ops can find the row.”
- Adding Redis or a Mongo rollup so “gauges survive serverless.”
- Computing p95 in this file so “the duration name matches the alert.”
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` do not define Section 33 metrics.
- Writing a whole-folder recommendation for `granotLifecycle`.
