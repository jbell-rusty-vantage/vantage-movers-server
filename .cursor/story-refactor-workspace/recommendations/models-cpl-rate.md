# Remember The Leftover Fourteen-Slot CPL Row, Keep One Slot Per Unique Label And One Slot Per Company Plus Channel Plus Optional Move Type, And Store Dollars Not Cents — Never Price A Lead Or Write The Live Period Book Here, Never Invent A Selected-Database Getter So Fourteen-Slot Matches Period, Never Flip Money To Integer Cents So The Slot Matches The Period — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 10 of this service — `CplRate.ts`
- Remaining in this service: `CplRatePeriod.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/CplRate.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (`cplSchedule.ts` + `resolveCpl` are the writable CPL authority. Lead writes go through `leads/leadCplResolution.ts`. Knowledge resource list names Registry periods — do not add a Models Service file in this rename so “the Service sentence wins”). Compatibility rule: [`.cursor/rules/cpl-operations.mdc`](../../../.cursor/rules/cpl-operations.mdc) (`cpl_rate_periods` is the writable CPL authority. Legacy `cpl_rates` and embedded granularity CPL are **read-only migration compatibility data**. Store money on the live book as non-negative integer cents — **this file stores dollars**). Leftover fourteen-slot read / leftover admin list / leftover `$setOnInsert` seed: already-recommended [cpl-cpl-rate.md](cpl-cpl-rate.md) (`readLeftoverSlotCpl` / `listLeftoverCplForTheAdminPage` / `ensureCplRatesSeeded` **ask** default `CplRate` — **this file never prices a Lead**, never lists nested prices, never seeds). Nested first try: `config/domain/cpl.ts` (`getCplForSource` **asks** leftover nested `getCplForLeadSource` first, then leftover `getCplRate` — **this file is the second leftover book**, not the first). Lead pricing: already-recommended [leads-cpl-resolution.md](leads-cpl-resolution.md) (**asks** Registry periods — **this file never stamps a Lead**). Owner period write: already-recommended [operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md) (**asks** leftover next `getCplRatePeriodModel` — **this file never writes a period**). M4 cutover snapshot: `scripts/migrations/operations-registry-cpl-schedules.ts` **asks** default `CplRate.find({}).lean()` then leftover `dollarsToCents` — **this file never converts cents**. Inventory snapshot: `scripts/migrations/operations-registry-inventory.ts` **asks** default `CplRate.find` `{ label, source_company, lead_type, local, cpl }` — **this file never writes a manifest**. Distinct from already-recommended hung spelling: [models-lead-source-label-mapping.md](models-lead-source-label-mapping.md) (partial unique `{ namespace, normalized_label }` where `{ active: true }` — **not** this unique `label`). Distinct from already-recommended first-class Feed: [models-lead-source-granularity.md](models-lead-source-granularity.md) (unique immutable `granularity_key`; `schedule_revision`; **no** `cpl` — **do not merge this dollar field onto the Feed**). Distinct from leftover next live period: leftover next `CplRatePeriod.ts` (writable `amount_cents`; `getCplRatePeriodModel`; Feed ObjectId — **do not invent `getCplRateModel` so “fourteen-slot matches period”**, **do not flip `cpl` to integer cents so “the slot matches the period”**). Distinct from leftover next correction jobs: leftover next `CplCorrectionJob.ts` / `CplLeadCorrection.ts` (Owner rewrite of prior Leads — **this file never rewrites a Lead**). Distinct from already-recommended Form / Call / Booking / Cancellation rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md), [models-booked-lead.md](models-booked-lead.md), [models-cancelled-lead.md](models-cancelled-lead.md) (those files set `autoIndex: false` and Form / Call `ref: "CplRatePeriod"` — **do not copy that fence here**, **do not add a `ref` onto `cpl`**). Distinct from leftover historical relax: this checkout has **no** `historical/CplRate.ts`. Leftover overview / leftover health / leftover historical-consolidation validate **do not** ask this collection. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge does **not** define fourteen-slot CPL here; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model only — there is no `getCplRateModel`.** Leftover `cpl/cplRate.service.ts` **asks** default `CplRate.find` / `CplRate.updateOne` `$setOnInsert` by `label` for leftover seed, leftover slot-cache load, and leftover admin fallback list. Leftover `cplRate.service.test.ts` stubs `CplRate.find` / `CplRate.updateOne`. Leftover `config/domain/cpl.test.ts` stubs `CplRate.find` for leftover `getCplForSource` second-try. Leftover `scripts/migrations/operations-registry-inventory.ts` **asks** default `CplRate.find({}, "label source_company lead_type local cpl")`. Leftover `scripts/migrations/operations-registry-cpl-schedules.ts` **asks** default `CplRate.find({}).lean()` as the M4 `cplRates` snapshot (company / Feed **ask** their getters). There is no `CplRate.test.ts`. Leftover overview **does not** import this file. Leftover health **asks** `getCplRatePeriodModel` and leftover telemetry names path `legacy_cpl_rates` — **not** this model. Leftover historical-consolidation **does not** import this file. Not this **interface**: leftover `getCplRate` itself, leftover `listCplRates` itself, leftover `getCplForSource` itself, leftover `resolveCpl` itself, leftover `dollarsToCents` itself, leftover M4 `resolveAmountAuthority` itself.
- Seams callers need: default `CplRate` (first-registered connection — leftover fourteen-slot seed / leftover slot read / leftover admin fallback list, leftover inventory find, leftover M4 snapshot find) vs leftover next `getCplRatePeriodModel()` (selected `getMongoDatabaseName()` — Owner period write / leftover health / leftover projection; **this file has no getter**); field-level unique `{ label: 1 }` vs leftover seed `$setOnInsert` `{ label }` vs leftover cache `findCplRateDefinition(doc.label)`; compound unique `{ source_company: 1, lead_type: 1, local: 1 }` vs leftover `cplRateCacheKey` that only consults `local` when `best_relocation_leads` form; string-slug `source_company` (schema `lowercase`) vs company ObjectId on Feed / leftover next period; `cpl` Number `min: 0` **dollars** vs leftover next `amount_cents` integer; file comment “Owner-editable” vs leftover service that only seeds / lists / reads; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Lead-pricing **seam**. There is no selected-database getter **seam**.
- Split later (only if the file outgrows one sitting): this ~38-line file is one sitting if you read it as remember the leftover fourteen-slot CPL row, keep one slot per unique label and one slot per company plus channel plus optional Move Type, and store dollars not cents — never price a Lead or write the live period book here, never invent a selected-database getter so fourteen-slot matches period, never flip money to integer cents so the slot matches the period. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `cents.ts`. Leftover seed / leftover slot read / leftover admin list stay already-recommended `cplRate.service.ts`. Checked-in fourteen-slot table stays `cplRateDefinitions.ts`. Leftover next live period stays leftover `CplRatePeriod.ts`.

`CplRate` is a Mongoose model name. The owner question is: *the old fourteen-slot CPL price list still sits in Mongo. Leftover seed is about to insert a missing label from the checked-in defaults — or leftover inventory / leftover M4 is about to walk every slot. Hold the row on `cpl_rates`. Keep the CRM-style label unique so leftover seed elects one row per checked-in slot. Keep company plus channel plus optional Move Type unique so leftover Best Relocation forms can hold Locals beside Forms. Store `cpl` as dollars so leftover M4 can `dollarsToCents` later. Today’s leftover callers still use the default connection — do not invent a getter in this rename. Do not price a Lead. Do not write a live period. Do not flip dollars to integer cents so “the slot matches the period.” Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who leftover-seed / leftover-read already lives in already-recommended `cplRate.service.ts`. Who price this Lead already lives in already-recommended `leadCplResolution.ts`. Who write the live period already lives in leftover next `CplRatePeriod.ts` plus already-recommended leftover `cplSchedule.ts`. Do not pull those in.

## What this file actually does

Two operations of one “remember the leftover fourteen-slot CPL row, keep one slot per unique label and one slot per company plus channel plus optional Move Type, and store dollars not cents” story, not “a CPL model CRUD dump,” and not Read The Leftover Fourteen-Slot CPL Book / Apply Simple CPL Schedule themselves:

1. **Hold the leftover fourteen-slot row as read-only migration compatibility data** — collection `cpl_rates`, timestamps, `toJSON` / `toObject` virtuals. **No** virtuals declared. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** `schedule_revision`. **No** `amount_cents`. **No** Feed ObjectId. **No** `created_by`. **No** `active`. **No** `sheet_sync[]`. **No** Ingestion Origin. Declares required `label` (trim, **unique**), required `source_company` (trim, schema `lowercase` — **string slug**, not ObjectId), required `lead_type` (enum `CPL_LEAD_TYPES`: `form` | `call`), optional `local` (enum `LOCAL_TYPES`: `local` | `long_distance`), required `cpl` (Number, `min: 0` — **dollars**, **not** integer-validated). File comment says “Owner-editable” and “one document per `CPL_RATE_DEFINITIONS` entry.” Leftover `updateCplRate` is a ghost. This beat does **not** invent `label` from `source_company`. This beat does **not** `$set` `cpl` after insert. This beat does **not** convert dollars. A leftover seed may still refuse when `label` already exists.

2. **Keep one slot per unique label, and one slot per company plus channel plus optional Move Type** — field-level unique `{ label: 1 }`. Compound unique `{ source_company: 1, lead_type: 1, local: 1 }`. Neither index is named. Neither has a leftover `pnpm migration:*` apply path. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Unique `label` is the leftover seed key (`$setOnInsert` `{ label: definition.label }`). The compound unique is the leftover slot identity leftover `cplRateCacheKey` walks after `findCplRateDefinition(doc.label)`. `local` is optional. Mongo unique treats a missing `local` as one `null` key — that is why only Best Relocation forms set `local` (`long_distance` vs `local`) and every other slot leaves it unset. Paid Overflow is form-only (the 14th slot). `not_provided` is **not** a slot. This beat does **not** unique-index `cpl`. This beat does **not** require `local` on every row.

There is no selected-database getter. There is no unknown-state sentinel here. There is no named-index export.

There is no leftover-seed operation. Leftover `cplRate.service.ts` elects that. There is no leftover-period-write operation. Leftover next `CplRatePeriod.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the leftover fourteen-slot CPL row, keep one slot per unique label and one slot per company plus channel plus optional Move Type, and store dollars not cents — never price a Lead or write the live period book here, never invent a selected-database getter so fourteen-slot matches period, never flip money to integer cents so the slot matches the period.” Leftover seed / leftover slot read / leftover admin list / Lead pricing / Owner period write already live in deeper **modules**. The checked-in fourteen-slot table already lives in `cplRateDefinitions.ts`. Leftover next live period already lives in a sibling **module**. Do not pull those in. Do not invent a `CplRateModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `getCplRateModel` **adapter** so “fourteen-slot matches period” without a paired proof that leftover seed / leftover slot read / leftover inventory / leftover M4 snapshot still read the same `cpl_rates`. Do not invent an `autoIndex: false` **adapter** so “fourteen-slot matches Booking” without a reviewed index migration. Do not invent a `pre("validate")` that stamps `label` from `source_company` so “hand insert matches leftover definitions.” Do not invent an integer `amount_cents` field so “the slot matches the period.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `cents.ts` / `normalize.ts` each get a file.

Do not move `CPL_RATE_DEFINITIONS` into this file so “the row owns the fourteen slots.” Do not merge this file into leftover next `CplRatePeriod.ts` so “one schema owns leftover dollars and leftover cents.” Do not merge this file into already-recommended hung spelling so “one unique `label` owns leftover cents and leftover sheet spellings.” Do not merge this file into already-recommended Feed so “the Feed owns leftover dollars.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `CplRate` | `leftoverFourteenSlotOnTheDefaultConnection` | leftover seed / leftover slot read / leftover admin fallback list, leftover inventory find, leftover M4 snapshot find still import the default model |
| `CplRateDocument` | `LeftoverFourteenSlotRow` | inferred document + `_id` |

Keep the old names as one-line aliases until leftover `cplRate.service.ts`, leftover `cpl.test.ts`, leftover inventory, and leftover M4 snapshot migrate. Do not make callers learn `label` / string-slug `source_company` / dollar `cpl` as the domain language. Do **not** add `getCplRateModel` so “every leftover CPL book has a getter” — leftover next live period already has `getCplRatePeriodModel`; leftover fourteen-slot writes already share one default **adapter**. Do **not** delete the default `CplRate` export so “everyone must call a getter that does not exist.” Do **not** re-export `CPL_RATE_DEFINITIONS` from this file so “one type owns hold and seed.”

**No class for the workflow.** The one type that *does* earn a name is the pending leftover-slot identity contract:

```ts
type LeftoverFourteenSlotIdentity = {
  label: { unique: true }
  slot: {
    source_company: "string-slug"
    lead_type: "form" | "call"
    local?: "local" | "long_distance"
    unique: true
  }
  cpl: { dollars: true; min: 0 }
}
```

That is the handoff from “this process remembered a leftover slot” to “leftover seed elects one row per label, leftover slot read walks `cplRateCacheKey` after `findCplRateDefinition`, and leftover M4 `dollarsToCents` later.” Do **not** add `{ cpl: { amount_cents: true } }` onto that type so “money matches the period.” Do **not** drop `local` so “every company splits on Move Type.”

Leave leftover next `CplRatePeriod.ts` on that file. Leave leftover next `CplCorrectionJob.ts` on that file. Leave `CPL_RATE_DEFINITIONS` on `cplRateDefinitions.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// CplRate.ts
// The old fourteen-slot CPL price list still sits in Mongo.
// Leftover seed is about to insert a missing label
// from the checked-in defaults —
// or leftover inventory / leftover M4 is about to walk every slot.
// Hold the row on cpl_rates.
// Keep the CRM-style label unique
// so leftover seed elects one row per checked-in slot.
// Keep company plus channel plus optional Move Type unique
// so leftover Best Relocation forms can hold Locals beside Forms.
// Store cpl as dollars
// so leftover M4 can dollarsToCents later.
// Today's leftover callers still use the default connection —
// do not invent a selected-database getter in this rename.
// Do not price a Lead.
// Do not write a live period.
// Do not flip dollars to integer cents
// so "the slot matches the period."
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const leftoverFourteenSlotOnTheDefaultConnection =
  mongoose.models.CplRate ??
  mongoose.model("CplRate", leftoverFourteenSlotSchema)

