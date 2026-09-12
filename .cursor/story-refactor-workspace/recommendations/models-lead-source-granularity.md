# Remember The First-Class Feed Row On The Selected Mongo Database, Keep One Feed Per Immutable Globally Unique Key, And Hold Schedule Revision For CPL Optimistic Concurrency — Never Assign A Lead, Write CPL Periods, Or Stamp Inbound Phones Here, Never Unique-Index CRM Label Or Source Sites, Never Flip Schema Active-Default To True So Embedded Matches, Never Delete The Getter Because Overview Already Follows It — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 8 of this service — `LeadSourceGranularity.ts`
- Remaining in this service: `LeadSourceLabelMapping.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/LeadSourceGranularity.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (System of Record is Operations Registry catalog collection `lead_source_granularities`. `granularity_key` is immutable. Exact key / CRM label / source-site must resolve uniquely among **active** same-channel records. First-class Feeds are the live book. Embedded `granularities[]` is M3 migration/rollback evidence only. Employee Booking validation and leftover admin facets read first-class Feeds. Knowledge resource list names leftover Registry, leftover leftover-book, leftover Lead assignment — do not add a Models Service file in this rename so “the Service sentence wins”). Leftover Owner write: already-recommended [operations-registry-source-registry.md](operations-registry-source-registry.md) (`recordOrCorrectASourceFeed` **asks** `getLeadSourceGranularityModel`, creates `active: false` + `schedule_revision: 0`, never appends leftover nested company Feeds). Leftover Owner setup persist: already-recommended [operations-registry-lead-source-setup.md](operations-registry-lead-source-setup.md) (`persistNewSourceGranularityInSession` **asks** the getter). Leftover leftover book: already-recommended [lead-source-companies-lead-source-company.md](lead-source-companies-lead-source-company.md) (types leftover nested rows from already-recommended [models-lead-source-company.md](models-lead-source-company.md) — **this file never seeds**). Leftover Lead assignment: already-recommended [leads-source-company.md](leads-source-company.md) (**asks** leftover Registry fail-closed resolve — **this file never assigns**). Leftover overview count: already-recommended [operations-registry-queries-overview.md](operations-registry-queries-overview.md) (**asks** `getLeadSourceGranularityModel().countDocuments` — **not** the default; leftover company overview still **asks** default `LeadSourceCompany`). Leftover health load: already-recommended [operations-registry-queries-health.md](operations-registry-queries-health.md) (**asks** the getter). Leftover CPL revision: already-recommended [operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md) (`compareAndIncrementRevision` **asks** the getter’s `$inc` on `schedule_revision`). Distinct from already-recommended company row: [models-lead-source-company.md](models-lead-source-company.md) (exported **type** `LeadSourceGranularity` is the **embedded** subdocument with leftover `cpl` + leftover inbound phones, nested `active` default **true**, nested key **not unique** — **do not merge that type into this model**). Distinct from leftover next label mapping: `LeadSourceLabelMapping.ts`. Distinct from leftover next CPL period: `CplRatePeriod.ts` (writable leftover cents — **this file never stores `cpl`**). Distinct from leftover next inbound route: `RingCentralInboundRoute.ts` (writable leftover inbound phones — **this file never stores `inbound_phone_numbers`**). Distinct from already-recommended Agent / Customer rows: [models-agent.md](models-agent.md), [models-customer.md](models-customer.md) (those files have **no** selected-database getter — **do not delete `getLeadSourceGranularityModel` so “Feed matches Agent”**). Distinct from already-recommended Form / Call / Booking / Cancellation rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md), [models-booked-lead.md](models-booked-lead.md), [models-cancelled-lead.md](models-cancelled-lead.md) (those files set `autoIndex: false` and named catalogs — **do not copy that fence here**). Distinct from leftover historical relax: this checkout has **no** `historical/LeadSourceGranularity.ts` — leftover historical-consolidation validate **asks** default `LeadSourceGranularity` on this file. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge does **not** define Source Granularity here; do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model.** Leftover `operationsRegistry/sourceRegistry.ts` **asks** `getLeadSourceGranularityModel` for list / get / create (`active: false`, `schedule_revision: 0`) / patch / activation / leftover exact-identifier assert / leftover company-default check / leftover setup persist. Leftover `leadSourceSetup.ts`, leftover `queries/leadSourceProjection.ts`, leftover `queries/health.ts`, leftover `queries/overview.ts` (Feed **count**, not company count), leftover `labelMappings.ts`, leftover `ownerGranotNames.ts`, leftover `granotCrmSources.ts`, leftover `granotCrmSourceProjections.ts`, leftover `ringCentralRegistry.ts`, leftover `ringCentralSnapshot.ts`, leftover `cplSchedule.ts`, leftover `cplCorrections.ts` **ask** the getter. Already-recommended leftover `createLeadFromGranot.ts` / leftover Owner Booking / Release commands / leftover `sourcePolicy.ts` / leftover `ringcentral/callLeadConvergence.service.ts` / leftover `reporting/registryFilters.ts` **ask** the getter. Leftover `historicalConsolidation/schemaValidation.ts` **asks** default `LeadSourceGranularity` to `validateSync` a planned insert. Leftover `sourceModels.test.ts` **asks** default `new LeadSourceGranularity` (`active === false`, `schedule_revision === 0`). Leftover admin / analytics / RingCentral / Granot replica tests stub or create through the getter. There is no `LeadSourceGranularity.test.ts`. Not this **interface**: leftover `createOrUpdateSourceGranularity` itself, leftover activation itself, leftover leftover-book seed itself, leftover `assignLeadSource` itself, leftover CPL period write itself.
- Seams callers need: default `LeadSourceGranularity` (first-registered connection — leftover historical-consolidation validate, leftover `sourceModels` construct) vs `getLeadSourceGranularityModel()` (selected `getMongoDatabaseName()` — leftover Registry write, leftover setup persist, leftover overview Feed count, leftover health load, leftover CPL revision CAS, leftover Granot / RingCentral / reporting reads); field-level unique immutable `{ granularity_key: 1 }` vs leftover Registry `normalizeKey` + service-level duplicate find; schema `active` default **`false`** vs already-recommended company schema `active` default **`true`** and leftover nested-feed `active` default **`true`**; `schedule_revision` default `0` vs leftover CPL `$inc` CAS; immutable `source_company` ObjectId vs leftover nested company array; schema `channel` **not** immutable vs leftover Registry freeze after `active` or `activated_at`; browse-indexed `crm_label` / `source_sites` **not** unique vs leftover `assertExactIdentifiersAvailable` among **active same-channel** rows; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence; exported **model value** `LeadSourceGranularity` vs already-recommended company’s exported **type** of the same name. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Lead-assignment **seam**. There is no CPL-period **seam**.
- Split later (only if the file outgrows one sitting): this ~82-line file is one sitting if you read it as remember the first-class Feed row on the selected Mongo database, keep one Feed per immutable globally unique key, and hold schedule revision for CPL optimistic concurrency — never assign a Lead, write CPL periods, or stamp inbound phones here, never unique-index CRM label or source sites, never flip schema active-default to true so embedded matches, never delete the getter because overview already follows it. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `revision.ts`. Owner write stays already-recommended `sourceRegistry.ts`. Leftover nested-book seed stays already-recommended `leadSourceCompany.service.ts`. Lead assignment stays already-recommended `leads/leadSourceCompany.ts`. Leftover CPL periods stay leftover next `CplRatePeriod.ts`. Leftover next label mapping stays leftover `LeadSourceLabelMapping.ts`.

`LeadSourceGranularity` is a Mongoose model name. The owner question is: *Owner just named this Feed in the catalog — or leftover CPL is about to bump its schedule revision. Hold the row on `lead_source_granularities`. Keep the key unique and immutable so leftover Registry cannot elect a second Feed. Keep `schedule_revision` on the document so leftover CPL can compare-and-increment. If this process selected a different Mongo database, hand back that database’s Feed model. Do not assign a Lead. Do not write a CPL period. Do not stamp inbound phones. Do not unique-index `crm_label` or `source_sites`. Do not flip `active` default to true so “first-class matches embedded.” Do not delete the getter so “Feed matches Agent” — leftover overview already counts through it. Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who record / activate already lives in already-recommended `sourceRegistry.ts`. Who seed the leftover nested book already lives in already-recommended `leadSourceCompany.service.ts`. Who assign this Lead already lives in already-recommended `leads/leadSourceCompany.ts`. Who write leftover CPL periods already lives in leftover next `CplRatePeriod.ts` plus already-recommended leftover `cplSchedule.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the first-class Feed row, keep one Feed per immutable globally unique key, and hold schedule revision for CPL optimistic concurrency” story, not “a Source Granularity model CRUD dump,” and not Record Or Correct A Source Feed / Assign The Lead's Source themselves:

