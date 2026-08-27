# Judge The Seven Frozen Rollout Problems Against What Health Already Counted — Then Tell The Company Only When One Just Started Or Just Cleared — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, visited after this pass)
- Pass: 34 of this service — `alerts.ts`
- Remaining in this service: none — `granotLifecycle` visited
- Target: `src/services/granotLifecycle/alerts.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/observability.md`](../../../docs/knowledge/granot-lifecycle/observability.md) — Section 33 catalog, closed labels, rollout alerts, Owner/Admin health. Primary code also lists `observability.ts`, `metrics.ts`, and `projections.ts` (`projectGranotLifecycleHealth`). This file is the seven-code judge + firing/recovery persist. Distinct from named-transition emit + Owner-command watch: [recommendations/granot-lifecycle-observability.md](granot-lifecycle-observability.md). Distinct from process-local counters: [recommendations/granot-lifecycle-metrics.md](granot-lifecycle-metrics.md). Distinct from Mongo-backed health that *builds the snapshot and then calls this file*: [recommendations/granot-lifecycle-projections.md](granot-lifecycle-projections.md). Distinct from company-wide Operational Event / incident write: `src/services/observability/recordOperationalEvent.ts`. Distinct from RingCentral lease ownership: `src/services/ringcentral/call-log-sync-state.store.ts`. Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`observability.ts` / `metrics.ts` / `alerts.ts` — best-effort; not business authority). This checkout’s `CONTEXT.md` does not define Operational Event / rollout alert / Section 33 — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one runtime caller + test readers.** Health: `projections.ts` `projectGranotLifecycleHealth` builds the snapshot from Mongo (oldest due + threshold-crossing time, dead-letter count, 24-hour capture 503s, 1-hour claim recoveries, 24-hour Decision latency samples, RingCentral lease held/age, enabled-source ambiguity rates) then calls `evaluateGranotLifecycleAlerts` and `persistGranotLifecycleAlertTransitions`. Tests: `alerts.test.ts` (frozen codes/thresholds, oldest-due continuity, dead letter, capture 503, claim-recovery 5 vs 6, empty p95/rate = `insufficient_data`, nearest-rank p95, RingCentral lease + two source rates, transition classify). Replica: `operations.replica.test.ts` health seed expects `dead_letter_present` firing and then deletes `alert.firing` / `alert.recovered` events plus `granot_lifecycle.alert.*` incidents. Not callers: `metrics.ts` (this file never imports it), `observability.ts` (this file *calls* emit; it does not own the catalog), webhook / drain / processor (they increment or emit named transitions; they do not judge alerts), public Book / Cancel, RingCentral ingest.
- Seams callers need: health-built snapshot vs this file’s judge; judge vs persist (health calls both); frozen seven codes on `observability.ts` vs frozen thresholds on `config/domain/granotLifecycle.ts`; `ok` / `firing` / `insufficient_data` vs open-incident lookup; firing emit (`warn` + `dedupeKey`) vs recovery emit (`info` + `dedupeKey` + `autoResolveKey`); `insufficient_data` never recovers; sibling `emitGranotLifecycleEvent` as the only teller; persist swallow so capture/processing never pause
- Split later (only if the file outgrows one sitting): keep one file — this ~264-line module is one screenplay for “judge the seven frozen rollout problems against what health already counted; then tell the company only when one just started or just cleared.” If it later splits: `judgeTheSevenRolloutProblems.ts` / `tellTheCompanyOnlyWhenAProblemJustStartedOrJustCleared.ts` — story files, never `evaluate.ts` / `persist.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge emit, counters, health snapshot assembly, or RingCentral ingest into this file

`evaluateGranotLifecycleAlerts` / `persistGranotLifecycleAlertTransitions` / `classifyAlertTransition` are executor mechanics. The owner question is: *Health already counted Mongo. For each of the seven named rollout problems, say ok, firing, or we do not have enough data. Then look at the open incidents. Tell the company only when a problem just started or just cleared. Looking again must not open a second incident. Not enough data never clears a still-open fight. If the teller itself fails, capture and processing keep going. This file does not count. This file does not assemble the snapshot. This file does not write a Lead, Booking, case, or discrepancy.*

Named-transition emit, process-local counters, health snapshot assembly, and RingCentral lease ownership already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “judge, then tell only on a start or a clear” story, not “an alerts CRUD service,” and not the emit / counters / health DTO:

1. **Judge the seven frozen rollout problems against what health already counted** — accept a snapshot (age of the oldest due receipt and when it crossed 15 minutes, current dead-letter count, 24-hour capture 503s, 1-hour claim recoveries, 24-hour capture-to-decision samples, whether the RingCentral Call Log lease is held and for how long, and per-source ambiguity/policy-blocked rates). Thresholds come from `GRANOT_LIFECYCLE_ALERT_THRESHOLDS` and are not env-overridable. Oldest due fires only when age is over 15 minutes *and* we have stayed past that crossing for 10 minutes. Any dead letter fires. Any capture 503 in 24 hours fires. Claim recoveries fire only above 5 in one hour (5 is still ok). Capture-to-decision p95 uses nearest-rank on finite non-negative samples and is `insufficient_data` when there are none. RingCentral fires only when the lease is held *and* age is over 10 minutes; a lease that is not held reports observed `0` and stays ok. Source rates: an empty list is one global `insufficient_data`; a row whose denominator is 0 is `insufficient_data` for that masked `scope_ref`; a rate over 5% fires. Sort by code, then `scope_ref`. This function does not persist. This function does not emit. This function does not read `metrics.ts`.

2. **Tell the company only when a problem just started or just cleared** — load open/acknowledged Operational Incidents whose `dedupe_key` is `granot_lifecycle.alert.<code>.<scope_ref|global>`. For each judged problem: `firing` and not already open is a start; `ok` and already open is a clear; `insufficient_data` is never a clear, even when an incident is still open; already-firing and still-ok do nothing. A start emits `granot_lifecycle.alert.firing` at `warn` with the same dedupe key (sibling emit + `recordOperationalEvent` upsert the incident because `warn` is a failure level). A clear emits `granot_lifecycle.alert.recovered` at `info` with the same key plus `autoResolveKey` (info does not open a new incident; auto-resolve closes the old one). Stamp `since` on the projection only on a start. Swallow every throw. This function does not claim. This function does not write a Lead, Booking, case, or discrepancy. Alert persistence cannot pause capture or processing.

There is no third mutate operation. `nearestRankP95` / `evaluateOldestDue` / `evaluateDeadLetter` / `evaluateCaptureUnavailable` / `evaluateClaimRecovery` / `evaluateCaptureToDecisionP95` / `evaluateRingCentralLease` / `evaluateSourceRates` / `compareAlerts` / `alertDedupeKey` / `classifyAlertTransition` are folds, not public stories. `classifyAlertTransition` stays exported because tests lock “not enough data never recovers.” `alertCatalogFrozen` returns sibling `GRANOT_LIFECYCLE_ALERT_CODES`; runtime callers do not invoke it — tests freeze the list on `observability.ts` directly. `GRANOT_LIFECYCLE_EMAIL_ENABLED` is unrelated and stays false.

## Organization

Keep one file as the screenplay for “judge the seven frozen rollout problems against what health already counted; then tell the company only when one just started or just cleared.” Emit, counters, health snapshot assembly, and RingCentral lease already live in deeper **modules**. Do not pull those in. Do not invent a `GranotLifecycleAlertService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — judge is pure; persist is after health’s Mongo read. Do not invent a notify **seam** that has only one **adapter** here — sibling `emitGranotLifecycleEvent` is the teller; this file must not call `recordOperationalEvent` a second time.

