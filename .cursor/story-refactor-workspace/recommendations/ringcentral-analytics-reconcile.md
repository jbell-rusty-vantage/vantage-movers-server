# Ask RingCentral How Many Inbound Answered Calls Over Two Minutes Landed On Our Mapped Numbers In The Last Day — Store The Count Rollup So The Owner Can Compare It To The Leads We Produced — Never Create A Call Lead — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 15 of this service — `analytics-reconcile.service.ts`
- Remaining in this service: `auth.ts`
- Target: `src/services/ringcentral/analytics-reconcile.service.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (invariants: “Analytics reconcile is count-level comparison only — **must not** create Call Leads”; “Never create Ring Central Call Leads outside `ingestRingCentralQualifiedCall`”). Distinct from already-recommended sweep: [recommendations/ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) (`runRingCentralCallLogSync` pages Detailed inbound Voice and **asks** already-recommended promote; this file never pages Call Log and never promotes). Distinct from already-recommended Call Log vet: [recommendations/ringcentral-call-log-vetting.md](ringcentral-call-log-vetting.md) (`vetRingCentralCallLogRecord` — this file never unfolds a record). Distinct from already-recommended promote: [recommendations/ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (`ingestRingCentralQualifiedCall` — this file never **asks** it). Distinct from already-recommended evaluate: [recommendations/ringcentral-call-candidate-evaluator.md](ringcentral-call-candidate-evaluator.md) (this file **asks** only `CALL_LEAD_MINIMUM_ANSWERED_SECONDS`; it never evaluates a party). Distinct from leftover shared facts: `call-qualification.ts` (this file does **not** **ask** `qualifyRingCentralCall`). Distinct from skipped config: `ringcentral-config.ts` (`getRingCentralAnalyticsEndBufferMinutes` default 2; `RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED` default false — Wave B **asks** the flag; this file does not). Distinct from skipped HTTP client: `client.ts` (`ringCentralRequest` — this file **asks** it). Distinct from leftover `auth.ts` (token exchange lives there; this file never talks to OAuth). Distinct from unvisited registry snapshot: `loadRingCentralRouteSnapshot` / `listActiveRingCentralSnapshotNumbers` (this file **asks** those; it does not resolve a per-call route). Distinct from Wave B `src/services/analytics/` (admin reports over Mongo leads — knowledge already says “Not this module”). Distinct from Wave B `src/routes/ringcentral-cron.routes.ts` (`GET|POST /api/cron/ringcentral-analytics-reconcile` is a trigger and mapper only; `vercel.json` `0 6 * * *`). This checkout’s `CONTEXT.md` does not define Call Qualification / Analytics — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/ringcentral-cron.routes.ts` (`runRingCentralAnalyticsReconcile` default; injectable `runAnalyticsReconcile`). Wave B `src/routes/ringcentral-cron.routes.test.ts` (vercel.json schedule only; the harness sets `analyticsReconcileEnabled: () => false` and never **asks** this file). There is **no** `analytics-reconcile.service.test.ts`. There is **no** local `scripts/dev_ops/ringcentral/*analytics*` runner in this checkout. Already-recommended sweep, already-recommended Call Log vet, already-recommended promote, leftover auth, leftover seed — **do not import this file’s function**.
- Seams callers need: public snapshot (Wave B cron **asks** the same export); buffered window (`hoursBack` default 24 / `now` override — the window **seam**, not a second owner operation); enable skip vs thrown failure (Wave B maps disabled to `{ ok: true, skipped: true, reason: "RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED is not true" }` and a throw to HTTP 500 — this file does not skip)
- Split later (only if the file outgrows one sitting): this ~137-line file is one sitting if you read it as open the buffered lookback window, ask which mapped numbers are active now, fetch Analytics Aggregate counts, fold the groups, persist the rollup, and announce completion — never create a Call Lead. If it later splits: `openTheBufferedAnalyticsLookbackWindow.ts` / `askWhichMappedNumbersAreActiveNow.ts` / `fetchInboundAnsweredOverTwoMinutesCountsByCompanyNumber.ts` / `persistTheCountRollupAndAnnounceCompletion.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `reconcile.ts`, and never merge already-recommended sweep, already-recommended Call Log vet, already-recommended promote, leftover auth, skipped HTTP client, skipped config, or Wave B cron HTTP into this file

`runRingCentralAnalyticsReconcile` / `RingCentralAnalyticsSnapshotSummary` are executor mechanics. The owner question is: *The webhook plus Call Log sweep may under-count or over-count. Ask RingCentral Analytics how many inbound answered calls over two minutes landed on our mapped numbers in the last day. Trim the window end so it is never in the future. Store the count rollup by company number. The owner compares those counts to the leads we actually produced. Do not create a Call Lead. Do not fetch a caller-level record. Do not vet a call. Do not promote. Do not compare the counts yourself. Do not page Call Log. Do not evaluate a party.*

Already-recommended sweep, already-recommended Call Log vet, already-recommended promote, already-recommended evaluate, leftover shared facts, leftover auth, skipped HTTP client, skipped config, skipped metrics, unvisited registry snapshot, Wave B admin Analytics, and Wave B cron HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “ask RingCentral how many inbound answered calls over two minutes landed on our mapped numbers in the last day — store the count rollup so the owner can compare it to the leads we produced — never create a Call Lead” story, not “an Analytics CRUD reconciler,” and not already-recommended sweep / vet / promote:

1. **Open the buffered lookback window** — `windowTo` is `now` minus `getRingCentralAnalyticsEndBufferMinutes()` (default 2). `windowFrom` is `windowTo` minus `hoursBack` (default 24). The buffer exists because Analytics `timeTo` in the future is `ANL-302`. This beat does **not** elect a sweeper. There is no lease. There is no cursor.

2. **Ask which mapped numbers are active now** — **ask** `loadRingCentralRouteSnapshot()`, then **ask** `listActiveRingCentralSnapshotNumbers(snapshot)` at `now`. Those numbers become `callFilters.calledNumbers`. This beat does **not** **ask** `resolveRingCentralInboundRoute` per call. This beat does **not** observe a route.

3. **Fetch inbound answered-over-two-minutes counts by company number** — `POST /analytics/calls/v1/accounts/~/aggregation/fetch?page=1&perPage=200` through skipped `ringCentralRequest`. Filters: `Inbound`, `Answered`, `minSeconds: CALL_LEAD_MINIMUM_ANSWERED_SECONDS` (120 from already-recommended evaluate), `calledNumbers` = the mapped list, `timeZone: America/New_York`. Group by `CompanyNumbers` with empty `keys`. Counters / timers are sums. Accept `payload.data.records` or `payload.records`. This beat does **not** fetch Detailed Call Log. This beat does **not** unfold a caller.

4. **Fold the groups, persist the rollup, and announce completion** — each record becomes `{ key, name, answeredOver120, durationSeconds }` (string-or-null / number-or-zero). Sum `answeredOver120`. `insertOne` into `getRingCentralCollectionName("analyticsSnapshots")` (`ringcentral_analytics_snapshots` / `_test`) with `provider: "ringcentral"`, the PII-free summary, `groups`, and `capturedAt`. Log `ringcentral.analytics_reconcile.completed`. **Ask** `recordOperationalEvent` at info with the same key; `autoResolveKey` matches Wave B’s failed `dedupeKey` so a later success clears the failed incident. Return the summary without `groups`.

There is no evaluate-parties operation. There is no Call Log vet. There is no session persist. There is no lease. There is no Lead write. There is no comparison against `call_leads`. Already-recommended `ingestRingCentralQualifiedCall` is the only promotion **adapter** — this file never **asks** it. Skipped `ringCentralRequest` is the HTTP **adapter**. Unvisited `loadRingCentralRouteSnapshot` / `listActiveRingCentralSnapshotNumbers` are the mapped-number **adapters**. Wave B cron HTTP is a trigger **adapter**.

`hoursBack` / `now` sit on the window path. They are not extra owner operations. Do not invent a dashboard for `groups` in this rename. Do not export `storeSnapshot` / `stringOrNull` / `numberOrZero` as a public **seam**.

## Organization

Keep one file as the screenplay for “open the buffered lookback window, ask which mapped numbers are active now, fetch Analytics Aggregate counts, fold the groups, persist the rollup, and announce completion — never create a Call Lead.” Already-recommended sweep, already-recommended Call Log vet, already-recommended promote, already-recommended evaluate, leftover shared facts, leftover auth, skipped HTTP client, skipped config, skipped metrics, unvisited registry snapshot, Wave B admin Analytics, and Wave B cron HTTP already live in deeper **modules**. Do not pull those in. Do not invent an `AnalyticsReconcileService` class. Do not invent a begin / complete **seam** — this file never writes a Lead and never sits in a command transaction. Do not invent a lease **adapter** beside already-recommended Call Log sync’s account lease. Do not invent a promote **adapter** beside already-recommended `ingestRingCentralQualifiedCall`. Do not invent a compare-against-leads **adapter** this file does not own.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `reconcile.ts`. Those are persistence verbs, not the owner story. Do not move Analytics Aggregate into already-recommended sweep so “one cron owns counts and promote.” Do not silently create a Call Lead from a group key so “reconcile means catch-up.” Do not silently compare `totalAnsweredOver120` to `call_leads.count` so “the file lives up to reconcile.”

**External interface** stays small (this is the test surface). Open-window, ask-mapped-numbers, fetch-counts, and persist-announce are one story’s count snapshot, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `runRingCentralAnalyticsReconcile` | `snapshotYesterdayInboundAnsweredOverTwoMinutesCountsByCompanyNumber` | Wave B cron **asks** the same snapshot |
| `RingCentralAnalyticsSnapshotSummary` | `WhetherTheCountRollupWasStored` | Wave B returns `ranAt` / window / `groupCount` / `totalAnsweredOver120`; counts stay PII-free |

Keep the old names as one-line aliases until Wave B cron migrates. Do not make callers learn `ANALYTICS_ENDPOINT` / `storeSnapshot` / `stringOrNull` as the domain language.

**Principle: old exports stay as aliases.** `runRingCentralAnalyticsReconcile` remains the imported name until Wave B cron migrates.

**No class for the workflow.** The type that *does* earn a name is the PII-free summary Wave B already returns:

```ts
type WhetherTheCountRollupWasStored = {
  ranAt: string
  windowFrom: string
  windowTo: string
  groupCount: number
  totalAnsweredOver120: number
}
```

That is the handoff from “a daily cron tick arrived” to “Wave B may say skip, ok, or 500.” Do **not** add `groups[]` so “the owner can see every company number in the HTTP body,” and do **not** add `callerPhoneNumber` so “the owner can see who called.” Stored `groups` stay on the Mongo row this file writes; they are not the public **interface**.

Do not add `ingestRingCentralQualifiedCall` as a public **seam** — already-recommended promote already owns that. Do not add `vetRingCentralCallLogRecord` as a public **seam** — already-recommended Call Log vet already owns that. Do not add `isRingCentralAnalyticsReconcileEnabled` as a public **seam** — skipped config already owns that, and Wave B already **asks** it.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// analytics-reconcile.service.ts
// The webhook plus Call Log sweep may under-count or over-count.
// Ask RingCentral Analytics how many inbound answered calls
// over two minutes landed on our mapped numbers in the last day.
// Store the count rollup.
// The owner compares it to the leads we produced.
// Never create a Call Lead.

// ── 1. Open the buffered lookback window ──────────────────

export async function snapshotYesterdayInboundAnsweredOverTwoMinutesCountsByCompanyNumber(
  options?: { hoursBack?: number; now?: Date },
)

function openTheBufferedAnalyticsLookbackWindow(now, hoursBack)
function refuseAWindowEndThatWouldBeInTheFuture(now)   // ANL-302 buffer

// ── 2. Ask which mapped numbers are active now ────────────

async function askWhichMappedNumbersAreActiveNow()
function putThoseNumbersOnTheCalledNumbersFilter(mappedNumbers)

// ── 3. Fetch inbound answered-over-two-minutes counts ─────

async function fetchInboundAnsweredOverTwoMinutesCountsByCompanyNumber(window, mappedNumbers)
function acceptRecordsFromDataRecordsOrRecords(payload)
function neverAskForACallerLevelRecord()

// ── 4. Fold, persist, announce ────────────────────────────

function foldEachGroupIntoKeyNameAnsweredCountAndDuration(records)
function sumAnsweredOverTwoMinutes(groups)
async function persistTheCountRollup(summary, groups, capturedAt)
async function announceTheRollupCompletedAndClearAPriorFailure(summary)
function returnThePiiFreeSummaryWithoutGroups(summary)
```

