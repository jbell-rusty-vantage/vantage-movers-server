# Remember One Owner Work Case For An Already-Booked Leadless Employee Or Best-Relocation Job On `booking_lead_reconciliation_cases` — Unique Per Booking, Origin Employee Or External Sheet, Pending Resolved Or Dismissed, Submission Snapshot Plus Candidates Attempts Rematch Lease And Application Revision, Unnamed Browse And Rematch Clocks The Boot Creates, Default-Connection Model Only — Never Book Or Match Here, Never Attach Or Rematch Here, Never Open A Granot Booking Case, Never Add A Selected-Database Getter From This Rename — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 51 of this service — `BookingLeadReconciliationCase.ts`
- Remaining in this service: `PublicSubmissionThrottleBucket.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/BookingLeadReconciliationCase.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) (System of Record is Mongo `booked_leads` plus `booking_lead_reconciliation_cases`; this path is **not** the Granot Booking Reconciliation Case; public employee submit books first, then auto-links or opens a pending Owner case; Best Relocation leadless import may open the same collection with `origin: external_sheet_ingestion`; ordinary admin `POST /api/v1/leadless-bookings` does **not** — **this file never books, never matches, never attaches, never rematches**). Related Booking write: [`docs/knowledge/services/bookings.md`](../../../docs/knowledge/services/bookings.md) (Leadless §4: a case is created only when `ingestion_source=best_relocation_sheet`; Granot Owner Confirm §5 is a different official Leadless and **does not** open this case). Compatibility: [`.cursor/rules/schema-and-crud-inputs.mdc`](../../../.cursor/rules/schema-and-crud-inputs.mdc) Core Collections names `GranotBookingReconciliationCase` (`granot_booking_reconciliation_cases`) and does **not** name `booking_lead_reconciliation_cases`. Do not rewrite that paragraph from this rename so “the Core Collections list owns the employee case.” This checkout’s `CONTEXT.md` **does** define [`employee booking submission`](../../../../CONTEXT.md), [`booking lead reconciliation case`](../../../../CONTEXT.md), [`employee booking origin`](../../../../CONTEXT.md), and [`matching unavailable`](../../../../CONTEXT.md) — link those terms; do not invent a second glossary. `docs/adr/` is absent here — do not invent ADR copies. Already-recommended public submit: [employee-bookings-submit-employee-booking.md](employee-bookings-submit-employee-booking.md) (`new BookingLeadReconciliationCase` + `save({ session })` after a leadless Booking when the matcher is pending — **this file never throttles, never claims a Lead**). Already-recommended Owner desk: [employee-bookings-booking-lead-reconciliation.md](employee-bookings-booking-lead-reconciliation.md) (`list` / `get` / refresh / correct-pending / resolve / reopen **ask** default `BookingLeadReconciliationCase` — **this file never lists, never CAS-es `revision`, never claims**). Already-recommended rematch drain: [employee-bookings-reconciliation-rematch.md](employee-bookings-reconciliation-rematch.md) (`find` due pending + `findOneAndUpdate` case lease + `save` — **this file never holds the global drain**). Already-recommended attach / mint / reassign: [employee-bookings-booking-lead-attachment.md](employee-bookings-booking-lead-attachment.md) (**this file never stamps the Booking**). Already-recommended Best Relocation leadless: [bookings-leadless-booking.md](bookings-leadless-booking.md) (`BookingLeadReconciliationCase.create([...], { session })` with `origin: "external_sheet_ingestion"` / `reason: "no_match"` — **this file never books the Job**). Already-recommended command attach: [domain-commands-bookings.md](domain-commands-bookings.md) (`attachBookingToLead` **asks** `findOne({ booking })` then already-recommended `resolveBookingLeadReconciliationInTransaction` — **this file never begins a Domain Command**). Already-recommended Granot intake: [granot-lifecycle-booking-reconciliation.md](granot-lifecycle-booking-reconciliation.md) / [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`findOne({ booking })` to copy `employee_reconciliation_case_id` / paint `href` — **this file never opens a Granot case**). Already-recommended Granot Booking work: [models-granot-booking-reconciliation-case.md](models-granot-booking-reconciliation-case.md) (collection `granot_booking_reconciliation_cases` — **do not merge**). Already-recommended conversation recording: [models-lead-conversation.md](models-lead-conversation.md) (collection `lead_conversations` — **do not merge**). Already-recommended Form / Call / Booking rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md), [models-booked-lead.md](models-booked-lead.md) — **the Booking is unique here; it is not this collection**. Already-recommended HTTP desks: [routes-v1.md](routes-v1.md) (`GET/POST/PATCH /api/v1/admin/booking-lead-reconciliations*` plus public employee submit — **never import this file**); [routes-booking-reconciliation-cron.md](routes-booking-reconciliation-cron.md) (**never import this file**). Already-recommended Job Timeline hop: [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (**does not** hop `booking_lead_reconciliation_cases`). Already-recommended historical apply: [historical-consolidation-apply.md](historical-consolidation-apply.md) (`SIDE_EFFECT_COLLECTIONS` lists `lead_messages` and **omits** this name). Distinct from leftover next public throttle: leftover next `PublicSubmissionThrottleBucket.ts` — **do not merge**. This checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model only — there is no selected-database getter.** Already-recommended `submitEmployeeBooking.service.ts` **constructs** `new BookingLeadReconciliationCase({ booking, status: "pending", reason, submission, latest_candidates, match_attempts: [{ trigger: "initial" }], retry: buildRetryState(reason), revision: 0 })` and `save({ session })` inside `runSheetSyncWrite` — it does **not** set `origin` (schema default `"employee_booking"`). Already-recommended `leadlessBooking.service.ts` **asks** `BookingLeadReconciliationCase.create([...], { session })` only when `isBestRelocationImport` with `origin: "external_sheet_ingestion"`, `reason: "no_match"`, empty candidates, `auto_match_policy_version: "best-relocation-conservative-v1"`. Already-recommended `bookingLeadReconciliation.service.ts` **asks** default `find` / `findById` / mongoose `save` after application `revision` CAS. Already-recommended `reconciliationRematch.service.ts` **asks** default `find` due pending, `findOneAndUpdate` for the case lease, `findOne` + `save` inside the write, `updateOne` to clear a lost lease. Already-recommended `domainCommands/bookings.ts` `attachBookingToLead` **asks** `findOne({ booking })` then the desk begin. Already-recommended `granotLifecycle/bookingReconciliation.ts` **asks** `findOne({ booking }).sort({ updatedAt: -1 })` only when the official Booking is leadless and not a Referral. Already-recommended `granotLifecycle/projections.ts` **asks** `findOne({ booking: deterministic_booking_id })` to paint `employee_booking_lead_reconciliation`. `reporting.test.ts` stubs default `.find` so a reporting fixture does not hit Mongo — **not a product reader**. Tests: there is **no** `BookingLeadReconciliationCase.test.ts`. `bookingLeadReconciliation.service.test.ts` stubs default `find` / `findById`. `bookingReconciliation.test.ts` asserts the Granot current-context kind `employee_booking_lead_reconciliation` — **never constructs this model**. Not this **interface**: `submitEmployeeBooking` itself, `listBookingLeadReconciliationCases` itself, `resolveBookingLeadReconciliation` itself, `runDueBookingLeadRematches` itself, `attachLeadToEmployeeBooking` itself, `createLeadlessBooking` itself, `attachBookingToLead` itself, `maybeReconcileBooking` itself, leftover next throttle itself.
- Seams callers need: default `BookingLeadReconciliationCase` (first-registered connection — **every** runtime caller imports this; there is **no** `getBookingLeadReconciliationCaseModel`) vs mongoose `new` + `save({ session })` (employee submit) vs `create([...], { session })` (Best Relocation leadless) vs `find` / `findById` / `save` (Owner desk) vs `findOneAndUpdate` / `updateOne` (rematch lease — **does not** bump `revision`) vs application `revision` CAS (`assertRevision` on the desk / command) vs mongoose `__v` (`optimisticConcurrency: true` on `save`); unique `booking` vs Granot `findOne({ booking }).sort({ updatedAt: -1 })` that the unique makes redundant; `origin` default `"employee_booking"` vs Best Relocation `"external_sheet_ingestion"` vs ordinary admin leadless that **never** writes this collection; `status` default `"pending"` vs `"resolved"` / `"dismissed"`; required `reason` (no default — submit / BR must set it); `timestamps: true` camelCase `createdAt` / `updatedAt`; default `__v`; omitted `autoIndex: false` (boot creates the unique Booking clock plus field indexes plus nine unnamed browse / rematch clocks — there is **no** named catalog and **no** `pnpm migration:*` for this collection). There is no persist-helper **adapter**. There is no selected-database **adapter**. There is no Domain Command **seam**. There is no HTTP **seam**. There is no Granot Booking **seam**.
- Split later (only if the file outgrows one sitting): this ~209-line file is one sitting if you read it as remember one Owner work case for an already-booked leadless employee or Best-Relocation Job on `booking_lead_reconciliation_cases` — unique per Booking, origin employee or external sheet, pending resolved or dismissed, submission snapshot plus candidates attempts rematch lease and application revision, unnamed browse and rematch clocks the boot creates, default-connection model only — never book or match here, never attach or rematch here, never open a Granot Booking case, never add a selected-database getter from this rename. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `open.ts` / `resolve.ts` / `rematch.ts`. Submit stays already-recommended `submitEmployeeBooking.service.ts`. Owner desk stays already-recommended `bookingLeadReconciliation.service.ts`. Rematch stays already-recommended `reconciliationRematch.service.ts`. Best Relocation leadless stays already-recommended `leadlessBooking.service.ts`. Granot Booking work stays already-recommended `GranotBookingReconciliationCase.ts`. Leftover next public throttle stays leftover next `PublicSubmissionThrottleBucket.ts`.

`BookingLeadReconciliationCase` is a Mongoose model name. The owner question is: *The employee just booked a Job without a unique Lead — or Best Relocation imported a leadless row. Hold one Owner work case on `booking_lead_reconciliation_cases`. One Booking cannot have two cases. Remember the submission snapshot, the cards the matcher showed, the rematch lease, and the application revision the Owner desk CAS-es. This is not a Booking. This is not a Granot Booking case. Boot creates the unnamed clocks. There is no selected-database getter. Do not book here. Do not match here. Do not attach here. Do not rematch here. Do not invent a getter so “this matches conversation.” Do not merge this into the Granot Booking case.*

Who book the employee Job already lives in already-recommended `submitEmployeeBooking.service.ts`. Who book the Best Relocation leadless Job already lives in already-recommended `leadlessBooking.service.ts`. Who work the Owner desk already lives in already-recommended `bookingLeadReconciliation.service.ts`. Who retry the still-pending case already lives in already-recommended `reconciliationRematch.service.ts`. Who stamp the Booking already lives in already-recommended `bookingLeadAttachment.service.ts`. Who hold Granot Owner Booking work already lives in already-recommended `GranotBookingReconciliationCase.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember one Owner work case for an already-booked leadless employee or Best-Relocation Job on `booking_lead_reconciliation_cases` — unique per Booking, origin employee or external sheet, pending resolved or dismissed, submission snapshot plus candidates attempts rematch lease and application revision, unnamed browse and rematch clocks the boot creates, default-connection model only — never book or match here, never attach or rematch here, never open a Granot Booking case, never add a selected-database getter from this rename” story, not “a booking-lead-reconciliation CRUD dump,” and not Book The Employee Job / Work The Owner Desk / Retry The Still-Pending Case themselves:

1. **Hold the durable Owner work case for an already-booked leadless Job** — collection `"booking_lead_reconciliation_cases"`, `timestamps: true` (mongoose camelCase `createdAt` / `updatedAt`), `optimisticConcurrency: true` (default `__v` is the mongoose CAS). **No** `autoIndex: false`. **No** `versionKey: false`. **No** hooks. **No** `immutable`. **No** `sheet_sync[]`. **No** official Booking fields (the Booking lives on already-recommended `BookedLead`). Required unique `booking` ObjectId `ref: "BookedLead"` (`unique: true` plus `index: true`). Required `origin` enum `"employee_booking"` | `"external_sheet_ingestion"` default `"employee_booking"` (`index: true`). Required `status` enum `"pending"` | `"resolved"` | `"dismissed"` default `"pending"` (`index: true`). Required `reason` enum `no_match` | `multiple_matches` | `identity_conflict` | `source_conflict` | `channel_conflict` | `duplicate_lead` | `lead_already_booked` | `lead_cancelled` | `matching_unavailable` (**no** default — submit / BR must set it; `index: true`). Nested `submission` (required `submission_id` / `lead_name` / `phone_number` / `normalized_phone_number` / `job_no` / `normalized_job_no` / `binder_amount` `min: 0` / `deposit_amount` `min: 0` / `merchant` / `agent` / `book_date`; optional `email` / `lid` / `split_agent` plus normalized twins; required `source_assignment` with company + granularity ids, label snapshots, and `channel` enum `form` | `call`). Nested `latest_candidates[]` (`{ _id: false }`: Form or Call + `confidence` `high` | `medium` | `low` + match methods + eligibility + source compatibility + warnings + display snapshot). Nested `match_attempts[]` (`{ _id: false }`: `attempted_at`, `trigger` `initial` | `delayed_retry` | `owner_refresh`, `outcome` `high_confidence` | `conflict` | `no_match` | `error`, `reason`, `candidate_count` `min: 0`, `candidate_snapshot_hash`, `auto_match_policy_version`, `enabled_auto_match_rules`). Nested `retry` (`attempt_count` default `0`, optional `next_attempt_at` indexed, optional `leased_until` / `lease_owner` / `last_error`). Nested `resolution_history[]` (`{ _id: false }`: `action` `auto_attach_delayed` | `attach_existing` | `create_and_attach` | `dismiss` | `reopen` | `reassign` | `update_submission` | `booking_cancelled`, optional Lead pointer, optional `source_resolution`, `actor`, `occurred_at`). Required `revision` default `0` — **this is the Owner / command CAS**, not `__v`. `BookingLeadReconciliationCaseDocument` is `InferSchemaType` plus `_id`. This beat does **not** book the Job. This beat does **not** run the matcher. This beat does **not** stamp a Lead on the Booking.

