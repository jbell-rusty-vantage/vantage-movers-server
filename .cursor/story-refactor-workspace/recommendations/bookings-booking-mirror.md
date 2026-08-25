# Keep The Lead And The Booking In Agreement — operational story

- Status: recommended
- Service: `bookings` (Wave A, in-progress)
- Pass: 5 of this service — `bookingMirror.service.ts`
- Remaining in this service: `bookingSourceResolver.ts`, `bookingIdentity.ts`
- Target: `src/services/bookings/bookingMirror.service.ts`
- Knowledge: `docs/knowledge/services/bookings.md` (Lead mirror section) and `docs/knowledge/services/cancellation-mirror.md` (this file clears `cancelled` on Booking delete; it does not stamp Cancellation). This checkout’s `CONTEXT.md` does not define Booking terms — do not invent a glossary copy.
- Callers: `bookedLead.service.ts` (stamp on create/upsert/correct; take off on remove), `employeeBookings/submitEmployeeBooking.service.ts` (claim only), `employeeBookings/bookingLeadAttachment.service.ts` (claim then stamp with CPL preserved; take off the old Lead on reassign), `formLead.service.ts` / `callLead.service.ts` (tell the Booking after a Lead correction, imported through `v1.service` to late-bind the leads ↔ bookings cycle), `bookings/index.ts` → `v1.service.ts`. Tests: `bookingMirror.test.ts` (claim + preserve CPL), `v1.service.test.ts` (refresh).
- Seams callers need: stamp vs claim (document save vs atomic `updateOne`); `preserveExistingCpl` on stamp; `syncAfterClear` on take-off (queued caller enqueues `source_lead`; legacy runs inline `syncSourceLead`); refresh always returns a Sheet Sync job (`booking_chain` or `source_lead`)
- Split later (only if the file outgrows one sitting): `stampThisLeadBooked.ts`, `claimThisLeadBeforeSomeoneElseBooksIt.ts`, `tellTheBookingWhatTheLeadJustBecame.ts`, `takeTheBookingOffTheLead.ts` — never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this “Lead mirror” and lists four helpers. The names agree: `mirrorBookingToLead`, `refreshAttachedBookingFromLead`, `clearBookingFromLead`, `claimAvailableLeadForBooking`. Those are pointer mechanics. The owner question is: *this Form or Call and this Booking must point at each other. After we book, stamp the Lead booked. When two people race, claim the Lead or stay Leadless. After the owner corrects a booked Lead, tell the Booking the new customer and Move Type. When the Booking comes off, take booked and cancelled off the Lead.*

## What this file actually does

Four operations, not “a CRUD service” and not Book This Lead:

1. **Stamp this Lead booked** — the Booking already exists (or is about to). Write `booked`, deposit flags, and optional Move Type onto the Form or Call. When a Source Company is passed, run Source Assignment onto the Lead. Reprice CPL unless this write is allowed to keep the Lead’s existing price. Save the Lead in the caller’s session.
2. **Claim this Lead before someone else books it** — one atomic `updateOne`. If the Lead is still open (not booked, not cancelled, not a Duplicate Lead; Call Leads also not an unmatched stub), stamp `booked` + deposit flags + optional Move Type and return true. **Do not touch CPL.** If another writer already took it, return false so employee submit can stay Leadless.
3. **Tell the Booking what the Lead just became** — after a Form or Call correction. No `lead.booked` → return a `source_lead` job and stop. Booking missing or `lead_ref` / `lead_model` mismatch → warn `source_lead.update.booking_*`, return a `source_lead` job, do not write the Booking. Otherwise upsert the customer from the Lead, copy Move Type when the Lead has one, save the Booking only if customer id or `local` changed, and always return `booking_chain`.
4. **Take the Booking off the Lead** — Booking delete. Clear `booked`, `cancelled`, and the deposit flags. Do not clear Move Type or Source. Inline `syncSourceLead` only when `syncAfterClear` is left on (legacy). Queued callers pass `false` and enqueue their own `source_lead` job.

Book This Lead, from-source, Referral, Leadless, employee matching, attaching a Lead later, Cancellation create/delete, and Granot Owner claim are not this file. They call these four **interfaces**, or they never touch a Lead.

## Organization

Keep one file. This is the screenplay for “the Lead and the Booking still agree.” Source Assignment, CPL snapshot, linked-Lead load, customer-from-Lead, and Sheet Sync already live in deeper **modules**. Do not pull those in. Do not invent a `BookingMirrorService` class.