Read the primary path out loud: *Trim `windowTo` so it is not in the future. Look back twenty-four hours from that instant. Load the registry snapshot. List the mapped numbers that resolve now. Ask Analytics Aggregate for inbound answered calls over two minutes on those numbers, grouped by company number. Fold each group into a key, a name, an answered-over-120 count, and a duration. Sum the answered counts. Insert one snapshot row. Tell observability it completed so a prior failure clears. Hand Wave B a PII-free summary. Do not create a Call Lead. Do not fetch Detailed Call Log. Do not vet a record. Do not promote. Do not compare the rollup to `call_leads`.*

That is the operation. `runRingCentralAnalyticsReconcile` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The export says reconcile. The file snapshots.** Knowledge and the file comment say the owner compares the rollup to produced leads. This file never reads `call_leads`, never diffs, never opens a discrepancy. Do not silently add a lead-count comparison so “the name is honest.” Do not rename the Mongo collection in this pass. Keep `runRingCentralAnalyticsReconcile` as the alias.

2. **Enable lives on Wave B, not here.** `RINGCENTRAL_ANALYTICS_RECONCILE_ENABLED` defaults false. A disabled cron never **asks** this file. This file has no skip bag. Do not silently return `{ skipped: true }` from this export so “one file owns the flag.” Do not **ask** the flag here so “the service can run without a route” without a paired Wave B test that disabled still never fetches.

