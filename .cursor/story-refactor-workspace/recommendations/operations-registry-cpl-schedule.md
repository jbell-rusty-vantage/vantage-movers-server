# Price A Feed From New York Business Dates — Show The Owner The Current Periods — Change One Or Many Feeds From A Date All Or Nothing — Apply One Advanced Edit To One Feed — Build And Check The Next Book In Memory — Archive Replaced Rows And Insert New Ones In The Same Transaction As The Registry Change — Bump The Revision Only When The Book Actually Changed — A Stale Revision Is Refresh And Retry — Price A Lead Day From The Covering Period Or Say Missing Or Duplicate-Zero Or Not-Applicable — Explicit Zero Is A Real Rate — Never Rewrite Prior Leads — Never Use createdAt — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 4 of this service — `cplSchedule.ts`
- Remaining in this service: `cplCorrections.ts`, `ringCentralRegistry.ts`, `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/cplSchedule.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (`cplSchedule.ts` is the writable CPL authority; Lead writes go through leftover `leads/leadCplResolution.ts`; leftover `cplCorrections.ts` rewrites prior Lead snapshots). Software rule: [`.cursor/rules/cpl-operations.mdc`](../../../.cursor/rules/cpl-operations.mdc) (`cpl_rate_periods` is writable; leftover `cpl_rates` and embedded granularity CPL are read-only compatibility; Owner dates are `America/New_York`; money is non-negative integer cents; active schedules are continuous, non-overlapping, and end with exactly one open period; writes build and validate in memory then persist periods + revision + Registry Change in one transaction; simple multi-row changes are all-or-nothing; schedule edits never rewrite prior Leads; Lead lookup uses the stored Eastern wall-clock day mapped to New York midnight, never `createdAt`; explicit zero is a valid resolved rate; `duplicate_zero` is Call-only). Already-recommended leftover fourteen-slot book: [recommendations/cpl-cpl-rate.md](cpl-cpl-rate.md). Already-recommended Lead snapshot **adapter**: [recommendations/leads-cpl-resolution.md](leads-cpl-resolution.md) (**asks** `resolveCpl` + `storedLeadTimestampToCplInstant`). Already-recommended Feed activate **asks** this file’s coverage check: [recommendations/operations-registry-source-registry.md](operations-registry-source-registry.md). Leftover prior-Lead rewrite: leftover `cplCorrections.ts` (next pass) — **asks** `resolveCplFromPeriods`, leftover `mongoCplScheduleStore`, leftover calendar helpers. Planned leftover `set_range` in [`docs/lead-costs-owner-editing/`](../../../docs/lead-costs-owner-editing/README.md) is **not shipped** — live Advanced UI still uses `add_future` / `split` / `correct_period` / `replace_schedule`. This checkout’s `CONTEXT.md` does not define CPL — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `v1.routes.ts` `GET /admin/source-granularities/:id/cpl-periods` and leftover `GET /admin/cpl/snapshot` (**ask** `listCplSchedule`); leftover `POST /admin/cpl/simple-schedule` (**asks** `applySimpleCplSchedule`); leftover `POST /admin/source-granularities/:id/cpl-schedule/commands` (**asks** `mutateAdvancedCplSchedule`); leftover correction preview first **asks** `listCplSchedule` then leftover `previewCplCorrection`. Leftover `sourceRegistry.ts` activate (**asks** `validateCplSchedule` after it loads unarchived periods itself). Leftover `queries/health.ts` `buildCplRegistryHealthFindings` (**asks** `validateCplSchedule`). Already-recommended leftover `leads/leadCplResolution.ts` (**asks** `resolveCpl` + `storedLeadTimestampToCplInstant`). Leftover `cplCorrections.ts` (**asks** `resolveCplFromPeriods`, `mongoCplScheduleStore.loadSchedule`, `businessDateToUtc`, `storedLeadTimestampToCplInstant`, `ownerInclusiveEndDateToExclusive`). Paid Overflow migration (**asks** `applySimpleCplSchedule`). M4 cutover lib (**asks** leftover `businessDateToUtc` / `dollarsToCents` only — it builds its own seed rows). Barrel: `operationsRegistry/index.ts`. Tests: `cplSchedule.test.ts` (calendar, money, coverage, in-memory next-book, persist CAS / all-or-nothing / unchanged no-op).
- Seams callers need: Owner show vs Owner write vs Lead price; simple multi-Feed from a date vs one advanced edit on one Feed; in-memory next-book vs persist (archive replaced rows + insert new ones); leftover `withRegistryMutation` (Change before commit / caches after commit); coverage check **asked** by leftover activate and leftover health vs the same check inside a write; Mongo `resolveCpl` vs given-periods `resolveCplFromPeriods`; leftover `CplScheduleStore` (tests inject) vs leftover `mongoCplScheduleStore` (leftover corrections import); Owner `YYYY-MM-DD` vs stored Lead Eastern wall-clock `Date`; revision CAS (`STALE_REVISION` + current book on the error)
- Split later (only if the file outgrows one sitting): this ~1218-line file is one sitting if you read it as price a Feed from New York business dates, show the Owner the current periods, change one or many Feeds from a date all or nothing, apply one advanced edit to one Feed, build and check the next book in memory, archive replaced rows and insert new ones in the same transaction as the Registry Change, bump the revision only when the book actually changed, a stale revision is refresh and retry, price a Lead day from the covering period or say missing / duplicate-zero / not-applicable, explicit zero is a real rate, never rewrite prior Leads, never use `createdAt`. If it later splits: `showTheOwnerTheCurrentCplBook.ts` / `changeCplFromABusinessDate.ts` / `applyOneAdvancedCplEdit.ts` / `priceALeadDayFromTheCoveringPeriod.ts` — story files, never `create.ts` / `update.ts` / `delete.ts`, and never merge leftover fourteen-slot reads, leftover Lead snapshot stamping, leftover prior-Lead rewrite, leftover Feed activate, leftover health findings, leftover `withRegistryMutation`, or planned leftover `set_range` into this file

`listCplSchedule` / `applySimpleCplSchedule` / `mutateAdvancedCplSchedule` / `resolveCpl` / `validateCplSchedule` are executor mechanics. The owner question is: *Each live Feed has a price book. Dates are New York business days. Money is cents. An active book is continuous, never overlaps, and ends with exactly one open period. The Owner can see the current periods, say “from this date these Feeds cost this much” (all or nothing), or apply one advanced edit to one Feed (add a future rate, split a period, replace the whole book, or correct one period’s amount). The next book is built and checked in memory. Then the write archives the replaced rows, inserts the new ones, bumps `schedule_revision` only when something actually changed, and writes one Registry Change in the same transaction. A stale revision is refresh-and-retry, not a silent overwrite. Pricing a Lead looks up the covering period for that Lead’s stored Eastern calendar day mapped to New York midnight. A hole is `missing_rate` (compatibility zero). A Duplicate Call Lead is zero and may keep the period id. “We chose not to price” is `not_applicable`. Explicit zero is a real rate. Schedule edits never rewrite prior Leads. Do not use `createdAt`. Do not invent a `set_range` command that is not shipped.*

Leftover fourteen-slot reads, leftover Lead snapshot stamping, leftover prior-Lead rewrite, leftover Feed activate, leftover health findings, leftover `withRegistryMutation`, Wave B CPL HTTP, and planned leftover `set_range` already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “price a Feed from New York business dates — show the Owner the current periods — change one or many Feeds from a date all or nothing — apply one advanced edit to one Feed — build and check the next book in memory — archive replaced rows and insert new ones in the same transaction as the Registry Change — bump the revision only when the book actually changed — a stale revision is refresh and retry — price a Lead day from the covering period or say missing or duplicate-zero or not-applicable — explicit zero is a real rate — never rewrite prior Leads — never use createdAt” story, not “a CPL CRUD service,” and not leftover fourteen-slot reads / leftover Lead snapshot stamping / leftover prior-Lead rewrite:

1. **Show the Owner the current periods for a Feed** — `listCplSchedule`. Load the Feed (missing → `NOT_FOUND`) and its unarchived periods, oldest start first. Returns `CplScheduleState` (`source_granularity_id`, `revision`, `active`, `periods`). Wave B `GET .../cpl-periods` **asks** this. Leftover snapshot and leftover correction preview **ask** this then do their own covering-period pick. This beat does **not** open a transaction. This beat does **not** require Owner. This beat does **not** price a Lead.

2. **Say whether a book is continuous enough to go live** — `validateCplSchedule`. Ordered by start. No overlap. An open period must be last. When `active: true`: at least one period, no gaps, exactly one open final period, and if `coverage_start_date` is set the first start must not be after that New York midnight. When `active: false`: gaps and a missing open end are allowed; order and overlap still fail. Explicit zero is valid money. Leftover Feed activate **asks** this with `active: true` on the periods it loaded. Leftover health **asks** this per live Feed. Writes **ask** this on the constructed next book (`active` from the Feed; coverage start from the current first period). This beat does **not** load Mongo. This beat does **not** write.

3. **Change the price from a business date on one or many Feeds — all or nothing** — `applySimpleCplSchedule`. Owner only. One `effective_date`, a map of expected revisions, and unique Feed ids with amounts. For each change, build the next book in memory (`constructSimpleCplSchedule`): if the covering period already has that amount, skip (no revision compare). Otherwise keep periods that already ended at or before that New York midnight, close the covering period at that midnight when it started earlier, drop everything from that date forward, and open a new open-ended period. Check every changed next book **before** incrementing any revision. Then, in leftover `withRegistryMutation`, CAS-increment each changed Feed, archive replaced rows, insert new rows, write one Registry Change (`action: "schedule_apply"`, `entityId` is the only Feed or `"multiple"`). Invalidate `cpl` / `source_granularities` / `registry_health` **after** commit. Unchanged-only command → `{ changed: false, schedules: [] }` and no write. Wave B `POST /admin/cpl/simple-schedule` and Paid Overflow **ask** this. This beat does **not** rewrite prior Leads.

4. **Apply one advanced edit to one Feed** — `mutateAdvancedCplSchedule`. Owner only. One Feed, one `expected_revision`, one operation: `add_future` (close the open end and open a later rate — requires an already-open final period that starts before the new date), `split` (the date must fall inside the named period; the second half supersedes the first), `correct_period` (same window, new amount; no-op if cents already match), `replace_schedule` (rebuild from Owner inclusive dates). Build (`constructAdvancedCplSchedule`), check (operation 2), then the same persist shell as operation 3. Equal next book → `{ changed: false }` and no increment. Stale revision → `STALE_REVISION` with the current book on the error and **no** archive / insert. Wave B `POST .../cpl-schedule/commands` maps leftover Zod names onto the operation union. This beat does **not** invent leftover `set_range`. This beat does **not** rewrite prior Leads.

5. **Price a Lead day from the covering period — or say missing / duplicate-zero / not-applicable** — `resolveCpl` / `resolveCplFromPeriods`. Inclusive start, exclusive end. `applicable === false` or no Feed id → `{ status: "not_applicable", amount: 0 }` (no store read). `duplicate: true` → `{ status: "duplicate_zero", amount: 0 }` and `base_period_id` only when exactly one covering row has an id. Else exactly one covering row with an id → `{ status: "resolved", amount, amount_cents, period_id }` (explicit zero is `resolved`, not missing). Zero or two covering rows, or a row without an id → `{ status: "missing_rate", fallback_amount: 0 }`. `resolveCpl` loads covering rows from leftover `mongoCplScheduleStore.findCoveringPeriods` (limit 2) and records leftover resolver telemetry. `resolveCplFromPeriods` is the given-periods **adapter** leftover corrections **ask**. Already-recommended leftover `priceTheLead` maps the stored Eastern wall-clock through leftover `storedLeadTimestampToCplInstant` **before** it **asks** `resolveCpl`, then stamps the Lead. This beat does **not** write an Operational Event (`lead.cpl.missing_rate` is leftover after-commit). This beat does **not** use `createdAt`.

There is no sixth prior-Lead rewrite operation. There is no leftover fourteen-slot read. There is no Feed-activate operation. Leftover `withRegistryMutation` is the transaction **adapter**. Leftover `CplScheduleStore` / `mongoCplScheduleStore` is the persistence **adapter**. Leftover `businessDateToUtc` / `storedLeadTimestampToCplInstant` / `ownerInclusiveEndDateToExclusive` / `dollarsToCents` are the calendar-and-money **adapter** leftover Lead pricing, leftover corrections, and M4 already **ask**. Wave B CPL HTTP is a second show / simple / advanced **adapter**, not a second owner story.

`createCplPeriod` / `constructSimpleCplSchedule` / `constructAdvancedCplSchedule` sit on operations 3 and 4. They are the in-memory next-book beats, not extra owner operations. Do not invent a dashboard for `AdvancedCplOperation` in this rename. Do not export `coveringPeriods` / `replacementPeriod` / `persistConstructedSchedule` as a public **seam**.

## Organization

Keep one file as the screenplay for “price a Feed from New York business dates, show the Owner the current periods, change one or many Feeds from a date all or nothing, apply one advanced edit to one Feed, build and check the next book in memory, archive replaced rows and insert new ones in the same transaction as the Registry Change, bump the revision only when the book actually changed, a stale revision is refresh and retry, price a Lead day from the covering period or say missing / duplicate-zero / not-applicable, explicit zero is a real rate, never rewrite prior Leads, never use `createdAt`.” Leftover fourteen-slot reads, leftover Lead snapshot stamping, leftover prior-Lead rewrite, leftover Feed activate, leftover health findings, leftover `withRegistryMutation`, leftover telemetry, Wave B CPL HTTP, and planned leftover `set_range` already live in deeper **modules**. Do not pull those in. Do not invent a `CplScheduleService` class. Do not invent a begin / complete **seam** — leftover `withRegistryMutation` is already the before-commit / after-commit **adapter**. Do not invent a second store **adapter** beside leftover `CplScheduleStore`. Do not invent a second coverage **adapter** beside `validateCplSchedule`. Do not invent a second Lead-price **adapter** beside leftover `priceTheLead`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `period.ts` as a CRUD folder. Those are persistence verbs, not the owner story. Do not move leftover `priceTheLead` into this file so “one file owns Lead CPL.” Do not move leftover `cplCorrections.ts` into this file so “edits rewrite old Leads.” Do not silently start shipping leftover `set_range` so “the planned pack lands in the rename.”

**External interface** stays small (this is the test surface). Show, coverage, simple change, advanced edit, and Lead-day price are one story’s price book, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listCplSchedule` | `showTheOwnerTheCurrentCplBook` | Wave B periods GET; leftover snapshot; leftover correction preview |
| `validateCplSchedule` | `sayWhetherThisBookCanGoLive` | leftover Feed activate; leftover health; writes check the next book |
| `applySimpleCplSchedule` | `changeCplFromABusinessDate` | Wave B simple POST; Paid Overflow; multi-Feed, all or nothing |
| `mutateAdvancedCplSchedule` | `applyOneAdvancedCplEdit` | Wave B commands POST; one Feed, one operation |
| `constructSimpleCplSchedule` / `constructAdvancedCplSchedule` | `buildTheNextSimpleCplBook` / `buildTheNextAdvancedCplBook` | in-memory next book leftover tests and leftover writes share; no persist |
| `resolveCpl` | `priceALeadDayFromTheLiveBook` | leftover `priceTheLead`; Mongo covering rows + leftover telemetry |
| `resolveCplFromPeriods` | `priceALeadDayFromThesePeriods` | leftover corrections already hold the book |
| `storedLeadTimestampToCplInstant` | `mapTheStoredEasternDayToNewYorkMidnight` | leftover Lead snapshot **asks** this before `resolveCpl` |
| `businessDateToUtc` / `ownerInclusiveEndDateToExclusive` / `dollarsToCents` | `newYorkMidnightFromABusinessDate` / `ownerInclusiveEndToNextMidnight` / `ownerMoneyToCents` | leftover corrections and M4 **ask** the same calendar/money |
| `mongoCplScheduleStore` | `theLiveCplPeriodBook` | leftover corrections load unarchived periods; tests inject leftover `CplScheduleStore` |
| `CplScheduleState` / `CplResolution` / `CplSchedulePeriod` | `OwnerCplBook` / `LeadDayCpl` / `CplPeriod` | Wave B JSON + leftover Lead snapshot + leftover corrections |

