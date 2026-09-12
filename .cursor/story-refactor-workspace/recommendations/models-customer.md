# Remember The Customer Row, Keep Phone And Folded Name Browse-Indexed But Never Unique So Booking-Time Upsert Elects The Match, And Register Inverse Virtuals For Bookings Cancellations And Testimonials — Never Upsert Or Stamp Folded Name Here, Never Invent A Selected-Database Getter, Never Copy Booking AutoIndex-False Onto This Support Row Without A Migration — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 5 of this service — `Customer.ts`
- Remaining in this service: `Agent.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/Customer.ts`
- Knowledge: [`docs/knowledge/services/customer.md`](../../../docs/knowledge/services/customer.md) (System of Record is Mongo `customers`. Bookings reference a Customer via `BookedLead.customer`. Customers are **not** created from Form Lead or Call Lead Ingestion alone — linkage happens during Booking, or Admin writes the row by hand. Knowledge resource list names the customer services, not this file — do not add a Models Service file in this rename so “the Service sentence wins”). Knowledge also says virtuals `booked_leads` / `cancelled_leads` “populate from admin detail.” Leftover `adminBrowse.appendDetailRelations` does **not** populate those virtuals — it `find`s `booked_leads` / `cancelled_leads` by `{ customer: id }` and paints `related_bookings` / `related_cancellations`. Do not silently change leftover admin so “the knowledge sentence becomes true.” Distinct from already-recommended hand-write / wipe: [customers-customer.md](customers-customer.md) (`writeThisCustomerByHand` / `wipeThisCustomerAndTheirBookings` — **this file never wipes Bookings**, never imports leftover `deleteBookedLead`). Distinct from already-recommended booking-time identity: [customers-customer-from-lead.md](customers-customer-from-lead.md) (`rememberTheCustomerThisLeadNames` / `rememberTheCustomerThisBookingContactNames` — **this file never upserts**, never stamps `normalized_name`). Distinct from already-recommended booked-call-lead recon: [reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md) (`Customer.findOneAndUpdate` by phone with `$setOnInsert` only — **not this file**). Distinct from already-recommended Booking / Cancellation rows: [models-booked-lead.md](models-booked-lead.md), [models-cancelled-lead.md](models-cancelled-lead.md) (those files set `autoIndex: false` and named catalogs — **do not copy that fence here** so “every core row matches Booking”). Distinct from already-recommended Form / Call rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md) (those files have selected-database getters — **do not invent `getCustomerModel` so “Customer matches Form”**). Distinct from leftover historical relax: `historical/Customer.ts` (`registerHistoricalCustomer` on `vantagemovershistorical`; `full_name` not required; **no** `testimonials` virtual; no `getCustomerModel`). Distinct from leftover next Agent row: `Agent.ts`. Distinct from leftover Sheet Sync register: `sheetSync/drainer/jobPlanner.ts` (side-effect `import "../../../models/Customer"` so leftover `populate("customer")` on a Booking can resolve — **this file never projects a sheet**). Distinct from already-recommended testimonials: [testimonials-testimonial.md](testimonials-testimonial.md) (owner list populates `Testimonial.customer` forward — Customer wipe does **not** cascade Testimonials). Distinct from leftover CONTRADICTIONS: a name-only remember then a later remember of the same display name **with** a phone inserts a second Customer — that is the booking-time match key, not a unique phone on this schema. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Customer](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); this checkout does **not** define Customer — do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows.
- Callers: **default-connection model only — there is no `getCustomerModel`.** Already-recommended `customers/customer.service.ts` **asks** default `Customer` for `create` / `findByIdAndUpdate` / last-200 `find` / `findByIdAndDelete`. Already-recommended `customers/customerFromLead.service.ts` **asks** default `Customer.findOneAndUpdate` (phone else `normalized_name`, upsert). Already-recommended `reconciliation/bookedCallLeadReconciliation.service.ts` **asks** default `Customer.findOneAndUpdate` (`$setOnInsert` by phone) and `Customer.findOne({ phone_number })`. Leftover `admin/adminScope.service.ts` **asks** default `Customer` for the non-historical scope and leftover `registerHistoricalCustomer` for historical. Leftover `historicalConsolidation/schemaValidation.ts` **asks** default `Customer` to `validateSync` a planned insert. Leftover `sheetSync/drainer/jobPlanner.ts` **asks** the side-effect import so `mongoose.models.Customer` exists before leftover Booking `populate("customer")`. `customerFromLead.service.test.ts` and leftover `v1.service.test.ts` stub `Customer.findOneAndUpdate`. `jobPlanner.test.ts` **asks** `mongoose.models.Customer` after the planner module loads. There is no `Customer.test.ts`. Not this **interface**: `writeThisCustomerByHand` itself, `rememberTheCustomerThisLeadNames` itself, leftover recon `$setOnInsert` itself, leftover admin related-booking `find`, leftover `registerHistoricalCustomer` itself.
- Seams callers need: default `Customer` (first-registered connection — **including already-recommended hand-write, leftover booking-time upsert, leftover recon, leftover admin non-historical scope, leftover historical-consolidation validate**) vs leftover `registerHistoricalCustomer` (second **adapter** on `vantagemovershistorical` — that file, not a getter on this one); field-level browse indexes (`normalized_name`, `phone_number`, `email`) vs no unique phone / name / email; schema `lowercase` on `normalized_name` / `email` **when those paths are set** vs leftover booking-time fold that invents `normalized_name` from `full_name`; inverse virtuals (`booked_leads`, `cancelled_leads`, `testimonials`) vs leftover admin detail that queries Booking / Cancellation collections itself; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Lead-mirror **seam**. There is no selected-database getter **seam**.
- Split later (only if the file outgrows one sitting): this ~43-line file is one sitting if you read it as remember the Customer row, keep phone and folded name browse-indexed but never unique so booking-time upsert elects the match, and register inverse virtuals for Bookings / Cancellations / Testimonials — never upsert or stamp folded name here, never invent a selected-database getter, never copy Booking autoIndex-false onto this support row without a migration. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `virtuals.ts`. Hand-write / wipe stay already-recommended `customer.service.ts`. Booking-time identity stays already-recommended `customerFromLead.service.ts`. Historical relax stays leftover `historical/Customer.ts`. Next Agent row stays leftover `Agent.ts`.