3. **Success event is this file; failure event is Wave B.** This file records `ringcentral.analytics_reconcile.completed` and auto-resolves `ringcentral.analytics_reconcile.failed:${env}`. Wave B records the failed event, puts `causeMessage` / `errorMessage` on it, and echoes `error.message` on HTTP 500. Already-recommended Call Log cron uses a safe non-sensitive 500. Do not silently move the failed event into this file so “one file owns both outcomes” without a paired Wave B test. Do not silently sanitize Wave B’s 500 in this rename — that is Wave B.

4. **Only page 1.** The URL hard-codes `page=1&perPage=200`. A 201st company-number group is dropped and the run still announces completion. Mapped numbers today will not hit 200. Do not silently page until a short page so “we never drop a group” without a paired empty-page test. Do not silently fail closed after a full page so “we never under-count” without a paired owner decision.

5. **Empty mapped list still fetches.** `calledNumbers: []` is sent when the snapshot has no active numbers. Analytics may return account-wide groups or none. Do not silently skip the POST so “empty means zero” without a paired test that `groupCount` / `totalAnsweredOver120` stay 0 and no provider call happens. Do not silently treat empty as “all company numbers.”

6. **`insertOne` has no window identity.** A retried 6am tick writes a second row for the same window. There is no unique `{ windowFrom, windowTo }` and no lease. Do not silently upsert so “one row per day” without a paired owner decision. Do not copy already-recommended Call Log’s account lease onto this file so “every cron elects.”

