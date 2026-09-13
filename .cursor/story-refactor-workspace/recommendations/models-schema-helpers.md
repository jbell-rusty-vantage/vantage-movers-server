# Remember The Shared Lead Source-Company, Move-Type, And Lead-Model Field Contracts, Remember The Per-Target Sheet-Row Hint Subdocument, And Drop Deleted Targets Then Merge Last-Write-Wins Hints By Target — Never Store A Deleted Status, Never Enum SOURCE_COMPANIES Here, Never Flip Lead-Model Required So Booking Owns The Helper, Never Merge Historical Relax, Never Copy This Onto Testimonial Optional Source Company — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 18 of this service — `schemaHelpers.ts`
- Remaining in this service: `WordpressFormSubmissionReceipt.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/schemaHelpers.ts`
- Knowledge: [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (domain documents store `sheet_sync[]`; `row_number` is a **hint**; Sheet row identity is always **Lead ID** / Mongo ID. Legacy remember is `document.save()`; queued drain remembers with `updateOne` and must not abort the run). Related writers: [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (sync functions return `SheetSyncEntry[]`; delete-markers are **not** this type; `not_provided` has no source container env). Related Lead desks: [`docs/knowledge/services/form-lead.md`](../../../docs/knowledge/services/form-lead.md) / [`docs/knowledge/services/call-lead.md`](../../../docs/knowledge/services/call-lead.md) (live `source_company` slug plus first-class `lead_source_company` ObjectId — **this file never assigns a Source Company**, never prices CPL). Already-recommended Form / Call / Booking / Cancellation rows: [models-form-lead.md](models-form-lead.md) / [models-call-lead.md](models-call-lead.md) / [models-booked-lead.md](models-booked-lead.md) / [models-cancelled-lead.md](models-cancelled-lead.md) (**ask** these field objects and `sheetSyncSchema` — **this file never holds a Lead**, never books, never cancels). Already-recommended leftover remember after the live write: [sheet-sync-persistence.md](sheet-sync-persistence.md) (`syncAndStore` leftover-**asks** leftover `removeSheetSyncEntries` then leftover `mergeSheetSyncEntries` then `document.save()` — **this file never saves**). Already-recommended leftover queued drain: [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (`persistDocSheetSync` leftover-**asks** the same pair then leftover `updateOne` — **this file never drains**). Already-recommended leftover review row: [models-testimonial.md](models-testimonial.md) (optional unindexed `source_company` is **not** leftover `sourceCompanyField`). Distinct from leftover historical relax: later `historical/schemaHelpers.ts` (plain trimmed strings, **no** required, **no** `"not_provided"` default, **no** `LOCAL_TYPES` / `LEAD_MODELS` / `SHEET_SYNC_STATUSES` enums, **no** `sheetSyncSchema`, plus leftover `AgentAllocationSchema` / leftover `ImportMetadataFields` — **do not merge that file into this one**). Distinct from leftover next ingress receipt: later `WordpressFormSubmissionReceipt.ts` (no `sheet_sync[]`, no `source_company`). Distinct from leftover Sheet Sync job collections: later `SheetSyncJob.ts` / `SheetSyncRun.ts` / `SheetSyncAttempt.ts` / `SheetSyncLease.ts` / `SheetSyncQuotaBucket.ts` (outbox / audit / quota — **not** the per-document hint array). Distinct from leftover first-class Source Company catalog: already-recommended [models-lead-source-company.md](models-lead-source-company.md) (ObjectId on the Lead — **this helper is the leftover string slug**). Distinct from leftover `SOURCE_COMPANIES` tuple: Wave B `config/domain/sources.ts` is still locked — this field is a **free string**, not that enum. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links Sheet Sync / Form Lead; this checkout does **not** define Source Company or Sheet Sync — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **five schema desks plus two remember paths, plus type-only Google Sheets imports.** Schema: already-recommended `FormLead.ts` leftover-**asks** leftover `sourceCompanyField` + leftover `localField` (required Move Type) + leftover `sheetSyncSchema` / leftover `SheetSyncEntry`. Already-recommended `CallLead.ts` leftover-**asks** leftover `sourceCompanyField` + leftover `optionalLocalField` + leftover `sheetSyncSchema`. Already-recommended `BookedLead.ts` leftover-**asks** leftover `{ ...leadModelField, required: false }` + leftover `optionalLocalField` + leftover `sheetSyncSchema`. Already-recommended `CancelledLead.ts` leftover-**asks** leftover `{ ...leadModelField, required: false }` + leftover `sheetSyncSchema` (no Move Type helper). Leftover later `GranotCrmSource.ts` leftover-**asks** leftover `sourceCompanyField` only. Remember: already-recommended `sheetSyncPersistence.ts` leftover-**asks** leftover `removeSheetSyncEntries` then leftover `mergeSheetSyncEntries` after it splits leftover `{ status: "deleted" }` markers off the writer bag. Already-recommended `drainer/runSheetSyncDrain.ts` leftover-**asks** the same pair inside leftover `persistDocSheetSync` (delete only when leftover `op === "delete"` **and** leftover `status === "synced"`). Type-only: leftover `googleSheets/types.ts` / leftover `googleSheets.service.ts` / leftover `syncRows.ts` / leftover `sheetContains.ts` leftover-import leftover `SheetSyncEntry`. There is no `schemaHelpers.test.ts`. Nobody leftover-inspects leftover `sheetSyncSchema.indexes()`. Leftover historical desks leftover-import leftover `historical/schemaHelpers.ts`, **not** this file. Leftover Testimonial leftover-does **not** import this file. Wave B `validation/` is still locked. Not this **interface**: leftover `syncAndStore` itself, leftover `persistDocSheetSync` itself, leftover `syncFormLeadToSheets` itself, leftover `assignTheSourceGranularity` itself, leftover `GranotCrmSource` itself, leftover `historical/schemaHelpers.ts` itself.
- Seams callers need: runtime required + default `"not_provided"` + field index + **no trim** + **no `SOURCE_COMPANIES` enum** vs leftover historical trim-only optional string; Form required leftover `localField` vs Call / Booking leftover `optionalLocalField`; leftover `leadModelField` `required: true` vs Booking / Cancellation spread `required: false` (Referral / leadless / unresolved employee); leftover `sourceCompanyField` on Form / Call **and** leftover later Granot CRM source vs leftover Testimonial optional unindexed `source_company`; leftover `SheetSyncEntry.status` `pending` \| `synced` \| `failed` vs leftover persistence delete-marker `{ status: "deleted" }` that this type **must never store**; leftover merge last-write-wins by `target` (insertion order of first-seen targets; later write replaces) vs leftover remove by target set; leftover legacy `document.save()` vs leftover queued `updateOne`; leftover `row_number` optional hint vs leftover Lead ID identity; leftover `sheetSyncSchema` `{ _id: false }` vs leftover parent `sheet_sync: { type: [sheetSyncSchema], default: [] }`; leftover `SHEET_SYNC_STATUSES` / leftover `LOCAL_TYPES` / leftover `LEAD_MODELS` imported from leftover `config/domain` vs Wave B `config/domain/` still locked. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no selected-database getter **seam**. There is no collection **seam**.
- Split later (only if the file outgrows one sitting): this ~110-line file is one sitting if you read it as remember the shared Lead source-company / move-type / Lead-model field contracts, remember the per-target sheet-row hint subdocument, and drop deleted targets then merge last-write-wins hints by target — never store a deleted status, never enum `SOURCE_COMPANIES` here, never flip Lead-model required so Booking owns the helper, never merge historical relax, never copy this onto Testimonial optional `source_company`. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `fields.ts` / `sheet-sync.ts` / `merge.ts`. Form / Call / Booking / Cancellation rows stay those files. Legacy remember stays `sheetSyncPersistence.ts`. Queued remember stays `runSheetSyncDrain.ts`. Historical relax stays `historical/schemaHelpers.ts`. Next ingress receipt stays `WordpressFormSubmissionReceipt.ts`.

`schemaHelpers` is a filename. The owner question is: *Form, Call, Booking, Cancellation, and the Granot CRM source desk all need the same leftover string Source Company, the same leftover Move Type enum, the same leftover Lead-model enum, and the same leftover per-tab sheet hint. Hold those contracts here. When a live write or a drain comes back, drop the tabs we just deleted and merge the new hints onto what remains — last write wins by target, untouched tabs stay. Do not store `deleted`. Do not decide which tabs to write. Do not save the document. Do not drain. Do not assign a Source Company. Do not enum the Source Company catalog here so a leftover unknown slug 11000s. Do not flip Lead-model to optional so “Booking owns the helper.” Do not merge the historical relax. Do not copy this required `"not_provided"` onto leftover Testimonial optional `source_company`.*

Who hold the Form / Call / Booking / Cancellation row already lives in already-recommended those model files. Who remember after the live write already lives in already-recommended `sheetSyncPersistence.ts`. Who remember after the drain already lives in already-recommended `runSheetSyncDrain.ts`. Who relax historical strings already lives in later `historical/schemaHelpers.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the shared field contracts, remember the per-target sheet-row hint, and drop-then-merge last-write-wins hints by target” story, not “a schemaHelpers CRUD dump,” and not Remember The Sheet Rows On The Document / Drain Due Sheet-Sync Jobs themselves:

1. **Hold the shared Lead source-company, move-type, and Lead-model field contracts** — leftover `sourceCompanyField` is `String`, `required: true`, default `"not_provided"`, `index: true`, **no** `trim`, **no** `SOURCE_COMPANIES` enum, **no** unique. Leftover `localField` is `String`, enum leftover `LOCAL_TYPES` (`local` \| `long_distance`), `required: true`, `index: true`. Leftover `optionalLocalField` is the same enum + index **without** required. Leftover `leadModelField` is `String`, enum leftover `LEAD_MODELS` (`FormLead` \| `CallLead`), `required: true`, `index: true`. Form leftover-**asks** required leftover `localField`. Call and Booking leftover-**ask** leftover `optionalLocalField`. Booking and Cancellation leftover-spread leftover `leadModelField` with `required: false` so Referral / leadless / unresolved employee validate. Leftover later Granot CRM source leftover-**asks** leftover `sourceCompanyField` so an omitted slug becomes `"not_provided"`. This beat does **not** assign leftover `lead_source_company`. This beat does **not** fold a Granot label. This beat does **not** price CPL (`not_provided` leftover-resolves 0 on leftover `getCplForSource`, not here). This beat does **not** enum leftover `SOURCE_COMPANIES`.

2. **Hold the per-target sheet-row hint subdocument** — leftover `sheetSyncSchema` is a Mongoose `Schema` with `{ _id: false }`. Required trimmed `target` / `spreadsheet_id` / `tab_name`. Optional `row_number` (Number — leftover knowledge: **hint only**). Required leftover `status` enum leftover `SHEET_SYNC_STATUSES` (`pending` \| `synced` \| `failed`), default `"pending"`. Optional `last_synced_at` / leftover `last_error` (trim). Required leftover `updated_since_last_sync` default `true`. Leftover `SheetSyncEntry` is the TypeScript row of that subdocument. There is **no** leftover `status: "deleted"`. There is **no** leftover `job_id`. There is **no** unique `{ target }`. Form / Call / Booking / Cancellation leftover-declare `sheet_sync: { type: [sheetSyncSchema], default: [] }`. This beat does **not** write Google Sheets. This beat does **not** choose leftover `master_bad_leads`. This beat does **not** invent leftover `SheetSyncJob`.

3. **Drop deleted targets and merge last-write-wins hints by target** — leftover `removeSheetSyncEntries(existing, targets)` leftover-filters leftover `(existing ?? [])` against a leftover `Set` of leftover `target` strings. Leftover `mergeSheetSyncEntries(existing, updates)` leftover-builds a leftover `Map` keyed by leftover `target`, leftover-replays leftover existing then leftover updates, leftover-returns leftover `[...byTarget.values()]` (first-seen insertion order; a later write replaces the hint for that leftover `target`). Untouched leftover targets stay. A leftover `failed` write still stores leftover `failed` / leftover `last_error`. Leftover `undefined` existing leftover-behaves as leftover `[]`. This beat does **not** leftover-`save()`. This beat does **not** leftover-`updateOne`. This beat does **not** leftover-split leftover `{ status: "deleted" }` — leftover persistence leftover-filters those markers **before** it leftover-**asks** leftover remove.

There is no remember-the-sheet-rows-on-the-document operation. `syncAndStore` elects that. There is no drain-due-sheet-sync-jobs operation. `runSheetSyncDrain` elects that. There is no hold-the-Form-Lead operation. `FormLead.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the shared Lead source-company, move-type, and Lead-model field contracts, remember the per-target sheet-row hint subdocument, and drop deleted targets then merge last-write-wins hints by target — never store a deleted status, never enum `SOURCE_COMPANIES` here, never flip Lead-model required so Booking owns the helper, never merge historical relax, never copy this onto Testimonial optional `source_company`.” Form / Call / Booking / Cancellation rows / leftover remember / leftover drain / leftover historical relax already live in deeper **modules**. Do not pull those in. Do not invent a `SchemaHelpersService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `status: "deleted"` **adapter** so “one type owns every writer result.” Do not invent a `SOURCE_COMPANIES` enum **adapter** so “the slug matches the catalog.” Do not invent a unique `{ "sheet_sync.target": 1 }` **adapter** so “one tab owns the document.” Do not invent a CRUD folder so `fields.ts` / `sheet-sync.ts` / `merge.ts` each get a file.

Do not move leftover `mergeSheetSyncEntries` into leftover `sheetSyncPersistence.ts` so “the saver owns the merge.” Do not move leftover `sourceCompanyField` into leftover `FormLead.ts` so “Form owns the slug.” Do not merge this file into leftover `historical/schemaHelpers.ts` so “one helper owns runtime and historical.” Do not merge this file into leftover `Testimonial.ts` so “one field catalog owns Lead `source_company` and review `source_company`.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `sourceCompanyField` | `requiredLeadSourceCompanySlugField` | Form / Call / leftover later Granot CRM source still share required leftover `"not_provided"` + field index |
| `localField` | `requiredMoveTypeField` | Form still requires leftover `local` \| leftover `long_distance` |
| `optionalLocalField` | `optionalMoveTypeField` | Call / Booking may omit leftover Move Type |
| `leadModelField` | `requiredLeadModelField` | Booking / Cancellation still spread `required: false` on top |
| `sheetSyncSchema` | `sheetRowHintSchema` | Form / Call / Booking / Cancellation still declare leftover `sheet_sync[]` |
| `SheetSyncEntry` | `SheetRowHint` | leftover persistence / leftover drain / leftover Google Sheets types still share the stored hint |
| `removeSheetSyncEntries` | `dropDeletedSheetTargets` | leftover persistence and leftover drain drop leftover tabs after a leftover delete |
| `mergeSheetSyncEntries` | `mergeLastWriteWinsSheetHints` | leftover persistence and leftover drain refresh leftover `target` and keep leftover untouched tabs |

Keep the old names as one-line aliases until Form / Call / Booking / Cancellation / leftover Granot CRM source / leftover persistence / leftover drain migrate. Do not make callers learn `Map` / `Set` / `SHEET_SYNC_STATUSES` as the domain language. Do **not** add leftover `status: "deleted"` onto leftover `SheetSyncEntry` so “one type owns every writer result” — leftover persistence leftover-owns leftover `SheetSyncDeleteEntry`. Do **not** re-export leftover `SOURCE_COMPANIES` / leftover `LOCAL_TYPES` / leftover `LEAD_MODELS` so “Zod should import the helper” — Wave B `validation/` and leftover `config/domain/` are still locked. Do **not** export leftover `AgentAllocationSchema` so “runtime matches historical.”

**No class for the workflow.** The one type that *does* earn a name is the pending sheet-hint identity contract:

```ts
type SheetRowHintIdentity = {
  target: { unique_in_array: "last_write_wins"; unique_index: false }
  status: "pending" | "synced" | "failed"  // never "deleted"
  row_number: { identity: false; hint: true }
  updated_since_last_sync: { default: true }
}
```

That is the handoff from “this process remembered a tab” to “a second write for the same leftover `target` replaces the hint, a leftover delete drops it, and leftover `deleted` never lands on the document.” Do **not** add `{ status: "deleted" }` so “one union owns writer and store.” Do **not** add `{ target: { unique: true } }` so “Mongo refuses two hints for one tab.” Do **not** add `{ row_number: { required: true } }` so “the hint is identity.”

Leave already-recommended `FormLead.ts` / `CallLead.ts` / `BookedLead.ts` / `CancelledLead.ts` on those files. Leave leftover later `GranotCrmSource.ts` on that file. Leave leftover later `historical/schemaHelpers.ts` on that file. Leave leftover later `WordpressFormSubmissionReceipt.ts` on that file. Leave leftover remember on `sheetSyncPersistence.ts`. Leave leftover drain on `runSheetSyncDrain.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// schemaHelpers.ts
// Form, Call, Booking, Cancellation, and the Granot CRM source desk
// all need the same leftover string Source Company,
// the same leftover Move Type enum,
// the same leftover Lead-model enum,
// and the same leftover per-tab sheet hint.
// Hold those contracts here.
// When a live write or a drain comes back,
// drop the tabs we just deleted
// and merge the new hints onto what remains —
// last write wins by target, untouched tabs stay.
// Do not store deleted.
// Do not decide which tabs to write.
// Do not save the document.
// Do not drain.
// Do not assign a Source Company.
// Do not enum the Source Company catalog here
// so a leftover unknown slug 11000s.
// Do not flip Lead-model to optional
// so Booking owns the helper.
// Do not merge the historical relax.
// Do not copy this required not_provided
// onto leftover Testimonial optional source_company.

export const requiredLeadSourceCompanySlugField = sourceCompanyField
export const requiredMoveTypeField = localField
export const optionalMoveTypeField = optionalLocalField
export const requiredLeadModelField = leadModelField
export const sheetRowHintSchema = sheetSyncSchema
export type SheetRowHint = SheetSyncEntry

export { requiredLeadSourceCompanySlugField as sourceCompanyField }
export { requiredMoveTypeField as localField }
export { optionalMoveTypeField as optionalLocalField }
export { requiredLeadModelField as leadModelField }
export { sheetRowHintSchema as sheetSyncSchema }
export type { SheetRowHint as SheetSyncEntry }

// ── 1. Shared Lead field contracts ────────────────────────

export const sourceCompanyField = {
  type: String,
  required: true,
  default: "not_provided",
  index: true,
} as const // no trim; no SOURCE_COMPANIES enum; no unique

export const localField = {
  type: String,
  enum: LOCAL_TYPES,
  required: true,
  index: true,
} as const

export const optionalLocalField = {
  type: String,
  enum: LOCAL_TYPES,
  index: true,
} as const

export const leadModelField = {
  type: String,
  enum: LEAD_MODELS,
  required: true,
  index: true,
} as const // Booking / Cancellation spread required: false

// ── 2. Per-target sheet-row hint ──────────────────────────

export const sheetSyncSchema = rememberThePerTargetSheetRowHint() // _id false; status pending|synced|failed

function rememberThePerTargetSheetRowHint() {
  return new Schema(
    {
      target: requiredTrimmedTarget(),
      spreadsheet_id: requiredTrimmedSpreadsheetId(),
      tab_name: requiredTrimmedTabName(),
      row_number: optionalRowHint(),              // not identity
      status: requiredSheetHintStatusDefaultPending(),
      last_synced_at: optionalLastSyncedAt(),
      last_error: optionalTrimmedLastError(),
      updated_since_last_sync: requiredUpdatedSinceLastSyncDefaultTrue(),
    },
    { _id: false },
  )
}

// ── 3. Drop deleted targets, then last-write-wins merge ───

export function dropDeletedSheetTargets(existing, targets) {
  // today's removeSheetSyncEntries — (existing ?? []).filter not in Set
}

export function mergeLastWriteWinsSheetHints(existing, updates) {
  // today's mergeSheetSyncEntries — Map by target; existing then updates; values()
}

export { dropDeletedSheetTargets as removeSheetSyncEntries }
export { mergeLastWriteWinsSheetHints as mergeSheetSyncEntries }
```

Read the primary path out loud: *hold required `source_company` default `"not_provided"` with a field index and no catalog enum, hold required Form Move Type and optional Call / Booking Move Type, hold Lead-model required in the helper so Booking and Cancellation can spread it optional, hold `sheet_sync[]` hints with `pending` / `synced` / `failed` and `{ _id: false }`, then when a write comes back drop deleted `target`s and merge last-write-wins by `target`. Do not store `deleted`. Do not save. Do not drain. Do not enum `SOURCE_COMPANIES`. Do not flip Lead-model to optional. Do not merge historical relax.*

That is the operation. An unnamed field dump is not. `syncAndStore` is not here.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **`sourceCompanyField` is a free string. It is not leftover `SOURCE_COMPANIES`.** Default `"not_provided"` matches leftover `sources.ts` slug and leftover `getCplForSource` zero. The field does **not** enum leftover `SOURCE_COMPANIES`. An unknown / Granot / historical slug stores. First-class assignment lives on leftover `lead_source_company` ObjectId. Do not enum leftover `SOURCE_COMPANIES` here so “the slug matches the catalog” — unknown slugs would 11000. Do not unique-index `source_company` so “one company owns every Lead.” Do not change this path to ObjectId so “the helper matches leftover Feed.”

2. **Runtime `sourceCompanyField` has no `trim`. Later historical has `trim` and has no required / no default.** Later `historical/schemaHelpers.ts` exports optional trimmed indexed strings and does **not** export `sheetSyncSchema`. Do not add `trim` here so “runtime matches historical” without a paired proof that `" not_provided "` callers still match `not_provided`. Do not drop `required` / the default so “runtime matches historical.” Do not merge leftover `AgentAllocationSchema` / leftover `ImportMetadataFields` into this file so “one helper owns both trees.”

3. **`leadModelField` is required in this helper. Booking and Cancellation spread `required: false`.** Already-recommended Booking hook requires the Lead on the attached path. Already-recommended Cancellation validates an unresolved employee Booking without Lead metadata. Do not flip this helper to optional so “Booking owns the helper.” Do not flip Booking / Cancellation back to required so “Referral validate fails.”

4. **Form asks `localField`. Call and Booking ask `optionalLocalField`.** Leftover `LOCAL_TYPES` is `local` | `long_distance`. There is no `unknown`. Do not require Call `local` so “Call matches Form.” Do not add `"not_found"` onto leftover `LOCAL_TYPES` from this rename so “Move Type matches leftover Form unknown state.”

5. **`SheetSyncEntry.status` never includes `deleted`. Leftover persistence owns leftover `SheetSyncDeleteEntry`.** Leftover writers emit `{ target, status: "deleted" }` after leftover `deleteRowsFromTargets`. Leftover `syncAndStore` filters those markers **before** it asks `removeSheetSyncEntries`. Leftover drain deletes only when leftover `op === "delete"` **and** leftover `status === "synced"` (a failed delete does **not** drop the hint). Do not add `status: "deleted"` onto `SheetSyncEntry` so “one type owns every result.” Do not store `deleted` rows so “the document remembers the delete.”

6. **Merge is last-write-wins by `target`. Order is first-seen insertion.** Existing then updates rebuild a `Map`. A Form write that omits `master_bad_leads` keeps the old Bad Leads hint until a delete-marker drops it. Knowledge names Bad Leads / Call duplicate-flip rules on the **writers**, not here. Do not drop omitted targets so “one sync owns the whole array.” Do not unique-index `{ "sheet_sync.target": 1 }` so “Mongo refuses two hints.”

7. **`row_number` is a hint. Lead ID is identity.** Leftover `google-sheets.md` upserts by Mongo ID column and uses `row_number` only when it still contains that id. Do not require `row_number` so “the hint is identity.” Do not drop `row_number` so “writers always scan.”

8. **Later Granot CRM source asks `sourceCompanyField`.** A new CRM source without `source_company` becomes `"not_provided"`. Project-organization says do not repurpose leftover string `source_company` as leftover `lead_source_company`. Do not copy this helper off that desk so “CRM source matches Lead” without reading `GranotCrmSource.ts` as its own pass. Do not require a leftover `SOURCE_COMPANIES` enum on that desk from this rename.

9. **Testimonial optional `source_company` is not this helper.** Already-recommended review path is optional trim and **not** indexed. Do not copy `sourceCompanyField` onto Testimonial so “every `source_company` matches Lead.”

10. **This file has no tests.** `FormLead.test.ts` does not name `source_company` default `"not_provided"`. Merge / remove have no dedicated file. Proofs sit on persistence copy and drain copy, or are missing. Do not add a helper-unit file per child name. Prove the **interface**.

11. **`updated_since_last_sync` defaults `true`. Drain synced writes set `false`.** Leftover `toSheetSyncEntry` on the drain sets `updated_since_last_sync: false` after a synced upsert and `true` after failed / deferred. This schema default is “dirty until a writer says otherwise.” Do not flip the default to `false` so “new hints look synced.”

12. **Leave sibling modules alone.** Form / Call / Booking / Cancellation rows, leftover remember, leftover drain, leftover Google Sheets types, leftover later Granot CRM source, leftover later historical relax, leftover later WordPress receipt, and already-recommended Testimonial are already the right **depth**. This file holds the shared contracts and the drop-then-merge pair. `syncAndStore` / `runSheetSyncDrain` / `FormLead` are those **interfaces**, not this one.

## Testing

The **interface** is the test surface: `sourceCompanyField` / `localField` / `optionalLocalField` / `leadModelField` validate through a throwaway schema, `sheetSyncSchema` validate, `removeSheetSyncEntries`, `mergeSheetSyncEntries`.

There is no `schemaHelpers.test.ts`. Today’s proofs sit on callers or are missing. Persistence has no folder test. Drain has no `runSheetSyncDrain.test.ts`. Keep caller proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Shared field contracts**
- `sourceCompanyField` is required and defaults `"not_provided"`.
- `sourceCompanyField` is field-indexed and **not** unique.
- `sourceCompanyField` has **no** `trim` and **no** `SOURCE_COMPANIES` enum.
- `localField` requires `local` or `long_distance` and refuses `"not_found"`.
- `optionalLocalField` accepts omitted `local`.
- `leadModelField` requires `FormLead` or `CallLead`.
- Spreading `{ ...leadModelField, required: false }` still accepts omitted `lead_model`.

**Sheet-row hint**
- `sheetSyncSchema` options `_id` is `false`.
- `status` defaults `"pending"` and refuses `"deleted"`.
- `updated_since_last_sync` defaults `true`.
- `row_number` is optional.
- `target` / `spreadsheet_id` / `tab_name` are required and trim.
- `SheetSyncEntry` status union is `pending` | `synced` | `failed`.

**Drop then merge**
- `removeSheetSyncEntries(undefined, ["master_bad_leads"])` returns `[]`.
- `removeSheetSyncEntries` drops matching `target` and keeps others.
- `mergeSheetSyncEntries` replaces the same `target` and keeps untouched targets.
- A later `failed` update still stores `failed` / `last_error`.
- A new `target` appends after first-seen existing targets.

Do **not** add a test per helper (`rememberThePerTargetSheetRowHint`, `requiredTrimmedTarget`). Those names exist so the parent reads. Do **not** `save()` a Form from this file’s tests. Do **not** drain from this file’s tests. Do **not** `syncIndexes` so “the test creates a unique index.”

There is no named index export to keep for a second migration **adapter**.

## What I would not do

- A `SchemaHelpersService` / `SheetSyncHelpersService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema` field objects.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `fields.ts` / `sheet-sync.ts` / `merge.ts` split for cleanliness.
- Inventing a `SOURCE_COMPANIES` enum **seam** so “the slug matches the catalog.”
- Inventing a `status: "deleted"` **seam** so “one type owns every writer result.”
- Breaking the required `leadModelField` **seam** by flipping it optional without a paired proof that Form never imports it and Booking / Cancellation still spread `required: false`.
- Treating `syncAndStore` / `persistDocSheetSync` / `runSheetSyncDrain` as this story. Those functions save or `updateOne`.
- Treating `FormLead.ts` / `CallLead.ts` / `BookedLead.ts` / `CancelledLead.ts` as this story. Those files hold the rows.
- Treating later `GranotCrmSource.ts` as this story. That desk asks the helper and owns lifecycle routes.
- Treating later `historical/schemaHelpers.ts` as this story. That file relaxes enums and adds import metadata.
- Treating already-recommended `Testimonial.ts` as this story. That optional `source_company` is **not** this helper.
- Treating next `WordpressFormSubmissionReceipt.ts` as this story.
- Inventing a unique `{ "sheet_sync.target": 1 }` **adapter** that has only “one tab per document” as its second home.
- Inventing a `trim` **adapter** on runtime `sourceCompanyField` that has only “matches historical” as its second home.
- Silently enuming `SOURCE_COMPANIES` so “unknown slugs 11000.”
- Silently adding `status: "deleted"` so “the document remembers the delete.”
- Silently merging historical relax into this file.
- Silently copying this helper onto Testimonial optional `source_company`.
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