Keep the old names as one-line aliases until leftover HTTP, leftover Lead snapshot, leftover corrections, leftover activate, leftover health, Paid Overflow, and M4 migrate. Do not make callers learn `mutateAdvanced` / `applySimple` / `construct*` as the domain language.

**Principle: old exports stay as aliases.** `applySimpleCplSchedule` remains the imported name until Wave B simple POST and Paid Overflow migrate. `mutateAdvancedCplSchedule` remains the imported name until Wave B commands POST migrates. Persisted Registry Change `action` (`schedule_apply`), persisted operation `type` strings (`add_future` / `split` / `correct_period` / `replace_schedule`), and persisted `CplResolution.status` values stay those strings — they are audit / Lead-snapshot history, not story names.

**No class for the workflow.** The types that *do* earn names are the Owner book leftover HTTP already returns and the Lead-day result leftover `priceTheLead` already switches on:

```ts
type OwnerCplBook = {
  source_granularity_id: string
  revision: number
  active: boolean
  periods: CplPeriod[]
}

type LeadDayCpl =
  | { status: "resolved"; amount: number; amount_cents: number; period_id: string }
  | { status: "missing_rate"; fallback_amount: 0 }
  | { status: "duplicate_zero"; amount: 0; base_period_id?: string }
  | { status: "not_applicable"; amount: 0 }
```

