# Write Only The Loud Best Relocation Health Letters — Always Alert On Structural Failure, Schema Drift, Duplicate Identity, Lease Contention, And Completed-With-Errors; Alert Growth Only At Five; Never Persist A Quiet Count — operational story

- Status: recommended
- Service: `ingestion` (Wave A, in-progress)
- Pass: 4 of this service — `health.ts`
- Remaining in this service: `queue.ts`
- Target: `src/services/ingestion/health.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (primary code **is** `applyPlan.ts`. Role: Inspect Best Relocation sheets, plan create/update/adopt/conflict after the 2026-04-30 Eastern cutoff, and apply a checksum-bound plan under a single lease. Mongo domain documents are System of Record and are written only through canonical commands. Best Relocation workbooks are the external evidence source. `IngestionRun` / `SourceRowReceipt` / `IngestionConflict` / `ExternalDataConnection` key `best_relocation` are operational evidence, not a second Lead authority. **Health alerts** names `shouldAlertIngestionSignal`: always alert on structural failure, schema/formula drift, duplicate source identity, lease contention, and completed-with-errors. `zero_parsed_counts` alerts when `read_count === 0`. `unmatched_refunds` / `leadless_booking_growth` / `conflict_growth` alert at count >= 5. Route errors never expose provider or source details. Knowledge never names `emitIngestionHealthSignal`, `planHealthSignals`, `IngestionHealthSignal`, `EVENT_KEYS`, `GROWTH_ALERT_THRESHOLD`, or `summarize` — do not add an Ingestion Service file in this rename so the Service sentence wins). Distinct from already-recommended claim / inspect / lock / finalize / fail: [`ingestion-worker.md`](ingestion-worker.md) (worker **asks** `emitIngestionHealthSignal` for `schema_or_formula_drift` on an unhealthy inspect, loops `planHealthSignals` after plan lock, and **asks** `completed_with_errors` twice on finalize. `failRun` **asks** `recordOperationalEvent` `best_relocation_ingestion.run_failed` directly and never **asks** `structural_failure`. `lease_busy` returns without **asking** `lease_contention`). Distinct from already-recommended walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md) (apply never **asks** this file). Distinct from already-recommended persist: [`ingestion-repository.md`](ingestion-repository.md) (repository never **asks** emit). Distinct from later wakeup: sibling `queue.ts` (this file never publishes). Distinct from skipped type-only: sibling `types.ts`. Distinct from already-recommended write-this-happening-down: [`observability-record-operational-event.md`](observability-record-operational-event.md) (this file **asks** `recordOperationalEvent` once per loud letter; `notificationCandidate: true`; category `google_sheets`; workflow `best_relocation_ingestion`). Distinct from already-recommended immediate email policy: [`observability-notification-policy.md`](observability-notification-policy.md) (this file never **asks** `dispatchEventNotifications`; record **asks** policy after persist). Distinct from Wave B heartbeat `src/routes/best-relocation-ingestion-cron.routes.ts` (**asks** `recordOperationalEvent` `best_relocation_ingestion.success_stale` directly when `application_enabled` and no successful run in 30 hours; never imports this file). Distinct from Wave B Owner HTTP / consumer / CLI (never import this file). This checkout's `CONTEXT.md` does not define Ingestion Origin / Best Relocation / Ingestion Run — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: `src/services/ingestion/worker.ts` **asks** `emitIngestionHealthSignal` three ways (blocking inspect `schema_or_formula_drift`; `planHealthSignals` then emit each letter after plan lock; `completed_with_errors` on schedule/retry finalize and `applyApprovedClaim`). Barrel: `src/services/ingestion/index.ts`. Tests: `ingestion.test.ts` **asks** `shouldAlertIngestionSignal` and `planHealthSignals` (health signals alert on structural and growth thresholds). No test **asks** `emitIngestionHealthSignal`. Apply / persist / Owner HTTP / heartbeat / consumer never import this file.
- Seams callers need: name-the-letters-the-owner-may-hear (`IngestionHealthSignal`) vs decide-whether-this-letter-is-loud-enough (`shouldAlertIngestionSignal`) vs collect-the-plan-time-letters (`planHealthSignals`) vs write-only-a-loud-letter (`emitIngestionHealthSignal`). The this-file / worker **seam** exists because worker **asks** emit and collect; this file never claims a run. The this-file / `failRun` **seam** exists because `failRun` writes `run_failed` without **asking** `structural_failure` (same event key). The this-file / `lease_busy` **seam** exists because worker returns `{ claimed: false, status: "lease_busy" }` without **asking** `lease_contention`. The this-file / `planHealthSignals` `schema_or_formula_drift` **seam** exists because worker **asks** emit drift before `failRun` and never passes `blocking_inspection_checks` into collect. The this-file / heartbeat `success_stale` **seam** exists because cron writes that key directly. The growth-threshold **seam** exists because collect pushes growth letters at count `> 0` and emit writes only at `>= 5`. There is no begin / complete Domain Command **seam**. There is no Owner HTTP **seam**. There is no Analytics **seam**. There is no Sheet Sync drain **seam**.
- Split later (only if the file outgrows one sitting): this ~183-line file is one sitting if you read it as write only the loud Best Relocation health letters — always alert on structural failure, schema drift, duplicate identity, lease contention, and completed-with-errors; alert growth only at five; never persist a quiet count. Do **not** split into `signal.ts` / `alert.ts` / `emit.ts` so each letter owns a file. Do **not** split into `create.ts` / `update.ts` / `delete.ts`. Do **not** pull worker claim / apply walk / repository persist / wakeup / observability persist / email policy here so one health file owns the company. If it later splits: `nameTheLettersTheOwnerMayHear.ts` / `decideWhetherThisLetterIsLoudEnough.ts` / `collectThePlanTimeLetters.ts` / `writeOnlyALoudLetter.ts` only as later story files, never CRUD.

`emitIngestionHealthSignal` / `shouldAlertIngestionSignal` / `planHealthSignals` are executor mechanics. The owner question is: *The inspect failed, the plan grew conflicts, the walk finished with row failures, or someone could not take the apply lease. Write a health letter. Always alert on structural failure, schema or formula drift, duplicate source identity, lease contention, and completed-with-errors. Alert zero parsed rows only when the read count is zero. Alert unmatched refunds, leadless bookings, and conflict growth only when the count is five or more. A quieter count is a letter we do not write. Do not claim the run. Do not walk the plan. Do not publish wakeup. Do not write Form Leads. Do not drain Sheet Sync.*

Worker claim / inspect / lock / finalize, apply walk, repository persist, wakeup, write-this-happening-down, and immediate email policy already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one "write only the loud Best Relocation health letters" story, not "a health CRUD service," and not worker claim / Owner approve / apply walk:

1. **Name the letters the owner may hear** — `IngestionHealthSignal`. Nine keys: `structural_failure` (run_id, code, phase, summary), `schema_or_formula_drift` (run_id, blocking_checks), `zero_parsed_counts` (run_id, read_count), `unmatched_refunds` / `leadless_booking_growth` / `conflict_growth` / `duplicate_source_identity` (run_id, count), `completed_with_errors` (run_id, failures, skipped_dependencies), `lease_contention` (scope, optional owner). Each key maps to one `best_relocation_ingestion.*` event key. `structural_failure` maps to `run_failed` — the same key `failRun` already writes.

2. **Decide whether this letter is loud enough to write** — `shouldAlertIngestionSignal`. Always true for `structural_failure`, `schema_or_formula_drift`, `duplicate_source_identity`, `lease_contention`, `completed_with_errors`. `zero_parsed_counts` is true only when `read_count === 0`. Growth keys (`unmatched_refunds`, `leadless_booking_growth`, `conflict_growth`) are true only when `count >= 5` (`GROWTH_ALERT_THRESHOLD`). Unknown key is false.

3. **Collect the plan-time letters from the locked plan** — `planHealthSignals`. If `blocking_inspection_checks` is non-empty, push `schema_or_formula_drift`. If `read_count === 0`, push `zero_parsed_counts`. If `counters.unmatched_refund > 0`, push `unmatched_refunds`. If `counters.leadless_booking > 0`, push `leadless_booking_growth`. If `counters.conflict > 0`, push `conflict_growth`. If `counters.duplicate_source_identity > 0`, push `duplicate_source_identity`. Worker after plan lock **asks** this with `read_count` from Forms + Local Forms + Calls + Booked + Refunds, plus `unmatched_refund` / `duplicate_source_identity` counted from plan actions. Worker never passes `blocking_inspection_checks` here — it already emitted drift and failed the run.

4. **Write only a loud letter through observability** — `emitIngestionHealthSignal`. If `shouldAlertIngestionSignal` is false, return (quiet count is discarded). Else `summarize` the letter and **ask** `recordOperationalEvent` at level `error`, category `google_sheets`, workflow `best_relocation_ingestion`, `notificationCandidate: true`, details = the letter. This file never **asks** `dispatchEventNotifications`. Email is record then policy.

`summarize` / `EVENT_KEYS` / `GROWTH_ALERT_THRESHOLD` are beats, not extra owner operations.

## Organization

Keep one file. This is the screenplay for "write only the loud Best Relocation health letters — always alert on structural / drift / duplicate / lease / errors; alert growth only at five; never persist a quiet count." Worker claim / apply walk / repository persist / wakeup / write-this-happening-down / immediate email already live in deeper **modules**. Do not pull those in. Do not invent an `IngestionHealthService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second observability **adapter** beside `recordOperationalEvent`. Do not invent a second email **adapter** beside policy. Do not invent a second fail **adapter** beside worker `failRun`.