Do not move this into `src/services/observability/` so “every incident lives with Operational Events.” Do not move this into `observability.ts` so “Section 33 is one sitting.” Do not move this into `metrics.ts` so “gauges can fire.” Do not move this into `projections.ts` so “health owns the judge.” Do not split `evaluate.ts` / `persist.ts` / `create.ts` / `update.ts`.

**External interface** stays small (this is the test surface). Judge and persist are one story’s look and tell, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateGranotLifecycleAlerts` | `judgeTheSevenRolloutProblems` | health hands a snapshot; this file only judges |
| `persistGranotLifecycleAlertTransitions` | `tellTheCompanyOnlyWhenAProblemJustStartedOrJustCleared` | health after the DTO; start/clear only |
| `classifyAlertTransition` | `isThisLookAStartOrAClear` | tests lock `insufficient_data` never recovers |
| `nearestRankP95` | `theNearestRankP95OfTheseSamples` | empty / junk → null; tests lock `[1..10] → 10` |
| `alertCatalogFrozen` | `theSevenFrozenRolloutNames` | Unit 30 freeze; codes live on the emit sibling |
| `GranotLifecycleAlertSnapshot` | `WhatHealthAlreadyCounted` | the handoff from health to this judge |
| `GranotLifecycleAlertProjection` | `AJudgedRolloutProblem` | ok / firing / insufficient_data + observed / threshold |

Keep the old names as one-line aliases until health migrates. Do not make callers learn `alertDedupeKey` / `compareAlerts` / `evaluateOldestDue` as the domain language.

**Principle: old exports stay as aliases.** `evaluateGranotLifecycleAlerts` and `persistGranotLifecycleAlertTransitions` remain the imported names until `projectGranotLifecycleHealth` points at the story names.

**No class for the workflow.** The type that *does* earn a name is the snapshot health already counted:

```ts
type WhatHealthAlreadyCounted = {
  oldest_due_age_ms: number | null
  oldest_due_threshold_since: Date | null
  dead_letter_count: number
  capture_503_count_24h: number
  claim_recoveries_1h: number
  capture_to_decision_samples_24h: readonly number[]
  ringcentral_lease_held: boolean
  ringcentral_lease_age_ms: number | null
  source_rates: Array<{ scope_ref: string; numerator: number; denominator: number }>
}
```

That is the handoff from “health just counted Mongo” to “this file may say ok, firing, or not enough data.” Do **not** add `job_no` / email / `error.message` so “ops can find the row,” and do **not** read `metrics.ts` getters so “one number.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// alerts.ts
// Health already counted Mongo.
// For each of the seven named rollout problems, say ok, firing,
// or we do not have enough data.
// Then tell the company only when a problem just started or just cleared.
// Looking again must not open a second incident.
// Not enough data never clears a still-open fight.
// If the teller fails, capture and processing keep going.
// This file does not count. This file does not write a Lead, Booking, case, or discrepancy.

export const theSevenFrozenRolloutNames = [
  "oldest_due_exceeded",
  "dead_letter_present",
  "capture_unavailable",
  "claim_recovery_rate",
  "capture_to_decision_p95",
  "ringcentral_lease_held",
  "source_ambiguity_policy_blocked_rate",
] as const

// ── 1. Judge the seven frozen rollout problems ───────────

export function judgeTheSevenRolloutProblems(whatHealthAlreadyCounted, now)
  return [
    hasTheOldestDueReceiptBeenLateForFifteenMinutesAndThenTenMore(),
    isThereAnyDeadLetter(),
    didCaptureReturn503InTheLastDay(),
    didWeRecoverMoreThanFiveClaimsInTheLastHour(),
    isCaptureToDecisionP95OverTenMinutes(),   // empty samples → insufficient_data
    hasTheRingCentralLeaseBeenHeldOverTenMinutes(),
    ...isAnyEnabledSourceBlockedOrAmbiguousMoreThanFivePercent(),
  ].sortByCodeThenScope()

function hasTheOldestDueReceiptBeenLateForFifteenMinutesAndThenTenMore()
  // age > 15 min AND now − threshold_since ≥ 10 min
  // health sets threshold_since = oldestDue + 15 min

function isCaptureToDecisionP95OverTenMinutes(samples)
  const p95 = theNearestRankP95OfTheseSamples(samples)
  if (p95 == null) return insufficient_data

function isAnyEnabledSourceBlockedOrAmbiguousMoreThanFivePercent(rates)
  if (rates is empty) return one global insufficient_data
  if (denominator <= 0) return insufficient_data for that masked scope
  rate > 0.05 → firing

// ── 2. Tell the company only when a problem just started or just cleared ─

export async function tellTheCompanyOnlyWhenAProblemJustStartedOrJustCleared(judged, now)
  const alreadyOpen = openOrAcknowledgedIncidentsForTheseDedupeKeys()
  for (const problem of judged)
    const transition = isThisLookAStartOrAClear(problem.state, alreadyOpen)
    if (transition === "firing")
      tellTheCompanyThisNamedTransitionHappened("granot_lifecycle.alert.firing")  // warn + dedupe
      stampSinceOnTheProjection()
    if (transition === "recovered")
      tellTheCompanyThisNamedTransitionHappened("granot_lifecycle.alert.recovered")  // info + autoResolve
  ifTheTellerFails, staySilent()               // never pause capture / processing

function isThisLookAStartOrAClear(state, wasOpen)
  firing + not open → start
  ok + open → clear
  insufficient_data + open → do nothing        // never recovers
```