That is the handoff from “the Owner changed the book” to “leftover `priceTheLead` stamps a new Lead” or “leftover `cplCorrections` rewrites a frozen prior Lead.” Do **not** add `rewritePriorLeads` so “the schedule owns corrections.” Do **not** add `set_range` so “the planned pack is the live UI.”

Do not add `withRegistryMutation` as a public **seam** — leftover `registryAudit.ts` already owns that. Do not add `priceTheLead` as a public **seam** from this file — leftover `leads/leadCplResolution.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// cplSchedule.ts
// Each live Feed has a price book.
// Dates are New York business days. Money is cents.
// An active book is continuous, never overlaps, and ends with exactly one open period.
// The Owner can see the current periods,
// say “from this date these Feeds cost this much” (all or nothing),
// or apply one advanced edit to one Feed.
// Build and check the next book in memory.
// Then archive the replaced rows, insert the new ones,
// bump the revision only when the book actually changed,
// and write one Registry Change in the same transaction.
// A stale revision is refresh-and-retry.
// Pricing a Lead looks up the covering period for that stored Eastern day
// mapped to New York midnight.
// A hole is missing. A Duplicate Call Lead is zero.
// Explicit zero is a real rate.
// Do not rewrite prior Leads. Do not use createdAt.

// ── 1. Show the Owner the current book ────────────────────

export async function showTheOwnerTheCurrentCplBook(feedId)

// ── 2. Say whether this book can go live ──────────────────

export function sayWhetherThisBookCanGoLive(periods, { active, coverageStartDate })
function refuseOverlapOrWrongOrder(previous, current)
function refuseAGapWhenTheFeedIsLive(previousEnd, currentStart, active)
function refuseUnlessThereIsExactlyOneOpenEnd(periods, active)

// ── 3. Change prices from a business date ─────────────────

export async function changeCplFromABusinessDate(command, actor)
export function buildTheNextSimpleCplBook(current, feedId, fromDate, amount)
  // covering already that amount → unchanged, no revision compare
  // else keep ended-before, close covering at midnight, drop from-date-forward, open new
async function checkEveryChangedBookBeforeWritingAny(prepared)
async function persistTheNextBookInTheSameTransactionAsTheChange(prepared, actor)

// ── 4. Apply one advanced edit to one Feed ────────────────

export async function applyOneAdvancedCplEdit(command, actor)
export function buildTheNextAdvancedCplBook(current, feedId, operation)
function addAFutureRate(openFinal, fromDate, amount)
function splitAPeriodAtABusinessDate(period, fromDate, amount)
function correctOnePeriodAmount(period, amount)
function replaceTheWholeBook(periodInputs)

// ── persist shell (3 and 4 share) ─────────────────────────

async function refuseUnlessTheRevisionIsCurrent(feed, expected, current)
async function archiveReplacedRowsAndInsertNewOnes(current, next, revision, actor, session)
function aStaleRevisionIsRefreshAndRetry(feed, current)   // no archive, no insert

// ── 5. Price a Lead day ───────────────────────────────────

export async function priceALeadDayFromTheLiveBook(input)
export function priceALeadDayFromThesePeriods(periods, input)
function coveringPeriodOrMissing(periods, at)             // 1 + id → resolved (zero is real); else missing

// ── calendar / money leftover Lead and leftover corrections ask ─

export function mapTheStoredEasternDayToNewYorkMidnight(storedTimestamp)
export function newYorkMidnightFromABusinessDate(yyyyMmDd)
export function ownerInclusiveEndToNextMidnight(inclusiveEnd)
export function ownerMoneyToCents(amount)
```