1. **Hold the first-class Feed as the catalog System of Record row** — collection `lead_source_granularities`, timestamps, `toJSON` / `toObject` virtuals. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** revision catalog besides `schedule_revision`. **No** `sheet_sync[]`. **No** Ingestion Origin. **No** `cpl`. **No** `inbound_phone_numbers`. Declares required immutable `source_company` (ObjectId → leftover company, `index: true`), required immutable `granularity_key` (trim, schema `lowercase`, **unique**), required `channel` (`form` | `call` — **not** schema-immutable), required `owner_label` / `crm_label` (trim), `aliases[]` (default `[]`), required `active` (default **`false`**, `index: true`), optional `activated_at` / `archived_at` / `deactivation_reason`, optional `local` (`LOCAL_TYPES`), `source_sites[]` (default `[]`), required `priority` (default `0`), optional `sheet_tab_name` (trim), required `schedule_revision` (default `0`, min `0`), required `created_from` (trim, default `"admin"`). This beat does **not** invent `granularity_key` from `owner_label`. This beat does **not** collapse whitespace beyond trim. This beat does **not** activate. This beat does **not** stamp `activated_at`. A leftover Registry create may still refuse when key already exists.

2. **Keep one Feed per immutable globally unique key, and browse-index company / channel / label / sites / priority** — field-level unique `{ granularity_key: 1 }`. Compound non-unique `{ source_company: 1, channel: 1, active: 1 }`. Non-unique `{ crm_label: 1 }`. Non-unique `{ source_sites: 1 }`. Compound non-unique `{ source_company: 1, priority: -1 }`. None are named catalogs. None have a leftover `pnpm migration:*` apply path. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Unique is **global**, not per company. Leftover already-recommended company nested key is **not unique**. Leftover `assertExactIdentifiersAvailable` refuses a second **active same-channel** `crm_label` or `source_site`; this schema’s indexes do **not** enforce that. This beat does **not** unique-index aliases. This beat does **not** unique-index `(source_company, channel)`.

