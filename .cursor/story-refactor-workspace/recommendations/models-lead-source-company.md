# Remember The Source Company Row On The Selected Mongo Database, Keep One Company Per Immutable Slug, And Hold Embedded Feeds Only As Migration Evidence — Never Assign A Lead Or Write The Live Feed Here, Never Unique-Index Nested Keys, Never Flip Schema Active-Default To Match Registry Create — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 7 of this service — `LeadSourceCompany.ts`
- Remaining in this service: `LeadSourceGranularity.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/LeadSourceCompany.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (System of Record is Operations Registry catalog collection `lead_source_companies`. `company_slug` is immutable. Projection mode defaults to `derived_import`; `direct_write` requires a complete spreadsheet mapping and does not itself enable Sheet Sync. First-class Feeds are the live book. Embedded `granularities[]` is M3 migration/rollback evidence only. Knowledge resource list names leftover Registry, leftover leftover-book, leftover Lead assignment — do not add a Models Service file in this rename so “the Service sentence wins”). Leftover Owner write: already-recommended [operations-registry-source-registry.md](operations-registry-source-registry.md) (`recordOrCorrectASourceCompany` **asks** `getLeadSourceCompanyModel`, creates `active: false` + `granularities: []`, never appends nested Feeds). Leftover leftover book: already-recommended [lead-source-companies-lead-source-company.md](lead-source-companies-lead-source-company.md) (`seedTheLeftoverSourceCompanyBook` `$setOnInsert`s nested Feeds with leftover CPL + leftover inbound phones — **this file never seeds**). Leftover Lead assignment: already-recommended [leads-source-company.md](leads-source-company.md) (**asks** leftover Registry fail-closed resolve — **this file never assigns**). Leftover overview count: already-recommended [operations-registry-queries-overview.md](operations-registry-queries-overview.md) (**asks** default `LeadSourceCompany.countDocuments` — not the getter). Leftover health load: already-recommended [operations-registry-queries-health.md](operations-registry-queries-health.md) (**asks** `getLeadSourceCompanyModel().find({})`). Distinct from leftover next first-class Feed row: `LeadSourceGranularity.ts` (collection `lead_source_granularities`; unique immutable `granularity_key`; `active` default **false**; **no** nested `cpl`; **no** `inbound_phone_numbers`; **this file never owns that collection**). Distinct from leftover next label mapping: `LeadSourceLabelMapping.ts`. Distinct from already-recommended Agent / Customer rows: [models-agent.md](models-agent.md), [models-customer.md](models-customer.md) (those files have **no** selected-database getter — **do not delete `getLeadSourceCompanyModel` so “Source Company matches Agent”**). Distinct from already-recommended Form / Call / Booking / Cancellation rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md), [models-booked-lead.md](models-booked-lead.md), [models-cancelled-lead.md](models-cancelled-lead.md) (those files set `autoIndex: false` and named catalogs — **do not copy that fence here**). Distinct from leftover historical relax: this checkout has **no** `historical/LeadSourceCompany.ts` — leftover historical-consolidation validate **asks** default `LeadSourceCompany` on this file. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge does **not** define Source Company / Source Granularity here; do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model.** Leftover `operationsRegistry/sourceRegistry.ts` **asks** `getLeadSourceCompanyModel` for list / get / get-by-slug / create (`active: false`, `granularities: []`) / patch / activation / leftover Feed create company-exists check / leftover seed-from-setup. Leftover `leadSourceSetup.ts`, leftover `queries/leadSourceProjection.ts`, leftover `queries/health.ts`, leftover `labelMappings.ts`, leftover `ownerGranotNames.ts`, leftover `granotCrmSources.ts`, leftover `granotCrmSourceProjections.ts`, leftover `ringCentralRegistry.ts`, leftover `ringCentralSnapshot.ts` **ask** the getter. Already-recommended leftover leftover-book **asks** the getter to seed / list / leftover create. Already-recommended leftover `createLeadFromGranot.ts` / leftover Owner Booking commands / leftover `leadMessaging/granotCreatedLead.ts` / leftover `ringcentral/callLeadConvergence.service.ts` / leftover `reporting/registryFilters.ts` **ask** the getter. Already-recommended leftover overview **asks** default `LeadSourceCompany.countDocuments`. Leftover `historicalConsolidation/schemaValidation.ts` **asks** default `LeadSourceCompany` to `validateSync` a planned insert. Leftover `sourceModels.test.ts` **asks** default `new LeadSourceCompany` (embedded array + `derived_import` default). Leftover admin / analytics / RingCentral replica tests stub or create through the getter. There is no `LeadSourceCompany.test.ts`. Not this **interface**: leftover `createOrUpdateSourceCompany` itself, leftover leftover-book seed itself, leftover `assignLeadSource` itself, leftover first-class Feed write itself.
- Seams callers need: default `LeadSourceCompany` (first-registered connection — leftover overview count, leftover historical-consolidation validate, leftover `sourceModels` construct) vs `getLeadSourceCompanyModel()` (selected `getMongoDatabaseName()` — leftover Registry write, leftover leftover-book seed, leftover health load, leftover Granot / RingCentral / reporting reads); field-level unique immutable `{ company_slug: 1 }` vs leftover Registry `normalizeKey` + service-level duplicate find; embedded `granularities[]` (leftover CPL + leftover inbound phones, `active` default **true**) vs leftover next first-class Feed collection (`active` default **false**, unique key, no `cpl`, no inbound phones); compatibility default **keys** (`default_form_granularity_key` / `default_call_granularity_key`) vs first-class default **refs** (`default_form_granularity` / `default_call_granularity`); schema `active` default **true** vs leftover Registry create that stamps `active: false`; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence; exported type name `LeadSourceGranularity` (embedded subdocument) vs leftover next model value `LeadSourceGranularity` (first-class collection). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Lead-assignment **seam**.
- Split later (only if the file outgrows one sitting): this ~112-line file is one sitting if you read it as remember the Source Company row on the selected Mongo database, keep one company per immutable slug, and hold embedded Feeds only as migration evidence — never assign a Lead or write the live Feed here, never unique-index nested keys, never flip schema active-default to match Registry create. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `embedded.ts` / `normalize.ts`. Owner write stays already-recommended `sourceRegistry.ts`. Leftover nested-book seed stays already-recommended `leadSourceCompany.service.ts`. Lead assignment stays already-recommended `leads/leadSourceCompany.ts`. Leftover next first-class Feed row stays leftover `LeadSourceGranularity.ts`.

`LeadSourceCompany` is a Mongoose model name. The owner question is: *Owner just named this Source Company in the catalog — or leftover seed is about to insert a missing slug. Hold the row on `lead_source_companies`. Keep the slug unique and immutable so leftover Registry rename cannot elect a second company. Keep the nested `granularities[]` array on the document so M3 rollback can still see the leftover book, and never treat those nested rows as the live Feed. If this process selected a different Mongo database, hand back that database’s Source Company model. Do not assign a Lead. Do not write a first-class Feed. Do not append nested Feeds on a Registry create. Do not unique-index a nested `granularity_key`. Do not flip `active` default to false so “schema matches Registry create.” Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who record / activate already lives in already-recommended `sourceRegistry.ts`. Who seed the leftover nested book already lives in already-recommended `leadSourceCompany.service.ts`. Who assign this Lead already lives in already-recommended `leads/leadSourceCompany.ts`. Who hold the live Feed already lives in leftover next `LeadSourceGranularity.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Source Company row, keep one company per immutable slug, and hold embedded Feeds only as migration evidence” story, not “a Source Company model CRUD dump,” and not Record Or Correct A Source Company / Assign The Lead's Source themselves:

1. **Hold the Source Company as the catalog System of Record row** — collection `lead_source_companies`, timestamps, `toJSON` / `toObject` virtuals. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** revision catalog. **No** `sheet_sync[]`. **No** Ingestion Origin. Declares required immutable `company_slug` (trim, schema `lowercase`, **unique**), required `name` / `owner_label` (trim), `aliases[]` (default `[]`), required `active` (default **`true`**), optional `archived_at` / `deactivation_reason`, optional first-class default refs (`default_form_granularity` / `default_call_granularity` → leftover next `LeadSourceGranularity`), optional compatibility default **keys** (`default_form_granularity_key` / `default_call_granularity_key`, trim + lowercase), nested `sheet_config` (`spreadsheet_id`, required `has_bad_tabs` default `false`, required `projection_mode` enum `derived_import` | `direct_write` default `"derived_import"`), nested `granularities[]` (default `[]`), required `created_from` (trim, default `"admin"`). Embedded subdocument: required immutable `granularity_key` (lowercase, **not unique**), required `channel` (`form` | `call`), required `owner_label` / `crm_label`, `aliases[]`, required `active` (default **`true`**), optional `archived_at`, required `cpl` (default `0`, min `0`), optional `local` (`LOCAL_TYPES`), `source_sites[]`, `inbound_phone_numbers[]`, required `priority` (default `0`), optional `sheet_tab_name`. This beat does **not** invent `company_slug` from `name`. This beat does **not** collapse whitespace beyond trim. This beat does **not** activate. A leftover Registry create may still refuse when slug already exists.

