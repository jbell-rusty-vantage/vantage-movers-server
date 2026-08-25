# Write This Customer, Or Wipe Them And Their Bookings — operational story

- Status: recommended
- Service: `customers` (Wave A, in-progress)
- Pass: 1 of this service — `customer.service.ts`
- Remaining in this service: `customerFromLead.service.ts`
- Target: `src/services/customers/customer.service.ts`
- Knowledge: `docs/knowledge/services/customer.md` (HTTP CRUD + delete cascade; booking-time upsert is the sibling file). This checkout’s `CONTEXT.md` does not define Customer — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/v1.routes.ts` (`GET|POST|PATCH|DELETE /api/v1/customers` via leftover `handleFindAll` / `handleCreate` / `handleUpdate` / `handleDelete` — not the Booking canonical executor), `customers/index.ts` → `v1.service.ts`. Admin browse/search/export reads the `customers` collection itself (`adminBrowse.service.ts`) and does **not** import this file. Tests: none for this module (`customerFromLead.service.test.ts` is the sibling; Zod name-only create lives in `v1.validation.test.ts`).
- Seams callers need: leftover public write vs no command `begin` / `complete`; `cascade=true` query on wipe (route `handleDelete`); `deleteBookedLead` must stay a `v1.service` import so the bookings ↔ customers load-time cycle stays broken
- Split later (only if the file outgrows one sitting): `writeThisCustomerByHand.ts`, `wipeThisCustomerAndTheirBookings.ts` — never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this “HTTP CRUD: create, update, list, cascade delete.” The names agree: `createCustomer`, `updateCustomer`, `deleteCustomer`. Those are executor mechanics. The owner question is: *the Admin Dashboard can write a Customer by hand. Later it can wipe that row — but only if it also wipes every Booking that still points at them. Booking-time identity (phone / name upsert) is the other file. There is no domain-command adapter here.*

## What this file actually does

Four operations, not “a CRUD service,” and not Remember The Customer This Lead Names:

1. **Write this Customer by hand** — Admin (or a script) posts a name, optional phone, optional email. Zod already stripped unknown keys. `Customer.create` stores the body. It does **not** stamp `normalized_name`. Booking-time identity is not this write.
2. **Correct this Customer by hand** — patch name / phone / email. Missing id → 404. It does **not** recompute `normalized_name` when `full_name` changes.
3. **List recent Customers** — last 200, newest first. Admin browse is a different **adapter**.
4. **Wipe this Customer and the Bookings they own** — find Bookings whose `customer` is this id. Any Booking and `cascade` is false → 409. Otherwise, for each Booking, leftover `deleteBookedLead(bookingId, true)` through `v1.service` (that leftover path tombstones sheets, may erase a linked Cancellation, and takes the Booking off the Lead). Then erase the Customer. There is no customer Sheet Sync row.

Remember the Customer this Lead or Booking contact names is `customerFromLead.service.ts`. Booked-call-lead reconciliation’s `$setOnInsert` by phone is not this folder.

## Organization

Keep one file. This is the screenplay for “Admin wrote a Customer, or Admin wiped them.” Booking-time upsert, leftover Booking delete, and admin browse already live in deeper **modules**. Do not pull those in. Do not invent a `CustomerService` class. Do not invent a `begin` / `complete` **seam** — public `/customers` never entered the canonical executor.

If it later outgrows one sitting, split by **story** (hand write vs wipe), never CRUD. The hand write stays thin. Do not invent ingestion beats it does not have.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createCustomer` | `writeThisCustomerByHand` | leftover public POST; no command adapter |
| `updateCustomer` | `correctThisCustomerByHand` | leftover public PATCH; 404 if missing |
| `findAllCustomers` | `listRecentCustomers` | last 200; not admin browse |
| `deleteCustomer` | `wipeThisCustomerAndTheirBookings` | 409 unless cascade; leftover Booking delete per row |

Keep the old names as one-line aliases until `v1.routes.ts` and `v1.service.ts` migrate. Do not make callers learn “wipe” as a second HTTP verb.