3. **Bind the selected Mongo database** — default export `LeadSourceGranularity` is `mongoose.models.LeadSourceGranularity ?? mongoose.model(...)`. `getLeadSourceGranularityModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Leftover Registry write, leftover setup persist, leftover overview Feed count, leftover health load, leftover CPL revision CAS, leftover Granot / RingCentral / reporting reads **ask** the getter. Leftover historical-consolidation validate and leftover `sourceModels` construct **ask** the default. This beat does **not** open `vantagemovershistorical`. This beat does **not** call `syncIndexes`.

`LeadSourceGranularityDocument` is the inferred row type. There is no unknown-state sentinel here. There is no named index export.

There is no record-this-Feed-in-the-catalog operation. Leftover `sourceRegistry.ts` elects that. There is no leftover-seed operation. Leftover `leadSourceCompany.service.ts` elects that on the **company** nested array. There is no CPL-period operation. Leftover next `CplRatePeriod.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the first-class Feed row on the selected Mongo database, keep one Feed per immutable globally unique key, and hold schedule revision for CPL optimistic concurrency — never assign a Lead, write CPL periods, or stamp inbound phones here, never unique-index CRM label or source sites, never flip schema active-default to true so embedded matches, never delete the getter because overview already follows it.” Leftover Registry write / leftover setup persist / leftover Lead assignment / leftover CPL schedule already live in deeper **modules**. Leftover already-recommended company nested evidence already lives in a sibling **module**. Do not pull those in. Do not invent a `LeadSourceGranularityModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent an `autoIndex: false` **adapter** so “Feed matches Booking” without a reviewed index migration. Do not invent a unique `{ crm_label: 1 }` **adapter** so “schema uniqueness matches leftover exact-identifier assert.” Do not invent a `pre("validate")` that stamps `granularity_key` from `owner_label` so “hand insert matches Registry.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `normalize.ts` / `revision.ts` each get a file.

Do not move leftover `normalizeKey` into this file so “the row owns the fold.” Do not merge this file into already-recommended `LeadSourceCompany.ts` so “one schema owns the company and the live Feed.” Do not merge this file into leftover next `CplRatePeriod.ts` so “the Feed owns leftover cents.” Do not merge this file into leftover next `LeadSourceLabelMapping.ts` so “one schema owns the Feed and the accepted label.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `LeadSourceGranularity` | `feedOnTheDefaultConnection` | leftover historical-consolidation validate and leftover `sourceModels` construct still import the default model |
| `getLeadSourceGranularityModel` | `feedOnTheSelectedMongoDatabase` | leftover Registry write, leftover setup persist, leftover overview Feed count, leftover health load, leftover CPL revision CAS, leftover Granot / RingCentral / reporting reads must follow `getMongoDatabaseName()` |
| `LeadSourceGranularityDocument` | `FirstClassFeedRow` | inferred document + `_id` |

Keep the old names as one-line aliases until leftover Registry, leftover setup, leftover overview, leftover health, leftover CPL, leftover Granot / RingCentral / reporting reads, leftover `sourceModels`, and leftover historical-consolidation validate migrate. Do not make callers learn `granularity_key` / `useDb` / `schedule_revision` as the domain language. Do **not** delete the default `LeadSourceGranularity` export so “everyone must call the getter” without a paired proof that leftover historical-consolidation still validates the same `lead_source_granularities` it validates today. Do **not** delete the getter so “Feed matches Agent” without a paired proof that leftover Registry and leftover overview still write/count the selected database. Do **not** re-export already-recommended company’s embedded type from this file so “one type owns both books.”

**No class for the workflow.** The one type that *does* earn a name is the pending catalog-identity contract:

```ts
type FirstClassFeedCatalogIdentity = {
  granularity_key: { unique: true; immutable: true; global: true }
  source_company: { immutable: true }
  schedule_revision: { default: 0; cas_for_cpl: true }
}
```

That is the handoff from “this process remembered a Feed” to “leftover Registry key lookup elects one row, and leftover CPL can compare-and-increment.” Do **not** add `{ crm_label: { unique: true } }` or `{ source_sites: { unique: true } }` onto that type so “exact-identifier uniqueness lives on the schema.” Do **not** drop `schedule_revision` so “the Feed is only a key.”

Leave leftover next `LeadSourceLabelMapping.ts` on that file. Leave leftover next `CplRatePeriod.ts` on that file. Leave leftover next `CplRate.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// LeadSourceGranularity.ts
// Owner just named this Feed in the catalog —
// or leftover CPL is about to bump its schedule revision.
// Hold the row on lead_source_granularities.
// Keep the key unique and immutable
// so leftover Registry cannot elect a second Feed.
// Keep schedule_revision so leftover CPL can
// compare-and-increment.
// If this process selected a different Mongo database,
// hand back that database's Feed model.
// Do not assign a Lead.
// Do not write a CPL period.
// Do not stamp inbound phones.
// Do not unique-index crm_label or source_sites.
// Do not flip active default to true
// so "first-class matches embedded."
// Do not delete the getter —
// leftover overview already counts through it.
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const feedOnTheDefaultConnection =
  mongoose.models.LeadSourceGranularity ??
  mongoose.model("LeadSourceGranularity", firstClassFeedSchema)

