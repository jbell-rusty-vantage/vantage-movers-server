# Remember The Live CPL Period Row On The Selected Mongo Database, Store Integer Cents Plus New York Inclusive Starts And Exclusive Ends, And Index Feed Plus Start End And Archive Without Uniqueness — Never Price A Lead Or Rewrite Prior Leads Here, Never Unique-Index Feed Plus Start So Archive-Then-Insert Breaks, Never Flip Cents To Dollars So The Period Matches Fourteen-Slot, Never Delete The Getter Because Leftover Schedule Already Follows It — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 11 of this service — `CplRatePeriod.ts`
- Remaining in this service: `CplCorrectionJob.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/CplRatePeriod.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (`cplSchedule.ts` + `resolveCpl` are the writable CPL authority. Lead writes go through `leads/leadCplResolution.ts`. Knowledge resource list names Registry periods — do not add a Models Service file in this rename so “the Service sentence wins”). Compatibility rule: [`.cursor/rules/cpl-operations.mdc`](../../../.cursor/rules/cpl-operations.mdc) (`cpl_rate_periods` is the writable CPL authority. Legacy `cpl_rates` and embedded granularity CPL are **read-only migration compatibility data**. Owner inputs are `America/New_York` business dates. Store inclusive starts and next-local-midnight exclusive ends as UTC instants plus date strings. Store money as non-negative integer cents. Active schedules are continuous, non-overlapping, and end with exactly one open period. Use the granularity `schedule_revision` for optimistic concurrency. Schedule edits never rewrite prior Leads — **this file never prices a Lead**, never rewrites a Lead, never `$inc`s the Feed). Owner period write: already-recommended [operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md) (`listCplSchedule` / `applySimpleCplSchedule` / `mutateAdvancedCplSchedule` / `resolveCpl` **ask** `getCplRatePeriodModel` — archive replaced rows then insert; **this file never builds the next book**). Lead pricing: already-recommended [leads-cpl-resolution.md](leads-cpl-resolution.md) (**asks** leftover `resolveCpl` — **this file never stamps a Lead**). Leftover Feed activate: already-recommended [operations-registry-source-registry.md](operations-registry-source-registry.md) (**asks** the getter with `{ archived_at: { $exists: false } }` then leftover `validateCplSchedule` — **this file never activates**). Leftover health load: already-recommended [operations-registry-queries-health.md](operations-registry-queries-health.md) (**asks** the getter with `{ archived_at: { $exists: false } }` then leftover `validateCplSchedule` — leftover telemetry still names path `legacy_cpl_rates` for leftover fourteen-slot, **not** this collection). Leftover projection: already-recommended [operations-registry-queries-lead-source-projection.md](operations-registry-queries-lead-source-projection.md) (**asks** the getter the same `$exists: false` filter). Leftover prior-Lead rewrite: leftover next `cplCorrections.ts` (**asks** leftover `CPL_BUSINESS_TIME_ZONE` only — **this file never rewrites a Lead**). M4 cutover: `scripts/migrations/operations-registry-cpl-schedules.ts` **asks** the getter (`archived_at: null` snapshot + create) and leftover `CplRate.find` as the leftover dollar book — **this file never `dollarsToCents`**. Paid Overflow: `scripts/migrations/paid-overflow-source-registry.ts` **asks** the getter’s `countDocuments` `{ archived_at: { $exists: false } }`. Distinct from already-recommended leftover fourteen-slot: [models-cpl-rate.md](models-cpl-rate.md) (default-only `CplRate`; dollar `cpl`; unique `label`; **no** getter — **do not invent `getCplRateModel` so “fourteen-slot matches period”**, **do not flip `amount_cents` to dollars so “the period matches the slot”**). Distinct from already-recommended first-class Feed: [models-lead-source-granularity.md](models-lead-source-granularity.md) (unique immutable `granularity_key`; `schedule_revision` default `0` is the CAS — **this file snapshots revision `min: 1` and never `$inc`s**). Distinct from leftover next correction jobs: leftover next `CplCorrectionJob.ts` / `CplLeadCorrection.ts` (Owner rewrite of prior Leads; leftover correction snapshots `ref: "CplRatePeriod"` — **this file never writes a correction**). Distinct from already-recommended Form / Call rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md) (those files store `cpl_rate_period` `ref: "CplRatePeriod"` and set `autoIndex: false` — **do not copy that fence here**, **do not stamp a Lead snapshot here**). Distinct from leftover historical relax: this checkout has **no** `historical/CplRatePeriod.ts`. Leftover overview / leftover historical-consolidation validate **do not** ask this collection. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge does **not** define live CPL periods here; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model.** Leftover `operationsRegistry/cplSchedule.ts` **asks** `getCplRatePeriodModel` for leftover load (`archived_at: null`), leftover archive `$set`, leftover insert, leftover covering-period find (`archived_at: null`, `effective_from <= at`, open or `effective_until > at`, limit 2). Leftover `sourceRegistry.ts` activate **asks** the getter with `{ archived_at: { $exists: false } }`. Leftover `queries/health.ts` and leftover `queries/leadSourceProjection.ts` **ask** the getter the same `$exists: false` filter. Leftover `cplCorrections.ts` **asks** leftover `CPL_BUSINESS_TIME_ZONE` only. Leftover `cplSchedule.test.ts` **asks** default `CplRatePeriod.schema.indexes()` for the three leftover lookup compounds. Leftover `ownerLanguageDeck.test.ts` / leftover `leadSourceProjection.test.ts` **ask** the getter. Leftover M4 script **asks** the getter (`archived_at: null`). Leftover Paid Overflow **asks** the getter (`$exists: false` count). There is no `CplRatePeriod.test.ts`. Leftover overview **does not** import this file. Leftover historical-consolidation **does not** import this file. Already-recommended leftover `leadCplResolution.ts` **asks** leftover `resolveCpl`, **not** this model. Not this **interface**: leftover `listCplSchedule` itself, leftover `applySimpleCplSchedule` itself, leftover `mutateAdvancedCplSchedule` itself, leftover `resolveCpl` itself, leftover `validateCplSchedule` itself, leftover `dollarsToCents` itself.
- Seams callers need: default `CplRatePeriod` (first-registered connection — leftover getter same-db return, leftover `schema.indexes()` inspect) vs `getCplRatePeriodModel()` (selected `getMongoDatabaseName()` — leftover schedule write / leftover covering find, leftover health load, leftover projection, leftover activate load, leftover M4, leftover Paid Overflow count); leftover live-period filter `{ archived_at: null }` (leftover schedule store + leftover M4) vs leftover `{ archived_at: { $exists: false } }` (leftover health / leftover projection / leftover activate / leftover Paid Overflow); three leftover non-unique lookup compounds vs leftover `validateCplSchedule` continuity; immutable Feed ObjectId + immutable New York window vs leftover archive-then-insert (never `$set` `amount_cents`); leftover period `schedule_revision` `min: 1` snapshot vs leftover Feed `schedule_revision` default `0` CAS; leftover `amount_cents` integer cents vs already-recommended leftover dollar `cpl`; leftover `CPL_BUSINESS_TIME_ZONE` export vs leftover corrections / leftover projection / leftover M4 lib that import the constant without opening the collection; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Lead-pricing **seam**. There is no unique-period **seam**.
- Split later (only if the file outgrows one sitting): this ~116-line file is one sitting if you read it as remember the live CPL period row on the selected Mongo database, store integer cents plus New York inclusive starts and exclusive ends, and index Feed plus start end and archive without uniqueness — never price a Lead or rewrite prior Leads here, never unique-index Feed plus start so archive-then-insert breaks, never flip cents to dollars so the period matches fourteen-slot, never delete the getter because leftover schedule already follows it. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `cents.ts` / `dates.ts`. Leftover schedule write / leftover covering find stay already-recommended `cplSchedule.ts`. Leftover fourteen-slot dollars stay already-recommended `CplRate.ts`. Leftover Feed CAS stays already-recommended `LeadSourceGranularity.ts`. Leftover next correction jobs stay leftover `CplCorrectionJob.ts`.

`CplRatePeriod` is a Mongoose model name. The owner question is: *Owner just priced a Feed from a New York business date — or leftover health is about to walk every live period. Hold the row on `cpl_rate_periods`. Store cents as a non-negative safe integer. Store the New York inclusive start and exclusive end as a UTC instant plus a `YYYY-MM-DD` string. Keep `America/New_York` as the only leftover timezone. Index Feed plus start, Feed plus end, and Feed plus archive so leftover covering find / leftover load can walk the book — do not unique those compounds, because leftover archive-then-insert may keep the replaced start beside the new start. Snapshot `schedule_revision` on the row; leftover CAS still lives on the Feed. If this process selected a different Mongo database, hand back that database’s period model. Do not price a Lead. Do not rewrite a prior Lead. Do not `$inc` the Feed. Do not flip cents to dollars so “the period matches the slot.” Do not delete the getter so “period matches fourteen-slot.” Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who write the next book already lives in already-recommended `cplSchedule.ts`. Who price this Lead already lives in already-recommended `leadCplResolution.ts`. Who hold leftover fourteen-slot dollars already lives in already-recommended `CplRate.ts`. Who CAS-increment already lives in already-recommended `LeadSourceGranularity.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the live CPL period row, store integer cents plus New York inclusive starts and exclusive ends, and index Feed plus start end and archive without uniqueness” story, not “a CPL period model CRUD dump,” and not Price A Feed From New York Business Dates / Price A Lead Day themselves:

1. **Hold the live CPL period as the writable price-book row** — collection `cpl_rate_periods`, timestamps, `toJSON` / `toObject` virtuals. **No** virtuals declared. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** unique index. **No** dollar `cpl`. **No** string-slug `source_company`. **No** `label`. **No** `sheet_sync[]`. **No** Ingestion Origin. Declares required immutable `source_granularity` (ObjectId → leftover first-class Feed), required `amount_cents` (Number, `min: 0`, `Number.isSafeInteger` — **integer cents**, **not** leftover dollars), required immutable `effective_from` (Date), optional immutable `effective_until` (Date — omit only for the open last period), required immutable `effective_from_date` (`YYYY-MM-DD`), optional immutable `effective_until_date_exclusive` (`YYYY-MM-DD`), required immutable `business_timezone` (enum leftover `CPL_BUSINESS_TIME_ZONE` = `America/New_York`, default that constant), required `schedule_revision` (`min: 1`, safe integer — **snapshot**, not the leftover Feed CAS), optional immutable `supersedes` (self-ref), optional `change_reason`, optional `archived_at` (Date — leftover archive `$set`s this; leftover insert omits it), required immutable nested `created_by` (`actor_type` `owner` | `admin` | `system`, plus leftover id / label / role). This beat does **not** invent `effective_from` from `effective_from_date`. This beat does **not** `$set` `amount_cents` after insert. This beat does **not** convert dollars. A leftover schedule write may still refuse when leftover `validateCplSchedule` sees overlap.

