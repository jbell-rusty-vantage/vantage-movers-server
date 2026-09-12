# Remember The Booking Row, Fold The Job Number Before Validate, Require A Lead Unless This Is Referral Or Leadless, Keep One Official Booking Per Normalized Job And One Employee Submission Per Employee Origin — Never Book Or Mirror Here, Never Auto-Create Indexes On Boot, Never Copy This Unique Onto Form Or Call — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 3 of this service — `BookedLead.ts`
- Remaining in this service: `CancelledLead.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/BookedLead.ts`
- Knowledge: [`docs/knowledge/services/bookings.md`](../../../docs/knowledge/services/bookings.md) (System of Record is Mongo `booked_leads`. Book-this-Lead / from-source / Referral / Leadless / Lead ↔ Booking mirror live on already-recommended `bookings/` services. Unique partial `{ normalized_job_no: 1 }` is the one-official-Booking-per-normalized-Job contract — `booked_lead_normalized_job_no_unique`; deployed name may still be `normalized_job_no_1`. Collisions block unique-index apply. Non-referral, non-leadless rows require `lead_ref` + `lead_model` via the pre-validate hook. Knowledge resource list names the booking services, not this file — do not add a Models Service file in this rename so “the Service sentence wins”). Related employee origin: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (`booking_origin=employee_booking`; duplicate `submission_id` is 200; another Booking with the same `normalized_job_no` is 409; **this file only stores the flags and declares the partial unique**). Related Owner Confirm: [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) (gated official Leadless / attach — **this file never confirms**). Distinct from already-recommended book-this-Lead: [bookings-booked-lead.md](bookings-booked-lead.md) (`bookThisLead` / `beginBookingThisLead` / `writeTheBookingAndMirrorTheLead` / `completeBookingThisLead` — **this file never mirrors the Lead, never enqueues Sheet Sync**). Distinct from already-recommended from-source: [bookings-booked-lead-from-source.md](bookings-booked-lead-from-source.md). Distinct from already-recommended Referral: [bookings-referral-booking.md](bookings-referral-booking.md) (raw `job_no` 409 before insert — **this file’s unique is the last-line defense after fold**). Distinct from already-recommended Leadless: [bookings-leadless-booking.md](bookings-leadless-booking.md). Distinct from already-recommended Job fold primitive: [bookings-booking-identity.md](bookings-booking-identity.md) (`normalizeJobNo` — **this file asks it**). Distinct from already-recommended employee submit: [employee-bookings-submit-employee-booking.md](employee-bookings-submit-employee-booking.md) (**asks** `new BookedLead` with `booking_origin: "employee_booking"`). Distinct from leftover employee unique-index inspect: [employee-bookings-migration-preflight.md](employee-bookings-migration-preflight.md) (`employee_submission_id_unique` is employee-origin + string `submission_id` only). Distinct from leftover sibling field catalog: `granotLifecycleSchemas.ts` (`aggregateRevisionSchemaFields`, `applyAggregateRevisionGuards` — **this file asks them; it does not own the guard bodies**. No `ingestion_origin` on a Booking). Distinct from leftover sibling field helpers: `schemaHelpers.ts` (`leadModelField` defaults required, `optionalLocalField`, `sheetSyncSchema` — **this file spreads `leadModelField` with `required: false` so Referral / Leadless may omit it**; leave `schemaHelpers.ts` for a later models pass). Distinct from leftover historical relax: `historical/BookedLead.ts` (`registerHistoricalBookedLead` on `vantagemovershistorical`; allocations default `[]`; no Referral / Leadless flags; no unique Job catalog; no `getBookedLeadModel`; no revision). Distinct from already-recommended Form / Call rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md) (named S08 catalogs are **non-unique** and must stay that way — **do not copy this Booking unique onto those Leads**). Distinct from leftover next Cancellation row: `CancelledLead.ts`. Distinct from leftover migration: `scripts/migrations/granot-lifecycle-indexes.ts` (**asks** `BOOKED_LEAD_NORMALIZED_JOB_INDEX` as the unique array; non-unique array stays empty; **this file never creates indexes at runtime**). Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — leftover Owner Connect **asks** default `BookedLead`; do not reopen Wave A in this models pass. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Booking](../../../../CONTEXT.md), [Referral Booking](../../../../CONTEXT.md), [Leadless Booking](../../../../CONTEXT.md), [Booking Chain](../../../../CONTEXT.md), [Agent Allocation](../../../../CONTEXT.md), [Binder](../../../../CONTEXT.md), [Job Number](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); this file’s `CONTEXT.md` also names `employee booking origin` as `BookedLead.booking_origin === "employee_booking"`; do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows.
- Callers: **default-connection model only — there is no `getBookedLeadModel`.** Already-recommended `bookings/bookedLead.service.ts`, `bookedLeadFromSource.service.ts`, `referralBooking.service.ts`, `leadlessBooking.service.ts` **ask** default `BookedLead` for insert / find / populate. Already-recommended `granotLifecycle/identity.ts` **asks** default `BookedLead` for `findBookingsByNormalizedJob` (Form / Call on that file still **ask** `getFormLeadModel` / `getCallLeadModel`). Already-recommended `domainCommands/entityChange.ts` **asks** default `BookedLead` when the aggregate is a Booking. Already-recommended `cancellations/cancelledLead.service.ts` / leftover `cancellationResolver.ts`, leftover `employeeBookings/submitEmployeeBooking.service.ts` / leftover Owner Confirm / leftover `connectBookingToLead.ts`, leftover `reporting/query/canonicalReporting.ts`, leftover `admin/adminScope.service.ts` **ask** default `BookedLead`. `granotAggregateRevisions.test.ts` **asks** `BookedLead` + `BOOKED_LEAD_NORMALIZED_JOB_INDEX` (schema validate + named unique key; **does not** open Mongo). Leftover `scripts/migrations/granot-lifecycle-indexes.ts` **asks** `BOOKED_LEAD_NORMALIZED_JOB_INDEX`. Not this **interface**: `bookThisLead` itself, `createReferralBooking` itself, `createLeadlessBooking` itself, `submitEmployeeBooking` itself, `normalizeJobNo` itself, sibling revision guard bodies.
- Seams callers need: default `BookedLead` (first-registered connection — **including already-recommended book-this-Lead, Referral, Leadless, Granot identity, and EntityChange**) vs the Form / Call selected-database getters (those files have a second **adapter**; this file does not); `autoIndex: false` vs leftover migration apply of the named unique Job catalog; named `BOOKED_LEAD_NORMALIZED_JOB_INDEX` vs unnamed browse indexes vs schema-declared `employee_submission_id_unique` (not in the lifecycle unique array); unique partial Job vs service-level one-Booking-per-Lead `findOne({ lead_ref, lead_model })` vs Referral / Leadless raw `job_no` 409; pre-validate Lead requirement vs Referral / Leadless flags; JSON virtuals (`agent`, `binder_amount`, `customer_name_snapshot`) vs leftover sheet projection that reads allocations / `customer_name` directly; optimistic concurrency (`__v`) vs leftover `domain_revision` (sibling fields — **not** the same contract). There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Lead-mirror **seam**.
- Split later (only if the file outgrows one sitting): this ~175-line file is one sitting if you read it as remember the Booking row, fold the Job Number before validate, require a Lead unless this is Referral or Leadless, keep one official Booking per normalized Job and one employee submission per employee origin — never book or mirror here, never auto-create indexes on boot, never copy this unique onto Form or Call. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `referral.ts`. Book-this-Lead stays already-recommended `bookedLead.service.ts`. Referral / Leadless stay those services. Job fold primitive stays already-recommended `bookingIdentity.ts`. Historical relax stays leftover `historical/BookedLead.ts`. Already-recommended Form / Call rows stay those files. Next Cancellation row stays leftover `CancelledLead.ts`.

