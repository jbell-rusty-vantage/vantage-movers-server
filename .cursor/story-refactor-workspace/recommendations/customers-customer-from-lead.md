# Remember The Customer This Lead Or Booking Contact Names — operational story

- Status: recommended
- Service: `customers` (Wave A, visited)
- Pass: 2 of this service — `customerFromLead.service.ts`
- Remaining in this service: none — `index.ts` already skipped
- Target: `src/services/customers/customerFromLead.service.ts`
- Knowledge: `docs/knowledge/services/customer.md` (booking-time upsert + match key; HTTP hand-write is the sibling file). Booking callers are also in `docs/knowledge/services/bookings.md` (step 4 of Book This Lead; Referral / Leadless contact). Recon `$setOnInsert` is `docs/knowledge/services/booked-call-lead-reconciliation.md`. This checkout’s `CONTEXT.md` does not define Customer — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `bookedLead.service.ts` (name override → booking-contact adapter, else Lead adapter, inside the Booking write), `bookingMirror.service.ts` (`refreshAttachedBookingFromLead` re-upserts from the Lead and may retarget `booking.customer`), `referralBooking.service.ts` (leftover + in-transaction), `leadlessBooking.service.ts` (skips the call when name is blank), `employeeBookings/submitEmployeeBooking.service.ts`, `employeeBookings/bookingLeadReconciliation.service.ts` (attach / patch). Barrel: `customers/index.ts`. Tests: `customerFromLead.service.test.ts` (filter stubs only).
- Seams callers need: optional `session` so this write sits inside the Booking transaction; `undefined` when there is no usable name so the Booking can still go through without a Customer; Lead adapter vs Booking-contact adapter of the same match key; this file must not import the booking lifecycle
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this “upsert helpers.” The names agree: `upsertCustomerFromLead`, `upsertCustomerFromBookingContact`. Those are executor mechanics. The owner question is: *we are booking a job. Remember the Customer that Lead or Booking form names. No name means the Booking still happens without a Customer. The same typed phone is the same person; otherwise the same lowercase name is. Do this in the Booking write so we do not leave a Customer without the Booking that asked for them.*

Admin hand-write / wipe is `customer.service.ts`. Booked-call-lead reconciliation’s `$setOnInsert` by phone is not this file.

## What this file actually does

Two operations, not “an upsert helper,” and not Write This Customer By Hand:

1. **Remember the Customer this Lead names** — Book This Lead (no name override) and later Lead correction (`refreshAttachedBookingFromLead`) take the Lead’s `name` / `phone_number` / `email`. No trimmed name → return `undefined`; the Booking may still be created or refreshed without `customer`. Otherwise match by trimmed phone when present, else by `normalized_name`. Upsert. Stamp `normalized_name`. Return the live row so the Booking can point at it.
2. **Remember the Customer this Booking contact names** — Book This Lead (name override), Referral, Leadless, employee submit, and employee attach / patch take the submitted `customer_name`. Phone: form first, then the linked Lead. Email: form first, then the Lead. Blank name → `undefined` (Leadless skips the call; Referral’s name is required upstream). Same match key as the Lead adapter.

There is no public HTTP path here. There is no command `begin` / `complete`. The **seam** is the optional Mongo `session` the Booking write already holds.

## Organization

Keep one file. This is the screenplay for “who is this Booking’s Customer.” Admin hand-write, leftover Booking delete, Lead display Name, Lead phone matching, and booked-call-lead reconciliation already live in deeper **modules**. Do not pull those in. Do not invent a `CustomerFromLeadService` class. Do not invent a `begin` / `complete` **seam** — callers already own the transaction.

Do not split this 110-line file. Lead vs Booking contact are two **adapters** of one remember-the-Customer story, not two folders. The barrel comment is the load-bearing reason they stay here: booking-time identity must not import the booking lifecycle.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `upsertCustomerFromLead` | `rememberTheCustomerThisLeadNames` | Book This Lead (no override) + Lead correction retarget — identity from the Lead |
| `upsertCustomerFromBookingContact` | `rememberTheCustomerThisBookingContactNames` | override / Referral / Leadless / employee — identity from the form, phone/email may fall back to the Lead |

Keep the old names as one-line aliases until Book This Lead, the mirror, Referral, Leadless, and employee submit / attach migrate. Do not make callers learn `upsert` as the domain language.

