# Remember The Granot CRM Source As Both The CSV Catalog Row And The Only Semantic Granot Name, Leave Unreviewed Cards Operationally On Lifecycle Off Deferred And Observation-Only, Refuse A Structurally Illegal Card On Validate Without Loading Company Or Feed Refs, Stamp Named Lifecycle Indexes Without Applying The Folded-Label Unique Until Unit 06, And Bind The Selected Mongo Database — Never Record Or Correct The Card Here, Never Resolve A Live Observation, Never Send A Text, Never Fold The Label Here, Never Merge The Semantics Helper — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 31 of this service — `GranotCrmSource.ts`
- Remaining in this service: `granotCrmSourceSemantics.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotCrmSource.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (`GranotCrmSource` is the Owner card for a Granot label plus lifecycle semantics; writes stay on leftover `granotCrmSources.ts` / leftover `crmSourceOutboundSms.ts` — **this file never records or texts**). Runtime read: [`docs/knowledge/granot-lifecycle/source-policy.md`](../../../docs/knowledge/granot-lifecycle/source-policy.md) (leftover `sourcePolicy.ts` leftover-loads this collection by exact `normalized_granot_label`; zero matches / multiple matches fail closed — **this file never resolves**). CSV catalog: there is **no** dedicated Service file in `docs/knowledge/services/` for leftover `granotCrmCsv/`. Software map: [`.cursor/rules/granot-crm-csv-s3-sync.mdc`](../../../.cursor/rules/granot-crm-csv-s3-sync.mdc). Already-recommended leftover seed / leftover-find: [granot-crm-csv-registry.md](granot-crm-csv-registry.md) (leftover-seeds / leftover-finds by `{ crm_origin, workspace_slug }` — **this file never seeds**). Already-recommended leftover upload leftover-stamps `last_ingestions`: [granot-crm-csv-upload.md](granot-crm-csv-upload.md). Customer text: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) (leftover `granotCreatedLead.ts` leftover-reads `outbound_sms` — **this file never sends**). Compatibility rule: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections already names `GranotCrmSource` (`granot_crm_sources`) as the operational CSV catalog **and** the only semantic Granot source Registry; additive lifecycle fields default `lifecycle_enabled=false` / `lifecycle_disposition=deferred` / `lead_created_policy=observation_only` / empty routes; optional `outbound_sms` defaults off / `not_attested`; `create_if_missing` does not send texts; do not repurpose leftover string `source_company` as `lead_source_company`; unique `{ normalized_granot_label: 1 }` is declared but not cluster-applied until Unit 06 collision inventory is zero — do not rewrite that paragraph from this rename. Already-recommended leftover Owner write: [operations-registry-granot-crm-sources.md](operations-registry-granot-crm-sources.md) (**asks** `getGranotCrmSourceModel` + leftover next `validateGranotCrmSourceSemantics` **with refs**). Already-recommended leftover SMS: [operations-registry-crm-source-outbound-sms.md](operations-registry-crm-source-outbound-sms.md). Already-recommended leftover runtime resolve: [granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md). Already-recommended leftover CSV registry: [granot-crm-csv-registry.md](granot-crm-csv-registry.md). Already-recommended leftover Source Company / Feed rows: [models-lead-source-company.md](models-lead-source-company.md) / [models-lead-source-granularity.md](models-lead-source-granularity.md) (`lead_source_company` / `lifecycle_routes.source_granularity_id` leftover-ref those collections — **do not merge**). Already-recommended leftover factory: [models-granot-discrepancy-model.md](models-granot-discrepancy-model.md) (fight-row hooks / no collection — **do not copy those hooks here**). Leftover next semantics helper: leftover next `granotCrmSourceSemantics.ts` (`validateGranotCrmSourceSemantics` + disposition / policy / route enums — **this file leftover-asks it without refs**; **do not merge**). Leftover later CSV ingestion / sync-run / automation source: leftover later `GranotCrmCsvIngestion.ts` / `GranotCrmSyncRun.ts` / `GranotAutomationSource.ts` — **do not merge**. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links Granot CRM Source; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection construct.** Already-recommended leftover `granotCrmSources.ts` **asks** `getGranotCrmSourceModel` for list / get / persist (`create` / `findByIdAndUpdate` `$set` with `runValidators: true`) / activation load. Already-recommended leftover `crmSourceOutboundSms.ts` **asks** the getter to `$set outbound_sms`. Already-recommended leftover `sourcePolicy.ts` `createMongoSourcePolicyStore.findByNormalizedLabel` **asks** the getter `.find({ normalized_granot_label })` (multiple rows stay possible until Unit 06 unique applies). Already-recommended leftover `granotCrmCsv/registry.ts` **asks** the getter to leftover-seed / leftover-list / leftover-find `{ crm_origin, workspace_slug }` / leftover-`save` a `csv_paths` patch; leftover `upload.service.ts` leftover-stamps `last_ingestions`. Leftover `ownerGranotNames.ts` / leftover `leadSourceProjection.ts` / leftover `queries/health.ts` / leftover `granotAutomationSources.ts` / leftover `leadMessaging/granotCreatedLead.ts` / leftover `projections.ts` / leftover Owner Booking / Referral / Release commands / leftover `receiptSearch.ts` **ask** the getter. `GranotCrmSource.test.ts` leftover-constructs default `new GranotCrmSource` and leftover-asks leftover next `validateGranotCrmSourceSemantics` **with refs** on the same file (those leftover-ref proofs are leftover next helper’s **interface**). Replica leftover-seeds leftover-use `.collection.insertOne` (hooks **do not** run). Not this **interface**: leftover `createOrUpdateGranotCrmSource` itself, leftover `setGranotCrmSourceOutboundSms` itself, leftover `resolveSourcePolicy` itself, leftover `seedGranotCrmSources` itself, leftover `validateGranotCrmSourceSemantics` itself, leftover `normalizeGranotSourceLabel` itself.
- Seams callers need: default `GranotCrmSource` (first-registered connection — leftover `GranotCrmSource.test.ts` construct / leftover schema.indexes) vs `getGranotCrmSourceModel()` (selected `getMongoDatabaseName()` — leftover Registry write, leftover CSV seed, leftover sourcePolicy find, leftover SMS / messaging / health / Owner reads); CSV unique `{ crm_origin, workspace_slug }` (unnamed, live) vs named unique `{ normalized_granot_label: 1 }` (`granot_crm_source_normalized_label_unique` — declared, leftover Registry leftover-checks in-session, **not** cluster-applied until Unit 06); leftover string `source_company` (`sourceCompanyField`, default `"not_provided"`) vs ObjectId `lead_source_company` (ref leftover Source Company — **do not alias**); mongoose `pre("validate")` leftover-asks leftover next semantics **without refs** (structural + policy pairing only; leftover-invalidates `lifecycle_disposition`) vs leftover Registry persist leftover-asks leftover next semantics **with** leftover-loaded company / Feed refs; leftover `enabled` default **true** vs leftover `lifecycle_enabled` default **false**; leftover `findOneAndUpdate` upsert seed **without** `runValidators` vs leftover Registry `$set` **with** `runValidators: true` vs leftover mongoose `save()` (hooks run) vs leftover `.collection.insertOne` (hooks **do not** run); leftover `outbound_sms` optional nested (defaults off / `not_attested` / `daily_cap` 0 when present) vs leftover SMS command; leftover `last_ingestions` / leftover `csv_paths` vs leftover CSV upload; `timestamps: true` / `autoIndex: false` vs leftover `pnpm migration:granot-lifecycle:indexes`. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no authorization **seam**. There is no fold **seam**. There is no send **seam**.
- Split later (only if the file outgrows one sitting): this ~257-line file is one sitting if you read it as remember the Granot CRM source as both the CSV catalog row and the only semantic Granot name, leave unreviewed cards operationally on / lifecycle off / deferred / observation-only, refuse a structurally illegal card on validate without loading company or Feed refs, stamp named lifecycle indexes without applying the folded-label unique until Unit 06, and bind the selected Mongo database — never record or correct the card here, never resolve a live Observation, never send a text, never fold the label here, never merge the semantics helper. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `lifecycle.ts` / `csv.ts` / `sms.ts`. Leftover Owner write stays already-recommended `granotCrmSources.ts`. Leftover SMS stays already-recommended `crmSourceOutboundSms.ts`. Leftover runtime resolve stays already-recommended `sourcePolicy.ts`. Leftover CSV seed stays already-recommended `granotCrmCsv/registry.ts`. Leftover next semantics stays leftover `granotCrmSourceSemantics.ts`.

`GranotCrmSource` is a Mongoose model name. The owner question is: *This is the one row that says which Granot workspace label we know, where its CSV files live, and — once reviewed — what a matching Observation may become. Hold it on `granot_crm_sources`. A brand-new card stays operationally on, lifecycle off, deferred, and observation-only, with no routes and no customer text. The CSV world still keys the row by origin plus workspace slug. The lifecycle world leftover-folds the label elsewhere and leftover-looks it up exactly. On validate, refuse a structurally illegal card without loading the company or the Feeds. Stamp the named lifecycle indexes here and leave `autoIndex` off so the cluster unique on the folded label waits for the Unit 06 inventory. If this process selected a different Mongo database, hand back that database’s model. Do not record the Owner card. Do not resolve a live Observation. Do not send a text. Do not fold the label. Do not treat leftover string `source_company` as the live Source Company.*

Who leftover-records / leftover-corrects / leftover-turns lifecycle on already lives in already-recommended `granotCrmSources.ts`. Who leftover-turns customer text on already lives in already-recommended `crmSourceOutboundSms.ts`. Who leftover-resolves a live label already lives in already-recommended `sourcePolicy.ts`. Who leftover-seeds the CSV catalog already lives in already-recommended `granotCrmCsv/registry.ts`. Who leftover-judges structure **with** company / Feed refs already lives in leftover next `granotCrmSourceSemantics.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Granot CRM source as both the CSV catalog row and the only semantic Granot name, leave unreviewed cards operationally on / lifecycle off / deferred / observation-only, refuse a structurally illegal card on validate without loading company or Feed refs, stamp named lifecycle indexes without applying the folded-label unique until Unit 06, and bind the selected Mongo database” story, not “a Granot CRM source model CRUD dump,” and not Record Or Correct A Granot CRM Source Policy / Resolve Source Policy themselves:

1. **Hold the Granot CRM source as the CSV catalog row and the only semantic Granot name** — collection `granot_crm_sources`, `timestamps: true`, `autoIndex: false`. Required `crm_origin` / `workspace_slug` (trim, field `index: true`). Required `granot_label` (trim). Required `default_channel` enum leftover `GRANOT_CRM_CHANNELS` (`form` | `call` | `unknown`, default `"unknown"`). Leftover string `source_company` via leftover `sourceCompanyField` (required, default `"not_provided"`, indexed) — **not** leftover `lead_source_company`. Nested `csv_paths` (`follow_up` / `booked`, no `_id`). Required `enabled` (default **`true`**, indexed). Optional `notes`. Nested `last_ingestions.follow_up` / `.booked` (`content_sha256`, `ingestion_id` → leftover later `GranotCrmCsvIngestion`, `s3_key`, `imported_at`). Optional `normalized_granot_label` (trim, schema `lowercase` — this beat does **not** NFKC / collapse / reject bidi). Required `lifecycle_enabled` default **`false`**. Required `lifecycle_disposition` enum leftover next `GRANOT_LIFECYCLE_DISPOSITIONS` default `"deferred"`. Required `lead_created_policy` enum leftover next `GRANOT_LEAD_CREATED_POLICIES` default `"observation_only"`. Optional `lead_source_company` ObjectId → leftover Source Company. `lifecycle_routes[]` default `[]` (`route_key`, `lead_model` leftover next `GRANOT_LIFECYCLE_LEAD_MODELS`, `move_type` leftover next `GRANOT_LIFECYCLE_MOVE_TYPES`, required `source_granularity_id` → leftover Feed). `lifecycle_policy_version` default `""`. Optional nested `outbound_sms` (`enabled` default `false`, `trigger` leftover `OUTBOUND_SMS_TRIGGERS` default `"granot_lead_created"`, `body_template` max 320, `template_version` default `1`, `consent_basis` leftover `OUTBOUND_SMS_CONSENT_BASES` default `"not_attested"`, optional leftover actor attest, `daily_cap` default `0`, optional activate / deactivate clocks). This beat does **not** leftover-seed. This beat does **not** leftover-stamp `last_ingestions`. This beat does **not** leftover-enable SMS. A leftover Registry create may still refuse a duplicate folded label in-session.