7. **The 120s constant is imported from already-recommended evaluate, not leftover facts.** Already-recommended Call Log vet **asks** leftover `qualifyRingCentralCall`; this file only needs the number for `callDuration.minSeconds`. Knowledge still names the constant on already-recommended evaluate. Do not silently **ask** leftover facts so “one qualify path.” Do not silently **ask** already-recommended Call Log vet so “Analytics uses the same fold.” Analytics Aggregate has already grouped; there is no record to vet.

8. **Leave sibling modules alone.** Already-recommended `runRingCentralCallLogSync` stays on already-recommended sweep. Already-recommended `vetRingCentralCallLogRecord` stays on already-recommended Call Log vet. Already-recommended `ingestRingCentralQualifiedCall` stays on already-recommended promote. `CALL_LEAD_MINIMUM_ANSWERED_SECONDS` stays on already-recommended evaluate. `ringCentralRequest` stays on skipped `client.ts`. Buffer minutes and the enable flag stay on skipped `ringcentral-config.ts`. `loadRingCentralRouteSnapshot` / `listActiveRingCentralSnapshotNumbers` stay on unvisited `operationsRegistry`. Leftover `auth.ts` stays leftover. Wave B cron HTTP stays in Wave B. Wave B admin Analytics stays in Wave B. This file orchestrates them.