**No class for the workflow.** A class here would be a folder with a constructor. No pending-handoff type earns a name. There is no after-commit bag: the leftover Booking delete already finalizes its own sheets before this file erases the Customer.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// customer.service.ts
// Admin can write a Customer by hand.
// Later Admin can wipe that row — but only if every
// Booking that still points at it comes off too.
// Booking-time identity (phone / name upsert) is
// the other file. There is no command adapter here.

// ── 1. Write this Customer by hand ────────────────────────

export async function writeThisCustomerByHand(input)
  // Customer.create(input) — does not stamp normalized_name

// ── 2. Correct this Customer by hand ──────────────────────

export async function correctThisCustomerByHand(id, patch)
  // findByIdAndUpdate; 404 if missing
  // does not recompute normalized_name

// ── 3. Lookup ─────────────────────────────────────────────

export async function listRecentCustomers()
  // last 200, newest first

// ── 4. Wipe this Customer and the Bookings they own ───────

export async function wipeThisCustomerAndTheirBookings(id, cascade)

async function findTheBookingsThatStillNameThisCustomer(id)
function refuseUnlessTheOwnerAskedToWipeTheBookingsToo(bookings, cascade)
  // 409: "Customer has bookings; pass cascade=true to delete dependents"
async function wipeEachBookingThroughTheLeftoverPath(bookings)
  // leftover deleteBookedLead(id, true) via v1.service
  // sequential; each Booking owns its own sheet finalize
async function eraseTheCustomer(id)
  // findByIdAndDelete — no 404 if the row is already gone
