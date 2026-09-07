# Tell The Owner Reporting Delivery Is In Trouble — Never Notify Routine Success, Never Fail The Run From This File, Never Write Google — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 22 of this service — `reportingObservability.ts`
- Remaining in this service: `cleanup.ts`, `ownershipMarker.ts`, `registryFilters.ts`, remaining `google/*` adapters, remaining `live/*` harness
- Target: `src/services/reporting/reportingObservability.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor) — it never names this file, `emitReporting*`, `scanReportingOperationalHealth`, `findReportingStuckRuns`, `REPORTING_OBSERVABILITY_EVENT_KEYS`, `reporting_projection`, or `recordReportingLiveTestJanitorOutcome` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended write-this-happening-down: [`observability-record-operational-event.md`](observability-record-operational-event.md) (`recordOperationalEvent` is the persist **adapter** this file **asks** — pino, maybe Mongo, maybe Incident, maybe email; this file never persists). Distinct from already-recommended Granot catalog: [`granot-lifecycle-observability.md`](granot-lifecycle-observability.md) (frozen Section 33 names + sanitizer; different workflow; `notificationCandidate: false`). Distinct from already-skipped sibling audit: `reportingAudit.ts` (`recordReportingAudit` writes actor success/failure for preview / revision / destination / delivery — leftover desk and leftover `failRun` **ask** it in parallel; this file never takes an actor). Distinct from already-recommended claim / write / fail: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (`failRun` transitions the run, then leftover `emitObservabilityForReportingFailure` **asks** four of these emits; leftover denylist **asks** this file **before** `failRun`; this file never claims a lease). Distinct from leftover cleanup: sibling `cleanup.ts` (**asks** `emitReportingCleanupJanitorFailed` only when staging is visible; the retry catch does not). Distinct from leftover live janitor: `live/testArtifactJanitor.ts` (**asks** `recordReportingLiveTestJanitorOutcome` after trash). Distinct from already-recommended reserved-workbook refuse: [`operational-workbooks-registry.md`](operational-workbooks-registry.md) (`assertConfigurationComplete` / `evaluateReportingDestination` decide incomplete — this file only tells). Distinct from already-recommended leftover destination verify: [`reporting-destination.md`](reporting-destination.md) (Wave B `POST .../destinations/:id/verify` **asks** leftover verify, then on throw **asks** this file — leftover destination never imports this file). Distinct from already-recommended Drive consent: [`google-drive-oauth-google-drive-oauth.md`](google-drive-oauth-google-drive-oauth.md) (Wave B authorize / status / picker bootstrap / callback **ask** this file after a sanitized fail — leftover Drive never imports this file). Distinct from leftover Wave B `src/routes/reporting-cron.routes.ts` (health-scan gathers stuck candidates / pending cleanup / denylist, then **asks** `scanReportingOperationalHealth`; heartbeat and test-artifact janitor do **not** import this file). Distinct from already-recommended leftover notification policy: [`observability-notification-policy.md`](observability-notification-policy.md) (no reporting keys — this file’s `notificationCandidate` / `ownerVisible` bags are the policy). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets / Operational Event — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR). Software map: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (best-effort; never break the work).
- Callers: Wave B `src/routes/google-drive-oauth.routes.ts` (**asks** `emitReportingOAuthHealthFailure` from leftover callback and leftover `recordOAuthHealthFailure` on authorize / status / picker bootstrap). Wave B `src/routes/reporting.routes.ts` (**asks** `emitReportingDestinationHealthFailure` on leftover verify throw — skips leftover Google-disabled and Zod). Wave B `src/routes/reporting-cron.routes.ts` (**asks** `scanReportingOperationalHealth` from leftover health-scan only). Leftover `reportingWorker.ts` (**asks** `emitReportingDenylistUnavailable` with `{}` when leftover assert or leftover `DENYLIST_INCOMPLETE` refuses the write; leftover `failRun` leftover `emitObservabilityForReportingFailure` **asks** leftover verification / leftover promotion / leftover retry / leftover capacity). Leftover `cleanup.ts` (**asks** `emitReportingCleanupJanitorFailed` for leftover `staging_not_hidden` only). Leftover `live/testArtifactJanitor.ts` (**asks** `recordReportingLiveTestJanitorOutcome`). Tests: `reportingObservability.test.ts` **asks** leftover keys + leftover `findReportingStuckRuns` — it never **asks** an emit, leftover scan, leftover `recordOperationalEvent`, leftover ownerVisible, or leftover notification. Leftover `reporting.test.ts` / leftover `reportingDelivery.test.ts` do **not** import this file. Leftover heartbeat / leftover preview / leftover confirm / leftover destination.service do **not** import this file.
- Seams callers need: tell-the-owner-this-named-reporting-trouble (`emitReporting*`) vs walk-the-health-scan (`scanReportingOperationalHealth`) vs record-the-live-test-janitor (`recordReportingLiveTestJanitorOutcome`) vs write-this-happening-down (`recordOperationalEvent`). The trouble-name / persist **seam** exists because this file owns the frozen `reporting.*` keys, the `reporting_projection` workflow, and the ownerVisible / notification / level bags — leftover persist never learns a reporting key. The health-scan / worker-fail **seam** exists because leftover cron gathers candidates and **asks** the scan; leftover worker fails the run first, then **asks** four named troubles — this file never transitions a run. The denylist-tell / reserved-list-refuse **seam** exists because leftover registry decides incomplete; leftover worker and leftover scan both **ask** the same tell. The owner-visible health / operator-only run **seam** exists because leftover OAuth, leftover destination verify, leftover verification, and leftover promotion set `ownerVisible: true`; leftover stuck / leftover retry / leftover capacity / leftover cleanup / leftover denylist / leftover live janitor do not. The alert / actor-audit **seam** exists because leftover `reportingAudit.ts` is a different write with an actor. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~316-line file is one sitting if you read it as tell the owner reporting delivery is in trouble — never notify routine success, never fail the run from this file, never write Google. Do **not** split into `emit.ts` / `scan.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** keep eleven copy-paste wrappers as the screenplay. Do **not** pull leftover persist / leftover worker `failRun` / leftover cleanup / leftover live janitor / leftover audit here so “one observability file owns the company.” If it later splits: `tellTheOwnerThisNamedReportingTroubleHappened.ts` / `walkTheReportingHealthScan.ts` / `recordTheLiveTestJanitorOutcome.ts` only as later story files, never CRUD.