2. **Index Feed plus start, Feed plus end, and Feed plus archive — without uniqueness** — leftover `{ source_granularity: 1, effective_from: 1 }`. Leftover `{ source_granularity: 1, effective_until: 1 }`. Leftover `{ source_granularity: 1, archived_at: 1 }`. None are unique. None are named. None have a leftover `pnpm migration:*` apply path. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Leftover `cplSchedule.test.ts` leftover inspects leftover `CplRatePeriod.schema.indexes()` leftover for leftover those leftover three leftover compounds. Leftover archive-then-insert **keeps** the replaced row (`archived_at` stamped) beside the new row that may share `effective_from`. A unique `{ source_granularity, effective_from }` would refuse leftover `correct_period` / leftover `split` / leftover simple replace-forward. Continuity / no-overlap / exactly-one-open-end live on leftover `validateCplSchedule`, not here. This beat does **not** unique-index `amount_cents`. This beat does **not** unique-index `schedule_revision`.

3. **Bind the selected Mongo database** — default export `CplRatePeriod` is `mongoose.models.CplRatePeriod ?? mongoose.model(...)`. `getCplRatePeriodModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Leftover schedule write / leftover covering find, leftover health load, leftover projection, leftover activate load, leftover M4, leftover Paid Overflow count **ask** the getter. Leftover `schema.indexes()` inspect **asks** the default. This beat does **not** open `vantagemovershistorical`. This beat does **not** call `syncIndexes`. This beat does **not** invent `getCplRateModel` on already-recommended leftover fourteen-slot.

`CplRatePeriodDocument` is the inferred row type plus `_id`. `CPL_BUSINESS_TIME_ZONE` is the leftover New York constant leftover corrections / leftover projection / leftover M4 lib **ask** without opening the collection. There is no unknown-state sentinel here. There is no named-index export.

There is no leftover-schedule-write operation. Leftover `cplSchedule.ts` elects that. There is no leftover-Lead-price operation. Leftover `leadCplResolution.ts` elects that. There is no leftover-fourteen-slot operation. Already-recommended leftover `CplRate.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the live CPL period row on the selected Mongo database, store integer cents plus New York inclusive starts and exclusive ends, and index Feed plus start end and archive without uniqueness — never price a Lead or rewrite prior Leads here, never unique-index Feed plus start so archive-then-insert breaks, never flip cents to dollars so the period matches fourteen-slot, never delete the getter because leftover schedule already follows it.” Leftover schedule write / leftover covering find / leftover Lead pricing / leftover Feed CAS / leftover fourteen-slot dollars already live in deeper **modules**. Leftover next correction jobs already live in a sibling **module**. Do not pull those in. Do not invent a `CplRatePeriodModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: false` **adapter** so “period matches Booking” without a reviewed index migration. Do not invent a unique `{ source_granularity, effective_from }` **adapter** so “schema uniqueness matches leftover continuity.” Do not invent a `pre("validate")` that stamps `effective_from` from `effective_from_date` so “hand insert matches leftover `businessDateToUtc`.” Do not invent a dollar `cpl` field so “the period matches the slot.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `cents.ts` / `dates.ts` / `normalize.ts` each get a file.

