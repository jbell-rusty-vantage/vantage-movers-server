# Remember The Hung Sheet Or Leftover API Spelling On The Selected Mongo Database, Keep One Live Mapping Per Namespace Plus Folded Key, And Refuse In-Place Destination Edits — Never Hang The Spelling Here, Never Ask The Collection Which Feed This Points At, Never Unique-Index Archived Rows, Never Stamp The Folded Key On Validate, Never Delete The Getter Because Leftover Health Already Follows It — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 9 of this service — `LeadSourceLabelMapping.ts`
- Remaining in this service: `CplRate.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/LeadSourceLabelMapping.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Owner-only create / activate / deactivate for `lead_source_label_mappings`. Sheet and leftover API labels resolve collection-first via leftover `resolveSheetOrLegacyLabel`. Leftover `SOURCE_LABEL_TO_COMPANY` is an instrumented fallback. Correction is deactivate + create. Audit entity type is `source_label_mapping`. Report-first inventory is `pnpm migrations:operations-registry-label-mappings`. Stored destination fields remain `source_company` / `source_granularity`. Health writes leftover `registry.label_mapping_destination_invalid` / leftover `registry.label_mapping_collision` by loading this collection — **this file never writes those findings**. Knowledge resource list names leftover hang / leftover resolve — do not add a Models Service file in this rename so “the Service sentence wins”). Leftover Owner hang / archive / list / collection-first ask: already-recommended [operations-registry-label-mappings.md](operations-registry-label-mappings.md) (`hangASheetOrLeftoverApiSpellingOnOneLiveFeed` / leftover archive / leftover list / leftover `askTheCollectionWhichFeedThisSpellingPointsAt` **ask** `getLeadSourceLabelMappingModel` — **this file never hangs, never archives, never asks**). Leftover fold: skipped `sourceLabelNormalize.ts` (`normalizeSourceLabel` — NFKC + whitespace-collapse + trim + lowercase; **this file asks that fold so stored `normalized_label` must equal it**, and does **not** stamp the fold). Leftover health load: already-recommended [operations-registry-queries-health.md](operations-registry-queries-health.md) (`getLeadSourceLabelMappingModel().find({})` then leftover `buildLabelMappingHealthFindings` — **this file never writes a finding**). Leftover projection list: already-recommended [operations-registry-queries-lead-source-projection.md](operations-registry-queries-lead-source-projection.md) (**asks** the getter by Feed — **this file never projects**). Leftover overview count: already-recommended [operations-registry-queries-overview.md](operations-registry-queries-overview.md) (**does not** count this collection — leftover company still **asks** default `LeadSourceCompany`; leftover Feed still **asks** `getLeadSourceGranularityModel`). Leftover historical-consolidation validate **does not** ask this file. Distinct from already-recommended company row: [models-lead-source-company.md](models-lead-source-company.md) (unique immutable slug; embedded leftover Feeds; **no** hung spelling). Distinct from already-recommended first-class Feed: [models-lead-source-granularity.md](models-lead-source-granularity.md) (unique immutable `granularity_key`; `active` default **false**; **no** `normalized_label`). Distinct from leftover next fourteen-slot CPL: leftover next `CplRate.ts` (legacy unique `label` on `cpl_rates` — **not** this namespace + folded key). Distinct from already-recommended Agent / Customer rows: [models-agent.md](models-agent.md), [models-customer.md](models-customer.md) (those files have **no** selected-database getter — **do not delete `getLeadSourceLabelMappingModel` so “accepted label matches Agent”**). Distinct from already-recommended Form / Call / Booking / Cancellation rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md), [models-booked-lead.md](models-booked-lead.md), [models-cancelled-lead.md](models-cancelled-lead.md) (those files set `autoIndex: false` and apply named catalogs through leftover migrations — **do not copy that fence here**). Distinct from leftover historical relax: this checkout has **no** `historical/LeadSourceLabelMapping.ts`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge does **not** define Source Label Mapping here; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model.** Leftover `operationsRegistry/labelMappings.ts` **asks** `getLeadSourceLabelMappingModel` for leftover hang (`create` + leftover `{ namespace, normalized_label, active: true }` find), leftover archive / restore (`findById` + leftover `findByIdAndUpdate` with `runValidators: true`), leftover list (no leftover `active` filter), and leftover collection-first ask (`find` leftover `{ namespace, normalized_label, active: true }`). Leftover `queries/health.ts` **asks** the getter’s `find({})`. Leftover `queries/leadSourceProjection.ts` **asks** the getter by `source_granularity`. Leftover `labelMappings.test.ts` **asks** default `LeadSourceLabelMapping` for leftover `schema.indexes()` and leftover `new LeadSourceLabelMapping` construct, and **asks** the getter for leftover hang / leftover archive stubs. Leftover `sourceResolution.test.ts`, leftover `queries/leadSourceProjection.test.ts`, leftover `ownerLanguageDeck.test.ts` **ask** the getter. There is no `LeadSourceLabelMapping.test.ts`. Leftover inventory `scripts/migrations/operations-registry-label-mappings.ts` **asks** leftover `createLabelMapping`, **not** this model. Leftover overview **does not** import this file. Leftover historical-consolidation **does not** import this file. Not this **interface**: leftover `createLabelMapping` itself, leftover `setLabelMappingActivation` itself, leftover `resolveLabelToFeed` itself, leftover health findings themselves.
- Seams callers need: default `LeadSourceLabelMapping` (first-registered connection — leftover unique-index inspect, leftover document construct) vs `getLeadSourceLabelMappingModel()` (selected `getMongoDatabaseName()` — leftover hang / leftover archive / leftover list / leftover collection-first ask, leftover health load, leftover projection list); named partial unique `{ namespace: 1, normalized_label: 1 }` where `{ active: true }` vs leftover hang / leftover restore service-level `findOne`; schema `immutable` + leftover `pre("validate")` destination fence vs leftover archive-then-hang correction; leftover `normalized_label` validator that **asks** skipped `normalizeSourceLabel(label)` vs leftover hang that stamps the fold before insert; schema `active` default **`true`** vs already-recommended Feed schema `active` default **`false`**; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence; exported leftover `LABEL_MAPPING_NAMESPACES` (`sheet_lead_source` \| `legacy_api_source`) vs leftover Wave B Zod enum of the same two strings. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no hang-the-spelling **seam**. There is no collection-first-ask **seam**. There is no health-finding **seam**.
- Split later (only if the file outgrows one sitting): this ~137-line file is one sitting if you read it as remember the hung sheet or leftover API spelling on the selected Mongo database, keep one live mapping per namespace plus folded key, and refuse in-place destination edits — never hang the spelling here, never ask the collection which Feed this points at, never unique-index archived rows, never stamp the folded key on validate, never delete the getter because leftover health already follows it. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `immutable.ts`. Owner hang / leftover archive / leftover collection-first ask stay already-recommended `labelMappings.ts`. Leftover fold stays skipped `sourceLabelNormalize.ts`. Leftover next fourteen-slot CPL stays leftover `CplRate.ts`.

`LeadSourceLabelMapping` is a Mongoose model name. The owner question is: *Owner just hung a sheet or leftover API spelling on one live Feed — or leftover health is about to walk every mapping. Hold the row on `lead_source_label_mappings`. Keep the raw spelling. Keep the server fold in `normalized_label` and refuse a fold that does not equal leftover `normalizeSourceLabel(label)`. Keep one live mapping per leftover namespace plus that fold so leftover hang cannot elect a second live destination. Refuse an in-place destination edit — leftover correction archives this row and hangs a replacement. If this process selected a different Mongo database, hand back that database’s mapping model. Do not hang the spelling. Do not ask which Feed this points at. Do not unique-index archived rows so “every historical spelling is unique.” Do not stamp the fold on validate so “hand insert matches leftover hang.” Do not delete the getter so “accepted label matches Agent” — leftover health already loads through it. Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who hang / archive / ask already lives in already-recommended `labelMappings.ts`. Who fold already lives in skipped `sourceLabelNormalize.ts`. Who write leftover findings already lives in already-recommended leftover health. Do not pull those in.

## What this file actually does

Three operations of one “remember the hung sheet or leftover API spelling, keep one live mapping per namespace plus folded key, and refuse in-place destination edits” story, not “a label-mapping model CRUD dump,” and not Hang A Sheet Or Leftover API Spelling / Ask The Collection themselves:

1. **Hold the hung spelling as the catalog System of Record row** — collection `lead_source_label_mappings`, timestamps, `toJSON` / `toObject` virtuals. **No** virtuals declared. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** revision catalog. **No** `sheet_sync[]`. **No** Ingestion Origin. **No** `created_from`. Declares required immutable `label` (raw spelling — **no** schema trim / lowercase), required `normalized_label` (must equal leftover `normalizeSourceLabel(this.label)`; **not** field-immutable), required immutable `namespace` (enum leftover `LABEL_MAPPING_NAMESPACES`: `sheet_lead_source` \| `legacy_api_source`), required immutable `source_company` (ObjectId → leftover company), required immutable `source_granularity` (ObjectId → leftover first-class Feed), required `active` (default **`true`**, `index: true`), required immutable nested `created_by` (`actor_type` `owner` \| `admin` \| `system`, required trimmed `actor_id` / `actor_label` / `request_id`, required trimmed lowercase `actor_role`), optional `change_reason` (trim, min 10, max 1000), optional `archived_at`. This beat does **not** invent `normalized_label` from `label`. This beat does **not** hang. This beat does **not** require leftover `change_reason` on every insert. A leftover hang may still refuse when a live mapping already holds the leftover namespace plus fold.

2. **Keep one live mapping per leftover namespace plus folded key, browse-index company / Feed, and refuse destination edits after create** — named unique `{ namespace: 1, normalized_label: 1 }` with leftover `partialFilterExpression: { active: true }` and leftover name `lead_source_label_mappings_active_namespace_normalized_label_unique`. Compound non-unique `{ source_granularity: 1, active: 1 }`. Compound non-unique `{ source_company: 1, active: 1 }`. The unique is **not** global across archived rows. Leftover hang / leftover restore also leftover `findOne` leftover `{ namespace, normalized_label, active: true }` first; leftover Mongo `11000` still maps to leftover `REGISTRY_DUPLICATE_IDENTIFIER`. Leftover `pre("validate")` `rejectImmutableEdits` throws on leftover `label` / leftover `namespace` / leftover `source_company` / leftover `source_granularity` when leftover `isNew` is false. Those four paths are also schema `immutable: true`. Leftover `normalized_label` is **not** in that list — the leftover validator is the lock. Leftover `created_by` is schema-immutable and **not** in the hook list. This beat does **not** unique-index leftover `label`. This beat does **not** unique-index leftover `(source_company, namespace)`.

3. **Bind the selected Mongo database** — default export `LeadSourceLabelMapping` is `mongoose.models.LeadSourceLabelMapping ?? mongoose.model(...)`. `getLeadSourceLabelMappingModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Leftover hang / leftover archive / leftover list / leftover collection-first ask, leftover health load, leftover projection list **ask** the getter. Leftover unique-index inspect and leftover document construct **ask** the default. This beat does **not** open `vantagemovershistorical`. This beat does **not** call `syncIndexes`.