`emitReportingOAuthHealthFailure` / `emitReportingDestinationHealthFailure` / `emitReportingStuckPhaseAlert` / `emitReportingRetryExhausted` / `emitReportingVerificationMismatch` / `emitReportingPromotionAmbiguous` / `emitReportingCleanupBacklog` / `emitReportingDenylistUnavailable` / `emitReportingCapacityDivergence` / `emitReportingCleanupJanitorFailed` / `scanReportingOperationalHealth` / `recordReportingLiveTestJanitorOutcome` are executor mechanics. The owner question is: *Reporting delivery, Google OAuth, a destination verify, a stuck run, exhausted retries, a verification mismatch, an ambiguous tab swap, a cleanup backlog, a missing reserved-workbook list, a capacity miss, or the live-test janitor just went wrong. Write that named trouble down. Do not write a success. Do not fail the run from here. Do not trash a tab. Do not email a full address. If the health-scan cron already gathered the active runs, the pending cleanups, and whether the reserved list is complete, walk those three and tell only what is actually wrong. If the teller itself fails, leftover persist already swallowed it — the worker, the verify route, and the janitor still happened.*

Already-recommended persist, leftover worker fail, leftover cleanup, leftover live janitor, leftover actor audit, leftover reserved-workbook refuse, and Wave B cron gather already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “tell the owner reporting delivery is in trouble — never notify routine success, never fail the run from this file, never write Google” story, not “an observability CRUD service,” and not leftover persist / leftover actor audit:

1. **Tell the owner this named reporting trouble happened** — every `emitReporting*` **asks** already-recommended `recordOperationalEvent` with leftover `category: "admin"`, leftover `workflow: "reporting_projection"`, leftover `piiPolicy: "none"`. The frozen leftover `REPORTING_OBSERVABILITY_EVENT_KEYS` are the only names this file may say (`reporting.oauth.health_failed`, `reporting.destination.health_failed`, `reporting.run.stuck_phase`, `reporting.run.retry_exhausted`, `reporting.delivery.verification_mismatch`, `reporting.delivery.promotion_ambiguous`, `reporting.cleanup.backlog`, `reporting.cleanup.janitor_failed`, `reporting.denylist.unavailable`, `reporting.capacity.divergence`, `reporting.live_test.janitor_completed`). Owner-visible leftover OAuth (reason + email **domain** only), leftover destination verify (`destination_id` + reason), leftover verification (first ten leftover `reasons`), leftover promotion (optional reason). Operator-only leftover stuck (`phase`, `age_ms`, optional `lease_owner`), leftover retry (`phase`, `provider_retries`), leftover capacity (`expected_cells`, `observed_cells`), leftover denylist (first twenty leftover `missing_registration_keys`), leftover cleanup janitor (optional `error_code`). Leftover notification is on except leftover cleanup backlog (`pendingCount >= 5`) and leftover live janitor (`!ok`). Leftover denylist is `critical`. Leftover cleanup backlog / leftover janitor fail are `warn`. The rest of this family are `error`. This file does not transition a run. This file does not trash a tab. This file does not throw (leftover persist never throws).