Do not move leftover `businessDateToUtc` into this file so “the row owns the New York midnight.” Do not merge this file into already-recommended leftover `CplRate.ts` so “one schema owns leftover dollars and leftover cents.” Do not merge this file into already-recommended leftover Feed so “the Feed owns leftover cents.” Do not merge this file into leftover next `CplCorrectionJob.ts` so “one schema owns the live book and the prior-Lead rewrite.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `CplRatePeriod` | `livePeriodOnTheDefaultConnection` | leftover getter same-db return and leftover `schema.indexes()` inspect still import the default model |
| `getCplRatePeriodModel` | `livePeriodOnTheSelectedMongoDatabase` | leftover schedule write / leftover covering find, leftover health load, leftover projection, leftover activate load, leftover M4, leftover Paid Overflow count must follow `getMongoDatabaseName()` |
| `CplRatePeriodDocument` | `LiveCplPeriodRow` | inferred document + `_id` |
| `CPL_BUSINESS_TIME_ZONE` | `newYorkCplBusinessTimeZone` | leftover schedule, leftover activate mapping, leftover corrections, leftover projection, leftover M4 lib share one New York constant |

Keep the old names as one-line aliases until leftover `cplSchedule.ts`, leftover health, leftover projection, leftover activate, leftover M4, leftover Paid Overflow, leftover `cplSchedule.test.ts`, and leftover corrections migrate. Do not make callers learn `amount_cents` / `useDb` / `effective_until_date_exclusive` as the domain language. Do **not** delete the default `CplRatePeriod` export so “everyone must call the getter” without a paired proof that leftover getter same-db still returns the leftover uniques leftover `schema.indexes()` leftover inspects today. Do **not** delete the getter so “period matches fourteen-slot” without a paired proof that leftover schedule and leftover M4 still write/load the selected `cpl_rate_periods`. Do **not** re-export already-recommended leftover `CplRate` from this file so “one type owns leftover dollars and leftover cents.”

**No class for the workflow.** The one type that *does* earn a name is the pending live-period identity contract:

```ts
type LiveCplPeriodIdentity = {
  source_granularity: { immutable: true; objectId: true }
  amount_cents: { integer: true; min: 0 }
  window: {
    effective_from: { immutable: true }
    effective_until?: { immutable: true }
    effective_from_date: { yyyyMmDd: true; immutable: true }
    effective_until_date_exclusive?: { yyyyMmDd: true; immutable: true }
    business_timezone: "America/New_York"
  }
  schedule_revision: { min: 1; snapshot: true }
  lookup_indexes: { unique: false }
}
```

That is the handoff from “this process remembered a live period” to “leftover schedule can archive-then-insert, leftover covering find can walk Feed plus start, and leftover CAS still lives on the Feed.” Do **not** add `{ source_granularity_effective_from: { unique: true } }` onto that type so “continuity lives on the schema.” Do **not** add `{ amount_cents: { dollars: true } }` so “money matches fourteen-slot.”