`LeadSourceLabelMappingDocument` is the inferred row type. `LABEL_MAPPING_NAMESPACES` / `LabelMappingNamespace` are the leftover enum this schema and leftover hang share. There is no unknown-state sentinel here. There is no named-index export besides the leftover unique `name` string on the index options.

There is no hang-this-spelling operation. Leftover `labelMappings.ts` elects that. There is no collection-first-ask operation. Leftover `resolveLabelToFeed` elects that. There is no leftover-health-finding operation. Leftover `buildLabelMappingHealthFindings` elects that.

## Organization

Keep one file. This is the screenplay for “remember the hung sheet or leftover API spelling on the selected Mongo database, keep one live mapping per namespace plus folded key, and refuse in-place destination edits — never hang the spelling here, never ask the collection which Feed this points at, never unique-index archived rows, never stamp the folded key on validate, never delete the getter because leftover health already follows it.” Leftover hang / leftover archive / leftover collection-first ask / leftover health findings already live in deeper **modules**. Leftover fold already lives in a skipped sibling **module**. Already-recommended company / Feed already live in sibling **modules**. Do not pull those in. Do not invent a `LeadSourceLabelMappingModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: false` **adapter** so “accepted label matches Booking” without a reviewed index migration. Do not invent a unique `{ namespace, normalized_label }` **adapter** without leftover `{ active: true }` so “every historical spelling is unique.” Do not invent a `pre("validate")` that stamps leftover `normalized_label` from leftover `label` so “hand insert matches leftover hang.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `normalize.ts` / `immutable.ts` each get a file.