If it later outgrows one sitting, split by **story** (stamp / claim / tell the Booking / take off), never CRUD.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `mirrorBookingToLead` | `stampThisLeadBooked` | Book This Lead / attach need the Lead write in the same session |
| `claimAvailableLeadForBooking` | `claimThisLeadBeforeSomeoneElseBooksIt` | employee submit vs attach; `false` means stay Leadless or 409 |
| `refreshAttachedBookingFromLead` | `tellTheBookingWhatTheLeadJustBecame` | Form/Call correction needs a sheet job even when there is no live Booking |
| `clearBookingFromLead` | `takeTheBookingOffTheLead` | queued vs legacy `syncAfterClear` |

Keep the old names as one-line aliases until `bookedLead.service.ts`, employee submit/attach, and the `v1.service` facade migrate. Do not make callers learn “mirror” as the domain language.

**No class for the workflow.** A class here would be a folder with a constructor. The one type that *does* earn a name is the refresh handoff:

```ts
type BookingRefreshAfterLeadCorrection =
  | { resource: "booking_chain"; operation: string; bookingId: string }
  | { resource: "source_lead"; operation: string; leadModel: LeadModelName; leadId: string }
```

That is today’s `FullSheetSyncJob` narrowed to the two jobs this file can return. The union is the story: *either the Booking is still this Lead’s Booking, or we only refresh the Lead row.*

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// bookingMirror.service.ts
// A Form or Call and a Booking must point at each other.
// After we book, stamp the Lead booked.
// When two people race, claim the Lead or stay Leadless.
// After the owner corrects a booked Lead, tell the Booking.
// When the Booking comes off, take it off the Lead.
// Booking the Lead, attaching later, and Cancellation stamp
// are other files.

// ── 1. Stamp this Lead booked ─────────────────────────────

export async function stampThisLeadBooked(
  lead, leadModel, bookingId, over2000, over4000, local?,
  sourceCompany?, session?, preserveExistingCpl = false,
)

function writeBookedAndDepositFlags(lead, bookingId, over2000, over4000)
function copyMoveTypeWhenTheLeadHasOne(lead, local)
async function assignTheSourceWhenTheBookingBroughtOne(lead, leadModel, sourceCompany, local)
async function repriceUnlessThisWriteKeepsTheLeadPrice(lead, leadModel, sourceCompany, preserveExistingCpl)
  // runs when sourceCompany is set OR preserveExistingCpl is false
async function saveTheLead(lead, session)

// ── 2. Claim this Lead before someone else books it ───────

export async function claimThisLeadBeforeSomeoneElseBooksIt(
  lead, leadModel, bookingId, over2000, over4000, local?, session?,
)

function theLeadMustStillBeOpen(leadModel)
  // not booked, not cancelled, not duplicate
  // Call Lead also created_on_unmatched != true
function stampBookedWithoutTouchingCpl(bookingId, over2000, over4000, local)
  // $set only; no $unset of cpl
async function tryTheClaim(lead, filter, update, session)
  // updateOne on lead.constructor; modifiedCount === 1

// ── 3. Tell the Booking what the Lead just became ─────────

export async function tellTheBookingWhatTheLeadJustBecame(
  lead, leadModel, operation, session?,
)

function justRefreshTheLeadRow(lead, leadModel, operation)
  // source_lead job — no booking write
async function loadTheBookingThisLeadPointsAt(lead, session)
function theBookingMustStillPointAtThisLead(booking, lead, leadModel)
  // else warn booking_missing / booking_mismatch
async function rememberTheCustomerFromTheCorrectedLead(lead, session)
function copyMoveTypeWhenTheCorrectedLeadHasOne(booking, lead)
async function saveTheBookingOnlyIfCustomerOrMoveTypeChanged(booking, session)
function refreshTheWholeBookingChain(booking, operation)

// ── 4. Take the Booking off the Lead ──────────────────────

export async function takeTheBookingOffTheLead(leadModel, leadId, options)

async function loadTheLeadWeAreUnbooking(leadModel, leadId, session)
function clearBookedCancelledAndDepositFlags(lead)
  // does not clear local or source
async function saveTheClearedLead(lead, session)
async function syncTheLeadRowInlineWhenAsked(lead, leadModel, syncAfterClear)
  // default true (legacy); queued callers pass false