`BookedLead` is a Mongoose model name. The owner question is: *A Form or Call just became a Booking — or the owner wrote a Referral, a Leadless, an employee submit, or a gated Granot official Booking. Hold the row on `booked_leads`. Before validate, fold the Job Number, and refuse a lead-attached row that has no Lead. Keep at most one official Booking per normalized Job when a Job Number is present, and keep at most one employee submit per employee `submission_id`. If this process selected a different Mongo database, today’s callers still use the default connection — do not invent a getter in this rename. Do not book the Lead. Do not mirror `lead.booked`. Do not enqueue Sheet Sync. Do not copy this unique onto Form or Call.*

Who book / correct / remove already lives in already-recommended `bookedLead.service.ts`. Who write Referral / Leadless already live in those services. Who fold the Job Number primitive already lives in already-recommended `bookingIdentity.ts`. Who refuse unpaired revision metadata already lives in leftover `granotLifecycleSchemas.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Booking row, fold the Job Number before validate, require a Lead unless Referral or Leadless, and keep one official Booking per normalized Job” story, not “a Booked Lead model CRUD dump,” and not Book This Lead / Referral / Leadless themselves:

1. **Hold the Booking as the System of Record row** — collection `booked_leads`, `autoIndex: false`, `optimisticConcurrency: true`, timestamps, `toJSON` / `toObject` virtuals. Declares `book_date`, optional `job_no` / `normalized_job_no`, optional Customer, polymorphic `lead_ref` + `lead_model` (`refPath`), required `agent_allocations[]` (at least one), Binder total, Deposit, Merchant, display `source`, optional `booking_origin: "employee_booking"`, required `is_referral_booking` / `is_leadless_booking` default false, optional employee `submission_id` / `employee_source_snapshot` / `auto_match`, optional `local`, threshold flags, Cancellation ref, `sheet_sync[]`. Then **asks** leftover `aggregateRevisionSchemaFields` (no Ingestion Origin — a Booking is not a Lead). JSON virtuals currently named `agent` / `binder_amount` / `customer_name_snapshot` expose first-allocation name, Binder total, and `customer_name` so leftover populate / admin JSON still look like the older single-agent row. Leftover sheet projection reads allocations and `customer_name` directly and does **not** need those virtuals. Then **asks** leftover `applyAggregateRevisionGuards` so `last_change_id` / `last_changed_at` stay paired and `change_history_started_at` is write-once after insert. This beat does **not** resolve agents. This beat does **not** upsert the Customer. This beat does **not** set `lead.booked`.

2. **Fold the Job Number before validate, and require a Lead unless this is Referral or Leadless** — unnamed `pre("validate")` sets `normalized_job_no` from `job_no` via already-recommended `normalizeJobNo`. Then, when `is_referral_booking !== true` and `is_leadless_booking !== true`, invalidates missing `lead_ref` and missing `lead_model`. Direct book-this-Lead may omit `job_no` so a Call Lead can be booked before a Job Number exists — fold then stores no string, and the unique partial does not apply. This beat does **not** elect Referral vs Leadless (callers set the flags). This beat does **not** invent a Job Number. This beat does **not** enforce one Booking per Lead (already-recommended book-this-Lead `findOne({ lead_ref, lead_model })` elects ignore / rebook / insert).

3. **Keep one official Booking per normalized Job, and one employee submission per employee origin** — named catalog `BOOKED_LEAD_NORMALIZED_JOB_INDEX` is unique partial `{ normalized_job_no: 1 }` where `normalized_job_no` is a string (`booked_lead_normalized_job_no_unique`; `accepted_names` includes leftover deployed `normalized_job_no_1`). Schema-declared `employee_submission_id_unique` is unique partial `{ submission_id: 1 }` where `booking_origin` is `employee_booking` and `submission_id` is a string — a manual Booking with the same trimmed id is ignored. Unnamed browse indexes (`lead_ref` + `lead_model`, raw `job_no`, Customer, `lead_ref`, `booking_origin`, Referral / Leadless flags, allocation `agent`) stay on the schema and are **not** unique. Leftover `pnpm migration:granot-lifecycle:indexes` applies the Job catalog as the unique array; that function’s non-unique array stays empty; the employee unique is **not** in that catalog. `autoIndex` stays false. This beat does **not** call `syncIndexes`. This beat does **not** declare a unique Lead Job index on Form or Call. This beat does **not** make one Booking per Lead a unique index.

`BookedLeadDocument` is the inferred row type. There is no selected-database getter. There is no unknown-state sentinel here.

There is no book-this-Lead operation. Already-recommended `bookedLead.service.ts` elects that. There is no historical-relax operation. Leftover `historical/BookedLead.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the Booking row, fold the Job Number before validate, require a Lead unless this is Referral or Leadless, keep one official Booking per normalized Job and one employee submission per employee origin — never book or mirror here, never auto-create indexes on boot, never copy this unique onto Form or Call.” Already-recommended book / Referral / Leadless / employee submit / identity already live in deeper **modules**. Leftover revision field catalog and leftover historical relax already live in sibling **modules**. Do not pull those in. Do not invent a `BookedLeadModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `getBookedLeadModel` **adapter** so “Booking matches Form” without a paired proof that already-recommended book-this-Lead, leftover Granot identity, and leftover EntityChange still read the same `booked_leads`. Do not invent an `autoIndex: true` **adapter** so “boot creates the unique Job.” Do not invent a unique `{ lead_ref, lead_model }` **adapter** so “one Booking per Lead lives on the schema.” Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `normalize.ts` / `referral.ts` each get a file.

Do not move leftover `aggregateRevisionSchemaFields` into this file so “the Booking owns revision.” Do not move leftover `normalizeJobNo` into this file so “the row owns Job fold.” Do not merge this file into already-recommended `FormLead.ts` / `CallLead.ts` so “one model owns Lead and Booking.” Do not merge this file into leftover `historical/BookedLead.ts` so “one schema owns the live row and the historical relax.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `BookedLead` | `bookingOnTheDefaultConnection` | already-recommended book / Referral / Leadless, leftover Granot identity, leftover EntityChange, leftover employee submit still import the default model |
| `BookedLeadDocument` | `BookingRow` | inferred document + `_id` + `sheet_sync[]` |
| `BOOKED_LEAD_NORMALIZED_JOB_INDEX` | `namedOneOfficialBookingPerNormalizedJobIndexTheMigrationApplies` | leftover `pnpm migration:granot-lifecycle:indexes` is the only unique-Job apply path; collisions block apply |

Keep the old names as one-line aliases until `bookedLead.service.ts`, leftover Granot identity, leftover EntityChange, and the unique-Job migration migrate. Do not make callers learn `normalized_job_no` / `accepted_names` / `partialFilterExpression` as the domain language. Do **not** add `getBookedLeadModel` so “every aggregate has a getter” — that would invent a **seam** with no second **adapter**. Do **not** delete the default `BookedLead` export so “everyone must call a getter that does not exist.”

**No class for the workflow.** The one type that *does* earn a name is the pending unique-Job catalog:

```ts
type OneOfficialBookingPerNormalizedJobIndex = {
  name: "booked_lead_normalized_job_no_unique"
  key: { normalized_job_no: 1 }
  unique: true
  partialFilterExpression: { normalized_job_no: { $type: "string" } }
}
```

That is the handoff from “this process folded a Job Number” to “the reviewed migration can apply at most one official Booking for that Job.” Do **not** add Form / Call onto that type. Do **not** collapse the employee unique onto that type so “one catalog owns every Booking unique.”

Leave leftover `aggregateRevisionSchemaFields` on leftover `granotLifecycleSchemas.ts`. Leave leftover `registerHistoricalBookedLead` on leftover `historical/BookedLead.ts`. Leave already-recommended `FormLead` / `CallLead` on those files.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// BookedLead.ts
// A Form or Call just became a Booking —
// or the owner wrote a Referral, a Leadless,
// an employee submit, or a gated Granot official Booking.
// Hold the row on booked_leads.
// Before validate, fold the Job Number,
// and refuse a lead-attached row that has no Lead.
// Keep at most one official Booking per normalized Job
// when a Job Number is present,
// and keep at most one employee submit per employee submission_id.
// Today's callers still use the default connection —
// do not invent a selected-database getter in this rename.
// Do not book the Lead.
// Do not mirror lead.booked.
// Do not enqueue Sheet Sync.
// Do not copy this unique onto Form or Call.

export const namedOneOfficialBookingPerNormalizedJobIndexTheMigrationApplies = {
  name: "booked_lead_normalized_job_no_unique",
  key: { normalized_job_no: 1 },
  unique: true,
  partialFilterExpression: { normalized_job_no: { $type: "string" } },
  accepted_names: ["booked_lead_normalized_job_no_unique", "normalized_job_no_1"],
} as const

export const bookingOnTheDefaultConnection =
  mongoose.models.BookedLead ?? mongoose.model("BookedLead", bookedLeadSchema)

export { bookingOnTheDefaultConnection as BookedLead }
export { namedOneOfficialBookingPerNormalizedJobIndexTheMigrationApplies as BOOKED_LEAD_NORMALIZED_JOB_INDEX }

// ── 1. Hold the Booking as the System of Record row ───────

const bookedLeadSchema = rememberTheBookingRow() // collection booked_leads; autoIndex false

function rememberTheBookingRow() {
  const schema = new Schema(
    {
      /* book_date, optional job, optional customer, polymorphic lead, allocations, binder, deposit, merchant, source */
      booking_origin: rememberEmployeeOriginOnly(), // enum employee_booking
      is_referral_booking: { type: Boolean, required: true, default: false },
      is_leadless_booking: { type: Boolean, required: true, default: false },
      /* employee snapshot + auto_match, optional local, thresholds, cancelled, sheet_sync */
      ...askSiblingForAggregateRevisionFields(), // no ingestion_origin
    },
    { collection: "booked_leads", autoIndex: false, optimisticConcurrency: true, timestamps: true },
  )
  exposeOlderSingleAgentJsonShape(schema) // virtuals agent / binder_amount / customer_name_snapshot
  declareBrowseLookupIndexes(schema)      // lead+model, raw job_no — not unique
  declareOneEmployeeSubmissionPerEmployeeOrigin(schema)
  declareNamedOneOfficialBookingPerNormalizedJob(schema)
  askSiblingToKeepRevisionMetadataPairedAndHistoryStartWriteOnce(schema)
  foldJobNumberBeforeValidateAndRequireALeadUnlessReferralOrLeadless(schema)
  return schema
}

// ── 2. Fold Job Number; require a Lead unless Referral / Leadless

function foldJobNumberBeforeValidateAndRequireALeadUnlessReferralOrLeadless(schema) {
  schema.pre("validate", function foldJobAndRequireLeadWhenThisBookingHasALead() {
    this.normalized_job_no = foldTheJobNumber(this.job_no)
    if (this.is_referral_booking !== true && this.is_leadless_booking !== true) {
      if (!this.lead_ref) this.invalidate("lead_ref", "lead_ref is required unless this is a referral or leadless booking")
      if (!this.lead_model) this.invalidate("lead_model", "lead_model is required unless this is a referral or leadless booking")
    }
  })
}

// ── 3. One official Booking per Job; one employee submit ──

function declareNamedOneOfficialBookingPerNormalizedJob(schema) {
  schema.index(
    namedOneOfficialBookingPerNormalizedJobIndexTheMigrationApplies.key,
    {
      unique: true,
      name: namedOneOfficialBookingPerNormalizedJobIndexTheMigrationApplies.name,
      partialFilterExpression:
        namedOneOfficialBookingPerNormalizedJobIndexTheMigrationApplies.partialFilterExpression,
    },
  )
}

function declareOneEmployeeSubmissionPerEmployeeOrigin(schema) {
  schema.index(
    { submission_id: 1 },
    {
      unique: true,
      name: "employee_submission_id_unique",
      partialFilterExpression: {
        booking_origin: "employee_booking",
        submission_id: { $type: "string" },
      },
    },
  )
}
```