Read the primary path out loud: *The Owner looks at a Feed’s current periods. They say from Monday these Feeds cost twelve fifty. For each Feed, if that Monday’s covering period is already twelve fifty, skip it even if their revision number is old. If the amount changed, close the old period at Monday’s New York midnight, drop everything from Monday forward, and open a new open-ended period. Check every changed next book before writing any. Then, in one transaction, bump each changed Feed’s revision, archive the replaced rows, insert the new ones, and write one Registry Change. After commit, forget the CPL caches. A later Lead maps its stored Eastern calendar day to that same New York midnight, finds exactly one covering period, and stamps that rate — or says the rate is missing, or this Call Lead is a Duplicate so it costs zero. Explicit zero is a real rate. Do not rewrite the Leads that already used last month’s book. Do not use createdAt.*

That is the operation. `mutateAdvancedCplSchedule` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`mutateAdvanced` and `applySimple` share the persist shell and little else.** Both **ask** leftover `withRegistryMutation`, CAS-increment, archive-then-insert, and `schedule_apply`. Construction differs. Do not merge them into `upsertCplSchedule` so “one write.” Shared beats: refuse-owner, check-next-book, persist-change, forget-caches. The Owner stories are different.

2. **An unchanged simple row skips the revision compare.** The test `simple command ignores an unchanged row without revision comparison` sends `expected_revisions: { g1: 1 }` against live revision `5` and the same amount — success, no write. That is load-bearing: “same price from this date is a no-op even when the Owner’s revision is stale.” Do not silently `STALE_REVISION` an unchanged simple row so “every row checks the lock.”