Do not split signal / alert / emit into CRUD files. Collect and emit stay together because worker **asks** collect then emit. Do not start `failRun` from this file so "health owns structural." Do not start `runBestRelocationIngestionWorker` from this file so "health owns lease_busy." Do not start `publishIngestionWakeup` from this file so "a letter owns the queue." Do not start `runSheetSyncDrain` from this file because category is `google_sheets`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `IngestionHealthSignal` | `BestRelocationHealthLetter` | the letter union worker composes |
| `shouldAlertIngestionSignal` | `thisLetterIsLoudEnoughToWrite` | tests + emit gate; knowledge names this |
| `planHealthSignals` | `collectThePlanTimeLetters` | worker after plan lock |
| `emitIngestionHealthSignal` | `writeOnlyALoudBestRelocationHealthLetter` | worker **asks** emit; quiet counts return |

Keep the old names as one-line aliases until `worker.ts`, `ingestion/index.ts`, and `ingestion.test.ts` migrate. Do not export `summarize` / `EVENT_KEYS` / `GROWTH_ALERT_THRESHOLD`. Do not make Owner HTTP learn this file. Do not make heartbeat learn this file so "one health file owns success_stale." Do not make apply tests learn this file.

**No class for the workflow.** The type that *does* earn a name is the letter union:

```ts
type BestRelocationHealthLetter =
  | { key: "structural_failure"; run_id: string; code: string; phase: string; summary: string }
  | { key: "schema_or_formula_drift"; run_id: string; blocking_checks: string[] }
  | { key: "zero_parsed_counts"; run_id: string; read_count: number }
  | { key: "unmatched_refunds"; run_id: string; count: number }
  | { key: "leadless_booking_growth"; run_id: string; count: number }
  | { key: "conflict_growth"; run_id: string; count: number }
  | { key: "duplicate_source_identity"; run_id: string; count: number }
  | { key: "completed_with_errors"; run_id: string; failures: number; skipped_dependencies: number }
  | { key: "lease_contention"; scope: string; owner?: string }
```

That is the handoff from "worker saw a failed inspect / a locked plan / a walk with errors / a busy lease" to "record may persist an Operational Event and policy may email." Do **not** put plan actions on this type. Do **not** put Google range strings on this type. Do **not** move `IngestionApplyResult` here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// health.ts
// The inspect failed, the plan grew conflicts,
// the walk finished with row failures,
// or someone could not take the apply lease.
// Write a health letter.
// Always alert on structural failure, schema drift,
// duplicate identity, lease contention, and completed-with-errors.
// Alert zero parsed rows only when the read count is zero.
// Alert unmatched refunds, leadless bookings, and conflict growth
// only when the count is five or more.
// A quieter count is a letter we do not write.
// Never claim the run. Never walk the plan. Never publish wakeup.