```

Read the wipe path out loud: *Find every Booking that still names this Customer. If any exist and the owner did not pass cascade, refuse. Otherwise wipe each Booking through the leftover Booking-delete path — that path may take a Cancellation and the Lead pointer with it, and it finalizes its own sheets — then erase the Customer. A missing Customer is a silent success after zero Bookings.*

That is the operation. `deleteCustomer` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Hand write does not participate in booking identity.** `writeThisCustomerByHand` / `correctThisCustomerByHand` never set `normalized_name`. Only `customerFromLead` upserts do. Knowledge already records this: a later name-only booking upsert can insert a **second** Customer for the same person. Rename so the gap is visible. Do **not** silently teach the HTTP write to stamp `normalized_name` “so both paths agree.”

2. **There is no command adapter.** `POST|PATCH|DELETE /api/v1/customers` still use leftover `handleCreate` / `handleUpdate` / `handleDelete`. Leads, Bookings, and Cancellations already moved mutating routes onto `runExisting*`. Do not invent `beginWritingThisCustomer` / `completeWipingThisCustomer` here, or silently route these verbs through `domainCommands`.

3. **Wipe is sequential, not one transaction.** Booking 1 is leftover-deleted (and its sheets finalized) before Booking 2 starts. If Booking 2 throws — leftover `deleteBookedLead` 404s a vanished row, or 409s a Booking that is not Referral / leadless and still lacks Lead refs — Booking 1 is already gone and the Customer row remains. Do not wrap the loop in `runSheetSyncWrite` “for safety” while renaming.

4. **Wipe calls leftover Booking delete, not the command.** `deleteBookedLead` from `v1.service` is the standalone / cascade-from-Lead path (`bookings-booked-lead.md`). It is not `deleteBookedLeadInTransaction` / `runExistingDeleteBookedLead`. Each Booking gets leftover queued tombstones + `finalizeSheetSyncDelete`, or leftover legacy inline sheet deletes. Do not switch the loop to the command adapter so “every delete goes through EntityChange.”

5. **The `v1.service` import is a load-bearing cycle break.** The comment in this file is the **seam**: `bookings/index` → booked-lead write → `customers/` barrel → this file. Form Lead / Call Lead cascade uses the same facade. Do not import `deleteBookedLead` from `bookings/` while renaming.

6. **Missing Customer on wipe is not 404.** `correctThisCustomerByHand` throws. `wipeThisCustomerAndTheirBookings` `findByIdAndDelete`s after the Booking loop and returns. A valid ObjectId with no row and no Bookings is HTTP 204. Do not silently add a 404 so wipe “matches correct.”

7. **Testimonials are not dependents.** The Customer model has a `testimonials` virtual. Wipe does not touch them. Admin detail loads related Bookings and Cancellations (limit 25), not testimonials. Do not cascade testimonials so the wipe “feels complete.”

8. **This file does not sync a Customer sheet.** There is no customer projection. Sheet work happens only inside leftover Booking delete (Booking row, optional Cancellation row, surviving Lead). Do not enqueue a customer job from wipe.

9. **Phone is stored as typed.** Schema trims. There is no unique phone index and no E.164. Two hand-written rows may share a phone; a later upsert keyed by that exact string will attach to one of them. Do not normalize phone here so it “matches Lead matching.”

10. **Leave the sibling upsert alone.** `upsertCustomerFromLead` / `upsertCustomerFromBookingContact` stay in `customerFromLead.service.ts` so they never import the booking lifecycle. Do not move them into this file “because it is the Customer service.”

11. **Admin browse is not list.** `GET /api/v1/admin/customers` goes through `adminBrowse.service.ts` (scope, sort, `q` on `normalized_name`). `listRecentCustomers` is the leftover public 200. Do not teach list the admin query.

12. **Do not treat booked-call-lead reconciliation as this story.** That path `findOneAndUpdate`s by phone with `$setOnInsert` only. Knowledge already separates it.

## Testing

The **interface** is the test surface: `writeThisCustomerByHand`, `correctThisCustomerByHand`, `listRecentCustomers`, `wipeThisCustomerAndTheirBookings`.

There is no `customer.service.test.ts`. That is not enough for the wipe story. Add tests that name the operation. Do not add a test per helper.

**Write this Customer by hand**
- Persists `full_name`, optional `phone_number`, optional `email`.
- Does **not** write `normalized_name` (lock the gap). Do not “fix” the write so the assertion can expect a stamp.
- Unknown keys never reach this function (Zod). Do not re-test the schema here beyond what `v1.validation.test.ts` already locks (name-only create).

**Correct this Customer by hand**
- Missing id → 404.
- `full_name` patch does **not** recompute `normalized_name`.
- Booking and Lead refs are not fields on this document — they stay untouched because they do not exist here.

**List recent Customers**
- Last 200, newest `createdAt` first.

**Wipe this Customer and the Bookings they own**
- No Bookings → Customer erased. Missing Customer + no Bookings → no throw (204 at the route).
- One or more Bookings and `cascade === false` → 409, **no** Booking delete, Customer remains.
- `cascade === true` → leftover `deleteBookedLead(id, true)` once per Booking, in find order, **then** `findByIdAndDelete`. Stub the facade; do not re-test Booking-delete tombstones, Lead take-off, or Cancellation cascade here.
- A later Booking that 409s (missing Lead metadata, not Referral / leadless) leaves earlier Bookings already wiped and the Customer still present. Lock that until a separate change.
- Testimonials hanging off the Customer survive.

Do **not** add a test per helper (`refuseUnlessTheOwnerAskedToWipeTheBookingsToo`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test `upsertCustomerFromLead` match keys, leftover `deleteBookedLead` queued vs legacy sheets, or admin browse `q` here.

## What I would not do

- A `CustomerService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Customer.create` or `findByIdAndUpdate`.
- Moving this into a CRUD folder “for cleanliness.”
- Inventing a before-commit / after-commit **seam** this public path does not have.
- Teaching hand write to stamp `normalized_name`, or teaching wipe to 404 a missing row, so the names “feel honest.”
- Importing `deleteBookedLead` from `bookings/` and recreating the load-time cycle.
- Routing `/customers` through `domainCommands` in this rename.
- Pulling `customerFromLead.service.ts`, admin browse, or booked-call-lead reconciliation into this file.
- Cascading testimonials, or enqueueing a customer Sheet Sync job that does not exist.
- Writing a whole-folder `customers` recommendation in this pass.