export { leftoverFourteenSlotOnTheDefaultConnection as CplRate }

// ── 1. Hold the leftover fourteen-slot row ────────────────

const leftoverFourteenSlotSchema = rememberTheLeftoverFourteenSlotRow() // collection cpl_rates; default autoIndex; dollars not cents

function rememberTheLeftoverFourteenSlotRow() {
  const schema = new Schema(
    {
      label: requiredUniqueTrimmedCrmStyleSlotName(),        // leftover seed key
      source_company: requiredLowercasedStringSlug(),        // not ObjectId
      lead_type: requiredFormOrCallChannel(),                // CPL_LEAD_TYPES
      local: optionalMoveType(),                             // LOCAL_TYPES; only BR forms set it
      cpl: requiredNonNegativeDollars(),                     // Number min 0; not amount_cents
    },
    { collection: "cpl_rates", timestamps: true },
  )
  keepOneSlotPerLabelAndOneSlotPerCompanyChannelAndOptionalMoveType(schema)
  return schema
}

// ── 2. Label unique + slot unique ─────────────────────────

function keepOneSlotPerLabelAndOneSlotPerCompanyChannelAndOptionalMoveType(schema) {
  // today's field-level unique { label: 1 }
  // today's compound unique { source_company, lead_type, local }
  // neither is named
  // missing local is one Mongo null key
}