// --- 1. Name the letters the owner may hear ---

export type BestRelocationHealthLetter = IngestionHealthSignal
export type IngestionHealthSignal = BestRelocationHealthLetter

// --- 2. Decide whether this letter is loud enough to write ---

export function thisLetterIsLoudEnoughToWrite(letter)
export const shouldAlertIngestionSignal = thisLetterIsLoudEnoughToWrite

function growthCountIsAtLeastFive(count)

// --- 3. Collect the plan-time letters from the locked plan ---

export function collectThePlanTimeLetters(input)
export const planHealthSignals = collectThePlanTimeLetters

// --- 4. Write only a loud letter through observability ---

export async function writeOnlyALoudBestRelocationHealthLetter(letter)
export const emitIngestionHealthSignal =
  writeOnlyALoudBestRelocationHealthLetter

function summarizeTheLetter(letter)
```

Read the primary path out loud: *The inspect failed, the plan grew conflicts, the walk finished with row failures, or someone could not take the apply lease. Write a health letter. Always alert on structural failure, schema or formula drift, duplicate source identity, lease contention, and completed-with-errors. Alert zero parsed rows only when the read count is zero. Alert unmatched refunds, leadless bookings, and conflict growth only when the count is five or more. A quieter count is a letter we do not write. Never claim the run. Never walk the plan. Never approve. Never publish wakeup. Never drain Sheet Sync. Never post to Granot from this file.*

That is the operation. `emitIngestionHealthSignal` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **`structural_failure` is never asked.** Worker `failRun` writes `best_relocation_ingestion.run_failed` directly. Name the unused letter. Do **not** silently switch `failRun` to this file so "one emit owns every fail" — `failRun` also CAS-es `IngestionRun` to `failed` and this file never touches a run.

2. **`lease_contention` is never asked.** Worker returns `{ claimed: false, status: "lease_busy" }` with no letter. Knowledge says always alert on lease contention. Name the silent busy. Do **not** silently emit from worker in this rename so "the Service sentence wins" without proving consumer retry still throws on `lease_busy`.

3. **`planHealthSignals` `schema_or_formula_drift` is unused.** Worker emits drift then `failRun` on unhealthy inspect and never passes `blocking_inspection_checks` into collect. Name the unused collect branch. Do **not** silently drop worker's direct emit so "collect owns every drift."

4. **A blocking inspect writes two happenings.** Worker emit `schema_drift` then `failRun` writes `run_failed`. Name the pair. Do **not** silently drop `run_failed` so "one letter owns inspect fail" — knowledge always-alerts both keys.

5. **Collect pushes growth at `> 0`; emit writes only at `>= 5`.** Counts 1-4 become discarded objects. Name quiet growth. Do **not** silently raise collect to `>= 5` so "one threshold owns both functions" — tests **ask** collect with count 5 and **ask** `shouldAlert` with 4 vs 5.

6. **`zero_parsed_counts` collect and alert are the same predicate.** Collect pushes only when `read_count === 0`; alert is also `read_count === 0`. Name the tautology. Do **not** silently drop the alert check so "collect already filtered."

7. **`completed_with_errors` summary omits `skipped_dependencies`.** Details carry both. Name the thin sentence. Do **not** silently add skipped to the summary so "one sentence owns both counters" without proving email body still clips.

8. **Heartbeat `success_stale` bypasses this file.** Cron writes that key with category `cron`. Name the out-of-band letter. Do **not** silently pull `success_stale` here so "one health file owns every Best Relocation key" — Wave B is locked.

9. **Tests never ask the parent emit seam.** Today `ingestion.test.ts` **asks** `shouldAlertIngestionSignal` and `planHealthSignals`. No test **asks** `emitIngestionHealthSignal`. That is helper-unit style for a story that **asks** record.

10. **Leave sibling modules alone.** `runBestRelocationIngestionWorker`, `applyBestRelocationPlan`, `appendSourceReceipt`, `publishIngestionWakeup`, `recordOperationalEvent`, `dispatchEventNotifications` are already the right **depth**. This file names letters, decides loudness, collects plan-time letters, and writes only the loud ones. Do not open `queue.ts` as a second recommendation this pass. Do not open `bestRelocationSheetIngest/` this pass.

## Testing

The **interface** is the test surface: `writeOnlyALoudBestRelocationHealthLetter` (today `emitIngestionHealthSignal`), plus `thisLetterIsLoudEnoughToWrite` / `collectThePlanTimeLetters` because knowledge and today's test already name those **seams**.

Today `ingestion.test.ts` **asks** `shouldAlertIngestionSignal` (zero-parse true; conflict growth 4 false / 5 true) and `planHealthSignals` (zero-parse + conflict + unmatched refund). Keep those asks. Name the operation. Add emit proofs. Use `TEST_MODE`. Inject record via the existing observability test sink. Do not boot live Google Sheets.

**Loudness**
- `structural_failure` / `schema_or_formula_drift` / `duplicate_source_identity` / `lease_contention` / `completed_with_errors` are loud.
- `zero_parsed_counts` is loud only when `read_count === 0`. `read_count: 1` is quiet.
- `conflict_growth` / `unmatched_refunds` / `leadless_booking_growth` are quiet at 4 and loud at 5.

**Collect**
- `read_count: 0` collects `zero_parsed_counts`.
- `counters.conflict: 5` collects `conflict_growth` even though emit would also write it.
- `counters.conflict: 1` still collects `conflict_growth`; emit then stays quiet.
- `blocking_inspection_checks: ["x"]` collects `schema_or_formula_drift`. Empty / omitted does not.
- Missing growth counters collect nothing for those keys.

**Write**
- Quiet letter never **asks** `recordOperationalEvent`.
- Loud letter **asks** record once: level `error`, category `google_sheets`, workflow `best_relocation_ingestion`, `notificationCandidate: true`, `eventKey` from `EVENT_KEYS`.
- `completed_with_errors` summary names failures. Details include `skipped_dependencies`.
- `lease_contention` summary names the apply scope.
- Form Lead / Call Lead / Booked Lead / Cancelled Lead models are not imported. `/api/v1` `fetch` `axios` are not asked.

Do **not** add a test per helper (`summarize`, `EVENT_KEYS`, `GROWTH_ALERT_THRESHOLD`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot Owner approve, heartbeat claim-due, Sheet Sync drain, Reporting worker write, Analytics, Granot drain, or CLI dry-run inside these tests. Worker claim / inspect / lock / finalize proofs stay in `ingestion-worker.md`. Apply proofs stay in `ingestion-apply-plan.md`. Heartbeat `success_stale` stays Wave B.

## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Ingestion Origin / Best Relocation / Ingestion Run.
- I would not open Wave B (`src/routes/ingestion.routes.ts`, `src/routes/best-relocation-ingestion-cron.routes.ts`, `api/queues/best-relocation-ingestion-consumer.ts`).
- I would not write a whole-folder Ingestion recommendation.
- I would not introduce an `IngestionHealthService` class or a `signal.ts` / `alert.ts` / `emit.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not invent a second observability **adapter** beside `recordOperationalEvent`.
- I would not invent a second email **adapter** beside policy.
- I would not silently switch `failRun` to `structural_failure` so "one emit owns every fail."
- I would not silently emit `lease_contention` from worker so "the Service sentence wins."
- I would not silently drop worker's direct drift emit so "collect owns every drift."
- I would not silently drop `run_failed` on a blocking inspect so "one letter owns inspect fail."
- I would not silently raise collect to `>= 5` so "one threshold owns both functions."
- I would not silently pull heartbeat `success_stale` into this file.
- I would not silently start `publishIngestionWakeup` or `runSheetSyncDrain` from this file.
- I would not open `queue.ts` or `bestRelocationSheetIngest/` as a second recommendation this pass.
- I would not silently reorder ADR-known side effects.