2. **Refuse a structurally illegal card on validate without loading company or Feed refs** — `pre("validate")` leftover-maps leftover `lifecycle_routes` and leftover-asks leftover next `validateGranotCrmSourceSemantics({ … })` **with no `refs`**. Fail leftover-invalidates leftover field `lifecycle_disposition` with leftover `result.message`. Leftover `enabled !== false` leftover-counts as operationally on. Leftover `lifecycle_enabled === true` leftover-is the only true. Leftover empty `normalized_granot_label` leftover-passes `undefined` (does **not** leftover-fold `granot_label` here). This beat leftover-catches leftover mixed Call/Form routes, leftover illegal Call / Form shapes, leftover duplicate `route_key` / leftover selectors, leftover `create_if_missing` off leftover `source_scoped_lead`, leftover `referral_booking` / leftover `deferred` with leftover routes or leftover non-`observation_only`. This beat does **not** leftover-load leftover Source Company. This beat does **not** leftover-load leftover Feeds. This beat does **not** leftover-refuse leftover `lifecycle_enabled` on an leftover-inactive leftover company — leftover Registry persist leftover-asks leftover next helper **with refs** for that. This beat does **not** leftover-unique leftover `normalized_granot_label`.

3. **Stamp named lifecycle indexes without applying the folded-label unique until Unit 06, and bind the selected Mongo database** — unnamed unique `{ crm_origin: 1, workspace_slug: 1 }`. Per leftover `GRANOT_CRM_CSV_KINDS` leftover-index `{ csv_paths.<kind>: 1 }`. Then leftover-loop leftover `GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES`: unique `granot_crm_source_normalized_label_unique` on `{ normalized_granot_label: 1 }`; non-unique `granot_crm_source_lifecycle_disposition_label`; non-unique `granot_crm_source_lifecycle_route_granularity`. `autoIndex: false` — leftover `pnpm migration:granot-lifecycle:indexes` leftover-applies leftover named leftover indexes after leftover review; leftover Unit 06 leftover-still leftover-holds leftover unique leftover-label leftover-apply until leftover collision leftover-inventory is leftover-zero. Default export `GranotCrmSource` is `mongoose.models.GranotCrmSource ?? mongoose.model(...)`. `getGranotCrmSourceModel()` leftover-returns that leftover-same leftover-model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise leftover-`useDb` leftover-and leftover-register leftover-there. This beat does **not** leftover-`syncIndexes`. This beat does **not** leftover-open leftover `vantagemovershistorical`.