2. **Keep one company per immutable slug, and browse-index leftover nested feed keys** — field-level unique `{ company_slug: 1 }` (also `index: true` on the same path — today’s redundant declaration, not a second unique). Non-unique `{ active: 1 }`. Non-unique `{ "granularities.granularity_key": 1 }`, `{ "granularities.crm_label": 1 }`, `{ "granularities.inbound_phone_numbers": 1 }`. None are named catalogs. None have a leftover `pnpm migration:*` apply path. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Nested `granularity_key` is **immutable on the subdocument** and **not unique** on this schema. Leftover next first-class Feed unique lives on leftover `LeadSourceGranularity.ts`. This beat does **not** unique-index aliases. This beat does **not** unique-index nested CRM label.

3. **Bind the selected Mongo database** — default export `LeadSourceCompany` is `mongoose.models.LeadSourceCompany ?? mongoose.model(...)`. `getLeadSourceCompanyModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Leftover Registry write, leftover leftover-book seed, leftover health load, leftover Granot / RingCentral / reporting reads **ask** the getter. Leftover overview count and leftover historical-consolidation validate **ask** the default. This beat does **not** open `vantagemovershistorical`. This beat does **not** call `syncIndexes`.

`LeadSourceCompanyDocument` is the inferred row type plus a typed `granularities` `DocumentArray`. Exported type `LeadSourceGranularity` is the **embedded** subdocument, not leftover next first-class model.

There is no record-this-company-in-the-catalog operation. Leftover `sourceRegistry.ts` elects that. There is no leftover-seed operation. Leftover `leadSourceCompany.service.ts` elects that. There is no first-class Feed operation. Leftover next `LeadSourceGranularity.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the Source Company row on the selected Mongo database, keep one company per immutable slug, and hold embedded Feeds only as migration evidence — never assign a Lead or write the live Feed here, never unique-index nested keys, never flip schema active-default to match Registry create.” Leftover Registry write / leftover leftover-book seed / leftover Lead assignment already live in deeper **modules**. Leftover next first-class Feed already lives in a sibling **module**. Do not pull those in. Do not invent a `LeadSourceCompanyModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: false` **adapter** so “Source Company matches Booking” without a reviewed index migration. Do not invent a unique `{ "granularities.granularity_key": 1 }` **adapter** so “embedded matches first-class unique.” Do not invent a `pre("validate")` that stamps `company_slug` from `name` so “hand insert matches Registry.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `embedded.ts` / `normalize.ts` each get a file.