Do not move leftover `normalizeSourceLabel` into this file so “the row owns the fold.” Do not merge this file into already-recommended `LeadSourceGranularity.ts` so “one schema owns the Feed and the accepted label.” Do not merge this file into leftover next `CplRate.ts` so “one unique label owns leftover cents and leftover sheet spellings.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `LeadSourceLabelMapping` | `hungSpellingOnTheDefaultConnection` | leftover unique-index inspect and leftover document construct still import the default model |
| `getLeadSourceLabelMappingModel` | `hungSpellingOnTheSelectedMongoDatabase` | leftover hang / leftover archive / leftover list / leftover collection-first ask, leftover health load, leftover projection list must follow `getMongoDatabaseName()` |
| `LeadSourceLabelMappingDocument` | `HungSpellingRow` | inferred document + `_id` |
| `LABEL_MAPPING_NAMESPACES` / `LabelMappingNamespace` | `HungSpellingNamespaces` | leftover hang and leftover list share the leftover `sheet_lead_source` \| `legacy_api_source` enum |

Keep the old names as one-line aliases until leftover hang, leftover health, leftover projection, leftover unique-index inspect, and leftover document construct migrate. Do not make callers learn leftover `normalized_label` / leftover `useDb` / leftover `partialFilterExpression` as the domain language. Do **not** delete the default `LeadSourceLabelMapping` export so “everyone must call the getter” without a paired proof that leftover `schema.indexes()` and leftover `new LeadSourceLabelMapping` still inspect the same unique. Do **not** delete the getter so “accepted label matches Agent” without a paired proof that leftover hang and leftover health still write/load the selected database. Do **not** re-export leftover hang’s leftover `CreateLabelMappingCommand` from this file so “one type owns hang and hold.”