3. **A changed simple row from a date replaces forward coverage.** `buildTheNextSimpleCplBook` keeps only periods that already ended at or before that midnight. A later future period after the change date is dropped. The test name “preserves future periods” is the unchanged no-op. Rename the beat (`dropCoverageFromThisDateForward`) so the replace is visible. Do not silently keep later future periods so “simple edits are surgical” without a paired interface test.

4. **Wave B leftover snapshot invents its own covering find.** `handleCplSnapshot` **asks** `showTheOwnerTheCurrentCplBook` then `periods.find` against `new Date()` (process now), not leftover `priceALeadDayFromThesePeriods` and not leftover `mapTheStoredEasternDayToNewYorkMidnight`. Do not silently route the snapshot through `resolveCpl` so “one lookup wins” in this rename — that is leftover Wave B HTTP, and `now` is not a stored Lead day.

5. **Leftover activate loads periods with `archived_at: { $exists: false }`; this store uses `archived_at: null`.** New inserts omit the field; archive `$set`s a Date. A document with explicit `archived_at: null` would be live here and invisible to leftover activate. Do not silently change leftover activate’s filter so “the queries match” without a paired interface test on leftover `sourceRegistry.ts`. Name the mismatch. Leave leftover activate’s loader in leftover `sourceRegistry.ts`.