**No class for the workflow.** The one type that *does* earn a name is the bag both adapters already build before the shared write:

```ts
type CustomerRememberedAtBooking = {
  full_name: string
  normalized_name: string
  phone_number?: string
  email?: string
}
```

That is the handoff from “here is the name and the match key” to “find or insert the Customer on that key.” There is no after-commit bag: the Booking write finalizes its own sheets.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// customerFromLead.service.ts
// We are booking a job.
// Remember the Customer that Lead or Booking form names.
// No name means the Booking still happens without a Customer.
// The same typed phone is the same person.
// Otherwise the same lowercase name is.
// Admin hand-write is the other file.
// Recon $setOnInsert is not this file.

// ── 1. Remember the Customer this Lead names ──────────────

export async function rememberTheCustomerThisLeadNames(lead, session?)
  // no trimmed name → undefined (Booking proceeds)
  // else take lead.name / phone / email

// ── 2. Remember the Customer this Booking contact names ───

export async function rememberTheCustomerThisBookingContactNames(input, session?)
  // no trimmed customer_name → undefined
  // phone: form then Lead
  // email: form then Lead

// ── shared write (not a third operation) ──────────────────

function foldTheNameForMatch(fullName)                 // trim + lowercase
function assembleTheCustomerWeWillRemember(input)      // stamps normalized_name; email only when truthy
async function writeTheCustomerOnTheMatchKey(assembled, session)
  // phone present → findOneAndUpdate({ phone_number })
  // else → findOneAndUpdate({ normalized_name })
  // upsert, return after, setDefaultsOnInsert, orFail