**No class for the workflow.** The one type that *does* earn a name is the pending live-identity contract:

```ts
type HungSpellingLiveIdentity = {
  namespace: "sheet_lead_source" | "legacy_api_source"
  normalized_label: { equals: "normalizeSourceLabel(label)" }
  unique_while: { active: true }
  destination: { label: "immutable"; namespace: "immutable"; source_company: "immutable"; source_granularity: "immutable" }
}
```

That is the handoff from “this process remembered a hung spelling” to “leftover hang elects one live row, leftover collection-first ask loads `{ namespace, normalized_label, active: true }`, and leftover correction archives then hangs again.” Do **not** add `{ unique_while: "always" }` onto that type so “archived rows cannot share a fold.” Do **not** drop `destination` so “leftover PATCH can retarget the Feed.”

Leave leftover next `CplRate.ts` on that file. Leave leftover next `CplRatePeriod.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// LeadSourceLabelMapping.ts
// Owner just hung a sheet or leftover API spelling
// on one live Feed —
// or leftover health is about to walk every mapping.
// Hold the row on lead_source_label_mappings.
// Keep the raw spelling.
// Keep the server fold in normalized_label
// and refuse a fold that does not equal
// leftover normalizeSourceLabel(label).
// Keep one live mapping per leftover namespace plus that fold
// so leftover hang cannot elect a second live destination.
// Refuse an in-place destination edit —
// leftover correction archives this row and hangs a replacement.
// If this process selected a different Mongo database,
// hand back that database's mapping model.
// Do not hang the spelling.
// Do not ask which Feed this points at.
// Do not unique-index archived rows
// so "every historical spelling is unique."
// Do not stamp the fold on validate
// so "hand insert matches leftover hang."
// Do not delete the getter —
// leftover health already loads through it.
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const hungSpellingOnTheDefaultConnection =
  mongoose.models.LeadSourceLabelMapping ??
  mongoose.model("LeadSourceLabelMapping", hungSpellingSchema)

export function hungSpellingOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) return hungSpellingOnTheDefaultConnection
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return db.models.LeadSourceLabelMapping ??
    db.model("LeadSourceLabelMapping", hungSpellingSchema)
}

export { hungSpellingOnTheDefaultConnection as LeadSourceLabelMapping }
export { hungSpellingOnTheSelectedMongoDatabase as getLeadSourceLabelMappingModel }
export const hungSpellingNamespaces = ["sheet_lead_source", "legacy_api_source"] as const
export { hungSpellingNamespaces as LABEL_MAPPING_NAMESPACES }

// ── 1. Hold the hung spelling as the catalog System of Record row ─

const hungSpellingSchema = rememberTheHungSpellingRow() // collection lead_source_label_mappings; default autoIndex; no leftover fold stamp

function rememberTheHungSpellingRow() {
  const schema = new Schema(
    {
      label: requiredImmutableRawSpelling(),                 // no trim / lowercase
      normalized_label: requiredFoldThatMustMatchTheRawSpelling(), // asks leftover normalizeSourceLabel; not invented
      namespace: requiredImmutableSheetOrLeftoverApiNamespace(),
      source_company: requiredImmutableCompanyRef(),
      source_granularity: requiredImmutableFeedRef(),
      active: requiredActiveDefaultTrue(),                   // leftover first-class Feed defaults false
      created_by: requiredImmutableRegistryActor(),
      change_reason: optionalReasonTenToThousand(),          // leftover hang still requires it
      archived_at: optionalFirstArchiveClock(),              // leftover archive stamps once
    },
    { collection: "lead_source_label_mappings", timestamps: true },
  )
  keepOneLiveMappingPerNamespacePlusFoldedKeyAndRefuseDestinationEdits(schema)
  return schema
}

// ── 2. Live identity unique + leftover browse + leftover destination fence ───

function keepOneLiveMappingPerNamespacePlusFoldedKeyAndRefuseDestinationEdits(schema) {
  // today's named partial unique
  //   lead_source_label_mappings_active_namespace_normalized_label_unique
  //   { namespace, normalized_label } where active: true
  // today's non-unique { source_granularity, active }
  // today's non-unique { source_company, active }
  // today's pre("validate") rejectImmutableEdits
  //   label / namespace / source_company / source_granularity
  //   when isNew is false
}

// ── 3. Selected Mongo database ────────────────────────────
// hungSpellingOnTheSelectedMongoDatabase above
```