export function feedOnTheSelectedMongoDatabase() {
  const dbName = getMongoDatabaseName()
  if (mongoose.connection.name === dbName) return feedOnTheDefaultConnection
  const db = mongoose.connection.useDb(dbName, { useCache: true })
  return db.models.LeadSourceGranularity ??
    db.model("LeadSourceGranularity", firstClassFeedSchema)
}

export { feedOnTheDefaultConnection as LeadSourceGranularity }
export { feedOnTheSelectedMongoDatabase as getLeadSourceGranularityModel }

// ── 1. Hold the first-class Feed as the catalog System of Record row ─

const firstClassFeedSchema = rememberTheFirstClassFeedRow() // collection lead_source_granularities; default autoIndex; no leftover cpl

function rememberTheFirstClassFeedRow() {
  const schema = new Schema(
    {
      source_company: requiredImmutableCompanyRef(), // indexed; not unique
      granularity_key: requiredImmutableUniqueKey(), // lowercase + trim when set; not invented from owner_label
      channel: requiredFormOrCallChannel(),          // leftover Registry freezes after activate; schema does not
      owner_label: requiredTrimmedOwnerLabel(),
      crm_label: requiredTrimmedCrmLabel(),          // browse-indexed; not unique here
      aliases: optionalAliasList(),
      active: requiredActiveDefaultFalse(),          // leftover nested evidence defaults true
      activated_at: optionalFirstActivatedAt(),      // leftover Registry stamps once
      archived_at: optionalArchivedAt(),
      deactivation_reason: optionalDeactivationReason(),
      local: optionalLocalType(),
      source_sites: optionalSiteList(),              // browse-indexed; not unique here
      priority: requiredPriorityDefaultZero(),
      sheet_tab_name: optionalSheetTabName(),
      schedule_revision: requiredRevisionDefaultZero(), // leftover CPL CAS
      created_from: requiredOriginDefaultAdmin(),
    },
    { collection: "lead_source_granularities", timestamps: true },
  )
  keepOneFeedPerImmutableKeyAndBrowseIndexCompanyChannelLabelSitesAndPriority(schema)
  return schema
}

