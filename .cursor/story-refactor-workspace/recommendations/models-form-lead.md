# Remember The Form Lead Row On The Selected Mongo Database, Fold Identity Before Validate, And Declare Named Lookup Indexes The Migration Applies — Never Ingest Or Correct Here, Never Auto-Create Indexes On Boot, Never Invent A Unique Lead Job Index — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 1 of this service — `FormLead.ts`
- Remaining in this service: `CallLead.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/FormLead.ts`
- Knowledge: [`docs/knowledge/services/form-lead.md`](../../../docs/knowledge/services/form-lead.md) (System of Record is Mongo `form_leads`. Ingest / correct / CRM Posting / Sheet Sync live on already-recommended `formLead.service.ts`. Additive `job_no` / `normalized_job_no` is distinct from Tracking Reference `ref_no`. The model may omit `move_size` / `move_date` so trusted Granot creation can preserve absence. Named S08 Form indexes are created only by `pnpm migration:granot-lifecycle:indexes` after a reviewed report; they are non-unique and never a global unique Lead Job index. Knowledge resource list names the service, not this file — do not add a Models Service file in this rename so “the Service sentence wins”). Distinct from already-recommended ingest: [form-lead.md](form-lead.md) (`ingestFormLead` / `beginFormLeadIngestion` / `completeFormLeadIngestion` — **this file never posts, never messages, never projects sheets**). Distinct from already-recommended provenance stamps: [leads-ingestion-provenance.md](leads-ingestion-provenance.md) (who assign `ingestion_origin` and ingested snapshots — **this file only stores and guards the paths**). Distinct from leftover sibling field catalog: `granotLifecycleSchemas.ts` (`formLeadProvenanceSchemaFields`, `applyLeadProvenanceGuards`, `applyAggregateRevisionGuards` — **this file asks them; it does not own the guard bodies**). Distinct from leftover sibling field helpers: `schemaHelpers.ts` (`sourceCompanyField`, `localField`, `sheetSyncSchema` — **leave that file for a later models pass**). Distinct from leftover historical relax: `historical/FormLead.ts` (`registerHistoricalFormLead` on `vantagemovershistorical`; unique sparse `lid`; **no provenance, no S08 catalog, no `getFormLeadModel`**). Distinct from leftover next Call Lead row: `CallLead.ts` (`getCallLeadModel`, `requireLeadIdentity`, RingCentral caller immutability — **do not merge**). Distinct from leftover migration: `scripts/migrations/granot-lifecycle-indexes.ts` (**asks** `FORM_LEAD_S08_INDEXES`; report-first; **this file never creates indexes at runtime**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md), [Form Lead Ingestion](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [Tracking Reference](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model.** Already-recommended `leads/formLead.service.ts` **asks** `getFormLeadModel` (ingest / correct / find / remove). Already-recommended `leads/duplicateLead.service.ts` and `leads/sourceLeadLookup.service.ts` **ask** `getFormLeadModel`. Already-recommended `granotLifecycle/identity.ts`, `createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, `processor.ts` **ask** `getFormLeadModel`. Already-recommended `domainCommands/entityChange.ts` **asks** `getFormLeadModel` when the aggregate is a Form Lead. Already-recommended `search/formLeadSearch.service.ts` and leftover `employeeBookings/leadCandidateQueries.ts` **ask** the default `FormLead` export — they do **not** call `getFormLeadModel`. Already-recommended `leads/leadLocation.service.ts` and leftover `googleSheets/projections/formLeadRow.ts` **ask** `FORM_LEAD_UNKNOWN_STATE`. `FormLead.test.ts` **asks** `FormLead` + `FORM_LEAD_S08_INDEXES` (schema validate + declared index keys; **does not** open Mongo). Leftover `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `FORM_LEAD_S08_INDEXES`. Not this **interface**: `ingestFormLead` itself, `findDuplicateFormLeadMatch` itself, `normalizeJobNo` itself, `normalizePhoneNumberForMatch` itself, sibling provenance guard bodies.
- Seams callers need: default `FormLead` (first-registered connection) vs `getFormLeadModel()` (selected `getMongoDatabaseName()`); `autoIndex: false` vs leftover migration apply; named `FORM_LEAD_S08_INDEXES` catalog vs unnamed browse indexes on the same schema; `FORM_LEAD_UNKNOWN_STATE` (`"not_found"`) vs a missing zip; pre-validate identity fold vs sibling provenance / revision guards; optimistic concurrency (`__v`) vs leftover `domain_revision` (sibling fields — **not** the same contract). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no CRM Posting **seam**.
- Split later (only if the file outgrows one sitting): this ~213-line file is one sitting if you read it as remember the Form Lead row on the selected Mongo database, fold identity before validate, and declare named lookup indexes the migration applies — never ingest or correct here, never auto-create indexes on boot, never invent a unique Lead Job index. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts`. Ingest stays already-recommended `formLead.service.ts`. Provenance field catalog stays leftover `granotLifecycleSchemas.ts`. Historical relax stays leftover `historical/FormLead.ts`. Next Call Lead row stays leftover `CallLead.ts`.

`FormLead` is a Mongoose model name. The owner question is: *A quote just became a Form Lead — or Granot / Best Relocation / Admin is about to write one. Hold the row on `form_leads`. Before validate, fold Lead ID, phone, contact name, and Job Number so later matching can find this lead. Keep the four named S08 lookup indexes on the schema so the reviewed migration can apply them, and never make Job Number unique. If this process selected a different Mongo database, hand back that database’s Form Lead model. Do not post to Granot. Do not enqueue Sheet Sync. Do not decide Duplicate Lead here.*

Who ingest / correct / remove already lives in already-recommended `formLead.service.ts`. Who stamp Ingestion Origin already lives in already-recommended `leadIngestionProvenance.ts`. Who fold phone / name / Job Number primitives already live in leftover `utils/phone` and already-recommended `bookingIdentity.ts`. Who refuse origin mutation already lives in leftover `granotLifecycleSchemas.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Form Lead row, fold identity before validate, and bind the selected Mongo database” story, not “a Form Lead model CRUD dump,” and not Form Lead Ingestion / Form Lead Correction themselves:

1. **Hold the Form Lead as the System of Record row** — collection `form_leads`, `autoIndex: false`, `optimisticConcurrency: true`, timestamps. Declares source / contact / move / CPL snapshot / receiver-agent / `sheet_sync[]`, then **asks** leftover `formLeadProvenanceSchemaFields` and leftover `aggregateRevisionSchemaFields`. Default unknown state is `FORM_LEAD_UNKNOWN_STATE` (`"not_found"`). Required contact is `name` + `phone_number`; required zips are `pickup_zip` + `destination_zip`. `move_size` / `move_date` / `job_no` may be absent. `ref_no` defaults `"not provided"`. Then **asks** leftover `applyLeadProvenanceGuards` / `applyAggregateRevisionGuards` so a new row cannot store `legacy_unknown` or `legacy_baseline`, and origin / ingested snapshots / `change_history_started_at` stay write-once after insert. This beat does **not** assign Ingestion Origin. This beat does **not** detect a Duplicate Lead.

2. **Fold identity before validate** — `pre("validate")` currently named `normalizeEmployeeBookingFields`. Sets `normalized_lid` from `lid`, `normalized_phone_number` from `phone_number`, `normalized_contact_name` from `name`, `normalized_job_no` from `job_no`. Runs for every Form Lead, not only an employee-booking match. This beat does **not** generate a missing `lid`. This beat does **not** invent today’s `move_date`.

3. **Bind the selected Mongo database and declare the named lookup indexes the migration applies** — default export `FormLead` is `mongoose.models.FormLead ?? mongoose.model(...)`. `getFormLeadModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Named catalog `FORM_LEAD_S08_INDEXES` is four non-unique indexes (`form_lead_normalized_job_no`, `form_lead_source_granularity_normalized_job_no`, `form_lead_source_granularity_normalized_phone_duplicate`, `form_lead_ref_no_duplicate`) plus `accepted_names` for leftover deployed aliases. Unnamed browse indexes (source + `createdAt`, phone, email, `normalized_lid` sparse, and the three source-granularity identity triples) stay on the schema. `autoIndex` stays false. This beat does **not** call `syncIndexes`. This beat does **not** declare a unique Lead Job index.

`FORM_LEAD_UNKNOWN_STATE` is a sentinel **seam** for location / sheet projection, not a fourth owner story. `FormLeadDocument` is the inferred row type.

There is no ingest operation. Already-recommended `formLead.service.ts` elects that. There is no historical-relax operation. Leftover `historical/FormLead.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the Form Lead row on the selected Mongo database, fold identity before validate, and declare named lookup indexes the migration applies — never ingest or correct here, never auto-create indexes on boot, never invent a unique Lead Job index.” Already-recommended ingest / duplicate / location / identity already live in deeper **modules**. Leftover provenance field catalog and leftover historical relax already live in sibling **modules**. Do not pull those in. Do not invent a `FormLeadModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent an `autoIndex: true` **adapter** so “boot creates S08.” Do not invent a unique `{ normalized_job_no: 1 }` **adapter** so “one Lead per Job.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `normalize.ts` each get a file.

Do not move leftover `formLeadProvenanceSchemaFields` into this file so “the Form Lead owns provenance.” Do not move leftover `getFormLeadModel` into `db.ts` so “one helper owns every selected-database model” without a paired proof that ingest still writes `form_leads` on the selected name and search still reads the same rows. Do not merge this file into leftover `CallLead.ts` so “one Lead model owns Form and Call.” Do not merge this file into leftover `historical/FormLead.ts` so “one schema owns the live row and the historical relax.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `FormLead` | `formLeadOnTheDefaultConnection` | search / employee-booking candidate reads still import the default model |
| `getFormLeadModel` | `formLeadOnTheSelectedMongoDatabase` | ingest / lifecycle / duplicate / EntityChange must follow `getMongoDatabaseName()` |
| `FormLeadDocument` | `FormLeadRow` | inferred document + `_id` + `sheet_sync[]` |
| `FORM_LEAD_S08_INDEXES` | `namedFormLeadLookupIndexesTheMigrationApplies` | leftover `pnpm migration:granot-lifecycle:indexes` is the only apply path |
| `FORM_LEAD_UNKNOWN_STATE` | `formLeadStateWhenTheZipWasNotFound` | location + sheet projection share `"not_found"` |

Keep the old names as one-line aliases until `formLead.service.ts`, search, employee-booking candidates, and the S08 migration migrate. Do not make callers learn `normalized_lid` / `accepted_names` / `useDb` as the domain language. Do **not** delete the default `FormLead` export so “everyone must call the getter” without a paired proof that leftover `formLeadSearch.service.ts` and leftover `leadCandidateQueries.ts` still find the same rows they find today.

**No class for the workflow.** The one type that *does* earn a name is the selected-database handoff:

```ts
type FormLeadOnTheSelectedMongoDatabase = Model<FormLeadRow>
```

That is the handoff from “this process chose `getMongoDatabaseName()`” to “ingest and Granot identity read and write the same `form_leads` collection.” Do **not** add a historical connection onto that type. Do **not** collapse `FORM_LEAD_UNKNOWN_STATE` into `null` so “missing state is just empty.”

Leave leftover `formLeadProvenanceSchemaFields` on leftover `granotLifecycleSchemas.ts`. Leave leftover `registerHistoricalFormLead` on leftover `historical/FormLead.ts`. Leave leftover `CallLead` on leftover `CallLead.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// FormLead.ts
// A quote just became a Form Lead — or Granot / Best Relocation / Admin
// is about to write one.
// Hold the row on form_leads.
// Before validate, fold Lead ID, phone, contact name, and Job Number
// so later matching can find this lead.
// Keep the four named S08 lookup indexes on the schema
// so the reviewed migration can apply them,
// and never make Job Number unique.
// If this process selected a different Mongo database,
// hand back that database's Form Lead model.
// Do not post to Granot.
// Do not enqueue Sheet Sync.
// Do not decide Duplicate Lead here.

export const formLeadStateWhenTheZipWasNotFound = "not_found"
export const namedFormLeadLookupIndexesTheMigrationApplies = [ /* four non-unique */ ] as const

export const formLeadOnTheDefaultConnection =
  mongoose.models.FormLead ?? mongoose.model("FormLead", formLeadSchema)

export function formLeadOnTheSelectedMongoDatabase() {
  if (thisConnectionAlreadyIsTheSelectedDatabase()) {
    return formLeadOnTheDefaultConnection
  }
  return formLeadRegisteredOnTheSelectedDatabase()
}

export { formLeadOnTheDefaultConnection as FormLead }
export { formLeadOnTheSelectedMongoDatabase as getFormLeadModel }
export { formLeadStateWhenTheZipWasNotFound as FORM_LEAD_UNKNOWN_STATE }
export { namedFormLeadLookupIndexesTheMigrationApplies as FORM_LEAD_S08_INDEXES }

// ── 1. Hold the Form Lead as the System of Record row ─────

const formLeadSchema = rememberTheFormLeadRow() // collection form_leads; autoIndex false

function rememberTheFormLeadRow() {
  const schema = new Schema(
    {
      /* source, contact, move, CPL snapshot, receiver agent, sheet_sync */
      ...askSiblingForFormLeadProvenanceFields(),
      ...askSiblingForAggregateRevisionFields(),
    },
    { collection: "form_leads", autoIndex: false, optimisticConcurrency: true, timestamps: true },
  )
  declareBrowseLookupIndexes(schema)
  declareNamedS08LookupIndexes(schema)
  askSiblingToRefuseLegacyUnknownOnANewRowAndKeepOriginWriteOnce(schema)
  askSiblingToKeepRevisionMetadataPairedAndHistoryStartWriteOnce(schema)
  foldFormLeadIdentityBeforeValidate(schema)
  return schema
}

// ── 2. Fold identity before validate ──────────────────────

function foldFormLeadIdentityBeforeValidate(schema) {
  schema.pre("validate", function foldLidPhoneNameAndJobNumber() {
    this.normalized_lid = foldTheLeadId(this.lid)
    this.normalized_phone_number = foldThePhone(this.phone_number)
    this.normalized_contact_name = foldTheContactName(this.name)
    this.normalized_job_no = foldTheJobNumber(this.job_no)
  })
}

// ── 3. Bind the selected database and declare named indexes

function thisConnectionAlreadyIsTheSelectedDatabase() {
  return mongoose.connection.name === selectedMongoDatabaseName()
}

function formLeadRegisteredOnTheSelectedDatabase() {
  const db = mongoose.connection.useDb(selectedMongoDatabaseName(), { useCache: true })
  return db.models.FormLead ?? db.model("FormLead", formLeadSchema)
}
```

Read the primary path out loud: *hold the Form Lead on `form_leads` without auto-indexing. Ask the sibling catalog for provenance and revision paths, then ask those sibling guards so a new row cannot pretend it is legacy and so origin / ingested snapshots stay write-once. Before validate, fold Lead ID, phone, contact name, and Job Number. Keep four named non-unique S08 lookup indexes plus the browse indexes. If this process already sits on the selected database, hand back the default model; otherwise register the same schema on `useDb`. Do not ingest. Do not correct. Do not make Job Number unique.*

That is the operation. `normalizeEmployeeBookingFields` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`normalizeEmployeeBookingFields` lies.** The hook folds `lid`, phone, name, and Job Number for every Form Lead. Employee-booking matching is one later reader. Rename the beat `foldFormLeadIdentityBeforeValidate`. Do not move the hook into leftover `employeeBookings/`.

2. **Two model adapters.** Ingest, duplicate, Granot identity, and EntityChange **ask** `getFormLeadModel`. Search and employee-booking candidates **ask** default `FormLead`. One story, two **adapters**. Keep both exports. Do not silently migrate search onto the getter in this rename without a paired proof that browse still reads the selected database’s `form_leads` — and do not delete the getter so “Mongoose default is enough” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database.

3. **Named S08 catalog vs unnamed browse indexes.** `FORM_LEAD_S08_INDEXES` is what leftover `pnpm migration:granot-lifecycle:indexes` applies. The source / phone / email / identity-triple indexes are declared on the schema and are not in that catalog. Do not merge the lists so “one array owns every index” without a paired report that `autoIndex` stays false and the reviewed migration apply stays first.

4. **`__v` is not `domain_revision`.** Optimistic concurrency is Mongoose. Lifecycle revision is leftover sibling fields. Do not rename `__v` to `domain_revision` or drop `optimisticConcurrency` so “one version owns the row.”

5. **Do not silently enable `autoIndex`.** The schema is the declaration. The migration is the apply. Boot must not create S08.

6. **Leave sibling modules alone.** Provenance field catalog, ingest, historical relax, and Call Lead identity are already the right **depth**. This file orchestrates the Form Lead row.

## Testing

The **interface** is the test surface: `FormLead` validate, `getFormLeadModel`, `FORM_LEAD_S08_INDEXES`, `FORM_LEAD_UNKNOWN_STATE`.

Today’s `FormLead.test.ts` already names the row, not ingest: origin / snapshot paths, Job Number distinct from Tracking Reference, immutable origin / ingested snapshots after insert, new rows refuse `legacy_unknown` / `legacy_baseline`, trusted omit of `move_size` / `move_date`, receiver-agent enum keeps `granot_username_match` and `extension_crm_username_match`, four S08 indexes and no unique Lead Job index. Keep those as the operation proofs.

Add (or keep, if a later implementer finds them missing) only interface proofs:

**Hold the row**
- A new Form Lead may omit `move_size` / `move_date` / `job_no` and still validate.
- `ref_no` stays `"not provided"` when omitted.
- Pickup / delivery state default to `FORM_LEAD_UNKNOWN_STATE`.
- After insert, `ingestion_origin` and ingested snapshots reject mutation.

**Fold identity**
- Validate folds `lid` → `normalized_lid`, phone → `normalized_phone_number`, name → `normalized_contact_name`, `job_no` → `normalized_job_no`.
- Folding Job Number does not copy `ref_no`.

**Selected database + named indexes**
- `FORM_LEAD_S08_INDEXES` is exactly the four named non-unique keys; none is `unique`.
- `getFormLeadModel()` returns `FormLead` when `connection.name` already is `getMongoDatabaseName()`.
- `schema.options.autoIndex === false`.

Do **not** add a test per helper (`foldTheLeadId`, `thisConnectionAlreadyIsTheSelectedDatabase`). Those names exist so the parent reads. Do **not** HTTP ingest from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates S08.”

`getFormLeadModel` stays exported because selected-database binding is a second real **adapter**, not a test leak.

## What I would not do

- A `FormLeadModelService` / `FormLeadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` split for cleanliness.
- Breaking the selected-database **seam**. Ingest must not write live `form_leads` while `TEST_MODE` selected `testvantagemovers`.
- Treating already-recommended `ingestFormLead` as this story. That service owns Duplicate Lead, CRM Posting, and Sheet Sync.
- Treating leftover `historical/FormLead.ts` as this story. That row relaxes required fields and unique `lid` on another database.
- Treating leftover `CallLead.ts` as this story.
- Inventing a unique Lead Job **seam** that the live cluster must not have.
- Inventing an `autoIndex: true` **adapter** that has only “convenience” as its second home.
- Silently “fixing” ADR-0001 / ADR-0002 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