`Customer` is a Mongoose model name. The owner question is: *A Booking just remembered who this job is for — or Admin wrote a Customer by hand. Hold the row on `customers`. Keep phone, folded name, and email browse-indexed so the next Booking can find the same person, and never make those unique so booking-time upsert elects the match. Register inverse virtuals so a populate can walk this Customer’s Bookings, Cancellations, and Testimonials. If this process selected a different Mongo database, today’s live callers still use the default connection — do not invent a getter in this rename. Do not upsert. Do not stamp folded name on validate. Do not wipe Bookings. Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who write by hand / wipe already lives in already-recommended `customer.service.ts`. Who remember the Customer this Lead or Booking contact names already lives in already-recommended `customerFromLead.service.ts`. Who `$setOnInsert` by phone on booked-call-lead recon already lives in already-recommended `bookedCallLeadReconciliation.service.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Customer row, keep phone and folded name browse-indexed but never unique so booking-time upsert elects the match, and register inverse virtuals” story, not “a Customer model CRUD dump,” and not Write This Customer By Hand / Remember The Customer This Lead Names themselves:

1. **Hold the Customer as the System of Record row** — collection `customers`, timestamps, `toJSON` / `toObject` virtuals. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** revision catalog. **No** `sheet_sync[]`. **No** Ingestion Origin. Declares required `full_name` (trim), optional `normalized_name` (trim, schema `lowercase`, field index), optional `phone_number` (trim, field index), optional `email` (trim, schema `lowercase`, field index). This beat does **not** invent `normalized_name` from `full_name`. This beat does **not** fold phone to E.164. This beat does **not** refuse a missing phone. A Booking may still proceed without a Customer when leftover booking-time identity walks away.

2. **Keep phone, folded name, and email browse-indexed and never unique** — three field-level `{ index: true }` paths. None are unique. None are named catalogs. None have a leftover `pnpm migration:*` apply path. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those browse indexes on boot — that is today’s contract, not a missing Booking copy. Already-recommended booking-time identity elects `findOneAndUpdate({ phone_number })` when a trimmed phone is present, else `{ normalized_name }`. Hand-write `Customer.create(input)` may leave `normalized_name` empty; a later name-only remember can then insert a **second** row for the same display name. This beat does **not** unique-index phone so “one person per typed string.” This beat does **not** unique-index `normalized_name` so “one person per lowercase name.”

3. **Register inverse virtuals for Bookings, Cancellations, and Testimonials** — `booked_leads` (`BookedLead.customer`), `cancelled_leads` (`CancelledLead.customer`), `testimonials` (`Testimonial.customer`). Leftover Sheet Sync populate walks the **forward** Booking → Customer pointer and needs this model registered. Leftover owner testimonials populate walks the **forward** Testimonial → Customer pointer. Leftover admin Customer detail does **not** populate these virtuals. Leftover historical Customer drops the `testimonials` virtual. This beat does **not** cascade wipe Testimonials. This beat does **not** cascade wipe Bookings.

`CustomerDocument` is the inferred row type. There is no selected-database getter. There is no unknown-state sentinel here. There is no named index export.

There is no write-this-Customer-by-hand operation. Already-recommended `customer.service.ts` elects that. There is no historical-relax operation. Leftover `historical/Customer.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the Customer row, keep phone and folded name browse-indexed but never unique so booking-time upsert elects the match, and register inverse virtuals for Bookings / Cancellations / Testimonials — never upsert or stamp folded name here, never invent a selected-database getter, never copy Booking autoIndex-false onto this support row without a migration.” Already-recommended hand-write / wipe / booking-time identity / recon `$setOnInsert` already live in deeper **modules**. Leftover historical relax already lives in a sibling **module**. Do not pull those in. Do not invent a `CustomerModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `getCustomerModel` **adapter** so “Customer matches Form” without a paired proof that already-recommended hand-write, leftover booking-time upsert, leftover recon, leftover admin non-historical scope, and leftover historical-consolidation validate still read the same `customers`. Do not invent an `autoIndex: false` **adapter** so “Customer matches Booking” without a reviewed index migration. Do not invent a unique `{ phone_number: 1 }` **adapter** so “one Customer per phone lives on the schema.” Do not invent a `pre("validate")` that stamps `normalized_name` so “hand-write matches upsert” — that silently “fixes” the already-recorded hand-write gap. Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `virtuals.ts` / `normalize.ts` each get a file.

Do not move leftover `normalizeCustomerName` into this file so “the row owns the fold.” Do not merge this file into leftover `historical/Customer.ts` so “one schema owns the live row and the historical relax.” Do not merge this file into leftover next `Agent.ts` so “one support collection owns people.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `Customer` | `customerOnTheDefaultConnection` | already-recommended hand-write, leftover booking-time upsert, leftover recon, leftover admin non-historical scope still import the default model |
| `CustomerDocument` | `CustomerRow` | inferred document + `_id` |

Keep the old names as one-line aliases until `customer.service.ts`, leftover `customerFromLead.service.ts`, leftover recon, leftover admin scope, leftover jobPlanner register, and leftover historical-consolidation validate migrate. Do not make callers learn `normalized_name` / `index: true` as the domain language. Do **not** add `getCustomerModel` so “every aggregate has a getter” — live writes already share one default **adapter**; historical is leftover `registerHistoricalCustomer` on a different file. Do **not** delete the default `Customer` export so “everyone must call a getter that does not exist.” Do **not** export a named unique-phone catalog that this schema does not have.

**No class for the workflow.** The one type that *does* earn a name is the pending identity-browse contract:

```ts
type CustomerIdentityBrowseIndexes = {
  normalized_name: { unique: false }
  phone_number: { unique: false }
  email: { unique: false }
}
```

That is the handoff from “this process remembered a person” to “the next Booking can find them by typed phone or folded name without the schema electing one row.” Do **not** add `{ unique: true }` onto that type so “Customer matches Booking’s one-official-per-Job unique.” Do **not** add `full_name` onto that type so “display name is a match key.”

Leave leftover `registerHistoricalCustomer` on leftover `historical/Customer.ts`. Leave already-recommended `BookedLead` / `CancelledLead` on those files. Leave leftover next `Agent.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// Customer.ts
// A Booking just remembered who this job is for —
// or Admin wrote a Customer by hand.
// Hold the row on customers.
// Keep phone, folded name, and email browse-indexed
// so the next Booking can find the same person,
// and never make those unique
// so booking-time upsert elects the match.
// Register inverse virtuals so a populate can walk
// this Customer's Bookings, Cancellations, and Testimonials.
// Today's live callers still use the default connection —
// do not invent a selected-database getter in this rename.
// Do not upsert.
// Do not stamp folded name on validate.
// Do not wipe Bookings.
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const customerOnTheDefaultConnection =
  mongoose.models.Customer ?? mongoose.model("Customer", customerSchema)