2. **Remember which Booking is unique and how the Owner desk, rematch cron, and Granot intake find the case** — unique `booking` is the idempotency key. A second insert for the same Booking 11000s. There is **no** unique `submission.submission_id`. There is **no** unique `submission.normalized_job_no` (Job uniqueness lives on already-recommended `BookedLead`). Field indexes on `origin` / `status` / `reason` / `retry.next_attempt_at`. Nine additional **unnamed** `Schema.index` clocks: `{ status, createdAt: -1 }` (Owner browse), `{ origin, status, createdAt: -1 }`, `{ status, "retry.next_attempt_at" }` (rematch due page), `{ reason, status, updatedAt: -1 }`, plus submission normalized job / phone / lid / email / name. Already-recommended Owner list filters `status` / `origin` / `reason` / Source / typed `q` / `createdAt` and sorts the requested date. Already-recommended rematch pages `{ status: "pending", reason: { $in: autoRematchReasons }, "retry.next_attempt_at": { $lte: now } }` with a free case lease. Already-recommended Granot persist / detail `findOne({ booking })` — the unique makes `.sort({ updatedAt: -1 })` redundant. This beat does **not** unique `origin`. This beat does **not** name the clocks. This beat does **not** refuse a second open Granot case — that collection is a sibling.

3. **Bind the default-connection model and let boot create the clocks** — default export `BookingLeadReconciliationCase` is `mongoose.models.BookingLeadReconciliationCase ?? mongoose.model(...)`. There is **no** `getBookingLeadReconciliationCaseModel`. There is **no** `createBookingLeadReconciliationCase`. There is **no** named index catalog. There is **no** `autoIndex: false`. Boot creates the unique Booking clock, the four field indexes, and the nine unnamed browse / rematch clocks. Submit `new` + `save`. Best Relocation `create([...])`. Desk and rematch `save` after they bump `revision`. Rematch lease `findOneAndUpdate` / `updateOne` does **not** bump `revision` and does **not** send `__v`. This beat does **not** `useDb`. This beat does **not** delete the default export so “everyone must call a getter that does not exist.” This beat does **not** invent a selected-database getter from this rename.