Read the primary path out loud: *Health counted Mongo and handed us a snapshot. The oldest due receipt is 25 minutes late and crossed 15 minutes ten minutes ago, so `oldest_due_exceeded` fires. One dead letter fires. Zero capture 503s stay ok. Five claim recoveries stay ok; a sixth would fire. No capture-to-decision samples means `insufficient_data`, not success. The RingCentral lease is held 10 minutes and one millisecond, so it fires. Source `aaaaaa...bbbb` is 0/10 and stays ok; `cccccc...dddd` is 1/10 and fires. We then look at open incidents. A code that is already firing does not emit again. A code that is now ok and was open emits recovered and auto-resolves. `insufficient_data` on a still-open incident emits nothing. If emit throws, we swallow it. Capture and drain keep going.*

That is the operation. `evaluateGranotLifecycleAlerts` is not a logger wrapper. `persistGranotLifecycleAlertTransitions` is not an increment.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The seven codes live on the emit sibling; the thresholds live in config.** `GRANOT_LIFECYCLE_ALERT_CODES` is exported from `observability.ts`. `GRANOT_LIFECYCLE_ALERT_THRESHOLDS` is exported from `config/domain/granotLifecycle.ts` and is not env-overridable. This file is the judge, not the dictionary owner. Do not move the codes here so “the alert file owns the names,” and do not move the thresholds onto `process.env` so “ops can tune without a deploy.”