6. **Money and shape errors use `DEPENDENCY_CONFLICT`.** Leftover `scheduleInvalid` is a 400 with the dependency-conflict registry code. Bad cents and a split date outside the period are not a dependency. Gaps and overlaps have their own codes (`CPL_SCHEDULE_GAP` / `CPL_SCHEDULE_OVERLAP`). Do not silently swap the money code in this rename without a paired interface test — leftover `dollarsToCents` tests lock `REGISTRY_DEPENDENCY_CONFLICT`.

7. **`replacementPeriod` drops `id` and sets `supersedes`.** Persist archives ids not in the next book and inserts periods without ids. A “correct amount” is a new row, not an in-place `$set`. Do not silently `updateOne` the live row so “correct is an edit.” The archive-then-insert **seam** is the history.

8. **`coverage_start_date` on a write is the current first period’s start.** An active Feed cannot replace the book with a later first start. Inactive Feeds skip that check. Do not silently allow an active replace to start later so “the Owner can shorten history” without a paired interface test.

9. **`resolveCpl` records leftover resolver telemetry; `resolveCplFromPeriods` does not.** Leftover corrections **ask** the given-periods export after they already loaded the book. Do not silently wrap leftover corrections in leftover `recordRegistryResolverAttempt` so “every price is metered.” Do not silently drop telemetry on `resolveCpl` so “pricing is quiet.”