## Testing

The **interface** is the test surface: `snapshotYesterdayInboundAnsweredOverTwoMinutesCountsByCompanyNumber`.

Today there is **no** file test. Wave B `ringcentral-cron.routes.test.ts` proves the `0 6 * * *` vercel.json entry and keeps this cron disabled so the harness never **asks** this file. That is not enough for a story that must never create a Call Lead. Add injectable **adapters** for clock, buffer, registry snapshot, fetch, persist, and events — the same file-test **seam** already-recommended sweep already has — then name the operation.

**Open the buffered lookback window**
- Default `now` minus a 2-minute buffer is `windowTo`. `windowFrom` is 24 hours before `windowTo`.
- `hoursBack: 12` shortens only `windowFrom`.
- Injected `now` wins over wall clock.
- `windowTo` is never `now` (ANL-302).

**Ask which mapped numbers are active now**
- Active snapshot numbers become `calledNumbers`.
- An empty mapped list is an explicit case: prove today’s fetch-anyway behavior, or the later skip, at this **interface**. Do not hide it in `listActiveRingCentralSnapshotNumbers`.

**Fetch inbound answered-over-two-minutes counts**
- The POST body is `Inbound` + `Answered` + `minSeconds: 120` + `CompanyNumbers` + `America/New_York`.
- `payload.data.records` and `payload.records` both fold.
- A missing / non-array records bag becomes `groupCount: 0` and `totalAnsweredOver120: 0`.
- This file never **asks** already-recommended promote, already-recommended Call Log vet, or Detailed Call Log.

**Fold, persist, announce**
- Two groups of 3 and 5 → `totalAnsweredOver120: 8`, `groupCount: 2`.
- The returned summary has no `groups`, no caller phone, no provider body, no token.
- Persist receives `groups` plus `provider: "ringcentral"`.
- A completed run records `ringcentral.analytics_reconcile.completed` and auto-resolves the failed key.
- A thrown fetch does not persist and does not record completed. Wave B owns the failed event.

Wave B `ringcentral-cron.routes.test.ts` proves auth, disabled skip, and the 6am schedule — not this file’s window or fold. Do **not** add leftover ingest, leftover auth, or already-recommended sweep as this file’s proof.

Do **not** add a test per helper (`refuseAWindowEndThatWouldBeInTheFuture`, `acceptRecordsFromDataRecordsOrRecords`, `stringOrNull`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

## What I would not do

- An `AnalyticsReconcileService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `reconcile.ts`) for cleanliness.
- Breaking the count-only **seam**. This file must not create, adopt, shadow, or dry-run a Call Lead. It must not **ask** already-recommended promote.
- Treating already-recommended sweep, already-recommended Call Log vet, already-recommended promote, leftover auth, or Wave B admin Analytics as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not compare the rollup to `call_leads`; do not page past page 1; do not add a Call Log lease; do not move the failed event out of Wave B; do not skip the POST on an empty mapped list; do not upsert the snapshot.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `ringcentral`.
