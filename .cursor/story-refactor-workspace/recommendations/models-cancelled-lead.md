# Remember The Cancellation Row, Freeze The Four Booking-Correlation Snapshots After Insert, And Keep A Named Non-Unique Job Snapshot Browse Index — Never Cancel Or Mirror Here, Never Make That Snapshot Unique Like Booking, Never Auto-Create Indexes On Boot, Never Invent A Selected-Database Getter — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 4 of this service — `CancelledLead.ts`
- Remaining in this service: `Customer.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/CancelledLead.ts`
- Knowledge: [`docs/knowledge/services/cancelled-lead.md`](../../../docs/knowledge/services/cancelled-lead.md) (System of Record is Mongo `cancelled_leads`. Cancellations attach to an existing Booking and snapshot booking / customer / source at create so reporting stays stable if the Booking is later mutated or deleted. Official create stamps the four correlation snapshots from the surviving Booking via leftover `snapshotsForCancelledLeadCreate`. Those four paths are **immutable after insert**. Named partial index `CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX` = `cancelled_lead_normalized_job_no_snapshot` on `normalized_job_no_snapshot` is **not unique**. Schema `autoIndex` is false. Knowledge resource list names the cancel service, not this file — do not add a Models Service file in this rename so “the Service sentence wins”). Related Lead stamp: [`docs/knowledge/services/cancellation-mirror.md`](../../../docs/knowledge/services/cancellation-mirror.md) (**this file never mirrors `lead.cancelled`**). Related Job Number hop: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (JTE-06: Mongo hops by indexed `normalized_job_no_snapshot` via leftover `equivalentNormalizedJobSnapshotFilter`; a snapshot-only Cancellation is a found cancelled page — **this file only declares the browse index**). Related Owner Confirm Cancellation: leftover `granotLifecycle/officialCancellationWrite.ts` / leftover `releaseOwnerCommands.ts` (gated official write — **this file never confirms**). Distinct from already-recommended cancel-this-Booking: [cancellations-cancelled-lead.md](cancellations-cancelled-lead.md) (`cancelThisBooking` / `beginCancellingThisBooking` / `writeTheCancellationAndMirrorTheChain` / `cancelAVerifiedBooking` — **this file never stamps `booking.cancelled`, never mirrors the Lead, never enqueues Cancellation Chain Sheet Sync**). Distinct from already-recommended resolver / mirror: [cancellations-cancellation-resolver.md](cancellations-cancellation-resolver.md), [cancellations-cancellation-mirror.md](cancellations-cancellation-mirror.md). Distinct from leftover stamp helper: `cancellations/cancellationCorrelationSnapshots.ts` (`cancellationCorrelationSnapshotsFromBooking` / `snapshotsForCancelledLeadCreate` — **this file freezes what that helper stamped; it does not fold or invent Job Number**). Distinct from leftover sibling field catalog: `granotLifecycleSchemas.ts` (`aggregateRevisionSchemaFields`, `applyAggregateRevisionGuards` — **this file asks them; it does not own the guard bodies**. No `ingestion_origin` on a Cancellation). Distinct from leftover sibling field helpers: `schemaHelpers.ts` (`leadModelField` defaults required, `sheetSyncSchema` — **this file spreads `leadModelField` with `required: false` so leadless / unresolved employee rows may omit Lead refs**; leave `schemaHelpers.ts` for a later models pass). Distinct from leftover historical relax: `historical/CancelledLead.ts` (`registerHistoricalCancelledLead` on `vantagemovershistorical`; `booked_lead` not required; live `normalized_job_no` instead of the four snapshots; no revision; no named snapshot catalog; no `getCancelledLeadModel`). Distinct from already-recommended Booking row: [models-booked-lead.md](models-booked-lead.md) (unique partial `{ normalized_job_no: 1 }` is **one official Booking per folded Job** — **do not copy that unique onto this snapshot index**). Distinct from already-recommended Form / Call rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md) (those files have selected-database getters — **do not invent `getCancelledLeadModel` so “Cancellation matches Form”**). Distinct from leftover next Customer row: `Customer.ts`. Distinct from leftover migration: `scripts/migrations/cancellation-correlation-snapshots.ts` (**asks** `CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX`; report-first; default live target `testvantagemovers`; Owner-db apply / index / `vantagemovers` backfill stay unauthorized; **this file never creates indexes at runtime**). Distinct from leftover `pnpm migration:granot-lifecycle:indexes` — that script does **not** apply this snapshot catalog. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Cancellation](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation Chain](../../../../CONTEXT.md), [Referral Booking](../../../../CONTEXT.md), [Job Number](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows.
- Callers: **default-connection model only — there is no `getCancelledLeadModel`.** Already-recommended `cancellations/cancelledLead.service.ts` **asks** default `CancelledLead` for insert / find / patch / list / remove. Leftover `granotLifecycle/officialCancellationWrite.ts` **asks** default `CancelledLead.find({ booked_lead })` before the verified CAS write (one existing row must already be `booking.cancelled`, else `IDENTITY_CONFLICT`). Already-recommended `domainCommands/entityChange.ts` **asks** default `CancelledLead` when the aggregate is a Cancellation (Form / Call on that file still **ask** getters; Booking **asks** default `BookedLead`). Leftover `jobNumberTimeline/mongo-evidence-loader.ts` **asks** the snapshot fields for the indexed hop. Leftover `scripts/migrations/cancellation-correlation-snapshots.ts` **asks** `CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX`. `CancelledLead.test.ts` **asks** `CancelledLead` + the named catalog (schema validate + immutability + `autoIndex`; **does not** open Mongo). `granotAggregateRevisions.test.ts` **asks** `CancelledLead` (`optimisticConcurrency` is **false** here) and leftover `HistoricalCancelledLeadSchema` (no revision fields). Not this **interface**: `cancelThisBooking` itself, `cancelAVerifiedBooking` itself, `snapshotsForCancelledLeadCreate` itself, `normalizeJobNo` itself, sibling revision guard bodies.
- Seams callers need: default `CancelledLead` (first-registered connection — **including already-recommended cancel-this-Booking, leftover official Cancellation write, and leftover EntityChange**) vs the Form / Call selected-database getters (those files have a second **adapter**; this file does not); `autoIndex: false` vs leftover `pnpm migration:cancellation-correlation-snapshots` apply of the named **non-unique** Job snapshot catalog; named `CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX` vs unnamed browse indexes on `booked_lead` / `customer` / `lead_ref`; display `job_no` vs frozen `job_no_snapshot` / `normalized_job_no_snapshot`; live `lead_ref` + `lead_model` vs frozen `lead_ref_snapshot`; service-level one-Cancellation-per-Booking (`booking.cancelled` plus leftover official `find({ booked_lead })`) vs this file’s non-unique `{ booked_lead: 1 }`; pre-validate snapshot freeze vs leftover stamp-at-create helper; no `__v` optimistic concurrency vs leftover `domain_revision` (sibling fields — **not** the same contract; Form / Call / Booking turn `optimisticConcurrency` on — this file does not). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Lead-mirror **seam**.
- Split later (only if the file outgrows one sitting): this ~92-line file is one sitting if you read it as remember the Cancellation row, freeze the four Booking-correlation snapshots after insert, and keep a named non-unique Job snapshot browse index — never cancel or mirror here, never make that snapshot unique like Booking, never auto-create indexes on boot, never invent a selected-database getter. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `snapshots.ts`. Cancel-this-Booking stays already-recommended `cancelledLead.service.ts`. Stamp helper stays leftover `cancellationCorrelationSnapshots.ts`. Historical relax stays leftover `historical/CancelledLead.ts`. Already-recommended Booking row stays `BookedLead.ts`. Next Customer row stays leftover `Customer.ts`.

`CancelledLead` is a Mongoose model name. The owner question is: *A Booking just became a Cancellation — or the owner wrote a gated Granot official Cancellation. Hold the row on `cancelled_leads`. After insert, refuse any edit to the four Booking-correlation snapshots so Job Number timeline and reporting can still find this Cancellation after the Booking is mutated or deleted. Keep the named Job snapshot browse index on the schema so the reviewed correlation-snapshot migration can apply it, and never make that snapshot unique the way one official Booking per Job is unique. If this process selected a different Mongo database, today’s callers still use the default connection — do not invent a getter in this rename. Do not cancel the Booking. Do not mirror `lead.cancelled`. Do not enqueue Sheet Sync. Do not copy Booking’s unique Job onto this snapshot.*

Who cancel / correct / remove already lives in already-recommended `cancelledLead.service.ts`. Who stamp the four snapshots from the surviving Booking already lives in leftover `cancellationCorrelationSnapshots.ts`. Who refuse unpaired revision metadata already lives in leftover `granotLifecycleSchemas.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Cancellation row, freeze the four Booking-correlation snapshots after insert, and keep a named non-unique Job snapshot browse index” story, not “a Cancelled Lead model CRUD dump,” and not Cancel This Booking / Cancel A Verified Booking themselves:

1. **Hold the Cancellation as the System of Record row** — collection `cancelled_leads`, `autoIndex: false`, timestamps, `toJSON` / `toObject` virtuals. **No** `optimisticConcurrency`. Declares required `booked_lead`, required `cancel_date`, required `refund_amount`, optional Customer, optional polymorphic `lead_ref` + `lead_model` (`refPath`, Lead not required), display copies (`reason`, `notes`, `cancelled_by`, `agent`, `book_date`, `job_no`, `customer_name`, `merchant`, `source`), `timestamp` defaulting to now, `sheet_sync[]`, and the four correlation snapshot paths (`job_no_snapshot`, `normalized_job_no_snapshot`, nested `lead_ref_snapshot` `{ model: FormLead | CallLead, id }`, `booking_created_at_snapshot`) defaulting null. Then **asks** leftover `aggregateRevisionSchemaFields` (no Ingestion Origin — a Cancellation is not a Lead). Then **asks** leftover `applyAggregateRevisionGuards` so `last_change_id` / `last_changed_at` stay paired and `change_history_started_at` is write-once after insert. This beat does **not** resolve the Booking. This beat does **not** stamp `booking.cancelled`. This beat does **not** upsert the Customer.

2. **Freeze the four Booking-correlation snapshots after insert** — named `pre("validate")` `rejectImmutableCorrelationSnapshots` returns on `isNew`. After insert, any modified `job_no_snapshot` / `normalized_job_no_snapshot` / `lead_ref_snapshot` / `booking_created_at_snapshot` invalidates that path (`<path> is immutable after insert`). Display `job_no` / live `lead_ref` are **not** on that list. This beat does **not** stamp the snapshots (leftover `snapshotsForCancelledLeadCreate` elects that from the surviving Booking; leftover historical-consolidation planner stamps from the planned Booking document, not the Sheet Job Number cell). This beat does **not** fold `job_no` into `normalized_job_no_snapshot`. This beat does **not** require a Lead (unresolved employee / authorized leadless may omit both live refs and the snapshot).

3. **Keep a named non-unique Job snapshot browse index** — named catalog `CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX` is **not unique**, partial `{ normalized_job_no_snapshot: 1 }` where that path is a string (`cancelled_lead_normalized_job_no_snapshot`). Unnamed browse indexes (`booked_lead`, `customer`, `lead_ref`) stay on the schema and are **not** unique. Leftover `pnpm migration:cancellation-correlation-snapshots` applies this catalog after a reviewed report. Leftover `pnpm migration:granot-lifecycle:indexes` does **not** include it. `autoIndex` stays false. This beat does **not** call `syncIndexes`. This beat does **not** declare a unique Job on Form, Call, or this snapshot. This beat does **not** make one Cancellation per Booking a unique `{ booked_lead: 1 }` index.

`CancelledLeadDocument` is the inferred row type. There is no selected-database getter. There is no unknown-state sentinel here.

There is no cancel-this-Booking operation. Already-recommended `cancelledLead.service.ts` elects that. There is no historical-relax operation. Leftover `historical/CancelledLead.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the Cancellation row, freeze the four Booking-correlation snapshots after insert, and keep a named non-unique Job snapshot browse index — never cancel or mirror here, never make that snapshot unique like Booking, never auto-create indexes on boot, never invent a selected-database getter.” Already-recommended cancel / correct / remove / resolver / mirror already live in deeper **modules**. Leftover stamp helper, leftover official write, leftover revision field catalog, and leftover historical relax already live in sibling **modules**. Do not pull those in. Do not invent a `CancelledLeadModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `getCancelledLeadModel` **adapter** so “Cancellation matches Form” without a paired proof that already-recommended cancel-this-Booking, leftover official write, and leftover EntityChange still read the same `cancelled_leads`. Do not invent an `autoIndex: true` **adapter** so “boot creates the snapshot index.” Do not invent a unique `{ booked_lead: 1 }` **adapter** so “one Cancellation per Booking lives on the schema.” Do not invent a unique snapshot Job **adapter** so “Cancellation matches Booking.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `snapshots.ts` each get a file.

Do not move leftover `aggregateRevisionSchemaFields` into this file so “the Cancellation owns revision.” Do not move leftover `snapshotsForCancelledLeadCreate` into this file so “the row owns the stamp.” Do not merge this file into already-recommended `BookedLead.ts` so “one model owns Booking and Cancellation.” Do not merge this file into leftover `historical/CancelledLead.ts` so “one schema owns the live row and the historical relax.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `CancelledLead` | `cancellationOnTheDefaultConnection` | already-recommended cancel-this-Booking, leftover official write, leftover EntityChange still import the default model |
| `CancelledLeadDocument` | `CancellationRow` | inferred document + `_id` + `sheet_sync[]` |
| `CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX` | `namedCancellationJobSnapshotBrowseIndexTheMigrationApplies` | leftover `pnpm migration:cancellation-correlation-snapshots` is the only snapshot-index apply path; Job Number timeline hops this key |

Keep the old names as one-line aliases until `cancelledLead.service.ts`, leftover official write, leftover EntityChange, leftover Job Number timeline, and the correlation-snapshot migration migrate. Do not make callers learn `partialFilterExpression` / `accepted_names` as the domain language. Do **not** add `getCancelledLeadModel` so “every aggregate has a getter” — that would invent a **seam** with no second **adapter**. Do **not** delete the default `CancelledLead` export so “everyone must call a getter that does not exist.”

**No class for the workflow.** The one type that *does* earn a name is the pending snapshot catalog:

```ts
type CancellationJobSnapshotBrowseIndex = {
  name: "cancelled_lead_normalized_job_no_snapshot"
  key: { normalized_job_no_snapshot: 1 }
  unique: false
  partialFilterExpression: { normalized_job_no_snapshot: { $type: "string" } }
}
```

That is the handoff from “this process froze a Job snapshot” to “the reviewed migration can apply a browse hop so Job Number timeline can find the Cancellation after the Booking is gone.” Do **not** add `{ unique: true }` onto that type so “Cancellation matches Booking.” Do **not** collapse Booking’s unique Job onto that type so “one catalog owns every Job index.”

Leave leftover `aggregateRevisionSchemaFields` on leftover `granotLifecycleSchemas.ts`. Leave leftover `registerHistoricalCancelledLead` on leftover `historical/CancelledLead.ts`. Leave already-recommended `BookedLead` on that file. Leave leftover `snapshotsForCancelledLeadCreate` on leftover `cancellationCorrelationSnapshots.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// CancelledLead.ts
// A Booking just became a Cancellation —
// or the owner wrote a gated Granot official Cancellation.
// Hold the row on cancelled_leads.
// After insert, refuse any edit to the four
// Booking-correlation snapshots.
// Keep the named Job snapshot browse index
// so the reviewed migration can apply it,
// and never make that snapshot unique
// the way one official Booking per Job is unique.
// Today's callers still use the default connection —
// do not invent a selected-database getter in this rename.
// Do not cancel the Booking.
// Do not mirror lead.cancelled.
// Do not enqueue Sheet Sync.
// Do not copy Booking's unique Job onto this snapshot.

export const namedCancellationJobSnapshotBrowseIndexTheMigrationApplies = {
  name: "cancelled_lead_normalized_job_no_snapshot",
  key: { normalized_job_no_snapshot: 1 },
  unique: false as const,
  partialFilterExpression: {
    normalized_job_no_snapshot: { $type: "string" },
  },
} as const

export const cancellationOnTheDefaultConnection =
  mongoose.models.CancelledLead ?? mongoose.model("CancelledLead", cancelledLeadSchema)

export { cancellationOnTheDefaultConnection as CancelledLead }
export { namedCancellationJobSnapshotBrowseIndexTheMigrationApplies as CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX }

// ── 1. Hold the Cancellation as the System of Record row ─

const cancelledLeadSchema = rememberTheCancellationRow() // collection cancelled_leads; autoIndex false; no optimisticConcurrency

function rememberTheCancellationRow() {
  const schema = new Schema(
    {
      timestamp: { type: Date, required: true, default: Date.now },
      booked_lead: requiredBookingPointer(),          // index, not unique
      customer: optionalCustomerPointer(),
      lead_ref: optionalPolymorphicLeadPointer(),     // required: false
      lead_model: askSiblingForOptionalLeadModel(),
      /* reason, notes, cancelled_by, cancel_date, agent, book_date, display job_no */
      job_no_snapshot: nullableTrimmedString(),
      normalized_job_no_snapshot: nullableTrimmedString(),
      lead_ref_snapshot: nestedLeadPointerOrNull(),   // { model, id }, not live lead_ref
      booking_created_at_snapshot: nullableDate(),
      /* customer_name, refund_amount, merchant, source, sheet_sync */
      ...askSiblingForAggregateRevisionFields(),      // no ingestion_origin
    },
    { collection: "cancelled_leads", autoIndex: false, timestamps: true },
  )
  declareBrowseLookupIndexes(schema)                  // booked_lead, customer, lead_ref — not unique
  declareNamedCancellationJobSnapshotBrowseIndex(schema)
  askSiblingToKeepRevisionMetadataPairedAndHistoryStartWriteOnce(schema)
  freezeBookingCorrelationSnapshotsAfterInsert(schema)
  return schema
}

// ── 2. Freeze the four snapshots after insert ─────────────

function freezeBookingCorrelationSnapshotsAfterInsert(schema) {
  schema.pre("validate", function rejectImmutableCorrelationSnapshots() {
    if (this.isNew) return
    for (const path of fourBookingCorrelationSnapshotPaths()) {
      if (this.isModified(path)) {
        this.invalidate(path, `${path} is immutable after insert`)
      }
    }
  })
}

// ── 3. Named non-unique Job snapshot browse index ─────────

function declareNamedCancellationJobSnapshotBrowseIndex(schema) {
  schema.index(
    namedCancellationJobSnapshotBrowseIndexTheMigrationApplies.key,
    {
      unique: false,
      name: namedCancellationJobSnapshotBrowseIndexTheMigrationApplies.name,
      partialFilterExpression:
        namedCancellationJobSnapshotBrowseIndexTheMigrationApplies.partialFilterExpression,
    },
  )
}
```

Read the primary path out loud: *hold the Cancellation on `cancelled_leads` without auto-indexing and without optimistic concurrency. Ask the sibling catalog for revision paths, then ask those sibling guards so change-id and changed-at stay paired and history-start stays write-once. Require a Booking pointer. Allow a missing Lead. After insert, refuse any edit to the four Booking-correlation snapshots. Keep the named Job snapshot browse index non-unique so Job Number timeline can hop after the Booking is gone. Keep the `booked_lead` browse index non-unique; one Cancellation per Booking stays a service find. If this process already sits on the first-registered connection, that is the model leftover cancel-this-Booking and leftover official write already import. Do not cancel. Do not mirror. Do not make the snapshot unique like Booking.*

That is the operation. An unnamed schema dump is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The validate hook already has a name, and it does one job.** `rejectImmutableCorrelationSnapshots` only freezes the four paths after insert. Rename the beat `freezeBookingCorrelationSnapshotsAfterInsert` so the owner sentence is the function. Do not fold `job_no` here so “Cancellation matches Booking.” Do not add live `job_no` / `lead_ref` onto the freeze list so “display copies stay frozen too” without a paired proof that leftover public correction still patches only timestamp / cancel_date / refund / reason / notes / cancelled_by. Do not copy Form Lead’s lid / name / phone fold onto this hook.

2. **There is no selected-database getter — and that is today’s contract, not a missing Form-Lead copy.** Already-recommended cancel-this-Booking, leftover official write, leftover EntityChange, leftover Job Number timeline, leftover reporting, leftover admin scope **ask** default `CancelledLead`. On leftover `entityChange.ts`, Form / Call **ask** getters and Cancellation **asks** the default — same as Booking. Do not silently add `getCancelledLeadModel` in this rename so “every aggregate matches Form” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database **and** that already-recommended cancel-this-Booking still finds the same rows. Do not move leftover EntityChange’s Cancellation find onto a new getter in the same pass as this rename.

3. **The Job snapshot index is browse, and it is partial.** Several leftover remainder / historical rows may share a snapshot string; Job Number timeline hops survivors after the Booking is gone. Do not flip `{ unique: true }` so “Cancellation matches Booking’s one-official-per-Job unique.” Do not drop the `$type: "string"` partial so “every missing snapshot collides.” Do not add `unique` to Form / Call `{ normalized_job_no: 1 }` from this file.

4. **One Cancellation per Booking is a service find, not this unique.** `{ booked_lead: 1 }` is browse. Already-recommended cancel-this-Booking elects 409 when `booking.cancelled` is already set. Leftover official write `find({ booked_lead })` and treats a mismatched existing row as `IDENTITY_CONFLICT`. Do not add `{ unique: true }` on `booked_lead` so “the schema owns one Cancellation per Booking” — leftover remainder / historical relax would then be a different story.

5. **Display `job_no` is not `job_no_snapshot`.** Official create copies both. Correction does not re-snapshot. The freeze list is the four correlation paths only. Do not delete display `job_no` so “one Job field owns the row.” Do not teach the hook to rewrite `normalized_job_no_snapshot` from display `job_no` on every validate.

6. **Stamp lives on the leftover helper; freeze lives here.** Leftover `snapshotsForCancelledLeadCreate` elects trimmed `job_no`, stored `normalized_job_no` else fold, nested Lead snapshot, and `createdAt`. This file only refuses later edits. Do not move the stamp into this hook so “the model owns create.” Do not delete the helper so “the schema default is enough” — null defaults do not copy the Booking.

7. **No `__v` optimistic concurrency — and that is today’s contract.** `granotAggregateRevisions.test.ts` already names Cancellation `hasOptimisticConcurrency: false`. Form / Call / Booking turn it on. Do not silently enable `optimisticConcurrency` so “every aggregate matches Booking.” `__v` is still not `domain_revision`. Do not rename a missing `__v` into leftover sibling revision fields.

8. **`leadModelField` is required in the sibling helper; this file spreads it `required: false`.** Leftover `cancellationResolver.test.ts` already names “CancelledLead validates an unresolved employee Booking without Lead metadata.” Do not flip the sibling helper to optional so “Cancellation owns the helper.” Do not flip this path back to required so “leadless / employee validate fails.”

9. **Do not silently enable `autoIndex`.** The schema is the declaration. The correlation-snapshot migration is the snapshot-index apply. Boot must not create the browse hop. Do not fold this catalog into leftover `pnpm migration:granot-lifecycle:indexes` so “one script owns every named index” without a paired report that Owner-db apply stays unauthorized and `autoIndex` stays false.

10. **Leave sibling modules alone.** Stamp helper, cancel-this-Booking, official write, Job Number hop, revision field catalog, historical relax, and the Booking / Form / Call rows are already the right **depth**. This file orchestrates the Cancellation row.

## Testing

The **interface** is the test surface: `CancelledLead` validate, `CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX`.

Today’s `CancelledLead.test.ts` already names the row, not cancel-this-Booking: the four snapshots persist, they are immutable after insert, the named catalog is not unique, `autoIndex` is false. `cancellationResolver.test.ts` already names “validates an unresolved employee Booking without Lead metadata.” `granotAggregateRevisions.test.ts` already names `domain_revision` defaults, Cancellation has no optimistic concurrency, leftover historical Cancellation schema stays without revision fields. Keep those as the operation proofs.

Add (or keep, if a later implementer finds them missing) only interface proofs:

**Hold the row**
- A new Cancellation requires `booked_lead`, `cancel_date`, and `refund_amount`.
- A row with neither `lead_ref` nor `lead_model` still validates.
- After insert, unpaired `last_change_id` / `last_changed_at` reject.
- `schema.options.optimisticConcurrency` is not true.

**Freeze the four snapshots after insert**
- A new row may set all four snapshot paths and still validate.
- After `isNew = false`, changing `normalized_job_no_snapshot` or `job_no_snapshot` rejects.
- Display `job_no` is not on the freeze list.

**Named non-unique Job snapshot browse index**
- `CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX` is **not unique**, partial `{ normalized_job_no_snapshot: 1 }`, name `cancelled_lead_normalized_job_no_snapshot`.
- `{ booked_lead: 1 }` is not unique.
- `schema.options.autoIndex === false`.
- Booking’s named Job catalog stays unique; Form / Call still have no unique `normalized_job_no`.

Do **not** add a test per helper (`requiredBookingPointer`, `fourBookingCorrelationSnapshotPaths`). Those names exist so the parent reads. Do **not** HTTP cancel-this-Booking from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the snapshot index.” Do **not** open a Granot Release case from this file’s tests.

`CANCELLED_LEAD_NORMALIZED_JOB_SNAPSHOT_INDEX` stays exported because leftover correlation-snapshot apply is a second real **adapter**, not a test leak.

## What I would not do

- A `CancelledLeadModelService` / `CancelledLeadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `snapshots.ts` split for cleanliness.
- Breaking the default-connection **seam** by inventing `getCancelledLeadModel` without a paired proof. Leftover EntityChange must not write live `cancelled_leads` while `TEST_MODE` selected `testvantagemovers` — and today’s write already uses the default, not a getter.
- Treating already-recommended `cancelThisBooking` / `beginCancellingThisBooking` / `cancelAVerifiedBooking` as this story. Those services own Booking stamp, Lead mirror, and Sheet Sync.
- Treating leftover `snapshotsForCancelledLeadCreate` as this story. That file owns the stamp from the surviving Booking.
- Treating leftover `officialCancellationWrite.ts` as this story. That file owns the verified CAS claim and `IDENTITY_CONFLICT`.
- Treating leftover `historical/CancelledLead.ts` as this story. That row uses live `normalized_job_no`, does not require `booked_lead`, and has no snapshot catalog.
- Treating already-recommended `BookedLead.ts` as this story. One official Booking per Job is not one Cancellation per Job snapshot.
- Treating leftover next `Customer.ts` as this story.
- Inventing a unique Job snapshot **seam** so “Cancellation matches Booking.”
- Inventing an `autoIndex: true` **adapter** that has only “convenience” as its second home.
- Inventing a selected-database **seam** that has only one **adapter**.
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Silently migrating leftover EntityChange onto a new getter so “Cancellation matches Form” without a paired proof.
- Silently enabling `optimisticConcurrency` so “Cancellation matches Booking.”
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