```

Read the remember path out loud: *If they gave us no name, walk away — the Booking still happens. If they gave us a phone, that typed string is the person; write the name and the folded name onto that row. If they gave us no phone, the lowercase name is the person. Do this on the Booking’s session so the Customer and the Booking commit together.*

That is the operation. `upsertCustomerFromLead` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The two writes are the same story copied twice.** Both adapters build a bag and then paste the same `if (phone) findOneAndUpdate(phone) else findOneAndUpdate(normalized_name)` block, including `orFail`. One `writeTheCustomerOnTheMatchKey`. Do not split the file so each adapter “owns its upsert.”

2. **Phone is the typed string, not Lead phone matching.** Tests lock `"(240) 555-0199"` as the filter. Schema trims; this file does not E.164. `2405550199` and `(240) 555-0199` are two people. Do not call `leadPhoneMatching.ts` so “Customer match agrees with Call Lead match.”

3. **Phone match retitles the Customer.** A later Booking with the same typed phone and a different name overwrites `full_name` and `normalized_name`. Bookings that already point at that id keep the new display name on populate; their denormalized `customer_name` may stay old. Do not switch the write to `$setOnInsert` so it “matches recon” and stops retitling.

4. **Name-only then same person with a phone is a second row.** First remember by `normalized_name` (no phone). Later remember with a phone matches by phone, misses, inserts. The inverse of the HTTP gap in `customers-customer.md`. Lock it. Do not silently also match by name when a phone is present “so Jane stays one Customer.”

5. **Hand-write still does not stamp `normalized_name`.** Only this file writes it. A leftover `POST /customers` Jane plus a later name-only remember can insert a second Jane. Knowledge already records this. Do not teach `writeThisCustomerByHand` to stamp from this rename, and do not make this file refuse to insert when a nameless `normalized_name` already exists.

6. **Email is stored and indexed, never a match key.** `assembleTheCustomerWeWillRemember` only sets email when truthy (trim + lowercase). A blank form email does not clear a stored email. Do not add email as a third match key, and do not `$unset` email so “blank means clear.”

7. **Most callers never pass `customer_email`.** Book This Lead’s override path sends `customer_name`, `customer_phone`, and the Lead — booking Zod has no `customer_email`. Referral and Leadless send name + phone. Employee submit sends `prepared.leadName` + phone. Only employee attach / patch forwards `prepared.email`. Do not start threading a booking-form email through Book This Lead in this rename.

8. **Book This Lead override does not fall back to the Lead’s name.** Blank override is not an empty string to this file — the caller picks the Lead adapter instead. The Booking-contact adapter given a blank name returns `undefined` even if `input.lead.name` is set. Leadless skips the call when name is blank; phone alone does not create a Customer (`bookings-leadless-booking.md`). Do not remember from the Lead name inside the contact adapter so “override and Leadless agree.”

9. **`orFail` after an upsert is leftover caution.** `findOneAndUpdate` + `upsert` + `returnDocument: "after"` should always yield a row. Do not delete `orFail` “because upsert cannot miss” without a test that names the failure, and do not wrap the write in a retry.

10. **There is no unique phone index.** The schema indexes `phone_number` and `normalized_name`; neither is unique. Two concurrent remembers with the same phone can insert two Customers. Do not add a unique index in this rename.

11. **The session is the only transaction seam.** Callers pass the Booking `session` so Customer and Booking commit together. There is no `beginRemembering` / `completeRemembering`. Do not invent a command adapter, and do not move this write after commit “so Customer is a side effect.”

12. **This file must not import bookings.** The barrel comment is the cycle break: `bookings` → this file. Wipe goes the other way through `v1.service`. Do not import `bookedLead.service.ts` from here “to set `booking.customer`.”

13. **Lead correction may retarget `booking.customer`.** `refreshAttachedBookingFromLead` re-runs the Lead adapter and, when the id changes, writes `booking.customer`. A Lead name/phone edit can detach the Booking from the Customer the original book remembered. Do not make the mirror keep the old id so “the Booking stays on the first Customer.”

14. **Leave recon `$setOnInsert` alone.** Booked-call-lead reconciliation `findOneAndUpdate`s by phone and never overwrites an existing name. Knowledge already separates it. Do not route recon through this file so “every Customer write is one story.”

15. **Leave the sibling hand-write alone.** `writeThisCustomerByHand` / `wipeThisCustomerAndTheirBookings` stay in `customer.service.ts`. Do not move them here “because it is the Customer folder.”

## Testing

The **interface** is the test surface: `rememberTheCustomerThisLeadNames`, `rememberTheCustomerThisBookingContactNames`.

Today’s `customerFromLead.service.test.ts` only stubs `findOneAndUpdate` and asserts the filter (phone, lead-phone fallback, normalized name, name-only Lead). That is not enough for the remember story. Replace the stub style with tests that name the operation. Do not add a test per helper.

**Remember the Customer this Lead names**
- No trimmed `name` → `undefined`, **no** `findOneAndUpdate`.
- Name only → match `{ normalized_name }`, stamp `normalized_name` from the trimmed display name, persist `full_name`.
- Phone present → match `{ phone_number }` as the **trimmed typed string**, not E.164. Lock `"(240) 555-0199"` ≠ `"2405550199"`.
- Email set only when the Lead’s email is truthy; stored lowercased.
- Same typed phone, later different name → the existing row’s `full_name` / `normalized_name` are overwritten (lock the retitle).
- Name-only remember, then a later remember of the same display name **with** a phone → second row (phone key misses). Do not “fix” the write so the assertion can expect one Customer.
- Optional `session` is forwarded on the write.

**Remember the Customer this Booking contact names**
- Blank `customer_name` → `undefined`, **no** write, even if `lead.name` is set.
- `customer_phone` wins over `lead.phone_number`.
- Blank / missing customer phone falls back to the Lead phone (existing test).
- `customer_email` wins over Lead email when passed; otherwise Lead email. Employee attach is the caller that passes email — do not re-test attach here.
- Same match key as the Lead adapter (phone, else `normalized_name`).
- Optional `session` is forwarded.

Do **not** add a test per helper (`foldTheNameForMatch`, `writeTheCustomerOnTheMatchKey`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test Book This Lead override vs Lead adapter choice, leftover wipe, admin browse `q`, or recon `$setOnInsert`.

## What I would not do

- A `CustomerFromLeadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `findOneAndUpdate`.
- Moving this into a CRUD folder “for cleanliness.”
- Inventing a before-commit / after-commit **seam** this helper does not own.
- Calling Lead phone matching, or adding email as a match key, so identity “feels complete.”
- Teaching the phone write to also match by name, or switching it to `$setOnInsert`, so Jane stays one row.
- Teaching hand-write to stamp `normalized_name` from this file.
- Importing `bookings/` and recreating the load-time cycle.
- Routing recon’s `$setOnInsert` through these exports.
- Pulling `customer.service.ts` wipe / hand-write into this file.
- Writing a whole-folder `customers` recommendation in this pass.