Do not move leftover `normalizeKey` into this file so “the row owns the fold.” Do not merge this file into leftover next `LeadSourceGranularity.ts` so “one schema owns the company and the live Feed.” Do not merge this file into already-recommended leftover leftover-book so “the seed owns the schema.” Do not delete the embedded sub-schema so “first-class is the only book” — M3 retains the array as rollback evidence. Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `LeadSourceCompany` | `sourceCompanyOnTheDefaultConnection` | leftover overview count and leftover historical-consolidation validate still import the default model |
| `getLeadSourceCompanyModel` | `sourceCompanyOnTheSelectedMongoDatabase` | leftover Registry write, leftover leftover-book seed, leftover health load, leftover Granot / RingCentral / reporting reads must follow `getMongoDatabaseName()` |
| `LeadSourceCompanyDocument` | `SourceCompanyRow` | inferred document + `_id` + typed `granularities` `DocumentArray` |
| `LeadSourceGranularity` (type) | `EmbeddedSourceFeedEvidence` | leftover leftover-book seed types the nested row — **not** leftover next first-class model |

Keep the old names as one-line aliases until leftover Registry, leftover leftover-book, leftover overview, leftover health, leftover Granot / RingCentral / reporting reads, and leftover historical-consolidation validate migrate. Do not make callers learn `company_slug` / `useDb` / `granularities[]` as the domain language. Do **not** delete the default `LeadSourceCompany` export so “everyone must call the getter” without a paired proof that leftover overview still counts the same `lead_source_companies` it counts today. Do **not** delete the getter so “Source Company matches Agent” without a paired proof that leftover Registry still writes the selected database. Do **not** rename the exported embedded type onto leftover next first-class `LeadSourceGranularityDocument` in the same pass as this rename.

**No class for the workflow.** The one type that *does* earn a name is the pending catalog-identity contract:

```ts
type SourceCompanyCatalogIdentity = {
  company_slug: { unique: true; immutable: true }
  embedded_feeds: "migration_rollback_evidence"
}
```

That is the handoff from “this process remembered a Source Company” to “leftover Registry slug lookup elects one row, and leftover M3 rollback can still read nested Feeds.” Do **not** add `{ "granularities.granularity_key": { unique: true } }` onto that type so “embedded uniqueness lives on the schema.” Do **not** drop `embedded_feeds` so “the nested book is gone.”