Read the primary path out loud: *hold the Booking on `booked_leads` without auto-indexing. Ask the sibling catalog for revision paths, then ask those sibling guards so change-id and changed-at stay paired and history-start stays write-once. Keep at least one Agent Allocation. Before validate, fold the Job Number, and refuse a row that is neither Referral nor Leadless and still has no Lead. Keep one official Booking per normalized Job when a Job Number is present. Keep one employee submit per employee `submission_id`. Keep the browse indexes non-unique. If this process already sits on the first-registered connection, that is the model leftover book-this-Lead and leftover Granot identity already import. Do not book. Do not mirror. Do not make Form or Call Job Number unique.*

That is the operation. An unnamed `pre("validate")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The validate hook has no name, and it does two jobs.** It folds Job Number **and** requires a Lead unless Referral / Leadless. Rename the beat `foldJobNumberBeforeValidateAndRequireALeadUnlessReferralOrLeadless`. Do not move Job fold into leftover `historical/BookedLead.ts` (that file does not fold). Do not copy Form Lead’s lid / name / phone fold onto this hook so “one identity fold owns every row.” Do not copy Call Lead’s phone-or-Job requirement here so “Booking matches Call.”

2. **There is no selected-database getter — and that is today’s contract, not a missing Form-Lead copy.** Already-recommended book-this-Lead, Referral, Leadless, leftover Granot identity, leftover EntityChange, leftover employee submit, leftover cancellations, leftover reporting **ask** default `BookedLead`. On leftover `identity.ts` and leftover `entityChange.ts`, Form / Call **ask** getters and Booking **asks** the default. Do not silently add `getBookedLeadModel` in this rename so “every aggregate matches Form” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database **and** that already-recommended book-this-Lead still finds the same rows. Do not move leftover identity’s Booking find onto a new getter in the same pass as this rename.

3. **Unique Job is the Booking contract, and it is partial.** Direct book-this-Lead may omit `job_no`. Fold then stores no string, and the unique does not apply — several Bookings without a Job Number may coexist. Do not drop `{ unique: true }` so “Form and Call have no unique Job, so Booking should not either.” Do not drop the `$type: "string"` partial so “every missing Job collides.” Do not add `unique` to Form / Call `{ normalized_job_no: 1 }` so “Lead matches Booking.”

4. **One Booking per Lead is a service `findOne`, not this unique.** The compound `{ lead_ref, lead_model }` index is browse. Already-recommended book-this-Lead elects ignore / rebook / insert. Do not add `{ unique: true }` on that pair so “the schema owns one Booking per Lead” — leftover employee pending Leadless and leftover Owner Connect would then be a different story.

5. **Referral / Leadless 409 is raw `job_no`, then this unique is the last line.** Already-recommended Referral looks up `{ job_no }` before insert. The unique defends the folded form. Do not delete the service 409 so “the unique is enough” without a paired proof that `JOB-1` and `job-1` still collide after fold. Do not treat leftover Referral as this story.

6. **Named unique-Job catalog vs schema-declared employee unique vs unnamed browse.** Leftover `orderedBookedLeadIndexCreates()` applies only `BOOKED_LEAD_NORMALIZED_JOB_INDEX`. `employee_submission_id_unique` is declared here and is **not** in that unique array. Do not merge the lists so “one array owns every Booking unique” without a paired report that `autoIndex` stays false, Job unique stays the lifecycle apply, and employee unique stays employee-origin + string only. Do not include every origin so “submission id should be globally unique.”

7. **`leadModelField` is required in the sibling helper; this file spreads it `required: false`.** The hook is what requires the Lead on the attached path. Do not flip the sibling helper to optional so “Booking owns the helper.” Do not flip this path back to required so “Referral validate fails.”

8. **`__v` is not `domain_revision`.** Optimistic concurrency is Mongoose. Lifecycle revision is leftover sibling fields. Do not rename `__v` to `domain_revision` or drop `optimisticConcurrency` so “one version owns the row.”

9. **Do not silently enable `autoIndex`.** The schema is the declaration. The Job migration is the unique-Job apply. Boot must not create the unique Job or the employee unique.

10. **Leave sibling modules alone.** Revision field catalog, book-this-Lead, Referral, Leadless, employee submit, historical relax, and the Form / Call rows are already the right **depth**. This file orchestrates the Booking row.

## Testing

The **interface** is the test surface: `BookedLead` validate, `BOOKED_LEAD_NORMALIZED_JOB_INDEX`.

Today’s `granotAggregateRevisions.test.ts` already names the row, not book-this-Lead: `domain_revision` defaults `0`, named unique Job catalog, Form / Call must **not** gain a unique Lead Job index, leftover historical Booking schema stays without revision fields. Keep those as the operation proofs. There is no `BookedLead.test.ts`.

Add (or keep, if a later implementer finds them missing) only interface proofs:

**Hold the row**
- A new Booking requires at least one Agent Allocation.
- `is_referral_booking` / `is_leadless_booking` default `false`.
- A Referral fixture (no `lead_ref`) still validates when `is_referral_booking: true`.
- After insert, unpaired `last_change_id` / `last_changed_at` reject.

**Fold Job Number + require a Lead unless Referral / Leadless**
- Validate folds `job_no` → `normalized_job_no`.
- A lead-attached row with neither `lead_ref` nor `lead_model` rejects.
- A Leadless row (`is_leadless_booking: true`) may omit both and still validate.
- Folding a missing `job_no` does not invent a Job Number.

**One official Booking per Job + one employee submit**
- `BOOKED_LEAD_NORMALIZED_JOB_INDEX` is unique partial `{ normalized_job_no: 1 }` with name `booked_lead_normalized_job_no_unique` and accepted leftover `normalized_job_no_1`.
- Schema declares unique partial `employee_submission_id_unique` scoped to `booking_origin: "employee_booking"` and string `submission_id`.
- `{ lead_ref, lead_model }` is not unique.
- `schema.options.autoIndex === false`.
- Form / Call schema indexes still have no unique `normalized_job_no`.

Do **not** add a test per helper (`foldTheJobNumber`, `rememberEmployeeOriginOnly`). Those names exist so the parent reads. Do **not** HTTP book-this-Lead from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the unique Job.” Do **not** open a Granot Booking case from this file’s tests.

`BOOKED_LEAD_NORMALIZED_JOB_INDEX` stays exported because leftover unique-Job apply is a second real **adapter**, not a test leak.

## What I would not do

- A `BookedLeadModelService` / `BookedLeadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.index`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `referral.ts` split for cleanliness.
- Breaking the default-connection **seam** by inventing `getBookedLeadModel` without a paired proof. Leftover Granot identity must not write live `booked_leads` while `TEST_MODE` selected `testvantagemovers` — and today’s write already uses the default, not a getter.
- Treating already-recommended `bookThisLead` / `beginBookingThisLead` as this story. Those services own Lead mirror and Sheet Sync.
- Treating already-recommended Referral / Leadless as this story. Those files own the raw `job_no` 409 and the no-Lead write.
- Treating leftover `submitEmployeeBooking` as this story. That file owns auto-match and the Owner case.
- Treating leftover `historical/BookedLead.ts` as this story. That row relaxes allocations to `[]` and has no unique Job catalog.
- Treating already-recommended `FormLead.ts` / `CallLead.ts` as this story. One official Booking per Job is not one Lead per Job.
- Treating leftover next `CancelledLead.ts` as this story.
- Inventing a unique Lead Job **seam** on Form or Call.
- Inventing an `autoIndex: true` **adapter** that has only “convenience” as its second home.
- Inventing a selected-database **seam** that has only one **adapter**.
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Silently migrating leftover identity / EntityChange onto a new getter so “Booking matches Form” without a paired proof.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