```

Read the book path out loud: *Stamp the Lead booked — write the Booking id, the deposit flags, and maybe Move Type. If the Booking brought a Source Company, assign it. Reprice CPL unless this write is allowed to keep the Lead’s price. When two employees race, claim the Lead only if it is still open; if someone else already took it, say no so the submit can stay Leadless. When the owner later corrects that booked Form or Call, tell the Booking the new customer and Move Type, or just refresh the Lead row if the Booking is gone or points at someone else. When the Booking comes off, take booked, cancelled, and the deposit flags off the Lead.*

That is the operation. `mirrorBookingToLead` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two ways to stamp booked.** `stampThisLeadBooked` loads a hydrated Lead and `save`s. `claimThisLeadBeforeSomeoneElseBooksIt` is an atomic `updateOne` that does not refresh the in-memory document and does not touch CPL. Employee attach calls **both**: claim first (race), then stamp with `preserveExistingCpl: true` (hydrate flags + skip CPL). Employee submit claims only — no stamp, so a linked public submit never reprices. Do not teach submit to stamp “so both employee paths agree,” or delete the claim because stamp already writes `booked`.

2. **`preserveExistingCpl` does not mean “never reprice.”** The condition is `sourceCompany || !preserveExistingCpl`. A caller that passes both a Source Company and `preserveExistingCpl: true` still recomputes CPL. Knowledge says “recomputes CPL unless `preserveExistingCpl=true` (reconciliation / employee claim paths).” That sentence hides the `sourceCompany` override. Rename `repriceUnlessThisWriteKeepsTheLeadPrice` so the OR is visible. Do **not** silently skip CPL when a Source Company is present.

3. **Claim is the only CAS.** Stamp and take-off `save` the document they were given. Two stamp callers can overwrite each other’s `booked`. Claim’s filter is the race **seam**. Do not wrap stamp in the same `updateOne` “for safety” — Book This Lead already holds the Lead in the booking transaction and needs Source Assignment + CPL on that same document.

4. **Refresh copies customer id and Move Type only.** It does not copy deposit flags, `job_no`, display `source`, or `customer_name`. A booked Form correction that changes zip may reassign Source on the Lead and still leave the Booking’s `source` label alone. The returned job is `booking_chain`, so sheets reread both rows. Do not copy Source or deposit onto the Booking so refresh “feels complete.”

5. **Refresh never clears Move Type.** `if (lead.local && booking.local !== lead.local)` — a Lead that lost `local` does not blank the Booking. Stamp is the same: `if (local) lead.local = local`. Do not start unsetting `local` so the names “feel honest.”

6. **Missing or mismatched Booking is a fallback, not a throw.** Refresh warns `source_lead.update.booking_missing` / `booking_mismatch` and returns a `source_lead` job. The Lead correction still commits. Do not 409 the Form/Call update because the pointer is stale.

7. **Take-off also clears `cancelled`.** Deleting the Booking implies the Cancellation chain it owned is gone. Cancellation-only unwind is `clearCancellationFromLead` and **keeps** `booked`. Do not call the cancellation helper from take-off “to share a clear,” or stop clearing `cancelled` here so the two mirrors “own one field each.”

8. **Take-off does not clear Move Type or Source.** Deposit flags go false. `local` and the assignment snapshot stay. A later book of the same Lead can reuse them. Do not blank `local` so an unbooked Lead “looks unused.”

9. **`syncAfterClear` default is legacy inline sync.** Queued Book This Lead remove and employee reassign pass `false` and enqueue `source_lead` themselves. A new caller that forgets the flag double-syncs in queued mode (inline + job) or skips sheets. Keep the default. Do not flip it to `false` “because queued is the real path.”

10. **Form/Call still import refresh through `v1.service`.** The comment in `formLead.service.ts` says extraction has not happened. The function already lives here; `v1.service` is a re-export. The cycle is still real (`leads` ↔ `bookings`). Late binding through the facade is a load-bearing **seam**. Do not switch those files to `bookings/index` while renaming this module.

11. **`getLinkedLead` is not an eligibility filter.** Take-off loads Duplicate Leads, booked/cancelled leads, and unmatched Call stubs. Claim refuses those last three. Refresh is given the Lead the correction just saved. Do not teach `getLinkedLead` the claim filter (see `leads-source-lead-lookup.md`).

12. **Leave sibling modules alone.** `resolveLeadSourceAssignment`, `resolveLeadCplSnapshot`, `getLinkedLead`, `upsertCustomerFromLead`, `syncSourceLead`, Book This Lead, employee submit/attach, and `cancellations/cancellationMirror.service.ts` stay where they are. This file orchestrates the pointer.

13. **Do not treat Granot Owner claim as this story.** The owner-booking spec names “`claimAvailableLeadForBooking` or the Granot equivalent.” That equivalent is not this file.

14. **Referral and Leadless never call this file.** They have no Lead. Employee Leadless pending is a Booking plus a case, not a stamp.

## Testing

The **interface** is the test surface: `stampThisLeadBooked`, `claimThisLeadBeforeSomeoneElseBooksIt`, `tellTheBookingWhatTheLeadJustBecame`, `takeTheBookingOffTheLead`.

Today `bookingMirror.test.ts` locks claim concurrency, claim’s refusal to put `cpl` in `$set`, and stamp with `preserveExistingCpl` leaving `cpl: 41`. Refresh coverage lives in `v1.service.test.ts` (customer + local, unbooked, missing, mismatch). There is no take-off test. That is not enough for a story this long.

Add tests that name the operation. Do not add a test per helper.

**Stamp this Lead booked**
- Writes `booked`, `over_2000`, `over_4000`. Truthy `local` copies; omitted `local` leaves the Lead’s Move Type alone.
- No `sourceCompany` and `preserveExistingCpl: false` (Book This Lead default) → CPL snapshot runs from the Lead’s current granularity.
- No `sourceCompany` and `preserveExistingCpl: true` (employee attach) → `cpl` unchanged.
- `sourceCompany` set **and** `preserveExistingCpl: true` → assignment runs **and** CPL still recomputes (lock the OR). Do not “fix” this to honor preserve.
- Duplicate Call Lead (`duplicate: true`) still gets a snapshot when CPL runs (`duplicate` is passed through). That is `resolveLeadCplSnapshot`’s job — do not re-test the helper’s arithmetic.

**Claim this Lead before someone else books it**
- Two concurrent claims → exactly one `modifiedCount === 1`.
- `$set` never includes `cpl`.
- Already booked / cancelled / `duplicate: true` → false, no `$set` of `booked`.
- Call Lead with `created_on_unmatched: true` → false. Form Lead has no unmatched clause.
- Truthy `local` is in `$set`; omitted `local` is not.

**Tell the Booking what the Lead just became**
- Unbooked Lead → `source_lead` job, **no** booking lookup, **no** customer upsert.
- Booking missing or `lead_ref` / `lead_model` mismatch → `source_lead` job, warn, **no** booking save, **no** customer upsert.
- Matching Booking + new customer id or new `local` → booking saved, `booking_chain` job with the caller’s `operation`.
- Matching Booking + same customer id and same `local` → **no** booking save, still `booking_chain` (customer document may have been upserted).
- Lead with empty `local` does **not** blank `booking.local`.

**Take the Booking off the Lead**
- Clears `booked`, `cancelled`, `over_2000`, `over_4000`. Leaves `local` and Source Assignment.
- `syncAfterClear: false` → no `syncSourceLead`.
- Default / `true` → inline `syncSourceLead` after save.
- Loads through `getLinkedLead` (404 if missing). Do not re-test that helper’s Duplicate / unmatched return.

Do **not** add a test per helper (`theLeadMustStillBeOpen`, `justRefreshTheLeadRow`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test Book This Lead’s ignore / rebook / insert, Referral / Leadless (no Lead), employee matching rules, `attachLeadToEmployeeBooking` ownership, or `clearCancellationFromLead` here.

## What I would not do

- A `BookingMirrorService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save` or `updateOne`.
- Moving this into a CRUD folder “for cleanliness.”
- Teaching employee submit to stamp, or attach to skip the claim, so the two employee **adapters** “agree.”
- Skipping CPL when `sourceCompany` is set just because `preserveExistingCpl` is true.
- 409ing a Form/Call correction when the Booking pointer is stale.
- Clearing `local` / Source on take-off, or routing take-off through `clearCancellationFromLead`.
- Importing this file from `formLead.service.ts` / `callLead.service.ts` through `bookings/index` while the leads ↔ bookings cycle still needs the `v1.service` late bind.
- Pulling Book This Lead, employee matching, Cancellation stamp, or Granot Owner claim into this file.
- Writing a whole-folder `bookings` recommendation in this pass.