There is no book / match operation. `submitEmployeeBooking` / `createLeadlessBooking` elect that. There is no Owner desk operation. `listBookingLeadReconciliationCases` / `resolveBookingLeadReconciliation` elect that. There is no rematch operation. `runDueBookingLeadRematches` elects that. There is no official Booking write. `BookedLead` persist lives on those sibling files.

## Organization

Keep one file. This is the screenplay for “remember one Owner work case for an already-booked leadless employee or Best-Relocation Job on `booking_lead_reconciliation_cases` — unique per Booking, origin employee or external sheet, pending resolved or dismissed, submission snapshot plus candidates attempts rematch lease and application revision, unnamed browse and rematch clocks the boot creates, default-connection model only — never book or match here, never attach or rematch here, never open a Granot Booking case, never add a selected-database getter from this rename.” Submit / desk / rematch / attach / Best Relocation leadless / Granot intake already live in deeper **modules**. Already-recommended Granot Booking work / conversation recording / Form / Call / Booking already live in sibling **modules**. Leftover next public throttle already lives in a sibling **module**. Do not pull those in. Do not invent a `BookingLeadReconciliationCaseService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a selected-database **adapter** beside today’s default export so “this matches conversation” without a paired submit + desk + rematch + Best Relocation selected-database proof. Do not invent an `autoIndex: false` **adapter** so “boot matches conversation” without a paired migration. Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `open.ts` / `resolve.ts` / `rematch.ts` each get a file.

Do not move `submitEmployeeBooking` into this file so “the row owns the public form.” Do not move `listBookingLeadReconciliationCases` into this file so “the row owns the desk.” Do not move `runDueBookingLeadRematches` into this file so “the row owns the cron.” Do not merge this file into already-recommended `GranotBookingReconciliationCase.ts` so “one schema owns every Owner attach.” Do not merge this file into already-recommended `BookedLead.ts` so “the Booking is the case.” Do not merge this file into leftover next `PublicSubmissionThrottleBucket.ts` so “one bag owns throttle and the case.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `BookingLeadReconciliationCase` | `ownerLeadlessBookingWorkCaseOnTheDefaultConnection` | every runtime caller — submit, Best Relocation leadless, Owner desk, rematch, command attach, Granot intake pointer — imports this default model |
| `BookingLeadReconciliationCaseDocument` | `OwnerLeadlessBookingWorkCase` | inferred row + `_id` |

Keep the old names as one-line aliases until already-recommended submit / desk / rematch / leadless / command attach / Granot intake migrate. Do not make callers learn `optimisticConcurrency` / `revision` / `booking_lead_reconciliation_cases` as the only domain language until those sites move. Do **not** add `getBookingLeadReconciliationCaseModel` so “this matches conversation” without a paired proof that submit, desk, rematch, and Best Relocation still write the selected database. Do **not** add `createBookingLeadReconciliationCase` so “SMS save matches the case.” Do **not** re-export `submitEmployeeBooking` / `listBookingLeadReconciliationCases` / `runDueBookingLeadRematches` from this file so “the row books, lists, or rematches.” Do **not** export a named index catalog that does not exist on disk.

**No class for the workflow.** The one type that *does* earn a name is the already-booked leadless Owner-case identity contract:

```ts
type OwnerLeadlessBookingWorkCaseIdentity = {
  collection: "booking_lead_reconciliation_cases"
  official_booking: false
  granot_booking_case: false
  unique_booking: true
  unique_submission_id: false
  unique_normalized_job_no: false
  origin_default: "employee_booking"
  best_relocation_writes_origin: "external_sheet_ingestion"
  ordinary_admin_leadless_writes_this: false
  granot_owner_confirm_writes_this: false
  status_default: "pending"
  reason_required_no_default: true
  application_revision_cas: true
  mongoose_optimistic_concurrency: true
  rematch_lease_bypasses_revision: true
  timestamps: { createdAt: true, updatedAt: true }
  versionKey: true
  selected_database_getter: false
  save_through_getter: false
  autoIndex: true
  named_index_catalog: false
  boot_creates_clocks: true
  model_test: false
  core_collections_names_this: false
  historical_side_effect: false
  job_timeline_hops_this: false
}
```

That is the handoff from “this process remembered Owner work for an already-booked leadless Job” to “one Booking cannot have two cases, employee submit defaults origin, Best Relocation stamps external sheet, boot creates the unnamed clocks, and there is no selected-database getter.” Do **not** add `{ selected_database_getter: true }` so “this matches conversation.” Do **not** add `{ autoIndex: false }` so “this matches the Granot Booking case.” Do **not** add `{ unique_normalized_job_no: true }` so “the case owns the Job.” Do **not** add `{ granot_booking_case: true }` so “one case owns every Owner attach.”

Leave already-recommended `submitEmployeeBooking.service.ts` on that file. Leave already-recommended `bookingLeadReconciliation.service.ts` on that file. Leave already-recommended `reconciliationRematch.service.ts` on that file. Leave already-recommended `leadlessBooking.service.ts` on that file. Leave already-recommended `GranotBookingReconciliationCase.ts` on that file. Leave leftover next `PublicSubmissionThrottleBucket.ts` on that file. Leave already-recommended `BookedLead.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// BookingLeadReconciliationCase.ts
// The employee just booked a Job without a unique Lead —
// or Best Relocation imported a leadless row.
// Hold one Owner work case on booking_lead_reconciliation_cases.
// One Booking cannot have two cases.
// Remember the submission snapshot,
// the cards the matcher showed,
// the rematch lease,
// and the application revision the Owner desk CAS-es.
// This is not a Booking.
// This is not a Granot Booking case.
// Boot creates the unnamed clocks.
// There is no selected-database getter.
// Do not book here.
// Do not match here.
// Do not attach here.
// Do not rematch here.