`GranotCrmSource` the exported type leftover-omits leftover inferred `last_ingestions` and leftover-re-adds leftover `Partial<Record<GranotCrmCsvKind, GranotCrmLastIngestion>>` plus leftover `_id`. `GranotCrmSourceDocument` is the leftover hydrated leftover document.

There is no record-or-correct operation. Leftover `createOrUpdateGranotCrmSource` elects that. There is no resolve-this-label operation. Leftover `resolveSourcePolicy` elects that. There is no send-a-text operation. Leftover `setGranotCrmSourceOutboundSms` / leftover `granotCreatedLead.ts` elect that.

## Organization

Keep one file. This is the screenplay for “remember the Granot CRM source as both the CSV catalog row and the only semantic Granot name, leave unreviewed cards operationally on / lifecycle off / deferred / observation-only, refuse a structurally illegal card on validate without loading company or Feed refs, stamp named lifecycle indexes without applying the folded-label unique until Unit 06, and bind the selected Mongo database — never record or correct the card here, never resolve a live Observation, never send a text, never fold the label here, never merge the semantics helper.” Leftover Owner write / leftover SMS / leftover runtime resolve / leftover CSV seed already live in deeper **modules**. Leftover next semantics already lives in a sibling **module**. Do not pull those in. Do not invent a `GranotCrmSourceModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second selected-database **adapter** beside today’s getter. Do not invent a fold **adapter** so “the row owns NFKC.” Do not invent a refs **adapter** so “validate loads the company.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `lifecycle.ts` / `csv.ts` / `sms.ts` each get a file.

Do not move leftover `createOrUpdateGranotCrmSource` / leftover `resolveSourcePolicy` / leftover `validateGranotCrmSourceSemantics` into this file so “the row owns leftover persist and leftover resolve.” Do not merge this file into leftover next `granotCrmSourceSemantics.ts` so “one file owns the card and the judge.” Do not merge this file into leftover later `GranotAutomationSource.ts` so “automation owns the Granot name.” Do not merge this file into already-recommended leftover `LeadSourceCompany.ts` so “string `source_company` is the live company.” Do not copy already-recommended leftover discrepancy-factory hooks here so “CRM source is a fight desk.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotCrmSource` | `granotCrmSourceOnTheDefaultConnection` | leftover `GranotCrmSource.test.ts` leftover-constructs / leftover-reads leftover `schema.indexes` |
| `getGranotCrmSourceModel` | `granotCrmSourceOnTheSelectedMongoDatabase` | leftover Registry write, leftover CSV seed, leftover sourcePolicy find, leftover SMS / messaging / health / Owner reads must follow `getMongoDatabaseName()` |
| `GRANOT_CRM_SOURCE_COLLECTION` | `GranotCrmSourcesCollectionName` | leftover migration leftover-asks leftover `granot_crm_sources` |
| `GRANOT_CRM_SOURCE_MODEL_NAME` | `GranotCrmSourceModelName` | leftover `mongoose.models` leftover-reuse leftover-key |
| `GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES` | `NamedLifecycleIndexCatalog` | leftover `pnpm migration:granot-lifecycle:indexes` leftover-stamps leftover names; leftover unique leftover-label leftover-stays leftover-declared |
| `GRANOT_CRM_CHANNELS` | `CsvDefaultChannelWords` | leftover `form` / leftover `call` / leftover `unknown` |
| `GranotCrmSource` (type) | `GranotCrmSourceRow` | leftover inferred leftover row + leftover typed leftover `last_ingestions` |
| `GranotCrmSourceDocument` | `HydratedGranotCrmSourceRow` | leftover CSV leftover-`save` / leftover Registry leftover-`create` leftover-return |

Keep the old names as one-line aliases until leftover Registry, leftover CSV registry, leftover sourcePolicy, leftover SMS / messaging, leftover health, leftover Owner reads, leftover migration, and leftover `GranotCrmSource.test.ts` migrate. Do not make callers learn `useDb` / `autoIndex` / `normalized_granot_label` as the domain language. Do **not** delete the default `GranotCrmSource` export so “everyone must call the getter” without a paired proof that leftover construct tests still see the same schema. Do **not** delete the getter so “CRM source matches Agent” without a paired proof that leftover Registry still writes the selected database. Do **not** re-export leftover `validateGranotCrmSourceSemantics` / leftover `createOrUpdateGranotCrmSource` from this file so “the row owns leftover persist and leftover judge.”

**No class for the workflow.** The one type that *does* earn a name is the pending catalog-identity contract:

```ts
type GranotCrmSourceCatalogIdentity = {
  csv_key: { crm_origin: 1; workspace_slug: 1; unique: true }
  folded_label: { unique_declared: true; unique_cluster_applied: false }
  unreviewed: {
    enabled: true
    lifecycle_enabled: false
    lifecycle_disposition: "deferred"
    lead_created_policy: "observation_only"
    lifecycle_routes: []
    outbound_sms: "optional_off_not_attested"
  }
  source_company_string: "not_the_live_company"
  lead_source_company: "optional_object_id"
  validate_on_save: "structure_without_refs"
  timestamps: true
  autoIndex: false
}
```

That is the handoff from “this process remembered a Granot CRM source” to “leftover CSV leftover-upserts by origin plus slug, leftover Registry leftover-records leftover policy leftover-with leftover refs, leftover sourcePolicy leftover-finds leftover-exact leftover folded leftover labels and leftover-fails leftover-closed on leftover zero leftover-or leftover many, and leftover customer leftover-text leftover-stays leftover-off until leftover Owner leftover-attests.” Do **not** add `{ unique_cluster_applied: true }` so “schema unique is live.” Do **not** add `{ source_company: "LeadSourceCompany" }` so “the leftover string is the live company.” Do **not** add `{ validate_on_save: "with_refs" }` so “mongoose loads the Feeds.”

Leave leftover next `granotCrmSourceSemantics.ts` on that file. Leave leftover later `GranotCrmCsvIngestion.ts` / `GranotCrmSyncRun.ts` / `GranotAutomationSource.ts` on those files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotCrmSource.ts
// This is the one row that says which Granot workspace label we know,
// where its CSV files live, and — once reviewed —
// what a matching Observation may become.
// Hold it on granot_crm_sources.
// A brand-new card stays operationally on,
// lifecycle off, deferred, and observation-only,
// with no routes and no customer text.
// The CSV world still keys the row by origin plus workspace slug.
// The lifecycle world leftover-folds the label elsewhere
// and leftover-looks it up exactly.
// On validate, refuse a structurally illegal card
// without loading the company or the Feeds.
// Stamp the named lifecycle indexes here
// and leave autoIndex off so the cluster unique
// on the folded label waits for the Unit 06 inventory.
// If this process selected a different Mongo database,
// hand back that database's model.
// Do not record the Owner card.
// Do not resolve a live Observation.
// Do not send a text.
// Do not fold the label.
// Do not treat leftover string source_company as the live Source Company.

import { sourceCompanyField } from "./schemaHelpers"
import {
  GRANOT_LEAD_CREATED_POLICIES,
  GRANOT_LIFECYCLE_DISPOSITIONS,
  validateGranotCrmSourceSemantics,
} from "./granotCrmSourceSemantics"

// ── 1. Hold the CSV catalog row and the only semantic Granot name

export const GRANOT_CRM_SOURCE_COLLECTION = "granot_crm_sources"
export const GRANOT_CRM_CHANNELS = ["form", "call", "unknown"] as const
export type GranotCrmSource = { /* origin, slug, label, CSV paths, last ingestions, lifecycle, optional SMS */ }
export type GranotCrmSourceDocument = { /* hydrated row */ }

function rememberCsvIdentityByOriginAndWorkspaceSlug()
function leaveUnreviewedCardsOperationallyOnLifecycleOffDeferredAndObservationOnly()
function keepLegacySourceCompanyStringSeparateFromTheLiveCompanyRef()
function holdOptionalOutboundSmsOffAndNotAttested()
  // leftover SMS command leftover-writes this nest; leftover create_if_missing does not send

// ── 2. Refuse a structurally illegal card on validate without refs

function askTheSemanticsHelperWithoutLoadingCompanyOrFeeds()
  // leftover-invalidates lifecycle_disposition
  // leftover mixed Call/Form, leftover illegal shapes, leftover policy pairing
function leaveCompanyAndFeedActivityToTheRegistryPersist()
function leaveLabelFoldToTheLeftoverSourceLabelHelper()

// ── 3. Stamp named lifecycle indexes and bind the selected database

export const GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES = [
  { name: "granot_crm_source_normalized_label_unique", unique: true },
  { name: "granot_crm_source_lifecycle_disposition_label" },
  { name: "granot_crm_source_lifecycle_route_granularity" },
] as const
function keepTheLiveCsvUniqueOnOriginPlusWorkspaceSlug()
function declareTheFoldedLabelUniqueWithoutApplyingItUntilUnit06()
  // autoIndex: false — leftover migration leftover-asks leftover names
export const GranotCrmSource = mongoose.models.GranotCrmSource ?? mongoose.model(...)
export function getGranotCrmSourceModel()
  // leftover Registry / leftover CSV / leftover sourcePolicy leftover-ask this