Read the primary path out loud: *hold the hung spelling on `lead_source_label_mappings` with a required immutable raw label, a required fold that must equal leftover `normalizeSourceLabel(label)`, a required immutable leftover namespace, and required immutable company / Feed pointers. Do not invent the fold on validate. Keep one live mapping per leftover namespace plus fold so leftover hang elects one destination. Archived rows may share that pair — leftover restore re-checks the leftover live find. Refuse an in-place destination edit so leftover correction must archive then hang. Default a new mapping to active so leftover hang’s omitted `active` still matches today’s insert. If this process already sits on the selected Mongo name, the getter returns the same model leftover hang and leftover health already import. Leftover unique-index inspect still uses the default export. Do not hang the spelling. Do not ask which Feed this points at. Do not unique-index archived rows.*

That is the operation. An unnamed schema dump is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **There is no fold stamp — and that is today’s contract, not a missing Form-Lead copy.** Leftover hang folds through leftover `normalizeSourceLabel` and writes both leftover `label` and leftover `normalized_label`. This file **asks** the same leftover fold only as a leftover validator. A hand insert that omits leftover `normalized_label` fails leftover `required`, not a silent stamp. Do not add `pre("validate")` `stampTheFoldFromTheRawSpelling` so “hand insert matches leftover hang” — a silent stamp would change who a later leftover collection-first ask returns when a caller forgot the fold. Do not copy Form Lead’s lid / phone / Job fold onto this hook.