Leave leftover next `CplCorrectionJob.ts` on that file. Leave leftover next `CplLeadCorrection.ts` on that file. Leave already-recommended leftover `CplRate.ts` on that file. Leave leftover `schedule_revision` CAS on already-recommended leftover Feed.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// CplRatePeriod.ts
// Owner just priced a Feed from a New York business date —
// or leftover health is about to walk every live period.
// Hold the row on cpl_rate_periods.
// Store cents as a non-negative safe integer.
// Store the New York inclusive start and exclusive end
// as a UTC instant plus a YYYY-MM-DD string.
// Keep America/New_York as the only leftover timezone.
// Index Feed plus start, Feed plus end, and Feed plus archive
// so leftover covering find / leftover load can walk the book —
// do not unique those compounds,
// because leftover archive-then-insert may keep
// the replaced start beside the new start.
// Snapshot schedule_revision on the row;
// leftover CAS still lives on the Feed.
// If this process selected a different Mongo database,
// hand back that database's period model.
// Do not price a Lead.
// Do not rewrite a prior Lead.
// Do not $inc the Feed.
// Do not flip cents to dollars
// so "the period matches the slot."
// Do not delete the getter
// so "period matches fourteen-slot."
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const newYorkCplBusinessTimeZone = "America/New_York" as const
export { newYorkCplBusinessTimeZone as CPL_BUSINESS_TIME_ZONE }

export const livePeriodOnTheDefaultConnection =
  mongoose.models.CplRatePeriod ??
  mongoose.model("CplRatePeriod", liveCplPeriodSchema)

export { livePeriodOnTheDefaultConnection as CplRatePeriod }

export function livePeriodOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) return livePeriodOnTheDefaultConnection
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return db.models.CplRatePeriod ?? db.model("CplRatePeriod", liveCplPeriodSchema)
}

export { livePeriodOnTheSelectedMongoDatabase as getCplRatePeriodModel }

// ── 1. Hold the live CPL period row ───────────────────────

const liveCplPeriodSchema = rememberTheLiveCplPeriodRow() // collection cpl_rate_periods; default autoIndex; cents not dollars

function rememberTheLiveCplPeriodRow() {
  const schema = new Schema(
    {
      source_granularity: requiredImmutableFeedObjectId(),   // not string slug
      amount_cents: requiredNonNegativeSafeIntegerCents(),   // not leftover cpl dollars
      effective_from: requiredImmutableUtcInstant(),
      effective_until: optionalImmutableUtcInstant(),        // omit on the open last period
      effective_from_date: requiredImmutableYyyyMmDd(),
      effective_until_date_exclusive: optionalImmutableYyyyMmDd(),
      business_timezone: requiredImmutableNewYork(),
      schedule_revision: requiredPositiveSafeIntegerSnapshot(), // min 1; CAS lives on the Feed
      supersedes: optionalImmutableSelfRef(),
      change_reason: optionalTrimmedReason(),
      archived_at: optionalArchiveStamp(),                   // insert omits; leftover archive $sets
      created_by: requiredImmutableActorSnapshot(),          // owner | admin | system
    },
    { collection: "cpl_rate_periods", timestamps: true },
  )
  indexFeedPlusStartEndAndArchiveWithoutUniqueness(schema)
  return schema
}

// ── 2. Lookup indexes, not uniqueness ─────────────────────

function indexFeedPlusStartEndAndArchiveWithoutUniqueness(schema) {
  // today's { source_granularity, effective_from }
  // today's { source_granularity, effective_until }
  // today's { source_granularity, archived_at }
  // none unique, none named
}

// ── 3. Selected Mongo database ────────────────────────────