2. **Walk the reporting health scan** — `scanReportingOperationalHealth`. Leftover cron already gathered leftover stuck candidates, leftover `cleanupPendingCount`, leftover oldest cleanup run, leftover `denylistIncomplete`, leftover missing keys. This file clocks leftover `Date.now()`. Leftover `findReportingStuckRuns` keeps a candidate whose leftover `nowMs - updatedAtMs >= REPORTING_PHASE_STUCK_THRESHOLD_MS` (thirty minutes). For each stuck leftover **ask** leftover stuck-phase tell. If leftover pending cleanup is greater than zero, leftover **ask** leftover backlog tell. If leftover denylist is incomplete, leftover **ask** leftover denylist tell. This file does not query `ReportingRun`. This file does not **ask** leftover `listCleanupPendingDeliveries`. This file does not **ask** leftover `assertConfigurationComplete`.

3. **Record the live-test janitor outcome** — `recordReportingLiveTestJanitorOutcome`. The one leftover “completed” name. Leftover `ok` → leftover `info` and leftover `notificationCandidate: false`. Leftover errors → leftover `warn` and leftover notify. Leftover `reportable: true`. Leftover `ownerVisible: false`. Details: leftover scanned / eligible / trashed / errors / `dry_run`. This is not a success notification. Tests lock that leftover keys do not match `/success|routine/i`.

`findReportingStuckRuns` is a fold of operation 2. It is not a third owner operation. Do not teach leftover cron to **ask** it instead of leftover scan. Do not export leftover `REPORTING_WORKFLOW`.

## Organization

Keep one file. This is the screenplay for “tell the owner reporting delivery is in trouble.” Leftover persist, leftover worker fail, leftover cleanup, leftover live janitor, leftover actor audit, leftover reserved-workbook refuse already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingObservabilityService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second persist **adapter** beside already-recommended `recordOperationalEvent`. Do not invent a second notification **adapter** beside leftover `notificationCandidate` on these bags.

Do not keep eleven copy-paste wrappers as the reading order. Collapse the emit family onto one catalog-driven teller. Keep the old emit names as one-line aliases until leftover worker, leftover cleanup, leftover live janitor, and Wave B Drive / verify / health-scan migrate. Do not start leftover `failRun` from this file. Do not start leftover `runReportingCleanupJanitor` from this file. Do not start leftover `runTestArtifactJanitor` from this file. Do not start leftover `recordReportingAudit` from this file. Do not move this into `src/services/observability/` so “every Operational Event lives together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `emitReportingOAuthHealthFailure` (alias) | `tellTheOwnerThisNamedReportingTroubleHappened` (`oauthHealthFailed`) | Wave B Drive authorize / status / picker bootstrap / callback |
| `emitReportingDestinationHealthFailure` (alias) | same teller (`destinationHealthFailed`) | Wave B leftover verify throw |
| `emitReportingStuckPhaseAlert` (alias) | same teller (`runStuckPhase`) | leftover scan only |
| `emitReportingRetryExhausted` (alias) | same teller (`retryExhausted`) | leftover worker `failRun` |
| `emitReportingVerificationMismatch` (alias) | same teller (`verificationMismatch`) | leftover worker `failRun` |
| `emitReportingPromotionAmbiguous` (alias) | same teller (`promotionAmbiguous`) | leftover worker `failRun` |
| `emitReportingCleanupBacklog` (alias) | same teller (`cleanupBacklog`) | leftover scan |
| `emitReportingDenylistUnavailable` (alias) | same teller (`denylistUnavailable`) | leftover worker + leftover scan |
| `emitReportingCapacityDivergence` (alias) | same teller (`capacityDivergence`) | leftover worker `failRun` |
| `emitReportingCleanupJanitorFailed` (alias) | same teller (`cleanupJanitorFailed`) | leftover cleanup `staging_not_hidden` |
| `scanReportingOperationalHealth` | `walkTheReportingHealthScan` | Wave B leftover health-scan cron |
| `recordReportingLiveTestJanitorOutcome` | `recordTheLiveTestJanitorOutcome` | leftover live janitor |
| `findReportingStuckRuns` | `whichRunsHaveSatInAPhaseTooLong` | leftover scan + leftover test |
| `REPORTING_OBSERVABILITY_EVENT_KEYS` | `TheReportingTroubleNamesWeMaySay` | frozen leftover `reporting.*` keys |
| `REPORTING_PHASE_STUCK_THRESHOLD_MS` | `ThirtyMinutesWithoutAPhaseUpdate` | leftover scan clock |
| `ReportingStuckRunCandidate` | `ARunTheHealthScanMayCallStuck` | leftover cron mapping |