2. **Default export and getter are both today’s contract.** Leftover hang / leftover archive / leftover list / leftover collection-first ask, leftover health load, leftover projection list **ask** `getLeadSourceLabelMappingModel`. Leftover unique-index inspect and leftover document construct **ask** default `LeadSourceLabelMapping`. Leftover overview **does not** count this collection. Leftover historical-consolidation **does not** validate this collection. Do not silently delete the getter so “accepted label matches Agent” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database **and** that leftover hang / leftover health still write/load the same rows. Do not silently move leftover unique-index inspect onto the getter in the same pass as this rename. Do not silently add a leftover overview count so “every catalog book sits on the shelf” — that is leftover overview’s **interface**, not this one.

3. **Schema `active` default `true` is today’s hung-spelling contract. Leftover first-class Feed defaults `false`.** Leftover hang also stamps leftover `active: true`. Leftover `new LeadSourceLabelMapping` construct in leftover `labelMappings.test.ts` stamps leftover `active: true` itself. Do not change this default to `false` so “accepted label matches Feed” — a silent default change would rewrite who a bare `LeadSourceLabelMapping.create` treats as live, and leftover health leftover collision / leftover destination findings only walk leftover `active !== true` skips.

4. **The unique is live-only. Archived rows may share leftover namespace plus fold.** Leftover hang leftover `findOne`s leftover `{ active: true }` first. Leftover restore leftover `findOne`s leftover `{ active: true, _id $ne }`. Leftover health leftover collision finding says leftover “unique index is missing or bypassed” when two leftover `active === true` rows share the leftover key. Do not drop leftover `partialFilterExpression: { active: true }` so “every historical spelling is unique” — leftover archive-then-hang of the same leftover sheet spelling would then fail insert. Do not drop leftover hang’s leftover `findOne` so “the named unique is enough.”

5. **Destination fields are double-fenced. Leftover `normalized_label` is not.** Schema leftover `immutable: true` plus leftover `pre("validate")` leftover `rejectImmutableEdits` both refuse leftover `label` / leftover `namespace` / leftover `source_company` / leftover `source_granularity` after create. Leftover `normalized_label` is locked only by leftover “must equal leftover `normalizeSourceLabel(label)`.” Leftover archive leftover `findByIdAndUpdate` leftover `$set`s leftover `active` / leftover `change_reason` / leftover `archived_at` with leftover `runValidators: true` — that path must keep passing. Do not add leftover `normalized_label` onto leftover `IMMUTABLE_AFTER_CREATE` so “every identity field matches destination” without a paired leftover archive proof. Do not drop the leftover hook so “schema `immutable` is enough” without a paired leftover `document.isNew = false` proof leftover `labelMappings.test.ts` already holds.

6. **Leftover `created_by` is schema-immutable and not in the hook list.** Leftover hang stamps leftover `persistActor` once. Leftover archive does **not** rewrite leftover `created_by`. Do not add leftover `created_by` onto leftover `IMMUTABLE_AFTER_CREATE` so “every write-once field matches destination” without a paired leftover `findByIdAndUpdate` proof. Do not make leftover `created_by` optional so “hand insert can skip the actor.”

7. **Leftover `change_reason` is optional on this schema. Leftover hang / leftover archive require 10–1000 after trim.** Schema leftover `minlength` / leftover `maxlength` still apply when the field is set. Do not make leftover `change_reason` required so “schema matches leftover hang” — leftover health / leftover projection leftover `find`s do not write a reason, and a leftover historical row without one must still load. Do not drop leftover schema leftover `minlength: 10` so “the service already checks.”