```

Read the primary path out loud: *This is the one row that says which Granot workspace label we know, where its CSV files live, and — once reviewed — what a matching Observation may become. Hold it on `granot_crm_sources`. A brand-new card stays operationally on, lifecycle off, deferred, and observation-only, with no routes and no customer text. The CSV world still keys the row by origin plus workspace slug. The lifecycle world leftover-folds the label elsewhere and leftover-looks it up exactly. On validate, refuse a structurally illegal card without loading the company or the Feeds. Stamp the named lifecycle indexes here and leave `autoIndex` off so the cluster unique on the folded label waits for the Unit 06 inventory. If this process selected a different Mongo database, hand back that database’s model. Do not record the Owner card. Do not resolve a live Observation. Do not send a text. Do not fold the label. Do not treat leftover string `source_company` as the live Source Company.*

That is the operation. `GranotCrmSource` as “a schema dump with lifecycle fields” is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This is the row. It is not leftover persist, leftover resolve, leftover seed, or leftover judge.** Already-recommended leftover `granotCrmSources.ts` leftover-owns leftover Owner leftover-write leftover-plus leftover in-session leftover duplicate leftover-label leftover-check leftover-plus leftover refs. Already-recommended leftover `sourcePolicy.ts` leftover-owns leftover exact leftover-label leftover-resolve leftover-and leftover eight leftover gates. Leftover next `granotCrmSourceSemantics.ts` leftover-owns leftover structure leftover-and leftover contextual leftover refs. Do not move those in so “the model owns leftover persist.” Do not add `createOrUpdateGranotCrmSource` so “the row matches leftover Registry.”

2. **Two identities.** CSV leftover-keys leftover `{ crm_origin, workspace_slug }` leftover-unique leftover-and leftover-live. Lifecycle leftover-keys leftover `normalized_granot_label` leftover-declared leftover-unique leftover-and leftover-**not** leftover-cluster-applied. Leftover sourcePolicy leftover-`find`s leftover every leftover row leftover-with leftover that leftover folded leftover label leftover-and leftover-fails leftover-closed leftover-on leftover many. Leftover Registry leftover-refuses leftover a leftover second leftover card leftover in leftover the leftover same leftover session. Do not apply leftover unique leftover-label leftover-from leftover this leftover rename so “schema unique is live.” Do not drop leftover origin/workspace leftover unique so “the folded label is the only key.”

3. **`source_company` is a leftover string. `lead_source_company` is the live company.** Leftover `sourceCompanyField` leftover-defaults leftover `"not_provided"`. Leftover Registry leftover-`buildUpdate` leftover-falls leftover-back leftover-to leftover that leftover string leftover-and leftover-writes leftover ObjectId leftover `lead_source_company` leftover separately. Do not alias them so “one field owns the company.” Do not drop leftover `source_company` so “CSV seed has nowhere to put `not_provided`.”

4. **`pre("validate")` leftover-asks leftover next helper leftover-without leftover `refs`.** Leftover inactive leftover company leftover / leftover wrong leftover channel leftover leftover-pass leftover mongoose leftover `validate()` leftover-and leftover-fail leftover Registry leftover persist. Leftover `GranotCrmSource.test.ts` leftover-proves leftover those leftover leftover-ref leftover cases leftover by leftover-calling leftover `validateGranotCrmSourceSemantics` leftover **directly** leftover — leftover not leftover `new GranotCrmSource().validate()`. Do not pass leftover refs leftover into leftover mongoose leftover validate leftover from leftover this leftover rename so “save loads the Feeds.” Do not drop leftover `pre("validate")` so “only leftover Registry leftover-judges leftover structure.”

5. **CSV leftover-seed leftover-`findOneAndUpdate` leftover-upsert leftover-does leftover-not leftover-set leftover `runValidators`.** Leftover `$setOnInsert` leftover-can leftover-insert leftover without leftover leftover `pre("validate")`. Leftover Registry leftover `$set` leftover-sets leftover `runValidators: true`. Leftover `existing.save()` leftover-on leftover a leftover CSV leftover path leftover-patch leftover-**does** leftover-run leftover hooks. Do not add leftover `runValidators: true` leftover onto leftover leftover CSV leftover seed leftover from leftover this leftover rename so “seed leftover-matches leftover Registry.” Do not drop leftover Registry leftover `runValidators` so “`$set` leftover-skips leftover structure.”

6. **Replica leftover-seeds leftover-skip leftover-hooks.** Leftover Booking / leftover Referral / leftover Release leftover replica leftover-`collection.insertOne` leftover the leftover row. Do not treat leftover seed leftover `insertOne` as leftover proof leftover this leftover file leftover-accepted leftover the leftover card. Do not move leftover those leftover replica leftover proofs leftover onto leftover this leftover file so “the row owns leftover Owner leftover commands.”

7. **`enabled` default `true` vs leftover knowledge “unreviewed rows stay disabled.”** Already-recommended leftover Owner leftover-write leftover-already leftover-names leftover this leftover: leftover operational leftover-on, leftover lifecycle leftover-off. Do not flip leftover schema leftover `enabled` leftover default leftover to leftover `false` leftover from leftover this leftover rename so “schema leftover-matches leftover ‘disabled’.” Do not flip leftover `lifecycle_enabled` leftover default leftover to leftover `true` so “unreviewed leftover-cards leftover-run leftover effects.”

8. **`normalized_granot_label` leftover-schema leftover-`lowercase` leftover-is leftover-not leftover leftover-fold.** Leftover `normalizeGranotSourceLabel` leftover-NFKC leftover-trims leftover-collapses leftover-rejects leftover control / leftover bidi. Leftover client leftover-supplied leftover folded leftover label leftover that leftover disagrees leftover leftover-fails leftover leftover next leftover helper leftover — leftover this leftover file leftover-does leftover-not leftover leftover-re-fold leftover it. Do not call leftover `normalizeGranotSourceLabel` leftover from leftover `pre("validate")` leftover so “the row leftover-owns leftover the leftover fold.”

9. **`outbound_sms` leftover-is leftover optional.** Leftover missing leftover nest leftover leftover-means leftover leftover-no leftover leftover-text. Leftover present leftover nest leftover leftover-defaults leftover leftover-off / leftover `not_attested` / leftover `daily_cap` leftover `0`. Leftover Owner leftover command leftover-does leftover-not leftover leftover-accept leftover `daily_cap`. Leftover `create_if_missing` leftover-does leftover-not leftover leftover-send. Do not default leftover a leftover full leftover SMS leftover nest leftover onto leftover every leftover insert leftover so “every leftover card leftover-has leftover a leftover template.” Do not leftover-enable leftover SMS leftover from leftover this leftover rename.

10. **`last_ingestions` leftover-is leftover leftover-CSV leftover leftover-evidence.** Leftover `upload.service.ts` leftover-stamps leftover leftover-hash leftover / leftover leftover-ingestion leftover-id leftover / leftover leftover-S3 leftover-key. Leftover Registry leftover `toRecord` leftover-omits leftover it. Do not leftover-clear leftover `last_ingestions` leftover on leftover leftover-a leftover leftover-policy leftover leftover-`$set` leftover so “lifecycle leftover-write leftover-resets leftover CSV leftover clocks” leftover — leftover leftover-confirm leftover leftover-`buildUpdate` leftover leftover-does leftover leftover-not leftover leftover-touch leftover leftover-those leftover leftover-paths leftover leftover-before leftover leftover-changing leftover leftover-either leftover leftover-file.

11. **`mongoose.models.GranotCrmSource` leftover-returns leftover the leftover first leftover registered leftover schema.** Leftover getter leftover-reuses leftover it leftover when leftover the leftover selected leftover name leftover leftover-matches leftover leftover-the leftover leftover-default leftover leftover-connection. Do not leftover-delete leftover leftover-reuse leftover so “every leftover call leftover-rebuilds leftover hooks.”

12. **`schema-and-crud-inputs.mdc` leftover-already leftover-names leftover this leftover collection.** Do not leftover-rewrite leftover that leftover paragraph leftover from leftover this leftover rename. Do not leftover-invent leftover a leftover `CONTEXT.md` leftover term.

13. **Leave sibling modules alone.** Leftover `createOrUpdateGranotCrmSource`, leftover `resolveSourcePolicy`, leftover `validateGranotCrmSourceSemantics`, leftover `normalizeGranotSourceLabel`, leftover `seedGranotCrmSources`, leftover `setGranotCrmSourceOutboundSms` are already the right **depth**. This file holds the row, the structure-without-refs guard, the named index catalog, and the selected-database getter.

## Testing

The **interface** is the test surface: `GranotCrmSource` / `getGranotCrmSourceModel` / `GRANOT_CRM_SOURCE_COLLECTION` / `GRANOT_CRM_SOURCE_MODEL_NAME` / `GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES` / `GRANOT_CRM_CHANNELS` / `GranotCrmSourceDocument`.

Today `GranotCrmSource.test.ts` already names part of the shape:

**Hold the CSV catalog row and the only semantic Granot name**
- Collection / model name leftover-match leftover `granot_crm_sources` / leftover `GranotCrmSource`.
- Leftover `new GranotCrmSource` leftover-validate leftover-defaults leftover `enabled: true`, leftover `lifecycle_enabled: false`, leftover `deferred`, leftover `observation_only`, leftover empty leftover routes, leftover empty leftover policy leftover version, leftover missing leftover folded leftover label, leftover missing leftover `lead_source_company`, leftover `source_company: "not_provided"`.

**Refuse a structurally illegal card on validate without refs**
- Leftover mongoose leftover `validate()` leftover-rejects leftover mixed leftover Call/Form, leftover illegal leftover Call leftover shape, leftover leftover-duplicate leftover Form leftover local, leftover leftover-duplicate leftover `route_key`, leftover leftover-`deferred` leftover + leftover `link_only`, leftover leftover-`referral_booking` leftover + leftover routes, leftover leftover-`deferred` leftover + leftover `create_if_missing`.

**Stamp named lifecycle indexes**
- Leftover unnamed leftover `{ crm_origin, workspace_slug }` leftover-is leftover unique.
- Leftover three leftover named leftover lifecycle leftover indexes leftover leftover-deep-equal leftover leftover-`GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES`.

Add on **this** interface (do not invent helper-unit tests):

- Leftover schema leftover-`autoIndex`s leftover `false` leftover-and leftover-`timestamps` leftover `true`.
- Leftover getter leftover-`modelName` leftover leftover-matches leftover leftover-default leftover leftover-when leftover leftover-the leftover leftover-selected leftover leftover-database leftover leftover-is leftover leftover-this leftover leftover-connection (already leftover-partially leftover-named).
- Leftover mongoose leftover `validate()` leftover-**accepts** leftover leftover-`lifecycle_enabled: true` leftover leftover-with leftover leftover-an leftover leftover-inactive leftover leftover-company leftover leftover-**because** leftover leftover-refs leftover leftover-are leftover leftover-not leftover leftover-loaded — leftover leftover-that leftover leftover-fail leftover leftover-stays leftover leftover-on leftover leftover-next leftover leftover-helper leftover leftover-**with refs**.
- Leftover optional leftover `outbound_sms` leftover leftover-missing leftover leftover-on leftover leftover-an leftover leftover-unreviewed leftover leftover-card.
- Leftover `pre("validate")` leftover leftover-does leftover leftover-not leftover leftover-write leftover leftover-`normalized_granot_label`.

Do **not** add a test per helper (`rememberCsvIdentityByOriginAndWorkspaceSlug`, `askTheSemanticsHelperWithoutLoadingCompanyOrFeeds`, `declareTheFoldedLabelUniqueWithoutApplyingItUntilUnit06`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** keep leftover `normalizeGranotSourceLabel` leftover / leftover leftover-ref leftover `validateGranotCrmSourceSemantics(...)` leftover cases leftover on leftover **this** leftover file leftover after leftover leftover-next leftover leftover-pass leftover — leftover leftover-those leftover leftover-are leftover leftover-leftover leftover leftover-next leftover leftover-helper leftover leftover-and leftover leftover-leftover leftover leftover-`sourceLabel.ts` leftover leftover-**interfaces**. Today leftover they leftover leftover-live leftover leftover-in leftover leftover-`GranotCrmSource.test.ts`; leftover leftover-move leftover leftover-them leftover leftover-only leftover leftover-when leftover leftover-implementing leftover leftover-leftover leftover leftover-next leftover leftover-module, leftover leftover-not leftover leftover-in leftover leftover-this leftover leftover-rename.

Do **not** move leftover `granotCrmSources.test.ts` / leftover `sourcePolicy` leftover proofs / leftover CSV leftover seed leftover proofs leftover into leftover this leftover file so “the row owns leftover persist and leftover resolve.” Duplicate leftover folded leftover label leftover / leftover eight leftover gates leftover / leftover upsert leftover-by leftover origin leftover stay leftover on leftover those leftover command leftover **interfaces**.

## What I would not do

- A `GranotCrmSourceModelService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `lifecycle.ts` / `csv.ts` / `sms.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit **seam**. Leftover Registry already leftover-writes leftover the leftover card leftover and leftover one leftover `granot_crm_source` leftover Registry Change leftover in leftover one leftover transaction leftover-and leftover-forgets leftover policy leftover / leftover list leftover / leftover health leftover caches leftover only leftover after leftover commit — do not leftover-move leftover those leftover writes leftover into leftover this leftover file so “the row owns leftover persist.”
- Treating leftover `createOrUpdateGranotCrmSource` / leftover `setGranotCrmSourceLifecycleEnabled` / leftover `setGranotCrmSourceOutboundSms` / leftover `resolveSourcePolicy` / leftover `seedGranotCrmSources` / leftover `validateGranotCrmSourceSemantics` / leftover `normalizeGranotSourceLabel` as this story.
- Inventing a fold **seam** that has only one **adapter**.
- Silently "fixing" the declared-but-unapplied folded-label unique / `pre("validate")` without refs / CSV upsert without `runValidators` / `enabled` default `true` vs leftover “disabled” wording / leftover string `source_company` vs leftover ObjectId / mixed leftover-next-helper tests on this file while recommending a rename.
- Jumping to `validation/` while `models` has unchecked modules.
- Writing a whole-folder recommendation for `models`.
- Merging this file into leftover next `granotCrmSourceSemantics.ts` so “one file owns the card and the judge.”
- Merging this file into already-recommended leftover `LeadSourceCompany.ts` so “string `source_company` is the live company.”
- Merging this file into leftover later `GranotAutomationSource.ts` so “automation owns the Granot name.”
- Copying already-recommended leftover discrepancy-factory hooks here so “CRM source is a fight desk.”
- Applying leftover `granot_crm_source_normalized_label_unique` leftover until leftover Unit 06 leftover from leftover this leftover rename.
- Flipping leftover `enabled` leftover default leftover to leftover `false` leftover so “unreviewed leftover-matches leftover ‘disabled’.”
- Calling leftover `normalizeGranotSourceLabel` leftover from leftover `pre("validate")` leftover so “the row leftover-owns leftover the leftover fold.”
- Treating leftover next `granotCrmSourceSemantics.ts` as this story.
- Reopening Wave A to enumerate `connectBookingToLead.ts` from this models pass.