// ── 2. Catalog identity unique + leftover browse ───

function keepOneFeedPerImmutableKeyAndBrowseIndexCompanyChannelLabelSitesAndPriority(schema) {
  // today's field-level unique granularity_key
  // today's non-unique { source_company, channel, active }
  // today's non-unique crm_label / source_sites
  // today's non-unique { source_company, priority: -1 }
  // no named catalog, no leftover migration export
}

// ── 3. Selected Mongo database ────────────────────────────
// feedOnTheSelectedMongoDatabase above
```

Read the primary path out loud: *hold the first-class Feed on `lead_source_granularities` with a required immutable company pointer, a required immutable globally unique key, a required form-or-call channel, and a required schedule revision that starts at zero. Do not invent the key on validate. Keep the key unique so leftover Registry elects one Feed. Default a new Feed to inactive so leftover Registry activate is the only live path. Do not store leftover cents or leftover inbound phones on this row — those live on leftover next CPL periods and leftover next inbound routes. If this process already sits on the selected Mongo name, the getter returns the same model leftover Registry and leftover overview already import. Historical-consolidation validate still uses the default export. Do not assign a Lead. Do not write a CPL period. Do not flip `active` default to true.*

That is the operation. An unnamed schema dump is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **There is no validate hook — and that is today’s contract, not a missing Form-Lead copy.** Leftover Registry `createOrUpdateSourceGranularity` folds `granularity_key` via leftover `normalizeKey` and stamps `owner_label` / `crm_label` via leftover `canonical`. Schema `lowercase` / `trim` / `immutable` only fold the path when a caller set it, and they do **not** collapse internal whitespace the way leftover `normalizeKey` may. Do not add `pre("validate")` `stampTheKeyFromOwnerLabel` so “hand insert matches Registry” — a silent stamp would change who a later leftover get-by-key returns. Do not copy Form Lead’s lid / phone / Job fold onto this hook.

2. **Default export and getter are both today’s contract — and leftover overview already split them.** Leftover Registry write, leftover setup persist, leftover overview **Feed** count, leftover health load, leftover CPL revision CAS, leftover Granot / RingCentral / reporting reads **ask** `getLeadSourceGranularityModel`. Leftover historical-consolidation validate and leftover `sourceModels` construct **ask** default `LeadSourceGranularity`. Leftover overview still **asks** default `LeadSourceCompany` for the company count. Do not silently delete the getter so “Feed matches Agent” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database **and** that leftover overview still counts the same Feeds. Do not silently move leftover historical-consolidation’s `LeadSourceGranularity` validate onto the getter in the same pass as this rename. Do not silently move leftover company overview onto the getter in this pass so “every catalog count matches Feed overview” — that is leftover overview’s **interface**, not this one.

3. **Schema `active` default `false` is today’s first-class contract. Leftover nested evidence defaults `true`.** Leftover Registry create and leftover setup persist also stamp `active: false`. Leftover `sourceModels.test.ts` constructs a Feed without `active` and locks the schema default. Do not change this default to `true` so “first-class matches embedded” — a silent default change would rewrite who a bare `LeadSourceGranularity.create` or leftover historical-consolidation `validateSync` treats as live. Do not drop leftover Registry’s explicit `active: false` stamp so “schema default is enough” in the same pass as this rename.

4. **`channel` is not schema-immutable. Leftover Registry freezes it after first activate.** A never-activated draft may still change channel. Schema `immutable: true` on `channel` would refuse that leftover draft correct. Do not mark `channel` immutable so “every identity field matches key” without a paired leftover Registry proof. Do not drop leftover Registry’s activate-or-`activated_at` freeze so “schema is the only freeze.”

5. **`activated_at` is write-once in leftover Registry, optional on this schema.** Leftover `setSourceGranularityActivation` stamps it only when activating and it was empty. This file does **not** stamp it. Do not add `pre("save")` `stampActivatedAtWhenActive` so “the row owns first activate” — leftover Registry also writes the company default in that same command. Do not make `activated_at` required so “every Feed has a first-activate clock.”

6. **CRM label and source sites are browse indexes, not uniqueness.** Knowledge says exact identifiers must resolve uniquely among **active** same-channel records. Leftover `assertExactIdentifiersAvailable` is that service find (case-insensitive, active only). Two inactive drafts may share a CRM label. Do not unique-index `{ crm_label: 1 }` or `{ source_sites: 1 }` so “schema uniqueness matches leftover assert” — leftover inactive drafts and leftover cross-channel reuse would then fail insert.

7. **Unique key is global, not per company.** Leftover Registry duplicate find is `{ granularity_key }` with no `source_company` clause. Already-recommended company nested key is **not unique**. Do not change this unique to `{ source_company: 1, granularity_key: 1 }` so “Feed uniqueness matches a company-scoped mental model.” Do not unique-index the leftover nested key on the company file in this pass.

8. **There is no `cpl` and no `inbound_phone_numbers` — and that is today’s first-class contract.** Leftover cents live on leftover next `CplRatePeriod`. Leftover inbound phones live on leftover next `RingCentralInboundRoute`. Already-recommended company nested evidence still carries both. Do not add `cpl` so “first-class matches embedded.” Do not add `inbound_phone_numbers` so “the Feed owns leftover RC matching.” Do not read leftover nested `cpl` from this file.

9. **`schedule_revision` is leftover CPL optimistic concurrency, not Lead `domain_revision`.** Leftover `cplSchedule.compareAndIncrementRevision` `$inc`s when `schedule_revision` matches. Leftover Registry create stamps `0`. Schema min is `0`. Do not enable Mongoose `optimisticConcurrency` / `__v` so “Feed matches Booking.” Do not spread leftover `aggregateRevisionSchemaFields` so “every SoR row matches Form.” Do not reset `schedule_revision` on leftover Feed correct so “rename starts the CPL clock over.”

10. **Default `autoIndex` is today’s contract.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed leftover migrations. This file does neither. Do not silently set `autoIndex: false` so “Feed matches Booking” without a paired report that boot still creates the unique key / browse indexes **or** that a leftover migration will. Do not invent `FIRST_CLASS_FEED_KEY_UNIQUE` so “every catalog row has a named catalog.”

11. **Exported model value `LeadSourceGranularity` shares a name with already-recommended company’s embedded type.** Leftover leftover-book imports the **type** from the company file. Leftover `sourceModels` and leftover historical-consolidation import the **model** from this file. Do not re-export already-recommended `LeadSourceGranularity` (embedded type) from this file so “one type owns both books.” Do not rename leftover leftover-book’s import in this pass so “the type name becomes first-class” without migrating that leftover file.

12. **Leave sibling modules alone.** Leftover Registry write, leftover setup persist, leftover leftover-book seed, leftover Lead assignment, leftover overview count, leftover health load, leftover CPL revision CAS, leftover Granot Feed load, leftover historical-consolidation validate, leftover next label mapping, and leftover next CPL period are already the right **depth**. This file holds the first-class Feed row.

## Testing

The **interface** is the test surface: `LeadSourceGranularity` validate, the unique immutable key, the selected-database getter, the inactive / revision defaults.

There is no `LeadSourceGranularity.test.ts`. Today’s proofs sit on leftover callers: leftover `sourceModels.test.ts` constructs default `LeadSourceGranularity` and locks `active === false` plus `schedule_revision === 0` plus empty `aliases` / `source_sites`; leftover Registry / leftover health / leftover overview / leftover CPL / leftover Granot tests stub `getLeadSourceGranularityModel`. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new Feed requires `source_company`, `granularity_key`, `channel`, `owner_label`, and `crm_label`.
- Validate does **not** invent `granularity_key` from `owner_label`.
- `granularity_key` is immutable after set.
- `source_company` is immutable after set.
- `channel` is **not** schema-immutable.
- `active` defaults to `false`.
- `schedule_revision` defaults to `0`.
- `created_from` defaults to `"admin"`.
- `aliases` and `source_sites` default to `[]`.
- The schema has **no** `cpl` path.
- The schema has **no** `inbound_phone_numbers` path.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.

**Catalog identity**
- `granularity_key` is unique.
- `{ source_company, channel, active }` is indexed and **not** unique.
- `crm_label` is indexed and **not** unique.
- `source_sites` is indexed and **not** unique.
- `{ source_company, priority }` is indexed and **not** unique.
- There is no named unique-key catalog export.

**Selected Mongo database**
- `getLeadSourceGranularityModel` is exported.
- When `mongoose.connection.name === getMongoDatabaseName()`, the getter returns the default `LeadSourceGranularity`.
- Default `LeadSourceGranularity` remains exported.

Do **not** add a test per helper (`requiredImmutableUniqueKey`, `requiredActiveDefaultFalse`). Those names exist so the parent reads. Do **not** HTTP leftover Registry create from this file’s tests. Do **not** assign a Lead from this file’s tests. Do **not** write a CPL period from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the unique key.”

There is no named index export to keep for a second leftover migration **adapter** — this file has none.

## What I would not do

- A `LeadSourceGranularityModelService` / `SourceGranularityService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `normalize.ts` / `revision.ts` split for cleanliness.
- Breaking the selected-database **seam** by deleting `getLeadSourceGranularityModel` without a paired proof. Leftover Registry and leftover overview must not write/count live `lead_source_granularities` while `TEST_MODE` selected `testvantagemovers`.
- Breaking the default-connection **seam** by deleting `LeadSourceGranularity` without a paired proof that leftover historical-consolidation still validates the same rows.
- Treating leftover `createOrUpdateSourceGranularity` / leftover activation as this story. Those functions own the Owner transaction, leftover exact-identifier assert, leftover company-default write, and the Change row.
- Treating already-recommended leftover leftover-book seed as this story. That function owns `$setOnInsert` nested Feeds on the **company**.
- Treating already-recommended `assignLeadSource` as this story. That function asks leftover Registry and stamps the Lead.
- Treating leftover next `CplRatePeriod.ts` / leftover `cplSchedule.ts` as this story. Those files own leftover cents and the `$inc`.
- Treating leftover next `LeadSourceLabelMapping.ts` as this story.
- Treating leftover next `RingCentralInboundRoute.ts` as this story.
- Inventing a unique-CRM-label **seam** so “exact-identifier uniqueness lives on the schema.”
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database **seam** that has only one live **adapter** — today’s getter already has leftover Registry, leftover setup, leftover overview Feed count, leftover health, leftover CPL, leftover Granot, leftover RingCentral, and leftover reporting as homes.
- Silently flipping schema `active` default to `true` so “first-class matches embedded.”
- Silently adding `cpl` or `inbound_phone_numbers` so “first-class matches embedded.”
- Silently marking `channel` immutable so “every identity field matches key.”
- Silently unique-indexing `{ source_company, granularity_key }` so “uniqueness is per company.”
- Silently enabling `optimisticConcurrency` or leftover Lead revision fields so “Feed matches Booking.”
- Silently moving leftover company overview onto this getter so “every catalog count matches.”
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