Leave leftover next `LeadSourceGranularity.ts` on that file. Leave leftover next `LeadSourceLabelMapping.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// LeadSourceCompany.ts
// Owner just named this Source Company in the catalog —
// or leftover seed is about to insert a missing slug.
// Hold the row on lead_source_companies.
// Keep the slug unique and immutable
// so leftover Registry cannot elect a second company.
// Keep nested granularities[] so M3 rollback can still see
// the leftover book, and never treat those nested rows
// as the live Feed.
// If this process selected a different Mongo database,
// hand back that database's Source Company model.
// Do not assign a Lead.
// Do not write a first-class Feed.
// Do not append nested Feeds on a Registry create.
// Do not unique-index a nested granularity_key.
// Do not flip active default to false
// so "schema matches Registry create."
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const sourceCompanyOnTheDefaultConnection =
  mongoose.models.LeadSourceCompany ??
  mongoose.model("LeadSourceCompany", sourceCompanySchema)

export function sourceCompanyOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) return sourceCompanyOnTheDefaultConnection
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return db.models.LeadSourceCompany ??
    db.model("LeadSourceCompany", sourceCompanySchema)
}

export { sourceCompanyOnTheDefaultConnection as LeadSourceCompany }
export { sourceCompanyOnTheSelectedMongoDatabase as getLeadSourceCompanyModel }

// ── 1. Hold the Source Company as the catalog System of Record row ─

const sourceCompanySchema = rememberTheSourceCompanyRow() // collection lead_source_companies; default autoIndex; no revision

function rememberTheSourceCompanyRow() {
  const schema = new Schema(
    {
      company_slug: requiredImmutableUniqueSlug(), // lowercase + trim when set; not invented from name
      name: requiredTrimmedDisplayName(),
      owner_label: requiredTrimmedOwnerLabel(),
      aliases: optionalAliasList(),
      active: requiredActiveDefaultTrue(),         // leftover Registry create still stamps false
      archived_at: optionalArchivedAt(),
      deactivation_reason: optionalDeactivationReason(),
      default_form_granularity: optionalFirstClassFormDefaultRef(),
      default_call_granularity: optionalFirstClassCallDefaultRef(),
      default_form_granularity_key: optionalCompatibilityFormDefaultKey(),
      default_call_granularity_key: optionalCompatibilityCallDefaultKey(),
      sheet_config: requiredSheetConfigDefaultDerivedImport(),
      granularities: embeddedFeedEvidenceList(),   // leftover CPL + inbound phones; active default true
      created_from: requiredOriginDefaultAdmin(),
    },
    { collection: "lead_source_companies", timestamps: true },
  )
  keepOneCompanyPerImmutableSlugAndBrowseIndexNestedFeedEvidence(schema)
  return schema
}

function embeddedFeedEvidenceList() {
  return {
    type: [rememberEmbeddedFeedEvidence()],
    default: [],
  }
}

function rememberEmbeddedFeedEvidence() {
  return new Schema(
    {
      granularity_key: requiredImmutableNestedKey(), // lowercase; not unique here
      channel: requiredFormOrCallChannel(),
      owner_label: requiredTrimmedOwnerLabel(),
      crm_label: requiredTrimmedCrmLabel(),
      aliases: optionalAliasList(),
      active: requiredActiveDefaultTrue(),           // leftover next first-class Feed defaults false
      archived_at: optionalArchivedAt(),
      cpl: requiredNonNegativeCplDefaultZero(),      // leftover next first-class Feed has no cpl
      local: optionalLocalType(),
      source_sites: optionalSiteList(),
      inbound_phone_numbers: optionalInboundPhoneList(), // leftover next first-class Feed has none
      priority: requiredPriorityDefaultZero(),
      sheet_tab_name: optionalSheetTabName(),
    },
    { _id: true },
  )
}

// ── 2. Catalog identity unique + leftover nested browse ───

function keepOneCompanyPerImmutableSlugAndBrowseIndexNestedFeedEvidence(schema) {
  // today's field-level unique company_slug
  // today's non-unique active browse index
  // today's non-unique nested granularity_key / crm_label / inbound_phone_numbers
  // no named catalog, no leftover migration export
}

// ── 3. Selected Mongo database ────────────────────────────
// sourceCompanyOnTheSelectedMongoDatabase above
```

Read the primary path out loud: *hold the Source Company on `lead_source_companies` with a required immutable slug, a required display name, and an optional nested leftover-feed array. Do not invent the slug on validate. Keep the slug unique so leftover Registry elects one company. Keep nested Feeds on the document so M3 rollback can still read leftover CPL and leftover inbound phones, and never unique-index those nested keys — the live Feed unique lives on the next file. Default sheet projection to derived import. If this process already sits on the selected Mongo name, the getter returns the same model leftover Registry already imports. Overview counts still use the default export. Do not assign a Lead. Do not write a first-class Feed. Do not flip `active` default to false.*

That is the operation. An unnamed schema dump is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **There is no validate hook — and that is today’s contract, not a missing Form-Lead copy.** Leftover Registry `createOrUpdateSourceCompany` folds `company_slug` via leftover `normalizeKey` and stamps `name` / `owner_label` via leftover `canonical`. Schema `lowercase` / `trim` / `immutable` only fold the path when a caller set it, and they do **not** collapse internal whitespace the way leftover `normalizeKey` may. Do not add `pre("validate")` `stampTheSlugFromDisplay` so “hand insert matches Registry” — a silent stamp would change who a later leftover get-by-slug returns. Do not copy Form Lead’s lid / phone / Job fold onto this hook.

2. **Default export and getter are both today’s contract.** Leftover Registry write, leftover leftover-book seed, leftover health load, leftover Granot / RingCentral / reporting reads **ask** `getLeadSourceCompanyModel`. Leftover overview count and leftover historical-consolidation validate **ask** default `LeadSourceCompany`. Do not silently delete the getter so “Source Company matches Agent” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database **and** that leftover Registry still finds the same rows. Do not silently move leftover overview onto the getter in the same pass as this rename so “every catalog count matches health” — that is leftover overview’s **interface**, not this one. Do not move leftover historical-consolidation’s `LeadSourceCompany` validate onto the getter in the same pass as this rename.