8. **Raw leftover `label` is not folded.** Schema leftover `label` has **no** leftover `trim` / leftover `lowercase`. Leftover hang keeps the submitted leftover `label` and stores the leftover fold beside it. Do not add leftover `lowercase` / leftover `trim` onto leftover `label` so “the raw spelling matches the fold” — leftover Owner cards leftover `toRecord` leftover `label` as stored, and leftover `labelMappings.test.ts` leftover “Best Relocation Forms” / leftover “best relocation forms” pair is today’s contract.

9. **The leftover unique is named. This file still uses default `autoIndex`.** Form / Call / Booking / Cancellation set leftover `autoIndex: false` and ship named catalogs through reviewed leftover migrations. This leftover name `lead_source_label_mappings_active_namespace_normalized_label_unique` is declared on the schema; leftover `pnpm migrations:operations-registry-label-mappings` leftover **asks** leftover `createLabelMapping` and does **not** apply indexes. Do not silently set leftover `autoIndex: false` so “accepted label matches Booking” without a paired report that boot still creates the leftover live unique / leftover browse indexes **or** that a leftover migration will. Do not invent a second leftover `pnpm migration:label-mapping-indexes` in this rename.

10. **This file imports leftover `normalizeSourceLabel` from leftover `services/operationsRegistry`.** That leftover fold is a skipped sibling, not a leftover model helper. Do not move leftover `normalizeSourceLabel` into this file so “the row owns NFKC.” Do not move leftover `normalizeSourceLabel` into leftover `schemaHelpers.ts` so “every catalog fold lives together.” Do not switch this leftover validator onto leftover `sourceResolution.ts` leftover private leftover `normalize()` (trim + lowercase only) so “one fold owns leftover hints.”

11. **Exported leftover `LABEL_MAPPING_NAMESPACES` is this schema’s leftover enum.** Leftover hang leftover re-exports it. Leftover Wave B Zod leftover `sourceLabelMappings.validation.ts` leftover repeats the leftover two strings. Do not move the leftover enum onto leftover Zod so “HTTP owns the leftover namespaces.” Do not add leftover `granot_crm_source` onto this leftover enum so “one mapping owns leftover Granot names.”

12. **Leave sibling modules alone.** Leftover hang / leftover archive / leftover collection-first ask, leftover fold, leftover health load, leftover projection list, leftover unique-index inspect, leftover document construct, leftover next fourteen-slot CPL, and already-recommended company / Feed rows are already the right **depth**. This file holds the hung-spelling row.

## Testing

The **interface** is the test surface: `LeadSourceLabelMapping` validate, the leftover live unique, the leftover destination fence, the selected-database getter.

There is no `LeadSourceLabelMapping.test.ts`. Today’s proofs sit on leftover callers: leftover `labelMappings.test.ts` leftover `schema.indexes()` leftover locks leftover `{ namespace, normalized_label }` leftover unique leftover `{ active: true }`; leftover `new LeadSourceLabelMapping` leftover rejects leftover `normalized_label: "wrong"`; leftover `document.isNew = false` leftover `set("source_granularity")` leftover refuses leftover destination edit; leftover hang / leftover archive / leftover collection-first tests leftover stub the getter. Leftover `sourceResolution.test.ts` leftover stubs the getter for leftover collection-first / leftover fallback. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new mapping requires leftover `label`, leftover `normalized_label`, leftover `namespace`, leftover `source_company`, leftover `source_granularity`, and leftover `created_by`.
- Validate does **not** invent leftover `normalized_label` from leftover `label`.
- Leftover `normalized_label` that does not equal leftover `normalizeSourceLabel(label)` fails leftover `normalized_label must equal`.
- Leftover `label` is leftover schema-immutable after set.
- Leftover `namespace` is leftover schema-immutable after set.
- Leftover `source_company` and leftover `source_granularity` are leftover schema-immutable after set.
- Leftover `active` defaults to `true`.
- Leftover `change_reason` is optional.
- Leftover `namespace` accepts leftover `sheet_lead_source` and leftover `legacy_api_source` only.
- Leftover `label` has **no** leftover schema `lowercase` / leftover `trim`.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.