10. **`findCoveringPeriods` limits 2.** Two overlapping live rows become `missing_rate` (`matches.length !== 1`). That is fail-closed, not “pick the latest.” Do not silently `sort + limit 1` so “overlaps still price.”

11. **Stored Lead timestamps are Eastern wall-clock components in a `Date`.** Leftover `mapTheStoredEasternDayToNewYorkMidnight` reads `getUTCFullYear` / `getUTCMonth` / `getUTCDate` and **asks** leftover `newYorkMidnightFromABusinessDate`. A real UTC instant whose UTC day is a different Eastern day would price the wrong day if someone passed it here. Do not silently switch to `Intl` on the stored `Date` so “the clock is honest” — leftover Lead writes already persist the convention. Knowledge already says never use `createdAt`.

12. **Planned leftover `set_range` is not on this interface.** Live Advanced UI still sends `add_future` / `split` / `correct_period` / `replace_schedule`. Do not add `set_range` in this rename so “the pack is the story.” Do not delete `add_future` so “the pack retired it.”

13. **This file never rewrites a Lead.** Leftover `cplCorrections.ts` (next pass) freezes reviewed ids and **asks** leftover `priceALeadDayFromThesePeriods`. Do not silently call leftover `priceTheLead` from a schedule write so “new prices flow back.” Do not move leftover corrections into this file so “one module owns CPL.”

14. **Leave sibling modules alone.** Leftover `withRegistryMutation`, leftover `priceTheLead`, leftover `cplCorrections.ts`, leftover fourteen-slot `getCplRate`, leftover Feed activate, leftover health findings, leftover `recordRegistryResolverAttempt`, and Wave B CPL HTTP are already the right **depth**. This file owns the live period book.

15. **Do not silently change persisted audit `action` or operation `type` strings.** `schedule_apply` and `add_future` / `split` / `correct_period` / `replace_schedule` are `OperationsRegistryChange` history and Wave B Zod. Story names live on the functions. Re-label those stored values only as a separate, tested change.

## Testing

The **interface** is the test surface: `showTheOwnerTheCurrentCplBook`, `sayWhetherThisBookCanGoLive`, `changeCplFromABusinessDate`, `applyOneAdvancedCplEdit`, `buildTheNextSimpleCplBook`, `buildTheNextAdvancedCplBook`, `priceALeadDayFromTheLiveBook`, `priceALeadDayFromThesePeriods`, leftover calendar/money exports leftover Lead and leftover corrections already **ask**.

Today’s `cplSchedule.test.ts` already names calendar DST, money precision, active vs inactive coverage, simple next-book no-op vs replace-forward, advanced add / split / correct / replace, Lead-day resolved-zero / missing / duplicate-zero / not-applicable, stale advanced revision with no writes, simple all-or-nothing gap before any increment, and simple unchanged-row skip (including stale expected revision). Keep that **interface**. Rename the tests to the operations. Do not add a model-index assertion as a sixth owner operation — leftover `CplRatePeriod.schema.indexes()` is Wave B schema evidence, not this story.

Prove the operations:

**Show / coverage**
- Missing Feed → `NOT_FOUND`. Shown book includes `revision` and unarchived periods only.
- Active book: contiguous periods + explicit zero + one open end succeed. Gap, overlap, or a closed final period → `CPL_SCHEDULE_GAP` / `CPL_SCHEDULE_OVERLAP`.
- Inactive book may contain a gap; reversed order still fails.