3. **Schema `active` default `true` is leftover of the nested book. Leftover Registry create stamps `false`.** Leftover leftover-book seed also stamps `active: true` and `created_from: "legacy_seed"`. Leftover `sourceModels.test.ts` constructs a company without `active` and relies on the schema default. Do not change this default to `false` so “schema matches Registry create” — a silent default change would rewrite who a bare `LeadSourceCompany.create` or leftover historical-consolidation `validateSync` treats as live.

4. **Embedded Feeds are evidence, not the live book.** Knowledge and already-recommended leftover Registry say first-class Feeds are the live book; leftover Registry create writes `granularities: []` and never appends. Leftover leftover-book seed still `$setOnInsert`s nested rows with leftover `cpl` and leftover `inbound_phone_numbers`. Do not delete the embedded sub-schema so “first-class is the only book” without a paired M3 rollback proof. Do not silently start appending nested rows from leftover Registry so “the nested book stays in sync.” Do not unique-index `{ "granularities.granularity_key": 1 }` so “embedded matches first-class unique” — two leftover seeded companies could share a leftover nested key shape that first-class later forbids globally.

5. **Embedded `active` default `true` is not first-class `active` default `false`.** Leftover next `LeadSourceGranularity.ts` defaults a new Feed to inactive and requires leftover Registry activate. This file’s nested row defaults to active so leftover seed’s omitted `active` still matches the old book. Do not flip the nested default so “embedded matches first-class” — leftover seed constructs would then insert inactive leftover evidence.

6. **Compatibility default keys are not first-class default refs.** Leftover leftover-book seed writes `default_*_granularity_key`. Leftover Registry writes `default_*_granularity` ObjectIds and still **returns** leftover keys when they exist on the document. Do not drop the key fields so “only ObjectId defaults remain” without a paired leftover-seed / M3 proof. Do not drop the ObjectId refs so “only leftover keys remain.”

7. **Exported type `LeadSourceGranularity` names the embedded row.** Leftover leftover-book imports that type. Leftover next file exports a **model value** of the same name on a different collection. Do not re-export leftover next `LeadSourceGranularityDocument` from this file so “one type owns both books.” Do not rename leftover leftover-book’s import in this pass so “the type name becomes first-class” without migrating that leftover file.

8. **Default `autoIndex` is today’s contract.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed leftover migrations. This file does neither. Do not silently set `autoIndex: false` so “Source Company matches Booking” without a paired report that boot still creates the unique slug / nested browse indexes **or** that a leftover migration will. Do not invent `SOURCE_COMPANY_SLUG_UNIQUE` so “every catalog row has a named catalog.”

9. **`unique: true` plus `index: true` on `company_slug` is today’s redundant declaration.** Unique already creates the index. Do not drop `unique` so “index-only matches Customer browse.” Do not treat the extra `index: true` as a second unique to delete in a way that drops uniqueness.

10. **No revision, no `__v` optimistic concurrency, no `sheet_sync`, no inverse Lead virtuals.** A Source Company is not a Lead and not a Booking. Do not spread leftover `aggregateRevisionSchemaFields` so “every SoR row matches Form.” Do not enable `optimisticConcurrency` so “Source Company matches Booking.” Do not add `sheet_sync[]` so “Source Company can project” — leftover `sheet_config` is workbook metadata, not a Sheet Sync outbox. Do not invent `form_leads_from_this_company` virtuals so “Source Company matches Agent” — leftover `previewSourceDependency` counts Form / Call collections itself.

11. **Leave sibling modules alone.** Leftover Registry write, leftover leftover-book seed, leftover Lead assignment, leftover overview count, leftover health load, leftover Granot company load, leftover historical-consolidation validate, and the leftover next first-class Feed row are already the right **depth**. This file holds the Source Company row.