2. **`alertCatalogFrozen` is unused at runtime.** Tests freeze `GRANOT_LIFECYCLE_ALERT_CODES` from `observability.ts` directly. Keep the export as the freeze **seam**. Do not delete it so “dead code,” and do not make health call it so “one catalog reader.”

3. **Persist is untested at this interface.** `alerts.test.ts` locks classify + evaluate. `operations.replica.test.ts` calls health (which persists) and then deletes the firing/recovered events and incidents. There is no test that a start emits once, a second look emits nothing, a clear auto-resolves, or `insufficient_data` leaves an open incident alone. Add those on this **interface**. Do not treat the replica cleanup as persist proof.

4. **This file never reads `metrics.ts`.** p95 samples are 24-hour Decision durations health already loaded from Mongo. Process-local `captureToDecisionMs` arrays are a different memory and have no cap. Do not call `getGranotLifecycle*` here so “one latency number,” and do not compute p95 in `metrics.ts` so “the metric name matches the alert.”

5. **Oldest-due continuity is a pair health already computed.** Health sets `oldest_due_threshold_since = oldestDue + 15 minutes`. This file then requires `now − that instant ≥ 10 minutes` *and* `age > 15 minutes`. A 25-minute-late receipt that crossed 15 minutes 9 minutes 999 ms ago stays ok. Do not drop the continuity clock so “age > 15 is enough,” and do not recompute `threshold_since` here so “the judge owns the crossing.”

