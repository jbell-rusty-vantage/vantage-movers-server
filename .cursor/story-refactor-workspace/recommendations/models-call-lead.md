# Remember The Call Lead Row On The Selected Mongo Database, Fold Phone And Job Number Before Validate, Require Phone Or Job, Keep One Lead Per RingCentral Session And The Original Caller Immutable, And Declare Named Lookup Indexes The Migration Applies — Never Ingest Or Qualify Here, Never Auto-Create Indexes On Boot, Never Invent A Unique Lead Job Index — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 2 of this service — `CallLead.ts`
- Remaining in this service: `BookedLead.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/CallLead.ts`
- Knowledge: [`docs/knowledge/services/call-lead.md`](../../../docs/knowledge/services/call-lead.md) (System of Record is Mongo `call_leads`. Ingest / correct / Sheet Sync live on already-recommended `callLead.service.ts`. RingCentral promotion lives on already-recommended `ringcentral-call-lead-ingest.service.ts`. Unique sparse `ringcentral.telephony_session_id` is one physical call — webhook vs cron — not a business Duplicate Lead. Job-only Granot create is legal. Named S08 Call indexes are created only by `pnpm migration:granot-lifecycle:indexes` after a reviewed report; they are three non-unique keys and never a global unique Lead Job index. Knowledge resource list names the service, not this file — do not add a Models Service file in this rename so “the Service sentence wins”). Related qualification: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (120s answered; this file never qualifies). Distinct from already-recommended ingest: [leads-call-lead.md](leads-call-lead.md) (`ingestCallLead` / `beginCallLeadIngestion` / `beginRingCentralCallLeadIngestion` / `completeCallLeadIngestion` — **this file never prices, never Form-Fills, never projects sheets**). Distinct from already-recommended promotion: [ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (**asks** leftover Call Lead begin / complete — **this file never promotes**). Distinct from already-recommended duplicate window: [ringcentral-duplicate-guard.md](ringcentral-duplicate-guard.md) (90-day exact Source Granularity + phone — **this file only stores `duplicate` and declares the lookup index**). Distinct from already-recommended adoption: [ringcentral-call-lead-convergence.md](ringcentral-call-lead-convergence.md) (`findOneAndUpdate` with `"ringcentral.original_caller": { $exists: false }` — **this file is the query-update fence that leftover adoption must keep**). Distinct from already-recommended provenance stamps: [leads-ingestion-provenance.md](leads-ingestion-provenance.md) (who assign `ingestion_origin` and ingested snapshots — **this file only stores and guards the paths**). Distinct from leftover sibling field catalog: `granotLifecycleSchemas.ts` (`callLeadProvenanceSchemaFields` including required `quoted` default false + `ringcentral_convergence` + shared `job_no` / snapshots, `applyLeadProvenanceGuards`, `applyAggregateRevisionGuards` — **this file asks them; it does not own the guard bodies**). Distinct from leftover sibling field helpers: `schemaHelpers.ts` (`sourceCompanyField`, `optionalLocalField`, `sheetSyncSchema` — **leave that file for a later models pass**). Distinct from leftover historical relax: `historical/CallLead.ts` (`registerHistoricalCallLead` on `vantagemovershistorical`; no provenance, no S08 catalog, no `getCallLeadModel`, no `requireLeadIdentity`, no RingCentral). Distinct from already-recommended Form Lead row: [models-form-lead.md](models-form-lead.md) (`getFormLeadModel`, lid / name fold, four S08 indexes, no RingCentral — **do not merge**). Distinct from leftover next Booking row: `BookedLead.ts` (one official Booking per normalized Job — **do not copy that unique onto Call**). Distinct from leftover migration: `scripts/migrations/granot-lifecycle-indexes.ts` (**asks** `CALL_LEAD_S08_INDEXES`; report-first; unique array stays empty; **this file never creates indexes at runtime**). Distinct from leftover processed-call ledger unique session indexes (`ringcentral_processed_call_telephony_session_id_unique` — **a different collection**). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Call Lead](../../../../CONTEXT.md), [Call Lead Ingestion](../../../../CONTEXT.md), [Call Qualification](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [Caller Match Key](../../../../CONTEXT.md), [RingCentral Call Adoption](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [Job Number](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **selected-database getter vs default-connection model — and ingest sits on the default.** Already-recommended `leads/callLead.service.ts` **asks** default `CallLead` for Admin / RingCentral ingest, correct, list, and remove — it does **not** call `getCallLeadModel`. Already-recommended `search/callLeadSearch.service.ts`, `search/callLeadBrowse.service.ts`, leftover `enrichment/callLeadEnrichment.service.ts`, leftover `reconciliation/bookedCallLeadReconciliation.service.ts`, leftover `employeeBookings/leadCandidateQueries.ts` / `bookingLeadReconciliation.service.ts` / `bookingLeadAttachment.service.ts`, leftover `ringcentral-duplicate-guard.ts`, leftover `bookings/bookingSourceResolver.ts`, leftover `admin/adminScope.service.ts`, leftover `operationsRegistry/cplCorrections.ts` / `catalogRegistry.ts`, leftover `bestRelocationSheetIngest/*`, leftover `leads/leadPhoneMatching.ts`, leftover `googleSheets/sheetContains.ts` **ask** default `CallLead`. Already-recommended `leads/duplicateLead.service.ts` and `leads/sourceLeadLookup.service.ts` **ask** `getCallLeadModel`. Already-recommended `granotLifecycle/identity.ts`, `createLeadFromGranot.ts`, `synchronizeLeadFromGranot.ts`, `processor.ts`, `projections.ts`, leftover `bookingConfirmation.ts` / `bookingOwnerCommands.ts` / `connectBookingToLead.ts` / `releaseOwnerCommands.ts` / `discrepancyOwnerCommands.ts` **ask** `getCallLeadModel`. Already-recommended `domainCommands/entityChange.ts` **asks** `getCallLeadModel` when the aggregate is a Call Lead. Already-recommended `cancellations/cancelledLead.service.ts` **asks** `getCallLeadModel`. Already-recommended `ringcentral/callLeadConvergence.service.ts` and leftover `reporting/query/canonicalReporting.ts`, leftover `operationsRegistry/sourceRegistry.ts` / `ringCentralRegistry.ts` / `queries/health.ts` **ask** `getCallLeadModel`. `CallLead.test.ts` **asks** `CallLead` + `CALL_LEAD_S08_INDEXES` (schema validate + declared index keys; **does not** open Mongo). Leftover `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `CALL_LEAD_S08_INDEXES`. `v1.validation.test.ts` **asks** default `CallLead` for job-only / identity-less validate. Not this **interface**: `ingestCallLead` itself, `ingestRingCentralQualifiedCall` itself, `classifyRingCentralCallLeadDuplicate` itself, `attemptRingCentralCallLeadConvergence` itself, `normalizeJobNo` itself, `normalizePhoneNumberForMatch` itself, sibling provenance guard bodies.
- Seams callers need: default `CallLead` (first-registered connection — **including already-recommended ingest**) vs `getCallLeadModel()` (selected `getMongoDatabaseName()`); `autoIndex: false` vs leftover migration apply; named `CALL_LEAD_S08_INDEXES` catalog vs unnamed browse / duplicate-window / unique-session indexes on the same schema; unique sparse `ringcentral.telephony_session_id` vs non-unique S08 vs leftover processed-call ledger; `requireLeadIdentity` (phone **or** Job Number) vs Form Lead’s required name + phone; schema `immutable` on `ringcentral.original_caller` vs query-update `rejectRingCentralCallerReplacement` vs leftover adoption’s `"ringcentral.original_caller": { $exists: false }` escape; Granot-created `post_to_granot` must stay false vs Admin / legacy_import may post; optimistic concurrency (`__v`) vs leftover `domain_revision` (sibling fields — **not** the same contract). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Call Qualification **seam**.
- Split later (only if the file outgrows one sitting): this ~299-line file is one sitting if you read it as remember the Call Lead row on the selected Mongo database, fold phone and Job Number before validate, require phone or Job, keep one lead per RingCentral session and the original caller immutable, and declare named lookup indexes the migration applies — never ingest or qualify here, never auto-create indexes on boot, never invent a unique Lead Job index. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `ringcentral.ts`. Ingest stays already-recommended `callLead.service.ts`. Promotion stays already-recommended `ringcentral-call-lead-ingest.service.ts`. Provenance field catalog stays leftover `granotLifecycleSchemas.ts`. Historical relax stays leftover `historical/CallLead.ts`. Already-recommended Form Lead row stays [models-form-lead.md](models-form-lead.md). Next Booking row stays leftover `BookedLead.ts`.

`CallLead` is a Mongoose model name. The owner question is: *A sparse call just became a Call Lead — Admin typed it, RingCentral promoted a qualified session, Granot minted a job-only row, or Best Relocation imported it. Hold the row on `call_leads`. Before validate, fold phone and Job Number, and refuse a row that has neither. Keep at most one Call Lead per RingCentral telephony session, and once original-caller evidence is stored, do not let a query update replace it unless leftover adoption is attaching it for the first time. Keep the three named S08 lookup indexes on the schema so the reviewed migration can apply them, and never make Job Number unique. If this process selected a different Mongo database, hand back that database’s Call Lead model. Do not qualify the two-minute rule. Do not classify a business Duplicate Lead. Do not post to Granot. Do not enqueue Sheet Sync.*

Who ingest / correct / remove already lives in already-recommended `callLead.service.ts`. Who promote a qualified call already lives in already-recommended `ringcentral-call-lead-ingest.service.ts`. Who stamp Ingestion Origin already lives in already-recommended `leadIngestionProvenance.ts`. Who fold phone / Job Number primitives already live in leftover `utils/phone` and already-recommended `bookingIdentity.ts`. Who refuse origin mutation already lives in leftover `granotLifecycleSchemas.ts`. Do not pull those in.

## What this file actually does

Four operations of one “remember the Call Lead row, fold identity before validate, keep one physical RingCentral call as one Call Lead, and bind the selected Mongo database” story, not “a Call Lead model CRUD dump,” and not Call Lead Ingestion / Call Qualification themselves:

1. **Hold the Call Lead as the System of Record row** — collection `call_leads`, `autoIndex: false`, `optimisticConcurrency: true`, timestamps. Declares source / optional contact / optional move / CPL snapshot / `form_fill` / `created_on_unmatched` / `duplicate` / receiver-agent / `sheet_sync[]`, then nested `ringcentral.*` transport (session, call-log, route, qualification timestamps, immutable `original_caller`). Then **asks** leftover `callLeadProvenanceSchemaFields` (Ingestion Origin enum, required `quoted` default `false`, `ringcentral_convergence`, shared `job_no` / snapshots) and leftover `aggregateRevisionSchemaFields`. Granot-created `post_to_granot` must stay `false`; Admin / `legacy_import` may still be true. Then **asks** leftover `applyLeadProvenanceGuards` / `applyAggregateRevisionGuards` so a new row cannot store `legacy_unknown` or `legacy_baseline`, and origin / ingested snapshots / `change_history_started_at` stay write-once after insert. This beat does **not** assign Ingestion Origin. This beat does **not** detect a Duplicate Lead. This beat does **not** decide Form Fill.

2. **Fold identity before validate and require phone or Job Number** — `pre("validate")` currently named `normalizePhoneNumber` sets `normalized_phone_number` from `phone_number` **and** `normalized_job_no` from `job_no`. Second hook `requireLeadIdentity` invalidates when both `phone_number` and `job_no` are blank — job-only Granot create stays legal. This beat does **not** fold `lid` or contact name (Form Lead does; this file does not). This beat does **not** generate a missing phone.

3. **Keep one physical RingCentral call as one Call Lead, and keep original-caller evidence immutable** — unique sparse `{ "ringcentral.telephony_session_id": 1 }` is webhook-vs-cron idempotency for the same session, not a business Duplicate Lead, and not an S08 key. Nested `ringcentral.original_caller` is `immutable: true` on the document path. Query updates (`updateOne` / `updateMany` / `findOneAndUpdate` / `replaceOne` / `findOneAndReplace`) currently named `rejectRingCentralCallerReplacement` throw `"RingCentral metadata with original caller evidence is immutable."` unless the filter explicitly says `"ringcentral.original_caller": { $exists: false }` — leftover adoption’s first attach. This beat does **not** adopt. This beat does **not** write the leftover processed-call ledger.

4. **Bind the selected Mongo database and declare the named lookup indexes the migration applies** — default export `CallLead` is `mongoose.models.CallLead ?? mongoose.model(...)`. `getCallLeadModel()` returns that same model when `mongoose.connection.name === getMongoDatabaseName()`; otherwise `useDb(dbName, { useCache: true })` and register there. Named catalog `CALL_LEAD_S08_INDEXES` is three non-unique indexes (`call_lead_source_granularity_normalized_job_no`, `call_lead_source_granularity_normalized_phone_created`, `call_lead_origin_source_ingested_phone_created`) plus `accepted_names` for leftover deployed aliases. Unnamed browse indexes (source + `createdAt`, phone, `normalized_phone_number`, raw `job_no`, raw `normalized_job_no`, source-granularity timestamp, source-company + phone + `duplicate` + `timestamp`) stay on the schema beside the unique session index. `autoIndex` stays false. This beat does **not** call `syncIndexes`. This beat does **not** declare a unique Lead Job index. This beat does **not** put the unique session index into the S08 catalog.

`CallLeadDocument` is the inferred row type. There is no unknown-state sentinel here — leftover Form Lead’s `FORM_LEAD_UNKNOWN_STATE` stays on that file.

There is no ingest operation. Already-recommended `callLead.service.ts` elects that. There is no historical-relax operation. Leftover `historical/CallLead.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the Call Lead row on the selected Mongo database, fold phone and Job Number before validate, require phone or Job, keep one lead per RingCentral session and the original caller immutable, and declare named lookup indexes the migration applies — never ingest or qualify here, never auto-create indexes on boot, never invent a unique Lead Job index.” Already-recommended ingest / promotion / duplicate-guard / adoption / identity already live in deeper **modules**. Leftover provenance field catalog and leftover historical relax already live in sibling **modules**. Do not pull those in. Do not invent a `CallLeadModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent an `autoIndex: true` **adapter** so “boot creates S08 and the unique session.” Do not invent a unique `{ normalized_job_no: 1 }` **adapter** so “one Lead per Job.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `normalize.ts` / `ringcentral.ts` each get a file.

Do not move leftover `callLeadProvenanceSchemaFields` into this file so “the Call Lead owns provenance.” Do not move leftover `getCallLeadModel` into `db.ts` so “one helper owns every selected-database model” without a paired proof that Granot identity still writes `call_leads` on the selected name and already-recommended ingest still reads the same rows. Do not merge this file into already-recommended `FormLead.ts` so “one Lead model owns Form and Call.” Do not merge this file into leftover `historical/CallLead.ts` so “one schema owns the live row and the historical relax.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `CallLead` | `callLeadOnTheDefaultConnection` | already-recommended ingest / search / enrichment / employee-booking / leftover duplicate-guard still import the default model |
| `getCallLeadModel` | `callLeadOnTheSelectedMongoDatabase` | Granot identity / create / sync, EntityChange, cancellations, reporting, leftover adoption must follow `getMongoDatabaseName()` |
| `CallLeadDocument` | `CallLeadRow` | inferred document + `_id` + `sheet_sync[]` |
| `CALL_LEAD_S08_INDEXES` | `namedCallLeadLookupIndexesTheMigrationApplies` | leftover `pnpm migration:granot-lifecycle:indexes` is the only S08 apply path; unique array stays empty |

Keep the old names as one-line aliases until `callLead.service.ts`, Granot identity, leftover adoption, search, and the S08 migration migrate. Do not make callers learn `normalized_job_no` / `accepted_names` / `useDb` as the domain language. Do **not** delete the default `CallLead` export so “everyone must call the getter” without a paired proof that already-recommended `callLead.service.ts` and leftover `callLeadSearch.service.ts` still find the same rows they find today. Do **not** delete `getCallLeadModel` so “Mongoose default is enough” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database.

**No class for the workflow.** The one type that *does* earn a name is the selected-database handoff:

```ts
type CallLeadOnTheSelectedMongoDatabase = Model<CallLeadRow>
```

That is the handoff from “this process chose `getMongoDatabaseName()`” to “Granot identity and leftover adoption read and write the same `call_leads` collection.” Do **not** add a historical connection onto that type. Do **not** collapse job-only identity into “phone is always required” so “Call Lead matches Form Lead.”

Leave leftover `callLeadProvenanceSchemaFields` on leftover `granotLifecycleSchemas.ts`. Leave leftover `registerHistoricalCallLead` on leftover `historical/CallLead.ts`. Leave already-recommended `FormLead` on already-recommended `FormLead.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// CallLead.ts
// A sparse call just became a Call Lead — Admin typed it,
// RingCentral promoted a qualified session,
// Granot minted a job-only row,
// or Best Relocation imported it.
// Hold the row on call_leads.
// Before validate, fold phone and Job Number,
// and refuse a row that has neither.
// Keep at most one Call Lead per RingCentral telephony session,
// and once original-caller evidence is stored,
// do not let a query update replace it
// unless leftover adoption is attaching it for the first time.
// Keep the three named S08 lookup indexes on the schema
// so the reviewed migration can apply them,
// and never make Job Number unique.
// If this process selected a different Mongo database,
// hand back that database's Call Lead model.
// Do not qualify the two-minute rule.
// Do not classify a business Duplicate Lead.
// Do not post to Granot.
// Do not enqueue Sheet Sync.

export const namedCallLeadLookupIndexesTheMigrationApplies = [ /* three non-unique */ ] as const

export const callLeadOnTheDefaultConnection =
  mongoose.models.CallLead ?? mongoose.model("CallLead", callLeadSchema)

export function callLeadOnTheSelectedMongoDatabase() {
  if (thisConnectionAlreadyIsTheSelectedDatabase()) {
    return callLeadOnTheDefaultConnection
  }
  return callLeadRegisteredOnTheSelectedDatabase()
}

export { callLeadOnTheDefaultConnection as CallLead }
export { callLeadOnTheSelectedMongoDatabase as getCallLeadModel }
export { namedCallLeadLookupIndexesTheMigrationApplies as CALL_LEAD_S08_INDEXES }

// ── 1. Hold the Call Lead as the System of Record row ─────

const callLeadSchema = rememberTheCallLeadRow() // collection call_leads; autoIndex false

function rememberTheCallLeadRow() {
  const schema = new Schema(
    {
      /* source, optional contact, optional move, CPL, form_fill, duplicate, receiver agent, sheet_sync */
      ringcentral: rememberRingCentralTransport(), // original_caller immutable on the path
      ...askSiblingForCallLeadProvenanceFields(),  // quoted default false; job_no; snapshots
      ...askSiblingForAggregateRevisionFields(),
    },
    { collection: "call_leads", autoIndex: false, optimisticConcurrency: true, timestamps: true },
  )
  refuseGranotCreatedCallLeadFromPostingToGranot(schema)
  declareBrowseAndDuplicateWindowIndexes(schema)
  declareOneCallLeadPerRingCentralTelephonySession(schema) // unique sparse; not S08
  declareNamedS08LookupIndexes(schema)
  askSiblingToRefuseLegacyUnknownOnANewRowAndKeepOriginWriteOnce(schema)
  askSiblingToKeepRevisionMetadataPairedAndHistoryStartWriteOnce(schema)
  foldCallLeadIdentityBeforeValidate(schema)
  requirePhoneOrJobNumber(schema)
  refuseQueryUpdatesThatReplaceAnAttachedOriginalCaller(schema)
  return schema
}

// ── 2. Fold identity before validate and require phone or Job

function foldCallLeadIdentityBeforeValidate(schema) {
  schema.pre("validate", function foldPhoneAndJobNumber() {
    this.normalized_phone_number = foldThePhone(this.phone_number)
    this.normalized_job_no = foldTheJobNumber(this.job_no)
  })
}

function requirePhoneOrJobNumber(schema) {
  schema.pre("validate", function requireLeadIdentity() {
    if (!this.phone_number?.trim() && !this.job_no?.trim()) {
      this.invalidate("phone_number", "Call lead requires either phone_number or job_no")
    }
  })
}

// ── 3. One physical RingCentral call; original caller stays ─

function declareOneCallLeadPerRingCentralTelephonySession(schema) {
  schema.index(
    { "ringcentral.telephony_session_id": 1 },
    { unique: true, sparse: true },
  )
}

function refuseQueryUpdatesThatReplaceAnAttachedOriginalCaller(schema) {
  schema.pre(
    ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"],
    function rejectRingCentralCallerReplacement() {
      if (thisUpdateReplacesRingCentralMetadata() && !filterSaysOriginalCallerIsStillAbsent()) {
        throw new Error("RingCentral metadata with original caller evidence is immutable.")
      }
    },
  )
}

// ── 4. Bind the selected database and declare named indexes

function thisConnectionAlreadyIsTheSelectedDatabase() {
  return mongoose.connection.name === selectedMongoDatabaseName()
}

function callLeadRegisteredOnTheSelectedDatabase() {
  const db = mongoose.connection.useDb(selectedMongoDatabaseName(), { useCache: true })
  return db.models.CallLead ?? db.model("CallLead", callLeadSchema)
}
```

Read the primary path out loud: *hold the Call Lead on `call_leads` without auto-indexing. Ask the sibling catalog for provenance and revision paths, then ask those sibling guards so a new row cannot pretend it is legacy and so origin / ingested snapshots stay write-once. Refuse Granot-created `post_to_granot: true`. Before validate, fold phone and Job Number, and refuse a row that has neither. Keep one Call Lead per RingCentral telephony session. Keep original-caller evidence on the path, and refuse a query update that replaces `ringcentral` unless leftover adoption is attaching the caller for the first time. Keep three named non-unique S08 lookup indexes plus the browse, duplicate-window, and unique-session indexes. If this process already sits on the selected database, hand back the default model; otherwise register the same schema on `useDb`. Do not ingest. Do not qualify. Do not make Job Number unique.*

That is the operation. `normalizePhoneNumber` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`normalizePhoneNumber` lies.** The hook folds phone **and** Job Number. Rename the beat `foldCallLeadIdentityBeforeValidate`. Do not move Job Number fold into leftover `historical/CallLead.ts` (that file folds phone only). Do not copy Form Lead’s lid / name fold onto this hook so “one identity fold owns every Lead.”

2. **Two model adapters — and ingest sits on the default.** Already-recommended `callLead.service.ts` **asks** default `CallLead`. Duplicate, Granot identity / create / sync, leftover adoption, cancellations, reporting, and EntityChange **ask** `getCallLeadModel`. Search, enrichment, leftover duplicate-guard, and employee-booking candidates **ask** default `CallLead`. One story, two **adapters**, and the write path is not the same adapter Form Lead ingest uses. Keep both exports. Do not silently migrate ingest onto the getter in this rename without a paired proof that Admin / RingCentral create still writes the selected database’s `call_leads` — and do not delete the getter so “Mongoose default is enough” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database.

3. **Named S08 catalog vs unnamed browse / duplicate-window vs unique session.** `CALL_LEAD_S08_INDEXES` is what leftover `pnpm migration:granot-lifecycle:indexes` applies (three keys; unique array empty). The unique sparse telephony-session index is declared on the schema and is **not** in that catalog. The source-company + phone + `duplicate` + `timestamp` index is also unnamed. Do not merge the lists so “one array owns every index” without a paired report that `autoIndex` stays false, S08 stays non-unique, and the unique session stays unique sparse. Do not move the unique session into leftover `ringcentral_processed_calls` so “one ledger owns physical-call idempotency.”

4. **Unique session is not a business Duplicate Lead, and not a unique Lead Job.** Knowledge already says webhook vs cron for the same `telephony_session_id` is separate from the 90-day Source Granularity + phone window. Do not drop `{ unique: true, sparse: true }` so “S08 has no unique, so this should not either.” Do not add `unique` to `{ normalized_job_no: 1 }` so “Call matches Booking.” Leftover next `BookedLead.ts` owns the one-Booking-per-Job contract.

5. **Query-update fence and path `immutable` are two layers of one beat.** Leftover adoption **asks** `"ringcentral.original_caller": { $exists: false }` on `findOneAndUpdate`. Dropping the query hook so “schema `immutable` is enough” would let that update replace an attached caller. Do not drop the `$exists: false` escape so “every ringcentral `$set` throws” — leftover adoption would then fail. Do not treat leftover `adoptRingCentralCall` as this story.

6. **`__v` is not `domain_revision`.** Optimistic concurrency is Mongoose. Lifecycle revision is leftover sibling fields. Do not rename `__v` to `domain_revision` or drop `optimisticConcurrency` so “one version owns the row.”

7. **Do not silently enable `autoIndex`.** The schema is the declaration. The S08 migration is the S08 apply. Boot must not create S08 or the unique session index.

8. **Leave sibling modules alone.** Provenance field catalog, ingest, promotion, leftover adoption, leftover duplicate-guard, historical relax, and the Form Lead row are already the right **depth**. This file orchestrates the Call Lead row.

## Testing

The **interface** is the test surface: `CallLead` validate, `getCallLeadModel`, `CALL_LEAD_S08_INDEXES`.

Today’s `CallLead.test.ts` already names the row, not ingest: `quoted` / `post_to_granot` default false, Granot-created `post_to_granot: true` rejects, origin / snapshot paths, immutable origin after insert, new rows refuse `legacy_unknown`, receiver-agent enum keeps `granot_username_match` and `extension_crm_username_match`, three S08 indexes and no unique Lead Job index, original-caller required + path `immutable`. `v1.validation.test.ts` already proves job-only validate and identity-less reject. Keep those as the operation proofs.

Add (or keep, if a later implementer finds them missing) only interface proofs:

**Hold the row**
- A new Call Lead may omit name / email / zips / `job_no` when `phone_number` is present and still validate.
- A job-only row (no phone) still validates.
- `quoted` stays `false` when omitted.
- Granot-created `post_to_granot: true` rejects; `legacy_import` + `post_to_granot: true` still validates.
- After insert, `ingestion_origin` and ingested snapshots reject mutation.

**Fold identity + require phone or Job**
- Validate folds `phone_number` → `normalized_phone_number` and `job_no` → `normalized_job_no`.
- A row with neither phone nor Job Number rejects.
- Folding Job Number does not invent a phone.

**RingCentral session + original caller**
- Schema declares unique sparse `{ "ringcentral.telephony_session_id": 1 }`.
- `ringcentral.original_caller` path is `immutable`.
- A query update that `$set`s `ringcentral` without `"ringcentral.original_caller": { $exists: false }` on the filter throws.
- The same update with that `$exists: false` filter does not throw from this hook (leftover adoption’s first attach).

**Selected database + named indexes**
- `CALL_LEAD_S08_INDEXES` is exactly the three named non-unique keys; none is `unique`.
- `getCallLeadModel()` returns `CallLead` when `connection.name` already is `getMongoDatabaseName()`.
- `schema.options.autoIndex === false`.

Do **not** add a test per helper (`foldThePhone`, `thisConnectionAlreadyIsTheSelectedDatabase`). Those names exist so the parent reads. Do **not** HTTP ingest from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates S08.” Do **not** promote a qualified call from this file’s tests.

`getCallLeadModel` stays exported because selected-database binding is a second real **adapter**, not a test leak.

## What I would not do

- A `CallLeadModelService` / `CallLeadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `ringcentral.ts` split for cleanliness.
- Breaking the selected-database **seam**. Granot identity must not write live `call_leads` while `TEST_MODE` selected `testvantagemovers`.
- Treating already-recommended `ingestCallLead` / `beginRingCentralCallLeadIngestion` as this story. Those services own Form Fill, CPL, and Sheet Sync.
- Treating already-recommended `ingestRingCentralQualifiedCall` as this story. That file owns skip / adopt / classify / write-mode.
- Treating leftover `historical/CallLead.ts` as this story. That row relaxes required fields and has no RingCentral, no S08, no selected-database getter.
- Treating already-recommended `FormLead.ts` as this story.
- Treating leftover next `BookedLead.ts` as this story. One official Booking per Job is not one Call Lead per Job.
- Inventing a unique Lead Job **seam** that the live cluster must not have.
- Inventing an `autoIndex: true` **adapter** that has only “convenience” as its second home.
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Silently migrating already-recommended ingest onto `getCallLeadModel` so “Call matches Form” without a paired proof.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