## Testing

The **interface** is the test surface: `LeadSourceCompany` validate, the unique immutable slug, the selected-database getter, the embedded evidence defaults.

There is no `LeadSourceCompany.test.ts`. Today’s proofs sit on leftover callers: leftover `sourceModels.test.ts` constructs default `LeadSourceCompany` and locks `sheet_config.projection_mode === "derived_import"` plus preserved embedded `_id`; leftover Zod create schema (same file) refuses nested `granularities` and `active` on the **HTTP** write — that is leftover validation’s **interface**, not this one; leftover `leadSourceCompany.service.test.ts` stubs the getter for leftover seed / leftover list; leftover Registry / leftover health / leftover Granot tests stub `getLeadSourceCompanyModel`. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new Source Company requires `company_slug`, `name`, and `owner_label`.
- A row with empty `granularities` still validates.
- Validate does **not** invent `company_slug` from `name`.
- `company_slug` is immutable after set.
- `active` defaults to `true`.
- `created_from` defaults to `"admin"`.
- `sheet_config.projection_mode` defaults to `"derived_import"`.
- `sheet_config.has_bad_tabs` defaults to `false`.
- An embedded feed without `cpl` still validates at `0`.
- An embedded feed `active` defaults to `true`.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.

**Catalog identity**
- `company_slug` is unique.
- Nested `granularities.granularity_key` is indexed and **not** unique.
- Nested `granularities.crm_label` is indexed and **not** unique.
- Nested `granularities.inbound_phone_numbers` is indexed and **not** unique.
- There is no named unique-slug catalog export.

**Selected Mongo database**
- `getLeadSourceCompanyModel` is exported.
- When `mongoose.connection.name === getMongoDatabaseName()`, the getter returns the default `LeadSourceCompany`.
- Default `LeadSourceCompany` remains exported.

Do **not** add a test per helper (`requiredImmutableUniqueSlug`, `embeddedFeedEvidenceList`). Those names exist so the parent reads. Do **not** HTTP leftover Registry create from this file’s tests. Do **not** assign a Lead from this file’s tests. Do **not** write a first-class Feed from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the unique slug.”

There is no named index export to keep for a second leftover migration **adapter** — this file has none.

## What I would not do

- A `LeadSourceCompanyModelService` / `SourceCompanyService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `embedded.ts` / `normalize.ts` split for cleanliness.
- Breaking the selected-database **seam** by deleting `getLeadSourceCompanyModel` without a paired proof. Leftover Registry must not write live `lead_source_companies` while `TEST_MODE` selected `testvantagemovers`.
- Breaking the default-connection **seam** by deleting `LeadSourceCompany` without a paired proof that leftover overview still counts the same rows.
- Treating leftover `createOrUpdateSourceCompany` / leftover activation as this story. Those functions own the Owner transaction and the Change row.
- Treating already-recommended leftover leftover-book seed / leftover match as this story. Those functions own `$setOnInsert` nested Feeds and leftover CPL reads.
- Treating already-recommended `assignLeadSource` as this story. That function asks leftover Registry and stamps the Lead.
- Treating leftover next `LeadSourceGranularity.ts` as this story. That collection is the live Feed.
- Treating leftover next `LeadSourceLabelMapping.ts` as this story.
- Inventing a unique-nested-key **seam** so “embedded uniqueness lives on the schema.”
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database **seam** that has only one live **adapter** — today’s getter already has leftover Registry, leftover leftover-book, leftover health, leftover Granot, leftover RingCentral, and leftover reporting as homes.
- Silently flipping schema `active` default to `false` so “schema matches Registry create.”
- Silently flipping embedded `active` default to `false` so “embedded matches first-class.”
- Silently deleting `granularities[]` so “first-class is the only book.”
- Silently appending nested Feeds from leftover Registry so “the nested book stays in sync.”
- Silently dropping compatibility default keys so “only ObjectId defaults remain.”
- Silently enabling `optimisticConcurrency` or leftover revision fields so “Source Company matches Booking.”
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
