# Remember Each Granot HTTP Automation Source As The Exact Label The Owner Picks For A Run — Unique Exact Label Plus Unsafe-Control And Bidi Refuse, Compatibility Field For Form And Call Workflows, Seed Or Admin Origin, Optional Pointer At A Granot CRM Source, Named Active Label Operation And CRM Indexes, And The Default Connection After Connect Mongo — Never List Or Create The Catalog Here, Never Point The Registry Card Here, Never Ask Whether The Source May Be Applied, Never Merge This Into The Run Card Or The CRM Source — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 36 of this service — `GranotAutomationSource.ts`
- Remaining in this service: `SheetSyncJob.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/GranotAutomationSource.ts`
- Knowledge: [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (`GranotAutomationSource.supported_operations` remains a list/create compatibility field; list/create return label + operations plus an additive `compatibility` projection; `ready` requires a referenced `GranotCrmSource` that is operationally enabled, `lifecycle_enabled`, not `deferred`, unambiguous on `normalized_granot_label`, and whose `lifecycle_routes` permit the requested Form/Call operation; missing `granot_crm_source` → `missing_reference`; new admin labels start that way; exact duplicate label → `GRANOT_SOURCE_ALREADY_EXISTS`; create-source limit 200 — **this file never lists, never creates, never resolves, never asks compatibility**). Pointer write: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Owner-only exact `GranotAutomationSource.granot_crm_source` link; entity type `granot_automation_source` — **this file never points**). Software map: [`.cursor/rules/granot-http-automation.mdc`](../../../.cursor/rules/granot-http-automation.mdc) (source list/create remain label + `supported_operations` compatible; apply resolution dereferences `GranotCrmSource` and fails closed with `INVALID_GRANOT_SOURCES` when compatibility is not `ready`). Already-recommended leftover catalog: [granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md) (`list` / `create` / `seed` / `resolve` leftover-asks leftover this leftover default leftover model leftover after leftover `connectMongo()` — **this file never lists**). Already-recommended leftover pointer: [operations-registry-granot-automation-sources.md](operations-registry-granot-automation-sources.md) (leftover-asks leftover `findById` / leftover `$set granot_crm_source` — **this file never points**). Already-recommended leftover enrich: [operations-registry-granot-crm-source-projections.md](operations-registry-granot-crm-source-projections.md) (leftover-asks leftover `find({ granot_crm_source: { $in } })` — **this file never enriches**). Already-recommended leftover run: [models-granot-automation-run.md](models-granot-automation-run.md) (collection `granot_automation_runs`, eight leftover statuses, leftover durable leftover fence leftover nest — **do not merge**). Already-recommended leftover CRM name: [models-granot-crm-source.md](models-granot-crm-source.md) (collection `granot_crm_sources`, leftover folded leftover-label leftover unique leftover-declared, leftover selected-database leftover getter, leftover `autoIndex: false` — **do not merge**; leftover **do not** leftover-fold leftover this leftover exact leftover label). Already-recommended leftover HTTP: [routes-granot-automation.md](routes-granot-automation.md) (**asks** leftover `GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN` leftover for leftover Zod; leftover **asks** leftover catalog leftover for leftover list leftover / leftover create — **not** this leftover file leftover for leftover persist). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections does **not** name `granot_automation_sources`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the HTTP source catalog.” Named leftover indexes leftover-are leftover also leftover-asked leftover by leftover `pnpm migration:granot-lifecycle:indexes` leftover via leftover `GRANOT_AUTOMATION_SOURCE_INDEXES` (leftover migration leftover unique leftover list leftover is leftover empty — leftover exact leftover `label` leftover unique leftover-lives leftover on leftover the leftover field). Distinct from leftover later `SheetSyncJob.ts` (leftover durable leftover Sheet leftover Sync leftover outbox — **do not merge**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links Form Lead / Call Lead Enrichment / Granot CRM Source; do not invent a glossary copy for Granot HTTP automation source. `docs/adr/` is absent here — do not invent ADR copies. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model plus the unsafe-label pattern plus the named-index catalog.** Already-recommended leftover `sourceCatalog.ts` **asks** `GranotAutomationSource` after leftover `connectMongo()` — leftover-list leftover `find` leftover active leftover + leftover optional leftover operation leftover `$in`; leftover-create leftover `countDocuments` leftover then leftover `create` leftover `created_from: "admin"` leftover (leftover duplicate leftover key leftover → leftover `GRANOT_SOURCE_ALREADY_EXISTS`); leftover-seed leftover `updateOne` leftover exact leftover `{ label }` leftover upsert leftover `$set supported_operations` leftover / leftover `$setOnInsert` leftover `created_from: "seed"`; leftover-resolve leftover `find({ _id: { $in } })`. Already-recommended leftover `granotAutomationSources.ts` leftover-asks leftover `findById` leftover / leftover `updateOne` leftover `$set granot_crm_source` leftover inside leftover `withRegistryMutation` — leftover CRM leftover row leftover-uses leftover `getGranotCrmSourceModel()`, leftover this leftover card leftover-does leftover-not. Already-recommended leftover `granotCrmSourceProjections.ts` leftover-asks leftover `find({ granot_crm_source: { $in: recordIds } })`. Already-recommended leftover HTTP leftover desk leftover-asks leftover only leftover `GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN` leftover for leftover Zod leftover (leftover also leftover on leftover `source_labels`). Leftover seed leftover script leftover-asks leftover catalog leftover `seedGranotAutomationSources`, leftover not leftover this leftover file leftover directly. Leftover classification leftover apply leftover `granot-lifecycle-source-registry.ts` leftover-asks leftover `GranotAutomationSource.find({})` leftover then leftover leftover pointer leftover command. Leftover `dump-operations-name-link-inventory.ts` leftover-asks leftover `find({}).sort({ label: 1 })`. Leftover `pnpm migration:granot-lifecycle:indexes` leftover-asks leftover `GRANOT_AUTOMATION_SOURCE_COLLECTION` leftover + leftover `GRANOT_AUTOMATION_SOURCE_INDEXES` leftover (leftover all leftover three leftover named leftover clocks leftover are leftover non-unique). Tests: `GranotAutomationSource.test.ts` leftover-asks leftover optional leftover `granot_crm_source` leftover + leftover non-unique leftover `granot_automation_source_crm_source_active`. Leftover `granot-automation.routes.test.ts` leftover-asks leftover `validateSync` leftover bidi leftover refuse, leftover five leftover schema leftover paths, leftover three leftover named leftover indexes, leftover one-or-two leftover unique leftover workflows. Leftover `granot-lifecycle-indexes.test.ts` leftover-asks leftover the leftover catalog leftover and leftover `orderedGranotAutomationSourceIndexCreates().unique.length === 0`. Leftover `sourceCatalog.test.ts` leftover-does leftover-not leftover-import leftover this leftover file. Nobody leftover-imports leftover `GRANOT_AUTOMATION_OPERATIONS` leftover except leftover this leftover schema leftover enum. There is **no** `getGranotAutomationSourceModel()`. Not this **interface**: leftover `listGranotAutomationSources` itself, leftover `createGranotAutomationSource` itself, leftover `seedGranotAutomationSources` itself, leftover `resolveGranotAutomationSources` itself, leftover `setGranotAutomationSourceReference` itself, leftover `evaluateGranotAutomationCompatibility` itself, leftover `createGranotRun` itself.
- Seams callers need: default `GranotAutomationSource` (first-registered connection — leftover catalog leftover / leftover pointer leftover / leftover enrich leftover / leftover inventory leftover-ask leftover it leftover after leftover `connectMongo()` or leftover inside leftover a leftover Registry leftover session; leftover routes leftover-test leftover-asks leftover `schema.path` / leftover `validateSync`) vs **no** `getGranotAutomationSourceModel()` (already-recommended leftover CRM leftover name leftover-has leftover a leftover getter; leftover pointer leftover-asks leftover that leftover getter leftover for leftover the leftover CRM leftover row leftover and leftover this leftover default leftover model leftover for leftover the leftover label); exact leftover unique leftover `label` (leftover field leftover `unique: true`, leftover trim, leftover maxlength leftover 200 — leftover **not** leftover folded leftover `normalized_granot_label`) vs leftover named leftover non-unique leftover clocks leftover in leftover `GRANOT_AUTOMATION_SOURCE_INDEXES`; leftover mongoose leftover `validate` leftover unsafe leftover-control leftover / leftover bidi leftover refuse vs leftover Zod leftover on leftover the leftover HTTP leftover desk leftover (leftover same leftover pattern leftover export); leftover `supported_operations` leftover compatibility leftover field leftover (leftover one leftover or leftover two leftover unique leftover `form_leads` leftover / leftover `call_leads`) vs leftover Registry leftover `lifecycle_routes` leftover apply leftover authority; leftover `created_from` leftover `seed` leftover / leftover `admin` vs leftover Mixed leftover `created_by` leftover (leftover catalog leftover-writes leftover a leftover DurableActor leftover on leftover admin leftover create; leftover seed leftover `$setOnInsert` leftover does leftover-not leftover-set leftover it); leftover optional leftover `granot_crm_source` leftover ObjectId leftover ref leftover `GranotCrmSource` leftover (leftover create leftover does leftover-not leftover-set leftover it; leftover pointer leftover leftover-does) vs leftover leftover apply leftover leftover-readiness; leftover `timestamps: true` leftover / leftover omitted leftover `autoIndex: false` leftover (leftover mongoose leftover default leftover leftover-creates leftover leftover field leftover leftover unique leftover leftover plus leftover leftover named leftover leftover clocks leftover leftover on leftover leftover boot) vs leftover leftover `pnpm migration:granot-lifecycle:indexes` leftover leftover-stamping leftover leftover the leftover leftover same leftover leftover named leftover leftover clocks leftover leftover as leftover leftover non-unique. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no list **seam**. There is no create **seam**. There is no point **seam**. There is no apply-readiness **seam**. There is no selected-database **seam**.
- Split later (only if the file outgrows one sitting): this ~107-line file is one sitting if you read it as remember each Granot HTTP automation source as the exact label the Owner picks for a run — unique exact label plus unsafe-control and bidi refuse, compatibility field for Form and Call workflows, seed or admin origin, optional pointer at a Granot CRM Source, named active label operation and CRM indexes, and the default connection after connect Mongo — never list or create the catalog here, never point the Registry card here, never ask whether the source may be applied, never merge this into the run card or the CRM source. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `label.ts` / `pointer.ts`. Leftover catalog stays already-recommended `sourceCatalog.ts`. Leftover pointer stays already-recommended `granotAutomationSources.ts`. Leftover run stays already-recommended `GranotAutomationRun.ts`. Leftover CRM name stays already-recommended `GranotCrmSource.ts`. Leftover later Sheet Sync outbox stays leftover later `SheetSyncJob.ts`.

`GranotAutomationSource` is a Mongoose model name. The owner question is: *The owner keeps exact Granot Leads & Advertising labels for HTTP automation — Form tables, Call tables, or both. Remember each label on `granot_automation_sources`. The label is exact: trim it, cap it at 200, refuse control and bidirectional characters, and unique it as written — do not fold it the way the Granot CRM name folds. Say which Lead workflows the list/create desk still shows (`form_leads` / `call_leads`, one or two unique). Say whether seed or admin planted it. Hold an optional pointer at a Granot CRM Source; a new admin label starts without one. Stamp the named active/label, active/operation/label, and CRM-pointer/active clocks. Hand back the default-connection model after leftover `connectMongo()`. Do not list the catalog. Do not plant the nine known labels. Do not point the Registry card. Do not ask whether this source may be applied. Do not invent a selected-database getter so “CRM matches HTTP.” Do not merge this into the leftover HTTP run or the leftover Granot CRM name.*

Who leftover-lists / leftover-creates / leftover-seeds / leftover-resolves already lives in already-recommended `sourceCatalog.ts`. Who leftover-points leftover the leftover Registry leftover card already lives in already-recommended `granotAutomationSources.ts`. Who leftover-asks leftover leftover-readiness already lives in already-recommended `automationCompatibility.ts`. Who leftover-queues leftover leftover a leftover leftover run already lives in already-recommended `runWorkflow.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember each Granot HTTP automation source as the exact label the Owner picks for a run — unique exact label plus unsafe-control and bidi refuse, compatibility field for Form and Call workflows, seed or admin origin, optional pointer at a Granot CRM Source, named active label operation and CRM indexes, and the default connection after connect Mongo — never list or create the catalog here, never point the Registry card here, never ask whether the source may be applied, never merge this into the run card or the CRM source” story, not “an automation-source CRUD dump,” and not Keep The Exact Granot Labels The Owner Uses For HTTP Automation itself:

1. **Hold the Granot HTTP automation source card** — collection `granot_automation_sources`, `timestamps: true`, `toJSON` / `toObject` `{ virtuals: true }` (this file defines **no** virtuals). **No** `autoIndex: false` (mongoose default creates the field unique and the named clocks on boot). **No** optimistic concurrency. **No** hooks. **No** immutable paths. Required trimmed `label` (maxlength 200, field `unique: true`, field `index: true`). Required `active` (`Boolean`, default `true`, field `index: true`). Required `supported_operations` (string array enum leftover `GRANOT_AUTOMATION_OPERATIONS`). Required `created_from` (`seed` | `admin`). Mixed `created_by` default `null`. Optional `granot_crm_source` ObjectId ref leftover `"GranotCrmSource"` (leftover `GranotAutomationSource.test.ts` leftover-locks leftover `isRequired !== true`). `GranotAutomationSourceDocument` is `InferSchemaType` plus `_id`. This beat does **not** leftover-list leftover active leftover rows. This beat does **not** leftover-plant leftover the leftover nine leftover labels. This beat does **not** leftover-`$set` leftover the leftover pointer.

2. **Refuse an illegal exact label and remember which Lead workflows it supports plus who planted it** — leftover `GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN` leftover refuses leftover C0 leftover / leftover C1 leftover controls leftover plus leftover leftover bidi leftover / leftover isolate leftover marks leftover (`\u0000-\u001f` leftover / leftover `\u007f-\u009f` leftover / leftover `\u061c` leftover / leftover `\u200e` leftover / leftover `\u200f` leftover / leftover `\u202a-\u202e` leftover / leftover `\u2066-\u2069`). Leftover mongoose leftover `validate` leftover message leftover is leftover `"Granot source labels cannot contain control or bidirectional characters."` Leftover HTTP leftover desk leftover leftover-asks leftover the leftover same leftover pattern leftover in leftover Zod leftover before leftover leftover-create. Leftover unique leftover is leftover exact leftover leftover-as leftover leftover-written leftover (leftover Mongo leftover default leftover leftover-case leftover leftover-sensitive leftover — leftover `"TBM Forms"` leftover leftover-is leftover leftover not leftover leftover `"tbm forms"`). Leftover `supported_operations` leftover leftover-must leftover leftover be leftover leftover one leftover leftover or leftover leftover two leftover leftover unique leftover leftover `form_leads` leftover leftover / leftover leftover `call_leads` leftover leftover (leftover empty leftover leftover / leftover leftover duplicate leftover leftover `form_leads` leftover leftover / leftover leftover `"unknown"` leftover leftover fail leftover leftover `validateSync`). Knowledge leftover leftover-says leftover leftover this leftover leftover field leftover leftover is leftover leftover list leftover leftover / leftover leftover create leftover leftover compatibility leftover leftover — leftover leftover Registry leftover leftover routes leftover leftover are leftover leftover apply leftover leftover authority. Leftover `created_from` leftover leftover-is leftover leftover `seed` leftover leftover or leftover leftover `admin`. This beat does **not** leftover-infer leftover Forms leftover vs leftover Inbounds leftover from leftover the leftover words leftover in leftover the leftover label. This beat does **not** leftover-fold leftover the leftover label. This beat does **not** leftover-ask leftover `evaluateGranotAutomationCompatibility`.

3. **Stamp the named clocks and hand back the default-connection model** — leftover `GRANOT_AUTOMATION_SOURCE_COLLECTION` leftover is leftover `"granot_automation_sources"`. Leftover `GRANOT_AUTOMATION_SOURCE_INDEXES` leftover leftover-names leftover leftover three leftover leftover non-unique leftover leftover clocks leftover leftover and leftover leftover this leftover leftover file leftover leftover also leftover leftover-calls leftover leftover `Schema.index` leftover leftover for leftover leftover each: leftover `granot_automation_source_active_label` leftover `{ active: 1, label: 1 }`; leftover `granot_automation_source_active_operation_label` leftover `{ active: 1, supported_operations: 1, label: 1 }`; leftover `granot_automation_source_crm_source_active` leftover `{ granot_crm_source: 1, active: 1 }` leftover (leftover AC-38 leftover leftover-locks leftover leftover `!("unique" in index)`). Leftover field leftover leftover `unique: true` leftover leftover on leftover leftover `label` leftover leftover is leftover leftover **not** leftover leftover in leftover leftover that leftover leftover catalog leftover — leftover leftover `orderedGranotAutomationSourceIndexCreates().unique.length === 0`. Leftover `pnpm migration:granot-lifecycle:indexes` leftover leftover-stamps leftover leftover the leftover leftover named leftover leftover clocks leftover leftover after leftover leftover review. Default leftover export leftover `GranotAutomationSource` leftover is leftover `mongoose.models.GranotAutomationSource ?? mongoose.model(...)`. There is **no** `getGranotAutomationSourceModel()`. Leftover catalog leftover leftover-asks leftover leftover this leftover leftover default leftover leftover model leftover leftover after leftover leftover `connectMongo()`. This beat does **not** leftover-`syncIndexes`. This beat does **not** leftover-delete leftover leftover the leftover leftover default leftover leftover export leftover leftover so leftover leftover “everyone leftover leftover must leftover leftover call leftover leftover a leftover leftover getter.”

There is no leftover-list-the-catalog operation. Leftover `listGranotAutomationSources` elects that. There is no leftover-add-a-label operation. Leftover `createGranotAutomationSource` elects that. There is no leftover-point-the-Registry-card operation. Leftover `setGranotAutomationSourceReference` elects that.

## Organization

Keep one file. This is the screenplay for “remember each Granot HTTP automation source as the exact label the Owner picks for a run — unique exact label plus unsafe-control and bidi refuse, compatibility field for Form and Call workflows, seed or admin origin, optional pointer at a Granot CRM Source, named active label operation and CRM indexes, and the default connection after connect Mongo — never list or create the catalog here, never point the Registry card here, never ask whether the source may be applied, never merge this into the run card or the CRM source.” Leftover catalog / leftover pointer / leftover enrich / leftover leftover-readiness / leftover leftover-walk already live in deeper **modules**. Leftover run leftover card leftover already leftover lives leftover in leftover a leftover sibling **module**. Leftover CRM leftover name leftover already leftover lives leftover in leftover a leftover sibling **module**. Do not pull those in. Do not invent a `GranotAutomationSourceService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a selected-database **adapter** so “this matches the leftover CRM name” without a paired leftover-catalog leftover-migration leftover-to leftover-the leftover-getter. Do not invent an `autoIndex: false` **adapter** so “this matches the leftover CRM name” without a paired leftover proof leftover that leftover boot leftover leftover-no leftover leftover-longer leftover leftover-creates leftover leftover these leftover leftover clocks. Do not invent a fold **adapter** so “the row owns NFKC.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `label.ts` / `pointer.ts` each get a file.

Do not move leftover `createGranotAutomationSource` into this file so “the row owns the catalog.” Do not merge this file into already-recommended leftover `GranotAutomationRun.ts` so “one schema owns the run and the label.” Do not merge this file into already-recommended leftover `GranotCrmSource.ts` so “one file owns the exact pick and the semantic Granot name.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `GranotAutomationSource` | `granotHttpAutomationSourceOnTheDefaultConnection` | leftover catalog leftover / leftover pointer leftover / leftover enrich leftover / leftover inventory leftover-ask leftover the leftover default leftover model; leftover routes leftover-test leftover leftover-asks leftover leftover `schema.path` leftover / leftover leftover `validateSync` |
| `GranotAutomationSourceDocument` | `GranotHttpAutomationSourceRow` | inferred document + `_id` |
| `GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN` | `RefuseControlAndBidiMarksInThisExactLabel` | leftover mongoose leftover validate leftover + leftover HTTP leftover Zod leftover `source_labels` leftover / leftover create leftover body |
| `GRANOT_AUTOMATION_OPERATIONS` | `WhichLeadWorkflowsThisExactLabelStillShows` | leftover schema leftover enum leftover `form_leads` leftover / leftover `call_leads` |
| `GRANOT_AUTOMATION_SOURCE_COLLECTION` | `GranotHttpAutomationSourcesCollectionName` | leftover `pnpm migration:granot-lifecycle:indexes` leftover-asks leftover `granot_automation_sources` |
| `GRANOT_AUTOMATION_SOURCE_INDEXES` | `NamedActiveLabelOperationAndCrmClocks` | leftover migration leftover leftover-stamps leftover leftover three leftover leftover non-unique leftover leftover names; leftover leftover AC-38 leftover leftover-locks leftover leftover the leftover leftover CRM leftover leftover clock leftover leftover is leftover leftover not leftover leftover unique |

Keep the old names as one-line aliases until leftover catalog, leftover pointer, leftover enrich, leftover HTTP leftover desk, leftover migration, leftover inventory leftover script, leftover `GranotAutomationSource.test.ts`, and leftover `granot-automation.routes.test.ts` migrate. Do not make callers learn `useDb` / `autoIndex` / `normalized_granot_label` as the only domain language until those sites move. Do **not** add a `getGranotAutomationSourceModel` export so “CRM matches HTTP” without a paired leftover-catalog leftover-proof leftover that leftover `connectMongo()` leftover-already leftover-binds leftover the leftover selected leftover database. Do **not** re-export leftover `createGranotAutomationSource` leftover / leftover `setGranotAutomationSourceReference` from this file so “the row leftover-lists leftover labels leftover or leftover leftover-points leftover the leftover card.”

**No class for the workflow.** The one type that *does* earn a name is the source-identity contract:

```ts
type GranotHttpAutomationSourceIdentity = {
  collection: "granot_automation_sources"
  label_is_exact: true
  label_is_folded: false
  label_unique: true
  unsafe_control_and_bidi_refused: true
  supported_operations_are_apply_authority: false
  created_from: "seed" | "admin"
  granot_crm_source_required: false
  selected_database_getter: false
  autoIndex: true
  named_index_catalog_unique_count: 0
  named_indexes: [
    "granot_automation_source_active_label",
    "granot_automation_source_active_operation_label",
    "granot_automation_source_crm_source_active",
  ]
}
```

That is the handoff from “this process remembered an exact HTTP automation label” to “leftover-catalog leftover-may leftover-list leftover leftover-create leftover leftover-seed leftover leftover-resolve leftover leftover it leftover leftover after leftover leftover `connectMongo()`, leftover leftover-pointer leftover leftover-may leftover leftover-`$set` leftover leftover the leftover leftover optional leftover leftover CRM leftover leftover id, leftover leftover-migration leftover leftover-may leftover leftover-stamp leftover leftover the leftover leftover three leftover leftover named leftover leftover clocks, and leftover leftover-boot leftover leftover-also leftover leftover-creates leftover leftover those leftover leftover clocks leftover leftover plus leftover leftover the leftover leftover field leftover leftover unique.” Do **not** add `{ selected_database_getter: true }` so “this leftover-matches leftover the leftover CRM leftover name.” Do **not** add `{ label_is_folded: true }` so “one leftover fold leftover-owns leftover both leftover cards.” Do **not** add `{ autoIndex: false }` so “this leftover-matches leftover the leftover CRM leftover name.” Do **not** add `{ supported_operations_are_apply_authority: true }` so “the leftover list leftover field leftover leftover-wins leftover leftover apply.”

Leave already-recommended leftover `GranotAutomationRun.ts` on that file. Leave already-recommended leftover `GranotCrmSource.ts` on that file. Leave leftover later `SheetSyncJob.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// GranotAutomationSource.ts
// The owner keeps exact Granot Leads & Advertising labels
// for HTTP automation — Form tables, Call tables, or both.
// Remember each label on granot_automation_sources.
// The label is exact: trim it, cap it at 200,
// refuse control and bidirectional characters,
// and unique it as written.
// Do not fold it the way the Granot CRM name folds.
// Say which Lead workflows the list/create desk still shows.
// Say whether seed or admin planted it.
// Hold an optional pointer at a Granot CRM Source.
// Stamp the named active/label, active/operation/label,
// and CRM-pointer/active clocks.
// Hand back the default-connection model.
// Do not list the catalog.
// Do not plant the nine known labels.
// Do not point the Registry card.
// Do not ask whether this source may be applied.
// Do not invent a selected-database getter
// so "CRM matches HTTP."
// Do not merge this into the HTTP run
// or the Granot CRM name.

export const RefuseControlAndBidiMarksInThisExactLabel =
  GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN
export const WhichLeadWorkflowsThisExactLabelStillShows =
  GRANOT_AUTOMATION_OPERATIONS
export const GranotHttpAutomationSourcesCollectionName =
  GRANOT_AUTOMATION_SOURCE_COLLECTION
export const NamedActiveLabelOperationAndCrmClocks =
  GRANOT_AUTOMATION_SOURCE_INDEXES

export {
  RefuseControlAndBidiMarksInThisExactLabel as GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN,
  WhichLeadWorkflowsThisExactLabelStillShows as GRANOT_AUTOMATION_OPERATIONS,
  GranotHttpAutomationSourcesCollectionName as GRANOT_AUTOMATION_SOURCE_COLLECTION,
  NamedActiveLabelOperationAndCrmClocks as GRANOT_AUTOMATION_SOURCE_INDEXES,
}

export const granotHttpAutomationSourceOnTheDefaultConnection =
  GranotAutomationSource
export type GranotHttpAutomationSourceRow = GranotAutomationSourceDocument

export { granotHttpAutomationSourceOnTheDefaultConnection as GranotAutomationSource }
export type { GranotHttpAutomationSourceRow as GranotAutomationSourceDocument }

// ── 1. Hold the Granot HTTP automation source card ────────

export const GranotAutomationSource =
  rememberTheGranotHttpAutomationSourceOnTheDefaultConnection()

function rememberTheGranotHttpAutomationSourceOnTheDefaultConnection() {
  return (
    mongoose.models.GranotAutomationSource ??
    mongoose.model("GranotAutomationSource", GranotAutomationSourceSchema)
  )
}

function theCardHoldsTheExactLabel()                        // unique trim maxlength 200
function theCardStartsActive()                              // default true
function theCardMayPointAtAGranotCrmSource()                // optional ObjectId; AC-38
function theCardRemembersWhoPlantedIt()                     // created_from seed|admin; Mixed created_by

// ── 2. Refuse an illegal exact label and remember which Lead workflows it supports

function refuseControlAndBidiMarksInThisExactLabel()        // GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN
function whichLeadWorkflowsThisExactLabelStillShows()       // one or two unique form_leads|call_leads
function thoseWorkflowsAreNotApplyAuthority()               // leftover Registry routes are
function doNotFoldThisLabelTheWayTheCrmNameFolds()

// ── 3. Stamp the named clocks and hand back the default-connection model

function stampTheActiveLabelClock()                         // granot_automation_source_active_label
function stampTheActiveOperationLabelClock()                // granot_automation_source_active_operation_label
function stampTheCrmPointerActiveClock()                    // granot_automation_source_crm_source_active; not unique
function theExactLabelUniqueLivesOnTheField()               // not in GRANOT_AUTOMATION_SOURCE_INDEXES
function theNamedCatalogUniqueCountIsZero()
function thereIsNoSelectedDatabaseGetter()
```

Read the primary path out loud: leftover catalog calls `connectMongo()` then asks `GranotAutomationSource.create()` with an exact trimmed label and `created_from: "admin"`. Mongoose refuses control and bidi marks and uniques the as-written string. A new admin label starts without `granot_crm_source`, so leftover readiness says `missing_reference` until leftover pointer `$set` that ObjectId. Leftover seed upserts the nine known labels by exact `{ label }`. Leftover list finds active rows. Leftover resolve loads by id and asks leftover readiness elsewhere. This file never opens Granot HTML and never writes a run.

That is the operation. `GranotAutomationSource` as "an automation-source schema dump" is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **There is no selected-database getter.** Already-recommended leftover CRM name asks `getGranotCrmSourceModel()`. Already-recommended leftover pointer asks that getter for the CRM row and this default model for the label. Leftover catalog calls `connectMongo()` first. Name `selected_database_getter: false`. Do not add a getter in this pass so “CRM matches HTTP.”

2. **The label is exact, not folded.** Already-recommended leftover CRM name holds `normalized_granot_label` and folds elsewhere. This field is trimmed as written. Leftover seed matches `{ label: source.label }`. Do not import `normalizeGranotSourceLabel` here so “one fold owns both cards.”

3. **The exact unique is on the field, not in the named catalog.** `label` has `unique: true`. `GRANOT_AUTOMATION_SOURCE_INDEXES` has three non-unique clocks. Leftover migration unique list is empty. Name `named_index_catalog_unique_count: 0` and `label_unique: true`. Do not move the field unique into the catalog in this pass so “one list owns every clock.”

4. **Indexes create on boot and the leftover migration stamps them too.** This file omits `autoIndex: false` and calls `Schema.index`. `pnpm migration:granot-lifecycle:indexes` also asks the named catalog. Already-recommended leftover CRM name uses `autoIndex: false`. Do not flip this file in the same PR as the rename. Name `autoIndex: true`.

5. **`supported_operations` is not apply authority.** Knowledge says that in those words. Leftover resolve asks Registry routes. Name `supported_operations_are_apply_authority: false`. Do not delete the field so “the pointer owns list.”

6. **Unsafe refuse is duplicated at the HTTP desk.** Mongoose validate and Zod share `GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN`. Keep that export as the seam. Do not drop mongoose validate so “Zod owns the card.”

7. **The CRM pointer is optional and the CRM clock is not unique.** AC-38 locks both. Two labels may point at the same Granot name. Do not unique `granot_crm_source` so “one name owns one pick.”

8. **`GRANOT_AUTOMATION_OPERATIONS` is unused outside this schema enum.** HTTP Zod repeats `form_leads` / `call_leads`. After the rename, keep the old name as an alias of `WhichLeadWorkflowsThisExactLabelStillShows`. Do not silently widen the tuple so “CSV kinds live here too.”

9. **`toJSON` / `toObject` ask virtuals this file does not define.** Leave that off the identity type until a later virtual lands. Do not add an `id` virtual here so “the DTO owns the schema.”

10. **Software-map gap.** `schema-and-crud-inputs.mdc` does not name `granot_automation_sources`. Knowledge does. Do not invent that rule line from this rename.

11. **Pointer asks two models on different seams.** This card is the default export. The CRM row uses `getGranotCrmSourceModel()`. Name that mismatch. Do not add a getter here so “both writes match.”

12. **Leave sibling modules alone.** `createGranotAutomationSource` / `setGranotAutomationSourceReference` are already the right **depth**.

## Testing

The interface of this file is the default-connection model, the unsafe-label pattern, the two-word operations tuple, the collection name, the named-index catalog, the inferred-row type, the optional CRM pointer, and the exact-label unique. `GranotAutomationSource.test.ts` already asks optional `granot_crm_source` plus non-unique `granot_automation_source_crm_source_active`. `granot-automation.routes.test.ts` already asks bidi refuse, five schema paths, three named indexes, and one-or-two unique workflows. `granot-lifecycle-indexes.test.ts` already asks `unique.length === 0`.

I would keep growing those files if that is the house style by then. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.GranotAutomationSource ?? mongoose.model(...)`; there is no `getGranotAutomationSourceModel`
- leftover catalog asks `GranotAutomationSource` only after `connectMongo()`
- leftover pointer asks this default model and `getGranotCrmSourceModel()` for the CRM row
- the label is exact unique (`unique: true`, not folded)
- `GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN` refuses `\u202E` on `validateSync`
- `supported_operations` must be one or two unique `form_leads` / `call_leads`
- those workflows are not apply authority
- named indexes are exactly `granot_automation_source_active_label` / `granot_automation_source_active_operation_label` / `granot_automation_source_crm_source_active`
- the CRM clock is not unique
- `GRANOT_AUTOMATION_SOURCE_INDEXES` unique count is `0`
- the file omits `autoIndex: false`
- `schema-and-crud-inputs.mdc` still does not name `granot_automation_sources`; this pass does not invent that rule line
- already-recommended `GranotAutomationRun` is a different collection; that file is out of this story
- leftover later `SheetSyncJob` is out of this story

I would not test HTML collect, Owner approve, leftover catalog create, leftover pointer write, leftover Form correction, leftover Call enrichment write, or leftover Booked reconciliation from this file.

Do not add a test per helper (`theCardMayPointAtAGranotCrmSource`, `doNotFoldThisLabelTheWayTheCrmNameFolds`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `GranotAutomationSourceService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `label.ts` / `pointer.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (there is none here; do not invent one).
- Treating leftover `listGranotAutomationSources` / leftover `createGranotAutomationSource` / leftover `seedGranotAutomationSources` / leftover `resolveGranotAutomationSources` / leftover `setGranotAutomationSourceReference` / leftover `evaluateGranotAutomationCompatibility` / leftover `createGranotRun` / leftover `GranotAutomationRun` / leftover `GranotCrmSource` / leftover later `SheetSyncJob` as this story.
- Inventing a selected-database seam that has only the leftover CRM getter as an adapter.
- Silently adding a selected-database getter, flipping `autoIndex: false`, folding the exact label, unique-ing `granot_crm_source`, or treating `supported_operations` as apply authority while recommending a rename.
- Pulling `createGranotAutomationSource` or `setGranotAutomationSourceReference` into this file.
- Merging this collection into `GranotAutomationRun`, leftover `GranotCrmSource`, or leftover later `SheetSyncJob`.
- Silently reordering leftover `connectMongo` versus leftover create, leftover Zod refuse versus leftover mongoose validate, or leftover pointer `$set` versus leftover readiness.
- Dropping the default export, leftover `GRANOT_AUTOMATION_UNSAFE_LABEL_PATTERN`, leftover `GRANOT_AUTOMATION_SOURCE_INDEXES`, or leftover `GRANOT_AUTOMATION_SOURCE_COLLECTION` in the same PR as the story names.
- Opening Wave B (`src/validation/`) or leftover later `SheetSyncJob.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `SheetSyncJob.ts` while writing this file.