export { customerOnTheDefaultConnection as Customer }

// ── 1. Hold the Customer as the System of Record row ─────

const customerSchema = rememberTheCustomerRow() // collection customers; default autoIndex; no revision

function rememberTheCustomerRow() {
  const schema = new Schema(
    {
      full_name: requiredTrimmedName(),
      normalized_name: optionalFoldedName(),          // lowercase when set; not invented from full_name
      phone_number: optionalTypedPhone(),             // stored as submitted; not E.164
      email: optionalLowercasedEmail(),               // lowercase when set
    },
    { collection: "customers", timestamps: true },
  )
  keepIdentityBrowseIndexesNeverUnique(schema)
  registerInverseBookingCancellationAndTestimonialVirtuals(schema)
  return schema
}

// ── 2. Identity browse indexes — never unique ────────────

function keepIdentityBrowseIndexesNeverUnique(schema) {
  // today's field-level index: true on normalized_name / phone_number / email
  // no unique, no named catalog, no leftover migration export
}

// ── 3. Inverse virtuals ───────────────────────────────────

function registerInverseBookingCancellationAndTestimonialVirtuals(schema) {
  schema.virtual("booked_leads", { ref: "BookedLead", localField: "_id", foreignField: "customer" })
  schema.virtual("cancelled_leads", { ref: "CancelledLead", localField: "_id", foreignField: "customer" })
  schema.virtual("testimonials", { ref: "Testimonial", localField: "_id", foreignField: "customer" })
}
```

Read the primary path out loud: *hold the Customer on `customers` with a required display name and optional typed phone, folded name, and email. Do not invent the folded name on validate. Keep those three identity paths browse-indexed and never unique so leftover booking-time upsert can elect the match, and so two hand-written rows may still share a phone. Register inverse virtuals so leftover Booking populate and leftover owner testimonials can resolve this model. If this process already sits on the first-registered connection, that is the model leftover hand-write and leftover upsert already import. Historical is the other file. Do not upsert. Do not wipe. Do not make phone unique.*

That is the operation. An unnamed schema dump is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **There is no validate hook — and that is today’s contract, not a missing Form-Lead copy.** Already-recommended hand-write `Customer.create(input)` does **not** stamp `normalized_name`. Schema `lowercase` only folds the path when a caller set it. Do not add `pre("validate")` `stampTheFoldedNameFromDisplay` so “hand-write matches upsert” — leftover `customer.md` already names that gap, and a silent stamp would change who a later name-only remember finds. Do not copy Form Lead’s lid / phone / Job fold onto this hook.

2. **There is no selected-database getter — and that is today’s contract.** Already-recommended hand-write, leftover booking-time upsert, leftover recon, leftover admin non-historical scope, leftover historical-consolidation validate **ask** default `Customer`. Historical **asks** leftover `registerHistoricalCustomer`. Do not silently add `getCustomerModel` in this rename so “every aggregate matches Form” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database **and** that leftover upsert still finds the same rows. Do not move leftover historical-consolidation’s `Customer` validate onto a new getter in the same pass as this rename.

3. **Phone / folded name / email are browse, and they are not unique.** Several leftover hand-written rows may share a typed phone. Leftover booking-time identity elects `findOneAndUpdate` and will attach the first match. Do not flip `{ unique: true }` on `phone_number` so “one Customer per phone lives on the schema.” Do not unique-index `normalized_name` so “one Customer per lowercase name.” Do not drop the field indexes so “upsert scans the collection.”

4. **Typed phone is the submitted string, not E.164.** Leftover `customerFromLead.service.test.ts` already names `"(240) 555-0199"` as the match key. Do not teach this schema to fold phone on validate so “Customer matches Call Lead.” Call Lead’s leftover `normalizePhoneNumber` stays on that file.

5. **Inverse virtuals are not leftover admin detail.** Knowledge says they populate from admin detail. Leftover `appendDetailRelations` queries Booking / Cancellation collections by `{ customer: id }` (limit 25) and never `populate("booked_leads")`. Leftover wipe **asks** `BookedLead.find({ customer: id })`, not the virtual. Do not change leftover admin to use the virtuals so “the knowledge sentence becomes true.” Do not delete the virtuals so “nobody populates them” — leftover Booking `populate("customer")` still needs this model registered, and a later owner desk may walk the inverse.

6. **`testimonials` is live-only.** Leftover historical Customer drops that virtual. Already-recommended testimonials owner list populates the forward pointer. Customer wipe does **not** cascade Testimonials. Do not add the virtual onto leftover `historical/Customer.ts` so “historical matches live.” Do not cascade Testimonials from leftover wipe in this rename.

7. **Default `autoIndex` is today’s contract.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed leftover migrations. This file does neither. Do not silently set `autoIndex: false` so “Customer matches Booking” without a paired report that boot still creates the three browse indexes **or** that a leftover migration will. Do not invent `CUSTOMER_PHONE_INDEX` so “every support row has a named catalog.”

8. **No revision, no `__v` optimistic concurrency, no `sheet_sync`.** A Customer is not a Lead and not a Booking. Do not spread leftover `aggregateRevisionSchemaFields` so “every SoR row matches Form.” Do not enable `optimisticConcurrency` so “Customer matches Booking.” Do not add `sheet_sync[]` so “Customer can project” — there is no customer Sheet Sync row.

9. **Leave sibling modules alone.** Hand-write / wipe, booking-time identity, recon `$setOnInsert`, leftover admin related-booking find, leftover historical relax, leftover jobPlanner register, and the Booking / Cancellation / Testimonial rows are already the right **depth**. This file holds the Customer row.

## Testing

The **interface** is the test surface: `Customer` validate, the three identity browse indexes.

There is no `Customer.test.ts`. Today’s proofs sit on leftover callers: `customerFromLead.service.test.ts` stubs `findOneAndUpdate` for typed-phone vs folded-name match; leftover `v1.service.test.ts` stubs the same for Lead-correction retarget; leftover `jobPlanner.test.ts` names `mongoose.models.Customer` after the planner loads. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new Customer requires `full_name`.
- A row with no `phone_number`, no `email`, and no `normalized_name` still validates.
- Validate does **not** invent `normalized_name` from `full_name`.
- There is no `getCustomerModel` export.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.

**Identity browse indexes — never unique**
- `normalized_name`, `phone_number`, and `email` are indexed.
- None of those paths are unique.
- There is no named unique-phone catalog export.

**Inverse virtuals**
- `booked_leads`, `cancelled_leads`, and `testimonials` are virtuals on the live schema.
- Leftover historical Customer still has no `testimonials` virtual (prove that on leftover `historical/Customer.ts`, not by merging the files).

Do **not** add a test per helper (`requiredTrimmedName`, `optionalTypedPhone`). Those names exist so the parent reads. Do **not** HTTP hand-write / wipe from this file’s tests. Do **not** upsert from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the browse indexes.” Do **not** open a Booking or wipe cascade from this file’s tests.

There is no named index export to keep for a second leftover migration **adapter** — this file has none.

## What I would not do

- A `CustomerModelService` / `CustomerService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.virtual`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `virtuals.ts` / `normalize.ts` split for cleanliness.
- Breaking the default-connection **seam** by inventing `getCustomerModel` without a paired proof. Leftover upsert must not write live `customers` while `TEST_MODE` selected `testvantagemovers` — and today’s write already uses the default, not a getter.
- Treating already-recommended `writeThisCustomerByHand` / `wipeThisCustomerAndTheirBookings` as this story. Those services own hand-write and leftover Booking cascade.
- Treating already-recommended `rememberTheCustomerThisLeadNames` / `rememberTheCustomerThisBookingContactNames` as this story. Those functions own the match key and the `session`.
- Treating already-recommended booked-call-lead recon `$setOnInsert` as this story.
- Treating leftover `historical/Customer.ts` as this story. That row does not require `full_name` and has no Testimonials virtual.
- Treating leftover next `Agent.ts` as this story.
- Inventing a unique phone **seam** so “one Customer per typed string.”
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database **seam** that has only one live **adapter**.
- Silently stamping `normalized_name` on validate so “hand-write matches upsert.”
- Silently folding phone to E.164 so “Customer matches Call Lead.”
- Silently enabling `optimisticConcurrency` or leftover revision fields so “Customer matches Booking.”
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