Keep the old names as one-line aliases until leftover `reportingWorker.ts`, leftover `cleanup.ts`, leftover `testArtifactJanitor.ts`, Wave B Drive routes, Wave B leftover verify, and Wave B leftover health-scan migrate. Do not make leftover cron learn leftover `findReportingStuckRuns` as the import. Do not persist a new leftover event-key string in this rename.

**No class for the workflow.** The type that *does* earn a name is the closed leftover trouble row the teller already encodes eleven times:

```ts
type ANamedReportingTrouble = {
  eventKey: (typeof REPORTING_OBSERVABILITY_EVENT_KEYS)[keyof typeof REPORTING_OBSERVABILITY_EVENT_KEYS]
  level: "warn" | "error" | "critical"
  ownerVisible: boolean
  notificationCandidate: boolean
  entity?: { type: "reporting_run" | "reporting_destination"; id: string }
}
```

That is the handoff from “a sibling already failed or leftover cron already counted” to “leftover persist may write one Operational Event.” Do **not** put leftover `actor` on this type so “alerts look like leftover audit.” Do **not** put leftover `success` on this type. Do **not** put a raw Google email on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// reportingObservability.ts
// Reporting delivery, Google OAuth, a destination verify,
// a stuck run, or cleanup just went wrong.
// Write that named trouble down.
// Do not write a success.
// Do not fail the run from here.
// Do not trash a tab.
// Do not email a full address.
// If the teller fails, leftover persist already swallowed it.

// ── 1. Tell the owner this named trouble happened ─────────

export const TheReportingTroubleNamesWeMaySay = {
  oauthHealthFailed: "reporting.oauth.health_failed",
  destinationHealthFailed: "reporting.destination.health_failed",
  runStuckPhase: "reporting.run.stuck_phase",
  retryExhausted: "reporting.run.retry_exhausted",
  verificationMismatch: "reporting.delivery.verification_mismatch",
  promotionAmbiguous: "reporting.delivery.promotion_ambiguous",
  cleanupBacklog: "reporting.cleanup.backlog",
  cleanupJanitorFailed: "reporting.cleanup.janitor_failed",
  denylistUnavailable: "reporting.denylist.unavailable",
  capacityDivergence: "reporting.capacity.divergence",
  liveTestJanitorCompleted: "reporting.live_test.janitor_completed",
} as const

export async function tellTheOwnerThisNamedReportingTroubleHappened(trouble)
  // leftover recordOperationalEvent — never throws
  // leftover workflow reporting_projection
  // leftover piiPolicy none
  // leftover OAuth: reason + email domain only
  // leftover verification: first ten reasons
  // leftover denylist: first twenty missing keys

export const emitReportingOAuthHealthFailure = tellOauthHealthFailed
export const emitReportingDestinationHealthFailure = tellDestinationVerifyFailed
export const emitReportingStuckPhaseAlert = tellThisRunIsStuckInAPhase
export const emitReportingRetryExhausted = tellProviderRetriesAreExhausted
export const emitReportingVerificationMismatch = tellDeliveryVerificationMismatched
export const emitReportingPromotionAmbiguous = tellReplaceTabPromotionIsAmbiguous
export const emitReportingCleanupBacklog = tellCleanupIsBackingUp
export const emitReportingDenylistUnavailable = tellTheReservedWorkbookListIsIncomplete
export const emitReportingCapacityDivergence = tellWrittenCellsDivergedFromTheEstimate
export const emitReportingCleanupJanitorFailed = tellCleanupJanitorCouldNotTrashStaging