// livePeriodOnTheSelectedMongoDatabase above
```

Read the primary path out loud: *hold the live CPL period on `cpl_rate_periods` with a required immutable Feed ObjectId, required non-negative integer cents, a required immutable New York inclusive start (UTC plus `YYYY-MM-DD`), an optional immutable exclusive end, required `America/New_York`, a required revision snapshot `min: 1`, and a required immutable actor snapshot. Index Feed plus start, Feed plus end, and Feed plus archive without uniqueness so leftover archive-then-insert can keep the replaced start. Today’s leftover schedule write / leftover covering find / leftover health / leftover projection / leftover activate / leftover M4 / leftover Paid Overflow still ask the getter. Leftover `schema.indexes()` inspect still asks the default. Do not price a Lead. Do not rewrite a prior Lead. Do not unique-index Feed plus start. Do not flip cents to dollars.*

That is the operation. An unnamed schema dump is not. `applySimpleCplSchedule` is not here.


## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **Two live-period filters are two answers.** Schedule store and M4 find `{ archived_at: null }` (Mongo matches missing and explicit null). Health, projection, activate, and Paid Overflow find `{ archived_at: { $exists: false } }` (missing only). Today's insert omits `archived_at`; archive `$set`s a Date, so both filters elect the same happy path. Do not add a schema default `archived_at: null` so "every live row has the field" without a paired proof that `$exists: false` callers still see those rows. Do not fix health onto `null` in this rename. That is health / schedule interfaces, not this one.

2. **The three indexes are lookup, not uniqueness — and that is today's archive-then-insert contract.** `correct_period` / `split` / simple replace-forward archive the replaced row then insert a successor that may share `effective_from`. A unique `{ source_granularity, effective_from }` would 11000 that write. Continuity lives on `validateCplSchedule`. Do not unique those compounds so "schema uniqueness matches leftover continuity." Do not drop the `archived_at` compound so "start and end are enough."

3. **`amount_cents` is integer cents. Already-recommended leftover `cpl` is dollars.** `Number.isSafeInteger` plus `min: 0`. Explicit zero is a real rate (`resolveCpl` says `resolved`, not missing). M4 `dollarsToCents(legacy.cpl)` later onto this field. Do not rename `amount_cents` to `cpl` so "the period matches the slot" — M4 would store `190` cents instead of `19000`. Do not drop `Number.isSafeInteger` so "money matches fourteen-slot."

4. **`amount_cents` is not schema-immutable — and leftover schedule never `$set`s it.** Window fields are immutable. Correction archives then inserts with `supersedes`. Do not mark `amount_cents` immutable so "every money field matches the window" without a paired proof that `correct_period` still inserts a new row (it does today). Do not add an in-place `$set amount_cents` so "correction is cheaper."

5. **Period `schedule_revision` is a snapshot (`min: 1`). Feed `schedule_revision` is the CAS (`default: 0`).** `$inc` lives on already-recommended `compareAndIncrementRevision`. Insert stamps the new revision onto the period. Do not `$inc` from this file so "the period owns leftover concurrency." Do not default this field to `0` so "period matches Feed."

6. **There is a getter — and that is today's contract, not a missing fourteen-slot copy.** Schedule, health, projection, activate, M4, and Paid Overflow ask `getCplRatePeriodModel`. Already-recommended leftover fourteen-slot asks default `CplRate` and has no getter. Do not delete `getCplRatePeriodModel` so "period matches fourteen-slot." Do not invent `getCplRateModel` on that sibling from this rename.

7. **Default `CplRatePeriod` still earns its export.** Getter same-db path returns it. `cplSchedule.test.ts` inspects `CplRatePeriod.schema.indexes()`. Overview and historical-consolidation do not ask this collection. Do not delete the default so "everyone must call the getter" without a paired indexes proof. Do not add an overview count so "every leftover book sits on the shelf." Do not add historical-consolidation validate so "every catalog row has a planned-insert proof."

8. **`source_granularity` is a Feed ObjectId, not a company slug.** Already-recommended leftover fourteen-slot `source_company` is a lowercase string. Do not change this field to a string slug so "period matches fourteen-slot."

9. **New York is two clocks plus one enum.** UTC instants plus `YYYY-MM-DD` strings. Timezone enum is only `America/New_York`. `CPL_BUSINESS_TIME_ZONE` is the constant corrections and M4 lib ask without opening the collection. Do not drop the date strings so "one clock is enough." Do not add extra timezones so "the schema matches every TZ." Do not move `businessDateToUtc` into this file.

10. **This file still uses default `autoIndex`.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed migrations. The three compounds here are not named. Do not silently set `autoIndex: false` so "period matches Booking" without a paired report that boot still creates the lookup indexes or that a migration will. Do not invent `pnpm migration:cpl-rate-period-indexes` in this rename.

11. **Leave sibling modules alone.** Schedule write / covering find, Lead pricing, Feed CAS, fourteen-slot dollars, health `$exists: false` load, M4 `dollarsToCents`, next correction jobs, and already-recommended Form / Call `cpl_rate_period` refs are already the right depth. This file holds the live period row.

## Testing

The interface is the test surface: `CplRatePeriod` validate, `getCplRatePeriodModel`, `CPL_BUSINESS_TIME_ZONE`, and the three lookup compounds.

There is no `CplRatePeriod.test.ts`. Today's proofs sit on callers. `cplSchedule.test.ts` already names calendar DST, money precision, coverage, and inspects `CplRatePeriod.schema.indexes()` for the three compounds. Keep that as the operation proof on that interface.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new period requires `source_granularity`, `amount_cents`, `effective_from`, `effective_from_date`, `business_timezone`, `schedule_revision`, and `created_by`.
- `effective_until` and `effective_until_date_exclusive` are optional.
- `amount_cents` accepts `0` and `19000` and refuses `-1` and `1.5`.
- `amount_cents` requires `Number.isSafeInteger`.
- `schedule_revision` accepts `1` and refuses `0`.
- `business_timezone` accepts only `America/New_York`.
- `effective_from_date` accepts `2026-07-29` and refuses `2026/07/29`.
- Validate does not invent `effective_from` from `effective_from_date`.
- There is no dollar `cpl` path.
- There is no string-slug `source_company` path.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.

**Lookup indexes**
- `{ source_granularity, effective_from }` is declared and is not unique.
- `{ source_granularity, effective_until }` is declared and is not unique.
- `{ source_granularity, archived_at }` is declared and is not unique.
- None of those compounds are named.

**Selected database**
- Default `CplRatePeriod` remains exported.
- `getCplRatePeriodModel` remains exported.
- `CPL_BUSINESS_TIME_ZONE` remains `"America/New_York"`.

Do not add a test per helper (`requiredNonNegativeSafeIntegerCents`, `indexFeedPlusStartEndAndArchiveWithoutUniqueness`). Those names exist so the parent reads. Do not leftover-schedule-write from this file's tests. Do not leftover `resolveCpl` from this file's tests. Do not leftover `dollarsToCents` from this file's tests. Do not leftover `syncIndexes` in the unit file so "the test creates the leftover lookup indexes."

There is no leftover named-index export to keep for a second leftover migration adapter.

## What I would not do

- A `CplRatePeriodModelService` / `CplRatePeriodService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `cents.ts` / `dates.ts` / `normalize.ts` split for cleanliness.
- Inventing a unique `{ source_granularity, effective_from }` seam so "schema uniqueness matches leftover continuity." Archive-then-insert must not 11000.
- Breaking the selected-database seam by deleting `getCplRatePeriodModel` without a paired proof. Leftover schedule and leftover M4 must not write/load live `cpl_rate_periods` while `TEST_MODE` selected `testvantagemovers` unless today's getter callers already do that — they do.
- Breaking the default-connection seam by deleting `CplRatePeriod` without a paired proof that leftover getter same-db and leftover `schema.indexes()` still see the leftover lookup compounds.
- Treating leftover `listCplSchedule` / leftover `applySimpleCplSchedule` / leftover `mutateAdvancedCplSchedule` as this story. Those functions own leftover next-book build, leftover CAS, leftover archive-then-insert, and leftover Registry Change.
- Treating leftover `resolveCpl` / leftover `leadCplResolution` as this story. Those functions own leftover Lead-day price.
- Treating leftover `validateCplSchedule` as this story. That function owns leftover continuity.
- Treating leftover M4 `dollarsToCents` / leftover `resolveAmountAuthority` as this story. Those functions own leftover cutover cents.
- Treating already-recommended leftover `CplRate.ts` as this story. That leftover dollar unique is the leftover fourteen-slot book.
- Treating leftover next `CplCorrectionJob.ts` as this story. That leftover job rewrites prior Leads.
- Inventing a dollars seam so "the period matches the slot."
- Inventing an `autoIndex: false` adapter that has only "matches Booking" as its second home.
- Inventing a unique-period adapter that has only "matches leftover continuity" as its second home.
- Silently adding a leftover overview count so "every leftover book sits on the shelf."
- Silently enabling leftover `optimisticConcurrency` so "period matches Booking."
- Silently "fixing" a leftover ADR while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