// ── 1. Hold the durable Owner work case
// for an already-booked leadless Job ──

const BookingLeadReconciliationCaseSchema = new Schema(
  {
    booking: {
      type: Schema.Types.ObjectId,
      ref: "BookedLead",
      required: true,
      unique: true,
    },
    origin: {
      type: String,
      enum: ["employee_booking", "external_sheet_ingestion"],
      required: true,
      default: "employee_booking",
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "dismissed"],
      required: true,
      default: "pending",
    },
    reason: {
      type: String,
      enum: [
        "no_match",
        "multiple_matches",
        "identity_conflict",
        "source_conflict",
        "channel_conflict",
        "duplicate_lead",
        "lead_already_booked",
        "lead_cancelled",
        "matching_unavailable",
      ],
      required: true,
    },
    submission: { /* snapshot of the already-booked Job */ },
    latest_candidates: { type: [candidateSnapshotSchema], default: [] },
    match_attempts: { type: [matchAttemptSchema], default: [] },
    retry: {
      attempt_count: { type: Number, required: true, default: 0 },
      next_attempt_at: { type: Date },
      leased_until: { type: Date },
      lease_owner: { type: String },
      last_error: { type: String },
    },
    resolution_history: { type: [resolutionHistorySchema], default: [] },
    revision: { type: Number, required: true, default: 0 },
  },
  {
    collection: "booking_lead_reconciliation_cases",
    timestamps: true,
    optimisticConcurrency: true,
  },
)