// ── 2. Walk the health scan ───────────────────────────────

export async function walkTheReportingHealthScan(gathered)
  // leftover find stuck (≥ thirty minutes)
  // leftover tell each stuck run
  // leftover tell backlog when pending > 0 (notify when ≥ 5)
  // leftover tell denylist when leftover cron said incomplete

export function whichRunsHaveSatInAPhaseTooLong(candidates, nowMs, thresholdMs)
export const ThirtyMinutesWithoutAPhaseUpdate = 30 * 60 * 1000

// ── 3. Record the live-test janitor outcome ───────────────

export async function recordTheLiveTestJanitorOutcome(outcome)
  // leftover ok → info, do not notify
  // leftover errors → warn, notify
  // leftover reportable true — not a success key
```

Read the worker-fail path out loud: *Leftover `failRun` already marked the run failed and patched leftover delivery. Then leftover `emitObservabilityForReportingFailure` asks this file. Verification mismatch, ambiguous promotion, exhausted provider retries, or capacity miss becomes one named trouble. Destination-unsafe after leftover denylist already asked the denylist tell before `failRun`. This file never wrote `status: "failed"`.*

Read the health-scan path out loud: *Leftover cron loaded up to one hundred active runs, leftover pending cleanups, and leftover `assertConfigurationComplete`. It asks `walkTheReportingHealthScan`. This file finds who sat in a phase for thirty minutes, tells each, tells a backlog when anything is pending, and tells denylist when the reserved list is incomplete. It never opened Mongo.*

Read the Drive-callback path out loud: *Owner Google consent failed. Wave B leftover sanitizer already named a category. This file writes leftover `reporting.oauth.health_failed` with that reason and, if a leftover email was present, only the domain after `@`. The completion page still rendered.*

That is the operation. `emitReportingVerificationMismatch` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **Eleven wrappers are the same teller.** Each leftover `emitReporting*` is leftover `recordOperationalEvent` plus a bag. Do not silently leave them as the screenplay so “each HTTP-ish verb owns a function.” Collapse onto leftover `tellTheOwnerThisNamedReportingTroubleHappened` and keep the old names as aliases. Do not invent a twelfth leftover `emitReportingSuccess`.

2. **Leftover worker passes the phase as leftover verification `reasons`.** Leftover `emitObservabilityForReportingFailure` leftover `VERIFICATION_MISMATCH` **asks** leftover `reasons: [input.phase]`. The emit slices “reasons.” Do not silently start passing leftover engine leftover mismatch codes so “the name becomes honest” in this rename — leftover `failRun` metadata may not have them.

3. **Leftover capacity tell is leftover `DESTINATION_CAPACITY_EXCEEDED`.** Leftover worker maps leftover `metadata.limit` / leftover `metadata.count` onto leftover `expectedCells` / leftover `observedCells`. That may be leftover estimate vs leftover observed write, or leftover provider max vs leftover projected cells. Do not silently rename leftover `capacityDivergence` to leftover `capacityExceeded` so “the key matches the fail code” — that would persist a new leftover event-key string.

4. **Leftover denylist from leftover worker has no missing keys.** Leftover worker leftover **asks** `emitReportingDenylistUnavailable({})`. Leftover scan leftover **asks** leftover `missingKeys` from leftover `OperationalWorkbookConfigurationError`. Do not silently teach leftover worker to pass leftover `missing_registration_keys` so “both tells match” without leftover worker catching leftover `OperationalWorkbookConfigurationError` (today leftover `catch` is empty).

5. **Leftover cleanup janitor tell is leftover `staging_not_hidden` only.** Leftover retry catch leftover `cleanup_retry` does **not** **ask** this file. Do not silently emit leftover janitor-failed from that catch so “every leftover cleanup fail notifies.” Leftover backlog leftover scan already watches leftover pending.

6. **Leftover Drive consent uses a leftover reporting OAuth key.** Wave B leftover authorize / leftover status / leftover picker bootstrap / leftover callback **ask** leftover `reporting.oauth.health_failed` even when leftover Destination was not in the request. Do not silently invent leftover `google_drive.oauth.health_failed` so “Drive owns Drive” in this rename — leftover notification and leftover Admin search already know leftover `reporting.oauth.health_failed`.

7. **Leftover scan does not load runs.** Wave B leftover health-scan leftover `ReportingRun.collection.find` leftover limit 100. A leftover 101st stuck run is silent. Do not silently query Mongo from this file so “the scan is complete.”

8. **Leftover persist never throws; Wave B still `.catch`s.** Leftover verify and leftover Drive leftover `.catch(() => undefined)`. Do not silently drop those leftover catches so “best-effort is honest” — Wave B is locked.

9. **Leftover actor audit is a second write.** Leftover `failRun` leftover **asks** leftover `recordReportingAudit` leftover `delivery_failed` after this file. Leftover verify leftover **asks** leftover audit on success and this file on throw. Do not silently merge leftover audit into leftover `tellTheOwnerThisNamedReportingTroubleHappened` so “one event owns the actor.”

10. **Leave sibling files alone.** Leftover persist stays in leftover `recordOperationalEvent`. Leftover worker leftover `failRun` stays in leftover `reportingWorker.ts`. Leftover cleanup stays in leftover `cleanup.ts`. Leftover live janitor stays in leftover `testArtifactJanitor.ts`. Leftover audit stays in leftover `reportingAudit.ts`. Do not open unvisited leftover `cleanup.ts` this pass.

## Testing

The **interface** is the test surface. Existing asserts: leftover keys match `/^reporting\./`; leftover `liveTestJanitorCompleted` is a leftover `reporting.` name; leftover values do not match `/success|routine/i`; leftover `findReportingStuckRuns` keeps leftover run `a` past thirty minutes and drops leftover run `b` at sixty seconds. No leftover emit is called. No leftover `recordOperationalEvent` bag is locked. No leftover scan composition is locked.

Add proofs at the new names (later implementer; not this Cloud pass):

- tell named trouble: leftover persist **asks** leftover `eventKey` from leftover `TheReportingTroubleNamesWeMaySay`; leftover `workflow` is leftover `reporting_projection`; leftover `piiPolicy` is leftover `none`
- leftover OAuth: leftover details have leftover `reason`; leftover `google_email_domain` is the part after `@`; leftover full email is absent; leftover `ownerVisible` is true
- leftover destination verify: leftover entity type leftover `reporting_destination`; leftover `ownerVisible` is true
- leftover stuck / leftover retry / leftover capacity: leftover entity type leftover `reporting_run`; leftover `ownerVisible` is false; leftover `notificationCandidate` is true
- leftover verification: leftover `reasons` length ≤ 10; leftover `ownerVisible` is true
- leftover denylist: leftover level leftover `critical`; leftover missing keys length ≤ 20
- leftover cleanup backlog: leftover `notificationCandidate` is true only when leftover `pendingCount >= 5`
- leftover live janitor: leftover `ok` → leftover `info` and leftover do-not-notify; leftover errors → leftover `warn` and leftover notify; leftover `reportable` is true
- walk the health scan: leftover thirty-minute leftover stuck leftover **asks** leftover stuck tell; leftover pending 1 leftover **asks** leftover backlog without leftover notify; leftover pending 5 leftover notifies; leftover `denylistIncomplete` leftover **asks** leftover denylist tell; leftover empty gather leftover **asks** nothing
- never fail the run: leftover `transitionReportingRun` is not called
- never write Google: leftover `deleteSheet` / leftover `trashFile` are not called
- never leftover success key: leftover catalog still fails leftover `/success|routine/i`

Do not add helper-unit tests for leftover `REPORTING_WORKFLOW`. Do not boot leftover live Google, leftover queue publisher, or leftover destination desk. Do not replace leftover worker leftover `failRun` tests with this file so “one test owns both stories.” Do not assert leftover Drive leftover sanitizer categories as if they were leftover `tellTheOwnerThisNamedReportingTroubleHappened`.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/routes/reporting-cron.routes.ts`, `src/routes/google-drive-oauth.routes.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingObservabilityService` class or a `create.ts` / `update.ts` / `delete.ts` / `emit.ts` split.
- I would not invent a second persist **adapter** beside already-recommended `recordOperationalEvent`.
- I would not pull leftover worker `failRun`, leftover cleanup, leftover live janitor, leftover actor audit, or leftover reserved-workbook refuse into this file.
- I would not silently persist a new leftover event-key string.
- I would not silently emit leftover janitor-failed from leftover `cleanup_retry`.
- I would not silently teach leftover worker leftover denylist to pass leftover missing keys.
- I would not silently merge leftover actor audit into leftover alerts.
- I would not silently query `ReportingRun` from leftover scan.
- I would not open unvisited leftover `cleanup.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