6. **Empty p95 and empty source rates are `insufficient_data`, not ok.** Knowledge: that state never recovers an open alert. Classify already locks this. Do not map empty samples to `ok` so “no data means healthy,” and do not emit recovered on `insufficient_data` so “we should close the stale incident.”

7. **Source rates can be one global row or many scoped rows.** Empty snapshot → one projection with no `scope_ref`. Per-source rows carry a masked Registry id (`aaaaaa...bbbb`). Denominator `0` is `insufficient_data` with `observed_value: null`, not a 0% ok. Do not fire 0/0 so “any source with no Decisions is suspicious,” and do not drop the global empty row so “no sources means no alert.”

8. **RingCentral lease observed value is 0 when not held, not null.** Held + age over 10 minutes fires. Held + `age_ms == null` stays ok. Do not treat “not held” as `insufficient_data` so “we lack a lease row,” and do not move the lease clock into this file so “the alert owns RingCentral.”

9. **Dead-letter and capture-503 thresholds are 0, so any count fires.** Claim recovery is strictly greater than 5. Do not change `>` to `>=` so “5 recoveries should fire,” and do not raise dead-letter to 1 so “one leftover is noise.”

10. **Persist mutates `alert.since` on the projection in place.** Health then returns that same array on the DTO. A start stamps ISO `now`. A clear does not clear `since`. Do not write `since` into Mongo from this file so “the incident has a clock,” and do not clone the array first so “judge stays pure” without a test that names the DTO stamp.

11. **Firing uses `warn` so the sibling event writer upserts an incident; recovery uses `info` so it does not.** `recordOperationalEvent` treats `warn` as a failure level. Recovery relies on `autoResolveKey`, not a second incident. Do not emit recovery at `warn` so “both transitions are incidents,” and do not call `getOperationalIncidentModel().create` here so “alerts own incidents.”

12. **The open-incident lookup runs once before the loop.** A start in this pass does not become `wasOpen` for a later row in the same pass. Different codes / scopes are different keys. Do not re-query inside the loop so “we see our own write,” and do not emit twice for the same key so “the DTO and the incident stay in sync.”

13. **Persist swallows every throw.** Knowledge: evaluation cannot pause capture or processing. Do not rethrow so “ops see the failure,” and do not increment `metrics.ts` capture-failure here so “alert persist is a 503.”

14. **Knowledge covers three files plus health.** `observability.md` Primary code includes `observability.ts`, `metrics.ts`, `alerts.ts`, and `projectGranotLifecycleHealth`. That is not permission to write a whole-folder recommendation. This pass is the seven-code judge + start/clear persist only.

15. **Leave sibling modules alone.** Emit stays in `observability.ts`. Counters stay in `metrics.ts`. Snapshot assembly stays in `projections.ts`. RingCentral lease stays in `call-log-sync-state.store.ts`. Enabled-source filtering (`enabled` + `lifecycle_enabled` + non-deferred) stays in health’s `sourceRatesForEnabledSources`.

16. **Do not treat capture, drain, Owner Book / Cancel, or RingCentral ingest as this story.** Those write receipts, cases, `BookedLead`, or Call Leads. This file only judges a snapshot and tells on a start or a clear.

17. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `judgeTheSevenRolloutProblems` (today `evaluateGranotLifecycleAlerts`), `tellTheCompanyOnlyWhenAProblemJustStartedOrJustCleared` (today `persistGranotLifecycleAlertTransitions`), `isThisLookAStartOrAClear`, `theNearestRankP95OfTheseSamples`, and `theSevenFrozenRolloutNames`.

Today’s `alerts.test.ts` already names the seven-code freeze, the four locked thresholds, oldest-due continuity (25 min age + 10 min minus 1 ms stays ok), dead letter 0 vs 1, capture 503 any, claim recovery 5 ok / 6 firing, empty p95 and empty rates as `insufficient_data`, nearest-rank `[1..10] → 10` and one-sample `100`, p95 below/above 10 minutes, RingCentral held-over plus two source rates (0/10 ok, 1/10 firing, no `@` in JSON), and classify (start / already-open / clear / `insufficient_data` never recovers). Keep those. Add the gaps:

**Judge the seven frozen rollout problems**
- Oldest due `null` age stays ok (add this).
- RingCentral not held reports observed `0` and ok; held with `age_ms == null` stays ok (add this).
- A source row with denominator `0` is `insufficient_data` and `observed_value: null` (add this).
- Nearest-rank drops negatives and non-finite values before ranking (add this; empty-after-filter is `insufficient_data`).
- Results sort by code, then `scope_ref` (add this if persist/health start depending on order).
- Do not add a test that this path writes a receipt, case, Lead, or Booking.

**Tell the company only when a problem just started or just cleared**
- A first `firing` emits `granot_lifecycle.alert.firing` at `warn` with `dedupe_key` `granot_lifecycle.alert.<code>.global` (or the scoped key) and stamps `since` (add this).
- A second look that is still `firing` emits nothing (add this; classify locks the fold, not persist).
- An `ok` after an open incident emits `granot_lifecycle.alert.recovered` at `info` with `autoResolveKey` and does not open a second incident (add this).
- `insufficient_data` while an incident is open emits nothing and leaves the incident open (add this).
- Emit throw is swallowed; the function resolves (add this).
- Do not add a test that persist writes a Lead, Booking, case, or discrepancy.

**Frozen names**
- The seven codes stay the Unit 30 list (already locked on the emit sibling; keep it).
- Thresholds stay the locked minutes / zeros / 0.05 (already locked).

Do **not** add a test per helper (`hasTheOldestDueReceiptBeenLateForFifteenMinutesAndThenTenMore`, `alertDedupeKey`, `compareAlerts`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test emit sanitizer, process-local counters, health Mongo counts, drain claim, or RingCentral ingest here. Do not add a test that this file CRM-posts, `$set`s a Lead, or writes `BookedLead`.

## What I would not do

- A `GranotLifecycleAlertService` class with `evaluate` / `persist` / `create`.
- Thirty two-line functions that only wrap a threshold compare.
- Moving this into a CRUD folder (`evaluate.ts` / `persist.ts` / `create.ts` / `update.ts`), or into `observability.ts` / `metrics.ts` / `projections.ts` / `src/services/observability/` “for cleanliness.”
- Reading `metrics.ts` getters so “p95 and gauges live in one memory.”
- Making empty p95 / empty rates `ok` so “no data means healthy.”
- Emitting recovered on `insufficient_data` so “stale incidents close themselves.”
- Dropping the 10-minute oldest-due continuity clock so “age > 15 is enough.”
- Moving thresholds onto env so “ops can tune without a deploy.”
- Calling `recordOperationalEvent` directly so “alerts own incidents.”
- Rethrowing persist failures so “ops see the teller die.”
- Adding `job_no` / email / `error.message` onto the projection so “ops can find the row.”
- Treating `GRANOT_LIFECYCLE_EMAIL_ENABLED` as this story’s notify switch.
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` do not define rollout alerts.
- Writing a whole-folder recommendation for `granotLifecycle`.