// ── 2. Remember which Booking is unique
// and how the Owner desk, rematch cron,
// and Granot intake find the case

function rememberWhichBookingIsUniqueAndHowTheDeskRematchAndGranotIntakeFindIt() {
  // unique booking — a second insert 11000s
  // Job uniqueness stays on BookedLead
  // rematch pages pending + due next_attempt_at
  // Granot intake findOne({ booking })
}

// ── 3. Bind the default-connection model
// and let boot create the clocks

BookingLeadReconciliationCaseSchema.index({ status: 1, createdAt: -1 })
BookingLeadReconciliationCaseSchema.index({
  origin: 1,
  status: 1,
  createdAt: -1,
})
BookingLeadReconciliationCaseSchema.index({
  status: 1,
  "retry.next_attempt_at": 1,
})
// plus reason/status, normalized job / phone / lid / email / name
// unnamed — there is no catalog and no migration

export const ownerLeadlessBookingWorkCaseOnTheDefaultConnection =
  mongoose.models.BookingLeadReconciliationCase ??
  mongoose.model(
    "BookingLeadReconciliationCase",
    BookingLeadReconciliationCaseSchema,
  )

export {
  ownerLeadlessBookingWorkCaseOnTheDefaultConnection as BookingLeadReconciliationCase,
}
```

Read the primary path out loud: *The employee just booked a Job without a unique Lead — or Best Relocation imported a leadless row. Remember that as one `booking_lead_reconciliation_cases` row. One Booking cannot belong to two cases. Default the origin to employee booking unless Best Relocation stamps external sheet. Keep the case pending with the matcher reason. Store the submission snapshot and the cards. Leave room for the rematch lease and the application revision the Owner desk CAS-es. Boot creates the unnamed clocks. There is no selected-database getter. Do not book from here. Do not match from here. Do not attach from here. Do not rematch from here. Do not open a Granot Booking case from here.*

## Precise logic I would tighten while renaming

1. **This is Owner work for an already-booked leadless Job. It is not book, match, attach, rematch, or a Granot Booking case.** Already-recommended `submitEmployeeBooking.service.ts` / `leadlessBooking.service.ts` own insert. `bookingLeadReconciliation.service.ts` owns desk CAS. `reconciliationRematch.service.ts` owns the lease + delayed attach. `GranotBookingReconciliationCase.ts` is a different collection. Do not move those in so “the row owns the form and the desk.”

2. **There is no selected-database getter.** Already-recommended conversation / SMS / Granot cases follow `getMongoDatabaseName()`. Every runtime caller here imports the default export. Do not add `getBookingLeadReconciliationCaseModel` from this rename so “this matches conversation” without a paired submit + desk + rematch + Best Relocation selected-database proof. Do not delete the default export so “everyone must call a getter that does not exist.”

3. **Two CAS live on one row.** Owner desk / command `assertRevision` the application `revision` (default `0`, increment on `save`). Schema also sets `optimisticConcurrency: true`, so mongoose `save` CAS-es `__v`. Rematch lease `findOneAndUpdate` / `updateOne` bypasses both. Do not drop `revision` so “`__v` is enough” without a paired desk + command proof. Do not drop `optimisticConcurrency` so “revision is enough” without a paired `save` proof. Do not teach rematch to bump `revision` on lease claim so “every write is a desk act.”

4. **Unique is the Booking, not the Job Number.** Job uniqueness lives on already-recommended `BookedLead` partial `{ normalized_job_no }`. Duplicate employee submit is a Booking `booking_origin` + `submission_id` 200, not this unique. Do not unique `submission.normalized_job_no` so “the case owns the Job.” Do not unique `submission.submission_id` so “the case owns idempotency.”

5. **Ordinary admin leadless does not write this collection.** Only Best Relocation import (`origin: "external_sheet_ingestion"`, `reason: "no_match"`, empty candidates) and employee submit (default origin, matcher reason) insert. Granot Owner Confirm does not insert. Do not teach leftover `POST /api/v1/leadless-bookings` to open a case so “every leadless Job has a desk.” Do not teach Granot Confirm to insert so “one case owns every Owner attach.”

6. **`reason` has no default.** Submit / BR must set it. `matching_unavailable` is the CONTEXT term for a matcher throw that still commits the Booking + case. Default rematch list is only that reason. Do not default `reason: "no_match"` so “BR matches employee.” Do not drop `matching_unavailable` so “error is not a reason.”

7. **`latest_candidates.confidence` includes `low`.** Already-recommended conversation `match_confidence` is `high` | `medium` only. Do not drop `low` so “conversation matches the case.” Do not add `low` onto conversation from this rename.

8. **Granot intake `sort({ updatedAt: -1 })` is redundant under unique `booking`.** Do not drop the unique so “two cases can share a Booking.” Do not drop the Granot sort from this models pass so “lookup matches the unique.” Leave both. Do not rewrite already-recommended `projections.ts` from this rename.

9. **Indexes are unnamed; boot creates them.** Already-recommended conversation / Granot cases use `autoIndex: false` plus a named catalog plus a migration. This file does neither. Do not flip `autoIndex` off so “this matches conversation” without a paired migration. Do not invent `BOOKING_LEAD_RECONCILIATION_CASE_INDEXES` from this rename so “the catalog matches Granot” without a caller that applies it.

10. **There is no model test.** Conversation / SMS / Granot cases construct the default model and read `.schema.indexes()`. This file has no `BookingLeadReconciliationCase.test.ts`. Desk tests stub `find` / `findById`. Do not pretend those stubs prove unique `booking` or the nine unnamed clocks.

11. **Software-map gap.** Core Collections names the Granot Booking case and omits this collection. Job Timeline does not hop `booking_lead_reconciliation_cases`. Historical `SIDE_EFFECT_COLLECTIONS` omits this name. Do not invent those lines from this rename.

12. **Leave sibling modules alone.** `submitEmployeeBooking`, `listBookingLeadReconciliationCases`, `runDueBookingLeadRematches`, `createLeadlessBooking`, `attachBookingToLead`, `maybeReconcileBooking` are already the right **depth**. This file holds the row.

## Testing

The interface of this file is the default-connection model, the inferred-row type, required unique `booking`, `origin` default `"employee_booking"`, `status` default `"pending"`, required `reason` with no default, `revision` default `0`, `optimisticConcurrency: true`, camelCase timestamps, default `__v`, omitted selected-database getter, omitted save helper, omitted `autoIndex: false`, and the unnamed browse / rematch clocks. There is no model test today. Desk / rematch / Granot tests ask the services, not this export.

I would add a focused model file on that **interface**. I would not add helper-unit tests.

- constructing the default model uses `mongoose.models.BookingLeadReconciliationCase ?? mongoose.model(...)`
- there is **no** `getBookingLeadReconciliationCaseModel`
- already-recommended employee submit **asks** `new` + `save({ session })` and omits `origin` (default `"employee_booking"`)
- already-recommended Best Relocation leadless **asks** `create([...], { session })` with `origin: "external_sheet_ingestion"` / `reason: "no_match"`
- ordinary admin leadless does **not** insert
- Granot Owner Confirm does **not** insert
- a second `{ booking }` misses (unique)
- `submission.normalized_job_no` is **not** unique
- `reason` without a value refuses validate
- invented `origin` / `status` / `reason` refuse validate
- `revision` defaults to `0`; Owner desk CAS-es that field; rematch lease `findOneAndUpdate` does **not** bump it
- `optimisticConcurrency` stays on; `__v` is the mongoose `save` CAS
- boot creates the unique Booking clock plus the unnamed browse / rematch clocks; there is no migration
- already-recommended Granot persist / detail **ask** `findOne({ booking })` and do **not** import a getter
- Job Timeline does **not** hop this collection
- historical apply / verify treat `booking_lead_reconciliation_cases` as **not** a side-effect
- `schema-and-crud-inputs.mdc` does **not** name this collection; this pass does **not** rewrite that list
- leftover next `PublicSubmissionThrottleBucket` is a different collection; that file is out of this story
- already-recommended `GranotBookingReconciliationCase` / `LeadConversation` / `BookedLead` are different collections; those files are out of this story

I would not test leftover Owner 403, leftover matcher rules, leftover rematch delays, leftover Granot Confirm, leftover or Job Timeline assemble from this file.

Do not add a test per helper (`theBookingIsUnique`, `theOriginDefaultsToEmployeeBooking`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the interface.

## What I would not do

- A `BookingLeadReconciliationCaseService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `open.ts` / `resolve.ts` / `rematch.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit seam (submit / desk / rematch already remember Sheet Sync inside `runSheetSyncWrite` and finalize after commit — do not move those writes into this file so “the row owns book and attach”).
- Treating `submitEmployeeBooking` / `listBookingLeadReconciliationCases` / `resolveBookingLeadReconciliation` / `runDueBookingLeadRematches` / `createLeadlessBooking` / `attachBookingToLead` / `maybeReconcileBooking` as this story.
- Inventing a selected-database getter seam that has only the conversation / SMS getters as an adapter.
- Inventing an `autoIndex: false` + migration seam that has only the Granot Booking case as an adapter.
- Silently adding a getter, flipping `autoIndex` off, uniquing Job Number, dropping `revision`, dropping `optimisticConcurrency`, teaching rematch to bump `revision` on lease claim, teaching ordinary admin leadless or Granot Confirm to insert, rewriting Core Collections, teaching Job Timeline to hop this collection, or merging this into the Granot Booking case while recommending a rename.
- Pulling `submitEmployeeBooking`, `listBookingLeadReconciliationCases`, or `runDueBookingLeadRematches` into this file.
- Merging this collection into already-recommended `GranotBookingReconciliationCase`, already-recommended `LeadConversation`, leftover next `PublicSubmissionThrottleBucket`, already-recommended `BookedLead`, already-recommended `FormLead`, or already-recommended `CallLead`.
- Changing rematch lease to `deleteOne` so “we match the consent hash.”
- Dropping the default export in the same PR as the story names.
- Opening `validation/` or leftover next `PublicSubmissionThrottleBucket.ts` in the same PR.
- Starting OKF optimization or docs-keeper from this pass.
- Jumping to `PublicSubmissionThrottleBucket.ts` while writing this file.