**Live identity**
- Leftover `{ namespace, normalized_label }` is leftover unique only where leftover `{ active: true }`.
- Leftover unique leftover `name` is leftover `lead_source_label_mappings_active_namespace_normalized_label_unique`.
- Leftover `{ source_granularity, active }` is indexed and **not** unique.
- Leftover `{ source_company, active }` is indexed and **not** unique.
- Leftover `pre("validate")` leftover refuses leftover destination edits when leftover `isNew` is false.
- There is no leftover unique on leftover archived leftover `{ namespace, normalized_label }`.

**Selected Mongo database**
- `getLeadSourceLabelMappingModel` is exported.
- When `mongoose.connection.name === getMongoDatabaseName()`, the getter returns the default `LeadSourceLabelMapping`.
- Default `LeadSourceLabelMapping` remains exported.
- Leftover `LABEL_MAPPING_NAMESPACES` remains exported.

Do **not** add a test per helper (`requiredImmutableRawSpelling`, `requiredFoldThatMustMatchTheRawSpelling`). Those names exist so the parent reads. Do **not** leftover hang from this file’s tests. Do **not** leftover `resolveLabelToFeed` from this file’s tests. Do **not** leftover write leftover `registry.label_mapping_*` findings from this file’s tests. Do **not** leftover `syncIndexes` in the unit file so “the test creates the leftover live unique.”

There is no leftover named-index export to keep for a second leftover migration **adapter** — leftover unique leftover `name` lives on leftover index options.

## What I would not do

- A `LeadSourceLabelMappingModelService` / `LabelMappingService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `normalize.ts` / `immutable.ts` split for cleanliness.
- Breaking the selected-database **seam** by deleting `getLeadSourceLabelMappingModel` without a paired proof. Leftover hang and leftover health must not write/load live `lead_source_label_mappings` while `TEST_MODE` selected `testvantagemovers`.
- Breaking the default-connection **seam** by deleting `LeadSourceLabelMapping` without a paired proof that leftover unique-index inspect still sees the leftover named unique.
- Treating leftover `createLabelMapping` / leftover `setLabelMappingActivation` / leftover `resolveLabelToFeed` as this story. Those functions own leftover Owner, leftover stamp, leftover live Feed check, leftover collision find, leftover leftover-map fallback, and leftover Operational Events.
- Treating leftover `buildLabelMappingHealthFindings` as this story. That function owns leftover `registry.label_mapping_destination_invalid` / leftover `registry.label_mapping_collision`.
- Treating leftover next `CplRate.ts` as this story. That leftover unique leftover `label` is leftover fourteen-slot CPL, not a hung sheet spelling.
- Treating already-recommended `LeadSourceGranularity.ts` as this story. That leftover unique leftover `granularity_key` is the live Feed.
- Inventing a unique-archived-spelling **seam** so “every historical spelling is unique.”
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database **seam** that has only one live **adapter** — today’s getter already has leftover hang, leftover archive, leftover list, leftover collection-first ask, leftover health, and leftover projection as homes.
- Inventing a leftover fold **seam** that has only one leftover **adapter** — skipped leftover `sourceLabelNormalize.ts` already owns leftover NFKC.
- Silently flipping schema `active` default to `false` so “accepted label matches Feed.”
- Silently adding leftover `pre("validate")` leftover `stampTheFoldFromTheRawSpelling` so “hand insert matches leftover hang.”
- Silently dropping leftover `partialFilterExpression: { active: true }` so “every historical spelling is unique.”
- Silently adding leftover `lowercase` / leftover `trim` onto leftover `label` so “the raw spelling matches the fold.”
- Silently making leftover `change_reason` required so “schema matches leftover hang.”
- Silently adding leftover `created_from` so “accepted label matches Feed.”
- Silently adding a leftover overview count so “every catalog book sits on the shelf.”
- Silently enabling leftover `optimisticConcurrency` or leftover Lead revision fields so “accepted label matches Booking.”
- Silently “fixing” a leftover ADR while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