**Change from a date / one advanced edit**
- Owner simple change on two Feeds: validate both next books before any CAS. A gap on the second Feed increments neither and inserts neither.
- Unchanged amount → `{ changed: false, schedules: [] }`, even when `expected_revisions` is stale.
- Changed amount from a date closes the covering period at that New York midnight, drops later future periods, opens one new open-ended period, increments once, archives the replaced id, inserts the new row. Change `action: "schedule_apply"`. Caches `cpl` / `source_granularities` / `registry_health` forgotten **after** commit.
- Advanced stale revision → `STALE_REVISION` with `current_revision` + current book; incrementCalls 0; insertCalls 0.
- Advanced no-op (`correct_period` same cents, or constructed book equal) → `{ changed: false }`, no increment.
- Non-owner actor → `FORBIDDEN`. Duplicate Feed ids on simple → 400.
- Audit failure (leftover `withRegistryMutation` throw) aborts the write and does **not** invalidate caches. Prior Leads are untouched.

**Price a Lead day**
- Inclusive start / exclusive end: New York midnight of the exclusive end is the next period. Explicit zero is `resolved` with `period_id`.
- No Feed id or `applicable: false` → `not_applicable` (no store read).
- `duplicate: true` → `duplicate_zero` and `base_period_id` when exactly one covering row has an id.
- Zero covering rows or two overlapping covering rows → `missing_rate`. Do not pick the later row.
- Leftover `mapTheStoredEasternDayToNewYorkMidnight` turns a stored Eastern `Date` whose UTC Y/M/D is `2026-03-09` into `2026-03-09T04:00:00.000Z` (spring DST). Do not re-test leftover `priceTheLead` stamping here.

**Calendar / money**
- Spring DST 23-hour day and fall DST 25-hour day stay on leftover `newYorkMidnightFromABusinessDate`. Owner inclusive end is the next local midnight exclusive. Two-decimal money only; negatives and `1.005` stay `DEPENDENCY_CONFLICT` until a paired code change.

Do **not** add a test per helper (`coveringPeriodOrMissing`, `archiveReplacedRowsAndInsertNewOnes`, `parseBusinessDate`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`buildTheNextSimpleCplBook` / `buildTheNextAdvancedCplBook` stay exported because leftover tests and leftover writes share the next-book **adapter**, not because a test leaked. Leftover `priceTheLead` owns the Lead-stamp proof; leftover `cplCorrections` owns the rewrite proof; leftover `sayWhetherThisBookCanGoLive` owns the activate/health coverage proof — do **not** retest leftover fourteen-slot `getCplRate` here.

## What I would not do

- A `CplScheduleService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `withRegistryMutation`, leftover `priceTheLead`, or leftover `validateCplSchedule`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `period.ts`) for cleanliness.
- Breaking the mutation + Registry Change before-commit / cache-invalidate after-commit **seam**. A failed audit must not leave new periods and must not forget caches.
- Treating leftover fourteen-slot reads, leftover Lead snapshot stamping, leftover prior-Lead rewrite, leftover Feed activate, leftover health findings, leftover snapshot HTTP’s `now` covering find, Wave B CPL HTTP, M4 seed-row construction, or planned leftover `set_range` as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not rewrite prior Leads from a schedule write; do not use `createdAt`; do not `updateOne` a live period in place; do not `STALE_REVISION` an unchanged simple row; do not keep later future periods on a simple change so “edits are surgical”; do not route leftover snapshot through `resolveCpl`; do not change leftover activate’s `archived_at: { $exists: false }` filter; do not swap `DEPENDENCY_CONFLICT` on bad money without a paired test; do not `sort + limit 1` overlapping covering rows; do not add `set_range`; do not wrap leftover `resolveCplFromPeriods` in leftover resolver telemetry; do not switch leftover stored-timestamp mapping onto `Intl`; do not rename persisted `schedule_apply` / operation `type` / `CplResolution.status` strings; do not move leftover `priceTheLead` or leftover `cplCorrections.ts` into this file.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