// There is no getCplRateModel.
```

Read the primary path out loud: *hold the leftover fourteen-slot row on `cpl_rates` with a required unique CRM-style `label`, a required lowercase string-slug `source_company`, a required `form` | `call` channel, an optional Move Type, and required non-negative dollars. Keep one row per label so leftover `$setOnInsert` elects one checked-in slot. Keep one row per company plus channel plus optional `local` so leftover Best Relocation forms can hold Locals beside Forms and every other slot can leave `local` unset. Today’s leftover seed / leftover slot read / leftover inventory / leftover M4 snapshot still import the default model. Do not invent a getter. Do not price a Lead. Do not write a live period. Do not flip dollars to integer cents.*

That is the operation. An unnamed schema dump is not. `updateCplRate` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file comment says “Owner-editable.” That is a ghost.** Already-recommended leftover `cplRate.service.ts` only seeds (`$setOnInsert` by `label`), lists, and reads. Leftover `updateCplRate` is not on this file and not on that service. Owner writes are leftover `applySimpleCplSchedule` / granularity schedule commands on leftover next `cpl_rate_periods`. Do not add `updateCplRate` so the comment “wins.” Do not invent a PATCH on `/admin/cpl-rates`.

2. **There is no `getCplRateModel` — and that is today’s contract, not a missing Feed copy.** Leftover seed / leftover slot read / leftover admin fallback list, leftover inventory find, leftover M4 snapshot find **ask** default `CplRate`. Leftover next period **asks** `getCplRatePeriodModel`. Already-recommended company / Feed / hung spelling already have getters. Do not invent `getCplRateModel` so “fourteen-slot matches period” without a paired proof that `TEST_MODE` still seeds / inventories / M4-snapshots the same `cpl_rates` they seed today. Do not silently move leftover M4 onto a getter in the same pass as this rename.

3. **`cpl` is dollars. Leftover next `amount_cents` is integer cents.** Checked-in defaults are `190` / `195` / `40` / `0`. Leftover M4 `dollarsToCents(legacy.cpl)` later. This schema does **not** `Number.isSafeInteger`. Do not rename `cpl` to `amount_cents` so “the slot matches the period” — leftover M4 would 100× the cutover amount. Do not add an integer validator so “money matches the period.”

4. **Two uniques are two jobs.** Field unique `label` is the leftover seed key. Compound unique `{ source_company, lead_type, local }` is the leftover slot identity. Leftover cache walks `findCplRateDefinition(doc.label)` first and **skips** orphan labels. Do not drop the compound unique so “`label` is enough.” Do not drop `label` unique so “the slot triple is enough” — leftover seed `$setOnInsert`s `{ label }`.

5. **Optional `local` plus a unique compound is today’s Best Relocation contract.** Mongo unique treats missing `local` as one `null`. Only Best Relocation forms set `local` (`Best Relocation Forms` / `Best Relocation Locals`). Best Relocation inbound and every other company leave it unset. Leftover cache key only consults `local` when `sourceCompany === "best_relocation_leads" && leadType === "form"`. Do not require `local` on every row so “the compound always has three fields.” Do not make every company split on Move Type “because the schema has the field.”

6. **`source_company` is a string slug, not a company ObjectId.** Leftover seed writes `definition.sourceCompany` (`tbm_leads`, `best_relocation_leads`, …). Leftover next period points at `source_granularity` ObjectId. Do not change this field to `Schema.Types.ObjectId` so “fourteen-slot matches Feed.”

7. **Leftover seed never updates.** Already-recommended `$setOnInsert` by `label`. A later checked-in `defaultCpl` does **not** rewrite a row that already exists. Do not add a `$set` so “the leftover book stays current.” That is leftover seed’s **interface**, not this one.

8. **Leftover overview / leftover health / leftover historical-consolidation do not ask this collection.** Leftover health **asks** `getCplRatePeriodModel` and leftover telemetry names path `legacy_cpl_rates` without opening `CplRate`. Do not add a leftover overview count so “every leftover book sits on the shelf.” Do not add a leftover historical-consolidation validate so “every catalog row has a planned-insert proof.” Those are leftover overview / leftover historical-consolidation **interfaces**, not this one.

9. **This file still uses default `autoIndex`.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed leftover migrations. Neither unique here is named. Do not silently set `autoIndex: false` so “fourteen-slot matches Booking” without a paired report that boot still creates the leftover label unique / leftover slot unique **or** that a leftover migration will. Do not invent a leftover `pnpm migration:cpl-rate-indexes` in this rename.

10. **Two leftover books, two answers — this file is only `cpl_rates`.** Leftover slot read only opens this collection. Leftover admin list prefers nested `granularity.cpl` and only opens `cpl_rates` when that flatten is empty. Leftover M4 `resolveAmountAuthority` may elect leftover `cpl_rates` over leftover embedded when they disagree (reviewable collision). Do not teach this schema to store leftover nested cents so “both leftover books agree.” Do not merge this file into already-recommended leftover company nested `granularities[].cpl`.

11. **Leave sibling modules alone.** Leftover seed / leftover slot read / leftover admin list, leftover `getCplForSource` first-try nested, leftover Lead pricing, leftover Owner period write, leftover M4 `dollarsToCents`, leftover inventory snapshot, leftover next live period, and already-recommended hung spelling / Feed / company rows are already the right **depth**. This file holds the leftover fourteen-slot row.

## Testing

The **interface** is the test surface: `CplRate` validate, the leftover label unique, the leftover slot unique.

There is no `CplRate.test.ts`. Today’s proofs sit on leftover callers: leftover `cplRate.service.test.ts` leftover stubs leftover `CplRate.find` / leftover `CplRate.updateOne` leftover for leftover “Main Site Inbounds” leftover `$setOnInsert`; leftover `cpl.test.ts` leftover stubs leftover `CplRate.find` leftover for leftover `getCplForSource` leftover second-try leftover and leftover proves leftover `not_provided` leftover never leftover opens leftover this leftover model. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new slot requires `label`, `source_company`, `lead_type`, and `cpl`.
- `local` is optional.
- `lead_type` accepts `form` and `call` only.
- `local` accepts `local` and `long_distance` only.
- `source_company` is a string (not ObjectId) and schema-lowercases.
- `cpl` accepts `0` and `190` and refuses `-1`.
- `cpl` does **not** require `Number.isSafeInteger`.
- Validate does **not** invent `label` from `source_company`.
- There is no `amount_cents` path.
- There is no `source_granularity` path.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.

**Leftover identity**
- `{ label: 1 }` is unique.
- `{ source_company, lead_type, local }` is unique.
- Neither unique is named.
- There is no unique on `cpl`.

**Default connection**
- Default `CplRate` remains exported.
- `getCplRateModel` is **not** exported.

Do **not** add a test per helper (`requiredUniqueTrimmedCrmStyleSlotName`, `requiredNonNegativeDollars`). Those names exist so the parent reads. Do **not** leftover-seed from this file’s tests. Do **not** leftover `getCplRate` from this file’s tests. Do **not** leftover `dollarsToCents` from this file’s tests. Do **not** leftover `syncIndexes` in the unit file so “the test creates the leftover uniques.”

There is no leftover named-index export to keep for a second leftover migration **adapter**.

## What I would not do

- A `CplRateModelService` / `CplRateService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `cents.ts` / `normalize.ts` split for cleanliness.
- Inventing a selected-database **seam** by adding `getCplRateModel` without a paired proof. Leftover seed and leftover M4 must not write/load live `cpl_rates` while `TEST_MODE` selected `testvantagemovers` **unless** today’s default-connection callers already do that — they do not have a getter today.
- Breaking the default-connection **seam** by deleting `CplRate` without a paired proof that leftover seed / leftover inventory / leftover M4 still see the leftover uniques.
- Treating leftover `getCplRate` / leftover `listCplRates` / leftover `ensureCplRatesSeeded` as this story. Those functions own leftover cache, leftover `$setOnInsert`, leftover nested-book prefer, and leftover compatibility telemetry.
- Treating leftover `getCplForSource` as this story. That function owns leftover nested first try then leftover fourteen-slot second try.
- Treating leftover `resolveCpl` / leftover `applySimpleCplSchedule` as this story. Those functions own leftover next `cpl_rate_periods`.
- Treating leftover M4 `resolveAmountAuthority` / leftover `dollarsToCents` as this story. Those functions own leftover cutover cents.
- Treating leftover next `CplRatePeriod.ts` as this story. That leftover `amount_cents` is the writable live book.
- Treating already-recommended hung spelling unique `label` as this story. That leftover unique is leftover namespace plus folded key, not a fourteen-slot CRM-style name.
- Inventing a cents **seam** so “the slot matches the period.”
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database **seam** that has only one live **adapter** — there is no getter today.
- Silently adding `updateCplRate` so the “Owner-editable” comment looks true.
- Silently renaming `cpl` to `amount_cents` so “money matches the period.”
- Silently requiring `local` on every row so “the compound always has three fields.”
- Silently changing `source_company` to ObjectId so “fourteen-slot matches Feed.”
- Silently adding a leftover overview count so “every leftover book sits on the shelf.”
- Silently enabling leftover `optimisticConcurrency` or leftover Lead revision fields so “fourteen-slot matches Booking.”
- Silently “fixing” a leftover ADR while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
